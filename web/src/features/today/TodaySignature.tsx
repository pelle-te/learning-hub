/* ============================================================
   TodaySignature — 오늘 탭 = 데모 v6 단일 화면 대시보드(에디토리얼 다크).
   프레임을 가득 채우는 4컬럼 그리드 [회전 스파인 | 스탯 | 발광 트랙 | 오늘의 블록] + 하단 스트립.
   진행률·연속·마감 리드아웃과 "지금 시작" 주 액션은 상단 바(usePageChrome)로 끌어올림.
   세부(블록 액션·일일 의식·흐름 가이드)는 onOpenMore 패널로 — 기본은 한 화면, 무스크롤.
============================================================ */
import { completionKey } from '@/lib/domainKeys';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { confirmIrreversible, toast } from '@/shell';
import { SPAN_PARAM } from '@/shell/tabs';
import { useApp } from '@/store/useApp';
import { useRuntime } from '@/store/useRuntime';
import { useUI } from '@/store/useUI';
import { useSchedule, selectTodayFocus, selectRiskSummary } from '@/store/selectors';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { useFocus } from '@/store/useFocus';
import { usePrefill } from '@/store/prefill';
import { usePing, useKnowledge } from '@/store/queries';
import { focusKey, focusMinutes, type FocusEntry } from '@/lib/focusState';
import { openBacklog } from '@/lib/methodology';
import { recordDaySignal, pruneDaySignals } from '@/lib/daySignals';
import { layoutDay, freeWindowsForDay, freeMinAfter } from '@/lib/scheduler';
import { dayPhase } from '@/lib/dayPhase';
import { dayCapacity } from '@/lib/dayCapacity';
import { untimedChoreMin } from '@/lib/tasks';
import { pickNextStep, pickRetrievalSlot, type NextStep } from '@/lib/todaySlots';
import RetrievalSlot from './RetrievalSlot';
import { deadlineDdays, indexDays } from '@/lib/scheduleView';
import { totalDue, ankiFreshness } from '@/lib/anki';
import { pickRetrieval, pickConfidentWrong, confidentWrongCount } from '@/lib/retrieval';
import { frontierNext } from '@/lib/knowledge';
import { onThisDay } from '@/lib/records';
import { dayShape } from '@/lib/insights';
import type { AppState } from '@/lib/types';
import { FlowRail, type FlowNode } from './FlowRail';
import { DayBar } from './DayBar';
import { todayISO, parseISO, addDays, iso, hNum, toHM, mmss, reviewBlockMin } from '@/lib/utils';
import { shareLine, todayShare } from '@/lib/todayShare';
import { buildBeyondStrip } from './BeyondStrip';
import { S } from './signatureParts';
import { subjectCalibration } from '@/lib/estimateCalibration';
import { upcomingMarks } from '@/lib/semester';
import { useHeroPointer, useAdaptiveTick } from '@/hooks/interactions';
import { useCommitOnChange } from '@/hooks/useCommitOnChange';
import { Icon } from '@/components/Icon';
// 'ds'는 이 파일서 날짜문자열 지역변수라 별칭 회피

const TYPE_LABEL: Record<string, string> = {
  new: '집중 학습',
  rev: '간격 복습',
  blank: '백지 복습',
  anki: 'Anki',
  mock: '모의시험',
};

/**
 * **A-11** — 오늘 계획된 과목들의 실측 배율(가중 평균). 표본이 없으면 `null`.
 *
 * ⚠ 가중치는 **오늘 계획된 분**이다: 3시간짜리 과목의 배율이 30분짜리보다 오늘 판정을 더
 * 좌우해야 한다(단순 평균이면 작은 블록이 하루의 판정을 흔든다).
 * ⚠ 배율을 모르는 과목은 **1**로 센다 — 모르는 것을 다른 값으로 채우면 지어낸 근거가 된다.
 */
function todayEstimateRatio(
  state: AppState,
  enriched: readonly { it: { sid: string; min?: number } }[],
): number | null {
  let w = 0;
  let sum = 0;
  let known = 0;
  for (const e of enriched) {
    const min = e.it.min || 0;
    if (min <= 0) continue;
    const c = subjectCalibration(state, e.it.sid);
    if (c) known += min;
    w += min;
    sum += min * (c?.ratio ?? 1);
  }
  return w > 0 && known > 0 ? sum / w : null;
}

/* ── C-7 이식(today) — Tailwind 클래스 SSOT ────────────────────────────────────────
   시그니처 히어로(과목색 --tint 베이크·포인터 스포트라이트·3D 틸트) + 통합 집중 CTA + now-중심
   발광 흐름 레일 + 하단 스트립. 색·그래디언트·발광·틸트는 tokens.css 에 이름 주고 bg-[var]·
   shadow-[var]·[transform:var] 로 참조(런타임 --tint/--mx/--my/--tiltX·Y 는 히어로 인라인 style 이
   얹는 사용 시점 해석). 상태 의존(노드 study/block/live/sel/done·CTA 변형)은 아래 map/inline 이
   정적 클래스맵으로 조립(동적 문자열 금지 · §15). ⚠ preflight 부재 → 전역 button/h2(unlayered)가
   유틸을 이기므로 다른 값만 `!`(§ global element rules). 내장 크기(text-xs/sm/base/lg)는 companion
   line-height 를 흘리므로 leading 명시(폼컨트롤/그 자손=normal · 일반 흐름=1.6 또는 원본값 · line-height 트랩).
   ds.ringSvg/Track/Arc 는 공용 스켈레톤이라 유지. `TodaySignature.module.css` 삭제. */

/** UX-1 액센트 게이트 — hot 이면 액센트, 아니면 조용한 상태 보고색.
 *  ⚠ 판정을 컴포넌트 **밖**에 두는 건 취향이 아니라 래칫이 실제로 걸린 결과다: 조건을 JSX 안에
 *    흩었더니 이 컴포넌트의 인지복잡도가 77→80 이 되어 `sonarjs/cognitive-complexity` 가 막았다.
 *    이름 붙은 술어로 밖에 내면 복잡도도 내려가고 "왜 이것만 강조인가"도 JSX 밖에서 읽힌다. */
/**
 * **A-13 확정 토글**(W7) — 오늘의 히어로를 못박거나 푼다.
 *
 * ⚠ 컴포넌트로 뺀 이유는 응집이자 래칫이다: 본체가 인지복잡도 상한에 붙어 있어(그 파일의
 * 다른 추출들과 같은 사정) 조건부 JSX 를 더 쌓으면 게이트가 막는다 — *새 분기는 새 이름을
 * 갖는다*는 이 파일의 기존 규율 그대로.
 * ⚠ 해제도 같은 버튼이다(상태를 두 곳에 두지 않는다). `onToggle(null)` 이 해제다.
 */
