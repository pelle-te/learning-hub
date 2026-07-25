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
import { MemoryRouter } from 'react-router-dom';
import CommandPalette from '@/components/CommandPalette';
import { useApp } from '@/store/useApp';
import { usePrefill } from '@/store/prefill';

function open() {
  return render(
    <MemoryRouter>
      <CommandPalette open onOpenChange={() => {}} />
    </MemoryRouter>,
  );
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

test('팔레트: 파서가 토큰을 뽑으면 보충이 아니라 기록 프리필로 간다', () => {
  open();
  fireEvent.change(input(), { target: { value: '내일 전자기학 복습' } });
  modEnter(input());
  expect(useApp.getState().state.backlog || []).toHaveLength(0);
  expect(usePrefill.getState().form).toBe('bl'); // 복습 유형 → '보충 필요' 폼(runQuickCapture 규칙)
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
