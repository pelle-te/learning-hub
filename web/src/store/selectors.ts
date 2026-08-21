/* ============================================================
   selectors.ts — 파생 상태(메모이즈드 셀렉터). 스케줄은 매 렌더 재계산하지 않고
   입력(state)이 바뀔 때만 재계산한다(설계도 §1-A).
============================================================ */
import { schedule, studyMinByWeekday } from '@/lib/scheduler';
import { pickFocus, todayEntries, type FocusEntry, type FocusPick } from '@/lib/focusState';
import { riskSummary } from '@/lib/spacedReview';
import { vaultAnchorsVersion } from '@/lib/vaultAnchors';
import { isDone } from '@/lib/persistence';
import { openBacklog } from '@/lib/methodology';
import { dueQuestions } from '@/lib/questions';
import { dayDiff, todayISO } from '@/lib/utils';
import { resolveTheme } from '@/lib/uiState';
import type { AppState, ScheduleResult, Theme } from '@/lib/types';
import { useApp } from './useApp';
import { useUI } from './useUI';

/* 모듈 레벨 1-엔트리 캐시. schedule은 state의 순수 함수이므로 그 입력 슬라이스가 그대로면 결과도 같다.
   컴포넌트별 useMemo와 달리 캐시가 인스턴스 간 공유돼, 한 탭에서 여러 소비처(RitualCard·TodayBlocks 등)가
   useSchedule을 불러도 무거운 schedule()은 입력 버전당 정확히 한 번만 실행된다. 설계도 §1-A.

   ⚠ 캐시 키 = 루트 참조가 아니라 schedule()이 실제 읽는 슬라이스 튜플. 루트 참조로 캐시하면 Journal/Review의
   무관한 쓰기(summaries·cbms·backlog·weekly·rituals — schedule과 무관)마다 immer가 새 루트를 만들어 캐시가
   깨지고 무거운 schedule()이 헛돌았다(AN-16). immer는 안 바뀐 슬라이스의 참조를 보존하므로, 무관 슬라이스만
   바뀌면 튜플이 동일 → 캐시 히트. **불변식: 이 목록은 scheduler.ts가 읽는 state.* 슬라이스 전량과 일치해야
   한다** — scheduler가 새 슬라이스를 읽으면 여기에도 추가할 것(누락 시 그 슬라이스 변경에 stale).

   ⚠ 이 불변식은 예전엔 주석으로만 지켜졌다(누락 시 조용히 stale 스케줄 → 전탭 오작동, 무증상). 이제
   `test/invariants.test.ts`가 schedule()이 실제 읽는 최상위 슬라이스 ⊆ SCHEDULE_INPUT_KEYS를 Proxy로
   검증한다 — scheduler가 새 슬라이스를 읽는데 여기 없으면 테스트가 즉시 실패한다(불변식의 기계적 잠금). */
export const SCHEDULE_INPUT_KEYS = [
  'items',
  'routine',
  'dayOverrides',
  '_knowState',
  'graphPriority',
  'adaptiveCapacity',
  'completions',
  'startDate',
  'moduleLen',
  'reviewRatio',
  'reviewViaAnki',
  'blankReviewWeekly',
  'mockEveryWeeks',
  'peakStart',
  'peakEnd',
  '_today',
  /* ⚠⚠ **I-6(W7 · 2026-08-07)이 이 줄을 필요하게 만들었다.** `graphPriority` 를 기본 on 으로
     뒤집자 불변식 ①이 **그 자리에서** 잡았다: 켜진 스케줄러는 `priority.ts` 를 통해 `cbms`(오답
     기록)를 읽는데 이 목록에 없어서, **오답을 남겨도 계획이 다시 계산되지 않는** 상태였다.
     즉 기본값이 off 인 동안 그 결함은 **원리적으로 관측되지 않았다** — 스위치를 켜는 것이
     비로소 검사망에 도달시킨 것이고, 그게 "켜야 작동하는 상태로 남기지 말라"는 I-6 의 논거를
     한 번 더 실증한다(꺼진 배선은 검사도 못 받는다). */
  'cbms',
  'blankResults', // ②#23 복습 사다리 적응 — latestBlank가 읽는다(백지 결과 갱신 시 재스케줄)
  'dayPlans', // §4-2 일일 배치 오버라이드 — applyDayPlans가 읽어 manual인 날 items를 치환(변경 시 재스케줄)
  'events', // Wave 5 일정 — dayStudyMin/freeWindowsForDay가 읽어 가용시간을 깎는다(일정 추가 시 재스케줄)
  /* ⚠⚠ **N-1(W8 · 2026-08-07) — 할 일이 스케줄러 입력이 됐다.** `lib/tasks.ts` 머리에 그 뒤집기의
     근거가 있다(T-1 이 거절한 것은 *성적 회계*이고 이건 *시간 소비*다). 이 줄이 없으면 과제를
     넣어도 계획이 다시 계산되지 않는다 — I-6 이 `cbms` 에서 방금 겪은 것과 **글자 그대로 같은
     결함**이고, 그래서 여기 적는 것이 그 항목이 남긴 교훈의 회수다. */
  'tasks',
  'weekAlloc', // §12-4 주간 배분 — 배분 있는 주는 new 블록을 요일 벡터로 구동(배분 변경 시 재스케줄)
] as const;

