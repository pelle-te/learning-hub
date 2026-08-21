/* ============================================================
   snapshots.ts — **되돌릴 수 있는 지점의 사다리**(I038 · 2026-08-22 발상 축).

   ## 무엇이 없었나 — 세대가 1이었다

   이 앱의 파괴적 동작(초기화 · 가져오기 · 보관 · 하루 마감)은 전부 직전에 백업을 찍는다
   (`backupOrConfirm` → `backupNow`). 그런데 그 백업은 **칸이 하나**였다: 두 번째 파괴적 동작이
   첫 번째의 백업을 덮는다. 실제 형태는 이렇다 —

     ① 가져오기(잘못된 파일) → 백업 A 저장 → 상태가 엉킨다
     ② "어라" 하고 다시 가져오기 → **백업 A 가 B 로 덮인다**(B = 이미 엉킨 상태)
     ③ 되돌리기 → 엉킨 상태로 돌아간다. **A 는 없다.**

   즉 회수 경로가 **자기 자신을 덮는다.** 이 저장소가 `downloadCorruptSnapshot`(H19)과
   `archiveOld`(H2)에서 두 번 고친 형태 — *"복구 경로가 복구 대상을 파괴한다"* — 가 세대 축에
   남아 있던 것이다.

   밖의 대응(docs.ankiweb.net/backups.html · 확인 2026-08-22)은 **주기+세대**이고, 그 문서가
   스스로 못박는 한계도 함께 가져온다: **같은 기기에 있으므로 기기가 부서지면 무의미하다.**
   화면이 그 사실을 말하지 않으면 이 기능은 안전이 아니라 안전의 착각을 판다.

   ## 계약

   · 세대 {@link GENERATIONS} 개. 새 스냅샷이 들어오면 한 칸씩 밀리고 가장 오래된 것이 떨어진다.
   · 각 세대는 `(json, at)` 쌍이다. 시각을 **별도 키**로 두는 이유는 `BACKUP_AT_KEY` 와 같다:
     JSON 안에 넣으면 저장 형태가 바뀌어 복원 경로를 건드리는데, 그 경로는 마지막 안전망이다.
   · 가장 최신 세대의 키가 **기존 `BACKUP_KEY` 그대로**다 — 옛 저장본이 그대로 0세대로 읽히고,
     `undoLast` 의 동작이 한 글자도 안 바뀐다(마이그레이션 0).
   · 저장 실패는 **거짓을 돌린다**(던지지 않는다). 호출부가 «되돌리기 불가»를 사용자에게 묻는다.

   ⚠ **여기서 화면을 판정하지 않는다.** "되돌릴 수 있는가"는 목록의 길이가 답하고, 그 목록을
   그리는 것은 설정 화면이다(이 파일은 순수 · KV 주입 — `uiState`·`sidecars` 와 같은 형태).
============================================================ */
import { BACKUP_AT_KEY, BACKUP_KEY } from './persistence';
import type { KV } from './types';

/** 세대 수. 3인 이유: 파괴적 동작을 연달아 두 번 해도 원본이 남는다(위 ①②③ 시나리오 + 한 칸). */
export const GENERATIONS = 3;

/** n 번째 세대의 키. 0 = 최신 = **옛 `BACKUP_KEY` 그대로**(마이그레이션 0). */
export function genKey(n: number): string {
  return n === 0 ? BACKUP_KEY : `${BACKUP_KEY}_g${n}`;
}
function genAtKey(n: number): string {
  return n === 0 ? BACKUP_AT_KEY : `${genKey(n)}_at`;
}

export interface Snapshot {
  /** 복원할 때 넘기는 값. */
  key: string;
  /** 몇 세대 전인가(0 = 가장 최근). */
  gen: number;
  /** 찍힌 시각(epoch ms). 옛 저장본엔 없어서 `null` 일 수 있다 — 그래도 복원은 된다. */
  at: number | null;
}

/**
 * 새 스냅샷을 0세대에 넣고 나머지를 한 칸씩 민다. 실패하면 `false`.
 *
 * ⚠ **뒤에서부터 민다.** 앞에서부터 밀면 같은 값이 전 세대에 복사된다(고전적인 배열 시프트
 * 버그이고, 여기서 그러면 «세 세대가 있는데 전부 같은 순간»이 되어 이 기능이 조용히 무효화된다).
 * ⚠ 미는 도중 실패해도 **0세대 쓰기는 시도한다** — 옛 세대를 잃는 것보다 지금 것을 못 남기는
 * 편이 나쁘다(그게 이 함수가 서는 자리의 계약이다: 파괴 직전).
 */
export function pushSnapshot(kv: KV, json: string, at: number): boolean {
  for (let n = GENERATIONS - 1; n >= 1; n--) {
    try {
      const prev = kv.getItem(genKey(n - 1));
      if (prev == null) {
        kv.removeItem(genKey(n));
        kv.removeItem(genAtKey(n));
        continue;
      }
      kv.setItem(genKey(n), prev);
      const prevAt = kv.getItem(genAtKey(n - 1));
      if (prevAt == null) kv.removeItem(genAtKey(n));
      else kv.setItem(genAtKey(n), prevAt);
    } catch {
      /* 한 세대를 못 밀어도 아래 0세대 쓰기는 시도한다 */
    }
  }
  try {
    kv.setItem(genKey(0), json);
    kv.setItem(genAtKey(0), String(at));
    return true;
  } catch {
    return false;
  }
}

/** 살아 있는 세대 — **최신 순**. 비어 있으면 되돌릴 것이 없다. */
export function snapshots(kv: KV): Snapshot[] {
  const out: Snapshot[] = [];
  for (let n = 0; n < GENERATIONS; n++) {
    try {
      if (kv.getItem(genKey(n)) == null) continue;
      const raw = kv.getItem(genAtKey(n));
      const at = raw == null ? NaN : Number(raw);
      out.push({ key: genKey(n), gen: n, at: Number.isFinite(at) ? at : null });
    } catch {
      /* 접근 불가는 «없음»으로 읽는다 */
    }
  }
  return out;
}

/** 한 세대의 원문. 없으면 `null`. */
export function readSnapshot(kv: KV, key: string): string | null {
  try {
    return kv.getItem(key);
  } catch {
    return null;
  }
}

/**
 * 쓴 세대를 지운다(짝인 시각 키까지).
 *
 * ⚠ 지우기만 하고 **당겨 채우지 않는다.** 당기면 «내가 방금 되돌린 지점»이 다른 세대의 이름으로
 * 되살아나 목록이 한 칸 젊어지고, 사용자는 같은 지점으로 두 번 돌아갈 수 있다고 읽는다.
 */
export function dropSnapshot(kv: KV, key: string): void {
  try {
    kv.removeItem(key);
    kv.removeItem(key === BACKUP_KEY ? BACKUP_AT_KEY : `${key}_at`);
  } catch {
    /* noop */
  }
}
