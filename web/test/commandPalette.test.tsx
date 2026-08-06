// @vitest-environment jsdom
/* ============================================================
   commandPalette.test.tsx — ⌘K 팔레트의 **캡처 계약**(D-2).

   왜 이 테스트가 필요한가: 캡처는 예전에 *조건부*였다 — 결과가 0건일 때만 "보충에 담기" 행이
   떴다. 그래서 친 문장이 내가 공부 중인 무언가를 언급하는 순간(=검색이 히트하는 순간) 담을
   곳이 사라졌고, **그 조건은 화면 어디에도 안 적혀 있었다**. 조건부 캡처는 조용히 실패하는
   부류라(친 문장이 그냥 없어진다) 회귀를 사람 눈에 맡길 수 없다.

   여기서 잠그는 것: ① 검색이 히트해도 ⌘Enter 가 캡처한다 ② 파서가 토큰을 뽑으면 기록
   프리필로, 못 뽑으면 **친 문장 그대로** 보충으로 ③ 맨 Enter 는 여전히 '선택 항목 실행'이다
   (`⌘K → t → Enter` 근육기억 보존이 D-2 의 설계 제약이었다).
============================================================ */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import CommandPalette from '@/app/CommandPalette';
import { useApp } from '@/store/useApp';
import { usePrefill } from '@/store/prefill';

function open() {
  return render(
    <MemoryRouter>
      <CommandPalette open onOpenChange={() => {}} />
    </MemoryRouter>,
  );
}
/** 팔레트 + 라우트 관측기 — "이동했는가"를 단언하려면 목적지가 보여야 한다. */
function openAt() {
  const seen = { path: '' };
  function Probe() {
    seen.path = useLocation().pathname;
    return null;
  }
  render(
    <MemoryRouter>
      <CommandPalette open onOpenChange={() => {}} />
      <Probe />
    </MemoryRouter>,
  );
  return seen;
}
const input = () => screen.getByPlaceholderText(/명령·탭 검색/);
const modEnter = (el: HTMLElement) => fireEvent.keyDown(el, { key: 'Enter', ctrlKey: true });

beforeEach(() => {
  // jsdom 미구현 두 가지 — cmdk 의 List 높이 측정(ResizeObserver)과 선택 항목 스크롤.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = () => {};
  useApp.getState().mutate((s) => {
    s._today = '2026-07-25';
    s.backlog = [];
    // 검색이 **히트하도록** 항목을 심는다 — 옛 억제 조건이 정확히 이때 캡처를 지웠다.
    s.items = [
      {
        id: 'em',
        name: '전자기학',
        mode: 'weekly',
        weeklyHours: 4,
        chapters: [{ id: 'c1', name: '변위전류', hours: 2, done: false }],
      },
    ];
  });
});
afterEach(() => {
  cleanup();
  usePrefill.setState({ form: null, sid: '', ds: '', chapter: '', queue: [] });
  useApp.getState().mutate((s) => {
    s.backlog = [];
    s.items = [];
    delete s._today;
  });
});

test('팔레트: 검색이 히트해도 ⌘Enter 로 캡처된다(캡처는 조건부가 아니다)', () => {
  open();
  const q = '변위전류'; // 내가 공부 중인 챕터 = 통합 검색이 히트하는 문자열
  fireEvent.change(input(), { target: { value: q } });
  // 히트가 실제로 났음을 먼저 확인 — 옛 코드에서 캡처를 지우던 조건이 바로 이것이다.
  expect(screen.getByText(/빠른 검색/)).toBeInTheDocument();

  modEnter(input());

  const bl = useApp.getState().state.backlog || [];
  expect(bl).toHaveLength(1);
  expect(bl[0]!.topic).toBe(q); // 친 글자가 **그대로** 남는다(프리필은 텍스트를 못 나른다)
});

