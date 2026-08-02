/* ============================================================
   miniMode.test.ts — 미니 HUD 창 모드(N-8)의 **브라우저 안전성**과 복귀 경로.
   창 조작 자체(진짜 크기·항상 위)는 트랙 B 가 본다 — 여기선 "셸이 아닐 때 아무 일도
   안 일어난다"와 "복귀가 왔던 곳을 기억한다"만 잠근다(둘 다 순수 판정이라 유닛이 제자리).
============================================================ */
import { expect, it, describe } from 'vitest';
import { enterMini, exitMini, wasTransient, MINI_PATH } from '@/lib/miniMode';

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

/* ── Q-26 캡처 착지(2026-08-02) ──────────────────────────────────────────────
   가르는 것 하나: **손으로 들어온 미니**와 **캡처 한 건을 받으려고 잠깐 들어온 미니**. 구분이
   없으면 캡처를 닫는 순간 사용자가 요청한 창 모드가 함께 사라진다(또는 반대로 알약에 갇힌다).

   ⚠ **jsdom 은 그 갈림을 못 본다** — `enterMini` 가 `isTauri()` 에서 먼저 false 로 끝나므로
   `transient` 가 참이 되는 경로에 도달할 수 없다(창 조작이 필요한 것은 트랙 B 의 몫이다).
   그래서 여기서 잠그는 것은 **이 플래그에 적용된 같은 규율**이다: 진입이 실패했으면 아무것도
   바뀌지 않는다. 이게 공허한 검사가 아닌 이유는, 플래그 대입을 `isTauri()` 가드 **위로** 한 줄만
   올려도 실패한 진입이 참을 남기고 — 그러면 나중에 손으로 들어온 미니가 그 뜻을 물려받아
   캡처를 닫는 순간 창이 제멋대로 커진다(조용한 회귀 · 이 파일이 막으려는 부류 그대로). */
describe('Q-26 transient — 진입이 실패하면 뜻도 남지 않는다', () => {
  it('브라우저에서 캡처용 진입을 시도해도 플래그가 서지 않는다', async () => {
    await expect(enterMini('/today', true)).resolves.toBe(false);
    expect(wasTransient()).toBe(false);
  });

  it('기본값은 손으로 들어온 미니다 — 뜻을 명시하지 않으면 머문다', async () => {
    await enterMini('/today');
    expect(wasTransient()).toBe(false);
  });

  it('나가면 플래그가 지워진다 — 다음 진입이 옛 뜻을 물려받지 않는다', async () => {
    await enterMini('/today', true);
    await exitMini();
    expect(wasTransient()).toBe(false);
  });
});
