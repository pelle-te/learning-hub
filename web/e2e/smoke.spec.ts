import { test, expect } from '@playwright/test';
import { boot } from './_fixtures';

/* 스모크 — 실제 빌드물(dist)에서 셸·나브·라우팅·팔레트·폴백이 동작하는지(베이스라인 불필요). */

test('앱이 뜨고 레일 나브로 탭 이동 + ⌘K 팔레트가 열린다', async ({ page }) => {
  /* ⚠⚠ **시드가 없으면 `/today` 는 온보딩 화면이다**(H14 · 2026-07-26). `setupComplete(items)`
     가 거짓이면 `Today.tsx` 가 `TodaySignature` 를 **아예 렌더하지 않는다** — 즉 아래 단언의
     대상이 존재하지 않는다.
     이 테스트는 그 변경 이후로 계속 실패하고 있었다: 2026-07-26 감사가 "today 계열 테스트 4건이
     콜드스타트 상태에서 대시보드를 검사하고 있었다"를 발견해 시드를 심었는데, **`smoke` 는 그
     목록에 없었다**(다섯 번째였다). 2026-07-29 에 다른 작업 중 드러났고, 내 변경 이전 커밋을
     빌드해 재현하는 것으로 **선재 결함임을 확인**했다.
     ⚠ 아래 두 테스트는 시드를 **일부러 안 준다** — 각각 '신규 부팅 기본 테마'와 콜드 게이트
       화면이 관심사라, 여기 시드를 공유로 올리면 그 둘이 검사 대상을 잃는다. */
  await boot(page, 'dark');
  await page.goto('/today');
  await expect(page.getByLabel('오늘 대시보드')).toBeVisible();

  // 레일 사이드바: 1차 탭(통계)으로 직접 이동(라우트 내비 = button + aria-current, ARIA tablist 아님).
  await page.getByRole('button', { name: '통계' }).click();
  await expect(page).toHaveURL(/\/stats$/);

  /* D-8 전이 방향 — 애니 자체는 정지 프레임 스냅샷에 안 잡히지만, **어느 문법이 골라졌는지**는
     `<html data-vt>` 로 관측 가능하다. 이게 없으면 방향 문법 전체가 "돌고 있다고 믿는" 층이 된다.
     오늘(order 10) → 통계(80)라 앞으로 가는 형제 이동이다. */
  await expect(page.locator('html')).toHaveAttribute('data-vt', 'lateral');
  await expect(page.locator('html')).toHaveAttribute('data-vt-dir', 'fwd');

  /* 통계 → 그 안의 조망(숙달도)으로 = 안으로 들어감(descend). 세그먼트 바가 그 경로다.
     ⚠ **2026-07-29(E13) 에 대상이 바뀌었다.** 옛 단언은 `예보` 를 눌러 descend 를 봤는데,
     `forecast` 가 인출 축의 **호스트로 승격**하면서 통계↔예보는 이제 *형제*(lateral)다 —
     테스트가 틀린 게 아니라 관계가 바뀐 것이고, 그래서 descend 를 보려면 실제로 통계 **안에**
     있는 렌즈를 눌러야 한다. 이 케이스가 IA 변경을 조용히 통과시키지 않은 것이 요점이다. */
  await page.getByRole('button', { name: '숙달도 지도' }).click();
  await expect(page).toHaveURL(/\/mastery$/);
  await expect(page.locator('html')).toHaveAttribute('data-vt', 'descend');

  // ⌘K 명령 팔레트.
  await page.keyboard.press('Control+k');
  await expect(page.getByPlaceholder(/명령·탭 검색/)).toBeVisible();
  await page.keyboard.press('Escape');
});

test('테마 토글이 <html data-theme>를 바꾼다(다크 기본 → 라이트)', async ({ page }) => {
  await page.goto('/today');
  // 시드 없는 신규 부팅 → 다크 기본(에디토리얼 다크, 세피아 폐기).
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '테마 전환' }).click(); // dark → light
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('탐구 수집 탭이 로드되고 검색 히어로를 표시한다', async ({ page }) => {
  await page.goto('/control');
  // 옛 OPS 콘솔 폐기 → 탐구 수집 검색 탭. 검색 히어로 + 주제 입력.
  await expect(page.getByRole('heading', { name: /무엇을 새로 알아볼까요/ })).toBeVisible();
  await expect(page.getByLabel('탐구 주제')).toBeVisible({ timeout: 15000 });
});

