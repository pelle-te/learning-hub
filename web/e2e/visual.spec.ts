import { test, expect, type Page } from '@playwright/test';

/* 비주얼 회귀 — 앱상태 탭들을 다크(기본)/라이트 2테마로 스크린샷(에디토리얼 다크 리디자인·세피아 폐기).
   결정성: ① 고정 시드(localStorage) ② 고정 시각(page.clock) — '오늘'·D-day·스트릭이 날짜에 안 흔들리게.
   첫 실행은 `npm run e2e:update`로 베이스라인 생성, 이후 `npm run e2e`로 회귀 비교. */

const FIXED = new Date('2026-06-15T09:00:00');

// validShape 충족 최소 시드(나머지 필드는 migrate가 채움). 차트가 보이게 챕터·완료·마감 포함.
const SEED = {
  schemaVersion: 3,
  theme: 'light',
  startDate: '2026-06-01',
  moduleLen: 120,
  reviewRatio: 20,
  completions: {
    '2026-06-13': { 'm|new': { done: true, min: 120 } },
    '2026-06-14': { 'm|new': { done: true, min: 90 } },
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
        { id: 'c1', name: '극한', hours: 3, done: true },
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
  routine: [
    { id: 'r1', name: '수면', type: '수면', start: '00:00', end: '07:00', days: [0, 1, 2, 3, 4, 5, 6] },
    { id: 'r2', name: '수업', type: '수업', start: '09:00', end: '12:00', days: [1, 3] },
  ],
  cbms: [
    {
      id: 'e1',
      ds: '2026-06-13',
      sid: 'm',
      name: '미적분',
      chapter: '극한',
      code: 'C',
      note: '정의 혼동',
      conf: false,
    },
  ],
  degree: {
    targetTotal: 130,
    reqMajorReq: 60,
    reqMajorSel: 30,
    reqLiberal: 30,
    semesters: [
      {
        id: 's1',
        name: '2026-1학기',
        courses: [
          { id: 'co1', name: '미적분학', credits: 3, category: '전공필수', status: '완료', grade: 'A+' },
          { id: 'co2', name: '일반물리', credits: 3, category: '전공필수', status: '수강중', grade: '' },
        ],
      },
    ],
  },
};

const TABS = [
  'today',
  'schedule',
  'items',
  'journal',
  'degree',
  'stats',
  'routine',
  'settings',
  'mastery',
  'control',
  'integrations',
  'review',
];
const THEMES = ['dark', 'light'] as const;

async function boot(page: Page, theme: string, seed: object = SEED) {
  await page.clock.install({ time: FIXED });
  await page.addInitScript(
    ([s, th]) => {
      try {
        localStorage.setItem('study_planner_v3', JSON.stringify({ ...(s as object), theme: th }));
      } catch {
        /* noop */
      }
    },
    [seed, theme] as const,
  );
}

// 신규 사용자(학습 항목·기록 없음) — 빈 상태 1급 설계 검증. 기본 일과(수면·식사)만 가진 새 볼트.
const SEED_EMPTY = {
  schemaVersion: 3,
  theme: 'light',
  startDate: '2026-06-01',
  moduleLen: 120,
  reviewRatio: 20,
  completions: {},
  items: [],
  routine: [
    { id: 'r1', name: '수면', type: '수면', start: '00:00', end: '07:00', days: [0, 1, 2, 3, 4, 5, 6] },
    { id: 'r2', name: '점심', type: '식사', start: '12:00', end: '13:00', days: [0, 1, 2, 3, 4, 5, 6] },
  ],
  cbms: [],
  degree: { targetTotal: 130, reqMajorReq: 60, reqMajorSel: 30, reqLiberal: 30, semesters: [] },
};
const TABS_EMPTY = ['today', 'schedule', 'items', 'degree', 'journal'];

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
      await expect(page).toHaveScreenshot(`${tab}-empty-${theme}.png`, { fullPage: true });
    });
  }
}

// 반응형(모바일 390px) — 레일이 하단 탭바로, 시그니처 보드가 단일 컬럼으로 스택되는지(가로 넘침 없이).
const MOBILE = { width: 390, height: 844 };
const TABS_MOBILE = ['today', 'schedule', 'stats', 'routine'];
for (const tab of TABS_MOBILE) {
  test(`${tab} · mobile`, async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await boot(page, 'dark');
    await page.goto('/' + tab);
    await expect(page.locator('#main')).toBeVisible();
    await expect(page.locator('#main h2, #main section[aria-label]').first()).toBeVisible();
    await expect(page).toHaveScreenshot(`${tab}-mobile.png`, { fullPage: true });
  });
}
