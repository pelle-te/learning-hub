import { test, expect } from './_test';
import type { Page } from '@playwright/test';

/* 계획 탭 **동작(behavior)** e2e — 시각 스냅샷(visual.spec.ts)이 못 잡는 '배선'을 덮는다.
   감사 결론: lib(weekAlloc·dayPlans·scheduleView)은 Func 100%인데 그 로직을 UI에 잇는 배선은 0%.
   → 여기서 덮는 세 배선:
     ① 배분 셀 입력 → setAllocCell + ensureWeekAlloc 승격 + persist(새로고침 생존)
     ② 트레이 → 타임라인 배치(placeFirstFree ⤵) + Alt+화살표 이동(WCAG 2.1.1 키보드 대안)
     ③ 배분 요일 헤더 → `?ds=` 딥링크로 캘린더 일 뷰 드릴다운(세그먼트 간 계약)

   결정성:
   - 시각은 `page.clock.setFixedTime`으로 고정한다. 두 가지를 피한 결과다:
     ① `_today` 시드는 안 통한다 — persistence.migrate()가 부팅 때 `_today`를 **삭제**한다
        ("평소 데이터엔 없어야 한다"). localStorage로 주입하면 조용히 벽시계로 되돌아간다.
     ② `clock.install`은 가짜 타이머가 멈춰 store persist의 400ms 디바운스 flush가 영영 안 돈다
        → ①의 '새로고침 생존'을 검증할 수 없다. setFixedTime은 Date만 얼리고 타이머는 굴린다.
   - addInitScript는 매 내비게이션마다 도는데, 그대로 두면 reload가 시드로 덮어써 ①이 항상 통과한다
     (거짓 통과). → **키가 없을 때만** 심는다: 첫 로드만 시드, 이후엔 앱이 쓴 실제 저장분을 읽는다.
   - 시각 스냅샷(toHaveScreenshot)은 여기서 일절 쓰지 않는다.
*/

const TODAY = '2026-06-15'; // 월요일 — 배분 보드의 첫 열(월)이 곧 '오늘'
const FIXED = new Date('2026-06-15T09:00:00');
const WED = '2026-06-17'; // 같은 주 수요일 — 드릴다운 대상

const SEED = {
  schemaVersion: 3,
  theme: 'dark',
  startDate: '2026-06-01',
  moduleLen: 120,
  reviewRatio: 20,
  completions: {},
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
  routine: [
    { id: 'r1', name: '수면', type: '수면', start: '00:00', end: '07:00', days: [0, 1, 2, 3, 4, 5, 6] },
    { id: 'r2', name: '수업', type: '수업', start: '09:00', end: '12:00', days: [1, 3] },
  ],
  cbms: [],
  degree: { targetTotal: 130, reqMajorReq: 60, reqMajorSel: 30, reqLiberal: 30, semesters: [] },
};

/** 앱 부팅 — 저장 키가 **비어 있을 때만** 시드를 심는다(reload 후엔 실제 저장분을 읽게).
 *  schedView는 useUI(lh_ui_v1)가 소유하므로 캘린더 뷰가 필요한 시나리오에서 함께 고정한다. */
async function boot(page: Page, schedView: 'day' | 'week' | 'month' = 'week') {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.setFixedTime(FIXED);
  await page.addInitScript(
    ([seed, view]) => {
      try {
        if (!localStorage.getItem('study_planner_v3')) localStorage.setItem('study_planner_v3', JSON.stringify(seed));
        if (!localStorage.getItem('lh_ui_v1'))
          localStorage.setItem('lh_ui_v1', JSON.stringify({ schedView: view, accent: 'lime', recentCommands: [] }));
      } catch {
        /* noop */
      }
    },
    [SEED, schedView] as const,
  );
}

