/* ============================================================
   queries.ts — 서버/외부 상태 훅(TanStack Query). 앱상태(useApp)와 분리 — 캐시/로딩/에러/무효화를
   Query가 소유하고 persist 안 한다(설계도 §1-B). 인엔진 소비처(스케줄러·오늘 KPI)가 필요한
   결과만 setRuntimeCache로 write-through.
   store 레이어에 두는 이유: features(mastery·control·integrations)·app이 공유, store→lib 허용.
============================================================ */
import { useQuery } from '@tanstack/react-query';
import { getPing, type PingResponse } from '@/lib/api';
import { fetchKnowledgeArtifact, type Knowledge } from '@/lib/knowledge';
import { fetchReadsArtifact, type ReadsArtifact } from '@/lib/reads';
import { fetchMarketsArtifact, type MarketsArtifact } from '@/lib/markets';
import { useApp } from './useApp';

export const KNOWLEDGE_KEY = ['knowledge'] as const;
export const PING_KEY = ['ping'] as const;
export const READS_KEY = ['reads'] as const;
export const MARKETS_KEY = ['markets'] as const;

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
