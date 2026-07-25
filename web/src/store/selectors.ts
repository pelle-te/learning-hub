/* ============================================================
   selectors.ts — 파생 상태(메모이즈드 셀렉터). 스케줄은 매 렌더 재계산하지 않고
   입력(state)이 바뀔 때만 재계산한다(설계도 §1-A).
============================================================ */
import { schedule, studyMinByWeekday } from '@/lib/scheduler';
import { riskSummary } from '@/lib/spacedReview';
import { isDone } from '@/lib/persistence';
import { openBacklog } from '@/lib/methodology';
import { dayDiff, todayISO } from '@/lib/utils';
import type { AppState, ScheduleResult } from '@/lib/types';
import { useApp } from './useApp';

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
  'blankResults', // ②#23 복습 사다리 적응 — latestBlank가 읽는다(백지 결과 갱신 시 재스케줄)
  'dayPlans', // §4-2 일일 배치 오버라이드 — applyDayPlans가 읽어 manual인 날 items를 치환(변경 시 재스케줄)
  'events', // Wave 5 일정 — dayStudyMin/freeWindowsForDay가 읽어 가용시간을 깎는다(일정 추가 시 재스케줄)
  'weekAlloc', // §12-4 주간 배분 — 배분 있는 주는 new 블록을 요일 벡터로 구동(배분 변경 시 재스케줄)
] as const;

function scheduleInputs(s: AppState): readonly unknown[] {
  const r = s as unknown as Record<string, unknown>;
  return SCHEDULE_INPUT_KEYS.map((k) => r[k]);
}
let cache: { keys: readonly unknown[]; result: ScheduleResult } | null = null;

/** 통합 스케줄을 입력 슬라이스로 메모이즈(React 밖에서도 호출 가능 — ics 내보내기 등). */
export function selectSchedule(state: AppState): ScheduleResult {
  const keys = scheduleInputs(state);
  if (!cache || cache.keys.length !== keys.length || cache.keys.some((k, i) => k !== keys[i]))
    cache = { keys, result: schedule(state) };
  return cache.result;
}

/** 통합 스케줄 훅 — 같은 state 버전을 보는 모든 소비처가 단일 계산 결과를 공유. */
export function useSchedule(): ScheduleResult {
  const state = useApp((s) => s.state);
  return selectSchedule(state);
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
let riskCache: { state: AppState; result: { overdue: number; due: number } } | null = null;

/** 복습 위험 요약을 state 참조로 메모이즈(연체/임박 개수). */
export function selectRiskSummary(state: AppState): { overdue: number; due: number } {
  if (!riskCache || riskCache.state !== state) {
    riskCache = { state, result: riskSummary(state, selectSchedule(state).days || [], todayISO(state)) };
  }
  return riskCache.result;
}

/* ── 나브 상태 신호(N-13) ───────────────────────────────────────────────────
   레일 항목은 **눌러 들어가야 안에 뭐가 있는지** 알 수 있었다(상태를 가진 항목이 배지 2개뿐).
   그런데 그 신호들은 이미 여러 화면에서 계산되고 있었다 — 데이터가 없던 게 아니라 *표시 자리*가
   없었다. 계산을 여기 한 곳으로 수렴시켜 레일이 소비한다.

   ⚠ **0·평온은 아무것도 안 그린다.** 매일 0을 외치면 신호가 죽고, 그때부터 레일은 배경이 된다.
   "레일이 말하면 뭔가 있는 것"이 이 기능의 생사이자 5원칙(절제)과의 화해점이다.
   ⚠ **없는 신호를 지어내지 않는다.** 상태가 있는 항목만 여기 있다(오늘·기록). 나머지 도달점은
   지금 앱이 싸게 셀 수 있는 '지금 뭔가 있음'이 없어서 비운 것이지, 자리가 없어서가 아니다 —
   신호가 생기면 이 표에 한 줄을 더한다. */
let navCache: { state: AppState; result: Record<string, string> } | null = null;

export function selectNavSignals(state: AppState): Record<string, string> {
  if (navCache && navCache.state === state) return navCache.result;
  const out: Record<string, string> = {};
  // 오늘 — 남은 블록(계획됐지만 아직 안 한 것). 다 했으면 침묵한다(그게 평온의 정의다).
  const today = todayISO(state);
  const day = (selectSchedule(state).days || []).find((d) => d.ds === today);
  const left = (day?.items || []).filter((it) => !isDone(state, today, it.sid, it.type)).length;
  if (left > 0) out.today = `남은 ${left}`;
  // 기록 — 옛 배지는 밀림+보충을 **한 숫자로 합쳐** 무엇이 밀렸는지 말하지 않았다. 둘은 성격이
  // 다른 일이라(인출 vs 보충 학습) 합치면 어느 쪽도 행동으로 안 이어진다.
  const { overdue } = selectRiskSummary(state);
  const backlog = openBacklog(state).length;
  const parts: string[] = [];
  if (overdue > 0) parts.push(`밀림 ${overdue}`);
  if (backlog > 0) parts.push(`보충 ${backlog}`);
  if (parts.length) out.journal = parts.join(' · ');
  navCache = { state, result: out };
  return out;
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
let cfCache: { state: AppState; result: FinishGain[] } | null = null;

export function selectFinishGains(state: AppState): FinishGain[] {
  if (cfCache && cfCache.state === state) return cfCache.result;
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
  cfCache = { state, result: out };
  return out;
}
