import { test, expect, type Page } from '@playwright/test';

/* 비주얼 회귀 — 앱상태 탭들을 다크(기본)/라이트 2테마로 스크린샷(에디토리얼 다크 리디자인·세피아 폐기).
   결정성: ① 고정 시드(localStorage) ② 고정 시각(page.clock) — '오늘'·D-day·스트릭이 날짜에 안 흔들리게.
   첫 실행은 `npm run e2e:update`로 베이스라인 생성, 이후 `npm run e2e`로 회귀 비교.

   ⚠ 시드·fixture·부팅 헬퍼는 **`_fixtures.ts` 로 갈라졌다**(2026-07-25) — `a11y.spec.ts` 가
   같은 상태를 봐야 하기 때문. 근거는 그 파일 머리주석. */
import { FIXED, SEED, SEED_EMPTY, TABS, TABS_EMPTY, THEMES, boot, settle, bootArtifactPhase } from './_fixtures';

for (const theme of THEMES) {
  for (const tab of TABS) {
    test(`${tab} · ${theme}`, async ({ page }) => {
      await boot(page, theme);
      await page.goto('/' + tab);
      await expect(page.locator('#main')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      // lazy 탭 청크가 로드돼 실제 콘텐츠가 그려질 때까지 대기(Suspense 폴백/스켈레톤이 아니라
      // 진짜 화면을 캡처). 탭 본문은 h2 또는 aria-label 섹션을 가짐(TopBar h1·레일엔 없음).
      await expect(page.locator('#main h2, #main section[aria-label]').first()).toBeVisible();
      // ⚠ integrations 텔레메트리(SERVE.JS 채널)는 `usePing` 이 mount 시 'probing'(연결 확인 중)을
      // 한 틱 렌더한 뒤 track A 에선 반드시 'offline'(스텁이 capabilities 를 reject → 백엔드 없음)로
      // settle 한다. 이 전이가 toHaveScreenshot 과 레이스하면 flaky(§15 기록의 실사고). settled 카피가
      // **뜰 때까지** 대기해 전이 완료를 보장한다 — 'probing 없음'을 기다리지 않는 것이 의도다:
      // 그러면 카피가 바뀌었을 때 count 0 으로 조용히 통과해 flaky 가 되살아난다. 여기(존재 단정)는
      // 카피가 바뀌면 timeout 으로 시끄럽게 깨진다.
      if (tab === 'integrations') await expect(page.getByText('워크스페이스 설정 필요(설정 탭)')).toBeVisible();
      // ⚠ graph 도 같은 부류다(2026-07-24 계산-스타일 대조에서 발견 — 픽셀 게이트는 못 잡고 있었다).
      // 범례의 '의미 연결' 칩은 `semStatus` 가 settle 한 뒤에야 붙는다: 트랙 A 에선 임베딩 커맨드가
      // reject 되어 반드시 'unavailable'(= Ollama 필요) 로 끝나는데, 그 전에 찍으면 칩이 통째로
      // 빠진 상을 박는다(실측: 같은 실행에서 dark 는 50노드, light 는 48노드). integrations 와 같은
      // **존재 단정**으로 전이 완료를 보장한다(카피가 바뀌면 조용히 통과하지 않고 timeout).
      if (tab === 'graph') await expect(page.getByText('의미 연결 — Ollama 필요')).toBeVisible();
      await settle(page);
      await expect(page).toHaveScreenshot(`${tab}-${theme}.png`, { fullPage: true });
    });
  }
}

// 빈 상태(신규 사용자) — 데이터 의존 탭이 텅 비지 않고 의도적으로 보이는지.
for (const theme of THEMES) {
  for (const tab of TABS_EMPTY) {
    test(`${tab} · empty · ${theme}`, async ({ page }) => {
      await boot(page, theme, SEED_EMPTY);
      await page.goto('/' + tab);
      await expect(page.locator('#main')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('#main h2, #main section[aria-label]').first()).toBeVisible();
      await settle(page);
      await expect(page).toHaveScreenshot(`${tab}-empty-${theme}.png`, { fullPage: true });
    });
  }
}

/* 복습 부하 예보(ID-1) — 막대 차트 실렌더(§15-4). 공유 SEED 는 완료 챕터가 done 처리라 예보가
   비어(=오늘탭 backlog) TABS 루프는 '빈 상태'만 찍는다. 여기선 최근 완료된(아직 미완) 챕터를
   심어 '다가오는 파도'가 실제 막대로 그려지는지를 별도 픽셀로 잡는다 — 정적 검사가 못 보는
   회색 토큰·컬럼 붕괴를 이 화면만이 드러낸다. 공유 SEED 를 안 건드려 다른 59장 베이스라인은 불변. */
const SEED_FORECAST = {
  schemaVersion: 3,
  theme: 'dark',
  startDate: '2026-06-01',
  moduleLen: 120,
  reviewRatio: 20,
  completions: {
    '2026-06-04': { 'm|rev': { done: true, min: 60 } }, // 극한·미분 터치(daysSince 11)
    '2026-06-08': { 'p|new': { done: true, min: 60 } }, // 역학 터치(daysSince 7)
    '2026-06-11': { 'm|rev': { done: true, min: 60 } }, // 미분 최신 터치(daysSince 4)
  },
  items: [
    {
      id: 'm',
      source: '직접',
      name: '미적분',
      color: '#4f8ff0',
      mode: 'weekly',
      weeklyHours: 6,
      dailyMin: 30,
      deadline: '2026-08-15',
      chapters: [
        { id: 'c1', name: '극한', hours: 3, done: false },
        { id: 'c2', name: '미분', hours: 4, done: false },
      ],
    },
    {
      id: 'p',
      source: '직접',
      name: '일반물리',
      color: '#1eb5a3',
      mode: 'weekly',
      weeklyHours: 4,
      dailyMin: 30,
      deadline: '',
      chapters: [{ id: 'c3', name: '역학', hours: 5, done: false }],
    },
  ],
  routine: [{ id: 'r1', name: '수면', type: '수면', start: '00:00', end: '07:00', days: [0, 1, 2, 3, 4, 5, 6] }],
  cbms: [],
  degree: { targetTotal: 130, reqMajorReq: 60, reqMajorSel: 30, reqLiberal: 30, semesters: [] },
};
for (const theme of THEMES) {
  test(`forecast · full · ${theme}`, async ({ page }) => {
    await boot(page, theme, SEED_FORECAST);
    await page.goto('/forecast');
    await expect(page.locator('#main')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.locator('#main h2').first()).toBeVisible(); // 막대 화면(빈 상태 아님)
    await settle(page);
    await expect(page).toHaveScreenshot(`forecast-full-${theme}.png`, { fullPage: true });
  });
}

/* On This Day 회고(ID-4) — 오늘 히어로에 '달력상 같은 날'의 과거 실기록 한 줄. 공유 SEED 는
   이력 14일이라 30일+ 게이트에 막혀(=회고 침묵) today 스냅샷엔 안 나온다. 여기선 −4주 요약 +
   오래된 완료(이력 30일+ 충족)를 심어 회고 줄이 실제로 렌더되는지 잡는다(§15-4 · 회색·붕괴 방지). */
const SEED_ONTHISDAY = {
  ...SEED,
  startDate: '2026-04-01',
  completions: { ...SEED.completions, '2026-05-01': { 'm|new': { done: true, min: 60 } } },
  summaries: {
    '2026-05-18': [
      { id: 's1', sid: 'm', name: '미적분', s1: '극한의 엡실론-델타 정의를 처음 이해했다', s2: '', s3: '' },
    ],
  },
};
test('today · onthisday · dark', async ({ page }) => {
  await boot(page, 'dark', SEED_ONTHISDAY);
  await page.goto('/today');
  await expect(page.locator('#main')).toBeVisible();
  await expect(page.getByText('4주 전 오늘', { exact: false })).toBeVisible(); // 회고 줄 렌더 확인
  await settle(page);
  await expect(page).toHaveScreenshot('today-onthisday-dark.png', { fullPage: true });
});

/* N-5 하루의 국면 — **늦은 시각의 today**.

   기본 스냅샷은 09:00 에 고정돼 있어(FIXED) 마감 국면을 원리적으로 못 담는다. 국면 판정
   자체는 순수 함수로 유닛에서 잠갔지만, 이 저장소가 두 번 물린 부류는 "로직은 맞는데 화면에
   안 붙어 있는" 것이라(§15-4) 실렌더가 따로 필요하다. 늦은 시각엔 남은 가용 창이 0이 되어
   '🌙 하루 닫기'가 서고, 09:00 스냅샷들은 한 장도 안 바뀐다. */
test('today · closing · dark', async ({ page }) => {
  await boot(page, 'dark', SEED, new Date('2026-06-15T23:40:00'));
  await page.goto('/today');
  await expect(page.locator('#main')).toBeVisible();
  await expect(page.getByText('하루 닫기', { exact: false })).toBeVisible();
  await settle(page);
  await expect(page).toHaveScreenshot('today-closing-dark.png', { fullPage: true });
});

// 액센트 노브 — UI설정(lh_ui_v1) accent를 바꾸면 네온이 통째로 교체되는지(--acc 파생 cascade).
test('stats · accent-lime', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); // boot()과 동일 — 캔버스 애니메이션 레이스 봉쇄
  await page.clock.install({ time: FIXED });
  await page.addInitScript(
    ([seed]) => {
      try {
        localStorage.setItem('study_planner_v3', JSON.stringify({ ...(seed as object), theme: 'dark' }));
        localStorage.setItem('lh_ui_v1', JSON.stringify({ schedView: 'week', accent: 'lime', recentCommands: [] }));
      } catch {
        /* noop */
      }
    },
    [SEED] as const,
  );
  await page.goto('/stats');
  await expect(page.locator('#main')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'lime');
  await expect(page.locator('#main h2, #main section[aria-label]').first()).toBeVisible();
  await settle(page);
  await expect(page).toHaveScreenshot('stats-accent-lime.png', { fullPage: true });
});

