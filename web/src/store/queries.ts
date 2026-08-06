/* ============================================================
   queries.ts — 서버/외부 상태 훅(TanStack Query). 앱상태(useApp)와 분리 — 캐시/로딩/에러/무효화를
   Query가 소유하고 persist 안 한다(설계도 §1-B). 인엔진 소비처(스케줄러·오늘 KPI)가 필요한
   결과만 setRuntimeCache로 write-through.
   store 레이어에 두는 이유: features(mastery·integrations)·app이 공유, store→lib 허용.
============================================================ */
import { useQuery } from '@tanstack/react-query';
import { getPing, type PingResponse } from '@/lib/api';
import { fetchKnowledgeArtifact, type Knowledge } from '@/lib/knowledge';
import { slimKnowState } from '@/lib/scheduler';
import { fetchLedgerArtifact, type Ledger } from '@/lib/ledger';
import { fetchCurriculumArtifact, type Curriculum } from '@/lib/curriculum';
import { fetchGoalsArtifact, type GoalsArtifact } from '@/lib/goals';
import { useApp } from './useApp';

export const KNOWLEDGE_KEY = ['knowledge'] as const;
export const CURRICULUM_KEY = ['curriculum'] as const;
export const LEDGER_KEY = ['ledger'] as const;
export const PING_KEY = ['ping'] as const;
export const GOALS_KEY = ['goals'] as const;

/* ⚠ **여섯 키가 P10 W4 에서 사라졌다**(2026-08-07): `reads`·`markets`·`research-jobs`·
   `atlas-news`·`discovery`. 다섯 훅과 그 소비 화면이 `survey/` 필러로 갔다 — 이 파일이
   `store` 에 있는 이유가 *"features 여럿이 공유"* 였는데, 그 여럿 중 넷이 이제 없다. */

/** 백엔드 사용 가능 여부·도구 목록 — 제어판 헤더 상태. retry 없이 빠르게 isError(file:// 폴백). */
export function usePing() {
  return useQuery<PingResponse>({ queryKey: PING_KEY, queryFn: getPing, retry: false, staleTime: 30_000 });
}

/** 챕터 원장(/api/artifact/ledger) — 과목×챕터 5단계 파이프라인 진척(정본 축). 미설정/미생성이면
 *  isError(우아 안내는 소비처). 캐시만 소유(persist X) — 원본은 볼트 빌드 산출물이라 읽기전용. */
export function useLedger() {
  return useQuery<Ledger>({
    queryKey: LEDGER_KEY,
    queryFn: fetchLedgerArtifact,
    retry: false,
    staleTime: 60_000,
  });
}

/** 지식상태(/api/artifact/knowledge) — 숙달도 지도. 성공 시 스케줄러 graphPriority용으로 write-through.
 *  enabled=false면 FS Access 수동 로드만(setQueryData로 같은 캐시 키에 주입). */
export function useKnowledge(enabled = true) {
  return useQuery<Knowledge>({
    queryKey: KNOWLEDGE_KEY,
    enabled,
    retry: false,
    queryFn: async () => {
      const k = await fetchKnowledgeArtifact();
      // 슬림 write-through(감사 ②#25) — state엔 스케줄러 입력({subject,mastery})만.
      // 전체 아티팩트(개념 배열 포함)는 이 Query 캐시가 소유(매 flush 직렬화·쿼터 잠식 방지).
      useApp.getState().setRuntimeCache('_knowState', slimKnowState(k));
      return k;
    },
  });
}

/** 커리큘럼 프론티어(/api/artifact/curriculum) — 숙달도 지도의 '다음 학습 순서'(단계③ 적응형 시퀀싱).
 *  워크스페이스가 없거나 산출물 미생성이면 isError(retry 없음) → 소비처가 조용히 생략(패널 렌더 skip). */
export function useCurriculum(enabled = true) {
  return useQuery<Curriculum>({
    queryKey: CURRICULUM_KEY,
    enabled,
    queryFn: fetchCurriculumArtifact,
    retry: false,
    staleTime: 60_000,
  });
}

/** 내 길(goals · /api/artifact/goals) — 목표 트리(내 길 지도) · 노트→목표 연관성 앵커(P9 Phase 6).
 *  손저작 계약이라 항상 실재 · 워크스페이스가 없으면 isError(retry 없음) → 소비처가 조용히 생략. */
export function useGoals(enabled = true) {
  return useQuery<GoalsArtifact>({
    queryKey: GOALS_KEY,
    enabled,
    queryFn: fetchGoalsArtifact,
    retry: false,
    staleTime: 60_000,
  });
}
