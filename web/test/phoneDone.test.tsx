// @vitest-environment jsdom
/* ============================================================
   phoneDone.test.tsx — 폰에서 **학습 블록을 끝냈다고 말할 수 있는가**(B1).

   ## 이 파일이 잠그는 결함

   `src/phone/**` 에 `toggleDone` 호출부가 **0건**이었다. 폰 홈은 "새 학습 3블록 · 4.5h" 를
   보여 주면서 그중 몇 개를 했는지는 받지 않았고(`isDone` 을 `pickFocus` 입력으로 읽기만 하고
   버렸다), `DayView` 는 일정(읽기 전용)과 할 일만 그렸다.

   그게 왜 결함인가: 이 앱의 루프 — 스트릭 · 완료율 · `scheduler/priority.adherenceFactor`
   (계획 용량을 0.5~1.0배 **실제로 깎는다**) — 는 전부 완료 체크가 먹인다. 폰의 전제가
   "책상 밖"인데 책상 밖에서 한 공부는 PC 앞에 앉을 때까지 기록될 수 없었고, 그때쯤엔
   무엇을 했는지가 기억 재구성이 된다.

   ⚠ 왜 e2e 가 아닌가: 폰은 미연결이면 **등록 화면**에서 멈춘다(`phone.spec.ts` 가 그걸
      단언한다) → 브라우저에서 이 화면에 닿을 수 없다. 형제 `phoneReviewView.test.tsx` 와
      같은 판단이다.
   ⚠ 클래스·픽셀은 단언하지 않는다 — 보는 것은 **배선**이다(체크가 `toggleDone` 을 부르는가,
      인자가 맞는가, 이미 끝낸 것은 켜져 보이는가).
============================================================ */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const DS = '2026-07-29';
const 블록 = { sid: 'i1', type: 'new' as const, name: '전자기학', min: 90, chapters: ['3장'] };

/* 스케줄은 순수 함수라 진짜를 돌릴 수도 있지만, 그러려면 과목·일과·가용을 다 시드해야 하고
   그건 이 테스트가 보려는 것(배선)과 무관한 표면이다. 하루치 산출물만 고정해 준다. */
vi.mock('@/store/selectors', () => ({
  useSchedule: () => ({ days: [{ ds: DS, items: [블록] }], itemStat: {} }),
}));

const toggleDone = vi.fn();
const done = vi.fn(() => false);
vi.mock('@/lib/persistence', async (orig) => ({
  ...(await orig<typeof import('@/lib/persistence')>()),
  isDone: () => done(),
}));

import { useApp } from '@/store/useApp';
import DayView from '@/phone/DayView';

afterEach(() => {
  cleanup();
  toggleDone.mockReset();
  done.mockReturnValue(false);
});

/** 스토어의 `toggleDone` 만 갈아 끼운다 — 나머지 상태는 진짜다. */
function 스토어준비(): void {
  const s = useApp.getState() as unknown as { toggleDone: typeof toggleDone };
  s.toggleDone = toggleDone;
}

describe('폰 DayView — 학습 블록 완료', () => {
  it('그날 학습 블록이 체크 가능한 형태로 뜬다', () => {
    스토어준비();
    render(<DayView ds={DS} />);
    expect(screen.getByText('학습')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /전자기학/ })).toBeInTheDocument();
  });

  it('체크하면 `toggleDone` 이 **계획 분과 함께** 불린다 — 인자가 틀리면 완료 키가 어긋난다', () => {
    스토어준비();
    render(<DayView ds={DS} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /전자기학/ }));
    // (ds, sid, type, plannedMin, on) — 완료 키는 `sid|type` 이라 앞의 셋이 곧 정체성이다.
    expect(toggleDone).toHaveBeenCalledWith(DS, 'i1', 'new', 90, true);
  });

  it('이미 끝낸 블록은 켜져 있고, 누르면 **끄는** 방향으로 부른다', () => {
    done.mockReturnValue(true);
    스토어준비();
    render(<DayView ds={DS} />);
    const box = screen.getByRole('checkbox', { name: /전자기학/ });
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(toggleDone).toHaveBeenCalledWith(DS, 'i1', 'new', 90, false);
  });
});
