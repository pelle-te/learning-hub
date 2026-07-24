/* ============================================================
   Control(탐구 수집) — 탭: 🔭 탐구 수집. (옛 시스템 제어판 OPS 콘솔 폐기 → 탐구 단일 목적)
   "교재 밖에서 새로 알아보는 학습"을 검색엔진처럼: 큰 검색바로 주제 수집 → 셸의
   탐구_수집.py가 전공/_탐구/에 원자 노트 초안 생성. 최근 수집 기록 + 옵시디언 바로가기.

   ⏱ 수집은 수십 분짜리라 서버가 *잡*으로 소유한다(백그라운드 spawn). 화면은 시작 요청만 즉시
   돌려받고 /api/research/jobs를 폴링해 진행/완료를 본다 → 탭을 새로고침/이동해도 in-flight
   잡에 자동 재부착. 폴링·재부착·구조공유는 react-query(useResearchJobs)가 소유하고(손폴링 제거),
   이 컴포넌트는 잡 목록의 *변화*를 보고 전이감지(토스트·히스토리)만 한다. 백엔드 사용 가능 여부는 usePing.
============================================================ */
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { usePing, useResearchJobs, RESEARCH_JOBS_KEY } from '@/store/queries';
import { startResearch, cancelResearch, type ResearchJob } from '@/lib/api';
import { readJSON, writeJSON } from '@/lib/localStore';
import { hhmm, pad2 } from '@/lib/utils';
import { onSync } from '@/lib/sync';
import { RESEARCH_HISTORY_KEY } from '@/lib/sidecars';
import EmptyState from '@/components/EmptyState';
import { ui } from '@/shell';

/* ── C-7 다섯 번째 이식(control) — 첫 폼 위주 feature ──────────────────────
   규약은 §15 + `styles/tokenBridge.css` 머리주석이 SSOT. `Control.module.css`(384줄) 삭제.

   ⚠ 이 파일이 처음 만난 구조적 장애물: **전역 요소 규칙이 layered 유틸리티를 이긴다.**
   `base.css`/`components.css` 는 `@layer` 밖(unlayered)이고 Tailwind 유틸리티는
   `layer(utilities)` 안이라, CSS 캐스케이드상 unlayered 가 layered 를 **명시도 무관하게**
   이긴다. `<div>/<span>` 은 경쟁 전역 규칙이 없어 앞 넷은 무사했지만, `<button>`·`<input>`·
   `<h2>`(전역 `button{}`·`input:focus{}`·`h2{}` 존재)는 유틸리티가 묻힌다 — 예로 `!` 없이
   옮기면 히어로 h2 가 전역 `h2{font-size:16}` 로 **16px 로 붕괴**한다(clamp 26~40 이어야).
   → 전역과 **다른** 속성만 `!`(important)로 이긴다(2026-07-23 결정 · Option A). 전역과
   **같은** 값(jobPeek 테두리 1px line·r-sm 등)은 `!` 없이 전역에 맡겨 과잉 ! 를 피한다.
   공유 전역 CSS 를 이식 중에 건드리지 않는다(공유 디자인 시스템을 맨 뒤로 미룬 것과 같은 원칙).

   ⚠ searchGo 배경은 `--acc-fill` **그래디언트** SSOT 라 Tailwind 색 유틸로 표현 불가 →
   `bg-[image:var(--acc-fill)]` 로 토큰을 직접 참조한다(임의 '값'이 아니라 SSOT 참조 · §14-3
   런타임 변수 주입 예외와 같은 성격). 발광/링·유동 clamp·대문자 자간·폭 상한은 브리지에 이름. */
const WRAP = 'flex h-full min-h-0 min-w-0 flex-col overflow-y-auto px-6 pb-6 [scrollbar-width:thin]';
const HERO = 'flex flex-none flex-col items-center pt-hero-y pb-7 text-center';
const EYEBROW = 'text-sm font-extrabold tracking-eyebrow text-acc uppercase';
const TITLE = 'mt-3! mb-5! text-control-title! font-black! tracking-tight!'; // h2 — 전역 h2{} 를 ! 로 이김
const SEARCHBAR =
  'flex w-full max-w-runner items-center gap-2 rounded-lg border border-line bg-panel py-2 pr-2 pl-4 shadow-bar transition focus-within:border-line-acc-focus focus-within:shadow-bar-focus max-narrow:flex-wrap';
