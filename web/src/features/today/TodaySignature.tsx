/* ============================================================
   TodaySignature — 오늘 탭 = 데모 v6 단일 화면 대시보드(에디토리얼 다크).
   프레임을 가득 채우는 4컬럼 그리드 [회전 스파인 | 스탯 | 발광 트랙 | 오늘의 블록] + 하단 스트립.
   진행률·연속·마감 리드아웃과 "지금 시작" 주 액션은 상단 바(usePageChrome)로 끌어올림.
   세부(블록 액션·일일 의식·흐름 가이드)는 onOpenMore 패널로 — 기본은 한 화면, 무스크롤.
============================================================ */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { ui } from '@/shell';
import { useApp } from '@/store/useApp';
import { useRuntime } from '@/store/useRuntime';
import { useUI } from '@/store/useUI';
import { useSchedule, selectTodayFocus } from '@/store/selectors';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { useFocus } from '@/store/useFocus';
import { usePrefill } from '@/store/prefill';
import { usePing, useKnowledge } from '@/store/queries';
import { studyStreak } from '@/lib/persistence';
import { focusMinutes } from '@/lib/focusState';
import { openBacklog, setRitual, CBMS_INFO } from '@/lib/methodology';
import { layoutDay, freeWindowsForWeekday, freeMinAfter } from '@/lib/scheduler';
import { dayPhase } from '@/lib/dayPhase';
import { deadlineDdays, indexDays } from '@/lib/scheduleView';
import { totalDue } from '@/lib/anki';
import { pickRetrieval, retrievableCount, pickConfidentWrong, confidentWrongCount } from '@/lib/retrieval';
import { frontierNext } from '@/lib/knowledge';
import { riskSummary } from '@/lib/spacedReview';
import { onThisDay } from '@/lib/records';
import { dayShape } from '@/lib/insights';
import type { AppState } from '@/lib/types';
import { ProgressRing } from '@/components/ProgressRing';
import { FlowRail, type FlowNode } from './FlowRail';
import { todayISO, parseISO, mondayOf, addDays, iso, ddayInfo, toHM, mmss, DOW_MON } from '@/lib/utils';
import { useCountUp, useHeroPointer, useAdaptiveTick } from '@/hooks/interactions';
// 'ds'는 이 파일서 날짜문자열 지역변수라 별칭 회피

const TYPE_LABEL: Record<string, string> = {
  new: '집중 학습',
  rev: '간격 복습',
  blank: '백지 복습',
  anki: 'Anki',
  mock: '모의시험',
};

/* ── C-7 이식(today) — Tailwind 클래스 SSOT ────────────────────────────────────────
   시그니처 히어로(과목색 --tint 베이크·포인터 스포트라이트·3D 틸트) + 통합 집중 CTA + now-중심
   발광 흐름 레일 + 하단 스트립. 색·그래디언트·발광·틸트는 tokens.css 에 이름 주고 bg-[var]·
   shadow-[var]·[transform:var] 로 참조(런타임 --tint/--mx/--my/--tiltX·Y 는 히어로 인라인 style 이
   얹는 사용 시점 해석). 상태 의존(노드 study/block/live/sel/done·CTA 변형)은 아래 map/inline 이
   정적 클래스맵으로 조립(동적 문자열 금지 · §15). ⚠ preflight 부재 → 전역 button/h2(unlayered)가
   유틸을 이기므로 다른 값만 `!`(§ global element rules). 내장 크기(text-xs/sm/base/lg)는 companion
   line-height 를 흘리므로 leading 명시(폼컨트롤/그 자손=normal · 일반 흐름=1.6 또는 원본값 · line-height 트랩).
   ds.ringSvg/Track/Arc 는 공용 스켈레톤이라 유지. `TodaySignature.module.css` 삭제. */
