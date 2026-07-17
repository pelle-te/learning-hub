/* ============================================================
   selectors.ts — 파생 상태(메모이즈드 셀렉터). 스케줄은 매 렌더 재계산하지 않고
   입력(state)이 바뀔 때만 재계산한다(설계도 §1-A).
============================================================ */
import { schedule, studyMinByWeekday } from '@/lib/scheduler';
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