// 주간 배분 보드(재개편 v2 §12) — 계획의 중심. schedView='alloc' 시드로 배치 세그먼트가 과목×요일 매트릭스를
// 렌더하는지(리드아웃·주 네비 공유·자동 파생 배분 표시). 배분 뷰가 기본이 되는 Phase C 전에 시각 앵커를 잠근다.
for (const theme of THEMES) {
  test(`alloc-board · ${theme}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.clock.install({ time: FIXED });
    await page.addInitScript(
      ([seed, th]) => {
        try {
          localStorage.setItem('study_planner_v3', JSON.stringify({ ...(seed as object), theme: th }));
          localStorage.setItem('lh_ui_v1', JSON.stringify({ schedView: 'week', accent: 'lime', recentCommands: [] }));
        } catch {
          /* noop */
        }
      },
      [SEED, theme] as const,
    );
    await page.goto('/alloc');
    await expect(page.locator('#main')).toBeVisible();
    await expect(page.getByRole('table', { name: '주간 배분 보드' })).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot(`alloc-board-${theme}.png`, { fullPage: true });
  });
}

/* 방치 배지(ID-7 · [[plan-ux-polish-priority]]) — 이번 주 배분됐는데 7일+ 손 안 댄 과목 행에
   '💤 N일' warn 핀. 공유 SEED 는 과목이 작아 현재 주엔 배분이 0(모두 조기 종료)이라 배지가 못 뜬다.
   여기선 절대 안 끝나는 큰 챕터(500h) + 현재 주 명시 배분 + 10일 전 완료로 배지가 실제로 뜨는지
   픽셀로 잡는다(§15-4 · 사용자가 배분 보드 시각 완성도에 특히 민감). FIXED=06-15(월)=현재 주 월요일. */
const SEED_NEGLECT = {
  schemaVersion: 3,
  theme: 'dark',
  startDate: '2026-06-01',
  moduleLen: 120,
  reviewRatio: 20,
  completions: { '2026-06-05': { 'em|new': { done: true, min: 120 } } }, // 10일 전
  items: [
    {
      id: 'em',
      source: '직접',
      name: '전자기학',
      color: '#4f8ff0',
      mode: 'weekly',
      weeklyHours: 4,
      dailyMin: 30,
      deadline: '',
      chapters: [{ id: 'c1', name: '벡터장', hours: 500, done: false }], // 안 끝남 → finished=false
    },
  ],
  routine: [{ id: 'r1', name: '수면', type: '수면', start: '00:00', end: '07:00', days: [0, 1, 2, 3, 4, 5, 6] }],
  weekAlloc: { '2026-06-15': { em: [0, 120, 60, 0, 0, 0, 0] } }, // 현재 주 명시 배분 → rowMin>0(managed)
  cbms: [],
  degree: { targetTotal: 130, reqMajorReq: 60, reqMajorSel: 30, reqLiberal: 30, semesters: [] },
};
test('alloc-board · neglect · dark', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install({ time: FIXED });
  await page.addInitScript((seed) => {
    try {
      localStorage.setItem('study_planner_v3', JSON.stringify(seed as object));
      localStorage.setItem('lh_ui_v1', JSON.stringify({ schedView: 'week', accent: 'lime', recentCommands: [] }));
    } catch {
      /* noop */
    }
  }, SEED_NEGLECT);
  await page.goto('/alloc');
  await expect(page.getByRole('table', { name: '주간 배분 보드' })).toBeVisible();
  await expect(page.getByText(/💤\d+/).first()).toBeVisible(); // 방치 배지 렌더 확인
  await settle(page);
  await expect(page).toHaveScreenshot('alloc-board-neglect-dark.png', { fullPage: true });
});

/* 드롭 가능 프리뷰(UX-A2) — 과목 행을 잡은 동안에만 존재하는 상태라 **정지 스냅샷으로는 원리적으로
   못 잡힌다**(§15-4 가 요구하는 실렌더 확인의 사각지대). 드래그를 합성해 그 순간을 찍는다:
   잡은 행의 7칸에 옅은 프리뷰(1px 점선) + 지금 올라온 칸에 진한 dropOver('+1h')가 함께 보여야 한다.
   ⚠ 스냅샷 밖의 값(가장자리 막대 UX-A1)도 이 화면에 같이 있으므로, 이 장이 팩 전체의 시각 앵커다. */
test('alloc-board · drag-preview · dark', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install({ time: FIXED });
  await page.addInitScript((seed) => {
    try {
      localStorage.setItem('study_planner_v3', JSON.stringify(seed as object));
      localStorage.setItem('lh_ui_v1', JSON.stringify({ schedView: 'week', accent: 'lime', recentCommands: [] }));
    } catch {
      /* noop */
    }
  }, SEED_NEGLECT);
  await page.goto('/alloc');
  await expect(page.getByRole('table', { name: '주간 배분 보드' })).toBeVisible();

  const row = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /전자기학/ }) });
  // ⚠ Playwright 의 실제 마우스 드래그는 HTML5 DnD 를 발화시키지 않는다(브라우저 보안 모델) →
  //    진짜 DataTransfer 핸들을 만들어 이벤트를 합성한다. 핸들러가 setData/dropEffect 를 만지므로
  //    빈 객체로는 안 되고 실 DataTransfer 여야 한다.
  const dt = await page.evaluateHandle(() => new DataTransfer());
  await row.getByRole('rowheader').dispatchEvent('dragstart', { dataTransfer: dt });
  await row.getByRole('cell').nth(3).dispatchEvent('dragover', { dataTransfer: dt }); // 목요일 칸
  await expect(row.getByRole('cell').nth(3)).toHaveClass(/outline-acc/); // 드롭 상태 진입 확인
  await settle(page);
  await expect(page).toHaveScreenshot('alloc-board-drag-dark.png', { fullPage: true });
});

/* 복습 러너(C-7 Tailwind 이식) — **이 화면은 시각 커버리지가 0이었다.** 그 상태에서 이식했더니
   카드가 1글자 폭으로 무너졌는데(토큰 이름이 `--spacing-*` 와 `--container-*` 두 네임스페이스에
   겹쳐 `max-w-runner` 가 48px 으로 풀렸다) **린트·빌드·유닛이 전량 녹색**이었다. 띄워 봐야만
   보이는 부류라 여기에 잠근다.

   ⚠ 시계를 SEED 기준일보다 한참 뒤로 민다 — 그래야 챕터가 "밀린" 상태가 되어 빈 화면이 아니라
   **실제 카드**가 렌더된다(빈 상태만 찍으면 이식의 대부분을 안 재는 것이다). */
for (const theme of THEMES) {
  test(`review-run · ${theme}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.clock.install({ time: new Date('2026-09-01T09:00:00') });
    await page.addInitScript(
      ([seed, th]) => {
        try {
          const s = seed as { cbms?: { conf?: boolean }[] };
          // conf=true 여야 '착각 재확인' 카드가 뜬다(배지 data-kind 변형을 함께 잠근다).
          for (const e of s.cbms ?? []) e.conf = true;
          localStorage.setItem('study_planner_v3', JSON.stringify({ ...(seed as object), theme: th }));
        } catch {
          /* noop */
        }
      },
      [SEED, theme] as const,
    );
    await page.goto('/review-run');
    await expect(page.locator('#main')).toBeVisible();
    await expect(page.getByRole('progressbar')).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot(`review-run-${theme}.png`, { fullPage: true });
  });
}

