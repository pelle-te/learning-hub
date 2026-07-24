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
import { useSchedule } from '@/store/selectors';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { useFocus } from '@/store/useFocus';
import { usePrefill } from '@/store/prefill';
import { usePing, useKnowledge } from '@/store/queries';
import { isDone, studyStreak } from '@/lib/persistence';
import { pickFocus, focusMinutes } from '@/lib/focusState';
import { openBacklog, setRitual, CBMS_INFO } from '@/lib/methodology';
import { layoutDay, freeWindowsForWeekday, freeMinAfter, sessionTimeMap } from '@/lib/scheduler';
import { deadlineDdays, indexDays } from '@/lib/scheduleView';
import { totalDue } from '@/lib/anki';
import { pickRetrieval, retrievableCount, pickConfidentWrong, confidentWrongCount } from '@/lib/retrieval';
import { frontierNext } from '@/lib/knowledge';
import { riskSummary } from '@/lib/spacedReview';
import { ProgressRing } from '@/components/ProgressRing';
import { todayISO, parseISO, mondayOf, addDays, iso, ddayInfo, toHM, hLabel, mmss, DOW_MON } from '@/lib/utils';
import { useCountUp, useHeroPointer } from '@/hooks/interactions';
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
  hero: "tint-scope group relative isolate flex flex-col justify-center overflow-hidden rounded-lg border border-line bg-[image:var(--bg-hero-today)] px-hero-x-today py-hero-y-today shadow-hero transform-3d [transform:var(--tilt-today)] [transition:transform_0.25s_var(--ease),border-color_0.2s_var(--ease)] animate-[today-hero-fade_0.5s_var(--ease)_both] before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-[image:var(--bg-sig-top)] before:content-[''] hover:border-[color:var(--line-hero-hover)] motion-reduce:transform-none motion-reduce:animate-none",
  aura: 'pointer-events-none absolute bottom-[var(--aura-bottom)] left-[var(--aura-left)] z-[-1] h-[var(--aura-h)] w-9/10 bg-[image:var(--bg-aura-today)] [filter:var(--filter-aura)] animate-[today-aura-breathe_9s_var(--ease)_infinite] motion-reduce:animate-none',
  spotlight:
    'pointer-events-none absolute inset-0 z-[-1] bg-[image:var(--bg-spotlight-today)] opacity-0 transition-opacity duration-[0.35s] ease-[var(--ease)] group-hover:opacity-100 motion-reduce:transition-none',
  heroFill:
    'absolute bottom-0 left-0 z-[-1] h-0.75 bg-acc shadow-[var(--shadow-fill)] transition-[width] duration-1000 ease-linear motion-reduce:transition-none',
  ghostGauge:
    'pointer-events-none absolute top-[var(--ghost-top)] right-[var(--ghost-right)] z-[-1] flex items-baseline gap-[var(--ghost-gap)] leading-none select-none',
  ghostNum:
    'text-ghost-num font-extrabold tracking-ghost text-transparent tabular-nums [-webkit-text-stroke:var(--stroke-ghost)]',
  ghostUnit: 'text-ghost-unit font-extrabold tracking-ghost-unit text-[color:var(--ghost-em)] not-italic',
  heroHead: 'flex items-baseline justify-between gap-3',
  eyebrow:
    'inline-flex items-center gap-2 text-xs leading-[1.6] font-extrabold tracking-eyebrow-wide text-acc uppercase',
  live: 'size-1.75 rounded-full bg-acc shadow-load animate-[today-live-pulse_1.8s_var(--ease)_infinite] motion-reduce:animate-none',
  heroWhen: 'text-hero-when font-extrabold tracking-title text-txt tabular-nums',
  subj: 'mt-subj-top! mb-0! text-subj! max-wide:text-subj-mobile! font-black! leading-[0.94] tracking-subj! text-balance text-[color:var(--subj-col)]!',
  heroSub: 'mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1.5 text-lg leading-[1.5] text-mut',
  chapter: 'font-semibold text-txt',
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
  now: 'text-sm leading-[1.6] font-extrabold text-acc tabular-nums [text-shadow:var(--shadow-fill)]',
  rail: 'min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]',
  railEmpty: 'px-1 py-3.5 text-hint leading-[1.6] text-mut',
  node: "relative flex w-full items-center gap-3 border-0! bg-transparent! pr-2! pl-0! text-left text-base14! before:pointer-events-none before:absolute before:top-0 before:bottom-0 before:left-node-spine before:w-0.5 before:-translate-x-px before:bg-line2 before:content-[''] first:before:top-1/2 last:before:bottom-1/2",
  nTime: 'w-10.5 flex-none text-sm font-bold text-mut tabular-nums',
  nBody: 'flex min-w-0 flex-1 flex-col gap-px',
  nSub: 'truncate text-note-info text-mut',
  nNow: 'flex-none text-2xs font-extrabold tracking-mode text-acc [text-shadow:var(--navlink-glow)]',
  nNowSmall: 'text-tiny9 font-extrabold opacity-85',
  nProg:
    'pointer-events-none absolute bottom-0 left-0 z-[2] h-0.5 rounded-full bg-acc shadow-dot transition-[width] duration-1000 ease-linear motion-reduce:transition-none',
  nDotBase: 'relative z-[1] size-2.5 flex-none rounded-full',
  nDotStudy: 'bg-acc shadow-[var(--shadow-node-live)]',
  nDotBlock: 'bg-mut shadow-[var(--shadow-node-panel)]',
  nDotLive:
    'bg-acc scale-130 shadow-[var(--shadow-node-live)] animate-[today-dot-ping_1.5s_var(--ease)_infinite] motion-reduce:animate-none',
  nDotGhost:
    'relative z-[1] size-2 flex-none rounded-full border-2 border-line2 bg-transparent shadow-[var(--shadow-node-panel)]',
  reviewCta:
    'mt-1.5 mb-0.5 inline-flex items-center gap-2 rounded-md! border-0! bg-[var(--tint-warn-faint)]! px-3! py-2! text-hint! font-bold! shadow-[var(--shadow-inset-line2)] hover:shadow-[var(--shadow-inset-acc-glow)]',
  reviewDot: 'size-1.75 flex-none rounded-full bg-warn',
  recall:
    'mt-2.5 flex-none rounded-base border border-line2 px-3.5 py-3 animate-[today-hero-fade_0.4s_var(--ease)_both]',
  recallTop: 'mb-1.5 flex items-baseline gap-2',
  recallTag: 'flex-none text-2xs font-extrabold tracking-skel uppercase',
  recallMeta: 'truncate text-xs leading-[1.6] font-bold text-mut',
  recallQ: 'text-recall-q leading-[1.45] font-bold text-txt',
  recallBtn:
    'mt-2.5 w-full rounded-blk! border-0! bg-[var(--acc-soft)]! px-3! py-2! text-hint! font-extrabold! text-acc! shadow-[var(--shadow-inset-acc-glow)] hover:shadow-[var(--shadow-inset-acc-solid)]',
  recallA:
    'mt-2 flex flex-col gap-1.25 text-hint leading-[1.5] text-mut animate-[today-hero-fade_0.3s_var(--ease)_both]',
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
} as const;