/* ── ① 배분 셀 입력 → 승격 → 새로고침 생존 ────────────────────────────────
   덮는 배선: AllocBoard 셀 onChange → setCell(sid, wd, h) → mutate(setAllocCell(...))
   → ensureWeekAlloc 자동승격(배지 '자동 제안' → '내 배분') → useApp persist → 재부팅 hydrate.
   sid/wd 오배선(예: 열 index i를 wd로 넘김)·승격 누락·persist 누락이 모두 여기서 죽는다. */
test('배분 셀에 넣은 값이 승격되고 새로고침 후에도 남는다', async ({ page }) => {
  await boot(page);
  await page.goto('/alloc');

  const board = page.getByRole('table', { name: '주간 배분 보드' });
  await expect(board).toBeVisible();

  // 편집 전 = 엔진이 제안한 자동 배분(승격 전).
  await expect(page.getByText('자동 제안')).toBeVisible();

  // 수요일은 09~12 수업이 있는 요일 — 자동값과 무관하게 명시값으로 덮어쓴다.
  const wed = page.getByLabel('미적분 · 수요일 배분(시간)');
  await wed.fill('2.5');
  await expect(wed).toHaveValue('2.5');

  // 다른 과목·다른 요일도 — sid/wd 축이 뒤바뀌면(전치 오배선) 이 조합이 서로 오염된다.
  const fri = page.getByLabel('일반물리 · 금요일 배분(시간)');
  await fri.fill('1.5');
  await expect(fri).toHaveValue('1.5');
  await expect(wed).toHaveValue('2.5'); // 앞 셀이 흔들리지 않았는가

  // 첫 편집 = managed 승격(ensureWeekAlloc).
  await expect(page.getByText('내 배분')).toBeVisible();
  // 승격되면 '자동으로 되돌리기' 경로가 열린다.
  await expect(page.getByRole('button', { name: /자동으로/ })).toBeVisible();

  // persist(400ms 디바운스) flush를 기다린다 — 저장 전에 reload하면 검증이 무의미해진다.
  await expect
    .poll(
      async () => {
        const raw = await page.evaluate(() => localStorage.getItem('study_planner_v3'));
        if (!raw) return null;
        const st = JSON.parse(raw) as { weekAlloc?: Record<string, Record<string, number[]>> };
        return st.weekAlloc?.['2026-06-15']?.['m']?.[3] ?? null; // wd 3 = 수요일(분)
      },
      { timeout: 5000 },
    )
    .toBe(150);

  // 재부팅 — 시드는 다시 심기지 않는다(키가 이미 있음) → 순수하게 저장분에서 복원되는지 본다.
  await page.reload();
  await expect(board).toBeVisible();
  await expect(page.getByLabel('미적분 · 수요일 배분(시간)')).toHaveValue('2.5');
  await expect(page.getByLabel('일반물리 · 금요일 배분(시간)')).toHaveValue('1.5');
  await expect(page.getByText('내 배분')).toBeVisible();
});

/* ── ② 트레이 → 타임라인 배치 + 키보드 이동 ──────────────────────────────
   HTML5 drag&drop은 Playwright(CDP 합성 이벤트)에서 불안정하므로, 앱이 WCAG 2.1.1용으로
   **의도적으로** 병존시킨 키보드/버튼 대안 경로를 쓴다:
     ⤵ 버튼 = placeFirstFree(첫 빈 시간 배치, resolveSlot 겹침 해소) — 드롭과 같은 mutate 배선
     Alt+↓  = TimedCard onKeyDown → onMove(+SNAP) → placeBlock/placeTask
   드롭 좌표만 다를 뿐 상태 변경 경로(placeTask/placeBlock)는 드래그와 동일하고,
   덤으로 접근성 경로 자체를 회귀 방어한다. */
