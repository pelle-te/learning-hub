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
