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
const LIB_RS = fileURLToPath(new URL('../../src-tauri/src/lib.rs', import.meta.url));
const TAURI_TS = fileURLToPath(new URL('../src/lib/tauri.ts', import.meta.url));

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

/* ============================================================
   C034 / C053(2026-08-22 코드 축 1회차) — **커맨드 로스터가 두 벌 손유지인데 대조가 0이었다.**

   ## 무엇이 틀렸었나

   `web/src/lib/tauri.ts` 의 호출 이름들과 `src-tauri/src/lib.rs` 의 `generate_handler![…]` 는
   같은 집합이어야 하는데, 그것을 확인하는 자리가 저장소 전체에 **0건**이었다
   (`rg -c "generate_handler|invoke_handler" web/test web/scripts web/e2e` → 0).
   트랙 B 는 24 중 **6개만** 부르고 그 목록조차 손으로 적혀 있었다.

   ## 왜 무증상인가 — 이것이 이 케이스의 요점이다

   프런트의 여러 커맨드가 `catch` 로 감싸여 실패를 `null` 로 삼킨다. 가장 나쁜 것은 C2 가드다:

   ```ts
   try { return await call('db_version_guard', undefined, DbGuardZ); } catch { return null; }
   ```

   Rust 에서 그 이름을 개명하거나 모듈 정리로 등록에서 빼면(**선례가 있다** — P10 W4 가
   `news.rs`·`research.rs` 를 실제로 삭제했다) 다운그레이드 가드와 `drifted` 판정이 통째로
   사라진 채 **앱이 정상으로 뜬다** — 신버전이 적용한 DB 를 구버전이 열고 "뜨는데 데이터가
   옛날 것"이 된다. 이때 `verify`·`cargo test`·트랙 A 는 물론 **트랙 B 도 녹색**이다.
   `checkShape` 는 응답 *모양*만 보므로 이름 드리프트를 원리적으로 못 본다.

   ## 방향이 양쪽인 이유

   · TS→Rust — 개명·제거가 `catch` 로 삼켜져 가드가 **무증상으로** 소실되는 것을 막는다.
   · Rust→TS — 호출부가 사라진 커맨드(P10 W4 의 `news`·`research` 형태)가 배관으로 남는 것을 막는다.

   ⚠ 추출은 두 관용구를 다 봐야 한다: 대부분은 `call<T>('name'…)` 이지만 스트리밍 둘
   (`ollama_run`·`ollama_cancel`)은 `core.invoke` 를 직접 쓴다(실측 · 처음 짠 정규식이 그 둘을
   놓쳐 «TS 에만 있는 것 0 · Rust 에만 있는 것 9» 라는 거짓 드리프트를 냈다).
   ⚠ 파싱이 0을 내면 **던진다** — 조용히 통과하면 이 파일이 이름만 남는다.
============================================================ */
describe('커맨드 로스터 계약 — TS 호출 ↔ Rust generate_handler!', () => {
  const libRs = readFileSync(LIB_RS, 'utf8');
  const tauriTs = readFileSync(TAURI_TS, 'utf8');

  /** `generate_handler![ … ]` 블록 안의 `모듈::커맨드` 이름들. */
  const registered = (): Set<string> => {
    const block = /generate_handler!\[([\s\S]*?)\n\s*\]\)/.exec(libRs)?.[1];
    if (!block) throw new Error('lib.rs 에서 generate_handler! 블록을 못 찾았다 — 파싱을 고칠 것.');
    const names = [...block.matchAll(/^\s*[a-z_]+::([a-z_0-9]+),/gm)].map((m) => m[1]!);
    if (!names.length) throw new Error('generate_handler! 안에서 커맨드를 하나도 못 뽑았다.');
    return new Set(names);
  };

  /** `lib/tauri.ts` 가 실제로 부르는 커맨드 이름들(두 관용구). */
  const called = (): Set<string> => {
    const names = [
      ...[...tauriTs.matchAll(/\bcall\s*(?:<[^>]*>)?\s*\(\s*'([a-z_0-9]+)'/g)].map((m) => m[1]!),
      ...[...tauriTs.matchAll(/\bcore\.invoke\s*(?:<[^>]*>)?\s*\(\s*'([a-z_0-9]+)'/g)].map((m) => m[1]!),
    ];
    if (!names.length) throw new Error('tauri.ts 에서 커맨드 호출을 하나도 못 뽑았다 — 관용구가 바뀌었다.');
    return new Set(names);
  };

  it('프런트가 부르는 커맨드가 전부 `generate_handler!` 에 등록돼 있다', () => {
    const r = registered();
    expect(
      [...called()].filter((c) => !r.has(c)).sort(),
      '개명·제거는 catch 로 삼켜져 무증상으로 기능만 죽는다(C2 다운그레이드 가드가 그 형태다)',
    ).toEqual([]);
  });

  it('등록된 커맨드에 프런트 호출부가 있다 — 지워진 기능의 배관 탐지', () => {
    const c = called();
    expect(
      [...registered()].filter((n) => !c.has(n)).sort(),
      'P10 W4 의 news·research 형태 — 화면이 떠난 뒤 Rust 쪽만 남았는가',
    ).toEqual([]);
  });

  it('⚠ 스트리밍 둘(`core.invoke` 직접 호출)이 추출에 걸린다 — 관용구가 하나가 아니다', () => {
    const c = called();
    expect(c.has('ollama_run'), 'core.invoke 관용구가 추출에서 빠졌다').toBe(true);
    expect(c.has('ollama_cancel')).toBe(true);
  });

  it('⚠ 양쪽 추출이 비어 있지 않다 — 0이면 이 계약이 아무것도 안 잰다', () => {
    expect(registered().size).toBeGreaterThan(15);
    expect(called().size).toBe(registered().size);
  });
});