function FocusLockButton({
  focus,
  locked,
  onToggle,
}: {
  focus: FocusEntry | null;
  locked: boolean;
  onToggle: (key: string | null) => void;
}) {
  if (!focus) return null;
  return (
    <button
      type="button"
      className={S.why}
      aria-pressed={locked}
      onClick={() => onToggle(locked ? null : focusKey(focus))}
      title={locked ? '확정을 풀면 앱이 다시 고릅니다' : '오늘은 이걸로 확정합니다'}
    >
      <Icon name={locked ? 'pin' : 'flag'} /> {locked ? '확정됨' : '이걸로 확정'}
    </button>
  );
}

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
      <Icon name="moon" /> 오늘의 모양 — {shape.subjects}과목 · {shape.sessions}세션 · {shape.focusMin}분
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
      <span className={S.ctaGo}>
        <Icon name="moon" /> 하루 닫기
      </span>
      <span className={S.ctaCap}>{cap}</span>
    </button>
  );
}

/** 오늘의 확정 키 — **날짜가 다르면 무효**다(어제 확정이 오늘을 붙들지 않게 · A-13/W7). */
function lockedKeyFor(lock: { ds: string; key: string } | null | undefined, ds: string): string | null {
  return lock && lock.ds === ds ? lock.key : null;
}

/** 프런티어 표시명 — 제목이 없으면 파일명, 그것도 없으면 빈 문자열(그러면 호출부가 안 그린다). */
function frontierLabel(f: { title?: string; basename?: string } | null | undefined): string {
  return f?.title || f?.basename || '';
}

/** Anki due 합 — 캐시가 아예 없으면(`decks` 부재) **null 이지 0 이 아니다**. 0 으로 그리면
 *  "복습할 게 없다"가 되는데 사실은 "모른다"이고, 이 화면은 그 둘을 다르게 말한다. */
function dueOf(live: { decks?: unknown } | null | undefined): number | null {
  return live?.decks ? totalDue(live.decks as Parameters<typeof totalDue>[0]) : null;
}

/** 오늘 남은 가용 구간 — 배치된 날이면 `layoutDay` 의 잔여 `free`(학습 세션·일과 차감 + 당일
 *  오버라이드 캡 반영), 빈 날이면 순수 날짜 창 폴백.
 *  ⚠ N-1(W8) — 빈 날 폴백도 **날짜 창**이다. 요일 창은 일정·과제를 모르므로, 계획이 없는 날에만
 *  창이 과대 표시되던 비대칭이 있었다(같은 하루를 배치 유무로 다르게 말한다). */
function freeIntervalsOf(
  state: AppState,
  ds: string,
  today: Date,
  L: { free: [number, number][] } | null,
): [number, number][] {
  if (L) return L.free;
  return freeWindowsForDay(state, ds, today.getDay()).windows.map((w) => [w.s, w.e] as [number, number]);
}

/** 히어로 문장 — **큰 자리에 무엇을 쓸 것인가**.
 *  ── D-5 히어로의 주어를 행동으로 ──────────────────────────────────────
 *  72px 자리에 **과목명**이 있었다 — 내가 이미 아는 것이다. 정작 무엇을 하는지(챕터·유형)는
 *  18px 였고 "왜 이것인가"는 화면 어디에도 없었다. 큰 자리를 행동에 준다.
 *  ⚠ 챕터가 없는 블록(Anki·모의 등)이면 큰 자리는 **과목명으로 폴백**한다 — 그때는 그것이
 *    유일하게 구체적인 이름이고, 유형은 바로 아래 줄이 말한다.
 *  ⚠ 큰 자리에 챕터가 섰으면 아래 줄은 `과목 · 유형`, 아니면 유형만이다(같은 말을 두 번 하지 않는다).
 *  ⚠ 컴포넌트 밖으로 뺀 이유(2026-08-20): 여섯 값이 전부 `focus`·`allDone`·`todayTotal` 세 입력의
 *    삼항 조합이라, 이 묶음 하나가 컴포넌트 인지복잡도의 상당 부분이었다. **문자열만 낸다** —
 *    JSX 를 자르지 않으므로 렌더 트리가 원리적으로 안 변한다(§15-4). */
function heroCopy(s: { focus: FocusEntry | null; current: unknown; allDone: boolean; todayTotal: number }): {
  kicker: string;
  focusMin: number;
  heroMain: string;
  heroSub: string;
  dispColor: string | undefined;
} {
  const { focus, allDone, todayTotal } = s;
  const focusType = focus ? TYPE_LABEL[focus.it.type] || '학습' : '';
  const chapter = focus?.it.chapters?.length ? focus.it.chapters.join(', ') : '';
  return {
    kicker: todayTotal === 0 ? '오늘 할 일' : allDone ? '오늘 학습' : s.current ? '지금 할 일' : '다음 할 일',
    focusMin: focusMinutes(focus),
    heroMain: allDone ? '완료' : focus ? chapter || focus.it.name : todayTotal === 0 ? '비어 있음' : '—',
    heroSub: focus ? (chapter ? `${focus.it.name} · ${focusType}` : focusType) : '—',
    dispColor: !allDone && focus ? focus.it.color : undefined,
  };
}

/** 포모도로 표시값 — 남은 초·진행%·MM:SS. 세션이 없으면 0/0/`00:00`(값 부재를 0 으로 그리는
 *  것이 여기서는 옳다 — 타이머는 "안 돌고 있음"이 곧 0이다). */
function timerView(
  timer: { endsAt: number; total?: number } | null,
  nowMs: number,
): { timerLeft: number; timerPct: number; timerLabel: string } {
  const timerLeft = timer ? Math.max(0, Math.round((timer.endsAt - nowMs) / 1000)) : 0;
  return {
    timerLeft,
    timerPct: timer && timer.total ? Math.min(100, ((timer.total - timerLeft) / timer.total) * 100) : 0,
    timerLabel: mmss(timerLeft),
  };
}

/** 히어로 부제 — **오늘이 어떤 날인가**로 세 갈래다: 배치 0 / 다 함 / 진행 중.
 *
 *  ⚠ 컴포넌트로 뺀 이유(2026-08-20): 여기가 3중 중첩 삼항이었고 각 가지가 또 자기 분기를 품어,
 *  이 한 블록이 `TodaySignature` 인지복잡도의 큰 몫이었다. **`<div className={S.heroSub}>` 은
 *  호출부에 남겨** 이 컴포넌트가 그 안의 내용만 그대로 낸다 — 래퍼가 하나도 안 늘어난다(§15-4).
 *
 *  ── W19 완료 날은 **단일 포커스**다(2026-07-31) ──────────────────────────
 *  종전엔 클릭 가능한 '다음 걸음'이 최대 11개였고 그중 5개가 **다른 탭으로 흩어졌다**
 *  (프런티어→숙달도 · 복습 위험→리뷰 · 보충→기록 …). 다 한 사람에게 갈 곳 다섯을 늘어놓는 것은
 *  동력이 아니라 목록이다. → **내일 한 줄 + 지금 가장 값나가는 것 하나**. 나머지는 사라진 게
 *  아니라 레일 아래 '오늘 밖' 구역(W18)이 이미 같은 신호를 같은 자리에서 말한다.
 *  ⚠ **momentum 을 셧다운 뒤로 옮기지 않았다** — 셧다운을 안 누르는 사용자에게 영원히 안 보이게
 *  되고, 그건 `dayPhase.ts` 가 경고한 함정을 반대 방향으로 밟는 것이다(자리를 옮기는 게 아니라
 *  **수를 줄이는** 것이 이 안이다). */
const NEXT_TO: Record<string, string> = { review: '/review-run', backlog: '/day', frontier: '/mastery' };

