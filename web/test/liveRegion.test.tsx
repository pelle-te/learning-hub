// @vitest-environment jsdom
/* ============================================================
   liveRegion.test.tsx — **공지 리전은 미리 서 있어야 한다**(H22 · 2026-07-30 `/감사 근본`).

   `shell/toast` 는 이 통찰을 이미 정확히 적어 뒀다: _"라이브 리전은 텍스트가 바뀌기 전에 DOM 에
   있어야 한다 — 롤을 내용 노드에 달면 리전과 텍스트가 동시에 삽입돼 AT 에 따라 공지가 통째로
   씹힌다."_ 그런데 그 통찰이 **토스트 밖에서 전량 재발**해 있었다.

   ⚠ 이 파일이 잠그는 것은 문구가 아니라 **구조**다: 조용할 때도 리전이 DOM 에 있는가.
   문구만 검사하면 종전 코드도 통과한다(내용이 있을 때는 롤이 붙어 있었으니까).
============================================================ */
import { afterEach, expect, test } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import SyncLedger from '@/components/SyncLedger';
import OnlineStatus from '@/components/OnlineStatus';
import type { Ledger } from '@/lib/syncLedger';

const led = (p: Partial<Ledger>): Ledger => ({
  online: true,
  pending: null,
  at: null,
  failed: false,
  blocked: null,
  checking: false, // Q-23 — 기본은 "확인 중 아님"(클라우드 미연결이 이 앱의 완결된 상태다)
  staleDays: null, // ⚠ `Ledger` 의 **필수** 필드인데 이 빌더가 안 채우고 있었다(V068).
  ...p,
});

afterEach(cleanup);

test('⚠ 원장이 조용할 때도 리전은 DOM 에 있다 — 없으면 첫 소식이 씹힌다', () => {
  const { rerender } = render(<SyncLedger led={led({})} now={0} />);
  const region = screen.getByRole('status');
  expect(region, '조용할 때 리전이 없으면 그 뒤의 첫 공지가 삽입과 동시에 일어난다').toBeInTheDocument();
  expect(region).toHaveTextContent('');

  // 소식이 생기면 **같은 노드의 내용만** 바뀐다(노드가 새로 생기지 않는다).
  rerender(<SyncLedger led={led({ blocked: 'D1 한도 초과' })} now={0} />);
  expect(screen.getByRole('status')).toHaveTextContent('D1 한도 초과');
  expect(screen.getAllByRole('status'), '리전이 늘어나면 같은 문장이 두 번 읽힌다').toHaveLength(1);
});

test('⚠ 온라인 **복귀**를 말한다 — 종전엔 노드가 사라질 뿐이라 알릴 자리가 없었다', () => {
  const nav = navigator as unknown as { onLine: boolean };
  const orig = nav.onLine;
  Object.defineProperty(nav, 'onLine', { configurable: true, get: () => false });
  render(<OnlineStatus />);
  // 첫 마운트에는 아무 말도 안 한다(페이지 열자마자 "온라인입니다"는 소음이다).
  expect(screen.getByRole('status')).toHaveTextContent('');

  act(() => {
    Object.defineProperty(nav, 'onLine', { configurable: true, get: () => true });
    window.dispatchEvent(new Event('online'));
  });
  expect(screen.getByRole('status'), '복귀를 모르면 외부 연동을 계속 안 쓰게 된다').toHaveTextContent(/돌아왔/);

  act(() => {
    Object.defineProperty(nav, 'onLine', { configurable: true, get: () => false });
    window.dispatchEvent(new Event('offline'));
  });
  expect(screen.getByRole('status')).toHaveTextContent(/오프라인/);
  Object.defineProperty(nav, 'onLine', { configurable: true, get: () => orig });
});

test('보이는 배지와 공지가 **같은 문장**을 쓴다 — 갈리면 화면과 낭독이 다른 말을 한다', () => {
  const nav = navigator as unknown as { onLine: boolean };
  Object.defineProperty(nav, 'onLine', { configurable: true, get: () => true });
  render(<OnlineStatus />);
  act(() => {
    Object.defineProperty(nav, 'onLine', { configurable: true, get: () => false });
    window.dispatchEvent(new Event('offline'));
  });
  const spoken = (screen.getByRole('status').textContent ?? '').trim();
  expect(spoken).not.toBe('');
  // 같은 문장이 화면에도 있다(리전 + 배지 = 2). 문구를 한쪽만 고치면 이 수가 1이 된다.
  expect(screen.getAllByText((_t, el) => (el?.textContent ?? '').trim() === spoken).length).toBeGreaterThan(1);
});