test('팔레트: 아무 토큰도 없는 생 문장도 그대로 담긴다(가장 흔한 캡처)', () => {
  open();
  const q = '적분 순서 바꾸는 조건이 헷갈림';
  fireEvent.change(input(), { target: { value: q } });
  modEnter(input());
  expect((useApp.getState().state.backlog || [])[0]!.topic).toBe(q);
});

/* E2 — 종전엔 이 케이스가 **저장 없이** 기록 탭 프리필로만 갔다. 즉 "입력이 정교할수록
   덜 저장된다"는 역전이 있었고, 이 테스트가 그 역전을 잠그고 있었다. 이제 반대를 잠근다. */
test('팔레트: 파서가 토큰을 뽑아도 **커밋한다** — 정교한 입력이 덜 저장되지 않는다', () => {
  open();
  fireEvent.change(input(), { target: { value: '내일 전자기학 복습' } });
  modEnter(input());
  const bl = useApp.getState().state.backlog || [];
  expect(bl).toHaveLength(1);
  /* 원문이 **어느 칸에든 온전히** 남는다 — 파싱이 틀려도 친 글자는 손상되지 않는다.
     ⚠ 어느 칸인지는 파싱 정도에 달렸다: 토큰을 다 뽑으면 `parseCapture` 계약상 `title` 이
     곧 원문이라(빈 title 은 raw 로 폴백) topic 에 들어가고, 일부만 뽑으면 topic 은 남은
     조각이라 note 가 원문을 든다. 칸을 못박으면 파서 규칙이 바뀔 때 이 테스트가 거짓으로 깨진다. */
  expect([bl[0]!.topic, bl[0]!.note]).toContain('내일 전자기학 복습');
  // 화면을 옮기지 않는다(프리필 요청도 없다) — 캡처는 문맥 이탈이 곧 비용이다.
  expect(usePrefill.getState().form).toBeFalsy();
});

test('팔레트: 파싱된 과목이 레코드에 실린다 — 프리필과 함께 사라지던 것', () => {
  useApp.getState().mutate((st) => {
    st.items = [{ id: 'em', name: '전자기학', source: '직접', mode: 'weekly', weeklyHours: 4, chapters: [] }] as never;
  });
  open();
  fireEvent.change(input(), { target: { value: '내일 전자기학 복습' } });
  modEnter(input());
  const rec = (useApp.getState().state.backlog || [])[0]!;
  expect(rec.sid).toBe('em');
  expect(rec.name).toBe('전자기학');
});

test('팔레트: 빈 입력의 ⌘Enter 는 아무것도 만들지 않는다', () => {
  open();
  modEnter(input());
  expect(useApp.getState().state.backlog || []).toHaveLength(0);
});

test('팔레트: 맨 Enter 는 캡처가 아니다 — 선택 항목 실행 계약을 안 건드린다', () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  open();
  fireEvent.change(input(), { target: { value: '변위전류 유도 못 따라감' } });
  fireEvent.keyDown(input(), { key: 'Enter' });
  expect(useApp.getState().state.backlog || []).toHaveLength(0);
  spy.mockRestore();
});

/* ⚠⚠ **N-1 이 새로 만든 위험을 정면으로 잰다.**

   N-1 은 "지금 무엇 위에 있나"를 알아야 해서 cmdk 의 선택 값을 **제어**로 바꿨다. 그런데
   제어 값은 cmdk 의 *자동 첫 항목 선택*을 덮을 수 있고, 그러면 `⌘K → t → Enter` 가
   **아무 일도 안 하게 된다** — D-2 가 캡처 설계를 통째로 비튼 이유가 바로 그 근육기억이었다.

   위 '맨 Enter' 케이스는 이걸 못 잡는다: "캡처가 아니다"만 단언하므로 **아무것도 안 일어나도
   통과한다.** 부정문만 있는 검사가 회귀를 통과시키는 전형이라, 여기서 긍정문을 건다. */