function HeroSubline(p: {
  todayTotal: number;
  hasItems: boolean;
  allDone: boolean;
  tmrNew: { name: string } | undefined;
  nextStep: NextStep | null;
  go: (to: string) => void;
  heroSub: string;
  focus: FocusEntry | null;
  focusReason: string;
  locked: boolean;
  ds: string;
  setFocusLock: (v: { ds: string; key: string } | null) => void;
}): React.JSX.Element {
  if (p.todayTotal === 0)
    return p.hasItems ? (
      // §7: 히어로 중복 CTA(.mChip) 제거 — 안내 텍스트만. '오늘 계획 짜기'는 아래 큰 버튼 단일.
      <span>오늘은 배치된 블록이 없어요</span>
    ) : (
      <>학습 항목을 추가하면 오늘의 흐름이 그려져요.</>
    );
  if (p.allDone)
    return (
      <span className={S.momentum}>
        {p.tmrNew ? (
          <span className={S.chapter}>내일 · {p.tmrNew.name}</span>
        ) : (
          <span>내일 일정은 아직 비어 있어요</span>
        )}
        {p.nextStep && (
          <button
            type="button"
            className={S.mChip}
            onClick={() => p.go(NEXT_TO[p.nextStep!.kind]!)}
            aria-label={p.nextStep.aria}
          >
            {p.nextStep.label}
          </button>
        )}
      </span>
    );
  return (
    <>
      <span className={S.chapter}>{p.heroSub}</span>
      {/* D-5 — "왜 이것인가". 고르는 함수가 이유까지 돌려주므로 화면과 규칙이 갈릴 수 없다. */}
      {p.focusReason && <span className={S.why}>{p.focusReason}</span>}
      {/* A-13 — 확정 토글. ⚠ **앱이 자동으로 잠그지 않는다**: 그러면 또 하나의 알고리즘이 되고,
          이 항목이 고치려는 것은 *알고리즘이 자꾸 말을 바꾸는 것*이다.
          ⚠ 해제는 같은 버튼이다(상태를 두 곳에 두지 않는다). */}
      <FocusLockButton
        focus={p.focus}
        locked={p.locked}
        onToggle={(k) => p.setFocusLock(k ? { ds: p.ds, key: k } : null)}
      />
    </>
  );
}

