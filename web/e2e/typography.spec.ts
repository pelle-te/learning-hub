import { test, expect } from './_test';
import { A11Y_EXTRA, TABS, boot, settle } from './_fixtures';

/* ============================================================
   typography.spec.ts — **「지금과 같은가」가 아니라 「무엇이어야 하는가」**(V024 · 2026-08-22).

   ## 무엇이 틀렸었나 — 스냅샷 88장이 붕괴를 정답으로 굳혔다

   ⚠ 워드마크는 2026-08-31 에 `<h1>` 에서 `<div data-wordmark>` 로 내려갔다(U065 — 앱의 유일한
   `h1` 이 모든 화면에서 「러닝 허브」라 표제 축으로 «지금 어디인가»를 되찾을 수 없었다). 그래서
   이 파일의 셀렉터는 **태그가 아니라 `data-wordmark`** 다. ⭐ 그 전환에서 아래 «조용한 통과 방어»
   케이스가 실제로 값을 했다: `header h1` 이 0건이 되자 위 루프는 `continue` 로 전부 건너뛰어
   **초록이었을 것**인데, 그 케이스가 «검사가 죽었다»를 잡았다.

   `app/TopBar.tsx` 의 워드마크가 `BAR`(flex)의 첫 아이템인데 폭 제약이 없어 기본
   `flex-shrink:1` 로 줄었다. 리드아웃이 긴 탭(`schedule`·`alloc`)에서는 형제들이 자리를 다
   가져가 워드마크가 **한 글자 폭**까지 눌려 「러/닝/허/브」 **네 줄**이 됐다(실측 h1 높이
   40px → **80px**). U021 이 `flex-none` 으로 고쳤다.

   ⚠⚠ **시각 회귀 88장이 그것을 못 잡았다** — 그 그림이 **베이스라인으로 굳어 있었기** 때문이다.
   스냅샷은 「지금과 같은가」만 묻는다. 붕괴가 먼저 굳으면 그 뒤로는 붕괴가 정답이다.

   ## 그래서 이 파일은 베이스라인을 안 쓴다

   재는 것은 **불변 관계** 하나다: *브랜드 마크의 조판은 어느 화면에서도 같다.* 로고는 축약
   대상이 아니므로(그 파일 주석: *"줄이려면 `max-mobile` 처럼 **다른 조판을 명시**하는 것이지
   가용 폭에 따라 조용히 무너지는 것이 아니다"*), 화면마다 높이가 다르면 그것이 곧 결함이다.
   베이스라인이 없으니 **굳을 그림도 없다** — U021 이전 상태였다면 이 검사가 첫 실행에서
   빨간불이었을 것이고, 그게 이 파일의 존재 이유다.

   ⚠ 이 축 하나로 `V024` 가 다 닫히지는 않는다. 「스냅샷이 지금만 묻는다」는 게이트 설계 문제는
   **부류**이고, 여기 있는 것은 그 부류에 대한 **한 관계**다. 같은 형태의 관계를 더 찾으면
   이 파일에 잇는다(새 스펙을 만들지 마라 — 그러면 관계 목록이 파일마다 흩어진다).
============================================================ */

const 화면들 = [...TABS.map((t) => ({ key: t, path: '/' + t })), ...A11Y_EXTRA];

