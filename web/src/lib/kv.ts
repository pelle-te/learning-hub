/* ============================================================
   kv.ts — KV 저장소의 단일 출처. 브라우저면 localStorage, 아니면(노드/테스트/SSR)
   인메모리 Map으로 폴백. useApp·useUI 등 영속 스토어가 같은 인스턴스를 주입받아
   localStorage 직접 접근이 흩어지지 않게 한다.
============================================================ */
import type { KV } from './types';

/** 비브라우저 환경용 인메모리 KV(테스트·SSR). */
export function memKV(): KV {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

/** 앱 전역 KV — 브라우저 localStorage 또는 메모리 폴백. */
export const storage: KV = typeof localStorage !== 'undefined' ? localStorage : memKV();
