/* ============================================================
   localStore.ts — localStorage JSON get/set 순수 헬퍼. 여러 feature가 각자 인라인하던
   try/catch·JSON.parse·직렬화 보일러플레이트를 하나로(실패는 조용히 fallback — 용량/프라이빗 모드).
   KV는 kv.ts의 storage SSOT를 통한다(브라우저 localStorage 또는 메모리 폴백).
============================================================ */
import { storage } from './kv';

/** key의 JSON을 파싱해 반환. 없거나 파싱 실패면 fallback(throw 안 함). */
export function readJSON<T>(key: string, fallback: T): T {
  try {
    const v = storage.getItem(key);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

/** val을 JSON으로 직렬화해 저장. 저장 불가(용량·프라이빗 모드)면 조용히 무시. */
export function writeJSON(key: string, val: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(val));
  } catch {
    /* localStorage 불가 — 무시 */
  }
}