/* ============================================================
   H10 — **떠 있는 층 위에서 단일키가 뒤를 움직이면 안 된다**(2026-08-01 `/감사 근본`).

   감사의 검증사각 표가 이 케이스를 **처방했다**(*"H10~H13 키보드 전이 → e2e 키보드 케이스 신설 ·
   axe 는 렌더된 기본 상태만 본다"*). 사각인 이유가 그 괄호다: axe 도 시각 스냅샷도 **정지한 한
   상태**를 보는데, 이 결함은 *상태 사이를 옮겨 다니는 동안*에만 나타난다.

   관측된 형태: `?` 치트시트를 열고 **거기 적힌 `g`+키를 그대로 눌러 보면** 뒤에서 탭이 바뀐다.
   리스너가 **캡처 단계**라 다이얼로그보다 먼저 돌고, 게이트는 `isTyping() || palette` 둘뿐이라
   `help` 를 몰랐다. 배우려고 누른 키가 배우려던 화면을 치우는 셈이다.

   ⚠ **음성만 잠그면 안 된다** — "아무 키도 안 먹는다"로 고쳐도 이 단언은 통과한다. 그래서 닫은
   뒤 같은 키가 **실제로 이동시키는지**를 짝으로 본다(양성 대조). 유닛(`test/keyGate.test.tsx`)이
   게이트 *판정*을 잠그고, 여기서는 **전이**를 본다 — 둘은 다른 것을 지킨다.
============================================================ */
test('치트시트가 떠 있으면 `g` 시퀀스가 뒤의 탭을 바꾸지 않는다 (H10)', async ({ page }) => {
  await boot(page, 'dark');
  await page.goto('/today');
  await expect(page).toHaveURL(/\/today$/);

  await page.keyboard.press('?');
  await expect(page.getByRole('dialog').first()).toBeVisible();

  // 치트시트에 적힌 그대로: `g` 그다음 `a`(= 통계 · SEQ_OVERRIDE). 열려 있는 동안엔 먹으면 안 된다.
  await page.keyboard.press('g');
  await page.keyboard.press('a');
  await expect(page.getByRole('dialog').first(), '단일키가 새면 오버레이도 함께 흔들린다').toBeVisible();
  await expect(page, '치트시트를 읽는 중에 뒤에서 탭이 바뀌었다(H10)').toHaveURL(/\/today$/);

  // ⚠ 양성 대조 — 닫으면 같은 키가 **실제로** 이동시킨다(게이트가 키를 죽인 게 아니다).
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.press('g');
  await page.keyboard.press('a');
  await expect(page, '게이트가 단일키를 통째로 죽였다면 이 단언이 잡는다').toHaveURL(/\/stats$/);
});

/* ⚠ **부팅 대기 260ms 회귀 가드**(2026-08-01 실측). `test/tabWarm.test.ts` 가 *배선*(첫 라우트가
   `lazy` 가 아니다)을 잠그고, 여기서는 *결과*(실제로 안 기다린다)를 본다 — 배선이 맞아도 다른
   경로에서 Suspense 가 다시 걸리면 유닛은 녹색이다.
   ⚠ 임계 50ms 의 근거: 고친 뒤 실측은 **0ms 대**(마크 둘이 같은 커밋)이고 고치기 전은 **260ms**
   였다. 5배 이상 떨어져 있어 머신 편차로 뒤집히지 않는다. 이 값은 계산이 아니라 **대기**를
   재므로 CPU 성능에 둔감하다. */
test('첫 라우트가 Suspense 폴백을 거치지 않는다 — 부팅 대기 0', async ({ page }) => {
  await page.goto('/today');
  await page.waitForFunction(() => performance.getEntriesByName('hub:first-data', 'mark').length > 0);
  const gap = await page.evaluate(() => {
    const at = (n: string) => performance.getEntriesByName(n, 'mark')[0]?.startTime ?? null;
    const app = at('hub:app');
    const data = at('hub:first-data');
    return app == null || data == null ? null : data - app;
  });
  expect(gap, '마크가 없으면 계량이 죽은 것이다 — 통과로 읽지 않는다').not.toBeNull();
  expect(gap!, 'React Suspense 억제(≈248ms)가 돌아왔다 — `registry.warmTab` 머리주석 참조').toBeLessThan(50);
});

/* ⚠ **정지 프레임 게이트가 원리적으로 못 보는 층**(H19 · 2026-08-01). 시각 스냅샷은 손실 *전*
   프레임을 찍으므로, 컨텍스트가 죽은 뒤 배경이 영구히 비는 상태를 44장이 전부 통과시킨다.
   그래서 여기서 `WEBGL_lose_context` 로 **직접 강제**한다 — 이 확장은 드라이버가 아니라 WebGL
   구현이 제공하므로 `--disable-gpu`(SwiftShader) 환경에서도 그대로 동작한다.
   사용자 PC 에서 실제로 관측된 TDR(화면이 한 번씩 검게 꺼짐)이 이 케이스의 출처다. */
test('WebGL 컨텍스트를 잃으면 CSS 폴백으로 내려가고, 복구되면 다시 올라온다 (H19)', async ({ page }) => {
  await page.goto('/today');
  const canvas = page.locator('canvas[aria-hidden="true"]').first();
  await expect(canvas).toBeVisible();
  const bg = () => canvas.evaluate((el: HTMLCanvasElement) => el.style.background);

  /* 전제: 컨텍스트가 실제로 살아 있다. 살아 있으면 인라인 배경이 비어 있다(`alpha:false` 캔버스가
     불투명하게 덮으므로 폴백을 켜 둘 이유가 없다). 여기서 실패하면 그건 "환경에 WebGL 이 없다"는
     뜻이고 — 조용히 건너뛰지 않고 시끄럽게 알리는 것이 맞다(아래 두 단언이 무의미해지므로). */
  expect(await bg()).toBe('');

  await canvas.evaluate((el: HTMLCanvasElement) => {
    const ext = el.getContext('webgl')?.getExtension('WEBGL_lose_context') ?? null;
    Reflect.set(window, '__h19lose', ext);
    ext?.loseContext();
  });
  // 손실 → 즉시 폴백(빈 배경으로 남지 않는다).
  await expect.poll(bg).not.toBe('');

  await page.evaluate(() => {
    (Reflect.get(window, '__h19lose') as WEBGL_lose_context | null)?.restoreContext();
  });
  // 복구 → 폴백 해제 = `buildRig` 가 셰이더를 다시 세웠다는 관측 가능한 증거.
  await expect.poll(bg).toBe('');
});
