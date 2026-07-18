/* ============================================================
   themeColor.spec.ts — 테마별 색 토큰이 실제로 '갈리는지' 브라우저에서 검증.

   왜 별도 스펙인가: 시각 스냅샷은 이 축을 못 잡는다. 라이트 스냅샷은 전부 빈 상태라
   CBMS 칩·숙달도 셀 같은 색 소비처가 아예 렌더되지 않고, 설령 렌더돼도 스냅샷은
   "깨진 렌더를 정본으로 굳힐" 뿐 대비 실패를 잡지 못한다.

   지키는 회귀 둘:
   ① --ok/--muted가 한때 "테마 무관 대표색"이라며 다크값 그대로 라이트에 쓰여 1.58:1 · 2.54:1로 소멸했다.
   ② masteryColor의 명도가 42~52% 하드코딩이라 다크에선 저숙달 빨강이, 라이트에선 고숙달 초록이 묻혔다.
      이제 --mastery-l0/l1 토큰 보간이라 calc()가 유효해야 하고(무효면 선언이 통째로 버려진다) 테마별로 달라야 한다.
============================================================ */
import { test, expect } from '@playwright/test';

/** 주어진 테마에서 CSS 값들을 계산된 색으로 해석한다. */
async function resolve(page: import('@playwright/test').Page, theme: string, decls: string[]) {
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  return page.evaluate((ds) => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const out = ds.map((d) => {
      el.style.color = '';
      el.style.color = d;
      return getComputedStyle(el).color;
    });
    el.remove();
    return out;
  }, decls);
}

// masteryColor(p)가 만들어내는 문자열과 동일한 형태(p=0 · p=1).
const MASTERY_LOW = 'hsl(0 62% calc(var(--mastery-l0) + (var(--mastery-l1) - var(--mastery-l0)) * 0.000))';
const MASTERY_HIGH = 'hsl(120 62% calc(var(--mastery-l0) + (var(--mastery-l1) - var(--mastery-l0)) * 1.000))';
const DECLS = ['var(--ok)', 'var(--muted)', 'var(--info)', MASTERY_LOW, MASTERY_HIGH];

test('테마 색 토큰이 라이트/다크에서 서로 다른 값으로 해석된다', async ({ page }) => {
  await page.goto('/');
  const dark = await resolve(page, 'dark', DECLS);
  const light = await resolve(page, 'light', DECLS);

  // 계산 실패(잘못된 calc·미정의 토큰) 시 브라우저가 선언을 버려 초기값 검정이 남는다.
  for (const v of [...dark, ...light]) expect(v).not.toBe('rgb(0, 0, 0)');

  // 다섯 축 모두 테마별로 갈려야 한다 — 하나라도 같으면 한쪽 테마에서 대비가 무너진 것.
  for (let i = 0; i < DECLS.length; i++) {
    expect(light[i], `${DECLS[i]} 가 두 테마에서 동일하다`).not.toBe(dark[i]);
  }
});
