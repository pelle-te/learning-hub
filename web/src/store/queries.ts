/* ============================================================
   queries.ts — 서버/외부 상태 훅(TanStack Query). 앱상태(useApp)와 분리 — 캐시/로딩/에러/무효화를
   Query가 소유하고 persist 안 한다(설계도 §1-B). 인엔진 소비처(스케줄러·오늘 KPI)가 필요한
   결과만 setRuntimeCache로 write-through.
   store 레이어에 두는 이유: features(mastery·control·integrations)·app이 공유, store→lib 허용.
============================================================ */
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchAtlasNews,
  getPing,
  listResearchJobs,
  type AtlasNewsItem,
  type PingResponse,
  type ResearchJob,
} from '@/lib/api';
import { fetchKnowledgeArtifact, type Knowledge } from '@/lib/knowledge';
import { slimKnowState } from '@/lib/scheduler';
import { fetchLedgerArtifact, type Ledger } from '@/lib/ledger';
import { fetchReadsArtifact, type ReadsArtifact } from '@/lib/reads';
import { fetchMarketsArtifact, type MarketsArtifact } from '@/lib/markets';
import { fetchCurriculumArtifact, type Curriculum } from '@/lib/curriculum';
import { fetchGoalsArtifact, type GoalsArtifact } from '@/lib/goals';
import { fetchDiscoveryArtifact, type DiscoveryArtifact } from '@/lib/discovery';
import { isTauri, onResearchChanged } from '@/lib/tauri';
import { useApp } from './useApp';

export const KNOWLEDGE_KEY = ['knowledge'] as const;
export const CURRICULUM_KEY = ['curriculum'] as const;
export const LEDGER_KEY = ['ledger'] as const;
export const PING_KEY = ['ping'] as const;
export const READS_KEY = ['reads'] as const;
export const MARKETS_KEY = ['markets'] as const;
export const RESEARCH_JOBS_KEY = ['research-jobs'] as const;
export const ATLAS_NEWS_KEY = ['atlas-news'] as const;
export const GOALS_KEY = ['goals'] as const;
export const DISCOVERY_KEY = ['discovery'] as const;

/** 백엔드 사용 가능 여부·도구 목록 — 제어판 헤더 상태. retry 없이 빠르게 isError(file:// 폴백). */
export function usePing() {
  return useQuery<PingResponse>({ queryKey: PING_KEY, queryFn: getPing, retry: false, staleTime: 30_000 });
}

/** 읽을거리 지문(/api/artifact/reads) — 수집 원문. 워크스페이스 미설정·미수집이면 isError(우아 안내).
 *  캐시만 소유(persist X) — 내 요약·독서는 lib/reads 로컬 저장이 따로 소유. */
export function useReads() {
  return useQuery<ReadsArtifact>({
    queryKey: READS_KEY,
    queryFn: fetchReadsArtifact,
    retry: false,
    staleTime: 60_000,
  });
}

/** 증시 동향(/api/artifact/markets) — 지수 등락 + 금융 뉴스. 워크스페이스 미설정·미수집이면
 *  isError(우아 안내). 캐시만 소유(persist X) — 브리핑은 온디맨드 호출이라 캐시 안 함. */
export function useMarkets() {
  return useQuery<MarketsArtifact>({
    queryKey: MARKETS_KEY,
    queryFn: fetchMarketsArtifact,
    retry: false,
    staleTime: 60_000,
  });
}

/** 탐구(리서치) 잡 목록 — 백엔드가 잡으로 소유한다(수십 분짜리 백그라운드).
 *  셸에선 **Rust 가 소유하고 이벤트로 알린다**(4단계-D · 폴링 없음), 브라우저(dev·트랙 A)엔 이벤트가 없어 3초 폴링을 폴백으로 남겼다.
 *  재부착·구조공유는 react-query 가 소유하고, 전이감지(완료 토스트·히스토리)는 소비처(Control) 몫. */
export function useResearchJobs(enabled: boolean) {
  const qc = useQueryClient();

  /* 셸(4단계-D)에선 **폴링을 안 한다** — Rust 가 출력·상태가 바뀔 때만 이벤트를 쏜다(설계 갭 ⑤).
     폴링은 "바뀐 게 없어도 3초마다 잡 전체(각 20,000자)를 다시 실어 나르는" 비용이었고,
     그 비용이 변화량이 아니라 시간에 비례했다. 이벤트는 변화가 있을 때만 온다.
     ⚠ 브라우저(dev·트랙 A)엔 이벤트가 없으므로 **폴링을 남겨 둔다** — `onResearchChanged` 가
     no-op 을 돌려주고 아래 refetchInterval 이 그 경로를 계속 받친다(2·3단계와 같은 폴백 규율). */
  useEffect(() => {
    if (!enabled || !isTauri()) return;
    let stop: (() => void) | undefined;
    let dead = false;
    void onResearchChanged(() => {
      void qc.invalidateQueries({ queryKey: RESEARCH_JOBS_KEY });
    }).then((un) => {
      // 구독이 붙기 전에 언마운트됐으면 즉시 해제한다(누수 방지).
      if (dead) un();
      else stop = un;
    });
    return () => {
      dead = true;
      stop?.();
    };
  }, [enabled, qc]);

  return useQuery<ResearchJob[]>({
    queryKey: RESEARCH_JOBS_KEY,
    enabled,
    retry: false,
    queryFn: async () => {
      const r = await listResearchJobs();
      if (!r.ok) throw new Error('탐구 잡 목록을 가져오지 못했어요.');
      return r.jobs;
    },
    // 브라우저 전용 폴백 — 셸에선 위 구독이 대신하므로 끈다.
    refetchInterval: (q) => (!isTauri() && q.state.data?.some((j) => j.status === 'running') ? 3000 : false),
  });
}

/** 진로 지도 분야 동향(/api/atlas/news) — Google 뉴스 RSS 라이브. 상세를 열 때만(enabled) 온디맨드로.
 *  실패면 isError → 상세가 시드 동향으로 폴백. 5분 캐시(같은 분야 재방문 재호출 흡수). */
export function useAtlasNews(query: string, enabled: boolean) {
  return useQuery<AtlasNewsItem[]>({
    queryKey: [...ATLAS_NEWS_KEY, query],
    enabled: enabled && !!query,
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const r = await fetchAtlasNews(query);
      if (!r.ok) throw new Error(r.error || '동향을 가져오지 못했어요');
      return r.items;
    },
  });
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

/** 발견 큐(discovery · /api/artifact/discovery) — triage inbox(P9 Phase 6 · 사람 승격).
 *  콜드(수집·발견 미가동)면 파일 부재→404→isError → 소비처가 빈 inbox 우아 안내. */
export function useDiscovery(enabled = true) {
  return useQuery<DiscoveryArtifact>({
    queryKey: DISCOVERY_KEY,
    enabled,
    queryFn: fetchDiscoveryArtifact,
    retry: false,
    staleTime: 30_000,
  });
}