/* ⚠⚠ **파생 '오늘'을 키에 함께 싣는다(H3 · 2026-07-26 감사).**

   위 목록의 `_today` 는 슬라이스 이름으로선 옳지만, `persistence.migrate()` 가 부팅 때 그 시드를
   지우므로 **프로덕션에선 항상 `undefined`** 다(시드 경로 0). 즉 "키에 없다"가 아니라 **키는 있고
   값이 무효**였고, 그래서 날짜가 바뀌어도 캐시가 절대 안 깨졌다 — 데스크톱은 며칠 켜 두는 앱이
   라는 게 이 앱의 전제인데(그래서 5분 폴백 폴링도 있다), 자정을 넘기면 어제 블록·"남은 N"·밀림
   수가 그대로 남았다. 파생값을 넣으면 시드가 있든(테스트) 없든(프로덕션) **같은 규칙**으로 깨진다. */
function scheduleInputs(s: AppState): readonly unknown[] {
  const r = s as unknown as Record<string, unknown>;
  return [...SCHEDULE_INPUT_KEYS.map((k) => r[k]), todayISO(s)];
}

/* 튜플 키 1-엔트리 메모의 **단일 구현**(H9 · 2026-07-26 감사).

   ⚠ 종전엔 `selectSchedule` 만 튜플 키였고 나머지 셋은 **루트 참조**였다 — 위 AN-16 주석이
   "루트 참조로 캐시하면 무관 슬라이스 쓰기마다 캐시가 깨져 무거운 계산이 헛돈다"고 적어 놓고
   한 곳만 고친 상태로 남아 있었다. 그래서 `tasks` 드래그 한 번이 `selectFinishGains` 의 **전량
   재시뮬 1회**를 불렀다. 규칙을 함수 하나로 만들어 다음 셀렉터가 자동으로 같은 규칙을 쓰게 한다. */
function keyed<T>(keysOf: (s: AppState) => readonly unknown[], compute: (s: AppState) => T): (s: AppState) => T {
  let c: { keys: readonly unknown[]; result: T } | null = null;
  return (s) => {
    const keys = keysOf(s);
    if (!c || c.keys.length !== keys.length || c.keys.some((k, i) => k !== keys[i])) c = { keys, result: compute(s) };
    return c.result;
  };
}

/** 통합 스케줄을 입력 슬라이스로 메모이즈(React 밖에서도 호출 가능 — ics 내보내기 등). */
export const selectSchedule: (state: AppState) => ScheduleResult = keyed(scheduleInputs, (s) => schedule(s));

/** 통합 스케줄 훅 — 같은 state 버전을 보는 모든 소비처가 단일 계산 결과를 공유. */
export function useSchedule(): ScheduleResult {
  const state = useApp((s) => s.state);
  return selectSchedule(state);
}

/** 화면이 입는 테마 — 동기화 정본(`state.theme`) + 기기-로컬 OS 감지값(`ui.autoTheme`)의 해소(H9).
 *  ⚠ 두 스토어를 걸치므로 여기(파생)에 둔다. 해소 규칙 자체는 `lib/uiState.resolveTheme` 이 소유한다
 *  — 훅을 못 쓰는 자리(`shell/actions.ts` 의 팔레트 액션)도 같은 규칙을 봐야 하기 때문이다. */
