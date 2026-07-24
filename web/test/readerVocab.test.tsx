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

/** window.getSelection 을 특정 단어가 선택된 것처럼 흉내낸다. */
function selectWord(word: string): void {
  const range = {
    getBoundingClientRect: () => ({ left: 50, right: 90, top: 20, bottom: 40, width: 40, height: 20 }),
  };
  window.getSelection = () => ({ toString: () => word, rangeCount: 1, getRangeAt: () => range }) as never;
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

test('한국어 지문은 AI 대신 국어사전 링크를 준다', () => {
  const { container } = render(<ReaderVocab lang="ko" text="가나다 라마바" online={true} />);
  selectWord('가나다');
  fireEvent.pointerUp(reader(container));
  expect(screen.getByRole('link', { name: /국어사전/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /뜻 보기/ })).toBeNull();
});
