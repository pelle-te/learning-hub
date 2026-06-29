/* ============================================================
   selectors.ts — 파생 상태(메모이즈드 셀렉터). 스케줄은 매 렌더 재계산하지 않고
   입력(state)이 바뀔 때만 재계산한다(설계도 §1-A).
============================================================ */
import { schedule, studyMinByWeekday } from '@/lib/scheduler';
import type { AppState, ScheduleResult } from '@/lib/types';
import { useApp } from './useApp';

/* 모듈 레벨 1-엔트리 캐시. schedule은 state의 순수 함수이므로 state 참조(immer가 변경 시에만
   교체)가 같으면 결과도 같다. 컴포넌트별 useMemo와 달리 캐시가 인스턴스 간 공유돼, 한 탭에서
   여러 소비처(RitualCard·TodayBlocks 등)가 useSchedule을 불러도 무거운 schedule()은 state
   버전당 정확히 한 번만 실행된다(이전엔 소비처 × 렌더마다 재실행). 설계도 §1-A. */
let cache: { state: AppState; result: ScheduleResult } | null = null;

/** 통합 스케줄을 state 참조로 메모이즈(React 밖에서도 호출 가능 — ics 내보내기 등). */
export function selectSchedule(state: AppState): ScheduleResult {
  if (!cache || cache.state !== state) cache = { state, result: schedule(state) };
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