export function useTheme(): Theme {
  const saved = useApp((s) => s.state.theme);
  const themeAuto = useUI((s) => s.ui.themeAuto);
  const autoTheme = useUI((s) => s.ui.autoTheme);
  return resolveTheme(saved, { themeAuto, autoTheme });
}

/* 요일별 공부 가능 시간(분) — schedule 내부에서도 부르고 Routine·Schedule 탭이 따로도 부른다.
   같은 참조-캐시로 state 버전당 1회만 계산(소비처별 useMemo 중복 제거). */
let capCache: { state: AppState; result: number[] } | null = null;

/** 요일별 가용 학습분 배열을 state 참조로 메모이즈. */
export function selectStudyMinByWeekday(state: AppState): number[] {
  if (!capCache || capCache.state !== state) capCache = { state, result: studyMinByWeekday(state) };
  return capCache.result;
}

/** 요일별 가용 학습분 훅. */
export function useStudyMinByWeekday(): number[] {
  const state = useApp((s) => s.state);
  return selectStudyMinByWeekday(state);
}

/* 복습 위험 요약(연체·임박) — 사이드바 배지가 **모든 스토어 알림마다** 부르는 자리다.
   riskSummary 안의 chapterReviews는 days × items × chapters를 순회하고 Map을 할당하고 정렬까지 한다.
   메모가 없던 시절엔 기록 탭 textarea에 한 글자 칠 때마다 그 전수 스캔이 통째로 돌았다
   (zustand는 셀렉터를 알림마다 실행하고 mutate는 디바운스 없이 즉시 set한다).
   Graph 탭은 같은 함수에 대해 이미 "전수 스캔이 순수 낭비"라며 호출을 회피하고 있었다 —
   사이드바가 유일한 무조건 호출부였다. selectSchedule과 같은 참조-캐시로 state 버전당 1회로 묶는다. */
/* ⚠ 키 = 스케줄 입력 + **riskSummary 가 그 밖에서 읽는 슬라이스**. `chapterReviews` 가
   `reviewTouches`(계획 밖 인출 기록)를 읽는데 그건 스케줄 입력이 아니다 — 빠뜨리면 복습을
   해도 배지가 안 풀리는(=위 감사 #22 와 같은) 무증상 stale 이 된다. `completions`·`blankResults`
   는 이미 스케줄 입력에 있다. */
/* ⚠ W2 — 볼트 앵커는 **state 가 아니라 쿼리 캐시** 파생이라 슬라이스 튜플에 안 잡힌다.
   버전 카운터를 키에 실어야 볼트 스캔이 도착했을 때 배지가 갱신된다(안 실으면 조용히 stale —
   위 `reviewTouches` 누락과 정확히 같은 무증상 결함이다). */
const riskInputs = (s: AppState): readonly unknown[] => [...scheduleInputs(s), s.reviewTouches, vaultAnchorsVersion()];

/** 복습 위험 요약(연체/임박 개수) — 입력 슬라이스로 메모이즈. */
export const selectRiskSummary: (state: AppState) => { overdue: number; due: number } = keyed(riskInputs, (s) =>
  riskSummary(s, selectSchedule(s).days || [], todayISO(s)),
);

/* ── 나브 상태 신호(N-13) ───────────────────────────────────────────────────
   레일 항목은 **눌러 들어가야 안에 뭐가 있는지** 알 수 있었다(상태를 가진 항목이 배지 2개뿐).
   그런데 그 신호들은 이미 여러 화면에서 계산되고 있었다 — 데이터가 없던 게 아니라 *표시 자리*가
   없었다. 계산을 여기 한 곳으로 수렴시켜 레일이 소비한다.

   ⚠ **0·평온은 아무것도 안 그린다.** 매일 0을 외치면 신호가 죽고, 그때부터 레일은 배경이 된다.
   "레일이 말하면 뭔가 있는 것"이 이 기능의 생사이자 5원칙(절제)과의 화해점이다.
   ⚠ **없는 신호를 지어내지 않는다.** 상태가 있는 항목만 여기 있다(오늘·기록). 나머지 도달점은
   지금 앱이 싸게 셀 수 있는 '지금 뭔가 있음'이 없어서 비운 것이지, 자리가 없어서가 아니다 —
   신호가 생기면 이 표에 한 줄을 더한다. */