// 과목 상세 시트(계획 재개편 v3) — 과목 탭의 핵심 신규 UI. 카드를 누르면 탭 프레임보다 작은 중앙 시트가
// 뜨고, 그 안에서 과목 정의 + 이번 주 요일 배분을 함께 정한다(옛 아코디언 대체). 뒤 갤러리가 살아 있는지도 함께 잠근다.
for (const theme of THEMES) {
  test(`subject-sheet · ${theme}`, async ({ page }) => {
    await boot(page, theme);
    await page.goto('/items');
    await expect(page.locator('#main')).toBeVisible();
    await page
      .getByRole('button', { name: /미적분/ })
      .first()
      .click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: '이번 주 요일 배분' })).toBeVisible();
    // 뷰포트 캡처 — fullPage는 position:fixed 오버레이를 스크롤 오프셋만큼 어긋나게 그려(헤더 누락·좌측 잘림)
    // 실제 렌더와 다른 상을 박는다. 시트는 뷰포트에 고정된 물건이라 뷰포트로 잡는 게 정직하다.
    await settle(page);
    await expect(page).toHaveScreenshot(`subject-sheet-${theme}.png`);
  });
}

// 뼈대 스트립 펼침 — 병합으로 흡수한 수업·일과 편집기가 과목 탭 안에서 열리는지(옛 routine 탭의 회귀 자리).
for (const theme of THEMES) {
  test(`skeleton-open · ${theme}`, async ({ page }) => {
    await boot(page, theme);
    await page.goto('/items');
    await expect(page.locator('#main')).toBeVisible();
    await page.getByRole('button', { name: /수업·일과 편집/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('button', { name: '+ 블록 추가' })).toBeVisible();
    // ds.card 진입 애니(cardIn, fill-mode:both)는 첫 프레임 전까지 from 상태(opacity:0)를 유지한다.
    // toBeVisible은 opacity를 보지 않으므로 그냥 찍으면 두 번째 카드가 투명한 상을 박는다 — 불투명해질 때까지 대기.
    await expect(page.getByRole('dialog').locator('h2').nth(1).locator('..')).toHaveCSS('opacity', '1');
    // 시트는 뷰포트 고정물 → 뷰포트 캡처(fullPage는 fixed 오버레이를 어긋나게 그린다).
    await settle(page);
    await expect(page).toHaveScreenshot(`skeleton-open-${theme}.png`);
  });
}

// 캘린더 월/일 뷰(재개편 v4) — 주 뷰는 TABS 루프가 이미 찍는다. 월=일정 칩 격자, 일=타임블로킹 판.
// 뷰는 useUI(lh_ui_v1)가 소유하므로 시드로 고정해 결정론 캡처.
for (const view of ['month', 'day'] as const) {
  test(`calendar-${view} · dark`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.clock.install({ time: FIXED });
    await page.addInitScript(
      ([seed, v]) => {
        try {
          localStorage.setItem('study_planner_v3', JSON.stringify({ ...(seed as object), theme: 'dark' }));
          localStorage.setItem('lh_ui_v1', JSON.stringify({ schedView: v, accent: 'lime', recentCommands: [] }));
        } catch {
          /* noop */
        }
      },
      [SEED, view] as const,
    );
    await page.goto('/schedule');
    await expect(page.locator('#main')).toBeVisible();
    await expect(page.locator('#main section[aria-label]').first()).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot(`calendar-${view}-dark.png`, { fullPage: true });
  });
}

