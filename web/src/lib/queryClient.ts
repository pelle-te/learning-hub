import { QueryClient } from '@tanstack/react-query';

// 서버/외부 상태(서버 /api·볼트·Anki·지식상태)는 TanStack Query가 소유한다.
// 로컬-퍼스트 앱이라 외부 데이터는 자주 안 바뀐다 → staleTime을 넉넉히 줘서
// 탭을 오갈 때마다 재요청하지 않게(불필요한 네트워크/스캔 방지). 무효화는 mutation이 명시적으로 한다.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: 60_000, // 1분간 fresh로 간주(탭 왕복 시 재요청 안 함)
      gcTime: 30 * 60_000, // 30분간 캐시 보존(언마운트돼도 즉시 복귀)
    },
  },
});