test('⚠ 맨 Enter 가 첫 항목을 **실행한다** — 제어 선택으로 바꾸며 죽기 쉬운 계약', () => {
  const seen = openAt();
  fireEvent.change(input(), { target: { value: '통계' } });
  fireEvent.keyDown(input(), { key: 'Enter' });
  expect(seen.path, '선택 항목이 없어 Enter 가 무동작이다 — 자동 첫 항목 선택이 죽었다').toBe('/stats');
});

test('N-1: 히트 위에서 → 가 그 객체의 동사 목록을 연다', () => {
  open();
  fireEvent.change(input(), { target: { value: '변위전류' } });
  fireEvent.keyDown(input(), { key: 'ArrowRight' });
  expect(screen.getByText('보충에 담기')).toBeInTheDocument();
  // 동사 단계에선 다른 것을 안 그린다 — 무엇에 대해 말하는지가 흐려지면 안 된다.
  expect(screen.queryByText(/빠른 검색/)).not.toBeInTheDocument();
});

/* 이 케이스가 N-1 의 값 자체다. 종전 경로는 "리뷰 탭으로 가 → 스크롤 → 그 항목을 찾아 →
   버튼"이었고, 그 사이에 화면이 한 번 바뀐다. 그리고 `sid` 단언이 절반인데, 팔레트의 옛
   `act:add-*` 는 `request(form, '')` 로 **과목을 빈 채** 넘겨 키보드 경로가 마우스보다
   못했다 — 객체 위에서 부른 동사는 그 객체를 안다. */
test('N-1: 동사가 실제로 쓴다 — 보충이 과목 id 와 함께 담긴다', () => {
  open();
  fireEvent.change(input(), { target: { value: '변위전류' } });
  fireEvent.keyDown(input(), { key: 'ArrowRight' });
  fireEvent.click(screen.getByText('보충에 담기'));
  const bl = useApp.getState().state.backlog || [];
  expect(bl).toHaveLength(1);
  expect(bl[0]!.sid, '과목을 빈 채로 넘기면 키보드 경로가 마우스보다 못하다').toBe('em');
  expect(bl[0]!.topic).toBe('변위전류');
});

test('N-1: 동사에서 Esc 는 **한 단계만** 접는다 — 친 검색어를 잃지 않는다', () => {
  open();
  fireEvent.change(input(), { target: { value: '변위전류' } });
  fireEvent.keyDown(input(), { key: 'ArrowRight' });
  expect(screen.getByText('보충에 담기')).toBeInTheDocument();
  fireEvent.keyDown(input(), { key: 'Escape' });
  expect(screen.queryByText('보충에 담기')).not.toBeInTheDocument();
  expect(screen.getByText(/빠른 검색/)).toBeInTheDocument(); // 히트 목록으로 되돌아왔다
  expect(input()).toHaveValue('변위전류'); // 검색어는 살아 있다
});

/* ⚠ `→` 는 **캐럿이 끝일 때만** 가로챈다. 안 그러면 검색어 중간을 고치려는 커서 이동이
   화면을 갈아 치운다 — 텍스트 편집을 뺏는 단축키는 그 자체로 결함이다. */
test('N-1: 캐럿이 중간이면 → 는 커서 이동이지 드릴다운이 아니다', () => {
  open();
  const el = input() as HTMLInputElement;
  fireEvent.change(el, { target: { value: '변위전류' } });
  el.setSelectionRange(1, 1);
  fireEvent.keyDown(el, { key: 'ArrowRight' });
  expect(screen.queryByText('보충에 담기')).not.toBeInTheDocument();
});

/* ⚠ 옛 **H14 케이스(진로 지도 시드 지연 적재)** 가 P10 W4 에서 사라졌다(2026-08-07) — `atlas`
   화면·시드가 `survey/` 필러로 갔다. 그 케이스가 잠그던 것은 *"부팅 청크에 시드를 끌어오지
   말 것"* 이고, 그 규칙 자체는 eslint `no-restricted-imports`(H14 블록)와 번들 예산 축 ②가
   계속 진다 — 사라진 것은 지킬 대상이지 규칙이 아니다. */

