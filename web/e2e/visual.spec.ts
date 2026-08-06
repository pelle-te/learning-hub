import { test, expect, type Page } from '@playwright/test';

/* 비주얼 회귀 — 앱상태 탭들을 다크(기본)/라이트 2테마로 스크린샷(에디토리얼 다크 리디자인·세피아 폐기).
   결정성: ① 고정 시드(localStorage) ② 고정 시각(page.clock) — '오늘'·D-day·스트릭이 날짜에 안 흔들리게.
   첫 실행은 `npm run e2e:update`로 베이스라인 생성, 이후 `npm run e2e`로 회귀 비교.

   ⚠ 시드·fixture·부팅 헬퍼는 **`_fixtures.ts` 로 갈라졌다**(2026-07-25) — `a11y.spec.ts` 가
   같은 상태를 봐야 하기 때문. 근거는 그 파일 머리주석. */
import {
  FIXED,
  MOBILE,
  SEED,
  SEED_EMPTY,
  TABS,
  TABS_EMPTY,
  THEMES,
  boot,
  bootArtifactPhase,
  bootPhone,
  settle,
} from './_fixtures';

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
      await settle(page);
      await expect(page).toHaveScreenshot(`${tab}-${theme}.png`, { fullPage: true });
    });
  }
}

/* ── 과목 › 구조도 뷰 — **탭이 아니라 뷰가 됐다**(P-19 · 2026-08-01) ────────────────────
   종전엔 `graph` 가 탭 로스터의 한 원소라 위 루프가 알아서 찍었다. 지금은 `/items` 의 쿼리
   변형이므로 로스터로는 못 닿는다 — §15-4 가 요구하는 "커버리지 0 인 화면을 만들지 않는다"를
   지키려면 여기 개별 케이스가 필요하다(안 만들면 뷰 전환이 통째로 시각 게이트 밖이 된다).

   ⚠ `<canvas>` 힘-방향 뷰지만 초기 좌표가 id 해시 시드라 **결정론적**이고(`graphData.ts`:
     "Math.random 금지 · 스냅샷/테스트 안정") reduced-motion 에선 동기 1회 렌더다.
   ⚠ 범례의 '의미 연결' 칩은 `semStatus` 가 settle 한 뒤에야 붙는다: 트랙 A 에선 임베딩 커맨드가
     reject 되어 반드시 'unavailable'(= Ollama 필요) 로 끝나는데, 그 전에 찍으면 칩이 통째로
     빠진 상을 박는다(실측: 같은 실행에서 dark 는 50노드, light 는 48노드). **존재 단정**으로
     전이 완료를 보장한다 — 카피가 바뀌면 조용히 통과하지 않고 timeout 으로 시끄럽게 깨진다. */
for (const theme of THEMES) {
  test(`items-structure · ${theme}`, async ({ page }) => {
    await boot(page, theme);
    await page.goto('/items?view=structure');
    await expect(page.locator('#main')).toBeVisible();
    await expect(page.getByText('의미 연결 — Ollama 필요')).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot(`items-structure-${theme}.png`, { fullPage: true });
  });
}

/* ── 컷 카드(P-9) — **초과하는 날에만 존재한다** ─────────────────────────────────────
   공유 `SEED` 는 두 과목이 마감 안에 끝나므로 이 카드가 안 뜬다. 그건 제품이 옳은 것이지만,
   그대로 두면 **이 발산의 본체가 시각 게이트 밖**에 남는다(§15-4 가 금지한 "커버리지 0인 화면").
   그래서 시드를 여기서만 초과로 비튼다: 미적분에 큰 챕터 셋을 더하고 마감을 D-8 로 당긴다.

   ⚠ 시드를 바꾸는 것이 아니라 **파생한다** — 공유 SEED 를 건드리면 전 탭 베이스라인이 흔들린다. */
