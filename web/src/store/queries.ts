/* ============================================================
   queries.ts — 서버/외부 상태 훅(TanStack Query). 앱상태(useApp)와 분리 — 캐시/로딩/에러/무효화를
   Query가 소유하고 persist 안 한다(설계도 §1-B). 인엔진 소비처(스케줄러·오늘 KPI)가 필요한
   결과만 setRuntimeCache로 write-through.
   store 레이어에 두는 이유: features(mastery·control·integrations)·app이 공유, store→lib 허용.
============================================================ */
import { useQuery } from '@tanstack/react-query';
import {
  fetchAtlasNews,
  getPing,
  listResearchJobs,
  type AtlasNewsItem,
  type PingResponse,
  type ResearchJob,
} from '@/lib/api';
import { fetchKnowledgeArtifact, type Knowledge } from '@/lib/knowledge';
import { fetchLedgerArtifact, type Ledger } from '@/lib/ledger';
import { fetchReadsArtifact, type ReadsArtifact } from '@/lib/reads';
import { fetchMarketsArtifact, type MarketsArtifact } from '@/lib/markets';
import { fetchCurriculumArtifact, type Curriculum } from '@/lib/curriculum';
import { useApp } from './useApp';

export const KNOWLEDGE_KEY = ['knowledge'] as const;
export const CURRICULUM_KEY = ['curriculum'] as const;
export const LEDGER_KEY = ['ledger'] as const;
export const PING_KEY = ['ping'] as const;
export const READS_KEY = ['reads'] as const;
export const MARKETS_KEY = ['markets'] as const;
export const RESEARCH_JOBS_KEY = ['research-jobs'] as const;
export const ATLAS_NEWS_KEY = ['atlas-news'] as const;

/** serve.js(/api) 연결 여부·도구 목록 — 제어판 헤더 상태. retry 없이 빠르게 isError(file:// 폴백). */
export function usePing() {
  return useQuery<PingResponse>({ queryKey: PING_KEY, queryFn: getPing, retry: false, staleTime: 30_000 });
}

/** 읽을거리 지문(/api/artifact/reads) — 수집 원문. serve.js 꺼져 있거나 미수집이면 isError(우아 안내).
 *  캐시만 소유(persist X) — 내 요약·독서는 lib/reads 로컬 저장이 따로 소유. */
export function useReads() {
  return useQuery<ReadsArtifact>({
    queryKey: READS_KEY,
    queryFn: fetchReadsArtifact,
    retry: false,
    staleTime: 60_000,
  });
}

/** 증시 동향(/api/artifact/markets) — 지수 등락 + 금융 뉴스. serve.js 꺼져 있거나 미수집이면
 *  isError(우아 안내). 캐시만 소유(persist X) — 브리핑은 온디맨드 호출이라 캐시 안 함. */
export function useMarkets() {
  return useQuery<MarketsArtifact>({
    queryKey: MARKETS_KEY,
    queryFn: fetchMarketsArtifact,
    retry: false,
    staleTime: 60_000,
  });
}

/** 탐구(리서치) 잡 목록(/api/research/jobs) — serve.js가 잡으로 소유(수십 분짜리 백그라운드).
 *  running 잡이 있으면 3초 폴링, 없으면 멈춘다(react-query가 폴링·재부착·구조공유를 소유 → 손폴링 제거).
 *  전이감지(완료 토스트·히스토리)는 소비처(Control)가 data 변화를 보고 소유. enabled=serve.js 온라인일 때만. */
export function useResearchJobs(enabled: boolean) {
  return useQuery<ResearchJob[]>({
    queryKey: RESEARCH_JOBS_KEY,
    enabled,
    retry: false,
    queryFn: async () => {
      const r = await listResearchJobs();
      if (!r.ok) throw new Error('탐구 잡 목록을 가져오지 못했어요.');
      return r.jobs;
    },
    // running 잡이 있을 때만 3초 폴링 — 끝나면 스스로 멈춘다(다음 start가 무효화로 재기동).
    refetchInterval: (q) => (q.state.data?.some((j) => j.status === 'running') ? 3000 : false),
  });
}

/** 진로 지도 분야 동향(/api/atlas/news) — Google 뉴스 RSS 라이브. 상세를 열 때만(enabled) 온디맨드로.
 *  serve.js 꺼짐/실패면 isError → 상세가 시드 동향으로 폴백. 5분 캐시(같은 분야 재방문 재호출 흡수). */
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

/** 챕터 원장(/api/artifact/ledger) — 과목×챕터 5단계 파이프라인 진척(정본 축). serve.js 꺼짐/미생성이면
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
      useApp.getState().setRuntimeCache('_knowState', k);
      return k;
    },
  });
}

/** 커리큘럼 프론티어(/api/artifact/curriculum) — 숙달도 지도의 '다음 학습 순서'(단계③ 적응형 시퀀싱).
 *  serve.js 없거나 산출물 미생성이면 isError(retry 없음) → 소비처가 조용히 생략(패널 렌더 skip). */
export function useCurriculum(enabled = true) {
  return useQuery<Curriculum>({
    queryKey: CURRICULUM_KEY,
    enabled,
    queryFn: fetchCurriculumArtifact,
    retry: false,
    staleTime: 60_000,
  });
}
