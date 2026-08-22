// @vitest-environment jsdom
/* ============================================================
   allocBoard.test.tsx — 배분 보드(AllocBoard)의 **동작·계약** 회귀.

   왜 이 파일이 있는가: 배분 보드는 엔진/lib 은 단위 테스트로 두껍게 덮여 있지만(weekAlloc.test.ts)
   **UI 층의 안전망은 e2e 시각 스냅샷뿐**이었다. 6단계(Tailwind 전환)는 스냅샷 59장을 통째로
   재생성하므로 그 순간 유일한 안전망이 무력화된다. 그래서 이 파일은 **스냅샷과 무관한** 축만 잠근다:
   셀 편집 → 상태 계약 · 합계/잔여 리드아웃 · 표 시맨틱과 포커스 계약 · 경계(빈 배분·0·음수·고아 sid).

   ⚠ 규율: 클래스명·스타일·픽셀을 단언하지 않는다(그걸 잠그면 이 파일의 존재 이유가 사라진다).
      질의는 role/label/텍스트만 쓴다 — JSX 를 다시 짜도 **의미가 같으면** 통과해야 한다.
============================================================ */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { AllocBoard } from '@/features/alloc/AllocBoard';
import { useApp } from '@/store/useApp';
import { selectSchedule, selectStudyMinByWeekday } from '@/store/selectors';
import { isWeekManaged } from '@/lib/weekAlloc';
import { ItemSchema, WeekAllocSchema } from '@/lib/schema';
import type { Item } from '@/lib/types';

/* 주 고정 — startDate 가 월요일이라 첫 주 월요일(=weekAlloc 키) 이 그대로 WK0. */
const WK0 = '2026-06-22'; // 월
const TUE = '2026-06-23'; // 화(wd=2)
const TODAY = '2026-06-24'; // 수 — 보드의 '오늘 열'
const MON_WD = 1;
const TUE_WD = 2;

/** 픽스처는 **실제 스키마로 파싱해서** 만든다(지어낸 모양이 sanitize 에 걸러지는 사고 방지). */
function item(over: Record<string, unknown>): Item {
  return ItemSchema.parse({
    source: '직접',
    mode: 'weekly',
    weeklyHours: 6,
    dailyMin: 30,
    deadline: '',
    // ⚠ 챕터 시간은 넉넉해야 한다 — 계획 지평 안에 다 끝나는 과목은 엔진이 finished 로 보고
    //    예산 배지가 '챕터 완료'(중립)로 바뀐다. 잔여 계산을 보려면 안 끝나는 과목이어야 한다.
    chapters: [{ id: 'ch-' + String(over.id), name: '1장', hours: 500, done: false }],
    ...over,
  });
}

const 물리 = item({ id: 'phy', name: '물리', color: '#4f8ff0', weeklyHours: 6 });
const 영어 = item({ id: 'eng', name: '영어', color: '#f08f4f', weeklyHours: 0 }); // 주당 0h = 배분해도 안 굴러감

/** 스토어를 결정적인 상태로 초기화한다(테스트 간 누수 차단 — 스토어는 싱글턴이다). */
function seed(over?: Partial<AppState>): void {
  useApp.getState().mutate((st) => {
    st._today = TODAY;
    st.startDate = WK0;
    st.moduleLen = 120;
    st.reviewRatio = 20;
    st.routine = []; // 빈 일과 = 하루 종일 가용(결정적)
    st.dayOverrides = {};
    st.events = [];
    st.dayPlans = {};
    st.completions = {};
    st.items = [물리, 영어];
    st.weekAlloc = {};
    Object.assign(st, over || {});
  });
}

/** 보드만 띄우는 하네스 — res·capWd 는 Alloc 탭과 **같은 셀렉터**로 매 렌더 새로 판다. */
function Board({ capWd, onOpenDay }: { capWd?: number[]; onOpenDay?: (ds: string) => void }) {
  const state = useApp((s) => s.state);
  return (
    <AllocBoard
      weekMon={WK0}
      res={selectSchedule(state)}
      capWd={capWd ?? selectStudyMinByWeekday(state)}
      todayIso={TODAY}
      onOpenDay={onOpenDay ?? (() => {})}
    />
  );
}

