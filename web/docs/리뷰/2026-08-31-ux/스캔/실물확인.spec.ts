/* ============================================================
   실물확인.spec.ts — 2026-08-31 ux 축 회차의 **메인 실물 확인 하네스**(리뷰 산출물 · 게이트 밖).

   왜 별도 하네스인가: `e2e/_fixtures.ts` 의 `boot()` 는 `artifact_read` 스텁에
   `knowledge`·`goals` 를 **아직 먹인다**. 그 둘은 2026-08-29 에 부모(pipeline)에서
   **생산자째 삭제**됐으므로, 검증망은 «더는 발생할 수 없는 데이터 상태»를 찍고 있다.
   여기서는 **살아 있는 아티팩트만**(`ledger`) 답해 주고 나머지는 실물처럼 reject 해서,
   사용자가 **오늘 실제로 보는 화면**을 찍는다.

   실행: cd web && npx playwright test -c docs/리뷰/2026-08-31-ux/스캔/실물확인.config.ts
   ⛔ 게이트에 넣지 마라 — 이 파일은 회차의 증거 채취 도구이지 계약이 아니다.
============================================================ */
import { test } from '@playwright/test';
import path from 'node:path';
import { FIXED, LEDGER_FIXTURE, SEED, settle } from '../../../../e2e/_fixtures';

/** `boot()` 의 사본 — 다른 점은 **fixtures 에 `knowledge`·`goals` 가 없다**는 것 하나뿐이다. */
async function bootReal(page: import('@playwright/test').Page, theme: string) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(
    (fixtures: Record<string, unknown>) => {
      (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
        invoke: (cmd: string, args?: { name?: string }) => {
          if (cmd === 'artifact_read' && args?.name && args.name in fixtures) {
            return Promise.resolve({ ok: true, data: fixtures[args.name] });
          }
          return Promise.reject(new Error('NOT_FOUND'));
        },
        transformCallback: (cb: unknown) => cb,
      };
    },
    { ledger: LEDGER_FIXTURE } as Record<string, unknown>,
  );
  await page.clock.install({ time: FIXED });
  await page.addInitScript(
    ([s, th]) => {
      try {
        localStorage.setItem('study_planner_v3', JSON.stringify({ ...(s as object), theme: th }));
      } catch {
        /* noop */
      }
    },
    [SEED, theme] as const,
  );
}

const SCREENS: { key: string; path: string }[] = [
  { key: 'today', path: '/today' },
  { key: 'review', path: '/review' },
  { key: 'subject', path: '/subject/m' },
  { key: 'ledger', path: '/ledger' },
  { key: 'ledger-mastery', path: '/ledger?view=mastery' },
  { key: 'degree', path: '/degree' },
  { key: 'degree-path', path: '/degree?view=path' },
  { key: 'find-guide', path: '/find?view=guide' },
  { key: 'stats', path: '/stats' },
];

for (const sc of SCREENS) {
  test(`실물 · ${sc.key}`, async ({ page }) => {
    await bootReal(page, 'dark');
    await page.goto(sc.path);
    await settle(page);
    // 「사망을 로딩처럼」 판정 — 4초 더 기다려도 같은 프레임이면 그건 로딩이 아니다.
    await page.waitForTimeout(4000);
    await page.screenshot({
      path: path.join(
        process.cwd(),
        'docs',
        '리뷰',
        '2026-08-31-ux',
        '화면',
        `실물-${sc.key}${process.env.SHIPWIN ? '-배포창' : ''}.png`,
      ),
      fullPage: true,
    });
  });
}
