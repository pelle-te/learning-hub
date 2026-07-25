import { type Page } from '@playwright/test';

/* ============================================================
   _fixtures.ts — e2e 공용 시드·fixture·부팅 헬퍼.

   ## 왜 갈라 나왔나 (2026-07-25 · a11y 게이트 도입)

   원래 이 전부가 `visual.spec.ts` 안에 있었다. `a11y.spec.ts` 가 axe 를 돌리려면
   **시각 베이스라인과 똑같이 채워진 앱**을 봐야 한다 — 빈 화면은 컨트롤도 랜드마크도
   거의 없어서 a11y 검사가 통과해도 아무것도 증명하지 못한다.

   사본을 뜨지 않은 이유는 이 저장소가 두 번 물린 divergence 다(`rows.ts` ↔ `rows.rs`).
   시드가 갈리면 두 스위트가 **서로 다른 앱**을 검사하게 되고, 그 사실이 조용히 유지된다.

   ⚠ 스펙 파일에서 import 하지 않고 여기로 뺀 이유: Playwright 는 스펙을 각각 로드하므로
   스펙이 스펙을 import 하면 `test()` 가 **두 번 등록**된다. 파일명이 `*.spec.ts` 가
   아니라서 테스트로 수집되지도 않는다(testMatch 기본값).

   ⚠ 이 파일은 **순수 이동**이다(2026-07-25). 값·순서·로직을 한 글자도 바꾸지 않았다 —
   바꿨다면 스냅샷 59장이 전부 흔들렸을 것이고, 그건 a11y 도입의 대가가 아니다.
============================================================ */

export const FIXED = new Date('2026-06-15T09:00:00');

/* P8 E-3 — reads/markets 결정론화: 두 탭은 변동 수집데이터(_읽을거리/latest·_증시/latest)에 그려져
   매 수집마다 스냅샷이 RED였다(vite preview는 /api 프록시 없음 · 로컬 serve.js면 실데이터 유입).
   고정 fixture 를 page.route 로 mock 해 수집 상태·serve.js 유무와 무관하게 '데이터 상태'를 안정 캡처.
   date=오늘(고정시계)로 두어 useAutoCollect 재수집을 막고, published는 TZ 없는 로컬시각(고정시계 기준
   상대표기 결정론). */
