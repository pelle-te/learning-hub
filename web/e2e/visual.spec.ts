import { test, expect, type Page } from '@playwright/test';

/* 비주얼 회귀 — 앱상태 탭들을 다크(기본)/라이트 2테마로 스크린샷(에디토리얼 다크 리디자인·세피아 폐기).
   결정성: ① 고정 시드(localStorage) ② 고정 시각(page.clock) — '오늘'·D-day·스트릭이 날짜에 안 흔들리게.
   첫 실행은 `npm run e2e:update`로 베이스라인 생성, 이후 `npm run e2e`로 회귀 비교. */

const FIXED = new Date('2026-06-15T09:00:00');

/* P8 E-3 — reads/markets 결정론화: 두 탭은 변동 수집데이터(_읽을거리/latest·_증시/latest)에 그려져
   매 수집마다 스냅샷이 RED였다(vite preview는 /api 프록시 없음 · 로컬 serve.js면 실데이터 유입).
   고정 fixture 를 page.route 로 mock 해 수집 상태·serve.js 유무와 무관하게 '데이터 상태'를 안정 캡처.
   date=오늘(고정시계)로 두어 useAutoCollect 재수집을 막고, published는 TZ 없는 로컬시각(고정시계 기준
   상대표기 결정론). */
// 내 길(goals) — 손저작 goals.json 을 고정 fixture 로(P9 Phase 6 · 실 계약과 동형 · 결정론 캡처).
const GOALS_FIXTURE = {
  _schemaVersion: 1,
  nodes: [
    {
      id: 'research-independence',
      kind: 'goal',
      title: '전파통신 분야 연구원으로 자립',
      weight: 1.0,
      active: true,
      parent: null,
    },
    {
      id: 'communication-theory',
      kind: 'goal',
      title: '통신이론',
      weight: 1.0,
      active: true,
      parent: 'research-independence',
    },
    {
      id: 'signal-processing',
      kind: 'goal',
      title: '신호처리',
      weight: 0.95,
      active: true,
      parent: 'research-independence',
    },
    {
      id: 'research-skills',
      kind: 'goal',
      title: '논문·실험 역량',
      weight: 0.9,
      active: true,
      parent: 'research-independence',
    },
    { id: 'rf-circuits', kind: 'goal', title: 'RF회로', weight: 0.85, active: true, parent: 'research-independence' },
    { id: 'antennas', kind: 'goal', title: '안테나', weight: 0.8, active: true, parent: 'research-independence' },
    {
      id: 'degree-requirement',
      kind: 'goal',
      title: '전자공학 학위요건 충족',
      weight: 0.5,
      active: true,
      parent: 'research-independence',
      degree_req: { targetTotal: 128, reqMajorReq: 41, reqMajorSel: 27, reqLiberal: 51 },
    },
  ],
};

/* 지식상태(knowledge) — 숙달도 지도·주간리뷰가 소비. 로컬 serve.js 가 켜진 채 기록하면 라이브 볼트
   데이터(노트 수·생성일)가 스냅샷에 새어들어 다음 환경에서 RED(mastery 회귀의 실제 원인이었음).
   reads/markets 와 동일하게 고정 fixture 로 봉인 — 데이터 있는 상태를 결정론 캡처. */