export function TodaySignature({ onOpenMore }: { onOpenMore: () => void }) {
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
  // I-4 — 흐름 레일 키보드 흐름(j/k 이동·Enter 집중·s 기록). 선택 노드 key + DOM 참조맵.
  const [selKey, setSelKey] = useState<string | null>(null);
  const nodeRefs = useRef(new Map<string, HTMLElement>());

  // 히어로 포인터 추적 — 스포트라이트(--mx/--my) + 3D 틸트(--tiltX/Y). 정본 훅(interactions) 공유.
  const { ref: heroRef, onMouseMove: onHeroMove, onMouseLeave: onHeroLeave } = useHeroPointer(7);

  // 집중 타이머(포모도로) — 전역 세션(useFocus): 탭 이동·새로고침에도 이어짐. 종료 감지는 FocusChip.
  const timer = useFocus((st) => st.session);
  const startSession = useFocus((st) => st.start);
  const stopSession = useFocus((st) => st.stop);

  // 적응형 틱 — 초 단위 표시는 포모도로(mmss)뿐이므로 세션 중에만 1초, 평시엔 30초(FocusChip과 동일 패턴).
  // 무조건 1초는 방치된 대시보드를 초당 리렌더하는 60배 과잉이었다. 백그라운드 정지·복귀 캐치업 유지.
  const [, setTick] = useState(0);
  const tickPeriod = timer ? 1000 : 30_000;
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    const startTick = () => {
      if (id == null) id = setInterval(() => setTick((t) => (t + 1) % 86400), tickPeriod);
    };
    const stopTick = () => {
      if (id != null) {
        clearInterval(id);
        id = null;
      }
    };
    const onVis = () => {
      if (document.hidden) stopTick();
      else {
        setTick((t) => (t + 1) % 86400); // 복귀 즉시 캐치업
        startTick();
      }
    };
    // 주기 전환(세션 시작/종료) 자체가 리렌더를 동반하므로 즉시 캐치업은 불필요 — 틱만 재설정.
    startTick();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stopTick();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [tickPeriod]);

  const ds = todayISO(state);
  const today = parseISO(ds);
  // 날짜→Day 인덱스 1회 생성(선형 find 제거) — Schedule과 동일 패턴, O(1) 조회.
  const byDs = indexDays(res);

  const todayDay = byDs[ds];
  const items = todayDay?.items || [];
  const L = items.length ? layoutDay(state, todayDay!) : null;
  const timeBy: ReturnType<typeof sessionTimeMap> = L ? sessionTimeMap(L.sessions) : {};

  const enriched = items.map((it) => {
    const tm = timeBy[it.sid + '|' + it.type] || { start: null, end: null };
    return { it, start: tm.start, end: tm.end, done: isDone(state, ds, it.sid, it.type) };
  });
  const todayDone = enriched.filter((e) => e.done).length;
  const todayTotal = items.length;
  const pct = todayTotal ? Math.round((todayDone / todayTotal) * 100) : 0;

  const nowDate = new Date();
  const nowMin = nowDate.getHours() * 60 + nowDate.getMinutes();
  const nowMs = nowDate.getTime();
  const startKey = (e: (typeof enriched)[number]) => e.start ?? 9999;
  const pending = enriched.filter((e) => !e.done);
  // '지금 할 일' 선택은 lib/focusState.pickFocus와 공유 — 팔레트·상단 바 시작과 같은 규칙.
  const { current, focus } = pickFocus(enriched, nowMin);
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
  // A3 — 오늘 '일과 블록·이미 배치된 학습 뺀' 남은 가용시간(now 이후) — 워터마크를 정보성으로.
  // 배치된 날이면 layoutDay의 잔여 free(학습 세션·일과 차감 + 당일 오버라이드 캡 반영)를 쓰고,
  // 빈 날(L 없음)이면 순수 루틴 창으로 폴백. now 이후로 클램프해 빡빡한 날 과대표시를 막는다.
  const freeIntervals: [number, number][] = L
    ? L.free
    : freeWindowsForWeekday(state, today.getDay()).windows.map((w) => [w.s, w.e] as [number, number]);
  const freeLeftH = Math.round((freeMinAfter(freeIntervals, nowMin) / 60) * 10) / 10;
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
  const soon = ddays.filter((st) => st.dday <= 14).slice(0, 3);
  const nearestDday = ddays.length ? ddays[0]!.dday : null;

  // 오늘의 흐름 노드 — 학습(체크 가능)+일과 블록을 시간순 단일 리스트로(무지개 가로 트랙 폐기).
  const tl = L?.tl || [];
  type FlowNode = {
    key: string;
    kind: 'study' | 'block';
    start: number;
    end: number | null;
    name: string;
    sub: string;
    color?: string;
    done: boolean;
    e: (typeof enriched)[number] | null;
  };
  const flowNodes: FlowNode[] = [
    ...enriched
      .filter((e) => e.start != null)
      .map((e): FlowNode => ({
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
      .map((t, i): FlowNode => ({
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

  // I-4 — 흐름 레일 키보드 흐름: j/k 노드 이동(활성 하이라이트+스크롤) · Enter 현재 노드 집중 시작 · s 기록 프리필.
  // Today.tsx 오버레이 키처리와 같은 window keydown+cleanup 패턴. 입력 포커스 시엔 무시(타이핑 보호).
  const startNodeFocus = (e: (typeof enriched)[number]) => {
    startSession({ ds, sid: e.it.sid, type: e.it.type, name: e.it.name, min: focusMinutes(e), blockMin: e.it.min });
  };
  // 핸들러가 읽는 최신 값 — 리스너를 재등록하지 않고도 최신 상태를 보게 하는 통로.
  // (deps에 flowNodes를 넣던 시절엔 그게 매 렌더 새 배열이라 window keydown이 **매 렌더 제거→재등록**됐다.)
  const keyCtx = useRef({ flowNodes, selKey, ds, startNodeFocus });
  // deps 없는 effect = 매 렌더 후 갱신. 렌더 중 ref 쓰기는 컴파일러가 막으므로(정당하다) 여기서 민다.
  useEffect(() => {
    keyCtx.current = { flowNodes, selKey, ds, startNodeFocus };
  });

  useEffect(() => {
    const reveal = (key: string) => {
      const el = nodeRefs.current.get(key);
      const rm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el?.scrollIntoView({ block: 'nearest', behavior: rm ? 'auto' : 'smooth' });
    };
    const onKey = (e: KeyboardEvent) => {
      const { flowNodes, selKey, ds, startNodeFocus } = keyCtx.current;
      if (!flowNodes.length) return;
      const keys = flowNodes.map((n) => n.key);
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const idx = selKey ? keys.indexOf(selKey) : -1;
      if (e.key === 'j') {
        e.preventDefault();
        const next = keys[Math.min(keys.length - 1, idx + 1)] ?? keys[0]!;
        setSelKey(next);
        reveal(next);
      } else if (e.key === 'k') {
        e.preventDefault();
        const prev = idx <= 0 ? keys[0]! : keys[idx - 1]!;
        setSelKey(prev);
        reveal(prev);
      } else if (e.key === 'Enter') {
        const nd = flowNodes.find((n) => n.key === selKey);
        if (nd?.e) {
          e.preventDefault();
          startNodeFocus(nd.e);
        }
      } else if (e.key === 's' || e.key === 'S') {
        const nd = flowNodes.find((n) => n.key === selKey);
        if (nd?.e) {
          e.preventDefault();
          usePrefill.getState().request('sum', nd.e.it.sid, ds);
          ui.toast(`${nd.e.it.name} — 기록 프리필됨 ✍`, 'info');
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // deps 빈 배열이 이제 정직하다 — 핸들러가 참조하는 값은 전부 keyCtx.current에서 읽으므로
    // 마운트/언마운트에 각 1회만 등록/해제된다(exhaustive-deps 억제도 함께 제거).
  }, []);

  const kicker = todayTotal === 0 ? '오늘 할 일' : allDone ? '오늘 학습' : current ? '지금 할 일' : '다음 할 일';
  const subjName = allDone ? '완료' : focus ? focus.it.name : todayTotal === 0 ? '비어 있음' : '—';
  const focusMin = focusMinutes(focus);
  const focusWhen = focus && focus.start != null && focus.end != null ? `${toHM(focus.start)}–${toHM(focus.end)}` : '—';
  const focusChapter = focus
    ? focus.it.chapters?.length
      ? focus.it.chapters.join(', ')
      : TYPE_LABEL[focus.it.type] || '학습'
    : '—';

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
            : {
                label: '지금 시작 →',
                // getState로 항상 신선한 세션을 읽음(chrome 이펙트 deps에 안 묶임).
                // 이미 집중 중이면 재시작 대신 세부 패널을 연다.
                onClick: () => {
                  const f = useFocus.getState();
                  if (f.session) onOpenMore();
                  else f.startOnCurrent();
                },
              },
    }),
    [pct, streak, nearestDday, todayTotal, allDone, hasItems, res.adaptApplied, res.adapt],
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
          {/* 오버사이즈 게이지 — 우상단 허공을 '오늘 남은 가용시간'으로 채움(정보성 워터마크). */}
          <span className={S.ghostGauge} aria-hidden="true">
            <b className={S.ghostNum}>{freeLeftH}</b>
            <em className={S.ghostUnit}>h 남음</em>
          </span>

          <div className={S.heroHead}>
            <span className={S.eyebrow}>
              {current && <i className={S.live} />}
              {kicker}
            </span>
            <span className={S.heroWhen}>{focusWhen}</span>
          </div>

          <h2 className={S.subj}>{subjName}</h2>
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
                <span className={S.chapter}>{focusChapter}</span>
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
              <button type="button" className={`${S.cta} ${S.ctaGhost}`} onClick={() => go('/journal')}>
                <span className={S.ctaGo}>✓ 오늘 완료</span>
                <span className={S.ctaCap}>기록 보기 →</span>
              </button>
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
                {/* 포모도로 프리셋 — 블록 길이 대신 25/50분 명시 시작. */}
                <span className={S.presets}>
                  {[25, 50]
                    .filter((m) => m !== focusMin)
                    .map((m) => (
                      <button
                        key={m}
                        type="button"
                        className={S.preset}
                        onClick={() => startTimer(m)}
                        aria-label={`${m}분 집중 시작`}
                      >
                        {m}′
                      </button>
                    ))}
                </span>
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
              <>
                {flowNodes.map((nd) => {
                  const live = nd.start <= nowMin && (nd.end == null || nowMin < nd.end);
                  const past = nd.done || (nd.end != null && nowMin >= nd.end);
                  const sel = selKey === nd.key;
                  const block = nd.kind === 'block';
                  const dur = nd.end != null ? ` · ${hLabel(nd.end - nd.start)}` : '';
                  // 현재 블록 실시간 진행률(경과/길이) — 1초 틱으로 갱신.
                  const prog =
                    live && nd.end != null && nd.end > nd.start
                      ? Math.min(100, Math.max(0, Math.round(((nowMin - nd.start) / (nd.end - nd.start)) * 100)))
                      : 0;
                  // 상태 정적 클래스맵(§15 · 동적 조립 금지). 선택(nSel)이 라이브(nLive)보다 우선(원본 소스 순서).
                  const stateBg = sel
                    ? 'rounded-md bg-[var(--tint-ink-5)] shadow-[var(--shadow-inset-line2)]'
                    : live
                      ? 'rounded-md bg-[var(--tint-acc-9)]'
                      : '';
                  const cls = `${S.node} py-2.75! ${nd.e ? 'group/node cursor-pointer hover:rounded-md focus-visible:rounded-md! focus-visible:[outline-offset:var(--node-outline-offset)]!' : 'cursor-default'} ${past ? 'opacity-40' : ''} ${stateBg}`;
                  // nName 색/굵기: 블록=뮤트·600, 라이브·선택=acc, study hover=acc(group/node), 완료=취소선.
                  const nNameCls = `truncate ${block ? 'font-semibold text-mut' : 'font-bold'} ${live || sel ? 'text-acc' : ''} ${nd.done ? 'line-through' : ''} ${nd.e ? 'group-hover/node:text-acc' : ''}`;
                  const nDotCls = `${S.nDotBase} ${live ? S.nDotLive : block ? S.nDotBlock : S.nDotStudy}`;
                  const setNodeRef = (el: HTMLElement | null) => {
                    const m = nodeRefs.current;
                    if (el) m.set(nd.key, el);
                    else m.delete(nd.key);
                  };
                  const inner = (
                    <>
                      {live && <span className={S.nProg} style={{ width: `${prog}%` }} aria-hidden="true" />}
                      {/* nTime 내장 text-sm 은 companion LH 를 흘리므로 명시 — 폼컨트롤(study 버튼) 자손=normal · div=1.6. */}
                      <span className={`${S.nTime} ${nd.e ? 'leading-[normal]' : 'leading-[1.6]'}`}>
                        {toHM(nd.start)}
                      </span>
                      <span
                        className={nDotCls}
                        style={nd.kind === 'study' && nd.color ? { background: nd.color } : undefined}
                      />
                      <span className={S.nBody}>
                        <span className={nNameCls}>{nd.name}</span>
                        <span className={S.nSub}>
                          {nd.sub}
                          {dur}
                        </span>
                      </span>
                      {live && (
                        <span className={S.nNow}>
                          지금 <small className={S.nNowSmall}>{prog}%</small>
                        </span>
                      )}
                    </>
                  );
                  return nd.e ? (
                    <button
                      key={nd.key}
                      ref={setNodeRef}
                      type="button"
                      className={cls}
                      onClick={() => toggle(nd.e!)}
                      aria-label={`${nd.name} 완료 토글`}
                      aria-pressed={nd.done}
                      aria-current={selKey === nd.key ? true : undefined}
                    >
                      {inner}
                    </button>
                  ) : (
                    <div
                      key={nd.key}
                      ref={setNodeRef}
                      className={cls}
                      aria-current={selKey === nd.key ? true : undefined}
                    >
                      {inner}
                    </div>
                  );
                })}
                {/* 종결 캡 고스트 — 마지막 노드 뒤 "이후 일정 없음": 스파인이 끝났다고 읽히게(비인터랙티브). */}
                <div className={`${S.node} py-1.75! opacity-55`}>
                  <span className={`${S.nTime} leading-[1.6]`}>—</span>
                  <span className={S.nDotGhost} />
                  <span className={S.nBody}>
                    <span className={S.nSub}>이후 일정 없음</span>
                  </span>
                </div>
                {/* I-2 — 밀린 복습이 있으면 종결 캡 뒤에 은은한 딥링크 칩(스케줄 쓰기 아님 → 복습 실행으로). */}
                {riskN > 0 && (
                  <button
                    type="button"
                    className={S.reviewCta}
                    onClick={() => go('/review-run')}
                    aria-label={`밀린 복습 ${riskN}개 — 복습 세션으로 이동`}
                  >
                    <span className={S.reviewDot} aria-hidden="true" />
                    복습 {riskN}개 밀림 <b className="ml-0.5 font-extrabold text-acc">복습 세션 →</b>
                  </button>
                )}
              </>
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
                <span className={`${S.recallTag} text-acc`}>🧠 회상</span>
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
          <button type="button" className={S.more} onClick={onOpenMore}>
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
            <b className="text-acc">{weekShown.toFixed(1)}</b> h
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
                  {st.name} <b className="text-acc">{lab}</b>
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
            <b className="text-acc">{due == null ? '연결' : due}</b> {due == null ? '필요' : '장'}
          </button>
        </div>
        <div className={S.vline} />
        <div className={S.grp}>
          <span className={S.grpL}>열린 보충</span>
          <button type="button" className={S.tag} onClick={() => go('/journal')}>
            <b className="text-acc">{openBl}</b> 건
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
            🌅 아침 <b className="text-acc">{ritual?.plan ? '☑' : '☐'}</b>
          </button>
          <button
            type="button"
            className={S.tag}
            onClick={() => mutate((st) => setRitual(st, ds, 'shutdown', !ritual?.shutdown))}
            aria-pressed={!!ritual?.shutdown}
            aria-label={`셧다운 ${ritual?.shutdown ? '완료' : '미완료'} — 토글`}
          >
            🌙 셧다운 <b className="text-acc">{ritual?.shutdown ? '☑' : '☐'}</b>
          </button>
        </div>
      </div>
    </section>
  );
}
