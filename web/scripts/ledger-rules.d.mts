/* `ledger-rules.mjs` 의 타입 — **JS 로 둔 이유가 있다**(V078·V096 · 2026-09-01).
   그 판정을 `freshness.mjs`(순수 Node 스크립트)와 `a11y.spec.ts`(Playwright TS)와
   vitest 가 **같은 파일로** 봐야 하는데, TS 로 두면 Node 스크립트 쪽이 못 읽는다.
   그래서 구현은 `.mjs`, 계약은 여기. ⚠ 둘이 갈리면 이 선언이 거짓말이 되므로
   `test/ledgerRules.test.ts` 가 실동작을 함께 잠근다. */
export interface 원장항목 {
  사유: string;
  재검토: string;
}
export interface 원장판정결과 {
  만료: string[];
  사문: string[];
  적용: string[];
  ok: boolean;
}
export function 원장판정(입력: {
  원장: Record<string, 원장항목>;
  상태: Record<string, boolean>;
  오늘?: string;
}): 원장판정결과;
export function 원장메시지(이름: string, 결과: 원장판정결과, 원장: Record<string, 원장항목>): string;
