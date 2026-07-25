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

/* ── "지금 임시 저장으로 돌고 있다" 신호 ─────────────────────────────────────

   ⚠ **판정 기준이 "연결 실패"가 아니라 "저장이 실제로 임시본으로 떨어졌다" 인 것이 의도다.**

   처음엔 `getDb()` 실패(= 연결)를 신호로 삼았는데, 트랙 A 가 그 선택이 틀렸음을 즉시 보여 줬다:
   하네스는 `__TAURI_INTERNALS__` 스텁을 심어(산출물 IPC 를 목업하려고) `isTauri()` 를 참으로
   만들지만 `plugin:sql|*` 은 거부한다 → **모든 시각 스냅샷에 경고 배너가 떴다.** 그건 하네스
   사정이지 사용자 상태가 아니다.

   더 중요한 것은 그게 우연이 아니라는 점이다 — 사용자에게 참인 사실은 "DB 소켓이 안 열렸다"가
   아니라 **"내가 방금 한 편집이 정본에 못 갔다"** 이고, 후자만이 행동(내보내기 백업)을 부른다.
   편집이 없었다면 잃을 것도 없다. 그래서 이 플래그는 `useApp.flush` 가 `unavailable` 을 받은
   순간 켜지고, 저장이 다시 성공하면 꺼진다. */
let _saveFallback = false;
const _subs = new Set<() => void>();

/** `useApp.flush` 전용 — 정본 저장 실패/성공을 그대로 반영한다. */
export function setSaveFallback(on: boolean): void {
  if (_saveFallback === on) return;
  _saveFallback = on;
  for (const cb of [..._subs]) cb();
}

/** 이번 세션의 편집이 임시 사본에만 남고 있는가(동기 — 배너가 읽는다). */
export function isSaveFallback(): boolean {
  return _saveFallback;
}

/** 신호 구독(`useSyncExternalStore` 용). 반환값은 해제 함수. */
export function onSaveFallback(cb: () => void): () => void {
  _subs.add(cb);
  return () => {
    _subs.delete(cb);
  };
}

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
