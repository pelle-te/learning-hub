/* ============================================================
   log.ts — **프런트의 실패를 디스크에 남기는 유일한 다리**(O007 · 2026-08-22 운영 축).

   ## 무엇이 없었나 — 한쪽만 고쳐진 짝

   `src-tauri/src/lib.rs` 는 릴리스에서 `LevelFilter::Warn` + `TargetKind::LogDir` 로 파일 싱크를
   세우고, 그 주석이 스스로 *"stdout 만 두면 GUI 앱에서는 아무 데도 안 남는다"* 라 적었다.
   그런데 **그 싱크에 닿는 프런트 경로가 셋 다 없었다**(전부 실측):
     ① `@tauri-apps/plugin-log` 가 `web/package.json` 에 **0건**
     ② `capabilities/default.json` 의 `permissions` 13개에 **`log:*` 없음**(있어도 ACL 이 막는다)
     ③ `devtools` 피처 **0건**

   ## 실패 시나리오 (이 파일이 없을 때)

   사용자 PC 의 릴리스 exe 에서 `sqlite.ts:140` 의 `[db] SQLite 연결 실패 — 저장이 되지 않습니다`
   가 뜬다. 릴리스 WebView2 엔 devtools 가 없고 JS→파일 경로도 없다 → **그 문자열은 증발한다.**
   사용자가 "저장이 안 돼요" 라고 말해도 첨부할 것은 `learning-hub.log` 하나이고 거기 프런트 줄은
   **0** 이다. 같은 운명이 **38곳/15파일**에 걸려 있었다(`write.ts:368` 저장·대조 예외 ·
   `write.ts:127` 병합 창 우회 · `boot.ts:223` 부팅 읽기 실패 포함).

   ⚠ **`I052` 가 인정한 대가는 「폰 한정」이었다**(*"폰에서는 이제 아무 데도 안 남는다"*).
   데스크톱도 같다는 것이 이 실측이고, 그 사실은 어디에도 안 적혀 있었다 — 즉 이건 «없다»가
   아니라 **«범위가 잘못 적혀 있었다»** 이다.

   ## 왜 «가로채기»인가 — 38곳을 고치지 않는다

   `console.error` 호출부를 전부 `log.error` 로 바꾸는 것은 처방이 아니다. 그건 38번의 편집이고,
   **39번째가 생기면 다시 샌다.** 대신 싱크를 **한 겹** 씌운다 — 호출부는 그대로 두고, 이 다리가
   `console.error`·`console.warn` 을 감싸 원본 호출 **뒤에** 파일 싱크로도 흘린다.
   (C067 이 `onClick={async …}` 69곳을 린트로 69번 고치는 대신 «누르는 층»에 감시를 달아 한 번에
   덮은 것과 **같은 형태**다.)

   ⚠ **원본을 먼저 부른다.** 브리지가 던져도 콘솔 출력이 사라지면 안 된다 — 관측이 관측 대상을
   해치지 않는다는 이 저장소의 규율 그대로다.
   ⚠ **레벨을 error·warn 으로 좁힌다.** `lib.rs` 릴리스 필터가 `Warn` 이라 그 아래는 어차피
   버려지고, `log`·`info` 까지 흘리면 디스크에 쌓이는 것이 잡음이 된다.
   ⚠ **셸에서만 돈다.** 브라우저(dev·트랙 A·폰)엔 그 커맨드가 없다 — `isTauri()` 가 그 판정이고,
   폰의 관측 공백은 여전히 `I033` 의 몫이다(이 파일이 그것을 덮는다고 읽지 마라).
============================================================ */
import { isTauri } from './isTauri';

/** 두 번 씌우지 않는다 — 부팅 경로가 여러 번 불려도 원본이 겹겹이 감싸이면 안 된다. */
let 걸림 = false;

/**
 * `console.error`·`console.warn` 을 Rust 파일 싱크로도 흘린다. 셸이 아니면 아무것도 안 한다.
 *
 * ⚠ **부팅 체인의 첫 줄에서 1회** 부른다. 그리고 `main.tsx` 는 SD-7 부팅 순서 계약상
 * **동적 import** 여야 한다 — 이 모듈이 `useApp` 을 끌어오지는 않지만, 그 계약을 지키는 쪽이
 * 정적 그래프를 예측 가능하게 둔다(번들 예산 축 ②가 그 그래프를 잰다).
 */
export async function bridgeConsole(): Promise<void> {
  if (걸림 || !isTauri()) return;
  걸림 = true;
  try {
    const { error, warn } = await import('@tauri-apps/plugin-log');
    const 싱크 = { error, warn } as const;
    for (const k of ['error', 'warn'] as const) {
      const 원본 = console[k].bind(console);
      console[k] = (...a: unknown[]): void => {
        원본(...a);
        /* ⚠ 실패를 삼킨다 — 로그를 못 남기는 것이 앱을 멈추게 하면 처방이 병보다 나쁘다.
           그리고 여기서 `console.error` 를 부르면 **자기 자신을 다시 부른다**(무한 재귀). */
        void 싱크[k](a.map(꼴).join(' ')).catch(() => {});
      };
    }
  } catch {
    /* 플러그인을 못 불러도 앱은 그대로 돈다 — 이 다리는 관측이지 기능이 아니다. */
  }
}

/**
 * 인자 하나를 로그 줄로 만든다.
 *
 * ⚠ `String(e)` 만 쓰면 `Error` 가 `"Error: 실패"` 로 접혀 **스택이 통째로 사라진다** — 그런데
 * 이 다리가 나르려는 것의 대부분이 정확히 `Error` 다(`console.error('…', e)` 관용구).
 * ⚠ 객체는 `String()` 이 `[object Object]` 를 준다 — 그 줄은 로그에 있으나 마나다.
 */
function 꼴(v: unknown): string {
  if (v instanceof Error) return v.stack ?? `${v.name}: ${v.message}`;
  if (typeof v === 'object' && v !== null) {
    try {
      return JSON.stringify(v);
    } catch {
      return '[순환 객체]';
    }
  }
  return String(v);
}
