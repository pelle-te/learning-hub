import { test, expect } from './_test';
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

  /* 레일 사이드바로 탭 이동(라우트 내비 = button + aria-current, ARIA tablist 아님).
     ⚠⚠ **좌표가 바뀌었다 — 축 접기(2026-08-28).** `통계` 는 이제 접힌 축 안이라 `/today` 에서
     직접 누를 수 없다. 대신 그 축의 **헤더**가 얼굴로 데려간다(= 같은 1클릭). 이 케이스가 재는
     명제는 그대로다: *레일에서 한 번 눌러 다른 화면으로 간다.*
     ⚠ 헤더가 «접기 토글»로 퇴화하면 여기서 URL 이 안 바뀌어 즉시 빨개진다 — 그게 이 좌표
     이동의 값이다(빈손으로 끝나는 클릭 금지). */
  await page.getByRole('button', { name: /무엇을 아는가/ }).click();
  await expect(page).toHaveURL(/\/stats$/);
  await expect(page.getByRole('button', { name: /무엇을 아는가/ })).toHaveAttribute('aria-expanded', 'true');

  /* D-8 전이 방향 — 애니 자체는 정지 프레임 스냅샷에 안 잡히지만, **어느 문법이 골라졌는지**는
     `<html data-vt>` 로 관측 가능하다. 이게 없으면 방향 문법 전체가 "돌고 있다고 믿는" 층이 된다.
     오늘(order 10) → 통계(80)라 앞으로 가는 형제 이동이다. */
  await expect(page.locator('html')).toHaveAttribute('data-vt', 'lateral');
  await expect(page.locator('html')).toHaveAttribute('data-vt-dir', 'fwd');

  /* ⚠⚠ **N-14(W5 · 2026-08-07) — 세그먼트 바가 은퇴했고 `descend` 의 근거도 함께 사라졌다.**
     그 문법은 *호스트 → 그 안의 조망* 이라는 두 층 구조의 것이었는데, 레일이 평탄해지며 모든
     화면이 형제가 됐다. 그래서 여기서 재는 것도 바뀐다: **레일에서 렌즈로 직접 간다**(옛
     세그먼트 클릭 = 레일 1 + 세그먼트 1 이 1클릭이 된 것이 이 웨이브의 산출 그 자체다).
     ⚠ 아래 옛 주석 둘은 **이 케이스가 IA 변경을 두 번 잡아낸 기록**이라 남긴다.

     ── 옛 주석 ──
     통계 → 그 안의 조망(숙달도)으로 = 안으로 들어감(descend). 세그먼트 바가 그 경로다.
     ⚠ **2026-07-29(E13) 에 대상이 바뀌었다.** 옛 단언은 `예보` 를 눌러 descend 를 봤는데,
     `forecast` 가 인출 축의 **호스트로 승격**하면서 통계↔예보는 이제 *형제*(lateral)다 —
     테스트가 틀린 게 아니라 관계가 바뀐 것이고, 그래서 descend 를 보려면 실제로 통계 **안에**
     있는 렌즈를 눌러야 한다. 이 케이스가 IA 변경을 조용히 통과시키지 않은 것이 요점이다.
     ⚠ 두 번째로 그 일을 했다(H-24 · 2026-08-06): 앎 바가 `segLabel` 을 얻으면서 이 버튼의
     **접근명이 `숙달도 지도` → `숙달`** 로 바뀌었다(세그먼트 버튼의 접근명은 보이는 글자
     그대로다 — `SubTabs` 에 `aria-label` 이 없다). 나브·⌘K·문서 제목은 계속 `label` 을 쓰므로
     여기만 짧아진다. */
  /* ⚠ `mastery` 는 A-19 에서 `ledger` 로 통합됐다 — 레일에 서는 것은 `정본 원장` 이고,
     같은 섹션의 형제라 전이는 `lateral` 이다. */
  await page.getByRole('button', { name: '정본 원장' }).click();
  await expect(page).toHaveURL(/\/ledger$/);
  await expect(page.locator('html')).toHaveAttribute('data-vt', 'lateral');

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
  /* ⚠ **앱이 붙을 때까지 기다린 뒤에 키를 누른다.** 처음엔 `toHaveURL` 만 걸었는데 그건 `goto`
     시점에 이미 참이라 **아무것도 안 기다린다** — 리스너가 등록되기 전에 `?` 가 날아가 CI(ubuntu)
     에서 flaky 로 나타났다(로컬 통과 · 러너 실패). 같은 파일의 첫 스모크가 쓰는 것과 같은 대기를
     쓴다. ⚠ 재시도로 덮지 않는다 — 이 저장소는 "flaky 를 결함으로, 결함을 flaky 로" 읽는 쪽에
     이미 물린 적이 있다. */
  await expect(page.getByLabel('오늘 대시보드')).toBeVisible();
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
   ⚠ 임계 50ms 의 근거: 이 값은 계산이 아니라 **대기**를 재므로 CPU 성능에 둔감하다 —
   고친 뒤 preview 실측이 1x **−1.6ms** · 4x CPU 쓰로틀링에서도 **−10.5ms** 로, 느린 기기에서
   오히려 더 음수다(마크 둘이 같은 커밋 안에 있다). 그래서 50 은 가끔 걸치는 선이 아니라
   **한 커밋이 더 생겼는가**를 묻는 선이다.
   ⚠⚠ **이 자리에 있던 「고치기 전 260ms · 5배 이상 이격」은 2026-08-01 측정이고, 그 측정은
   `/today` 직행으로 들어가 **제품이 안 쓰는 주소**를 재고 있었다**(P028 · 2026-08-27). 그 동안
   실제 진입점 `/` 는 37.9ms(4x 182.8ms)였고, 이 가드는 그것을 한 번도 본 적이 없다. */
test('첫 라우트가 Suspense 폴백을 거치지 않는다 — 부팅 대기 0', async ({ page }) => {
  /* ⚠⚠ **`/` 로 들어간다 — 셸이 그렇게 뜬다**(P028 · 2026-08-27). `tauri.conf.json` 창 설정에
     `url` 이 없어 데스크톱 셸의 진입점은 언제나 `/` 이고, `/today` 직행은 **제품이 한 번도 안 밟는
     주소**다. 그 주소로 재면 이 가드가 뜻하는 것은 «회귀 없음»이 아니라 «그 회귀가 사는 자리를
     안 봤음» 이다 — 같은 커밋에서 `/today` 는 −1.3ms 로 통과하고 `/` 는 37.9ms(4x 182.8ms)였다. */
  await page.goto('/');
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

/* ⚠⚠ **여기 H19(WebGL 컨텍스트 손실 → CSS 폴백 → 복구) 케이스가 있었다 — 그 캔버스가
   은퇴했다**(I045 · 2026-08-22 발상 축). 이 케이스의 출처는 사용자 PC 에서 실제로 관측된
   TDR(화면이 한 번씩 검게 꺼짐)이었고, **그 사고가 곧 은퇴의 근거**였다: 장식이 피해를 줬고
   그걸 막느라 붙은 방어(컨텍스트 복구·가시성 정지·`fxLite` 분기)가 코드를 더 키웠다.
   배경은 이제 정적 CSS 그라데이션이라 잃을 컨텍스트가 없다. */