const S = {
  today: 'flex h-full min-w-0 min-h-0 flex-col gap-4 px-5 pt-4.5 pb-3.5 max-wide:px-3.5 max-wide:pt-3.5',
  top: 'grid min-h-0 flex-auto grid-cols-today-top gap-4 max-wide:grid-cols-1',
  hero: "tint-scope group relative isolate flex flex-col justify-center overflow-hidden rounded-lg border border-line bg-[image:var(--bg-hero-today)] px-hero-x-today py-hero-y-today shadow-hero transform-3d [transform:var(--tilt-today)] [transition:transform_0.25s_var(--ease),border-color_0.2s_var(--ease)] animate-[enter-fade_0.5s_var(--ease)_both] before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-[image:var(--bg-sig-top)] before:content-[''] hover:border-[color:var(--line-hero-hover)] motion-reduce:transform-none motion-reduce:animate-none",
  aura: 'pointer-events-none absolute bottom-[var(--aura-bottom)] left-[var(--aura-left)] z-[-1] h-[var(--aura-h)] w-9/10 bg-[image:var(--bg-aura-today)] [filter:var(--filter-aura)] animate-[today-aura-breathe_9s_var(--ease)_infinite] motion-reduce:animate-none',
  spotlight:
    'pointer-events-none absolute inset-0 z-[-1] bg-[image:var(--bg-spotlight-today)] opacity-0 transition-opacity duration-[0.35s] ease-[var(--ease)] group-hover:opacity-100 motion-reduce:transition-none',
  heroFill:
    'absolute bottom-0 left-0 z-[-1] h-0.75 bg-acc shadow-[var(--shadow-fill)] transition-[width] duration-1000 ease-linear motion-reduce:transition-none',
  heroHead: 'flex items-baseline justify-between gap-3',
  /* D-6 액센트 예산 — 아이브로는 **분류 라벨**이지 손봐야 할 것이 아니다. 액센트는 행동에만.
     (같은 화면에서 acc 표면이 20곳을 넘었고, 다 강조하면 아무것도 강조가 아니다 · DS §0-5.) */
  eyebrow:
    'inline-flex items-center gap-2 text-xs leading-[1.6] font-extrabold tracking-eyebrow-wide text-mut uppercase',
  live: 'size-1.75 rounded-full bg-acc shadow-load animate-[today-live-pulse_1.8s_var(--ease)_infinite] motion-reduce:animate-none',
  subj: 'mt-subj-top! mb-0! text-subj! max-wide:text-subj-mobile! font-black! leading-[0.94] tracking-subj! text-balance text-[color:var(--subj-col)]!',
  heroSub: 'mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1.5 text-lg leading-[1.5] text-mut',
  chapter: 'font-semibold text-txt',
  // D-5 선택 근거 — 액센트로 한 줄. 크기는 챕터 줄과 같되 무게로만 낮춘다(위계는 색·굵기로).
  // D-5 선택 근거 — 보조 설명이라 조용하게(D-6: 액센트는 행동 하나에만).
  why: 'text-md font-semibold text-mut',
  upnext: 'text-md text-mut',
  yesterday: 'mt-3 max-w-[var(--yesterday-max)] text-hint leading-[1.5] text-mut',
  momentum: 'inline-flex flex-wrap items-center gap-x-3.5 gap-y-2',
  mChip:
    'inline-flex items-center rounded-full! border-0! bg-[var(--tint-acc-12)]! px-2.75! py-1! text-sm! leading-[normal] font-extrabold! text-acc! shadow-[var(--shadow-inset-acc-glow)] hover:shadow-[var(--shadow-inset-acc-solid)]',
  actions: 'mt-actions-top flex items-center gap-4',
  cta: 'relative inline-flex cursor-pointer items-baseline gap-2.5 overflow-hidden rounded-base! border-0! px-6.5! py-3.75! font-extrabold! tracking-cta after:pointer-events-none after:absolute after:inset-0 after:bg-[image:var(--bg-cta-shimmer)] after:[transform:var(--cta-shim-off)] after:transition-transform after:duration-[0.6s] after:ease-[var(--ease)] hover:after:[transform:var(--cta-shim-on)] focus-visible:[outline-offset:var(--cta-outline-offset)]! motion-reduce:after:transition-none',
  ctaFill:
    'bg-[image:var(--acc-fill)]! text-on-acc! shadow-[var(--shadow-cta)] hover:-translate-y-px hover:brightness-[1.07] hover:shadow-[var(--shadow-cta-hover)]',
  ctaRun:
    'bg-[var(--bg-cta-run)]! text-acc! shadow-[var(--shadow-inset-acc-glow)] hover:shadow-[var(--shadow-inset-acc-solid)]',
  ctaGhost:
    'bg-transparent! text-txt! shadow-[var(--shadow-inset-line)] hover:shadow-[var(--shadow-inset-line-acc-hover)]',
  ctaGo: 'relative z-[1] text-base leading-[normal]',
  ctaCap: 'relative z-[1] text-sm leading-[normal] font-bold opacity-72',
  ctaNum: 'relative z-[1] text-cta-num font-extrabold tracking-label tabular-nums',
  clock: 'text-base14 font-bold tracking-tag text-mut tabular-nums',
  presets: 'inline-flex gap-1.5',
  preset:
    'rounded-md! border-0! bg-transparent! px-3! py-2.25! text-mut! font-extrabold! tabular-nums shadow-[var(--shadow-inset-line)] hover:shadow-[var(--shadow-inset-line-acc-pill)]',
  flow: 'flex min-h-0 flex-col rounded-lg border border-line bg-[image:var(--bg-flow-today)] px-4.5 pt-4.5 pb-3 shadow-card animate-[today-hero-in_0.5s_var(--ease)_0.08s_both] hover:border-[color:var(--line-flow-hover)] motion-reduce:animate-none',
  flowHead: 'mb-2.5! flex! items-center gap-3',
  ring: 'relative inline-block size-8.5 flex-none [--ring-w:6]',
  ringNum:
    'absolute inset-0 flex items-center justify-center text-lg leading-[1.6] font-extrabold tracking-ringnum text-txt',
  ringNumSmall: 'text-tiny9 font-bold text-mut',
  flowT: 'flex-1 text-xs leading-[1.6] font-extrabold tracking-caps text-mut uppercase',
  // D-6 — '● 09:00 LIVE'는 시계다(내가 손볼 것이 아니다). 살아 있다는 신호는 점 하나로 충분.
  now: 'text-sm leading-[1.6] font-extrabold text-mut tabular-nums',
  rail: 'min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]',
  railEmpty: 'px-1 py-3.5 text-hint leading-[1.6] text-mut',
  recall: 'mt-2.5 flex-none rounded-base border border-line2 px-3.5 py-3 animate-[enter-fade_0.4s_var(--ease)_both]',
  recallTop: 'mb-1.5 flex items-baseline gap-2',
  recallTag: 'flex-none text-2xs font-extrabold tracking-skel uppercase',
  recallMeta: 'truncate text-xs leading-[1.6] font-bold text-mut',
  recallQ: 'text-recall-q leading-[1.45] font-bold text-txt',
  recallBtn:
    'mt-2.5 w-full rounded-blk! border-0! bg-[var(--acc-soft)]! px-3! py-2! text-hint! font-extrabold! text-acc! shadow-[var(--shadow-inset-acc-glow)] hover:shadow-[var(--shadow-inset-acc-solid)]',
  recallA: 'mt-2 flex flex-col gap-1.25 text-hint leading-[1.5] text-mut animate-[enter-fade_0.3s_var(--ease)_both]',
  recallReset:
    'mt-0.5 self-start border-0! bg-transparent! p-0! text-xs! leading-[normal] font-bold! text-mut! underline',
  confWrongNote: 'mt-1.5 text-sm leading-[1.5] text-mut',
  more: 'mt-3 border-x-0! border-b-0! rounded-none! border-line2! bg-transparent! pt-3.5! text-left text-sm! leading-[normal] font-bold! text-mut!',
  strip: 'flex flex-none items-center gap-10 px-1 pt-1 pb-0.5 max-wide:flex-wrap max-wide:gap-x-7 max-wide:gap-y-3.5',
  grp: 'flex flex-wrap items-center gap-3',
  grpL: 'text-2xs font-bold tracking-caps text-mut uppercase',
  tag: 'inline-flex cursor-pointer items-center gap-1.5 border-0! bg-transparent! p-0! font-extrabold!',
  tagMut: 'inline-flex cursor-default items-center gap-1.5 text-md font-semibold text-mut',
  dot: 'size-1.75 flex-none rounded-full',
  vline: 'h-6.5 w-px flex-none bg-line2',
  /* UX-1 하단 스트립 액센트 위계 — 다섯 그룹의 숫자가 **전부** `text-acc` 볼드라 위계가 0이었다
     (DS §0-5: 다 강조하면 아무것도 강조가 아니다). 액센트를 "지금 손봐야 할 것"에만 예약한다:
     임박 마감 · 밀린 Anki · 열린 보충. 나머지(이번 주 누적 시간 · 의식 체크)는 *상태 보고*라
     `txt` 로 내린다 — 굵기는 그대로라 여전히 읽히고, 색만 조용해진다.
     ⚠ 임계는 보수적으로. 요일마다 색이 튀면 "액센트가 의미를 갖는다"는 신호 자체가 흔들린다
       → 0/미연결은 무조건 cool, 양수일 때만 hot. 새 요소는 0개(조건은 이미 계산돼 있었다). */
  hot: 'text-acc',
  cool: 'text-txt',
} as const;