// 진로 지도 상세(딥링크 /atlas/<key>) — 전체폭 상세 라우트가 그리드가 아닌 상세 화면을 그리는지.
for (const theme of THEMES) {
  test(`atlas-detail · ${theme}`, async ({ page }) => {
    await boot(page, theme);
    await page.goto('/atlas/ran');
    await expect(page.locator('#main')).toBeVisible();
    await expect(page.locator('#main h1')).toBeVisible(); // 상세 표제(그리드엔 h1 없음)
    await settle(page);
    await expect(page).toHaveScreenshot(`atlas-detail-${theme}.png`, { fullPage: true });
  });
}

// 반응형(모바일 390px) — 레일이 하단 탭바로, 시그니처 보드가 단일 컬럼으로 스택되는지(가로 넘침 없이).
const MOBILE = { width: 390, height: 844 };
// 모바일 — routine 자리를 items가 잇는다(병합 탭은 900px에서 레일이 갤러리 아래로 접히므로 회귀 가치가 크다).
const TABS_MOBILE = ['today', 'schedule', 'stats', 'items'];
for (const tab of TABS_MOBILE) {
  test(`${tab} · mobile`, async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await boot(page, 'dark');
    await page.goto('/' + tab);
    await expect(page.locator('#main')).toBeVisible();
    await expect(page.locator('#main h2, #main section[aria-label]').first()).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot(`${tab}-mobile.png`, { fullPage: true });
  });
}