test('트레이 항목을 ⤵로 타임라인에 배치하고 Alt+↓로 시각을 옮긴다', async ({ page }) => {
  await boot(page, 'day');
  await page.goto(`/schedule?ds=${TODAY}`);

  await expect(page.locator('#main')).toBeVisible();

  // 자유 할 일 하나를 만들어 '미배치 항목'을 결정론적으로 확보(자동초안 블록 구성에 의존하지 않게).
  // 트레이 어댑터는 빈 날엔 EmptyState 안에, 아니면 트레이 안에 있다 — 어느 쪽이든 같은 라벨이다.
  await page.getByLabel('자유 할 일 추가').first().fill('과제 제출');
  await page.getByRole('button', { name: '할 일 추가', exact: true }).first().click();

  // 트레이에 미배치 상태로 앉는다 — 아직 타임라인 카드는 없다.
  const place = page.getByRole('button', { name: '과제 제출 시간박기' });
  await expect(place).toBeVisible();
  const card = page.getByRole('group', { name: /^과제 제출 · 할 일 / });
  await expect(card).toHaveCount(0);

  // ⤵ = 첫 빈 시간에 배치(드롭과 같은 placeTask 배선).
  await place.click();
  await expect(card).toHaveCount(1);
  await expect(place).toHaveCount(0); // 트레이에서 사라짐(미지정 → 시각 배정)

  // 실제로 '시각'이 붙었는가 — 카드 접근명에 HH:MM–HH:MM 구간이 들어온다.
  const nameBefore = (await card.getAttribute('aria-label')) ?? '';
  const m = /(\d{2}):(\d{2})–(\d{2}):(\d{2})/.exec(nameBefore);
  expect(m, `카드 접근명에 시각 구간이 없다: ${nameBefore}`).not.toBeNull();
  const startMin = Number(m![1]) * 60 + Number(m![2]);
  const endMin = Number(m![3]) * 60 + Number(m![4]);
  expect(endMin - startMin).toBe(30); // 자유 할 일 기본 30분

  // 키보드 대안 — 카드 툴바의 ✎ 버튼에 포커스한 뒤 Alt+↓(컨테이너로 버블링) → +15분 이동.
  await page.getByRole('button', { name: '과제 제출 시각·길이 편집' }).focus();
  await page.keyboard.press('Alt+ArrowDown');

  const moved = startMin + 15;
  const hh = String(Math.floor(moved / 60)).padStart(2, '0');
  const mm = String(moved % 60).padStart(2, '0');
  await expect(page.getByRole('group', { name: new RegExp(`^과제 제출 · 할 일 ${hh}:${mm}–`) })).toHaveCount(1);
});

/* ── ③ 배분 요일 헤더 → `?ds=` 일 뷰 드릴다운 ─────────────────────────────
   덮는 계약: AllocBoard 열머리글 버튼 → Alloc.onOpenDay(ds) → setSchedView('day') +
   navigate(`/schedule?ds=…`) → Schedule의 anchorDs 초기값 흡수.
   보내는 쪽/받는 쪽이 다른 feature라 lib 테스트가 절대 못 닿는 사각지대다. */
test('배분 보드에서 요일을 열면 캘린더가 그 날짜의 일 뷰로 착지한다', async ({ page }) => {
  await boot(page);
  await page.goto('/alloc');
  await expect(page.getByRole('table', { name: '주간 배분 보드' })).toBeVisible();

  // 수요일(6/17) 열머리글 = 그날 일 편집기를 여는 버튼.
  await page.getByRole('button', { name: /6\/17/ }).click();

  // ① 딥링크가 붙었고 ② 뷰가 '일'로 전환됐고 ③ 앵커 날짜가 그날이다.
  await expect(page).toHaveURL(new RegExp(`/schedule\\?ds=${WED}$`));
  await expect(
    page.getByRole('group', { name: '캘린더 보기 방식' }).getByRole('button', { name: '일' }),
  ).toHaveAttribute('aria-pressed', 'true');
  // 날짜 네비가 그날을 가리킨다(오늘 6/15이 아니라 6/17 — 딥링크가 실제로 흡수됐는가).
  await expect(page.getByRole('button', { name: '이전 날' })).toBeVisible();
  await expect(page.locator('#main')).toContainText('6/17');
  await expect(page.locator('#main')).toContainText('수요일');
});