/** UX-1 액센트 게이트 — hot 이면 액센트, 아니면 조용한 상태 보고색.
 *  ⚠ 판정을 컴포넌트 **밖**에 두는 건 취향이 아니라 래칫이 실제로 걸린 결과다: 조건을 JSX 안에
 *    흩었더니 이 컴포넌트의 인지복잡도가 77→80 이 되어 `sonarjs/cognitive-complexity` 가 막았다.
 *    이름 붙은 술어로 밖에 내면 복잡도도 내려가고 "왜 이것만 강조인가"도 JSX 밖에서 읽힌다. */
const tone = (hot: boolean): string => (hot ? S.hot : S.cool);
/** Anki 는 **미연결(null)이 hot 이 아니다** — 설정 문제라 매일 뜨고, 매일 뜨는 액센트는 소음이 된다. */
const ankiTone = (due: number | null | undefined): string => tone(due != null && due > 0);

/* ── N-5 마감 국면의 두 조각 ────────────────────────────────────────────────
   본문에서 떼어 낸 것은 스타일이 아니라 **분기**다 — `TodaySignature` 는 이미 인지복잡도
   래칫(77) 바로 아래에 있어서, 조건부 JSX 를 그 안에 더 쌓으면 게이트가 막는다. 래칫이
   "더 나빠지지 않는다"만 보장한다는 뜻이 정확히 이것이다: 새 분기는 새 이름을 갖는다. */

/** '오늘의 모양'(ID-5) 한 줄 — 닫을 때가 아니거나 잴 것이 없으면 아무것도 안 그린다.
 *  ⚠ `when` 을 **인자로 받아 자기가 판정한다**: 호출부에서 `closing && …` 로 감싸면 그 분기가
 *  본문의 복잡도로 잡히고, 이 파일은 래칫 바로 아래에 있다. 계산도 여기서 해야 안 그릴 때
 *  안 돈다(호출부가 삼항으로 넘기면 그 삼항이 또 한 분기다). */
function ShapeLine({ state, ds, when }: { state: AppState; ds: string; when: boolean }) {
  if (!when) return null;
  const shape = dayShape(state, ds);
  if (shape.sessions === 0 && !shape.learned) return null;
  return (
    <div className={S.yesterday}>
      <span aria-hidden="true">🌙</span> 오늘의 모양 — {shape.subjects}과목 · {shape.sessions}세션 · {shape.focusMin}분
      {shape.learned && (
        <>
          {' '}
          · <b className="font-bold text-[color:var(--yesterday-b)]">{shape.learned}</b>
        </>
      )}
    </div>
  );
}

/** 포모도로 프리셋(25·50분).
 *
 *  ⚠ N-5 — 닫을 때가 되면 **사라진다**. 남은 창이 가장 짧은 블록도 못 담는 시점에 25·50분을
 *  권하는 것은 있지도 않은 시간을 제안하는 것이다. 부수 효과로 버튼 셋이 한 줄에 몰려 글자가
 *  두 줄로 접히던 것도 함께 풀린다 — 실렌더 확인이 그걸 잡았다(§15-4).
 *  ⚠ `hidden` 속성으로는 안 된다: `inline-flex` 유틸이 display 를 세워 이긴다(실측). */
function Presets({ focusMin, onPick, when }: { focusMin: number; onPick: (m: number) => void; when: boolean }) {
  if (!when) return null;
  return (
    <span className={S.presets}>
      {[25, 50]
        .filter((m) => m !== focusMin)
        .map((m) => (
          <button key={m} type="button" className={S.preset} onClick={() => onPick(m)} aria-label={`${m}분 집중 시작`}>
            {m}′
          </button>
        ))}
    </span>
  );
}

/** 하루를 닫는 길 — 의식 카드로 열고 '내일 한 줄'에 커서까지 놓는다(`Today.tsx` 가 그 포커스를 소유). */
function CloseDayCta({
  onOpenMore,
  cap,
  when = true,
}: {
  onOpenMore: (focus?: 'ritual') => void;
  cap: string;
  when?: boolean;
}) {
  if (!when) return null;
  return (
    <button type="button" className={`${S.cta} ${S.ctaGhost}`} onClick={() => onOpenMore('ritual')}>
      <span className={S.ctaGo}>🌙 하루 닫기</span>
      <span className={S.ctaCap}>{cap}</span>
    </button>
  );
}

