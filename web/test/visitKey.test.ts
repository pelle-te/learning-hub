/* ============================================================
   visitKey.test.ts — **방문 원장이 세는 키**의 계약(I034 · 2026-08-22 발상 축).

   ## 왜 이 파일이 생겼나

   `App` 은 `route_visits.key` 를 `pathname.split('/')[1]` 로 만들었다. 그런데 이 저장소의
   은퇴 관용구는 화면을 **지우는 대신 호스트의 `?view=` 로 내린다**(W9). 두 규칙이 겹치면
   흡수된 화면의 방문이 전부 호스트 이름으로 집계되고 — 그 화면은 **자기 몫의 수를 다시는
   갖지 못한다.** 「관측이 쌓이면 판정한다」가 원리적으로 안 오는 상태가 된다.

   ⚠ 여기서 잠그는 것 셋:
   ① 흡수된 화면은 **자기 key** 로 센다(그래야 살릴 근거도 지울 근거도 생긴다)
   ② 로스터에 없는 `?view=` 값은 **호스트로 떨어진다**(카디널리티를 로스터가 묶는다 —
      임의 쿼리가 키가 되면 원장이 무한히 갈리고 은퇴 규칙이 읽을 어휘가 사라진다)
   ③ 반환값은 **언제나 비지 않는다**(루트 `/` 는 `today`).
============================================================ */
import { describe, expect, it } from 'vitest';
import { visitKeyOfLocation, routeLabelOfLocation, tabByKey } from '@/shell';

describe('visitKeyOfLocation — 흡수된 화면이 자기 몫을 얻는다', () => {
  it('쿼리가 없으면 첫 세그먼트다(종전 동작 유지)', () => {
    expect(visitKeyOfLocation('/today', '')).toBe('today');
    expect(visitKeyOfLocation('/review-run', '')).toBe('review-run');
  });

  it('⚠ 루트는 today 다 — 빈 키가 원장에 들어가면 그 행은 아무것도 안 가리킨다', () => {
    expect(visitKeyOfLocation('/', '')).toBe('today');
    expect(visitKeyOfLocation('', '')).toBe('today');
  });

  /* 로스터에서 `to` 를 그대로 읽는다 — 뷰 값이 바뀌거나 은퇴 탭이 늘어도 이 케이스가 따라온다
     (`routeLabelOfLocation` 이 손으로 적은 목록을 안 두는 것과 같은 규율). */
  it('⭐ `?view=` 로 흡수된 화면은 **자기 key** 로 센다', () => {
    // ⛔ 'mastery' 가 2026-08-29 에 빠졌다(그 뷰 은퇴 · 부모 목적 정정).
    for (const key of ['forecast']) {
      const to = tabByKey(key)?.to;
      expect(to, `${key} 는 to 를 가진 은퇴 탭이어야 한다`).toBeTruthy();
      const [path = '', query = ''] = String(to).split('?');
      expect(visitKeyOfLocation(path, `?${query}`)).toBe(key);
    }
  });

  it('⚠⚠ 로스터에 없는 뷰 값은 호스트로 떨어진다 — 임의 쿼리가 키가 되면 카디널리티가 터진다', () => {
    expect(visitKeyOfLocation('/items', '?view=made-up')).toBe('items');
    expect(visitKeyOfLocation('/items', '?q=hello')).toBe('items');
    expect(visitKeyOfLocation('/degree', '?view=')).toBe('degree');
  });

  /* H-12(이름 축)와 I034(관측 축)는 **같은 표를 읽는 짝**이다. 한쪽만 고치면 다시 갈린다. */
  it('이름과 키가 같은 판정을 쓴다 — 이름이 흡수된 화면을 말하면 키도 그 화면이다', () => {
    const to = String(tabByKey('forecast')?.to);
    const [path = '', query = ''] = to.split('?');
    expect(routeLabelOfLocation(path, `?${query}`)).toBe(tabByKey('forecast')?.label);
    expect(visitKeyOfLocation(path, `?${query}`)).toBe('forecast');
  });
});
