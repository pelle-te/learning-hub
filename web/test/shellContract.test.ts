/* ============================================================
   shellContract.test.ts — **셸(Rust)과 프런트(TS)가 공유하는 상수의 정합**(M-8 · 2026-08-06 감사).

   ## 왜 이 파일이 생겼나

   `tray.rs` 에 이런 테스트가 있었다:

   ```rust
   assert_eq!(QUIT_FALLBACK_MS, 3000);   // "web/.../tauri.ts 의 installCloseGuard 기본값"
   assert_eq!(TRAY_QUIT, "tray:quit");   // "web/.../tauri.ts 의 onShellQuit 구독 이름"
   ```

   둘 다 **자기 자신을 손베낌 상수와 비교**한다 — TS 쪽이 5000 이 되어도, 이벤트 이름을 바꿔도
   **통과한다.** 즉 "두 값이 같다"는 계약을 지킨다고 적혀 있지만 실제로는 *Rust 값이 안 바뀌었다*만
   확인한다. 검사가 계약의 **한쪽 끝만** 보고 있으면 그건 계약 검사가 아니다.

   ## 옳은 선례가 같은 저장소에 있었다

   `dbMigrations.test.ts` 는 `db.rs` 를 **파싱해서** 대조한다(TS 가 Rust 를 읽는 유일한 테스트였다).
   여기가 두 번째다 — 방향이 이쪽인 이유: 두 값 중 **하나는 반드시 원본에서 읽어야** 하고, Rust 가
   TS 를 읽으려면 빌드가 `web/` 에 결합된다(cargo 만 도는 CI 에서 깨진다).

   ⚠ 파싱이 실패하면 **테스트가 실패한다** — 조용히 건너뛰면 "녹색인데 아무것도 안 쟀다"가 된다
   (`testkit.rs` 가 세운 규율과 같다).
============================================================ */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NOTIFY_CLICK_EVENT } from '@/lib/tauri';

/* ⚠ 종전엔 `tray.rs` 도 파싱했다(종료 폴백 타임아웃·트레이 종료 이벤트) — **트레이가
   은퇴했다**(I049 · 2026-08-22). 남은 계약은 알림 착지 이벤트 이름 하나다. */
const NOTIFY_RS = fileURLToPath(new URL('../../src-tauri/src/notify.rs', import.meta.url));
const src = readFileSync(NOTIFY_RS, 'utf8');

/** Rust 소스에서 상수 하나를 뽑는다. 못 찾으면 던진다(조용한 skip 금지). */
function rustConst(name: string, re: RegExp, from: string = src): string {
  const m = re.exec(from);
  if (!m?.[1]) throw new Error(`Rust 소스에서 ${name} 를 못 찾았다 — 선언이 바뀌었다면 이 파싱을 고칠 것.`);
  return m[1];
}

describe('셸↔프런트 상수 계약 — Rust 원본을 파싱해 대조한다', () => {
  /* ⚠ 여기 트레이 계약 두 케이스(종료 폴백 타임아웃 · 종료 이벤트 이름)가 있었다 — I049. */

  /* W3(발산 6회차) — 알림 **착지**. 이름이 갈리면 토스트를 눌러도 아무 데도 안 가고, 그건
     화면에 아무 증상도 안 남긴다(P-8 이 잡은 "한 번도 안 쐈다"와 같은 종류의 무증상 결함). */
  it('알림 클릭 이벤트 이름이 프런트 구독 이름과 짝이다', () => {
    const rust = rustConst('NOTIFY_CLICK', /NOTIFY_CLICK:\s*&str\s*=\s*"([^"]+)"/);
    expect(rust, '갈리면 알림을 눌러도 착지가 영영 안 일어난다(무증상)').toBe(NOTIFY_CLICK_EVENT);
  });

  it('⚠ 파싱 자체가 살아 있다 — 없는 상수를 찾으면 던진다(조용한 통과 금지)', () => {
    expect(() => rustConst('없는것', /THIS_DOES_NOT_EXIST:\s*u64\s*=\s*(\d+)/)).toThrow();
  });
});
