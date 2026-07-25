// @vitest-environment jsdom
/* ============================================================
   phoneReviewView.test.tsx — 폰 복습 러너의 **스와이프 배선**(UX-B2).

   ⚠ 왜 e2e 가 아닌가: 폰은 정본이 SQLite(OPFS)라 트랙 A 의 localStorage 시드가 안 닿는다.
      `visual.spec.ts` 의 폰 장은 등록만 가로채 앱을 띄우므로 **데이터가 비어** 복습 큐가 0이다.
      즉 카드가 있는 상태는 브라우저에서 만들 수 없다 → 구조·행동은 여기서 잠근다.

   판정 규칙 자체(축 우세·탭 경계·클릭 삼킴)는 `useSwipe.test.tsx` 가 소유한다. 여기서 보는 것은
   **배선**뿐이다: 어느 방향이 어느 동작에 붙었나, 버튼이 살아 있나, 챕터 카드는 탭을 안 먹나.
   클래스·픽셀은 단언하지 않는다(형제 테스트들과 같은 규율).
============================================================ */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const { buildReviewQueue } = vi.hoisted(() => ({ buildReviewQueue: vi.fn() }));
vi.mock('@/lib/reviewQueue', () => ({ buildReviewQueue }));
vi.mock('@/store/selectors', () => ({ useSchedule: () => ({ days: [] }) }));

import ReviewView from '@/phone/ReviewView';

afterEach(() => {
  cleanup();
  buildReviewQueue.mockReset();
});

/** 회상 카드 — 원래 요약을 '펼칠' 수 있는 종류. */
const retrieval = (n: number) => ({
  kind: 'retrieval' as const,
  card: { ageDays: 3, summary: { name: `요약${n}`, s1: `첫째${n}`, s2: '둘째', s3: '셋째' } },
});
/** 챕터 카드 — 펼칠 것이 없는 종류(원래 요약·메모가 없다). */
const chapter = {
  kind: 'chapter' as const,
  ch: { risk: 'overdue', daysSince: 9, subject: '물리', chapter: '역학', color: '#4f8ff0' },
};

/** 한 제스처. 기본은 60px 이상 가로 = 스와이프. */
function swipe(el: HTMLElement, dx: number): void {
  const p = (x: number) => ({ pointerId: 1, pointerType: 'touch', clientX: x, clientY: 200 });
  fireEvent.pointerDown(el, p(200));
  fireEvent.pointerMove(el, p(200 + Math.sign(dx) * 20));
  fireEvent.pointerUp(el, p(200 + dx));
}
function tap(el: HTMLElement): void {
  const p = { pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 200 };
  fireEvent.pointerDown(el, p);
  fireEvent.pointerUp(el, p);
}

const card = (): HTMLElement => screen.getByRole('progressbar').parentElement as HTMLElement;

describe('폰 복습 러너 — 스와이프 배선(UX-B2)', () => {
  it('왼쪽으로 밀면 건너뛴다 — 다음 카드로 가되 인출 수는 안 오른다', () => {
    buildReviewQueue.mockReturnValue([retrieval(1), retrieval(2)]);
    render(<ReviewView />);
    expect(screen.getByText(/"요약1"/)).toBeInTheDocument();

    swipe(card(), -80);

    expect(screen.getByText(/"요약2"/)).toBeInTheDocument();
    swipe(card(), -80); // 큐 소진
    expect(screen.getByText('복습 세션 완료')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument(); // 인출 0개 — 건너뛰기는 성과가 아니다
  });

  it('오른쪽으로 밀면 인출로 센다', () => {
    buildReviewQueue.mockReturnValue([retrieval(1)]);
    render(<ReviewView />);
    swipe(card(), 80);
    expect(screen.getByText('복습 세션 완료')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('탭하면 원래 요약이 펼쳐진다(버튼과 같은 결과)', () => {
    buildReviewQueue.mockReturnValue([retrieval(1)]);
    render(<ReviewView />);
    expect(screen.queryByText('첫째1')).toBeNull();
    tap(card());
    expect(screen.getByText('첫째1')).toBeInTheDocument();
  });

  it('버튼 위 탭은 그 버튼만 누른다(펼치기까지 함께 일어나지 않는다)', () => {
    buildReviewQueue.mockReturnValue([retrieval(1), retrieval(2)]);
    render(<ReviewView />);
    const btn = screen.getByRole('button', { name: '건너뛰기' });
    // ⚠ 브라우저는 손가락을 떼면 pointerup **과** click 을 둘 다 낸다(jsdom 은 안 내주므로 손으로).
    //    그 둘이 각각 '카드 펼치기'와 '건너뛰기'를 일으키면 한 번의 터치로 두 일이 벌어진다.
    tap(btn);
    fireEvent.click(btn);
    expect(screen.getByText(/"요약2"/)).toBeInTheDocument(); // 버튼은 제 일을 했고
    expect(screen.queryByText('첫째1')).toBeNull(); // 펼침은 안 일어났다
  });

  it('버튼은 전부 그대로다 — 스와이프는 그 위의 편의일 뿐(a11y 계약 보존)', () => {
    buildReviewQueue.mockReturnValue([retrieval(1)]);
    render(<ReviewView />);
    for (const name of ['원래 요약', '건너뛰기', '다시 설명했어요']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('챕터 카드는 펼칠 것이 없어 탭이 아무 일도 안 한다', () => {
    buildReviewQueue.mockReturnValue([chapter]);
    render(<ReviewView />);
    tap(card());
    expect(screen.getByText('역학')).toBeInTheDocument(); // 그대로 — 넘어가지도, 펼쳐지지도 않는다
    expect(screen.queryByText('복습 세션 완료')).toBeNull();
  });
});
