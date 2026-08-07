/* ============================================================
   miniMode.test.ts — 미니 HUD 창 모드(N-8)의 **브라우저 안전성**과 복귀 경로.
   창 조작 자체(진짜 크기·항상 위)는 트랙 B 가 본다 — 여기선 "셸이 아닐 때 아무 일도
   안 일어난다"와 "복귀가 왔던 곳을 기억한다"만 잠근다(둘 다 순수 판정이라 유닛이 제자리).
============================================================ */
import { expect, it, describe } from 'vitest';
import { enterMini, exitMini, miniMode, MINI_PATH } from '@/lib/miniMode';

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

/* ── Q-26 캡처 착지(2026-08-02) → **어휘 셋으로 확장**(N-20 · W3 · 2026-08-07) ────────
   가르는 것은 **왜 들어왔는가**다. 종전엔 부울(`transient`) 하나였고 그게 답하던 질문은
   *"캡처가 끝나면 나갈까"* 뿐이었는데, N-20 이 세 번째 이유(세션 없는 **상주**)를 더하면서
   부울로는 표현 불가가 됐다 — 둘 다 false 인 상태가 두 뜻을 갖는다.

   ⚠ **jsdom 은 그 갈림을 못 본다** — `enterMini` 가 `isTauri()` 에서 먼저 false 로 끝나므로
   `mode` 가 바뀌는 경로에 도달할 수 없다(창 조작이 필요한 것은 트랙 B 의 몫이다).
   그래서 여기서 잠그는 것은 **그 값에 적용된 같은 규율**이다: 진입이 실패했으면 아무것도
   바뀌지 않는다. 이게 공허한 검사가 아닌 이유는, 대입을 `isTauri()` 가드 **위로** 한 줄만
   올려도 실패한 진입이 뜻을 남기고 — 그러면 나중에 손으로 들어온 미니가 그 뜻을 물려받아
   캡처를 닫는 순간 창이 제멋대로 커지거나(옛 형태), 상주 알약이 세션 종료 감시에 걸려
   **켜지자마자 스스로 나간다**(새 형태). 둘 다 조용한 회귀다. */
describe('미니 모드의 뜻 — 진입이 실패하면 뜻도 남지 않는다', () => {
  it('브라우저에서 캡처용 진입을 시도해도 뜻이 안 바뀐다', async () => {
    await expect(enterMini('/today', 'capture')).resolves.toBe(false);
    expect(miniMode()).toBe('session');
  });

  it('상주 진입도 마찬가지다 — 실패한 진입은 상주 표식을 남기지 않는다', async () => {
    await expect(enterMini('/today', 'resident')).resolves.toBe(false);
    expect(miniMode()).toBe('session');
  });

  it('기본값은 집중 세션을 접은 미니다 — 뜻을 명시하지 않으면 세션 계약을 따른다', async () => {
    await enterMini('/today');
    expect(miniMode()).toBe('session');
  });

  it('나가면 뜻이 초기화된다 — 다음 진입이 옛 뜻을 물려받지 않는다', async () => {
    await enterMini('/today', 'capture');
    await exitMini();
    expect(miniMode()).toBe('session');
  });
});