function renderBoard(props?: { capWd?: number[]; onOpenDay?: (ds: string) => void }) {
  return render(
    <MemoryRouter>
      <Board {...props} />
    </MemoryRouter>,
  );
}

/** 과목 행 = 그 이름의 rowheader 를 가진 role="row". (역할·이름으로만 찾는다 — 구조가 바뀌어도 산다.) */
function subjectRow(name: string): HTMLElement {
  const found = screen.getAllByRole('row').find((r) => within(r).queryByRole('rowheader')?.textContent?.includes(name));
  if (!found) throw new Error(`배분 보드에 '${name}' 행이 없다`);
  return found;
}

/** 셀 입력 — 접근성 정본(aria-label)으로만 찾는다. */
function cell(name: string, dow: string): HTMLElement {
  return screen.getByLabelText(`${name} · ${dow}요일 배분(시간)`);
}

/** 값 확정 = 입력 후 blur(NumberField 계약). */
function typeAndCommit(el: HTMLElement, raw: string): void {
  fireEvent.change(el, { target: { value: raw } });
  fireEvent.blur(el);
}

const allocOf = () => useApp.getState().state.weekAlloc?.[WK0];

beforeEach(() => seed());
afterEach(() => cleanup());

/* ── ① 셀 편집 → 상태 계약 ───────────────────────────────────────── */
describe('AllocBoard — 셀 편집이 weekAlloc 계약대로 쓴다', () => {
  it('시간을 입력하면 그 (과목, 요일) 칸이 분(min)으로 저장된다', () => {
    renderBoard();
    typeAndCommit(cell('물리', '화'), '2');
    expect(allocOf()?.['phy']?.[TUE_WD]).toBe(120);
  });

  it('첫 편집이 그 주를 자동 제안 → 내 배분(managed)으로 승격시킨다', () => {
    renderBoard();
    expect(isWeekManaged(useApp.getState().state, WK0)).toBe(false);
    expect(screen.getByText('자동 제안')).toBeInTheDocument();

    typeAndCommit(cell('물리', '월'), '1.5');

    expect(isWeekManaged(useApp.getState().state, WK0)).toBe(true);
    expect(allocOf()?.['phy']?.[MON_WD]).toBe(90); // 0.5 단위 → 90분
    expect(screen.getByText('내 배분')).toBeInTheDocument();
  });

  it('연속 편집이 서로를 지우지 않는다 — 두 번째 쓰기가 첫 번째를 보존한다', () => {
    /* ⚠ setAllocCell(st, res, …) 은 스케줄러 파생물(res)을 **쓰기 인자로 되먹는다**(설계 §2-4).
       승격 스냅샷이 매 편집마다 다시 심어지면 직전 편집이 자동값으로 되돌아간다 — 그 회귀를 잠근다. */
    renderBoard();
    typeAndCommit(cell('물리', '월'), '2');
    typeAndCommit(cell('물리', '화'), '1');
    expect(allocOf()?.['phy']?.[MON_WD]).toBe(120);
    expect(allocOf()?.['phy']?.[TUE_WD]).toBe(60);
  });

  it('칸을 비우면 0으로 확정된다(= 이 요일엔 배분 안 함) — managed 는 유지', () => {
    seed({ weekAlloc: WeekAllocSchema.parse({ [WK0]: { phy: [0, 120, 0, 0, 0, 0, 0] } }) });
    renderBoard();
    typeAndCommit(cell('물리', '월'), '');
    expect(allocOf()?.['phy']?.[MON_WD]).toBe(0);
    expect(isWeekManaged(useApp.getState().state, WK0)).toBe(true); // 전부 0인 '쉬는 주'도 사용자 의도다
  });

  it('Enter 로도 확정된다(blur 없이 — 키보드만으로 편집 가능)', () => {
    renderBoard();
    const el = cell('물리', '화');
    fireEvent.change(el, { target: { value: '3' } });
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(allocOf()?.['phy']?.[TUE_WD]).toBe(180);
  });

  it('자동으로 되돌리기: managed 주를 지워 자동 제안으로 복귀한다', () => {
    seed({ weekAlloc: WeekAllocSchema.parse({ [WK0]: { phy: [0, 120, 0, 0, 0, 0, 0] } }) });
    renderBoard();
    fireEvent.click(screen.getByRole('button', { name: /자동으로/ }));
    expect(isWeekManaged(useApp.getState().state, WK0)).toBe(false);
    expect(screen.getByText('자동 제안')).toBeInTheDocument();
  });

  it('자동 제안 주에는 "자동으로" 버튼이 없다(되돌릴 것이 없다)', () => {
    renderBoard();
    expect(screen.queryByRole('button', { name: /자동으로/ })).toBeNull();
  });
});

