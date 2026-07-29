/* ============================================================
   isTauri.ts — "지금 셸 안인가" **한 줄**만 있는 모듈(H7 · 2026-07-26 감사).

   ## 왜 `tauri.ts` 에서 떼어냈나 — 폰 초기 로드의 30.3% 가 폰이 못 쓰는 표면이었다

   `db/sqlite.ts` 의 `import { isTauri, dbUrl } from '../tauri'` **한 줄**이 `lib/tauri.ts`
   (503줄 · 백엔드 커맨드 전량 + zod 스키마)를 부팅 경로로 끌었다. `sqlite.ts` 는 `db/boot`·
   `cloud/client`·`telemetry` 가 전부 물어 **두 엔트리의 초기 청크**가 됐고, 폰 96.1KB 중
   29.1KB 가 그 표면이었다 — 폰은 artifact·research·ollama·anki 를 **한 번도 안 부른다.**

   판정 자체는 2줄이다. 그 2줄과 503줄이 같은 모듈에 있을 이유가 없다.

   ⚠ **`tauri.ts` 가 이걸 다시 export 한다.** 기존 호출부(`from '@/lib/tauri'`)를 전부 고치면
   diff 만 커지고 얻는 게 없다 — 이미 무거운 함수를 쓰는 모듈들은 어차피 그 파일을 문다.
   중요한 것은 **부팅 경로의 모듈들이 여기서 가져가는 것**이다(`db/*`·`cloud/client`·`telemetry`).
============================================================ */

/** Tauri WebView 안에서 실행 중인가. 브라우저(dev·트랙 A·폰)에선 false. */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
