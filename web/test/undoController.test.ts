/* ============================================================
   undoController.test.ts — **순서 계약 ①이 ② 안에 있는가**(M-1 · 2026-08-06 감사).

   `store/undoController.ts` 머리주석은 세 줄이 순서 계약의 전부라고 적는다. 그중 ①
   (`flushNow()` + `whenSettled()`)은 _"편집하고 곧바로 ⌘Z 를 누르면 그 편집은 아직 쓰이지도
   않았고 스택에도 없다"_ 를 막는 장치인데, **게이트(`exclusiveMerge`) 밖에 있으면 그 장치가
   정확히 무력해진다**:

       동기화가 진행 중 = 병합 반영 창이 열려 있다
       → `flushNow()` 의 쓰기가 `writeAndVerify` 안에서 `deferred`(= `ok:true` · 400ms 재예약)
       → `whenSettled()` 는 그 체인 링크가 이미 resolve 됐으므로 **곧바로 통과**
       → 확정되지 않은 편집을 두고 되돌리기가 시작된다 → *그 앞의* 편집이 지워진다

   같은 함정을 창 닫기 가드가 이미 겪었고(`db/write.ts` 의 `waitForMergeWindow`), 그 자리엔
   처방이 있는데 여기엔 없었다.

   ⚠ 여기서 재는 것은 **호출 순서**다. 되돌리기의 값 정확성(pre-image·툼스톤 가드·스택 규율)은
   `cloudUndo`·`undoStack` 이 이미 소유한다 — 여기서 또 재면 사본이 된다.
============================================================ */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const undoLastWrite = vi.fn();
const redoLastWrite = vi.fn();
vi.mock('@/lib/cloud/undo', () => ({
  undoLastWrite: (...a: unknown[]) => undoLastWrite(...a),
  redoLastWrite: (...a: unknown[]) => redoLastWrite(...a),
}));

const toast = vi.fn();
vi.mock('@/shell/toast', () => ({ toast: (...a: unknown[]) => toast(...a) }));

/** 확정(①)의 관측점 — `flushNow` 바로 뒤에 오는 짝이라 이것이 곧 ①의 발화 시점이다. */
const whenSettled = vi.fn(async () => undefined);
vi.mock('@/lib/db/write', async (orig) => {
  const m = await orig<typeof import('@/lib/db/write')>();
  return { ...m, whenSettled: () => whenSettled() };
});

import { undoLastEdit } from '@/store/undoController';
import { exclusiveMerge } from '@/store/syncController';

beforeEach(() => {
  undoLastWrite.mockReset().mockResolvedValue({ empty: true, restored: 0, skipped: 0, state: null });
  toast.mockReset();
  whenSettled.mockClear();
});

describe('M-1 — ⌘Z 의 확정(①)은 병합 게이트 **안**에서 일어난다', () => {
  it('게이트가 잡혀 있으면 확정도 되돌리기도 시작하지 않는다 — 밖에 있으면 `deferred` 로 헛확정한다', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    /* 동기화(`runSync`)가 게이트를 쥔 상태를 흉내낸다. 이 구간이 곧 병합 반영 창이다. */
    const busy = exclusiveMerge(() => held);

    const undoing = undoLastEdit();
    await Promise.resolve();
    await Promise.resolve();

    expect(
      whenSettled,
      '게이트 밖에서 확정하면 이 시점에 이미 불렸다(그리고 그 확정은 미뤄진다)',
    ).not.toHaveBeenCalled();
    expect(undoLastWrite).not.toHaveBeenCalled();

    release();
    await busy;
    await undoing;

    expect(whenSettled, '게이트가 풀린 뒤에 확정한다').toHaveBeenCalledTimes(1);
    expect(undoLastWrite).toHaveBeenCalledTimes(1);
  });

  it('확정이 되돌리기보다 **먼저**다 — 순서가 뒤집히면 방금 편집이 스택에 없다', async () => {
    const order: string[] = [];
    whenSettled.mockImplementation(async () => {
      order.push('settle');
    });
    undoLastWrite.mockImplementation(async () => {
      order.push('undo');
      return { empty: true, restored: 0, skipped: 0, state: null };
    });

    await undoLastEdit();
    expect(order).toEqual(['settle', 'undo']);
  });

  it('되돌릴 것이 없으면 그 사실을 말한다 — 조용한 실패는 다음 ⌘Z 를 부른다', async () => {
    await undoLastEdit();
    expect(toast).toHaveBeenCalledWith('되돌릴 편집이 없어요.', 'info');
  });
});
