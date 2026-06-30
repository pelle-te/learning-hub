import { test, expect } from '@playwright/test';

/* 스모크 — 실제 빌드물(dist)에서 셸·나브·라우팅·팔레트·폴백이 동작하는지(베이스라인 불필요). */

test('앱이 뜨고 레일 나브로 탭 이동 + ⌘K 팔레트가 열린다', async ({ page }) => {
  await page.goto('/today');
  await expect(page.getByLabel('오늘 대시보드')).toBeVisible();

  // 레일 사이드바: 1차 탭(통계)으로 직접 이동.
  await page.getByRole('tab', { name: '통계' }).click();
  await expect(page).toHaveURL(/\/stats$/);

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
  await expect(page.getByLabelText('탐구 주제')).toBeVisible({ timeout: 15000 });
});
