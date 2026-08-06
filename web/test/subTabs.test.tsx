// @vitest-environment jsdom
/* ============================================================
   subTabs.test.tsx — 섹션 세그먼트(SubTabs)의 roving tabindex + 방향키 내비(WAI).
   활성 버튼만 Tab 순서(0)·나머지 -1 · ←/→·Home/End로 포커스 이동(활성화는 클릭/Enter가 소유).
============================================================ */
import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import SubTabs from '@/app/SubTabs';

afterEach(cleanup);

function seg(tabKey: string) {
  render(
    <MemoryRouter>
      <SubTabs tabKey={tabKey} />
    </MemoryRouter>,
  );
  return screen.getByRole('group', { name: '페이지 섹션' });
}

test('roving tabindex — 활성 버튼만 0, 나머지 -1', () => {
  /* 앎 호스트 ['stats','journal','review','mastery','ledger'] — `graph` 는 P-19 에서 `items` 의
     뷰로 내려갔고, `journal`·`review` 는 W9 에서 여기로 접혔다(journal 강등의 짝). */
  const g = seg('stats');
  const btns = within(g).getAllByRole('button');
  expect(btns).toHaveLength(5);
  const active = btns.find((b) => b.getAttribute('aria-current') === 'page')!;
  expect(active).toHaveAttribute('tabindex', '0');
  btns.filter((b) => b !== active).forEach((b) => expect(b).toHaveAttribute('tabindex', '-1'));
});

test('방향키 — →는 다음, ←는 이전(순환), Home/End는 양끝으로 포커스 이동', () => {
  const g = seg('stats');
  const btns = within(g).getAllByRole('button'); // [통계, 숙달도 지도, 정본 원장]
  const last = btns.length - 1;
  btns[0]!.focus();

  fireEvent.keyDown(g, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(btns[1]);

  fireEvent.keyDown(g, { key: 'End' });
  expect(document.activeElement).toBe(btns[last]);

  fireEvent.keyDown(g, { key: 'ArrowRight' }); // 끝에서 순환 → 처음
  expect(document.activeElement).toBe(btns[0]);

  fireEvent.keyDown(g, { key: 'ArrowLeft' }); // 처음에서 순환 → 끝
  expect(document.activeElement).toBe(btns[last]);

  fireEvent.keyDown(g, { key: 'Home' });
  expect(document.activeElement).toBe(btns[0]);
});

test('세그먼트가 1개뿐인(또는 미그룹) 탭은 렌더하지 않는다', () => {
  render(
    <MemoryRouter>
      <SubTabs tabKey="today" />
    </MemoryRouter>,
  );
  expect(screen.queryByRole('group', { name: '페이지 섹션' })).toBeNull();
});
