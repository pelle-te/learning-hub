// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { renderApp } from './_render';
import { useApp } from '@/store/useApp';
import { iso, mondayOf } from '@/lib/utils';

/* Phase 4 — 앱상태 탭 7개(schedule·items·journal·review·stats·degree·settings)가
   React로 동작하고 변경이 store(앱상태)에 반영되는지. 모두 #page(레거시 노드)를 쓰지 않음. */

beforeEach(() => {
  useApp.getState().mutate((st) => {
    st.items = [
      {
        id: 'sx',
        source: '직접',
        name: '미적분',
        color: '#4f8ff0',
        mode: 'weekly',
        weeklyHours: 3,
        dailyMin: 30,
        deadline: '',
        chapters: [],
      },
    ];
    st.routine = [];
    st.summaries = {};
    st.cbms = [];
    st.backlog = [];
    st.weekly = {};
    st.degree = { targetTotal: 130, reqMajorReq: 60, reqMajorSel: 30, reqLiberal: 30, semesters: [] };
    st.events = [];
  });
});
afterEach(() => cleanup());

// 계획 재개편 v4 — 캘린더 세그먼트는 [일·주·월]만 소유하고, 배분은 /alloc 독립 세그먼트로 승격됐다.
test('schedule: 캘린더 세그먼트가 일/주/월 뷰를 전환한다(#page 미사용)', async () => {
  renderApp('/schedule');
  // 기본 = 주 뷰(배분이 빠지며 캘린더가 계획의 첫 착지)
  await waitFor(() => expect(screen.getByRole('button', { name: '주' })).toHaveAttribute('aria-pressed', 'true'));
  expect(document.getElementById('page')).toBeNull();
  // 배분은 뷰 스위치에서 빠졌다 — 세그먼트 나브의 '배분' 버튼과 헷갈리지 않게 그룹 안으로 범위를 좁혀 확인.
  const viewSwitch = within(screen.getByRole('group', { name: '캘린더 보기 방식' }));
  expect(viewSwitch.queryByRole('button', { name: '배분' })).toBeNull();
  // 일 뷰로 전환 → aria-pressed 이동(세그먼트는 tablist 미이행 → group+aria-pressed, WCAG 4.1.2)
  fireEvent.click(screen.getByRole('button', { name: '일' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '일' })).toHaveAttribute('aria-pressed', 'true'));
  // 주 뷰로 전환 → 주간 네비 등장. 이름은 aria-label이 고정한다("◀" 같은 장식 문자 없이) —
  // 좁은 폭에서 버튼의 서술 텍스트가 접혀도 접근가능한 이름은 그대로여야 한다.
  fireEvent.click(screen.getByRole('button', { name: '주' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '이전 주' })).toBeInTheDocument());
  // 월 뷰로 전환 → aria-pressed 이동
  fireEvent.click(screen.getByRole('button', { name: '월' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '월' })).toHaveAttribute('aria-pressed', 'true'));
});

// 계획 재개편 v3 — '뼈대'는 '과목' 탭의 접이식 스트립으로 병합됐다. 편집기는 온디맨드라
// 스트립을 먼저 펼쳐야 '+ 블록 추가'가 나온다.
// ⚠ 옛 `/routine` 리다이렉트 shim 은 D-4 에서 은퇴했다 — 여기서 직접 /items 를 연다.
test('items: 뼈대 + 블록 추가가 store.routine에 들어간다', async () => {
  renderApp('/items');
  fireEvent.click(await screen.findByRole('button', { name: /수업·일과 편집/ }));
  const add = await screen.findByRole('button', { name: '+ 블록 추가' });
  fireEvent.click(add);
  await waitFor(() => expect(useApp.getState().state.routine.some((b) => b.type !== '수업')).toBe(true));
});

// 보드의 role은 grid가 아니라 table이다 — grid는 화살표 이동·단일 tab stop 계약을 약속하는데
// 이 보드는 셀마다 입력이 tab stop인 평범한 표라 그 계약을 이행하지 않는다(거짓 계약 제거).
// 단언도 "표가 있다"에서 "요일 열머리글과 편집 가능한 셀이 있다"로 승격한다.
test('alloc: 배분 세그먼트가 과목×요일 보드를 표 시맨틱으로 렌더한다', async () => {
  renderApp('/alloc');
  const board = await screen.findByRole('table', { name: '주간 배분 보드' });
  expect(board).toBeInTheDocument();
  // 요일 헤더는 열머리글이자 일 편집기를 여는 버튼(role 오버라이드로 버튼 의미를 덮지 않는다).
  const heads = within(board).getAllByRole('columnheader');
  expect(heads.length).toBe(9); // 과목·요일 + 7요일 + 주당
  expect(within(board).getAllByRole('button').length).toBe(7);
  expect(document.getElementById('page')).toBeNull();
});

