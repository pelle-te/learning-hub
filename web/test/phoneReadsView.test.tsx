// @vitest-environment jsdom
/* ============================================================
   phoneReadsView.test.tsx — 폰 읽을거리 화면(설계 §13-8 잔여의 실현).

   ⚠ **§15-4 규약(feature 당 최소 1회 실렌더 확인)의 이 화면 몫이다.** 폰의 이 탭은
   *클라우드에 연결된 상태에서만* 보이므로 트랙 A 가 못 연다 — 스냅샷을 찍을 자리가 없다.
   그래서 두 갈래로 나눠 확인했다:
   ① **토큰/클래스**: 빌드된 `phone-*.css` 에 `text-ink`·`text-txt`·`leading-relaxed` 등이
      실제 값과 함께 방출되는지 확인(존재하지 않는 토큰이 회색으로 렌더되던 사고의 방어).
   ② **구조·행동**: 이 파일. 본문 펼침이 실제로 동작하는지, 빈 상태가 사용자에게
      *무엇을 해야 하는지* 말하는지.

   클래스명은 단언하지 않는다 — C-7 이 픽셀을 바꾸면 그 단언이 먼저 빨간불이 되고,
   그때 사람은 테스트를 지운다(배분 보드 테스트가 같은 이유로 세운 규율).
============================================================ */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const { readMirrored } = vi.hoisted(() => ({ readMirrored: vi.fn() }));
vi.mock('@/lib/artifactMirror', () => ({ readMirrored }));

import ReadsView from '@/phone/ReadsView';

beforeEach(() => {
  cleanup();
  readMirrored.mockReset();
});

const withData = (reads: unknown, markets: unknown = null) =>
  readMirrored.mockImplementation((n: string) => (n === 'reads' ? reads : markets));

describe('빈 상태', () => {
  it('아무것도 없으면 "무엇을 해야 하는지"를 말한다(막다른 골목 금지)', () => {
    withData(null, null);
    render(<ReadsView />);
    expect(screen.getByRole('status')).toHaveTextContent(/PC 에서 수집한 뒤 동기화/);
  });

  it('받아왔는데 항목이 0이면 빈 상태를 구분해서 말한다', () => {
    withData({ articles: [] }, { news: [] });
    render(<ReadsView />);
    expect(screen.getByRole('status')).toHaveTextContent(/항목이 비어 있어요/);
  });
});

describe('읽을거리', () => {
  const article = {
    id: 'a1',
    title: '빔포밍 입문',
    source: 'IEEE',
    published: '2026-07-20',
    words: 700,
    text: '본문 내용',
  };

  it('제목·출처를 보여 주고, 본문은 **접힌 채로** 시작한다(목록이 먼저 읽혀야 한다)', () => {
    withData({ date: '2026-07-20', articles: [article] });
    render(<ReadsView />);
    expect(screen.getByText('빔포밍 입문')).toBeInTheDocument();
    expect(screen.getByText(/IEEE/)).toBeInTheDocument();
    expect(screen.queryByText('본문 내용')).not.toBeInTheDocument();
  });

  it('탭하면 본문이 펼쳐진다 — 이 화면이 존재하는 이유가 본문이다', () => {
    withData({ articles: [article] });
    render(<ReadsView />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText('본문 내용')).toBeInTheDocument();
    expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument();
  });

  it('본문이 없는 항목은 **펼침 버튼을 만들지 않는다**(눌러도 아무 일 없는 버튼 금지)', () => {
    withData({ articles: [{ id: 'x', title: '제목만' }] });
    render(<ReadsView />);
    expect(screen.getByText('제목만')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('제목이 없어도 무너지지 않는다(산출물은 외부 계약이다)', () => {
    withData({ articles: [{ text: '본문' }] });
    render(<ReadsView />);
    expect(screen.getByText('(제목 없음)')).toBeInTheDocument();
  });
});

describe('증시', () => {
  it('news 와 items 두 이름을 모두 받는다(산출물 스키마 드리프트 흡수)', () => {
    withData(null, { items: [{ id: 'n1', title: '금리 동결' }] });
    render(<ReadsView />);
    expect(screen.getByText('금리 동결')).toBeInTheDocument();
  });
});