/* ── 폰 웹앱(C-6) — **브라우저 렌더 커버리지가 0 이던 화면** ─────────────────────────
   `PhoneApp` 은 클라우드 등록을 마쳐야 렌더된다(미연결이면 `Connect`). 그래서 `phone.spec.ts`
   는 등록 화면까지밖에 못 봤고, 폰 5화면은 지금껏 진짜 브라우저에서 **한 번도 안 찍혔다** —
   정적 검사·유닛만으로 폰 레이아웃을 바꾸는 것이 §15-4 가 금지하는 바로 그 상태였다.

   등록은 서버가 코드를 발급하므로 **네트워크가 유일한 관문**이다. 그 응답만 가로채면 앱이
   자기 경로로 SQLite 에 설정을 쓰고 그대로 뜬다 — 프로덕션 표면을 하나도 안 늘린다.

   ⚠ `clock.install` 이 아니라 `setFixedTime` 이다. install 은 타이머를 통째로 가짜로 만드는데
     폰 부팅은 wasm·워커·OPFS 라 그 위에서 멈출 수 있다. 여기 필요한 건 '오늘'의 고정뿐이다.
   ⚠ `fullPage: false` 다 — 이 장의 요지가 **하단 탭바가 뷰포트 바닥에 붙는가**인데
     fullPage 는 sticky 를 흐름상 위치로 펴서 그 질문을 지운다. */