/* ── ② 합계·잔여 ─────────────────────────────────────────────────── */
describe('AllocBoard — 행 합·예산 잔여·열 합', () => {
  it('행 합과 주당 예산 대비 잔여를 보여준다(부족 → "남음")', () => {
    seed({ weekAlloc: WeekAllocSchema.parse({ [WK0]: { phy: [0, 60, 60, 0, 0, 0, 0] } }) });
    renderBoard();
    const r = subjectRow('물리');
    expect(r.textContent).toContain('2 / 6h'); // 배분 2h / 예산 6h
    expect(within(r).getByText('4h 남음')).toBeInTheDocument();
  });

  it('예산을 정확히 채우면 충족, 넘기면 초과분을 보여준다', () => {
    seed({ weekAlloc: WeekAllocSchema.parse({ [WK0]: { phy: [0, 360, 0, 0, 0, 0, 0] } }) });
    const { unmount } = renderBoard();
    expect(within(subjectRow('물리')).getByText('충족 ✓')).toBeInTheDocument();
    unmount();

    seed({ weekAlloc: WeekAllocSchema.parse({ [WK0]: { phy: [0, 360, 90, 0, 0, 0, 0] } }) });
    renderBoard();
    expect(within(subjectRow('물리')).getByText('+1.5h')).toBeInTheDocument();
  });

  it('주당 목표가 0인 과목은 잔여 대신 "시간 없음"(엔진이 new 를 만들지 않는다)', () => {
    seed({ weekAlloc: WeekAllocSchema.parse({ [WK0]: { eng: [0, 120, 0, 0, 0, 0, 0] } }) });
    renderBoard();
    expect(within(subjectRow('영어')).getByText('시간 없음')).toBeInTheDocument();
    // 같은 사실을 상단 경고로도 짚는다(배분했는데 왜 안 굴러가는지 조용히 두지 않는다).
    expect(screen.getByText('시간 없음 · 스케줄 안 됨')).toBeInTheDocument();
  });

  it('계획상 챕터를 다 끝내는 과목은 "남음" 대신 중립 라벨(더 배분하라 조르지 않는다)', () => {
    seed({
      items: [
        item({ id: 'phy', name: '물리', weeklyHours: 6, chapters: [{ id: 'c', name: '끝', hours: 2, done: false }] }),
      ],
    });
    renderBoard();
    expect(within(subjectRow('물리')).getByText('챕터 완료')).toBeInTheDocument();
    expect(within(subjectRow('물리')).queryByText(/남음/)).toBeNull();
  });

  it('ID-7 방치 배지 — 배분했는데 7일+ 손 안 댄 과목 행에만 뜬다', () => {
    // 물리: 이번 주 배분(120분) + 마지막 완료 10일 전(06-14) → 방치. 영어: 완료 이력 없음 → 배지 없음.
    seed({
      weekAlloc: WeekAllocSchema.parse({ [WK0]: { phy: [0, 120, 0, 0, 0, 0, 0] } }),
      completions: { '2026-06-14': { 'phy|new': { done: true, min: 60 } } }, // TODAY=06-24 → 10일
    });
    renderBoard();
    expect(within(subjectRow('물리')).getByText('10')).toBeInTheDocument();
    expect(within(subjectRow('물리')).getByLabelText('10일째 손 안 댐')).toBeInTheDocument();
    expect(within(subjectRow('영어')).queryByLabelText(/손 안 댐/)).toBeNull(); // 완료 이력 없는 과목은 안 몬다
  });

  it('ID-7 방치 배지 — 최근(7일 미만) 손 댔으면 배분 있어도 안 뜬다', () => {
    seed({
      weekAlloc: WeekAllocSchema.parse({ [WK0]: { phy: [0, 120, 0, 0, 0, 0, 0] } }),
      completions: { '2026-06-21': { 'phy|new': { done: true, min: 60 } } }, // TODAY=06-24 → 3일
    });
    renderBoard();
    expect(within(subjectRow('물리')).queryByText(/💤/)).toBeNull();
  });

  it('요일 열 합 / 그날 실제 가용 — dayOverrides 를 반영한다(요일 기본값이 아니다)', () => {
    seed({
      weekAlloc: WeekAllocSchema.parse({ [WK0]: { phy: [0, 0, 120, 0, 0, 0, 0] } }),
      dayOverrides: { [TUE]: 1 } as AppState['dayOverrides'], // 화요일만 1시간
    });
    renderBoard();
    // 화: 배분 2h > 가용 1h → 초과. 값은 title(내용)로 읽는다 — 색(스타일)은 단언하지 않는다.
    expect(screen.getByTitle('화 배분 2h / 가용 1h')).toBeInTheDocument();
  });

  it('열 합은 삭제된 과목의 고아 배분을 세지 않는다(보이는 행 합과 푸터가 어긋나지 않게)', () => {
    seed({
      weekAlloc: WeekAllocSchema.parse({
        [WK0]: { phy: [0, 60, 0, 0, 0, 0, 0], ghost: [0, 180, 0, 0, 0, 0, 0] },
      }),
      dayOverrides: { [WK0]: 5 } as AppState['dayOverrides'],
    });
    renderBoard();
    expect(screen.getByTitle('월 배분 1h / 가용 5h')).toBeInTheDocument(); // 방어 없으면 4h
    expect(screen.queryByRole('rowheader', { name: /ghost/ })).toBeNull(); // 행으로도 서지 않는다
  });
});

