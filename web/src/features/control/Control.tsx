/* ============================================================
   Control(탐구 수집) — 탭: 🔭 탐구 수집. (옛 시스템 제어판 OPS 콘솔 폐기 → 탐구 단일 목적)
   "교재 밖에서 새로 알아보는 학습"을 검색엔진처럼: 큰 검색바로 주제 수집 → serve.js의
   탐구_수집.py가 전공/_탐구/에 원자 노트 초안 생성. 최근 수집 기록 + 옵시디언 바로가기.

   ⏱ 수집은 수십 분짜리라 서버가 *잡*으로 소유한다(백그라운드 spawn). 화면은 시작 요청만 즉시
   돌려받고 /api/research/jobs를 폴링해 진행/완료를 본다 → 탭을 새로고침/이동해도 in-flight
   잡에 자동 재부착. 폴링·재부착·구조공유는 react-query(useResearchJobs)가 소유하고(손폴링 제거),
   이 컴포넌트는 잡 목록의 *변화*를 보고 전이감지(토스트·히스토리)만 한다. serve.js 연결은 usePing.
============================================================ */
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { usePing, useResearchJobs, RESEARCH_JOBS_KEY } from '@/store/queries';
import { startResearch, cancelResearch, type ResearchJob } from '@/lib/api';
import { readJSON, writeJSON } from '@/lib/localStore';
import { onSync } from '@/lib/sync';
import { RESEARCH_HISTORY_KEY } from '@/lib/sidecars';
import EmptyState from '@/components/EmptyState';
import { ui } from '@/shell';
import ds from '@/styles/ds.module.css';
import cm from './Control.module.css';