const SEED_OVER = {
  ...SEED,
  items: [
    {
      ...SEED.items[0]!,
      // 주 3h · 마감 D-8 · 남은 22h → 들어가는 것은 12h(부족 10h · 후보 4 · 기본 선택 2).
      // ⚠ 이 수는 **엔진으로 직접 재서** 골랐다 — 눈대중으로 고르면 카드가 안 떠서
      //   `toHaveScreenshot` 이 빈 화면을 정답으로 굳힌다(그래서 위 존재 단정이 함께 있다).
      weeklyHours: 3,
      deadline: '2026-06-23',
      chapters: [
        { id: 'c1', name: '극한', hours: 3, done: true },
        { id: 'c2', name: '미분', hours: 4, done: false },
        { id: 'c4', name: '적분', hours: 6, done: false },
        { id: 'c5', name: '급수', hours: 5, done: false },
        { id: 'c6', name: '미분방정식', hours: 7, done: false },
      ],
    },
    SEED.items[1]!,
  ],
};

for (const theme of THEMES) {
  test(`schedule-cut · ${theme}`, async ({ page }) => {
    await boot(page, theme, SEED_OVER);
    await page.goto('/schedule');
    await expect(page.locator('#main')).toBeVisible();
    // 존재 단정 — 카드가 안 뜨면 timeout 으로 시끄럽게 깨진다(빈 화면을 조용히 굳히지 않는다).
    await expect(page.getByRole('region', { name: '미적분 범위 조정' })).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot(`schedule-cut-${theme}.png`, { fullPage: true });
  });
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
   회색 토큰·컬럼 붕괴를 이 화면만이 드러낸다. 공유 SEED 를 안 건드려 다른 베이스라인은 불변. */
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
  await expect(page.getByLabel(/일째 손 안 댐/).first()).toBeVisible(); // 방치 배지 렌더 확인(글리프→아이콘 이후 라벨로)
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

/* ⚠⚠ **과목 상세는 시트가 아니라 페이지다(W12 · 2026-07-31).** 옛 이름은 `subject-sheet` 였고
   중앙 오버레이(`role=dialog`)를 찍었다 — 카드를 누르면 탭 프레임보다 작은 시트가 떴다.
   객체 축(`/subject/:id`)이 서면서 오버레이가 걷히고 **과목이 자기 URL 을 갖는다**: 3열
   [정의·챕터 | 앎(원장·숙달) | 인출·오답]. 이 케이스가 잠그는 것도 바뀌었다 — 시트가 떴는가가
   아니라 **세 컬럼이 한 화면에 함께 있는가**(그게 "7클릭·6화면"을 없앤 근거다). */
for (const theme of THEMES) {
  test(`subject · ${theme}`, async ({ page }) => {
    await boot(page, theme);
    await page.goto('/items');
    await expect(page.locator('#main')).toBeVisible();
    await page
      .getByRole('button', { name: /미적분/ })
      .first()
      .click();
    await expect(page.getByRole('heading', { name: '이번 주 요일 배분' })).toBeVisible();
    // 앎·인출 컬럼이 함께 있는지 — 한 화면에 모였다는 것이 이 라우트의 존재 이유다.
    await expect(page.getByRole('heading', { name: /원장/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /복습 위험/ })).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot(`subject-${theme}.png`, { fullPage: true });
  });
}

/* T-18 시험 전날 한 장 — 같은 과목의 **두 번째 뷰**. 잠그는 것은 둘이다:
   ① 기본 선택이 **시험 범위**로 미리 채워져 있는가(빈 목록으로 시작하면 화면이 일을 안 한 것이다)
   ② **왼쪽은 살아 있고 오른쪽만** 유보 상태인가(전면 게이트로 덮으면 이 표면이 시각 회귀망에서
      통째로 사라진다 — 그 판단을 픽셀로 못박는다).
   ⚠ 트랙 A 는 `invoke` 스텁을 깔아서 `isTauri()` 가 **참**이다 — 그래서 여기 서는 것은 셸 전용
      문구가 아니라 "아직 안 만들었다"는 유보다(브라우저 전용 문구는 dev 에서만 보인다). */
for (const theme of THEMES) {
  test(`subject-sheet · ${theme}`, async ({ page }) => {
    await boot(page, theme);
    await page.goto('/subject/m?view=sheet');
    await expect(page.getByRole('heading', { name: /챕터 고르기/ })).toBeVisible();
    // 시험 범위(= 미적분의 전 챕터)가 미리 체크돼 있다.
    await expect(page.getByRole('checkbox', { name: '극한' })).toBeChecked();
    await expect(page.getByText('고른 챕터로 한 장을 만들어요')).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot(`subject-sheet-${theme}.png`, { fullPage: true });
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

/* ⚠⚠ **W9 흡수 뷰 셋**(2026-08-06) — `goals`·`atlas`·`guide` 가 탭에서 호스트의 뷰로 내려갔다.
   `TABS` 루프에서 빠졌으므로 여기가 그 화면들의 **유일한 시각 커버리지**다. 잠그는 것은 둘:
   ① 그 뷰가 실제로 그려지는가(리다이렉트만 되고 호스트 기본 뷰가 뜨면 조용한 도달성 손실이다)
   ② 세그먼트 바에 **자기 칸이 눌린 상태로** 서는가(눌린 칸이 없으면 사용자는 어디 있는지 모른다). */
const MERGED_VIEWS: { key: string; path: string; ready: string }[] = [
  { key: 'degree-path', path: '/degree?view=path', ready: '내 길' },
  { key: 'discovery-atlas', path: '/discovery?view=atlas', ready: '진로 지도' },
  { key: 'find-guide', path: '/find?view=guide', ready: '이 시스템이 할 수 있는 것' },
];
for (const theme of THEMES) {
  for (const v of MERGED_VIEWS) {
    test(`${v.key} · ${theme}`, async ({ page }) => {
      await boot(page, theme);
      await page.goto(v.path);
      await expect(page.locator('#main')).toBeVisible();
      await expect(page.getByText(v.ready).first()).toBeVisible();
      await settle(page);
      await expect(page).toHaveScreenshot(`${v.key}-${theme}.png`, { fullPage: true });
    });
  }
}

/* 진로 지도 상세 — **옛 딥링크 `/atlas/<key>` 로 들어간다.** W9 이후 그 경로는 리다이렉트라,
   이 케이스는 상세 렌더뿐 아니라 **북마크가 살아 있는가**까지 함께 잠근다(경로 조각 → 쿼리 이관). */
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

   ⚠ **부팅 절차는 `_fixtures.ts` 의 `bootPhone` 이 소유한다**(H6 · 2026-07-30 에 여기서 승격).
     `a11y.spec.ts` 도 같은 화면을 봐야 하는데 사본을 만들면 두 로스터가 갈린다 — `A11Y_EXTRA`
     주석이 이미 "목록이 갈리면 조용히 사각이 생긴다"고 적어 둔 그 실패다.
   ⚠ `fullPage: false` 다 — 이 장의 요지가 **하단 탭바가 뷰포트 바닥에 붙는가**인데
     fullPage 는 sticky 를 흐름상 위치로 펴서 그 질문을 지운다. */

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
   E17 이 로딩·에러 표면을 `components/State` 로 통째로 갈아치웠는데도 **전량 통과**했다 —
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
    /* ⚠ **locator 를 좁혔다(2026-08-01).** 옛 형태 `getByRole('alert').or(getByText(제목))` 은
       **네 개**에 매칭된다(State 의 sr-only 공지 · State 본체 · 그 안의 제목 div · 라우트
       아나운서의 빈 라이브리전). 그런데도 통과하고 있었던 것은 **타이밍 우연**이었다: 탭이
       Suspense 스켈레톤에 260ms 묶여 있는 동안 아나운서가 비워질 시간이 있었다. 부팅 대기를
       없애자(`registry.warmTab`) 그 우연이 사라지며 strict mode 위반으로 드러났다 —
       즉 이 단언은 **원래부터 자기가 무엇을 보는지 몰랐다.**
       → 뜻을 그대로 적는다: *"에러 상태 블록이 자기 행동(`next`)과 함께 떠 있다"*. `State` 는
       `next` 를 필수로 요구하므로(E17) 이 조합은 정의상 유일하다. */
    await expect(page.getByRole('alert').filter({ hasText: '다시 시도' })).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot(`ledger-error-${theme}.png`);
  });
}

/* ⚠⚠ **로딩을 회귀망에 넣는다(W15 · 2026-07-31).** 종전엔 `mastery · loading · dark` **한 장**
   뿐이었다 — 빈 상태가 12장인데 로딩은 사실상 앱의 한 상태 전체가 시각 게이트 밖이었고,
   그래서 `State kind='loading'` 을 중앙 스피너에서 **골격 프레임**으로 바꾸는 것 같은 변화가
   "안 바뀌었다"가 아니라 "본 적이 없다"로 통과한다(E17 이 이미 한 번 물린 형태).
   두 탭 × 두 테마 = 4장. `State` 의 골격은 `bg-panel2` 라 **라이트에서 대비가 갈리는** 자리다. */
/* ⚠ 두 형상을 **둘 다** 찍는다(W15 완결 · 2026-07-31):
   · `frame`(기본) — 페이지 격자를 미리 그린다. ledger·mastery 처럼 착지 레이아웃이 확정된 화면.
   · `indeterminate` — 끝을 모르는 대기. discovery·goals 처럼 **행 수가 데이터에 따라 변하는** 화면
     (거기 골격을 그리면 그건 로딩이 아니라 오답이다 — 불변식이 `SkeletonText` 를 금지하는 이유).
   markets·reads 는 화면이 형상을 확정하는 **고유 골격**이라 셋째 부류다 — 그것도 함께 잠근다.
   합 12장(2형상 × 화면 6 × … 이 아니라 화면 6 × 2테마)이고, 종전엔 **1장**이었다. */
const LOADING_SCREENS: { key: string; artifact: string; path: string }[] = [
  { key: 'ledger', artifact: 'ledger', path: '/ledger' },
  { key: 'mastery', artifact: 'knowledge', path: '/mastery' },
  { key: 'discovery', artifact: 'discovery', path: '/discovery' },
  // W9 — `goals` 는 이제 `degree` 의 뷰다. 경로를 안 고치면 리다이렉트 뒤 **다른 화면의 로딩**을 찍는다.
  { key: 'goals', artifact: 'goals', path: '/degree?view=path' },
  { key: 'markets', artifact: 'markets', path: '/markets' },
  { key: 'reads', artifact: 'reads', path: '/reads' },
];
for (const theme of THEMES) {
  for (const sc of LOADING_SCREENS) {
    test(`${sc.key} · loading · ${theme}`, async ({ page }) => {
      await bootArtifactPhase(page, theme, sc.artifact, 'loading');
      await page.goto(sc.path);
      // 로딩은 스스로 알린다(role=status) — 이 단언이 곧 E17 의 계약이다(형상이 무엇이든 유지된다).
      await expect(page.getByRole('status').first()).toBeAttached();
      await settle(page);
      await expect(page).toHaveScreenshot(`${sc.key}-loading-${theme}.png`);
    });
  }
}

/* ============================================================
   압력(press) — **누르고 있는 프레임**(E15 · 2026-07-30)

   ## 왜 필요한가

   `:active` 는 **정지 프레임 게이트가 원리적으로 못 보는 상태**다 — 스냅샷은 아무것도 누르지 않은
   화면을 찍으므로, 압력 레지스터(`global/components.css` 의 `button:active`)를 지우거나 망가뜨려도
   125장이 전량 통과한다. E24 가 모션에서 겪은 것과 **같은 종류의 사각**이고, E15 가 hover 예산을
   press·commit 으로 옮기려면 **옮긴 쪽을 볼 수 있어야** 한다(안 보이는 곳으로 옮기는 것은 이동이
   아니라 삭제다).

   ⚠ 모션 애니가 아니라 **CSS 상태**라 `motion.spec.ts` 의 얼리기 하네스가 필요 없다 —
   `mouse.down()` 으로 붙잡아 두면 그대로 정지 상태다(결정적).
   ⚠ 클립을 버튼에 맞춘다 — E24 가 배운 규칙("어휘를 관측하려면 그 어휘가 프레임 면적을
   지배해야 한다")을 그대로 적용한다. 전체 화면을 찍으면 2px 변위가 비율 아래로 사라진다.

   ⚠⚠ **`reducedMotion: 'no-preference'` 가 이 케이스의 생사다 — 첫 판이 그걸로 실패했다.**
   `boot` 은 `reducedMotion: 'reduce'` 로 부팅하고(스냅샷 125장의 전제), 그 모드에서
   `global/components.css` 는 압력의 `transform` 을 **명시적으로 끈다**(`transform: none`).
   즉 기본 부팅으로 찍으면 이 스냅샷은 압력의 변위를 **원리적으로 볼 수 없다** — 실제로 반증에서
   `scale(0.98) translateY(1px)` 을 지웠는데 **통과했다**(126장 전량 녹색).
   → 모션을 켜고 찍는다. **이 반증이 남긴 사실 하나**: 모션 자제 사용자의 압력 피드백은
     `box-shadow: none` 하나뿐이다(변위 없음). 그건 의도된 판단이지만(그 파일 주석), 그래서
     **이 케이스가 지키는 것은 "모션 켠 사용자의 압력"** 이라는 점을 분명히 해 둔다.
============================================================ */
test('press · 버튼을 누르고 있는 프레임(정지 게이트가 못 보는 상태)', async ({ page }) => {
  await boot(page, 'dark');
  // ⚠ `boot` 뒤에 되돌린다(순서가 계약 — `motion.spec.ts` 의 `bootFrozen` 과 같은 이유).
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/today');
  // 히어로의 주 액션 — 이 앱에서 가장 많이 눌리는 버튼이고 `.primary` 변형을 함께 덮는다.
  const btn = page
    .locator('#main button')
    .filter({ hasText: /집중|시작/ })
    .first();
  await expect(btn).toBeVisible();
  await settle(page);
  const b = (await btn.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  try {
    const pad = 10;
    await expect(page).toHaveScreenshot('press-cta-dark.png', {
      clip: { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 },
      // ⚠ 감도를 조인다 — 압력은 `scale(0.98) translateY(1px)` + 그림자 회수라 변화량이 작다.
      threshold: 0.05,
      maxDiffPixelRatio: 0.002,
    });
  } finally {
    // ⚠ 반드시 뗀다 — 누른 채로 끝나면 이 페이지를 쓰는 다음 단언이 클릭을 삼킨다.
    await page.mouse.up();
  }
});

/* ============================================================
   치트시트(`?`) — **E16·E19 가 투자한 화면인데 스냅샷이 0장이었다**(E20 에서 발견 · 2026-07-30)

   E16 이 키바를 오버레이로 만들고 E19 가 "키를 거는 화면은 그 키를 설명한다"를 불변식으로
   잠갔는데, **그 결과물이 어떻게 보이는지**는 어떤 스냅샷도 찍지 않았다. 즉 목록의 *내용*은
   기계가 지키고 *렌더*는 아무도 안 봤다 — 줄이 넘치든 겹치든 통과한다.
   E20 이 전역 단축키 한 줄을 등재하며 그 공백을 만났으므로 여기서 닫는다.

   ⚠ 다크만 찍는다. 이 오버레이는 색 토큰만 쓰고 레이아웃이 테마와 무관하다 — 라이트를 더하면
   베이스라인 1장이 늘고 새 정보는 0이다(같은 판단을 `ledger · error` 에서는 반대로 했는데,
   거기는 `State` 의 글리프가 **라이트에서 대비가 갈리는** 자리라 근거가 달랐다).
============================================================ */
test('shortcuts-help · dark', async ({ page }) => {
  await boot(page, 'dark');
  await page.goto('/today');
  await settle(page);
  await page.keyboard.press('?');
  // 열렸다는 것을 단언한 뒤 찍는다 — 안 열린 화면을 정답으로 굽지 않게(§15-4).
  await expect(page.getByRole('dialog').or(page.locator('[aria-label*="단축키"]')).first()).toBeVisible();
  await settle(page);
  await expect(page).toHaveScreenshot('shortcuts-help-dark.png');
});