async function bootPhone(page: Page): Promise<void> {
  await page.setViewportSize(MOBILE);
  await page.clock.setFixedTime(FIXED);
  // ⚠ 등록 라우트를 **나중에** 건다 — Playwright 는 나중에 등록한 핸들러가 이긴다.
  await page.route('**/api/**', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await page.route('**/api/enroll/claim', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ deviceId: 'e2e-device', refreshToken: 'e2e-refresh' }),
    }),
  );
  await page.goto('/phone.html');
  await page.getByLabel('등록 코드').fill('E2E-CODE');
  await page.getByRole('button', { name: '연결' }).click();
  await expect(page.getByRole('group', { name: '화면 전환' })).toBeVisible();
}

test('phone · shell · dark', async ({ page }) => {
  await bootPhone(page);
  await settle(page);
  await expect(page).toHaveScreenshot('phone-shell-dark.png');
});

test('phone · 하단 탭바로 화면을 바꾼다(UX-B1)', async ({ page }) => {
  await bootPhone(page);
  const tabs = page.getByRole('group', { name: '화면 전환' });
  // 탭바가 **본문 뒤**에 온다 = 문서 순서상 마지막(엄지 지대). 위치만 옮기고 계약은 그대로.
  await expect(tabs.getByRole('button', { name: '홈' })).toHaveAttribute('aria-pressed', 'true');
  await tabs.getByRole('button', { name: '주' }).click();
  await expect(tabs.getByRole('button', { name: '주' })).toHaveAttribute('aria-pressed', 'true');
  await expect(tabs.getByRole('button', { name: '홈' })).toHaveAttribute('aria-pressed', 'false');
  // 탭바는 뷰포트 바닥에 붙어 있다(sticky 가 실제로 먹는지 — jsdom 이 원리적으로 못 보는 축).
  const box = (await tabs.boundingBox())!;
  const vh = page.viewportSize()!.height;
  expect(box.y + box.height).toBeGreaterThan(vh - 4);
});