const SEARCHINPUT =
  'min-w-0 flex-1 border-0! bg-transparent! px-1 py-2 text-base! leading-[normal]! shadow-none! focus-visible:rounded-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-acc';
const SEARCHSCOPE =
  'w-30 flex-none border-l border-l-line2! bg-transparent! px-2 py-2 text-txt shadow-none! placeholder:text-mut! focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-acc max-narrow:w-full max-narrow:border-t max-narrow:border-t-line2! max-narrow:border-l-0!';
/* ⚠ hover 장식에는 `enabled:` 를 붙인다. C-7 마지막 티어에서 전역 CSS 를 `@layer base` 로
   내리면서 유틸리티가 전역을 이기게 됐는데, 그러면 앱의 `button:disabled` 가드(`:not(:disabled)`)를
   유틸이 그냥 통과한다 — 실측: 비활성 상태의 이 버튼이 hover 에서 `brightness(1.05)` 로 밝아졌다
   ("눌러도 안 되는 컨트롤"이라는 신호가 죽는다). 스냅샷은 disabled·hover 를 안 찍으므로
   상호작용 계산스타일 전수 대조가 잡았다(설계서 §15-14). */
const SEARCHGO =
  'inline-flex items-center gap-1 rounded-md! border-0! bg-[image:var(--acc-fill)]! px-5! py-3! font-extrabold! text-on-acc! shadow-go transition enabled:hover:-translate-y-px enabled:hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc max-narrow:w-full max-narrow:justify-center';
