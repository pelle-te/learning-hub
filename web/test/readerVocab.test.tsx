// @vitest-environment jsdom
/* ============================================================
   readerVocab.test.tsx — ReaderVocab 어휘 팝오버 상호작용의 오라클.

   ⚠ 선택→팝오버→dismiss·online 게이팅은 시각 스냅샷(트랙 A)이 못 보는 상호작용이다.
   ArticlePractice 에서 ReaderVocab 로 이 상태기계를 이전(재설계)하면서 동작을 여기서 잠근다.
============================================================ */
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const lookupVocab = vi.fn(async () => ({ ok: true, vocab: null }));
vi.mock('@/lib/api', () => ({ lookupVocab: (...a: unknown[]) => lookupVocab(...a) }));

import { ReaderVocab } from '@/features/reads/ReaderVocab';

/** window.getSelection 을 특정 단어가 선택된 것처럼 흉내낸다.
 *  `anchor` 는 "선택이 리더 안에 있는가" 판정용(H12 의 버튼 활성 조건). */
function selectWord(word: string, anchor?: Node): void {
  const range = {
    getBoundingClientRect: () => ({ left: 50, right: 90, top: 20, bottom: 40, width: 40, height: 20 }),
  };
  window.getSelection = () =>
    ({ toString: () => word, rangeCount: 1, getRangeAt: () => range, anchorNode: anchor }) as never;
}

beforeAll(() => {
  // jsdom 미구현 — 리더 호스트 박스 좌표.
  window.HTMLElement.prototype.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 }) as DOMRect;
});
afterEach(() => {
  cleanup();
  lookupVocab.mockClear();
});

const reader = (container: HTMLElement): HTMLElement => container.querySelector('div')!;

test('단어 선택 → 팝오버가 뜨고, Esc 로 닫힌다', () => {
  const { container } = render(<ReaderVocab lang="en" text="hello world foo bar" online={true} />);
  expect(screen.queryByRole('dialog')).toBeNull();
  selectWord('world');
  fireEvent.pointerUp(reader(container));
  const pop = screen.getByRole('dialog', { name: '어휘 뜻' });
  expect(pop).toBeInTheDocument();
  expect(screen.getByText('world')).toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('바깥 클릭(pointerdown)으로 닫힌다', () => {
  const { container } = render(<ReaderVocab lang="en" text="alpha beta" online={true} />);
  selectWord('beta');
  fireEvent.pointerUp(reader(container));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.pointerDown(document.body); // 팝오버 바깥
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('online=true 면 뜻 조회 버튼이 lookupVocab 을 부른다', () => {
  const { container } = render(<ReaderVocab lang="en" text="context text here" online={true} />);
  selectWord('context');
  fireEvent.pointerUp(reader(container));
  fireEvent.click(screen.getByRole('button', { name: /뜻 보기/ }));
  expect(lookupVocab).toHaveBeenCalledWith('context', 'context text here', 'en');
});

test('online=false 면 조회 버튼이 비활성이고 lookupVocab 을 안 부른다', () => {
  const { container } = render(<ReaderVocab lang="en" text="offline word" online={false} />);
  selectWord('word');
  fireEvent.pointerUp(reader(container));
  const btn = screen.getByRole('button', { name: /워크스페이스 미설정/ });
  expect(btn).toBeDisabled();
  fireEvent.click(btn);
  expect(lookupVocab).not.toHaveBeenCalled();
});

/* ⚠ H12(2026-07-26 감사) — 이 기능은 Esc·포커스 복원·role=dialog·레이스 가드까지 다 갖췄는데
   **여는 문이 `onPointerUp` 하나**라 키보드로는 전체가 도달 불가였다(WCAG 2.1.1 A). 안쪽만 보면
   완성돼 있어 리뷰에서 안 띈다 — 그래서 "포인터 없이 열 수 있는가"를 테스트가 붙든다. */
test('포인터 없이도 팝오버를 열 수 있다 — selectionchange + 명시 버튼(H12)', () => {
  const { container } = render(<ReaderVocab lang="en" text="alpha beta" online={true} />);
  const host = reader(container);
  const open = screen.getByRole('button', { name: '선택한 단어 찾기' });
  expect(open).toBeDisabled(); // 선택이 없으면 눌러도 아무 일 없는 버튼을 만들지 않는다

  selectWord('beta', host); // 보조기술·캐럿 브라우징이 만든 선택(포인터 이벤트 없음)
  fireEvent(document, new Event('selectionchange'));
  expect(open).toBeEnabled();

  fireEvent.click(open);
  expect(screen.getByRole('dialog', { name: '어휘 뜻' })).toBeInTheDocument();
});

test('한국어 지문은 AI 대신 국어사전 링크를 준다', () => {
  const { container } = render(<ReaderVocab lang="ko" text="가나다 라마바" online={true} />);
  selectWord('가나다');
  fireEvent.pointerUp(reader(container));
  expect(screen.getByRole('link', { name: /국어사전/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /뜻 보기/ })).toBeNull();
});