test('phone · 본문 좌우 스와이프가 날짜를 옮긴다(UX-B3)', async ({ page }) => {
  await bootPhone(page);
  await page.getByRole('group', { name: '화면 전환' }).getByRole('button', { name: '일' }).click();
  const heading = page.locator('main h2').first();
  const before = await heading.textContent();
  // 손가락 궤적을 합성한다 — 실 마우스는 pointerType='mouse' 라 훅이 의도적으로 무시한다.
  const pt = (x: number) => ({ pointerId: 1, pointerType: 'touch', clientX: x, clientY: 400 });
  await page.dispatchEvent('main', 'pointerdown', pt(300));
  await page.dispatchEvent('main', 'pointermove', pt(270));
  await page.dispatchEvent('main', 'pointerup', pt(200));
  await expect(heading).not.toHaveText(before ?? '');
});

/* ============================================================
   산출물 단계 — **로딩·에러**(E17 · 2026-07-30)

   `classifyArtifact` 는 4단계를 내는데 스냅샷은 `ready`·`empty` 두 개만 찍고 있었다. 그래서
   E17 이 로딩·에러 표면을 `components/State` 로 통째로 갈아치웠는데도 **122장이 전량 통과**했다 —
   "안 바뀌었다"가 아니라 **"본 적이 없다"** 였다. 근거·구현은 `_fixtures.ts` 의
   `bootArtifactPhase` 머리주석.

   ⚠ 두 탭만 찍는다(ledger·mastery). 넷 다 찍으면 베이스라인이 8장 늘어나는데, 이 둘이 **옛
   손코딩 블록을 글자까지 같게 복제하고 있던 쌍**이라 수렴의 증거로 충분하다(markets·reads 는
   같은 `State` 를 같은 문구 함수로 부른다 → 새 정보가 없다).
   ⚠ 라이트도 찍는다 — `State` 의 글리프가 `bg-acc-soft` + inset 링이라 **라이트에서 대비가
   갈리는** 자리다(E4 가 헤어라인에서 물린 것과 같은 부류).
============================================================ */
for (const theme of THEMES) {
  test(`ledger · error · ${theme}`, async ({ page }) => {
    await bootArtifactPhase(page, theme, 'ledger', 'error');
    await page.goto('/ledger');
    await expect(page.getByRole('alert').or(page.getByText('챕터 원장을 불러오지 못했어요'))).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot(`ledger-error-${theme}.png`);
  });
}

test('mastery · loading · dark', async ({ page }) => {
  await bootArtifactPhase(page, 'dark', 'knowledge', 'loading');
  await page.goto('/mastery');
  // 로딩은 스스로 알린다(role=status) — 이 단언이 곧 E17 의 계약이다.
  await expect(page.getByRole('status').filter({ hasText: '지식상태를 불러오는 중' })).toBeVisible();
  await settle(page);
  await expect(page).toHaveScreenshot('mastery-loading-dark.png');
});