const JOBS = 'mx-auto mb-5 w-full max-w-runner rounded-md border border-line-acc bg-acc-soft px-4 py-3';
const JOB_BTN = 'flex-none bg-transparent! px-2! py-1! text-sm! font-bold! text-mut!'; // jobPeek·jobCancel·recAgain — 전역 button{} 과 다른 속성만 !
const RECITEM = 'flex items-center gap-3 border-b border-line2 px-1 py-3 last:border-b-0';

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
  return `${d.getMonth() + 1}/${d.getDate()} ${hhmm(d)}`;
}
/** 경과 시간 mm:ss(진행 중 잡). 서버-클라 시계 오차로 음수가 되지 않게 0으로 클램프. */
function fmtElapsed(startedAt: number, now: number): string {
  const s = Math.max(0, Math.round((now - startedAt) / 1000));
  // ⚠ mmss 와 달리 **분에는 0 을 안 채운다**('3:07') — 경과 표기의 기존 형태를 보존한다.
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
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
    <section className={WRAP} aria-label="탐구 수집">
      {/* 검색 히어로 — 검색엔진 느낌. */}
      <div className={HERO}>
        <div className={EYEBROW}>🔭 탐구 수집</div>
        {/* h2 — TopBar 워드마크가 페이지 영속 h1이라 본문 최상위는 h2(전 탭 일관). 시각 스타일은 클래스 유지. */}
        <h2 className={TITLE}>무엇을 새로 알아볼까요?</h2>
        <div className={`${SEARCHBAR}${starting ? ' opacity-75' : ''}`}>
          <span className="flex-none text-xl text-mut" aria-hidden="true">
            ⌕
          </span>
          <input
            className={SEARCHINPUT}
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
            className={SEARCHSCOPE}
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
            className={SEARCHGO}
            type="button"
            onClick={() => collect(topic, scope)}
            disabled={starting || offline}
          >
            {starting ? (
              <>
                <span className="ds-spin" /> 시작 중
              </>
            ) : (
              '수집 시작'
            )}
          </button>
        </div>
        <div className="mt-4 max-w-hint text-md leading-relaxed text-mut">
          웹에서 새로 조사해 <code className="text-sm">전공/_탐구/</code>에 원자 노트 초안을 만듭니다.
          {offline ? (
            <b className="font-bold text-warn">
              {' '}
              ⚠ 워크스페이스가 설정되지 않았어요 — 설정 탭에서 폴더를 지정하면 수집할 수 있어요.
            </b>
          ) : (
            /* ⚠ 잡 소유 모델이 4단계에서 바뀌었다 — **앱이 곧 잡 소유자**다(별도 서버가 없다).
               화면을 떠나거나 새로고침해도 계속되지만, **앱을 닫으면 수집도 멈춘다**.
               옛 문구("서버에서 계속 돌아가요")는 셸에서 거짓이고, 그 거짓을 믿고 앱을 끄면
               수십 분짜리 수집을 잃는다 — 사용자가 알아야 하는 차이다. */
            ` 몇 분~수십 분 걸리며, 다른 탭으로 가거나 새로고침해도 계속돼요(돌아오면 자동 재부착). 다만 앱을 닫으면 수집도 멈춰요.${
              avgMin > 0 ? ` 지난 수집은 보통 ~${avgMin}분 걸렸어요.` : ''
            }`
          )}
        </div>
      </div>

      {/* 진행 중 잡 — 백그라운드 수집. reload해도 이 목록으로 재부착된다. */}
      {running.length > 0 && (
        <div className={JOBS}>
          <div className="mb-2 text-xs font-extrabold tracking-caps text-acc uppercase">
            진행 중 · {running.length}
            <span className="ds-muted ds-tiny"> — 새로고침해도 계속돼요(앱을 닫으면 멈춤)</span>
          </div>
          {running.map((j) => (
            <div key={j.id} className="flex flex-wrap items-center gap-2 border-t border-line2 py-2">
              <span className="ds-spin" />
              <span className="max-w-jobtopic truncate text-md font-bold text-txt">{j.topic}</span>
              {j.scope && <span className="text-sm text-mut">{j.scope}</span>}
              <span className="ml-auto text-sm font-bold text-acc tabular-nums">
                <Elapsed startedAt={j.startedAt} />
              </span>
              {j.out && (
                <button type="button" className={JOB_BTN} onClick={() => setOpenJob(openJob === j.id ? null : j.id)}>
                  {openJob === j.id ? '출력 숨기기' : '출력 보기'}
                </button>
              )}
              <button
                type="button"
                className={JOB_BTN}
                onClick={() => cancel(j.id)}
                disabled={cancelling.has(j.id)}
                title="이 탐구 수집을 중단"
              >
                {cancelling.has(j.id) ? '중단 중' : '중단'}
              </button>
              {openJob === j.id && j.out && (
                <pre className="mt-2 max-h-70 basis-full overflow-auto font-mono text-sm leading-normal break-words whitespace-pre-wrap text-txt">
                  {j.out}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 최근 수집 기록 — 완료/실패 이력(localStorage, 서버 재시작에도 유지). */}
      <div className="mx-auto min-h-0 w-full max-w-runner flex-1">
        <div className="mb-2 text-xs font-extrabold tracking-caps text-mut uppercase">최근 수집 기록</div>
        {history.length ? (
          <div className="flex flex-col">
            {history.map((h) => (
              <div key={h.topic + h.at} className={RECITEM}>
                <span
                  className="h-2 w-2 flex-none rounded-full bg-acc shadow-dot data-[ok=0]:bg-bad data-[ok=0]:shadow-none"
                  data-ok={h.ok ? '1' : '0'}
                  aria-hidden="true"
                />
                <span className="max-w-rectopic truncate text-md font-bold text-txt">{h.topic}</span>
                <span className="flex-1 truncate text-sm text-mut tabular-nums">
                  {h.scope ? h.scope + ' · ' : ''}
                  {fmtWhen(h.at)}
                  {h.ok ? '' : ' · 실패'}
                  {h.durMs ? ' · ' + fmtDur(h.durMs) : ''}
                </span>
                <a
                  className="flex-none rounded-sm px-2 py-1 text-sm font-bold text-acc transition-colors hover:bg-acc-soft"
                  href={obsidianLink(h.topic)}
                  title="옵시디언 _탐구 폴더에서 이 주제 열기"
                >
                  옵시디언 ↗
                </a>
                <button
                  type="button"
                  className={JOB_BTN}
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
                  className="flex-none border-0! bg-transparent! px-2! py-1! text-lg! leading-none text-mut!"
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