const KNOWLEDGE_FIXTURE = {
  _schemaVersion: 1,
  generated: '2026-06-15T08:00:00',
  n_notes: 42,
  overall: 0.55,
  states: { mastered: 12, learning: 18, weak: 6, unknown: 6 },
  subjects: [
    {
      subject: '기초 수학',
      mastery: 0.62,
      n: 18,
      weak: 2,
      unknown: 2,
      concepts: [
        { title: '극한과 연속', basename: '극한과 연속', p_eff: 0.9, state: 'mastered' },
        { title: '도함수의 응용', basename: '도함수의 응용', p_eff: 0.7, state: 'learning', frontier: true },
        { title: '적분 기법', basename: '적분 기법', p_eff: 0.35, state: 'weak', weak: true, root_cause: '부분적분' },
        { title: '급수 수렴판정', basename: '급수 수렴판정', p_eff: 0.1, state: 'unknown' },
      ],
    },
    {
      subject: '선형대수',
      mastery: 0.48,
      n: 14,
      weak: 3,
      unknown: 2,
      concepts: [
        { title: '가우스 소거', basename: '가우스 소거', p_eff: 0.85, state: 'mastered' },
        { title: '벡터공간', basename: '벡터공간', p_eff: 0.55, state: 'learning' },
        {
          title: '고유값 분해',
          basename: '고유값 분해',
          p_eff: 0.3,
          state: 'weak',
          weak: true,
          root_cause: '벡터공간',
        },
      ],
    },
  ],
  frontier: [
    { basename: '도함수의 응용', title: '도함수의 응용', subject: '기초 수학', p_eff: 0.7, prereq_in: 4 },
    { basename: '벡터공간', title: '벡터공간', subject: '선형대수', p_eff: 0.55, prereq_in: 3 },
  ],
  gaps: [
    { title: '적분 기법', basename: '적분 기법', subject: '기초 수학', p_eff: 0.35, root_cause: '부분적분' },
    { title: '고유값 분해', basename: '고유값 분해', subject: '선형대수', p_eff: 0.3, root_cause: '벡터공간' },
  ],
  calibration: {
    n_errors: 9,
    confident_wrong: 2,
    overconfidence_rate: 0.22,
    blank_total: 10,
    blank_pass: 7,
    blank_pass_rate: 0.7,
  },
};

const MARKETS_FIXTURE = {
  at: '2026-06-15T08:30:00',
  date: '2026-06-15',
  indices: [
    {
      symbol: 'KOSPI',
      name: '코스피',
      region: '국내',
      currency: 'KRW',
      price: 2712.34,
      prevClose: 2698.1,
      change: 14.24,
      changePct: 0.53,
      spark: [2680, 2690, 2685, 2700, 2695, 2712],
    },
    {
      symbol: 'KOSDAQ',
      name: '코스닥',
      region: '국내',
      currency: 'KRW',
      price: 861.2,
      prevClose: 867.55,
      change: -6.35,
      changePct: -0.73,
      spark: [872, 869, 865, 868, 863, 861],
    },
    {
      symbol: 'SPX',
      name: 'S&P 500',
      region: '미국',
      currency: 'USD',
      price: 5431.6,
      prevClose: 5405.0,
      change: 26.6,
      changePct: 0.49,
      spark: [5390, 5400, 5395, 5410, 5420, 5431],
    },
    {
      symbol: 'IXIC',
      name: '나스닥',
      region: '미국',
      currency: 'USD',
      price: 17689.36,
      prevClose: 17650.2,
      change: 39.16,
      changePct: 0.22,
      spark: [17600, 17620, 17640, 17610, 17670, 17689],
    },
  ],
  news: [
    {
      id: 'n1',
      source: '한국경제',
      field: '증시',
      title: '반도체株 강세에 코스피 상승 마감',
      url: 'https://example.com/n1',
      published: '2026-06-15T06:00:00',
      summary: '외국인 순매수가 이어지며 지수가 0.5% 올랐다.',
    },
    {
      id: 'n2',
      source: 'Reuters',
      field: '글로벌',
      title: 'Fed officials signal patience on rate cuts',
      url: 'https://example.com/n2',
      published: '2026-06-14T21:00:00',
      summary: 'Policymakers reiterated a data-dependent stance ahead of the next meeting.',
    },
    {
      id: 'n3',
      source: '연합뉴스',
      field: '환율',
      title: '원/달러 환율 소폭 하락',
      url: 'https://example.com/n3',
      published: '2026-06-13T09:00:00',
      summary: '달러 약세에 환율이 4원 내렸다.',
    },
  ],
};

const READS_FIXTURE = {
  at: '2026-06-15T08:30:00',
  date: '2026-06-15',
  articles: [
    {
      id: 'a1',
      lang: 'ko',
      field: '경제',
      source: '한겨레',
      title: '금리 인하 논쟁, 무엇이 쟁점인가',
      url: 'https://example.com/a1',
      published: '2026-06-15T06:00:00',
      words: 820,
      text: '중앙은행의 통화정책을 둘러싼 논쟁이 다시 뜨겁다. 물가와 고용이라는 두 목표 사이에서 정책 결정자들은 신중한 태도를 유지하고 있다.',
    },
    {
      id: 'a2',
      lang: 'en',
      field: 'science',
      source: 'Nature',
      title: 'How mRNA vaccines are being adapted for new targets',
      url: 'https://example.com/a2',
      published: '2026-06-14T21:00:00',
      words: 1140,
      text: 'Researchers are extending the mRNA platform beyond infectious disease toward oncology and rare genetic disorders, adapting delivery and stability along the way.',
    },
  ],
};

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

