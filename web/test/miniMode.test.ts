/* ============================================================
   miniMode.test.ts — 미니 HUD 창 모드(N-8)의 **브라우저 안전성**과 복귀 경로.
   창 조작 자체(진짜 크기·항상 위)는 트랙 B 가 본다 — 여기선 "셸이 아닐 때 아무 일도
   안 일어난다"와 "복귀가 왔던 곳을 기억한다"만 잠근다(둘 다 순수 판정이라 유닛이 제자리).
============================================================ */
import { expect, it, describe } from 'vitest';
import { enterMini, exitMini, MINI_PATH } from '@/lib/miniMode';

describe('miniMode — 브라우저(dev·트랙 A)에선 통째로 무동작', () => {
  it('진입이 false 를 돌려준다 — 호출부가 라우팅을 취소해 반쪽 상태가 안 생긴다', async () => {
    // jsdom 에는 __TAURI_INTERNALS__ 가 없다 = isTauri() false.
    await expect(enterMini('/today')).resolves.toBe(false);
  });

  it('진입에 실패했으면 복귀도 기본 경로다(가짜 출처를 만들지 않는다)', async () => {
    await enterMini('/stats');
    await expect(exitMini()).resolves.toBe('/today');
  });

  it('미니 경로 자신은 출처가 될 수 없다 — 펼치기가 다시 알약으로 가면 갇힌다', async () => {
    await enterMini(MINI_PATH);
    await expect(exitMini()).resolves.toBe('/today');
  });
});