/* ── ③ 표 시맨틱·포커스 계약 ─────────────────────────────────────── */
describe('AllocBoard — 접근성 계약(6단계 JSX 재작성이 가장 잘 깨뜨리는 지점)', () => {
  it('role=table + 정직한 행/열 수 · 머리글 구조', () => {
    renderBoard();
    const grid = screen.getByRole('table', { name: '주간 배분 보드' });
    /* 행 = 과목 2 + 헤더 + **전공 밖 레인**(I053) + 가용 푸터. 열 = 과목 + 7요일 + 주당.
       ⚠ 레인이 붙으며 4→5 가 됐다. 이 수를 손으로 적는 것이 이 케이스의 요점이다 —
         선언(`aria-rowcount`)과 실물(rowheader 수)이 갈리면 SR 이 마지막 행을 «표 밖»으로 읽는다. */
    expect(grid).toHaveAttribute('aria-rowcount', '5');
    expect(grid).toHaveAttribute('aria-colcount', '9');
    expect(screen.getAllByRole('columnheader')).toHaveLength(9);
    // rowheader = 과목 2 + '전공 밖' + '가용' 푸터.
    expect(screen.getAllByRole('rowheader')).toHaveLength(4);
    expect(screen.getByRole('rowheader', { name: /전공 밖/ })).toBeInTheDocument();
    // ⚠ grid 가 아니어야 한다 — 화살표 탐색 계약을 약속해 놓고 이행하지 않으면 SR 사용자가 멈춘다.
    expect(screen.queryByRole('grid')).toBeNull();
  });

  it('모든 배분 칸이 키보드 탭 스톱(spinbutton)이고 과목·요일이 라벨에 다 실린다', () => {
    renderBoard();
    const inputs = screen.getAllByRole('spinbutton');
    // (과목 2 + 전공 밖 레인 1) × 요일 7 — 마우스 드래그 없이 전 칸 도달 가능.
    expect(inputs).toHaveLength(21);
    for (const dow of ['월', '화', '수', '목', '금', '토', '일']) {
      expect(cell('물리', dow)).toBeInTheDocument();
    }
    inputs.forEach((el) => expect(el).not.toHaveAttribute('tabindex', '-1'));
  });

  it('과목 행 머리글은 탭 스톱이 아니다(드래그는 순수 마우스 편의 레이어)', () => {
    renderBoard();
    const head = within(subjectRow('물리')).getByRole('rowheader');
    expect(head).not.toHaveAttribute('tabindex');
    expect(head).toHaveAttribute('draggable', 'true');
  });

  it('오늘 열만 aria-current="date" — 색 단독 전달을 보강한다', () => {
    renderBoard();
    const heads = screen.getAllByRole('columnheader');
    const current = heads.filter((h) => h.getAttribute('aria-current') === 'date');
    expect(current).toHaveLength(1);
    expect(current[0]!.textContent).toContain('수'); // TODAY=2026-06-24(수)
  });

  it('요일 머리글은 버튼이고, 누르면 그날 ISO 로 드릴다운한다', () => {
    const onOpenDay = vi.fn();
    renderBoard({ onOpenDay });
    const tueHead = screen.getAllByRole('columnheader')[2]!; // 0=코너, 1=월, 2=화
    fireEvent.click(within(tueHead).getByRole('button'));
    expect(onOpenDay).toHaveBeenCalledWith(TUE);
  });
});