// P9 Phase 6 Wave④: 발견 triage 큐 fixture(pending 후보 세 유형 · 결정 버튼 렌더 결정론 캡처).
const DISCOVERY_FIXTURE = {
  _schemaVersion: 1,
  entries: [
    {
      id: 'bridge::ofdm-symmetry',
      kind: 'bridge',
      source: '매개중심성',
      score: 1.42,
      status: 'pending',
      detail: { title: 'OFDM 대칭성', goals: ['communication-theory', 'signal-processing'] },
    },
    {
      id: 'uncovered::channel-coding',
      kind: 'uncovered',
      source: 'surface_uncovered',
      score: 0.88,
      status: 'pending',
      detail: { title: '채널 부호화' },
    },
    {
      id: 'survey_context::rf-noise',
      kind: 'survey_context',
      source: 'surface_survey_context',
      score: 0.61,
      status: 'pending',
      detail: { title: 'RF 잡음 개론' },
    },
    {
      // P9 Wave⑤: capability-unlock 가능신호(D10) — 발견 inbox 렌더 + 내 길 프로젝트 섹션 양방향 참조 결정론 캡처.
      id: 'capability::sdr-rx',
      kind: 'capability',
      source: 'capability_unlock',
      score: 0.72,
      status: 'pending',
      detail: { title: 'SDR 수신기 — 필요지식 임계 도달' },
    },
    {
      id: 'uncovered::already-dismissed',
      kind: 'uncovered',
      source: 'surface_uncovered',
      score: 0.4,
      status: 'dismissed',
      detail: { title: '기각됨' },
    },
  ],
};

const TABS = [
  'today',
  'goals',
  'discovery',
  'schedule',
  'items',
  'reads',
  'markets',
  'atlas',
  'journal',
  'degree',
  'stats',
  'routine',
  'settings',
  'mastery',
  'control',
  'integrations',
  'review',
  'guide',
];
const THEMES = ['dark', 'light'] as const;

async function boot(page: Page, theme: string, seed: object = SEED) {
  // reducedMotion을 명시 await — config(use.reducedMotion)만 믿으면 드물게 첫 로드와 레이스해
  // AmbientCanvas가 애니메이션 프레임으로 돌기 시작(스크린샷 불안정 → flaky). 여기서 확정한다.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // P8 E-3: reads/markets 수집 아티팩트를 고정 fixture로 mock(수집 상태·serve.js 유무와 무관하게
  // '데이터 상태'를 결정론 캡처). 다른 탭은 이 경로를 안 부르므로 무영향.
  await page.route('**/api/artifact/reads', (route) => route.fulfill({ json: { ok: true, data: READS_FIXTURE } }));
  await page.route('**/api/artifact/markets', (route) => route.fulfill({ json: { ok: true, data: MARKETS_FIXTURE } }));
  await page.route('**/api/artifact/goals', (route) => route.fulfill({ json: { ok: true, data: GOALS_FIXTURE } }));
  await page.route('**/api/artifact/discovery', (route) =>
    route.fulfill({ json: { ok: true, data: DISCOVERY_FIXTURE } }),
  );
  await page.route('**/api/artifact/knowledge', (route) =>
    route.fulfill({ json: { ok: true, data: KNOWLEDGE_FIXTURE } }),
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
  await expect(page).toHaveScreenshot('stats-accent-lime.png', { fullPage: true });
});

// 진로 지도 상세(딥링크 /atlas/<key>) — 전체폭 상세 라우트가 그리드가 아닌 상세 화면을 그리는지.
for (const theme of THEMES) {
  test(`atlas-detail · ${theme}`, async ({ page }) => {
    await boot(page, theme);
    await page.goto('/atlas/ran');
    await expect(page.locator('#main')).toBeVisible();
    await expect(page.locator('#main h1')).toBeVisible(); // 상세 표제(그리드엔 h1 없음)
    await expect(page).toHaveScreenshot(`atlas-detail-${theme}.png`, { fullPage: true });
  });
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