/* 키 = 위험 입력 + `openBacklog` 이 읽는 `backlog`(보충 개수) + `questions`(A-14 다시 만날 것).
   ⚠ 새 신호를 더하면 **그 신호가 읽는 슬라이스를 여기 더한다** — 안 그러면 문항을 적어도 레일이
   안 바뀐다(캐시가 그대로다). `SCHEDULE_INPUT_KEYS` 가 같은 형태의 결함으로 두 번 물린 자리다. */
const navInputs = (s: AppState): readonly unknown[] => [...riskInputs(s), s.backlog, s.questions];

export const selectNavSignals: (state: AppState) => Record<string, string> = keyed(navInputs, (state) => {
  const out: Record<string, string> = {};
  // 오늘 — 남은 블록(계획됐지만 아직 안 한 것). 다 했으면 침묵한다(그게 평온의 정의다).
  const today = todayISO(state);
  const day = (selectSchedule(state).days || []).find((d) => d.ds === today);
  const left = (day?.items || []).filter((it) => !isDone(state, today, it.sid, it.type)).length;
  if (left > 0) out.today = `남은 ${left}`;
  // 밀림·보충 — 옛 배지는 둘을 **한 숫자로 합쳐** 무엇이 밀렸는지 말하지 않았다. 둘은 성격이
  // 다른 일이라(인출 vs 보충 학습) 합치면 어느 쪽도 행동으로 안 이어진다.
  const { overdue } = selectRiskSummary(state);
  const backlog = openBacklog(state).length;
  const parts: string[] = [];
  if (overdue > 0) parts.push(`밀림 ${overdue}`);
  if (backlog > 0) parts.push(`보충 ${backlog}`);
  /* ⚠⚠ **키가 `journal` 이었다 — 그 탭은 W4(N-12)에서 레일을 떠났다**(2026-08-07 · W8 에서 발견).
     `RailSidebar` 는 `signals[t.key]` 로 **레일에 그려지는 탭**에만 신호를 붙이는데 `journal` 은
     `role:'view'`(옛 `retired`)(→ `/day`)라 후보에 없다 → 이 두 문장은 **한 번도 렌더되지 않았다.** 배지가
     같은 수를 `review-run` 에 이미 옮겨 놓았기 때문에(그 파일의 `NAV_BADGE_TAB`) 화면에서 값이
     사라진 것처럼 보이지 않았고, 그래서 조용했다 — *도달성 손실은 조용하다*의 또 한 판.
     → 배지와 **같은 탭**에 붙인다. 둘이 겹치지 않는 것은 `RailSidebar` 가 이미 보장한다
     (펼침이면 신호 · 접힘이면 배지). */
  if (parts.length) out['review-run'] = parts.join(' · ');
  /* A-14 — **문항이 스스로 부른다.** 이 원장의 결함은 내용이 아니라 시제였다(아카이브는 사용자가
     갈 때만 존재하는데 갈 이유가 발생하지 않는다). 레일 한 줄이 그 "부름"이고, 없으면 침묵한다. */
  const dueQ = dueQuestions(state, today).length;
  if (dueQ > 0) out.questions = `다시 만날 ${dueQ}`;
  return out;
});

/* ── '지금 뭘 하지'의 단일 답(H4 · 2026-07-26 감사) ─────────────────────────

   D-5 가 두 규칙(데스크톱 시간대 · 폰 급함 가중)을 `pickFocus` 하나로 합쳤는데, **호출부
   하나가 남아 통일이 절반이었다**: `useFocus.startOnCurrent` 가 `stat`·`today` 를 안 넘겨
   기본값(`[]`·`''`)으로 돌았고, 그러면 `urgency()` 가 블록 크기만 보게 된다. 결과가 관측
   가능했다 — 히어로는 "미적분(D-2)"인데 ⌘K·FocusChip 의 집중 시작은 "물리(3h)".

   ⚠ 처방이 "인자를 마저 넘긴다"가 아닌 이유: 그건 다음 호출부에서 또 빠진다(이번이 그
   재발이었다 — `focusState.ts:95` 주석이 같은 결함을 이미 한 번 고쳤다). **재료 조립을
   여기로 옮겨 호출부에서 선택권을 뺏는다.**

   ⚠ `nowMin` 만 인자로 남는다 — 시각은 화면이 아는 것이고, 셀렉터가 벽시계를 직접 읽으면
   테스트가 시간을 못 고정한다.

   ⚠ **폰(`phone/TodayView`)은 이 셀렉터를 안 쓴다 — 그건 결함이 아니다.** 폰은 후보를
   *새 학습 블록만*으로 좁히고 시각을 일부러 0 으로 준다(그 두 결정의 근거는 그 파일 주석).
   "무엇을 후보로 볼지"는 화면의 결정이고 "그중 무엇이 먼저인지"만 lib 의 결정이다 —
   그쪽은 이미 `stat`·`today` 를 넘기고 있어 H4 의 결함(재료 누락)이 없다. */