interface HistEntry {
  topic: string;
  scope?: string;
  at: string;
  ok: boolean;
  durMs?: number; // 소요시간(완료 잡의 endedAt-startedAt) — 메타 표기·평균 기대치용
}
const HKEY = RESEARCH_HISTORY_KEY;
const EMPTY_JOBS: ResearchJob[] = []; // undefined 폴백을 안정 참조로 — 전이감지 이펙트가 매 렌더 헛돌지 않게
function loadHistory(): HistEntry[] {
  const v = readJSON<HistEntry[]>(HKEY, []);
  return Array.isArray(v) ? v : []; // 저장 스키마 방어(비배열이면 초기화)
}
function saveHistory(h: HistEntry[]) {
  writeJSON(HKEY, h.slice(0, 10));
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
/** 소요시간(ms) → mm:ss(경과와 같은 포맷 재사용). */
function fmtDur(ms: number): string {
  return fmtElapsed(0, ms);
}

/** 경과 시간 자가틱 리프 — 자기 인터벌로 mm:ss digits만 리렌더한다(부모 Control을 매초 리렌더시키지
 *  않게 now state를 여기로 격리). 언마운트 시 clearInterval. */
function Elapsed({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <>{fmtElapsed(startedAt, now)}</>;
}

export default function Control() {
  const { data: ping, isLoading } = usePing();
  const online = !!ping?.ok;
  const offline = !isLoading && !online;
  const qc = useQueryClient();
  const [topic, setTopic] = useState('');
  const [scope, setScope] = useState('');
  const [starting, setStarting] = useState(false);
  // 잡 목록·폴링·재부착·구조공유는 react-query가 소유(enabled=online, running 있으면 3초 refetch).
  const { data: jobsData } = useResearchJobs(online);
  const jobs = jobsData || EMPTY_JOBS;
  const [openJob, setOpenJob] = useState<string | null>(null); // 출력 펼친 잡 id
  const [history, setHistory] = useState<HistEntry[]>(() => loadHistory());
  const [cancelling, setCancelling] = useState<Set<string>>(() => new Set()); // 이중클릭 방지(중단 중인 잡 id)
  // 가져오기 복원(_local) → 이력을 KV에서 되읽는다(낡은 메모리가 saveHistory에서 복원본을 덮는 것 방지).
  useEffect(() => onSync((m) => m.kind === 'local' && setHistory(loadHistory())), []);
  // 잡별 마지막 관측 상태 — running→done/error/canceled 전이만 토스트/히스토리에 반영(reload 재부착 시 중복 방지).
  const seen = useRef<Record<string, ResearchJob['status']>>({});

  const running = jobs.filter((j) => j.status === 'running');
  // 성공 잡 평균 소요(분) — 첫 사용자 기대치("보통 ~N분 걸려요").
  const doneDurs = history.filter((h) => h.ok && h.durMs).map((h) => h.durMs!);
  const avgMin = doneDurs.length ? Math.round(doneDurs.reduce((a, b) => a + b, 0) / doneDurs.length / 60000) : 0;

  usePageChromeEffect(
    () => ({
      readouts: [
        { label: '진행 중', value: running.length, accent: running.length > 0 },
        { label: '수집 기록', value: history.length },
        { label: '워크스페이스', value: online ? '● 연결됨' : offline ? '미설정' : '…' },
      ],
    }),
    [running.length, history.length, online, offline],
  );

  // 전이 감지 — 잡 목록 변화 시 running→종료 전이만 토스트+히스토리 기록. react-query 구조공유라
  // 목록이 안 바뀌면 jobs 참조가 안정(이펙트 헛돌지 않음). seen ref로 reload 재부착 시 중복 방지.
  useEffect(() => {
    const newRecs: HistEntry[] = []; // 이번 관측에서 새로 종료된 잡의 히스토리 레코드(완료/실패)
    let openErrId: string | null = null; // 실패 잡 자동 펼침 대상
    for (const j of jobs) {
      const prev = seen.current[j.id];
      if (j.status !== 'running' && prev !== j.status) {
        // running에서 넘어온 '진짜 전이'만 토스트(reload 후 이미 끝나 있던 잡은 조용히 히스토리에만).
        if (prev === 'running') {
          if (j.status === 'canceled') {
            ui.toast('탐구 중단됨', 'info'); // 사용자 중단은 중립 — done/error와 구분
          } else {
            ui.toast(
              `탐구 “${j.topic}” ${j.status === 'done' ? '완료 — 옵시디언에서 확인' : '실패 — 출력 확인'}`,
              j.status === 'done' ? 'ok' : 'bad',
            );
            if (j.status === 'error') openErrId = j.id; // 실패는 출력 자동 펼침
          }
        }
        // 중단(canceled)은 이력 생략 — 완료/실패만 최근 기록에 남긴다.
        if (j.status !== 'canceled') {
          newRecs.push({
            topic: j.topic,
            scope: j.scope || undefined,
            at: new Date(j.endedAt || j.startedAt).toISOString(),
            ok: j.status === 'done',
            durMs: (j.endedAt || j.startedAt) - j.startedAt,
          });
        }
      }
      seen.current[j.id] = j.status; // 관측 상태 갱신(ref — 동기 안전)
    }
    // 로컬 state 반영은 비동기로 커밋 — 이펙트 내 동기 setState(연쇄 렌더) 회피. seen ref가 전이를
    // 이미 잠갔으니 재실행돼도 중복 커밋 없음.
    if (newRecs.length || openErrId) {
      const errId = openErrId;
      setTimeout(() => {
        if (newRecs.length) {
          setHistory((h) => {
            let nh = h;
            for (const rec of newRecs) nh = [rec, ...nh.filter((x) => x.topic !== rec.topic)];
            nh = nh.slice(0, 10);
            saveHistory(nh);
            return nh;
          });
        }
        if (errId) setOpenJob(errId);
      }, 0);
    }
  }, [jobs]);

  const collect = async (t: string, sc: string) => {
    const tq = t.trim();
    if (!tq) {
      ui.toast('탐구할 주제를 입력하세요.', 'warn');
      return;
    }
    // 버튼은 offline이면 disabled지만 Enter 키는 그 게이트를 우회한다 — collect에서 단일 가드.
    if (offline) {
      ui.toast('워크스페이스가 설정되지 않았어요 — 설정 탭에서 폴더를 지정하면 수집할 수 있어요.', 'warn');
      return;
    }
    if (starting) return;
    setStarting(true);
    try {
      const r = await startResearch(tq, sc.trim());
      if (r.ok && r.job) {
        seen.current[r.job.id] = 'running'; // 완료 전이를 잡으려면 시작 상태를 먼저 관측으로 등록
        // 낙관적 삽입 대신 무효화 — react-query가 즉시 refetch해 새 running 잡을 픽업·폴링 재기동.
        qc.invalidateQueries({ queryKey: RESEARCH_JOBS_KEY });
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

  // 진행 중 잡 중단 — 서버가 프로세스를 트리킬하고 'canceled'로 전이(다음 폴링/무효화에 반영).
  const cancel = async (id: string) => {
    if (cancelling.has(id)) return; // 이중클릭 방지
    setCancelling((s) => new Set(s).add(id));
    try {
      const r = await cancelResearch(id);
      if (!r.ok) ui.toast(r.error || '중단하지 못했어요.', 'bad');
      qc.invalidateQueries({ queryKey: RESEARCH_JOBS_KEY }); // 즉시 상태 반영
    } catch (e) {
      ui.toast('중단 요청 실패: ' + ((e as Error).message || e), 'bad');
    } finally {
      setCancelling((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  };

  // 최근 기록 개별 삭제 — 순수 localStorage 조작(형제 탭과 같은 어포던스).
  const removeHist = (t: string, at: string) => {
    setHistory((h) => {
      const nh = h.filter((x) => !(x.topic === t && x.at === at));
      saveHistory(nh);
      return nh;
    });
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
            placeholder="범위(선택) — 최근 2년·한국 규제·입문자용"
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
              ⚠ 워크스페이스가 설정되지 않았어요 — 설정 탭에서 폴더를 지정하면 수집할 수 있어요.
            </b>
          ) : (
            ` 몇 분~수십 분 걸리며, 탭을 떠나거나 새로고침해도 서버에서 계속 돌아가요(다시 열면 자동 재부착).${
              avgMin > 0 ? ` 지난 수집은 보통 ~${avgMin}분 걸렸어요.` : ''
            }`
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
              <span className={cm.jobElapsed}>
                <Elapsed startedAt={j.startedAt} />
              </span>
              {j.out && (
                <button type="button" className={cm.jobPeek} onClick={() => setOpenJob(openJob === j.id ? null : j.id)}>
                  {openJob === j.id ? '출력 숨기기' : '출력 보기'}
                </button>
              )}
              <button
                type="button"
                className={cm.jobCancel}
                onClick={() => cancel(j.id)}
                disabled={cancelling.has(j.id)}
                title="이 탐구 수집을 중단"
              >
                {cancelling.has(j.id) ? '중단 중' : '중단'}
              </button>
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
                  {h.durMs ? ' · ' + fmtDur(h.durMs) : ''}
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
                  title="이 주제로 다시 수집 시작"
                >
                  다시
                </button>
                <button
                  type="button"
                  className={cm.recDel}
                  onClick={() => removeHist(h.topic, h.at)}
                  aria-label="이 기록 삭제"
                  title="이 기록 삭제"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            glyph="🔭"
            title="아직 수집한 탐구가 없어요"
            desc="위 검색바에 주제를 넣어 첫 탐구를 시작해 보세요 — 웹에서 새로 조사해 볼트에 초안을 만듭니다."
          />
        )}
      </div>
    </section>
  );
}