/* ── ③-b 착지 펄스(UX-A3) — 모션의 **가드**만 잠근다 ─────────────────
   클래스·픽셀은 여전히 단언하지 않는다. 여기서 잠그는 건 "WAAPI 를 걸었는가"가 아니라
   **reduced-motion 에서 안 거는가**다 — WAAPI 는 전역 CSS 백스톱이 닿지 않는 유일한 층이라,
   가드가 빠지면 모션 민감 사용자에게 조용히 애니가 남는다(정적 검사로는 안 보인다). */
describe('AllocBoard — 착지 펄스는 모션 환경설정을 존중한다', () => {
  /** 드롭 = dragstart(행 머리글) → drop(그 행의 칸). dataTransfer 는 jsdom 에 없어 최소 스텁. */
  function dropOnCell(subject: string, dow: string): void {
    const head = within(subjectRow(subject)).getByRole('rowheader');
    const dt = { setData: () => {}, effectAllowed: '', dropEffect: '', getData: () => '' };
    fireEvent.dragStart(head, { dataTransfer: dt });
    // 칸(role=cell)은 입력의 부모 — 핸들러가 붙어 있는 요소다.
    const target = cell(subject, dow).closest('[role="cell"]')!;
    fireEvent.drop(target, { dataTransfer: dt });
  }

  /* ⚠ jsdom 에는 `Element.prototype.animate` 가 **없다**(WAAPI 미구현). spyOn 은 없는 속성을
     못 감시하므로 직접 심는다. 이 부재가 곧 `pulseCell` 이 `typeof el.animate !== 'function'`
     가드를 갖는 이유이기도 하다 — 없으면 여기서 TypeError 로 드롭 자체가 죽는다. */
  let animate: ReturnType<typeof vi.fn>;
  const hadAnimate = 'animate' in Element.prototype;
  beforeEach(() => {
    animate = vi.fn(() => ({}) as Animation);
    Object.defineProperty(Element.prototype, 'animate', { value: animate, configurable: true, writable: true });
  });
  afterEach(() => {
    if (!hadAnimate) delete (Element.prototype as unknown as { animate?: unknown }).animate;
  });

  function mockReduce(reduce: boolean): void {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: reduce && q.includes('prefers-reduced-motion'),
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  }
  afterEach(() => vi.unstubAllGlobals());

  it('드롭하면 그 칸에 애니를 1회 건다(값도 함께 커밋된다)', () => {
    mockReduce(false);
    renderBoard();
    dropOnCell('물리', '화');
    expect(allocOf()?.['phy']?.[TUE_WD]).toBe(60); // 드롭 1회 = +1h
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it('reduced-motion 이면 값만 바뀌고 애니는 걸지 않는다', () => {
    mockReduce(true);
    renderBoard();
    dropOnCell('물리', '화');
    expect(allocOf()?.['phy']?.[TUE_WD]).toBe(60); // 기능은 그대로 — 모션만 뺀다
    expect(animate).not.toHaveBeenCalled();
  });
});

/* ── ④ 경계 ──────────────────────────────────────────────────────── */
describe('AllocBoard — 경계', () => {
  it('배분 대상 과목이 없으면 표 대신 안내(EmptyState)', () => {
    seed({ items: [] });
    renderBoard();
    expect(screen.getByText('배분할 과목이 없어요')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('button', { name: /과목 추가하러 가기/ })).toBeInTheDocument();
  });

  it('daily(Anki)·이름 없는 자리표시자는 행으로 서지 않는다', () => {
    seed({
      items: [물리, item({ id: 'anki', name: 'Anki', mode: 'daily' }), item({ id: 'blank', name: '', weeklyHours: 3 })],
    });
    renderBoard();
    expect(screen.getAllByRole('rowheader')).toHaveLength(3); // 물리 + 전공 밖 + '가용'
  });

  it('0 입력은 그 칸만 0으로 만든다(다른 칸을 건드리지 않는다)', () => {
    seed({ weekAlloc: WeekAllocSchema.parse({ [WK0]: { phy: [0, 120, 60, 0, 0, 0, 0] } }) });
    renderBoard();
    typeAndCommit(cell('물리', '월'), '0');
    expect(allocOf()?.['phy']?.[MON_WD]).toBe(0);
    expect(allocOf()?.['phy']?.[TUE_WD]).toBe(60);
  });

  it('음수는 0으로 클램프된다 — 저장에 음수가 들어가지 않는다', () => {
    seed({ weekAlloc: WeekAllocSchema.parse({ [WK0]: { phy: [0, 0, 120, 0, 0, 0, 0] } }) });
    renderBoard();
    typeAndCommit(cell('물리', '화'), '-3');
    expect(allocOf()?.['phy']?.[TUE_WD]).toBe(0);
    for (const vec of Object.values(allocOf() ?? {})) for (const m of vec) expect(m).toBeGreaterThanOrEqual(0);
  });

  it('이미 0인 칸에 음수를 넣어도 그 주를 managed 로 승격시키지 않는다', () => {
    // 클램프 결과가 현재값과 같으면 커밋 자체가 없다 — 무의미한 입력이 자동 제안을 영구 대체하면 안 된다.
    renderBoard();
    typeAndCommit(cell('물리', '화'), '-3');
    expect(isWeekManaged(useApp.getState().state, WK0)).toBe(false);
  });

  it('타이핑 중간 상태("1." → 브라우저가 주는 빈값)를 0으로 확정하지 않는다', () => {
    /* 이 저장소의 실사고 재현 경로: 중간의 0 확정이 ensureWeekAlloc 을 타고 그 주를 managed 로
       승격시켜 자동 제안을 영구 대체했고, 최종값도 1.5h 가 아니라 5h 가 됐다. */
    seed({ weekAlloc: WeekAllocSchema.parse({ [WK0]: { phy: [0, 120, 0, 0, 0, 0, 0] } }) });
    renderBoard();
    const el = cell('물리', '월');
    fireEvent.change(el, { target: { value: '' } });
    expect(allocOf()?.['phy']?.[MON_WD]).toBe(120); // 아직 확정하지 않았다
    fireEvent.change(el, { target: { value: '1' } });
    fireEvent.change(el, { target: { value: '' } }); // '1.' 순간
    fireEvent.change(el, { target: { value: '1.5' } });
    fireEvent.blur(el);
    expect(allocOf()?.['phy']?.[MON_WD]).toBe(90);
  });

  it('가용시간이 0이면 그 사실을 배지가 아니라 문장으로 알린다', () => {
    renderBoard({ capWd: [0, 0, 0, 0, 0, 0, 0] });
    expect(screen.getByText(/뼈대\(일과\)에서 수업·수면을 확인/)).toBeInTheDocument();
  });

  it('계획 첫 주에서 "지난 주 복사"는 아무것도 쓰지 않는다(빈 managed 주 생성 금지)', () => {
    renderBoard();
    fireEvent.click(screen.getByRole('button', { name: /지난 주 복사/ }));
    expect(useApp.getState().state.weekAlloc?.[WK0]).toBeUndefined();
    expect(screen.getByText('자동 제안')).toBeInTheDocument(); // 배지가 '내 배분'으로 거짓말하지 않는다
  });

  it('삭제된 과목의 잔존 배분이 있어도 보드는 살아있는 과목만 편집 대상으로 준다', () => {
    seed({ weekAlloc: WeekAllocSchema.parse({ [WK0]: { ghost: [0, 180, 0, 0, 0, 0, 0] } }) });
    renderBoard();
    expect(screen.getAllByRole('spinbutton')).toHaveLength(21); // (물리·영어 것만
    expect(within(subjectRow('물리')).getByText('6h 남음')).toBeInTheDocument(); // 고아 3h 가 섞이지 않았다
  });
});