// 내 길(goals) — 손저작 goals.json 을 고정 fixture 로(P9 Phase 6 · 실 계약과 동형 · 결정론 캡처).
export const GOALS_FIXTURE = {
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
export const KNOWLEDGE_FIXTURE = {
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

/* 정본 원장(ledger) — 과목×챕터 5단계 파이프라인. C-7 Tailwind 이식 전 시각 커버리지가 0이었다
   (mastery·atlas 처럼 볼트 산출물에 그려지므로 트랙 A 에선 목업 없이는 '셋업 안내'만 뜬다). 이식이
   퍼널·매트릭스·병목·백로그를 통째로 픽셀 교체하므로 그 전에 데이터 있는 상태를 잠근다(§15-4). */
export const LEDGER_FIXTURE = {
  _schemaVersion: 1,
  generated: '2026-06-15T08:00:00',
  generated_by: '챕터원장.py',
  n_chapters: 10,
  stage_counts: { sourced: 10, noted: 8, verified: 3, carded: 5, reviewed: 2 },
  backlog: { unprocessed_src: ['전자기학', '마이크로파'], subjects_without_src: ['안테나'] },
  subjects: {
    통신이론: {
      slug: 'comm-theory',
      abbr: '통신',
      domain: '전공',
      src: '_참고/통신',
      src_present: true,
      chapters: [
        {
          chapter_id: 'ct-1',
          arc: '1 신호와 시스템',
          notes: 5,
          concept: 3,
          status: { verified: 4, drafted: 1, raw: 0, 구버전: 0 },
          verified_ratio: 0.8,
          carded_notes: 4,
          cards: 12,
          reps: 40,
          reviewed_recent: '2026-06-10',
          milestones: { sourced: true, noted: true, verified: true, carded: true, reviewed: true },
          furthest: 'reviewed',
        },
        {
          chapter_id: 'ct-2',
          arc: '2 푸리에 변환',
          notes: 4,
          concept: 2,
          status: { verified: 3, drafted: 1, raw: 0, 구버전: 0 },
          verified_ratio: 0.75,
          carded_notes: 3,
          cards: 8,
          reps: 12,
          reviewed_recent: null,
          milestones: { sourced: true, noted: true, verified: true, carded: true, reviewed: false },
          furthest: 'carded',
        },
        {
          chapter_id: 'ct-3',
          arc: '3 표본화 정리',
          notes: 2,
          concept: 1,
          status: { verified: 0, drafted: 2, raw: 0, 구버전: 0 },
          verified_ratio: 0,
          carded_notes: 0,
          cards: 0,
          reps: 0,
          reviewed_recent: null,
          milestones: { sourced: true, noted: true, verified: false, carded: false, reviewed: false },
          furthest: 'noted',
        },
        {
          chapter_id: 'ct-4',
          arc: '4 변조 방식',
          notes: 0,
          concept: 0,
          status: { verified: 0, drafted: 0, raw: 0, 구버전: 0 },
          verified_ratio: 0,
          carded_notes: 0,
          cards: 0,
          reps: 0,
          reviewed_recent: null,
          milestones: { sourced: true, noted: false, verified: false, carded: false, reviewed: false },
          furthest: 'sourced',
        },
      ],
    },
    신호처리: {
      slug: 'signal-proc',
      abbr: '신호',
      domain: '전공',
      src: '_참고/신호',
      src_present: true,
      chapters: [
        {
          chapter_id: 'sp-1',
          arc: '1 이산 신호',
          notes: 3,
          concept: 2,
          status: { verified: 2, drafted: 1, raw: 0, 구버전: 0 },
          verified_ratio: 0.6,
          carded_notes: 0,
          cards: 0,
          reps: 0,
          reviewed_recent: null,
          milestones: { sourced: true, noted: true, verified: true, carded: false, reviewed: false },
          furthest: 'verified',
        },
        {
          chapter_id: 'sp-2',
          arc: '2 z-변환',
          notes: 2,
          concept: 1,
          status: { verified: 0, drafted: 2, raw: 0, 구버전: 0 },
          verified_ratio: 0,
          carded_notes: 0,
          cards: 0,
          reps: 0,
          reviewed_recent: null,
          milestones: { sourced: true, noted: true, verified: false, carded: false, reviewed: false },
          furthest: 'noted',
        },
        {
          chapter_id: 'sp-3',
          arc: '3 필터 설계',
          notes: 0,
          concept: 0,
          status: { verified: 0, drafted: 0, raw: 0, 구버전: 0 },
          verified_ratio: 0,
          carded_notes: 0,
          cards: 0,
          reps: 0,
          reviewed_recent: null,
          milestones: { sourced: false, noted: false, verified: false, carded: false, reviewed: false },
          furthest: 'planned',
        },
      ],
    },
    안테나: {
      slug: 'antenna',
      abbr: '안테나',
      domain: '전공',
      src: null,
      src_present: false,
      chapters: [
        {
          chapter_id: 'an-1',
          arc: '1 방사 원리',
          notes: 1,
          concept: 0,
          status: { verified: 0, drafted: 1, raw: 0, 구버전: 0 },
          verified_ratio: 0,
          carded_notes: 0,
          cards: 0,
          reps: 0,
          reviewed_recent: null,
          milestones: { sourced: true, noted: true, verified: false, carded: false, reviewed: false },
          furthest: 'noted',
        },
        {
          chapter_id: 'an-2',
          arc: '2 배열 안테나',
          notes: 0,
          concept: 0,
          status: { verified: 0, drafted: 0, raw: 0, 구버전: 0 },
          verified_ratio: 0,
          carded_notes: 0,
          cards: 0,
          reps: 0,
          reviewed_recent: null,
          milestones: { sourced: false, noted: false, verified: false, carded: false, reviewed: false },
          furthest: 'planned',
        },
      ],
    },
  },
};

export const MARKETS_FIXTURE = {
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

export const READS_FIXTURE = {
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
export const SEED = {
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
export const DISCOVERY_FIXTURE = {
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

export const TABS = [
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
  'forecast',
  // 'routine' 제거 — 계획 재개편 v3에서 '뼈대'가 '과목'으로 병합돼 /routine은 /items 리다이렉트다.
  // 남겨두면 items와 픽셀 동일한 스냅샷이 두 벌 생겨 리뷰 노이즈만 는다.
  'settings',
  'mastery',
  'control',
  'integrations',
  'review',
  'guide',
  'ledger',
  // graph 는 <canvas> 힘-방향 뷰지만 초기 좌표가 id 해시 시드로 **결정론적**이고(graphData.ts:
  // "Math.random 금지 · 스냅샷/테스트 안정") reduced-motion 에선 동기 1회 렌더라 캡처가 안정적이다.
  'graph',
];
export const THEMES = ['dark', 'light'] as const;

/* 캡처 직전 정착 대기 — **웹폰트 스와프가 레이아웃을 10px 움직인다**(2026-07-24 발견).
   이 앱은 `Pretendard Variable` 을 쓰는데, 폴백 폰트로 첫 페인트가 끝난 뒤 스와프가 일어나면
   줄상자 높이가 줄어 화면 전체가 위로 밀린다. `toHaveScreenshot` 의 "연속 두 프레임 동일"
   안정화는 그 사이에 끼어들 수 있어(실측: 16 병렬에서 2/16 이 스와프 전 상태로 박혔다)
   **베이스라인 자체가 두 상태를 오갔다** — 종전 임계 2% 가 그걸 통째로 삼키고 있었다.
   `fonts.status==='loaded'` 로 스와프 완료를 단정하고 rAF 두 번으로 그 뒤 리플로우까지 넘긴다. */
export async function settle(page: Page) {
  await page.waitForFunction(() => document.fonts.status === 'loaded');
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
}

export async function boot(page: Page, theme: string, seed: object = SEED) {
  // reducedMotion을 명시 await — config(use.reducedMotion)만 믿으면 드물게 첫 로드와 레이스해
  // AmbientCanvas가 애니메이션 프레임으로 돌기 시작(스크린샷 불안정 → flaky). 여기서 확정한다.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  /* P8 E-3: 수집 아티팩트 5종을 고정 fixture 로 mock — '데이터 상태'를 결정론적으로 캡처한다.
     ▶ 4단계-G 에서 `page.route` 를 **`__TAURI_INTERNALS__.invoke` 스텁**으로 바꿨다.
     serve.js 가 사라져 `/api` 라는 것이 더는 없기 때문이고, **IPC 는 `page.route` 로 못 가로챈다**
     (네트워크가 아니다 — 설계 §6 이 예고한 재작성). 스텁을 심으면 `isTauri()` 가 참이 되어
     `api.ts` 가 셸 경로를 타고, 그 경로를 여기서 답해 준다.
     ⚠ 다른 커맨드는 **의도적으로 reject** 한다 — 그래야 mock 하지 않은 탭이 지금까지처럼
     '백엔드 없음' 화면을 찍는다(스냅샷 59장이 원래 그 상태를 담고 있다). */
  await page.addInitScript(
    (fixtures: Record<string, unknown>) => {
      (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
        invoke: (cmd: string, args?: { name?: string }) => {
          if (cmd === 'artifact_read' && args?.name && args.name in fixtures) {
            return Promise.resolve({ ok: true, data: fixtures[args.name] });
          }
          return Promise.reject(new Error('NOT_FOUND e2e 스텁 — 이 커맨드는 목업되지 않았습니다'));
        },
        transformCallback: (cb: unknown) => cb,
      };
    },
    {
      reads: READS_FIXTURE,
      markets: MARKETS_FIXTURE,
      goals: GOALS_FIXTURE,
      discovery: DISCOVERY_FIXTURE,
      knowledge: KNOWLEDGE_FIXTURE,
      ledger: LEDGER_FIXTURE,
    } as Record<string, unknown>,
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
export const SEED_EMPTY = {
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
export const TABS_EMPTY = ['today', 'schedule', 'items', 'degree', 'journal', 'graph'];