export function TodaySignature({ onOpenMore }: { onOpenMore: (focus?: 'ritual') => void }) {
  const state = useApp((s) => s.state);
  const ankiLive = useRuntime((s) => s.cache._ankiLive);
  const res = useSchedule();
  const toggleDone = useApp((s) => s.toggleDone);
  const navigate = useNavigate();
  /* ⚠ 반환을 **명시로 `void`** 로 만든다(C051 · 2026-08-22). `navigate` 는 Promise 를 주는데
     이 값을 받는 계약(`:289`·`:965`)은 `(to: string) => void` 다 — 즉 타입이 이미 «떠 있는
     Promise» 를 말하고 있었고, 타입 인지 린트를 켜기 전까지 아무도 그것을 못 봤다.
     한 곳에서 닫으면 두 소비처(`chromeFor`·`buildBeyondStrip`)가 함께 낫는다. */
  const go = (to: string): void => void navigate(to, { viewTransition: true });
  // "오늘 계획 짜기" — 목적지를 **결정론적으로** 고정한다. 예전엔 `/plan-host`로만 보내 캘린더의
  // 영속 뷰(schedView·기본 week)에 그대로 떨어졌다 → '오늘'을 요청했는데 주 격자(혹은 지난번 아무 뷰)가
  // 열려 첫 화면이 매번 달랐다(재설계 사상 "0.5초에 요지" 위반).
  // 탭 경계를 넘는 드릴다운 규약(v4)을 그대로 따른다: 날짜는 딥링크(?ds=), **뷰 전환은 보내는 쪽에서 먼저**
  // — 받는 쪽 effect에서 setState로 되받으면 캐스케이드 렌더가 된다(린트가 막는 패턴 · Alloc.onOpenDay와 동형).
  // 일반 진입(나브 '계획'·⌘K·g p)은 여전히 영속 뷰를 존중한다(v4 "기본 착지=캘린더 주 뷰") — 결정론은
  // 의도가 '오늘'로 명시된 이 경로에만 건다.
  const goPlanToday = () => {
    /* ⚠⚠ 종전엔 여기서 `setSchedView('day')` 를 **먼저** 불렀다 — 뷰가 영속 토글이라 주소로는
       말할 방법이 없었기 때문이다. C029 가 그 상태를 **주소로 올렸으므로**(`?span=`) 이제
       의도가 링크 안에 전부 들어간다: 새 딥링크 입구가 생겨도 «그 한 줄»을 기억할 필요가 없다. */
    void go(`/schedule?ds=${todayISO(state)}&${SPAN_PARAM}=day`); // '오늘'은 앱 단일 출처(_today 시드 존중)
  };

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
  /* A-13(W7) — **오늘의 확정**. 히어로 입력이 전부 시간 의존이라 하루에 여러 번 바뀌었고,
     그건 *"결정이 끝나 있다"* 는 이 화면의 약속과 정반대다. 판정은 `lib/focusState` 가 하고
     여기는 저장된 키만 넘긴다(날짜가 다르면 무효 — 어제 확정이 오늘을 붙들지 않게). */
  const focusLock = useUI((st) => st.ui.focusLock);
  const setFocusLock = useUI((st) => st.setFocusLock);
  const lockedKey = lockedKeyFor(focusLock, ds);
  const { entries: enriched, current, focus, reason: focusReason, locked } = selectTodayFocus(state, nowMin, lockedKey);
  const todayDone = enriched.filter((e) => e.done).length;
  const todayTotal = items.length;

  const pending = enriched.filter((e) => !e.done);
  const allDone = todayTotal > 0 && pending.length === 0;

  /* ⚠ **히어로의 `다음 ·` 줄이 여기서 사라졌다**(P-6 · 2026-08-01). 히어로의 선택 기준이 시각에서
     급함으로 바뀌었으므로(`focusState.ts`) 히어로 안에서 "다음"을 시각 순으로 말하면 **한 위젯이
     두 개의 다른 정렬을 동시에 주장한다.** 시각 순서는 흐름 레일(`FlowRail`)이 온전히 갖는다 —
     원칙 ③(시그니처는 페이지마다 하나)과 같은 논증이고, 여기선 정렬 축이 그 대상이다. */

  /* E8 — 주(週) 누적 시간 계산이 여기서 사라졌다(스트립의 `이번 주 N h` 와 함께). 그건 오늘의
     판단이 아니라 주의 조망이고, `/schedule` 이 그 질문을 통째로 소유하는 화면이다. 매일 7일을
     순회하던 비용과 `useCountUp` 훅 하나도 같이 없어진다. */

  const due = dueOf(ankiLive);
  const ankiFresh = ankiFreshness(ankiLive, ds); // 이 숫자가 오늘 것인가(캐시라 어제 것일 수 있다)
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
  const freeLeftMin = freeMinAfter(freeIntervalsOf(state, ds, today, L), nowMin);
  // A2 — 회상 카드(내 과거 요약을 인출 연습으로). 후보 없으면 null.
  const recall = pickRetrieval(state, ds);
  /* ⚠ `recallN`('회상 N개 대기')이 여기 있었다 — **W19 에서 완료 화면의 다음 걸음을 하나로
     좁히며 사라졌다.** 회상 카드 자체는 레일 아래에 그대로 있고, 그 옆의 대기 수는 카드가
     이미 존재한다는 사실을 한 번 더 말할 뿐이었다(한 양 = 한 자리). */
  // 회상 카드가 바뀌면(새 날짜·다른 요약) 정답 공개를 초기화 — 다음 카드가 답이 열린 채 뜨는 인출연습 무력화 방지.
  // effect 대신 렌더 중 조건부 setState(React 권장 · 이 코드베이스의 draftFor 관용과 동일).
  /* 카드 정체성 — **`RetrievalSlot` 의 `key`** 다. 종전엔 이 값으로 부모가 직접 공개 여부를
     되돌렸는데(파생 상태 방어 2종 + 렌더 중 setState), 리마운트가 그걸 구조로 대체했다. */
  const recallKey = recall ? `${ds}|${recall.summary.name || ''}` : '';
  // A4 — 완료 후 다음 동력: 내일 첫 학습 + 복습 위험(개념 간격반복).
  const tmrNew = byDs[iso(addDays(today, 1))]?.items.find((it) => it.type === 'new');
  /* ⚠ 메모된 셀렉터를 쓴다(S6 · 2026-07-31 `/감사 근본`) — `selectRiskSummary` 가 정확히 이 호출을
     위해 존재한다(`store/selectors.ts` 주석: _"사이드바가 유일한 무조건 호출부였다"_ 의 재발).
     이 컴포넌트는 집중 세션 중 `useAdaptiveTick(1000)` 으로 **초당 리렌더**하므로 전수 스캔이
     초당 한 번 돌고 있었다. 캐시 키가 `reviewTouches`·볼트 앵커 버전까지 포함하므로 값도 더 정확하다. */
  const risk = selectRiskSummary(state);
  const riskN = risk.overdue + risk.due;
  // I-8 — 프런티어 다음 추천(지식엔진 frontier). 백엔드 사용 가능 시에만 페치(mastery와 KNOWLEDGE_KEY 캐시 공유,
  // 신규 IO 최소). 후보 없거나 미연결이면 frontier=null → 렌더 안 함.
  const ping = usePing();
  const know = useKnowledge(ping.isSuccess).data;
  const frontier = frontierNext(know);
  const frontierTitle = frontierLabel(frontier);
  // I-10 — 착각 재확인 카드: conf('확신했지만 틀림') 선 과거 오답 1건(날짜 해시로 하루 회전). 후보 없으면 null.
  const confWrong = pickConfidentWrong(state, ds);
  const confWrongN = confWrong ? confidentWrongCount(state, ds) : 0;

  // 마감 임박(스트립) + 가장 가까운 마감(상단 리드아웃). 파생 로직은 lib/scheduleView.deadlineDdays로 위임.
  const ddays = deadlineDdays(res.itemStat, ds);
  const soon = ddays.filter((st) => st.dday <= 14).slice(0, 3); // 14=D-day 임박 임계 · 3=스트립 최대 표시
  const nearestDday = ddays[0]?.dday ?? null;

  // 오늘의 흐름 노드 — 학습(체크 가능)+일과 블록을 시간순 단일 리스트로(무지개 가로 트랙 폐기).
  const tl = L?.tl || [];
  type EnrichedItem = (typeof enriched)[number];
  /* ── E9 "오늘 밖"을 오늘 것처럼 그리지 않는다 + W6 그 판정을 **문장으로** ────────────
     판정은 `lib/dayCapacity` 하나가 소유한다(옮긴 이유·규칙·비대칭은 그 파일 머리주석).
     여기선 블록을 그 함수가 아는 형태로만 바꿔 넘긴다. */
  const cap = dayCapacity(
    enriched.map((e) => ({
      key: 'study|' + completionKey(e.it.sid, e.it.type),
      start: e.start,
      min: e.it.min || 0,
      done: e.done,
      name: e.it.name,
      color: e.it.color,
    })),
    freeLeftMin,
    /* 7-I4 — 오늘 배정된 미완 할 일 중 **소요를 적은 것**을 창에서 먼저 뺀다.
       ⚠⚠ **N-1(W8)이 이 인자의 뜻을 좁혔다**: 이제 시각이 박힌 과제는 `freeWindowsForDay` 가
       구간으로 이미 빼므로(= `L.free` 안에 반영돼 있다) 여기서는 **시각 없는 것만** 넘긴다.
       종전 값(`choreMinForDay`)을 그대로 두면 타임박스한 과제가 두 번 깎인다. */
    untimedChoreMin(state, ds),
    /* A-11(W7) — **실측 배율을 아침 문장에 먹인다.** 배율은 지금까지 과목 상세에만 있었고
       (`/items` → 카드 → 상세 = 3화면·2클릭) 오늘 화면과 연결이 0이었다 — 앱이 "내 추정이 20%
       낙관적이다"를 알면서 아침에 한 번도 말하지 않았다.
       ⚠ **오늘 계획된 과목들의 가중 평균**이다: 오늘 실제로 걸린 것을 말하려면 오늘 하는
         과목의 배율이어야 하고, 전 과목 평균은 안 하는 과목의 오차까지 오늘에 얹는다.
       ⚠ 표본이 얇은 과목은 `subjectCalibration` 이 `null` 을 준다 → 그 과목은 배율 1로 센다
         (모르는 것을 1이 아닌 값으로 채우면 그게 곧 지어낸 근거다). */
    todayEstimateRatio(state, enriched),
  );
  const { beyondKeys } = cap;
  /* 분모는 **오늘 가능한 것**이다(E9). 종전엔 `todayTotal` 이라, 남은 창에 안 들어가는
     블록까지 목표에 넣고 매일 그 목표에 못 미쳤다 — 게이지가 매일 지는 게임을 그린 셈이다.
     ⚠ P-7 이 레일 필터는 없앴지만 이 분모는 **그대로 둔다**: 저건 "안 보여준다"였고 이건
     "오늘 목표가 무엇인가"라, 같은 `beyondKeys` 를 쓰지만 다른 질문이다. */
  const todayPossible = Math.max(todayDone, todayTotal - beyondKeys.size);
  /* E15 — 완료 수가 바뀌면 그 숫자가 스스로 번쩍인다(`commit` 어휘). 마운트엔 안 번쩍인다. */
  const doneRef = useCommitOnChange(todayDone);
  /* ⚠ `pct`(링 호 길이)가 여기 있었다 — P-7 에서 링과 함께 사라졌다. 진행률을 다시 그리고
     싶어지면 먼저 "왜 `DayBar` 로 부족한가"를 적을 것(시그니처는 페이지마다 하나 · 원칙 ③). */

  /* ⚠⚠ **레일에서 '오늘 밖' 블록을 지우던 필터가 P-7 에서 사라졌다(2026-08-01).**
     종전엔 `dayCapacity` 가 접은 블록을 여기서 **조용히 제외**했고, 화면에 남는 흔적은 14px
     한 줄(`fitLine`)뿐이었다 — 무엇이 잘렸는지 보려면 `/schedule` 로 1클릭·2화면이었다.
     그리고 기준이 "시각이 늦은 것"이라 **마감 D-1 과목이 오후 배치면 그게 잘렸다.**
     이제 `DayBar` 가 그 컷을 **창 밖으로 삐져나온 칸**으로 명시적으로 그리므로, 레일에서까지
     지울 이유가 없다(지우면 막대가 가리키는 것을 레일에서 못 찾는다). */
  const flowNodes: FlowNode<EnrichedItem>[] = [
    ...enriched
      .filter((e) => e.start != null)
      .map((e): FlowNode<EnrichedItem> => ({
        key: 'study|' + completionKey(e.it.sid, e.it.type),
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
    toast(`${e.it.name} — 기록 프리필됨`, 'info');
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
    underway: !!current,
  });
  const closing = phase === 'closing';
  /* ── P-15 국면이 서로의 객체를 지운다(2026-08-01) ─────────────────────────────
     종전엔 국면 의존 렌더가 **셋뿐**이었다(`Presets` !closing · `ShapeLine` closing ·
     `CloseDayCta` closing) — 즉 *낮 화면이 기본이고 마감에서 둘이 붙었다 떨어질 뿐*이었고,
     히어로에 동시 존재 가능한 표면이 18~19개였다.

     배분 규칙은 취향이 아니라 **그 표면이 답하는 질문이 이 국면의 질문인가** 하나다:
       · opening("오늘 무엇부터") — 하루를 *여는* 회고(어제 한 줄 · On This Day)가 여기 산다.
         두 번째 블록(`upNext`)과 길이 대안(`Presets`)은 아직 첫 번째도 안 열었으므로 없다.
       · run("지금 이것")         — 실행 도구가 산다. 여는 회고는 실행 중엔 소음이라 빠진다.
       · closing("오늘 어땠나")   — 오늘의 모양·하루 닫기. 오늘 안 할 것(`upNext`)은 없다.

     ⚠ **인출 카드는 어느 국면에서도 안 지운다.** `todaySlots.ts` 가 그 값어치를 명시적으로
     방어해 뒀다(_"슬롯을 없애면 이 앱이 만드는 학습 증거가 함께 준다"_) — 아침에 안 그리면
     그날 우발적 인출 한 장이 통째로 사라지고, 그건 국면 분리가 사려던 것보다 비싸다. */
  /** 하루를 *여는* 회고 — 여는 국면에만. 실행 중·닫는 중엔 같은 문장이 소음이다.
   *  ⚠⚠ **빈 날을 함께 넣는다.** `dayPhase` 는 `todayTotal <= 0` 을 'run' 으로 답하는데
   *  (_"빈 날은 닫을 하루가 없다"_), 그건 *닫기* 관점의 답이지 여는 관점의 답이 아니다 —
   *  배치가 0인 날의 질문은 정확히 "오늘 무엇을 할까"이고 그게 여는 국면의 질문이다.
   *  이 한 줄이 없으면 **아무것도 계획되지 않은 날에 어제 한 줄·회고가 통째로 사라진다**
   *  (실렌더 확인이 잡았다 — `today · onthisday` 스냅샷이 빈 히어로로 떨어졌다).
   *  ⚠ `dayPhase` 자체를 고치지 않는 이유: 'opening' 을 빈 날까지 넓히면 `Presets`·`upNext`
   *  같은 *실행* 분기까지 그 판정을 따라가는데, 빈 날엔 실행할 대상이 애초에 없어 무의미하고
   *  그 함수의 계약(_"빈 날은 닫을 하루가 없다"_)만 흐려진다. 판정은 그대로 두고 **이 화면이
   *  자기 문장에 대해** 범위를 정한다. */
  const showOpeningRecall = phase === 'opening' || todayTotal === 0;

  const { kicker, focusMin, heroMain, heroSub, dispColor } = heroCopy({
    focus,
    current,
    allDone,
    todayTotal,
  });

  /* E8 — 일일 의식 토글이 스트립에서 빠졌다. 같은 토글이 앱 안에 셋이었고(여기 · 온디맨드
     `RitualCard` · `하루 닫기` CTA), 닫는 길은 CTA 가 이미 커서까지 놓아 준다. 상태 읽기도
     그 카드가 소유한다. */

  // 집중 타이머(포모도로) — 남은 초·진행%·MM:SS(1초 틱으로 갱신). 종료 알림·완료 연결은 FocusChip이.
  const { timerPct, timerLabel } = timerView(timer, nowMs);
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
      await confirmIrreversible('집중 세션을 중단할까요? 진행 시간은 기록되지 않아요.', {
        title: '집중 중단',
        okLabel: '중단',
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
      toast('오늘 블록 완료!', 'info');
      const id = setTimeout(() => setCelebrate(false), 1400);
      return () => clearTimeout(id);
    }
    if (!allDone) wasDone.current = false;
  }, [allDone]);

  /* ⚠⚠ **여기 PL-9 스트릭 마일스톤 축하가 있었다 — 은퇴했다**(I054 · 2026-08-22 발상 축).
     I046 이 통계 탭의 게이미피케이션 셋을 지운 짝이다. 근거는 같다: 그 수의 입력(`completions`)이
     실물에서 **0행**이라 이 축하는 원리적으로 뜬 적이 없고, 뜬다면 그건 «0을 크게 그리는 것»의
     가장 강한 형태다(축하는 조망이 아니다).
     ⚠ 영속 마커 `_lastStreakCele` 도 함께 지웠다 — 축하가 없으면 «마지막으로 축하한 임계»가
     가리킬 것이 없다. 옛 저장본에 남아 있어도 zod 가 모르는 키를 버린다(무마이그레이션). */

  // 진행률·연속·마감 + 주 액션을 상단 바로 끌어올림(데모 v6 헤더).
  /* ── E23 하루 신호 기록 ────────────────────────────────────────────────
     '정적(quiet)의 설계'가 기다린 미지수는 **all-clear 빈도** 하나였다. 그 값은 그날그날의
     상태에서만 알 수 있고 지나가면 재구성이 불가능하다(항목이 지워지거나 마감이 바뀌면 과거가
     소급해 달라진다) → 관측된 시점에 남긴다.
     ⚠ deps 가 다섯 숫자다 — 값이 **바뀔 때만** 쓴다. 매 렌더에 쓰면 관측이 관측 대상보다
       비싸지고, 하루 한 번만 쓰면 "하루가 어떻게 끝났나"를 놓친다(그 둘 사이가 정확한 자리).
     ⚠ Anki 미연결은 `-1` 이다 — 0(없음)과 구분한다. `isQuiet` 이 그 차이를 쓴다. */
  useEffect(() => {
    void recordDaySignal(
      { pending: pending.length, overdue: riskN, backlog: openBl, ankiDue: due ?? -1, dueSoon: soon.length },
      ds,
    );
    void pruneDaySignals(ds);
  }, [pending.length, riskN, openBl, due, soon.length, ds]);

  /* ⚠ 크롬 설정을 **모듈 함수로 뺐다**(W7 · 2026-08-07). A-10·A-13 이 붙으며 이 컴포넌트가
     인지복잡도 래칫(62)을 넘었고, 이 블록은 그 복잡도의 큰 몫이다(중첩 삼항 넷 + 조건부 스프레드).
     응집도 맞다 — "상단 44px 과 리드아웃에 무엇을 세우나" 하나에만 답한다. */
  /* ⚠⚠ **`cap.slackMin` 이 deps 에 없으면 44px 앵커가 시간을 안 본다**(2026-08-20 리뷰 M-2).
     `chromeFor` 의 `primary`(= 이 화면 최상위 앵커)는 **오직 `cap.slackMin` 만** 읽는데, `cap` 은
     `freeMinAfter(freeIntervals, nowMin)` 파생이고 `useAdaptiveTick(30_000)` 이 30초마다 리렌더를
     강제한다. 즉 **여유는 30초마다 줄어드는데 이펙트는 안 돌아**, 상단 바가 나머지 deps 중 하나가
     마지막으로 바뀐 시점(대개 마운트)의 값을 하루 종일 붙들고 있었다. *"다음 행동을 가장 많이
     바꾸는 한 수"* 라는 이 자리의 정의가 시간에 반응하지 않으면 그 값이 없는 것이다.
     ⚠ 참조가 아니라 **스칼라**로 넣는다 — `cap` 은 매 렌더 새 객체라 참조를 넣으면 이펙트가
     30초마다 무조건 돌고, 그건 이 목록이 존재하는 이유를 없앤다.
     ⚠ 이 훅은 계약상 `exhaustive-deps` 를 끈다(`store/usePageChrome` 참조) — 즉 이 손 목록이
     유일한 방어선이다. 여기에 값을 추가할 때는 `chromeFor` 가 **실제로 읽는 것**을 세어라. */
  usePageChromeEffect(
    () => chromeFor({ cap, todayDone, todayTotal, allDone, hasItems, res, nearestDday, goPlanToday, go }),
    [cap.slackMin, todayDone, nearestDday, todayTotal, allDone, hasItems, res.adaptApplied, res.adapt],
  );

  // W20 — 오늘 띄울 인출 카드 **하나**(회전 규칙·근거는 `lib/todaySlots` 머리주석).
  const retrievalSlot = pickRetrievalSlot(!!confWrong, !!recall, parseISO(ds).getDate());

  /* ── W19 빈 날은 **1컬럼**이다(2026-07-31) ─────────────────────────────────────
     빈 날의 우측 컬럼은 링 `0/0` + LIVE 시계 + 종결 캡 + `＋` 로 **내용 0의 골격만** 유지했다.
     그리고 같은 문장이 두 자리(히어로 · 레일 빈 상태)에 **글자까지 같게** 있었고, 같은 핸들러
     `goPlanToday` 가 세 자리에 있었다.
     ⚠⚠ **판정은 `flowNodes.length === 0` 이다 — `todayTotal === 0` 이 아니다.** 후자로 잡으면
     학습 블록이 없을 뿐 **일과 블록이 있는 날**까지 컬럼을 지워, 그 날의 시간표가 통째로
     사라진다(로드맵이 이 안의 미실행 사유로 적어 둔 함정 그대로). */
  const emptyDay = flowNodes.length === 0;

  // W19 — 완료 날의 **다음 걸음 하나**(우선순위·근거는 `lib/todaySlots` 머리주석).
  const nextStep = pickNextStep(riskN, openBl, frontierTitle);
  /* ── A-10(W7) — **적재량이 아니라 오늘 몫** ────────────────────────────────────────
     이 화면은 `freeLeftMin` 을 이미 알면서도 세 신호를 **적재량**으로 말했다(`복습 12개 밀림`).
     그 12는 어떤 행동으로도 오늘 안에 0이 될 수 없어 **마비를 만든다** — 알림(A-1)이 정확히
     같은 이유로 수를 버렸는데 화면만 남아 있었다(두 표면이 같은 사실을 다르게 말한 것).
     ⚠ 판정은 순수 lib 이 한다(`lib/todayShare`) — "12가 3이 된다"는 규칙 자체가 유닛으로
       잠겨야 하고, 화면은 문장을 놓기만 한다. */
  const share = todayShare({
    overdue: riskN,
    backlog: openBl,
    freeLeftMin,
    reviewMin: reviewBlockMin(state.moduleLen || 120),
  });
  const shareText = shareLine(share);

  const toggle = (e: (typeof enriched)[number]) => toggleDone(ds, e.it.sid, e.it.type, e.it.min, !e.done);

  /* ── E8 하단 스트립 = **오늘의 판단**만 ─────────────────────────────────
     각 그룹은 *말할 것이 있을 때만* 존재한다(레일 신호와 같은 규칙 — `selectors.ts` 의 그 계약).
     전부 비면 스트립 줄 자체가 없고 히어로가 그 높이를 먹는다: 정적(quiet)이 문구가 아니라
     **레이아웃으로** 표현된다.
     ⚠ Anki 는 `due > 0` 일 때만 — `due == null`(이 기기에서 연결한 적 없음)까지 그리면 Anki 를
       안 쓰는 날마다 "연결 필요"를 외치게 되고, 그건 N-13 이 금지한 바로 그 형태다. 연결 상태의
       소유자는 연동 탭이다. */
  /* ⚠ **스트립 조립을 함수로 뺐다**(W7 · 2026-08-07). A-10·A-13 이 붙으며 이 컴포넌트의 인지
     복잡도가 래칫(62)을 넘었고, 래칫이 막으려는 것이 정확히 이것이다 — 한 함수가 화면 전체의
     분기를 다 쥐는 것. 뺀 기준은 *응집*이다: 이 덩어리는 "오늘 밖에 무엇이 있나"라는 한 질문에만
     답한다(히어로·타이머·흐름과 상태를 공유하지 않는다).
     ⚠ 컴포넌트가 아니라 **함수**인 것도 의도다 — 렌더 상태가 없고 인자만으로 결정된다. */
  /* I010 — 학사 눈금이 오늘에 닿는다. 창은 **7일**이다: 졸업탭 국면판은 21일을 보지만 그건
     «학기가 어디쯤인가»의 축이고, 여기는 «오늘 무엇이 다른가»라 3주 뒤 정정 마감이 오늘 줄에
     서면 그것은 신호가 아니라 배경이 된다. */
  const marks = upcomingMarks(state, ds, 7);
  const beyondNode = buildBeyondStrip({ soon, marks, due, ankiFresh, openBl, riskN, share, shareText, go });

  return (
    <section className={S.today} aria-label="오늘 대시보드">
      {/* ── 상단 밴드: 포커스 히어로 | 오늘의 블록 ── */}
      <div className={emptyDay ? `${S.top} grid-cols-1!` : S.top}>
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
          {/* P-7 — W6 의 판정 **문장**이 여기 있었다. 같은 판정을 이제 길이로 말한다(`DayBar`).
              문장은 사라진 것이 아니라 막대의 `aria-label` 이 됐다 — 길이로 옮긴 것을 SR 이
              못 읽으면 그건 이전(移轉)이 아니라 손실이다. */}
          <DayBar
            segments={cap.segments}
            scaleMin={cap.scaleMin}
            windowRatio={cap.windowRatio}
            fitLine={cap.fitLine}
            beyondMin={cap.beyondMin}
          />

          <h2 className={S.subj}>{heroMain}</h2>
          <div className={S.heroSub}>
            <HeroSubline
              todayTotal={todayTotal}
              hasItems={hasItems}
              allDone={allDone}
              tmrNew={tmrNew}
              nextStep={nextStep}
              go={go}
              heroSub={heroSub}
              focus={focus}
              focusReason={focusReason}
              locked={locked}
              ds={ds}
              setFocusLock={setFocusLock}
            />
          </div>
          {/* A1 — 어제 남긴 '내일 한 줄'.
              ⚠ P-15 — **하루를 여는 국면에만.** 종전엔 완료 전까지 하루 종일 떠 있었는데, 이건
              *어제의 나에게서 온 메모*라 오늘을 여는 순간에 값이 있고 세 시간 뒤엔 소음이다. */}
          {prevNote && showOpeningRecall && (
            <div className={S.yesterday}>
              <Icon name="moon" /> 어제 남긴 한 줄 —{' '}
              <b className="font-bold text-[color:var(--yesterday-b)]">{prevNote}</b>
            </div>
          )}
          <ShapeLine state={state} ds={ds} when={closing} />
          {/* ID-4 — On This Day 회고: 달력상 같은 날의 과거 실기록 한 줄(회상 카드와 달리 달력 정합).
              ⚠ P-15 — 같은 이유로 여는 국면에만. 이것도 *과거를 여는* 문장이다. */}
          {onThis && showOpeningRecall && (
            <div className={S.yesterday}>
              <Icon name="calendar" /> {onThis.offsetLabel} —{' '}
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
                <span className={S.ctaCap}>
                  {timer.kind === 'break' ? (
                    <>
                      <Icon name="coffee" /> 휴식 · ■ 정지
                    </>
                  ) : (
                    '■ 정지'
                  )}
                </span>
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
                  <span className={S.ctaGo}>
                    <Icon name="play" /> 집중 시작
                  </span>
                  <span className={S.ctaCap}>{focusMin}분</span>
                </button>
                {/* N-5 — 못 한 채로 끝나는 날. 남은 창이 0인데도 화면은 계속 "집중 시작"만
                    크게 띄우며 있지도 않은 시간을 쓰라고 했다. 시작을 **지우지는 않는다**
                    (밤샘은 사용자의 선택이다) — 닫는 길을 옆에 낼 뿐이고, 그래서 채움 버튼은
                    여전히 하나다(D-6 액센트 예산). */}
                {/* ⚠ P-15 — 여는 국면에도 안 그린다. 25·50분은 *기본 길이를 바꾸는* 도구인데,
                    아직 한 번도 안 시작한 시점의 기본은 블록이 정한 길이(`focusMinutes`)가 맞다.
                    고를 것을 먼저 보여 주면 여는 화면의 질문이 "무엇부터"에서 "몇 분"으로 바뀐다. */}
                <Presets focusMin={focusMin} onPick={startTimer} when={phase === 'run'} />
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
            {/* E7 — 히어로 시계를 뗐다. 바로 아래 흐름 헤더가 `● 09:00 LIVE` 로 **같은 문자열**을
                이미 말하고 있었다(한 양이 두 자리). 시각의 소유자는 흐름 헤더 하나다. */}
          </div>
          {/* 빈 날엔 '오늘 밖' 신호가 히어로 아래로 내려온다(W19) — 컬럼을 접으면서 이 신호까지
              사라지면 마감·Anki·보충이 **가장 한가한 날에만 안 보이는** 뒤집힌 상태가 된다. */}
          {emptyDay && beyondNode}
        </div>

        {/* 오늘의 흐름 — now-중심 세로 레일(학습 체크 + 일과, 색 통일). 무지개 트랙 폐기.
            ⚠ 빈 날엔 **그리지 않는다**(W19) — 링 0/0·LIVE·종결 캡·＋ 는 내용 0의 골격이고,
            골격만 남은 컬럼은 "여기 뭔가 있어야 한다"고 말하는 유령이다. */}
        {!emptyDay && (
          <aside className={S.flow}>
            <h2 className={S.flowHead} aria-label={`오늘의 흐름 ${todayDone}/${todayPossible} 완료`}>
              {/* ⚠⚠ **여기 `ProgressRing` 이 있었고 그 한가운데 `3/7` 이 겹쳐 있었다 — P-7 에서
                  **링을** 지웠다(숫자가 아니라).**

                  로드맵은 "링의 중복 숫자"를 지우라고 적었고 처음엔 그렇게 했는데, **실렌더
                  확인**(§15-4)이 그게 틀렸음을 보여 줬다: 숫자 없는 34px 링은 진행 0%인 아침에
                  **빈 원**이라 로딩 스피너처럼 읽혔고, 분모(오늘 몇 칸인가)를 말할 자리가 통째로
                  사라졌다. 로드맵도 그 가능성을 적어 뒀다 — _"링 숫자 제거가 첫 걸음이지만
                  충분하지 않을 수 있다."_

                  같은 원칙(한 양 = 한 부호화 · 시그니처는 페이지마다 하나)을 반대쪽으로 적용한다:
                  **길이 그래픽은 위 `DayBar` 하나**가 갖고, 여기는 세는 것만 남긴다. 34px 도넛은
                  애초에 약한 그래픽이었고(NN/g 가 게이지·도넛을 비권장한 그 형태다) 막대가
                  들어온 이상 둘을 같은 화면에 둘 이유가 없다.
                  ⚠ E15 의 `commit` 번쩍임과 완주 셀레브레이션은 이제 **숫자 자리**에서 난다 —
                    값이 바뀐 그 자리다(`useCommitOnChange` 머리주석의 원래 의도 그대로). */}
              <span
                ref={doneRef}
                className={`${S.ringNum}${celebrate ? ' animate-[commit-cele_var(--dur-cele)_var(--ease)] motion-reduce:animate-none' : ''}`}
                aria-hidden="true"
              >
                {todayDone}
                <small className={S.ringNumSmall}>/{todayPossible}</small>
              </span>
              <span className={S.flowT}>오늘의 흐름</span>
              <span className={S.now}>● {toHM(nowMin)} LIVE</span>
            </h2>
            <div className={S.rail}>
              {flowNodes.length ? (
                <FlowRail
                  nodes={flowNodes}
                  nowMin={nowMin}
                  onToggle={toggle}
                  onFocus={startNodeFocus}
                  onPrefill={prefillNode}
                />
              ) : (
                /* ⚠ 여기 히어로와 **글자까지 같은 문장** + 같은 핸들러(`goPlanToday`)가 또 있었다 —
                 W19 에서 빈 날 컬럼 자체가 사라지며 도달 불가가 됐다. 이 분기는 `flowNodes` 가
                 비었는데 `emptyDay` 가 아닌 경우(있을 수 없다)의 안전망으로만 남긴다. */
                <div className={S.railEmpty}>오늘 그릴 흐름이 없어요.</div>
              )}
            </div>
            {/* ── W20 인출 슬롯은 **하나**다(2026-07-31) ────────────────────────────────
                종전엔 `🧠 회상`과 `⚠ 착각 재확인`이 **같은 `S.recall` 형상**으로 나란히 뜰 수
                있었고(둘은 태그 색만 다르다) 그 위에 `복습 N개 밀림` 칩이 또 있었다 — 최대 3
                입구. 같은 모양이 셋이면 그건 카드가 아니라 목록이다.

                ⚠⚠ **미실행 사유가 이 구현의 제약이다**: 홈의 인출 카드는 "가려던 게 아닌데 하게
                되는" **우발적 인출**이 값어치라, 슬롯을 없애면 이 앱이 만드는 학습 증거가 함께
                준다. 그래서 **없애지 않고 하루 한 장으로 회전**시킨다 — 두 소스 다 이미 날짜
                해시로 후보를 고르므로(`pickRetrieval`·`pickConfidentWrong`) 회전이 그 규칙의
                연장이고, 매일 한 장은 계속 뜬다(우발적 인출의 빈도가 유지된다).
                ⚠ 착각이 있으면 착각이 이긴다 — "확신했는데 틀린 것"은 회상보다 늦게 발견될수록
                비싸다(그쪽만 오답으로 이미 관측된 사실이다). 회상은 그 다음 날 온다. */}
            {/* F5 추출(2026-08-06) — 카드 두 장의 마크업이 여기 70줄로 있었고, 그와 함께
                `recallShown`·`recallKeyShown`·**렌더 중 조건부 setState** 셋이 이 컴포넌트에
                살았다. 셋 중 둘은 오로지 첫째를 리셋하려고 있던 것이라 `key` 리마운트가 통째로
                대체한다(`SummaryEditor` 가 세운 F5 선례와 같은 수법).
                ⚠ `key={recallKey}` 가 그 계약이다 — 빼면 카드가 바뀌어도 정답이 펼쳐진 채 남는다. */}
            <RetrievalSlot
              key={recallKey}
              slot={retrievalSlot}
              recall={recall}
              confWrong={confWrong}
              confWrongN={confWrongN}
              onGo={go}
            />
            {!emptyDay && beyondNode}
            <button type="button" className={S.more} onClick={() => onOpenMore()}>
              ＋ 블록 상세 · 일일 의식 · 흐름 가이드
            </button>
          </aside>
        )}
      </div>
    </section>
  );
}

/** 상단 크롬(44px 앵커 + 리드아웃 + 액션) — 위 컴포넌트에서 뺀 설정부. 근거는 그 호출부 주석. */
function chromeFor(p: {
  cap: ReturnType<typeof dayCapacity>;
  todayDone: number;
  todayTotal: number;
  allDone: boolean;
  hasItems: boolean;
  res: ReturnType<typeof useSchedule>;
  nearestDday: number | null;
  goPlanToday: () => void;
  go: (to: string) => void;
}) {
  /* ⚠ `todayDone`·`nearestDday` 는 **deps 로만** 쓰인다(E7 이 그 둘을 상단에서 뗐다 — 각각
     흐름 헤더의 링과 하단 '마감 임박' 이 소유자다). 인자로 받는 이유는 호출부의 deps 와 이
     함수의 입력이 갈리지 않게 하기 위함이고, 그 사실을 여기 적어 둔다. */
  const { cap, todayTotal, allDone, hasItems, res, goPlanToday, go } = p;
  return {
    /* ⚠⚠ **Q-2 에서 뒤집혔다(2026-08-02).** 종전 주석은 _"이 화면은 렌즈라 44px 앵커를 세우지
         않는다 — 잊은 것이 아니라 없다고 정한 것이다"_ 였는데, 그 판단의 대가가 뒤늦게 드러났다:
         **오늘의 여유는 화면에 문자가 0자였다.** 값은 이미 계산돼 있었지만(`dayCapacity`) 막대의
         `aria-label` 로만 존재해서, 눈으로 읽을 방법이 없었다(P-7 이 길이로 옮기며 생긴 사각).
         `오늘 여유 1.2h` 는 이 화면에서 **다음 행동을 가장 많이 바꾸는 한 수**다 — 그게 곧 44px
         앵커의 정의이므로 여기 선다.
         ⚠ 할 일이 없으면 여전히 `null` 이다(`slackMin === null`) — 말할 것이 없으면 안 그린다. */
    primary:
      cap.slackMin == null
        ? null
        : // ⚠ `value` 는 **문자열**이고 단위는 `unit` 이다 — 이 자리는 한 값이지 조판이 아니라는
          //   것이 `ChromePrimary` 의 명시 계약이다(ReactNode 를 받으면 탭마다 조판이 갈린다).
          {
            label: cap.slackMin >= 0 ? '오늘 여유' : '오늘 초과',
            value: String(hNum(Math.abs(cap.slackMin))),
            unit: 'h',
          },
    /* ── E7 한 양 = 한 자리(2026-07-29) ────────────────────────────────
         평일 낮 이 화면의 상시 숫자 26개 중 다음 행동을 바꾸는 것은 5개인데, **6개 양이
         15자리에서** 렌더되고 있었다. 여기서 뗀 둘은 각각 이미 소유자가 있다:
         · 진행률 → 흐름 헤더의 `ProgressRing`(호(弧) + `3/7`)이 두 표현으로 말한다.
         · 마감   → 하단 스트립 '마감 임박'이 D-day 와 **이름까지** 말한다(같은 `ddays[0]`).
         ⚠ 마감을 상단에서 떼면 급한 D-day 를 보려고 시선이 하단까지 내려간다 — 대신 이 화면은
           무스크롤이라 내려갈 거리가 화면 안이고, 스트립은 E8 에서 *있을 때만* 그린다(0인 날은
           아예 없으므로 마감이 떠 있으면 그 자체가 신호다). */
    readouts: [
      /* ⚠ `연속`(스트릭) 리드아웃이 여기 있었다 — I054 가 지웠다(위 축하 주석이 근거의 SSOT).
         I046 이 통계 탭에서 같은 자리를 「밀린 복습」에 준 것과 짝이다. 여기서는 그 자리를
         **비운다**: 이 화면의 상단은 이미 히어로가 «지금 무엇을»을 44px 로 말하고 있고,
         빈 칸을 급히 채우는 것이 이 저장소가 반복해 온 «표면을 하나 더» 다. */
      /* ⚠ `남은 가용` 리드아웃이 여기 있었다 — **W6 이 흡수했다.** 30px 로 크게 그리면서도
           그 수 혼자서는 "오늘 안에 들어가는가"를 못 말했고(사용자가 남은 계획과 대각선으로
           눈을 이어 뺄셈을 했다), 지금은 히어로 아이브로 아래 한 줄이 두 수를 **판정과 함께**
           말한다. 값은 사라지지 않았고 자리와 문법이 바뀌었다. */
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
          ? { label: '기록 보기', onClick: () => go('/day') }
          : /* ⚠ D-6 — 여기 '지금 시작 →' 네온 버튼이 있었다. 히어로의 '▶ 집중 시작'과 **거의 같은
                 동작**을 하면서 화면 대각선 반대쪽에 앉아, 한 화면에 채움 버튼이 둘이었다.
                 액센트 예산은 채움 1개다 → 오늘 탭에서 상단 액션을 비운다(진행 중 세부 패널은
                 흐름 카드의 '+ 블록 상세…'가 연다). 빈 날·완주 화면의 액션은 히어로에 짝이 없어
                 남긴다 — 중복이 아니라 그 화면의 **유일한** 다음 걸음이다. */
            undefined,
  };
}