test('⚠⚠ 브랜드 워드마크의 조판이 **어느 화면에서도 같다** — 가용 폭에 따라 무너지지 않는다', async ({ page }) => {
  await boot(page, 'dark');

  const 측정 = [];
  for (const 화면 of 화면들) {
    if ('prep' in 화면 && 화면.prep) await 화면.prep(page);
    await page.goto(화면.path);
    if ('ready' in 화면 && 화면.ready) await 화면.ready(page);
    await settle(page);

    const h1 = page.locator('header [data-wordmark]').first();
    if ((await h1.count()) === 0) continue; // 크롬이 없는 화면(`/mini` 등)은 대상이 아니다
    const box = await h1.boundingBox();
    측정.push({ 화면: 화면.key, 높이: Math.round(box?.height ?? 0) });
  }

  expect(측정.length, '워드마크를 한 화면에서도 못 찾았다 — 이 검사가 아무것도 안 잰다').toBeGreaterThan(8);

  const 높이들 = [...new Set(측정.map((m) => m.높이))];
  expect(
    높이들.length,
    `워드마크가 화면마다 다르게 조판된다(= 형제에게 자리를 뺏겨 줄바꿈). 실측:\n` +
      측정.map((m) => `  ${m.화면}: ${m.높이}px`).join('\n') +
      `\n⚠ 로고는 축약 대상이 아니다 — 줄이려면 다른 조판을 **명시**하라(TopBar.tsx 의 그 자리 ⚠).`,
  ).toBe(1);

  /* ⚠⚠ **눌렸는지**도 본다 — 모든 화면에서 «똑같이 눌려» 있으면 위 단언만으로는 통과한다.

     ⚠ 세는 법을 한 번 틀렸다(2026-08-22): 처음엔 «조각이 한 줄인가»로 쟀는데 `MARK_PART` 가
     `whitespace-nowrap` 이라 조각은 **원리적으로 줄바꿈하지 않는다** — 폭이 없으면 **넘친다**.
     즉 그 단언은 영원히 초록인 검사였다. 지금 구조에서 «눌림»의 관측 가능한 증상은 **넘침**이다.
     ⚠ 워드마크 전체가 두 줄인 것은 **설계다**(「러닝」/「허브」 스택 · 모바일은 `inline`) —
     그래서 «전체 줄 수»로도 재지 않는다. */
  const 넘침 = await page
    .locator('header [data-wordmark]')
    .first()
    .evaluate((el) => [...el.children].map((c) => Math.round(c.scrollWidth - c.clientWidth)));
  expect(넘침.length, '워드마크가 조각으로 안 나뉘어 있다 — 이 단언이 아무것도 안 잰다').toBeGreaterThan(0);
  expect(
    넘침.filter((px) => px > 1).length,
    `워드마크 조각이 자기 상자를 넘친다(실측 넘침 px: ${넘침.join(', ')}) — 형제에게 폭을 뺏긴 ` +
      '상태이고, 이것이 U021 이 고친 붕괴의 현재 구조에서의 증상이다. 로고는 축약 대상이 아니다.',
  ).toBe(0);
});

test('⚠ 이 검사가 실제로 붕괴를 잡는다 — 폭을 뺏어 확인한다(조용한 통과 방어)', async ({ page }) => {
  /* ⚠⚠ **`flex-none` 을 지우는 것으로는 더 이상 재현되지 않는다**(2026-08-22 실측). U021 이후
     `BAR` 의 조판이 바뀌어 그 한 줄만으로는 워드마크가 안 눌린다. 즉 **역사적 방아쇠는
     사라졌고**, 그렇다고 이 검사가 「잡을 수 있다」고 주장할 근거가 되지는 않는다.
     그래서 붕괴 조건을 직접 만든다 — 재는 것은 «그 커밋을 잡았겠는가»가 아니라
     **«눌리면 빨간불이 되는가»** 이고, 후자가 이 검사가 파는 성질이다. */
  await boot(page, 'dark');
  await page.goto('/today');
  await settle(page);

  const 넘침 = await page
    .locator('header [data-wordmark]')
    .first()
    .evaluate((el) => {
      // 폭을 한 글자로 조인다 = 형제가 자리를 다 가져간 상태의 재현.
      const h = el as HTMLElement;
      h.style.flex = '1 1 0';
      h.style.maxWidth = '1ch';
      return [...el.children].map((c) => Math.round(c.scrollWidth - c.clientWidth));
    });
  expect(
    넘침.some((px) => px > 1),
    `폭을 1ch 로 조였는데도 넘침이 0이다(${넘침.join(', ')}) — 이 검사는 붕괴를 못 잡는다`,
  ).toBe(true);
});