/* ============================================================
   Q-21 — **객체 우선 팔레트**. 여기서 잠그는 것은 두 가지다:
   ① 시길 파싱이 *첫 글자에서만* 뜻을 갖는다(검색어 중간의 `>` 는 글자다)
   ② 접기와 길내기가 **함께** 있다 — 빈 검색어에서 명령이 접히되, `>` 한 글자로 다시 전부 온다.
      ②가 없으면 이 항목은 기능 삭제다.

   ⚠ 행을 셀 때 `render` 의 `container` 를 쓰지 말 것 — `Command.Dialog` 는 Radix 포털이라
   **body 직속**이다(위 케이스들이 `screen.*` 만 쓰는 이유가 그것이다). `container` 로 세면
   언제나 0 이고, 그러면 "접혔다"는 단언이 **공허하게 통과**한다(실제로 그렇게 한 번 통과했다).
============================================================ */
import { parsePaletteQuery, RECENT_KEEP } from '@/app/CommandPalette';
import { paletteCommands } from '@/shell/palette';

/** 지금 목록에 서 있는 행들의 텍스트. body 직속 포털을 본다(위 주석). */
const rowTexts = (): string[] => [...document.querySelectorAll('[cmdk-item]')].map((n) => n.textContent ?? '');

test('Q-21 시길은 첫 글자일 때만 모드다', () => {
  expect(parsePaletteQuery('>테마')).toEqual({ mode: 'command', q: '테마' });
  expect(parsePaletteQuery('@오늘')).toEqual({ mode: 'nav', q: '오늘' });
  expect(parsePaletteQuery('알고리즘')).toEqual({ mode: 'object', q: '알고리즘' });
  // 중간의 시길은 그냥 글자다 — 챕터 제목에 화살표를 쓰는 사람이 있다.
  expect(parsePaletteQuery('A > B')).toEqual({ mode: 'object', q: 'A > B' });
  // 시길만 친 상태는 빈 검색어와 같다(목록 전체를 봐야 고를 수 있다).
  expect(parsePaletteQuery('>')).toEqual({ mode: 'command', q: '' });
});

test('Q-21 빈 검색어의 기본 화면이 명령 전량을 나열하지 않는다', () => {
  open();
  // 검사가 공허하지 않다는 것부터 — 행이 실제로 있다.
  expect(rowTexts().length).toBeGreaterThan(0);
  expect(rowTexts().length).toBeLessThanOrEqual(RECENT_KEEP);
  expect(paletteCommands().length).toBeGreaterThan(RECENT_KEEP * 3);
});

test('Q-21 `>` 한 글자로 접힌 명령에 다시 닿는다 — 접기만 하면 기능 삭제다', () => {
  open();
  fireEvent.change(input(), { target: { value: '>' } });
  expect(rowTexts().length).toBeGreaterThan(RECENT_KEEP);
});

test('Q-21 `@` 는 이동만 남긴다 — 은퇴한 탭도 이동이다', () => {
  open();
  fireEvent.change(input(), { target: { value: '@' } });
  const labels = rowTexts();
  expect(labels.length).toBeGreaterThan(0);
  // 이동 목록에 액션(내보내기 같은 것)이 섞이지 않는다.
  expect(labels.some((l) => l.includes('내보내기'))).toBe(false);
  // 은퇴한 탭은 `kind:'act'` 인데 여전히 이동이다 — 불변식 ②가 잠근 그 도달성.
  expect(labels.some((l) => l.includes('이동 · '))).toBe(true);
});

test('Q-21 명령 모드에서 검색해도 매칭이 산다 — 시길만 벗겨 cmdk 에 위임한다', () => {
  open();
  fireEvent.change(input(), { target: { value: '>테마' } });
  expect(rowTexts().some((l) => l.includes('테마'))).toBe(true);
});