export function TodaySignature({ onOpenMore }: { onOpenMore: (focus?: 'ritual') => void }) {
  const state = useApp((s) => s.state);
  const ankiLive = useRuntime((s) => s.cache._ankiLive);
  const res = useSchedule();
  const toggleDone = useApp((s) => s.toggleDone);
  const mutate = useApp((s) => s.mutate);
  const navigate = useNavigate();
  const go = (to: string) => navigate(to, { viewTransition: true });
  const setSchedView = useUI((st) => st.setSchedView);
  // "오늘 계획 짜기" — 목적지를 **결정론적으로** 고정한다. 예전엔 `/plan-host`로만 보내 캘린더의
  // 영속 뷰(schedView·기본 week)에 그대로 떨어졌다 → '오늘'을 요청했는데 주 격자(혹은 지난번 아무 뷰)가
  // 열려 첫 화면이 매번 달랐다(재설계 사상 "0.5초에 요지" 위반).
  // 탭 경계를 넘는 드릴다운 규약(v4)을 그대로 따른다: 날짜는 딥링크(?ds=), **뷰 전환은 보내는 쪽에서 먼저**
  // — 받는 쪽 effect에서 setState로 되받으면 캐스케이드 렌더가 된다(린트가 막는 패턴 · Alloc.onOpenDay와 동형).
  // 일반 진입(나브 '계획'·⌘K·g p)은 여전히 영속 뷰를 존중한다(v4 "기본 착지=캘린더 주 뷰") — 결정론은
  // 의도가 '오늘'로 명시된 이 경로에만 건다.
  const goPlanToday = () => {
    setSchedView('day');
    go(`/schedule?ds=${todayISO(state)}`); // '오늘'은 앱 단일 출처(_today 시드 존중) — new Date() 금지
  };
  const [recallShown, setRecallShown] = useState(false); // A2 — 회상 정답 공개 여부

  // 히어로 포인터 추적 — 스포트라이트(--mx/--my) + 3D 틸트(--tiltX/Y). 정본 훅(interactions) 공유.
  const { ref: heroRef, onMouseMove: onHeroMove, onMouseLeave: onHeroLeave } = useHeroPointer(7);

  // 집중 타이머(포모도로) — 전역 세션(useFocus): 탭 이동·새로고침에도 이어짐. 종료 감지는 FocusChip.
  const timer = useFocus((st) => st.session);
  const startSession = useFocus((st) => st.start);
  const stopSession = useFocus((st) => st.stop);

  // 적응형 틱 — 초 단위 표시는 포모도로(mmss)뿐이므로 세션 중에만 1초, 평시엔 30초(FocusChip과 동일 패턴).
  // 무조건 1초는 방치된 대시보드를 초당 리렌더하는 60배 과잉이었다. 백그라운드 정지·복귀 캐치업은 훅이 소유.
  useAdaptiveTick(timer ? 1000 : 30_000);

  const ds = todayISO(state);
  const today = parseISO(ds);
  // 날짜→Day 인덱스 1회 생성(선형 find 제거) — Schedule과 동일 패턴, O(1) 조회.
  const byDs = indexDays(res);

  const todayDay = byDs[ds];
  const items = todayDay?.items || [];
  const L = items.length ? layoutDay(state, todayDay!) : null;

  const nowDate = new Date();
  const nowMin = nowDate.getHours() * 60 + nowDate.getMinutes();
  const nowMs = nowDate.getTime();
  /* ⚠ '지금 할 일'의 답은 **`selectTodayFocus` 하나**에서 온다(H4 · 2026-07-26 감사).
     D-5 가 "초점은 한 함수가 고른다"로 통일했는데 **호출부 하나가 남아** 절반만 통일됐었다:
     `useFocus.startOnCurrent` 가 `stat`·`today` 를 안 넘겨(기본값 `[]`·`''`) 급함 계산이 죽었고,
     그래서 히어로는 "마감 임박 블록", ⌘K·FocusChip 의 집중 시작은 "가장 큰 블록"을 가리켰다.
     재료 조립을 셀렉터에 두면 **인자 선택권이 호출부에서 사라져** 같은 일이 재발할 수 없다. */
  const { entries: enriched, current, focus, reason: focusReason } = selectTodayFocus(state, nowMin);
  const todayDone = enriched.filter((e) => e.done).length;
  const todayTotal = items.length;
  const pct = todayTotal ? Math.round((todayDone / todayTotal) * 100) : 0;

  const startKey = (e: (typeof enriched)[number]) => e.start ?? 9999;
  const pending = enriched.filter((e) => !e.done);
  const allDone = todayTotal > 0 && pending.length === 0;

  const after = focus?.end ?? nowMin;
  const upNext =
    pending.filter((e) => e !== focus && startKey(e) >= after).sort((a, b) => startKey(a) - startKey(b))[0] ||
    pending.filter((e) => e !== focus).sort((a, b) => startKey(a) - startKey(b))[0] ||
    null;

  const mon = mondayOf(today);
  const weekData = DOW_MON.map((lab, i) => {
    const date = addDays(mon, i);
    const k = iso(date);
    const day = byDs[k];
    const min = (day?.items || []).reduce((t, it) => t + (it.min || 0), 0);
    return { lab, h: min / 60, today: k === ds };
  });
  const weekTotalH = weekData.reduce((t, d) => t + d.h, 0);
  const weekShown = useCountUp(weekTotalH);

  const streak = studyStreak(state);
  const due = ankiLive?.decks ? totalDue(ankiLive.decks) : null;
  const openBl = openBacklog(state).length;
  // 셋업은 됐지만(과목 있음) 오늘 배치가 0인 경우를 콜드스타트와 구분 — 빈 메시지가 이미 설정한 사용자에게
  // 또 "설정하라"고 말하지 않도록. 마감 지남·가용시간 없음 등이면 스케줄로 안내.
  const hasItems = state.items.some((it) => it.name);

  // A1 — 어제 셧다운에서 남긴 '내일 한 줄'을 오늘 아침 다시 보여줌(셧다운→모닝 루프 닫기).
  const prevNote = (state.rituals?.[iso(addDays(today, -1))]?.note || '').trim();
  // ID-4 — On This Day: 달력상 같은 날(−4주·−1년)의 과거 실기록 한 줄(있을 때만·이력 30일+ 게이트).
  const onThis = onThisDay(state, ds)[0];
  // A3 — 오늘 '일과 블록·이미 배치된 학습 뺀' 남은 가용시간(now 이후) — 워터마크를 정보성으로.
  // 배치된 날이면 layoutDay의 잔여 free(학습 세션·일과 차감 + 당일 오버라이드 캡 반영)를 쓰고,
  // 빈 날(L 없음)이면 순수 루틴 창으로 폴백. now 이후로 클램프해 빡빡한 날 과대표시를 막는다.
  const freeIntervals: [number, number][] = L
    ? L.free
    : freeWindowsForWeekday(state, today.getDay()).windows.map((w) => [w.s, w.e] as [number, number]);
  const freeLeftMin = freeMinAfter(freeIntervals, nowMin);
  const freeLeftH = Math.round((freeLeftMin / 60) * 10) / 10;
  // A2 — 회상 카드(내 과거 요약을 인출 연습으로). 후보 없으면 null.
  const recall = pickRetrieval(state, ds);
  const recallN = recall ? retrievableCount(state, ds) : 0; // '회상 N개 대기' — 실제 대기 수량
  // 회상 카드가 바뀌면(새 날짜·다른 요약) 정답 공개를 초기화 — 다음 카드가 답이 열린 채 뜨는 인출연습 무력화 방지.
  // effect 대신 렌더 중 조건부 setState(React 권장 · 이 코드베이스의 draftFor 관용과 동일).
  const recallKey = recall ? `${ds}|${recall.summary.name || ''}` : '';
  const [recallKeyShown, setRecallKeyShown] = useState(recallKey);
  if (recallKey !== recallKeyShown) {
    setRecallKeyShown(recallKey);
    setRecallShown(false);
  }
  // A4 — 완료 후 다음 동력: 내일 첫 학습 + 복습 위험(개념 간격반복).
  const tmrNew = byDs[iso(addDays(today, 1))]?.items.find((it) => it.type === 'new');
  const risk = riskSummary(state, res.days || [], ds);
  const riskN = risk.overdue + risk.due;
  // I-8 — 프런티어 다음 추천(지식엔진 frontier). 백엔드 사용 가능 시에만 페치(mastery와 KNOWLEDGE_KEY 캐시 공유,
  // 신규 IO 최소). 후보 없거나 미연결이면 frontier=null → 렌더 안 함.
  const ping = usePing();
  const know = useKnowledge(ping.isSuccess).data;
  const frontier = frontierNext(know);
  const frontierTitle = frontier?.title || frontier?.basename || '';
  // I-10 — 착각 재확인 카드: conf('확신했지만 틀림') 선 과거 오답 1건(날짜 해시로 하루 회전). 후보 없으면 null.
  const confWrong = pickConfidentWrong(state, ds);
  const confWrongN = confWrong ? confidentWrongCount(state, ds) : 0;

  // 마감 임박(스트립) + 가장 가까운 마감(상단 리드아웃). 파생 로직은 lib/scheduleView.deadlineDdays로 위임.
  const ddays = deadlineDdays(res.itemStat, ds);
  const soon = ddays.filter((st) => st.dday <= 14).slice(0, 3); // 14=D-day 임박 임계 · 3=스트립 최대 표시
  const nearestDday = ddays.length ? ddays[0]!.dday : null;

  // 오늘의 흐름 노드 — 학습(체크 가능)+일과 블록을 시간순 단일 리스트로(무지개 가로 트랙 폐기).
  const tl = L?.tl || [];
  type EnrichedItem = (typeof enriched)[number];
  const flowNodes: FlowNode<EnrichedItem>[] = [
    ...enriched
      .filter((e) => e.start != null)
      .map((e): FlowNode<EnrichedItem> => ({
        key: 'study|' + e.it.sid + '|' + e.it.type,
        kind: 'study',
        start: e.start as number,
        end: e.end,
        name: e.it.name,
        sub: e.it.chapters?.length ? e.it.chapters.join(', ') : TYPE_LABEL[e.it.type] || '학습',
        color: e.it.color,
        done: e.done,
        e,
      })),
    ...tl
      .filter((t) => t.kind === 'block' && t.start != null)
      .map((t, i): FlowNode<EnrichedItem> => ({
        key: 'block|' + i + '|' + String(t.start),
        kind: 'block',
        start: t.start as number,
        end: (t.end ?? null) as number | null,
        name: t.name || '블록',
        sub: t.btype && t.btype !== t.name ? t.btype : '일과',
        color: t.color,
        done: false,
        e: null,
      })),
  ].sort((a, b) => a.start - b.start);

  // I-4 — 흐름 레일의 선택·키보드(j/k/Enter/s)·DOM refs 는 `FlowRail` 이 소유한다(재설계 · 책임 이전).
  // 여기선 노드가 요구하는 세 동작을 **불투명 콜백**으로만 준다(FlowRail 은 enriched 형태·store 를 모른다).
  const startNodeFocus = (e: EnrichedItem): void => {
    startSession({ ds, sid: e.it.sid, type: e.it.type, name: e.it.name, min: focusMinutes(e), blockMin: e.it.min });
  };
  const prefillNode = (e: EnrichedItem): void => {
    usePrefill.getState().request('sum', e.it.sid, ds);
    ui.toast(`${e.it.name} — 기록 프리필됨 ✍`, 'info');
  };

  /* ── N-5 하루의 국면 ────────────────────────────────────────────────
     판정은 순수 함수가 `layoutDay` 산출물에서만 뽑는다(임의 시각 상수 없음 — 근거는
     `lib/dayPhase.ts` 머리주석). 여기서 시각으로 다시 나누기 시작하면 밤샘하는 날에
     화면이 틀린 질문을 크게 던진다. */
  const phase = dayPhase({
    todayTotal,
    pending: pending.length,
    freeLeftMin,
    // 남은 것 중 가장 짧은 블록 — "자리에 들어가는가"의 기준(dayPhase 머리주석).
    shortestPendingMin: pending.reduce((m, e) => Math.min(m, e.it.min || 0), Number.POSITIVE_INFINITY),
  });
  const closing = phase === 'closing';

  const kicker = todayTotal === 0 ? '오늘 할 일' : allDone ? '오늘 학습' : current ? '지금 할 일' : '다음 할 일';
  const focusMin = focusMinutes(focus);
  const focusType = focus ? TYPE_LABEL[focus.it.type] || '학습' : '';
  const focusChapterName = focus?.it.chapters?.length ? focus.it.chapters.join(', ') : '';
  /* ── D-5 히어로의 주어를 행동으로 ──────────────────────────────────────
     72px 자리에 **과목명**이 있었다 — 내가 이미 아는 것이다. 정작 무엇을 하는지(챕터·유형)는
     18px 였고 "왜 이것인가"는 화면 어디에도 없었다. 큰 자리를 행동에 준다.
     ⚠ 챕터가 없는 블록(Anki·모의 등)이면 큰 자리는 과목명으로 폴백한다 — 그때는 그것이
       유일하게 구체적인 이름이고, 유형은 바로 아래 줄이 말한다. */
  const heroMain = allDone ? '완료' : focus ? focusChapterName || focus.it.name : todayTotal === 0 ? '비어 있음' : '—';
  // 큰 자리에 챕터가 섰으면 아래 줄은 과목 · 유형, 아니면 유형만(같은 말을 두 번 하지 않는다).
  const heroSub = focus ? (focusChapterName ? `${focus.it.name} · ${focusType}` : focusType) : '—';

  const dispColor = !allDone && focus ? focus.it.color : undefined;

  // PL-19 — 오늘 일일 의식 상태(아침 계획·셧다운) 리드아웃용. 세부 입력은 온디맨드 RitualCard 소유.
  const ritual = state.rituals?.[ds];

  // 집중 타이머(포모도로) — 남은 초·진행%·MM:SS(1초 틱으로 갱신). 종료 알림·완료 연결은 FocusChip이.
  const timerLeft = timer ? Math.max(0, Math.round((timer.endsAt - nowMs) / 1000)) : 0;
  const timerPct = timer && timer.total ? Math.min(100, ((timer.total - timerLeft) / timer.total) * 100) : 0;
  const timerLabel = mmss(timerLeft);
  // 포모도로 프리셋 — 기본은 블록 파생(focusMinutes), 25/50은 명시 선택.
  const startTimer = (min?: number) => {
    if (!focus) return;
    startSession({
      ds,
      sid: focus.it.sid,
      type: focus.it.type,
      name: focus.it.name,
      min: min ?? focusMinutes(focus),
      blockMin: focus.it.min,
    });
  };
  // 조기중단 confirm — 진행 중 세션이 실수 클릭으로 날아가는 것 방지(휴식은 즉시 중단).
  const stopTimer = async () => {
    if (timer?.kind === 'break') return stopSession();
    if (
      await ui.confirm('집중 세션을 중단할까요? 진행 시간은 기록되지 않아요.', {
        title: '집중 중단',
        okLabel: '중단',
        danger: true,
      })
    )
      stopSession();
  };

  // 전부 완료 순간 셀레브레이션(한 번만).
  const wasDone = useRef(false);
  const [celebrate, setCelebrate] = useState(false);
  useEffect(() => {
    if (allDone && !wasDone.current) {
      wasDone.current = true;
      setCelebrate(true);
      ui.toast('오늘 블록 완료! 🎉', 'info');
      const id = setTimeout(() => setCelebrate(false), 1400);
      return () => clearTimeout(id);
    }
    if (!allDone) wasDone.current = false;
  }, [allDone]);

  // PL-9 — streak 마일스톤 최초 돌파 축하(임계별 1회). 영속 마커 _lastStreakCele로 재로드 재발화 방지.
  useEffect(() => {
    const MILE = [7, 14, 30, 50, 100];
    const last = state._lastStreakCele ?? 0;
    const hit = MILE.filter((m) => streak >= m && last < m);
    if (hit.length) {
      const top = Math.max(...hit);
      ui.toast(`🔥 ${top}일 연속 — 불씨 살아있어요`, 'info');
      mutate((st) => {
        st._lastStreakCele = top;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streak]);

  // 진행률·연속·마감 + 주 액션을 상단 바로 끌어올림(데모 v6 헤더).
  usePageChromeEffect(
    () => ({
      readouts: [
        { label: '진행률', value: todayTotal ? `${pct}%` : '—', accent: true },
        {
          label: '연속',
          // PL-9: streak≥2면 🔥 프리픽스(Stats 탭 prefix="🔥 "와 통일 — 불씨 살아있음 시각화).
          value: (
            <>
              {streak >= 2 && '🔥 '}
              {streak}
              <small className="text-base14 font-bold text-mut"> 일</small>
            </>
          ),
        },
        {
          label: '마감',
          // E-2: D-day만이 아니라 '어느 과목을 우선할지' 이름까지 리드아웃(가장 가까운 마감).
          value: nearestDday == null ? '—' : `D-${nearestDday}${ddays[0]?.name ? ` · ${ddays[0]!.name}` : ''}`,
        },
        /* D-5 — 히어로의 132px 워터마크에 있던 값. 거기선 `aria-hidden` 장식이라 SR 에 아예
           없었고, 크기가 화면 최대라 위계를 거꾸로 세웠다. 여기선 다른 리드아웃과 같은 무게다. */
        {
          label: '남은 가용',
          value: (
            <>
              {freeLeftH}
              <small className="text-base14 font-bold text-mut"> h</small>
            </>
          ),
        },
        // PL-5: 적응형 용량이 적용된 날만(최근 이행률 저조 → 오늘 가용 축소) 감축률을 노출 — 비가시 해소.
        ...(res.adaptApplied ? [{ label: '용량', value: `−${Math.round((1 - (res.adapt ?? 1)) * 100)}%` }] : []),
      ],
      action:
        todayTotal === 0
          ? // PL-1: 이미 과목이 있는 사용자(hasItems)에게 "항목 설정"은 모순 — 오늘만 빈 것이므로 스케줄로 안내.
            hasItems
            ? { label: '오늘 계획 짜기 →', onClick: goPlanToday }
            : { label: '학습 항목 설정 →', onClick: () => go('/items') }
          : allDone
            ? { label: '기록 보기', onClick: () => go('/journal') }
            : /* ⚠ D-6 — 여기 '지금 시작 →' 네온 버튼이 있었다. 히어로의 '▶ 집중 시작'과 **거의 같은
                 동작**을 하면서 화면 대각선 반대쪽에 앉아, 한 화면에 채움 버튼이 둘이었다.
                 액센트 예산은 채움 1개다 → 오늘 탭에서 상단 액션을 비운다(진행 중 세부 패널은
                 흐름 카드의 '+ 블록 상세…'가 연다). 빈 날·완주 화면의 액션은 히어로에 짝이 없어
                 남긴다 — 중복이 아니라 그 화면의 **유일한** 다음 걸음이다. */
              undefined,
    }),
    [pct, streak, nearestDday, freeLeftH, todayTotal, allDone, hasItems, res.adaptApplied, res.adapt],
  );

  const toggle = (e: (typeof enriched)[number]) => toggleDone(ds, e.it.sid, e.it.type, e.it.min, !e.done);

  return (
    <section className={S.today} aria-label="오늘 대시보드">
      {/* ── 상단 밴드: 포커스 히어로 | 오늘의 블록 ── */}
      <div className={S.top}>
        {/* HERO — 거대 과목명 = 행동의 무대. 과목색 오로라 + 통합 집중 시작. */}
        <div
          ref={heroRef}
          onMouseMove={onHeroMove}
          onMouseLeave={onHeroLeave}
          className={S.hero}
          style={dispColor ? ({ '--tint': dispColor } as CSSProperties) : undefined}
        >
          {/* heroDone 오로라 — allDone 이면 --tint 미주입이라 acc 로 폴백. 원본 .heroDone .aura 의
              opacity 0.6(모션 자제 시에만 노출)만 재현. 애니 켜지면 auraBreathe 가 opacity 를 덮는다. */}
          <div className={`${S.aura} ${allDone ? 'opacity-60' : 'opacity-55'}`} aria-hidden="true" />
          <div className={S.spotlight} aria-hidden="true" />
          {timer && <div className={S.heroFill} style={{ width: `${timerPct}%` }} aria-hidden="true" />}
          {/* ⚠ D-5 — 132px '남은 N h' 워터마크가 여기 있었다. `aria-hidden` **장식이 화면 최대
              활자**인 상태였고(SR 에는 애초에 없던 정보다), 그 옆의 72px 은 과목명이었다.
              값은 버리지 않고 상단 리드아웃('남은 가용')으로 내렸다 — 거기선 SR 도 읽는다.
              우상단 시각도 뺐다: 같은 값을 아래 근거 한 줄과 흐름 레일이 이미 말한다. */}
          <div className={S.heroHead}>
            <span className={S.eyebrow}>
              {current && <i className={S.live} />}
              {kicker}
            </span>
          </div>

          <h2 className={S.subj}>{heroMain}</h2>
          <div className={S.heroSub}>
            {todayTotal === 0 ? (
              hasItems ? (
                // §7: 히어로 중복 CTA(.mChip) 제거 — 안내 텍스트만. '오늘 계획 짜기'는 아래 큰 버튼 단일.
                <span>오늘은 배치된 블록이 없어요</span>
              ) : (
                '학습 항목을 추가하면 오늘의 흐름이 그려져요.'
              )
            ) : allDone ? (
              // A4 — 완료 후 죽은 화면 대신 '다음 동력'(내일·복습 위험·보충 회수·회상).
              <span className={S.momentum}>
                {tmrNew ? (
                  <span className={S.chapter}>내일 · {tmrNew.name}</span>
                ) : (
                  <span>내일 일정은 아직 비어 있어요</span>
                )}
                {/* I-8 — 지식엔진 프런티어: '이걸 배우면 N개가 풀린다' 최대 개념 경량 추천(→ 숙달도). */}
                {frontierTitle && (
                  <button
                    type="button"
                    className={S.mChip}
                    onClick={() => go('/mastery')}
                    aria-label={`다음 추천 개념 ${frontierTitle} — 숙달도로 이동`}
                  >
                    다음에 이거 · {frontierTitle}
                  </button>
                )}
                {riskN > 0 && (
                  <button type="button" className={S.mChip} onClick={() => go('/review')}>
                    복습 위험 {riskN}
                  </button>
                )}
                {openBl > 0 && (
                  <button type="button" className={S.mChip} onClick={() => go('/journal')}>
                    보충 {openBl} 회수
                  </button>
                )}
                {recall && <span className={S.upnext}>회상 {recallN}개 대기 ↓</span>}
              </span>
            ) : (
              <>
                <span className={S.chapter}>{heroSub}</span>
                {/* D-5 — "왜 이것인가". 고르는 함수가 이유까지 돌려주므로 화면과 규칙이 갈릴 수 없다. */}
                {focusReason && <span className={S.why}>{focusReason}</span>}
                {upNext && (
                  <span className={S.upnext}>
                    다음 · {upNext.it.name}
                    {upNext.start != null ? ` ${toHM(upNext.start)}` : ''}
                  </span>
                )}
              </>
            )}
          </div>
          {/* A1 — 어제 남긴 '내일 한 줄'(아직 오늘 진행 중일 때만; 완료 화면은 동력에 집중). */}
          {prevNote && !allDone && (
            <div className={S.yesterday}>
              <span aria-hidden="true">🌙</span> 어제 남긴 한 줄 —{' '}
              <b className="font-bold text-[color:var(--yesterday-b)]">{prevNote}</b>
            </div>
          )}
          <ShapeLine state={state} ds={ds} when={closing} />
          {/* ID-4 — On This Day 회고: 달력상 같은 날의 과거 실기록 한 줄(회상 카드와 달리 달력 정합). */}
          {onThis && (
            <div className={S.yesterday}>
              <span aria-hidden="true">📅</span> {onThis.offsetLabel} —{' '}
              {onThis.subject && <b className="font-bold text-[color:var(--yesterday-b)]">{onThis.subject}</b>}{' '}
              {onThis.detail}
            </div>
          )}

          {/* 주 액션 — 집중 타이머(포모도로). 히어로 안에 통합 = 가장 큰 요소가 곧 행동. */}
          <div className={S.actions}>
            {timer ? (
              <button
                type="button"
                className={`${S.cta} ${S.ctaRun}`}
                onClick={() => void stopTimer()}
                aria-label={timer.kind === 'break' ? '휴식 타이머 정지' : '집중 타이머 정지'}
              >
                <span className={S.ctaNum}>{timerLabel}</span>
                <span className={S.ctaCap}>{timer.kind === 'break' ? '☕ 휴식 · ■ 정지' : '■ 정지'}</span>
              </button>
            ) : allDone ? (
              /* N-5 — 다 한 날의 다음 걸음은 '기록 보기'가 아니라 **하루를 닫는 것**이다.
                 종전엔 그 행위가 ＋블록 상세 → 오버레이 → 스크롤 뒤에 있었다. */
              <CloseDayCta onOpenMore={onOpenMore} cap="내일 한 줄 →" />
            ) : focus ? (
              <>
                <button
                  type="button"
                  className={`${S.cta} ${S.ctaFill}`}
                  onClick={() => startTimer()}
                  aria-label="집중 타이머 시작"
                >
                  <span className={S.ctaGo}>▶ 집중 시작</span>
                  <span className={S.ctaCap}>{focusMin}분</span>
                </button>
                {/* N-5 — 못 한 채로 끝나는 날. 남은 창이 0인데도 화면은 계속 "집중 시작"만
                    크게 띄우며 있지도 않은 시간을 쓰라고 했다. 시작을 **지우지는 않는다**
                    (밤샘은 사용자의 선택이다) — 닫는 길을 옆에 낼 뿐이고, 그래서 채움 버튼은
                    여전히 하나다(D-6 액센트 예산). */}
                <Presets focusMin={focusMin} onPick={startTimer} when={!closing} />
              </>
            ) : hasItems ? (
              // §7: 과목은 있으나 오늘 포커스가 없음 → 오늘 계획을 직접 짜는 단일 목적지(계획 › 캘린더 일 뷰).
              <button type="button" className={`${S.cta} ${S.ctaFill}`} onClick={goPlanToday}>
                <span className={S.ctaGo}>오늘 계획 짜기</span>
                <span className={S.ctaCap}>캘린더 · 오늘 →</span>
              </button>
            ) : (
              <button type="button" className={`${S.cta} ${S.ctaFill}`} onClick={() => go('/items')}>
                <span className={S.ctaGo}>＋ 학습 항목 추가</span>
                <span className={S.ctaCap}>시작하기 →</span>
              </button>
            )}
            {/* N-5 — 닫는 길은 **어느 분기에도** 있다. 처음엔 `focus` 분기 안에 뒀는데, 늦은
                시각엔 화면이 다른 분기를 타서(포커스가 없다) 정작 필요한 순간에 안 보였다 —
                실렌더 확인이 그걸 잡았다(§15-4). 완료 화면은 자기 CTA 가 이미 닫기라 뺀다.
                채움 버튼은 여전히 하나다(D-6): 이건 ghost 다. */}
            <CloseDayCta onOpenMore={onOpenMore} cap="남은 창 없음 →" when={closing && !allDone && !timer} />
            <span className={S.clock}>{toHM(nowMin)}</span>
          </div>
        </div>

        {/* 오늘의 흐름 — now-중심 세로 레일(학습 체크 + 일과, 색 통일). 무지개 트랙 폐기. */}
        <aside className={S.flow}>
          <h2 className={S.flowHead} aria-label={`오늘의 흐름 ${todayDone}/${todayTotal} 완료`}>
            <span
              className={`${S.ring}${celebrate ? ' animate-[today-ring-cele_1.4s_var(--ease)] motion-reduce:animate-none' : ''}`}
              aria-hidden="true"
            >
              <ProgressRing
                size={80}
                r={34}
                pct={pct}
                className="ds-ringSvg"
                trackClassName={'ds-ringTrack'}
                arcClassName={'ds-ringArc'}
              />
              <span className={S.ringNum}>
                {todayDone}
                <small className={S.ringNumSmall}>/{todayTotal}</small>
              </span>
            </span>
            <span className={S.flowT}>오늘의 흐름</span>
            <span className={S.now}>● {toHM(nowMin)} LIVE</span>
          </h2>
          <div className={S.rail}>
            {flowNodes.length ? (
              <FlowRail
                nodes={flowNodes}
                nowMin={nowMin}
                riskN={riskN}
                onToggle={toggle}
                onFocus={startNodeFocus}
                onPrefill={prefillNode}
                onReview={() => go('/review-run')}
              />
            ) : (
              <div className={S.railEmpty}>
                {hasItems ? (
                  <>
                    오늘은 배치된 블록이 없어요 — 오늘 계획을 직접 짜보세요.{' '}
                    <button type="button" className={S.mChip} onClick={goPlanToday}>
                      오늘 계획 짜기
                    </button>
                  </>
                ) : (
                  <>
                    아직 배치된 블록이 없어요. <b className="text-txt">학습 항목</b>·
                    <b className="text-txt">가용시간</b>을 설정하면 흐름이 채워집니다.
                  </>
                )}
              </div>
            )}
          </div>
          {/* A2 — 회상 위젯: 과거에 쓴 내 요약을 '스스로 다시 설명' 인출 연습으로(테스팅 효과). */}
          {recall && (
            <div className={`${S.recall} bg-[var(--panel-acc-faint)]`}>
              <div className={S.recallTop}>
                <span className={`${S.recallTag} text-txt`}>🧠 회상</span>
                <span className={S.recallMeta}>
                  {recall.ageDays}일 전 · {recall.summary.name || '요약'}
                </span>
              </div>
              <div className={S.recallQ}>{recall.summary.s1 || '이 개념을 스스로 다시 설명할 수 있나요?'}</div>
              {recallShown ? (
                <div className={S.recallA}>
                  {recall.summary.s2 && (
                    <div>
                      <b className="mr-1 font-bold text-txt">도구·어떻게</b> {recall.summary.s2}
                    </div>
                  )}
                  {recall.summary.s3 && (
                    <div>
                      <b className="mr-1 font-bold text-txt">결과·의미</b> {recall.summary.s3}
                    </div>
                  )}
                  <button type="button" className={S.recallReset} onClick={() => setRecallShown(false)}>
                    가리기
                  </button>
                </div>
              ) : (
                <button type="button" className={S.recallBtn} onClick={() => setRecallShown(true)}>
                  떠올렸다 · 정답 보기
                </button>
              )}
            </div>
          )}
          {/* I-10 — 착각 재확인 카드: 확신했지만 틀렸던 개념을 지금 다시 인출(회상과 같은 언어·시각). */}
          {confWrong && (
            <div className={`${S.recall} bg-[var(--conf-wrong-bg)]`}>
              <div className={S.recallTop}>
                <span className={`${S.recallTag} text-warn`}>⚠ 착각 재확인</span>
                <span className={S.recallMeta}>
                  {confWrong.ageDays}일 전 · {CBMS_INFO[confWrong.cbms.code].label}
                  {confWrongN > 1 ? ` · 외 ${confWrongN - 1}` : ''}
                </span>
              </div>
              <div className={S.recallQ}>
                {confWrong.cbms.name}
                {confWrong.cbms.chapter ? ` · ${confWrong.cbms.chapter}` : ''}
              </div>
              <div className={S.confWrongNote}>확신했지만 틀렸던 것 — 지금 다시 인출</div>
              <button type="button" className={S.recallBtn} onClick={() => go('/review-run')}>
                다시 확인 · 복습 세션 →
              </button>
            </div>
          )}
          <button type="button" className={S.more} onClick={() => onOpenMore()}>
            ＋ 블록 상세 · 일일 의식 · 흐름 가이드
          </button>
        </aside>
      </div>

      {/* 하단 스트립 — 이번 주·마감·Anki·보충(이퀄라이저 폐기 → 정돈된 단일 풋바). */}
      <div className={S.strip}>
        <div className={S.grp}>
          <span className={S.grpL}>이번 주</span>
          <button
            type="button"
            className={S.tag}
            // 라벨이 '주간 보기'를 약속하므로 뷰도 주(週)로 고정한다(영속 schedView가 day/month면 말과 다른 곳에 착지).
            // 위 goPlanToday와 같은 규약 — 뷰 전환은 보내는 쪽이 먼저.
            onClick={() => {
              setSchedView('week');
              go('/schedule');
            }}
            aria-label={`이번 주 ${weekTotalH.toFixed(1)}시간 — 주간 보기로 이동`}
          >
            <b className={S.cool}>{weekShown.toFixed(1)}</b> h
          </button>
        </div>
        <div className={S.vline} />
        <div className={S.grp}>
          <span className={S.grpL}>마감 임박</span>
          {soon.length ? (
            soon.map((st) => {
              const { lab } = ddayInfo(st.dday);
              return (
                <button key={st.name} type="button" className={S.tag} onClick={() => go('/items')}>
                  <span className={S.dot} style={{ background: st.color || 'var(--acc)' }} />
                  {st.name} <b className={S.hot}>{lab}</b>
                </button>
              );
            })
          ) : (
            <span className={S.tagMut}>없음</span>
          )}
        </div>
        <div className={S.vline} />
        <div className={S.grp}>
          <span className={S.grpL}>Anki 대기</span>
          <button
            type="button"
            className={S.tag}
            onClick={() => go('/integrations')}
            title={due == null ? 'Anki 미연결 — 연동 탭에서 실시간 연결' : `복습 대기 ${due}장`}
            aria-label={due == null ? 'Anki 미연결 — 연동 탭으로' : `Anki 복습 대기 ${due}장 — 연동 탭으로`}
          >
            <b className={ankiTone(due)}>{due == null ? '연결' : due}</b> {due == null ? '필요' : '장'}
          </button>
        </div>
        <div className={S.vline} />
        <div className={S.grp}>
          <span className={S.grpL}>열린 보충</span>
          <button type="button" className={S.tag} onClick={() => go('/journal')}>
            <b className={tone(openBl > 0)}>{openBl}</b> 건
          </button>
        </div>
        <div className={S.vline} />
        {/* PL-19 — 일일 의식 리드아웃+토글(상태 표시 수준; 노트 등 세부는 온디맨드 RitualCard). */}
        <div className={S.grp}>
          <span className={S.grpL}>의식</span>
          <button
            type="button"
            className={S.tag}
            onClick={() => mutate((st) => setRitual(st, ds, 'plan', !ritual?.plan))}
            aria-pressed={!!ritual?.plan}
            aria-label={`아침 계획 ${ritual?.plan ? '완료' : '미완료'} — 토글`}
          >
            🌅 아침 <b className={S.cool}>{ritual?.plan ? '☑' : '☐'}</b>
          </button>
          <button
            type="button"
            className={S.tag}
            onClick={() => mutate((st) => setRitual(st, ds, 'shutdown', !ritual?.shutdown))}
            aria-pressed={!!ritual?.shutdown}
            aria-label={`셧다운 ${ritual?.shutdown ? '완료' : '미완료'} — 토글`}
          >
            🌙 셧다운 <b className={S.cool}>{ritual?.shutdown ? '☑' : '☐'}</b>
          </button>
        </div>
      </div>
    </section>
  );
}
