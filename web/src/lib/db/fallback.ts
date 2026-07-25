/* ============================================================
   db/fallback.ts — 정본(SQLite)이 죽은 세션이 남긴 **임시 사본**의 마커(C1 · 2026-07-26 감사).

   `useApp.flush` 는 DB 연결이 실패하면 상태를 localStorage(`KEY`)에 임시로 쓴다. 그 사본은
   **다음 부팅에서 DB 가 여전히 죽어 있을 때만** 저절로 읽힌다(`initAppStore` → `boot(storage)`).
   DB 가 회복되면 부팅은 DB 를 정본으로 삼으므로, 임시 사본에만 있는 편집은 **조용히 무시**된다 —
   그게 이 마커의 존재 이유다. 마커가 있으면 배너가 "지난 세션에 임시 저장된 편집이 있다"고
   말하고 파일로 회수할 길을 준다.

   ⚠ **자동 병합하지 않는다.** 임시 사본과 DB 는 둘 다 "그 시점의 전체 스냅샷"이라 어느 쪽이
   최신인지 필드 단위로 판정할 근거가 없다. 통째로 채택하면 그 사이 다른 기기에서 동기화된
   편집을 되돌린다(LWW 로 서버까지 이겨 조용히 소실 — 이 저장소가 두 번 물린 형태).
   사람이 파일을 보고 가져올지 정하는 것이 유일하게 안전한 처리다.

   ⚠ 마커 정리는 **사용자가 확인한 뒤에만** 한다(H19 와 같은 규율 — 회수 경로가 회수 대상을
   먼저 지우면 안 된다).
============================================================ */
import { storage } from '../kv';
import { KEY } from '../persistence';

/** 임시 저장이 일어난 시각(ms). 값이 있으면 "회수하지 않은 임시 사본이 있다"는 뜻. */
const MARK_KEY = KEY + '_dbfallback';

/** 임시 저장 직후 호출. 이미 있으면 **덮어쓴다**(가장 최근 시각이 사용자에게 유용하다). */
export function markDbFallback(at: number = Date.now()): void {
  try {
    storage.setItem(MARK_KEY, String(at));
  } catch {
    /* 마커를 못 써도 임시 저장 자체는 유효하다 — 배너(가용성 쪽)가 여전히 뜬다. */
  }
}

/** 회수하지 않은 임시 사본의 시각(ms). 없으면 null. */
export function dbFallbackAt(): number | null {
  try {
    const raw = storage.getItem(MARK_KEY);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** 사용자가 확인·회수한 뒤 정리. */
export function clearDbFallback(): void {
  try {
    storage.removeItem(MARK_KEY);
  } catch {
    /* 정리 실패는 치명 아님 — 다음 시도에서 재정리 */
  }
}

/** 임시 사본 원본(localStorage `KEY`). 파일 회수용 — 없으면 null. */
export function dbFallbackSnapshot(): string | null {
  try {
    return storage.getItem(KEY);
  } catch {
    return null;
  }
}