/** @param lockedKey **A-13** — 오늘 확정한 블록 키(`ui.focusLock`). 화면이 넘긴다(스토어를 안 읽는다). */
export function selectTodayFocus(
  state: AppState,
  nowMin: number,
  lockedKey: string | null = null,
): FocusPick & { entries: FocusEntry[] } {
  const res = selectSchedule(state);
  const entries = todayEntries(state, res);
  return { entries, ...pickFocus(entries, nowMin, res.itemStat, todayISO(state), lockedKey) };
}

/* ── 반사실 완주일(N-3) ─────────────────────────────────────────────────────
   `adherenceFactor` 는 최근 14일 이행률로 **계획 용량을 0.5~1.0배 곱한다**. 사용자에게 보이는
   것은 설정의 체크박스 하나(+PL-3 이 노출한 계수뿐)이고, **그래서 종료일이 며칠 밀렸는지는
   어느 화면에도 없었다** — "왜 종료일이 늘었지?"의 답이 코드 읽기였다.

   답을 만드는 방법은 새 계산이 아니라 **같은 계산을 한 번 더 돌리는 것**이다: `schedule()` 은
   순수 함수고 `adaptiveCapacity:false` 면 계수가 정확히 1 이 된다. 그래서 반사실은 추정이
   아니라 **이 앱 자신의 엔진이 내놓은 다른 입력의 결과**다(임의 계수 0).

   ⚠ 계수가 적용되지 않은 상태(`adaptApplied` false)면 **아예 계산하지 않는다** — 결과가 같을
   것이 자명한데 무거운 스케줄을 한 번 더 도는 것은 순수 낭비다.
   ⚠ 문구는 호출부의 몫이고, 이 함수는 **날짜와 일수만** 준다. 이행률은 통제 밖 사유로도 떨어진다
   → 여기서 평가하는 값(예: '손해')을 만들면 화면이 자책을 유도하게 된다(records 의 '성취 회수' 톤과 충돌). */
export interface FinishGain {
  id: string;
  name: string;
  /** 지금 계획의 완주일. */
  finishDate: string;
  /** 계수 없이(=계획대로 지켰을 때) 계획의 완주일. */
  idealDate: string;
  /** 며칠 당겨지는가(≥1 인 것만 담는다). */
  days: number;
}
/* ⚠ 키 = 스케줄 입력 그대로. 아래는 **같은 엔진을 다른 입력으로 한 번 더** 도는 것이라
   입력 집합이 정확히 같다 — 루트 참조로 잡으면 `tasks` 드래그 한 번에 전량 재시뮬이 붙는다(H9). */
export const selectFinishGains: (state: AppState) => FinishGain[] = keyed(scheduleInputs, (state) => {
  const cur = selectSchedule(state);
  let out: FinishGain[] = [];
  if (cur.adaptApplied) {
    const ideal = schedule({ ...state, adaptiveCapacity: false });
    const byId = new Map(ideal.itemStat.map((s) => [s.id, s]));
    out = cur.itemStat
      .map((s) => {
        const alt = byId.get(s.id);
        if (!s.finishDate || !alt?.finishDate) return null;
        const days = dayDiff(alt.finishDate, s.finishDate);
        return days >= 1 ? { id: s.id, name: s.name, finishDate: s.finishDate, idealDate: alt.finishDate, days } : null;
      })
      .filter((x): x is FinishGain => !!x);
  }
  return out;
});