test('alloc: 열 "가용"이 그날 일정을 차감한 실제 가용을 보여준다(스케줄러와 동일 출처)', async () => {
  // 보드가 capWd(요일 기본값·routine만 반영)를 쓰면 일정을 넣어도 가용이 그대로라 초과를 못 잡는다.
  // 실제로는 스케줄러가 dayStudyMin으로 그 구간을 깎고, 넘치는 분은 layoutDay가 start:null로 떨궈
  // 캘린더에서 사라진다 → 보드의 "한눈에 조망"이 틀린다. 두 출처가 같아야 한다.
  const mon = mondayOf(new Date());
  const evDs = iso(mon); // 이 주 월요일에만 8시간짜리 일정
  useApp.getState().mutate((st) => {
    st.events = [{ id: 'ev1', ds: evDs, name: '종일 워크숍', start: 9 * 60, min: 8 * 60 }];
  });
  renderApp('/alloc');
  const board = await screen.findByRole('table', { name: '주간 배분 보드' });
  const caps = within(board)
    .getAllByRole('cell')
    .map((el) => el.getAttribute('title') || '')
    .filter((t) => t.includes('가용'));
  const parse = (t: string) => Number(/가용 ([\d.]+)h/.exec(t)?.[1] ?? NaN);
  const monCap = parse(caps.find((t) => t.startsWith('월')) || '');
  const tueCap = parse(caps.find((t) => t.startsWith('화')) || '');
  expect(Number.isNaN(monCap)).toBe(false);
  expect(monCap).toBeLessThan(tueCap); // 일정이 있는 월요일만 가용이 깎여야 한다
});

/* ⚠ 경로가 `/journal` 에서 `/day` 로 바뀌었다(I048 · 2026-08-22). `journal` 은 `/day` 를
   가리키는 **두 번째 이름**이었고, 이름이 둘이면 다음 사람이 「둘은 다르다」로 읽는다. */
test('day: 3문장 요약 저장이 store.summaries에 기록된다', async () => {
  renderApp('/day');
  const ta = await screen.findByPlaceholderText(/시변 환경에서/);
  fireEvent.change(ta, { target: { value: '맥스웰 방정식 해석' } });
  fireEvent.click(screen.getByRole('button', { name: '요약 저장' }));
  const ds = iso(new Date());
  await waitFor(() => expect((useApp.getState().state.summaries[ds] || []).length).toBe(1));
});

test('review: 주간 점검 체크가 store.weekly에 저장된다', async () => {
  renderApp('/review');
  const cbs = await screen.findAllByRole('checkbox');
  fireEvent.click(cbs[0]);
  await waitFor(() => {
    const weekly = useApp.getState().state.weekly;
    expect(Object.values(weekly).some((w) => Object.values(w.checks).some(Boolean))).toBe(true);
  });
});

test('stats: 과목이 있으면 KPI/과목별 진행 표가 뜬다', async () => {
  renderApp('/stats');
  await waitFor(() => expect(screen.getByRole('heading', { name: '과목별 진행' })).toBeInTheDocument());
  /* ⚠ 종전엔 「연속 학습일」을 단언했다 — I046 이 그 리드아웃을 지웠다(입력 `completions` 가
     실물에서 0행이라 **항상 0** 이었다). 같은 자리에 남은 리드아웃으로 바꾼다. */
  expect(screen.getByText('완료 챕터')).toBeInTheDocument();
});

test('degree: + 학기 추가가 store.degree.semesters에 들어간다', async () => {
  renderApp('/degree');
  const add = await screen.findByRole('button', { name: '+ 학기 추가' });
  fireEvent.click(add);
  await waitFor(() => expect(useApp.getState().state.degree.semesters.length).toBe(1));
});

test('settings: 모듈 길이 변경이 store에 반영된다', async () => {
  renderApp('/settings');
  const input = await screen.findByLabelText('모듈 길이 (시간)');
  fireEvent.change(input, { target: { value: '3' } });
  await waitFor(() => expect(useApp.getState().state.moduleLen).toBe(180));
});
