/* ============================================================
   Control(탐구 수집) — 탭: 🔭 탐구 수집. (옛 시스템 제어판 OPS 콘솔 폐기 → 탐구 단일 목적)
   "교재 밖에서 새로 알아보는 학습"을 검색엔진처럼: 큰 검색바로 주제 수집 → serve.js의
   탐구_수집.py가 전공/_탐구/에 원자 노트 초안 생성. 최근 수집 기록 + 옵시디언 바로가기.

   ⏱ 수집은 수십 분짜리라 서버가 *잡*으로 소유한다(백그라운드 spawn). 화면은 시작 요청만 즉시
   돌려받고 /api/research/jobs를 폴링해 진행/완료를 본다 → 탭을 새로고침/이동해도 in-flight
   잡에 자동 재부착(예전엔 reload하면 진행 상황을 통째로 잃었다). serve.js 연결은 usePing(Query).
============================================================ */
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { usePing } from '@/store/queries';
import { startResearch, listResearchJobs, type ResearchJob } from '@/lib/api';
import { ui } from '@/shell';
import ds from '@/styles/ds.module.css';
import cm from './Control.module.css';

interface HistEntry {
  topic: string;
  scope?: string;
  at: string;
  ok: boolean;
}
const HKEY = 'lh:research-history';
function loadHistory(): HistEntry[] {
  try {
    const v = JSON.parse(localStorage.getItem(HKEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function saveHistory(h: HistEntry[]) {
  try {
    localStorage.setItem(HKEY, JSON.stringify(h.slice(0, 10)));
  } catch {
    /* localStorage 불가 — 무시 */
  }
}
/** 옵시디언 바로가기 — 전공/_탐구 폴더에서 주제 검색(마지막 연 볼트 기준). */
function obsidianLink(topic: string): string {
  return `obsidian://search?query=${encodeURIComponent('path:_탐구 ' + topic)}`;
}
function fmtWhen(at: string): string {
  const d = new Date(at);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** 경과 시간 mm:ss(진행 중 잡). 서버-클라 시계 오차로 음수가 되지 않게 0으로 클램프. */
function fmtElapsed(startedAt: number, now: number): string {
  const s = Math.max(0, Math.round((now - startedAt) / 1000));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${Math.floor(s / 60)}:${p(s % 60)}`;
}

export default function Control() {
  const { data: ping, isLoading } = usePing();
  const online = !!ping?.ok;
  const offline = !isLoading && !online;
  const [topic, setTopic] = useState('');
  const [scope, setScope] = useState('');
  const [starting, setStarting] = useState(false);
  const [jobs, setJobs] = useState<ResearchJob[]>([]);
  const [openJob, setOpenJob] = useState<string | null>(null); // 출력 펼친 잡 id
  const [history, setHistory] = useState<HistEntry[]>(() => loadHistory());
  const [pollActive, setPollActive] = useState(false);
  const [now, setNow] = useState(() => Date.now()); // 경과 시간 1초 틱(진행 중일 때만)
  // 잡별 마지막 관측 상태 — running→done/error 전이만 토스트/히스토리에 반영(reload 재부착 시 중복 방지).
  const seen = useRef<Record<string, ResearchJob['status']>>({});

  const running = jobs.filter((j) => j.status === 'running');

  usePageChromeEffect(
    () => ({
      readouts: [
        { label: '진행 중', value: running.length, accent: running.length > 0 },
        { label: '수집 기록', value: history.length },
        { label: 'serve.js', value: online ? '● ON' : offline ? 'OFF' : '…' },
      ],
    }),
    [running.length, history.length, online, offline],
  );

  // 서버 잡 목록 반영 — 전이 감지(완료 토스트 + 히스토리) 후 상태 갱신. 함수형 setState라 deps 없음(안정).
  const applyJobs = useCallback((next: ResearchJob[]) => {
    for (const j of next) {
      const prev = seen.current[j.id];
      if (j.status !== 'running' && prev !== j.status) {
        // running에서 넘어온 '진짜 전이'만 토스트(reload 후 이미 끝나 있던 잡은 조용히 히스토리에만).
        if (prev === 'running') {
          ui.toast(
            `탐구 “${j.topic}” ${j.status === 'done' ? '완료 — 옵시디언에서 확인' : '실패 — 출력 확인'}`,
            j.status === 'done' ? 'ok' : 'bad',
          );
          if (j.status === 'error') setOpenJob(j.id); // 실패는 출력 자동 펼침
        }
        setHistory((h) => {
          const rec: HistEntry = {
            topic: j.topic,
            scope: j.scope || undefined,
            at: new Date(j.endedAt || j.startedAt).toISOString(),
            ok: j.status === 'done',
          };
          const nh = [rec, ...h.filter((x) => x.topic !== j.topic)].slice(0, 10);
          saveHistory(nh);
          return nh;
        });
      }
      seen.current[j.id] = j.status;
    }
    setJobs(next);
  }, []);

  // 마운트/온라인 전환 시 1회 재부착 — 서버가 아는 in-flight 잡을 끌어오고, 있으면 폴링 시작.
  useEffect(() => {
    if (!online) return;
    let alive = true;
    listResearchJobs()
      .then((r) => {
        if (!alive || !r.ok) return;
        applyJobs(r.jobs);
        if (r.jobs.some((j) => j.status === 'running')) setPollActive(true);
      })
      .catch(() => {
        /* 순간 단절 — 다음 상호작용/온라인 전환에 복구 */
      });
    return () => {
      alive = false;
    };
  }, [online, applyJobs]);

  // 진행 중이면 3초 폴링 + 1초 경과 틱. 진행 중 잡이 사라지면 스스로 멈춘다(다음 start가 재기동).
  useEffect(() => {
    if (!online || !pollActive) return;
    let alive = true;
    // 경과 시계 즉시 동기화(마이크로태스크 큐로 — 이펙트 본문 동기 setState 회피).
    const seed = setTimeout(() => alive && setNow(Date.now()), 0);
    const poll = setInterval(async () => {
      try {
        const r = await listResearchJobs();
        if (!alive || !r.ok) return;
        applyJobs(r.jobs);
        if (!r.jobs.some((j) => j.status === 'running')) setPollActive(false);
      } catch {
        /* 순간 단절 — 다음 틱에 복구 */
      }
    }, 3000);
    const tick = setInterval(() => alive && setNow(Date.now()), 1000);
    return () => {
      alive = false;
      clearTimeout(seed);
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [online, pollActive, applyJobs]);

  const collect = async (t: string, sc: string) => {
    const tq = t.trim();
    if (!tq) {
      ui.toast('탐구할 주제를 입력하세요.', 'warn');
      return;
    }
    // 버튼은 offline이면 disabled지만 Enter 키는 그 게이트를 우회한다 — collect에서 단일 가드.
    if (offline) {
      ui.toast('serve.js가 꺼져 있어요 — node serve.js로 켜면 수집할 수 있어요.', 'warn');
      return;
    }
    if (starting) return;
    setStarting(true);
    try {
      const r = await startResearch(tq, sc.trim());
      if (r.ok && r.job) {
        seen.current[r.job.id] = 'running'; // 완료 전이를 잡으려면 시작 상태를 먼저 관측으로 등록
        setJobs((prev) => [r.job!, ...prev.filter((j) => j.id !== r.job!.id)]);
        setPollActive(true);
        ui.toast(`탐구 시작 — “${tq}” 백그라운드 수집 중`, 'info');
      } else {
        ui.toast(r.error || '수집을 시작하지 못했어요.', 'bad');
      }
    } catch (e) {
      ui.toast('요청 실패: ' + ((e as Error).message || e), 'bad');
    } finally {
      setStarting(false);
    }
  };

  return (
    <section className={cm.wrap} aria-label="탐구 수집">
      {/* 검색 히어로 — 검색엔진 느낌. */}
      <div className={cm.hero}>
        <div className={cm.heroEyebrow}>🔭 탐구 수집</div>
        {/* h2 — TopBar 워드마크가 페이지 영속 h1이라 본문 최상위는 h2(전 탭 일관). 시각 스타일은 CSS 유지. */}
        <h2 className={cm.heroTitle}>무엇을 새로 알아볼까요?</h2>
        <div className={`${cm.searchBar}${starting ? ' ' + cm.searchBusy : ''}`}>
          <span className={cm.searchIcon} aria-hidden="true">
            ⌕
          </span>
          <input
            className={cm.searchInput}
            placeholder="주제 — 예: 반도체 공급망 동향, 트랜스포머 어텐션 직관"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') collect(topic, scope);
            }}
            disabled={starting}
            aria-label="탐구 주제"
          />
          <input
            className={cm.searchScope}
            placeholder="범위(선택)"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') collect(topic, scope);
            }}
            disabled={starting}
            aria-label="범위"
          />
          <button
            className={cm.searchGo}
            type="button"
            onClick={() => collect(topic, scope)}
            disabled={starting || offline}
          >
            {starting ? (
              <>
                <span className={ds.spin} /> 시작 중
              </>
            ) : (
              '수집 시작'
            )}
          </button>
        </div>
        <div className={cm.heroHint}>
          웹에서 새로 조사해 <code>전공/_탐구/</code>에 원자 노트 초안을 만듭니다.
          {offline ? (
            <b className={cm.offHint}>
              {' '}
              ⚠ serve.js가 꺼져 있어요 — <code>node serve.js</code>로 켜면 수집할 수 있어요.
            </b>
          ) : (
            ' 몇 분~수십 분 걸리며, 탭을 떠나거나 새로고침해도 서버에서 계속 돌아가요(다시 열면 자동 재부착).'
          )}
        </div>
      </div>

      {/* 진행 중 잡 — 백그라운드 수집. reload해도 이 목록으로 재부착된다. */}
      {running.length > 0 && (
        <div className={cm.jobs}>
          <div className={cm.jobsHead}>
            진행 중 · {running.length}
            <span className={`${ds.muted} ${ds.tiny}`}> — 새로고침해도 계속돼요</span>
          </div>
          {running.map((j) => (
            <div key={j.id} className={cm.job}>
              <span className={ds.spin} />
              <span className={cm.jobTopic}>{j.topic}</span>
              {j.scope && <span className={cm.jobScope}>{j.scope}</span>}
              <span className={cm.jobElapsed}>{fmtElapsed(j.startedAt, now)}</span>
              {j.out && (
                <button type="button" className={cm.jobPeek} onClick={() => setOpenJob(openJob === j.id ? null : j.id)}>
                  {openJob === j.id ? '출력 숨기기' : '출력 보기'}
                </button>
              )}
              {openJob === j.id && j.out && <pre className={cm.pre}>{j.out}</pre>}
            </div>
          ))}
        </div>
      )}

      {/* 최근 수집 기록 — 완료/실패 이력(localStorage, 서버 재시작에도 유지). */}
      <div className={cm.recent}>
        <div className={cm.recentHead}>최근 수집 기록</div>
        {history.length ? (
          <div className={cm.recList}>
            {history.map((h) => (
              <div key={h.topic + h.at} className={cm.recItem}>
                <span className={cm.recDot} data-ok={h.ok ? '1' : '0'} aria-hidden="true" />
                <span className={cm.recTopic}>{h.topic}</span>
                <span className={cm.recMeta}>
                  {h.scope ? h.scope + ' · ' : ''}
                  {fmtWhen(h.at)}
                  {h.ok ? '' : ' · 실패'}
                </span>
                <a className={cm.recOpen} href={obsidianLink(h.topic)} title="옵시디언 _탐구 폴더에서 이 주제 열기">
                  옵시디언 ↗
                </a>
                <button
                  type="button"
                  className={cm.recAgain}
                  onClick={() => {
                    setTopic(h.topic);
                    setScope(h.scope || '');
                    collect(h.topic, h.scope || '');
                  }}
                  disabled={starting || offline}
                >
                  다시
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className={cm.recEmpty}>아직 수집 기록이 없어요. 위에서 주제를 넣어 첫 탐구를 시작해 보세요.</div>
        )}
      </div>
    </section>
  );
}
