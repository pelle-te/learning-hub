// @vitest-environment jsdom
/* ============================================================
   timeboxDnd.test.ts — useTimeboxDnd 드래그 시간박기 프로토콜의 오라클.

   DayPlanner 에서 이 프로토콜을 훅으로 이전(재설계)하면서, MIME 왕복·좌표→분·슬롯 해소·배치/복귀
   콜백 배선을 여기서 잠근다(인라인 시절엔 단위 테스트가 불가능했다 — 이전의 부수 이득).
============================================================ */
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { useTimeboxDnd } from '@/features/schedule/useTimeboxDnd';
import { MIME } from '@/features/schedule/dayPlannerShared';

afterEach(cleanup);

function dataTransfer(init: Record<string, string> = {}) {
  const store: Record<string, string> = { ...init };
  return {
    setData: (k: string, v: string) => {
      store[k] = v;
    },
    getData: (k: string) => store[k] ?? '',
    get types() {
      return Object.keys(store);
    },
    effectAllowed: '',
  };
}
const colEl = { getBoundingClientRect: () => ({ top: 0, height: 1000 }) } as unknown as HTMLDivElement;

function setup(over: Partial<Parameters<typeof useTimeboxDnd>[0]> = {}) {
  const onPlace = vi.fn();
  const onUnplace = vi.fn();
  const onNoRoom = vi.fn();
  const { result } = renderHook(() =>
    useTimeboxDnd({
      colRef: { current: colEl },
      lo: 0,
      span: 1440,
      occupiedExcept: () => [],
      onPlace,
      onUnplace,
      onNoRoom,
      ...over,
    }),
  );
  return { dnd: result.current, onPlace, onUnplace, onNoRoom };
}

test('onDragStart 는 payload 를 MIME 으로 싣는다', () => {
  const { dnd } = setup();
  const dt = dataTransfer();
  dnd.onDragStart('block', 'b1', 60)({ dataTransfer: dt } as never);
  expect(JSON.parse(dt.getData(MIME))).toEqual({ kind: 'block', id: 'b1', dur: 60 });
});

test('onTimelineDrop 은 좌표를 분으로 바꿔 빈 슬롯에 배치한다', () => {
  const { dnd, onPlace } = setup();
  const dt = dataTransfer({ [MIME]: JSON.stringify({ kind: 'block', id: 'b1', dur: 60 }) });
  const preventDefault = vi.fn();
  dnd.onTimelineDrop({ preventDefault, dataTransfer: dt, clientY: 500 } as never); // 화면 절반 → 720분
  expect(preventDefault).toHaveBeenCalled();
  expect(onPlace).toHaveBeenCalledWith('block', 'b1', 720);
});

test('빈 자리가 없으면 onNoRoom 을 부르고 배치하지 않는다', () => {
  // 하루 전체(0~1440)를 점유로 채우면 60분 슬롯이 없다.
  const { dnd, onPlace, onNoRoom } = setup({ occupiedExcept: () => [[0, 1440]] });
  const dt = dataTransfer({ [MIME]: JSON.stringify({ kind: 'block', id: 'b1', dur: 60 }) });
  dnd.onTimelineDrop({ preventDefault: vi.fn(), dataTransfer: dt, clientY: 500 } as never);
  expect(onNoRoom).toHaveBeenCalled();
  expect(onPlace).not.toHaveBeenCalled();
});

test('onTrayDrop 은 미지정으로 복귀시킨다', () => {
  const { dnd, onUnplace } = setup();
  const dt = dataTransfer({ [MIME]: JSON.stringify({ kind: 'task', id: 't9', dur: 30 }) });
  dnd.onTrayDrop({ preventDefault: vi.fn(), dataTransfer: dt } as never);
  expect(onUnplace).toHaveBeenCalledWith('task', 't9');
});

test('깨진/빈 payload 는 조용히 무시한다(배치·복귀 없음)', () => {
  const { dnd, onPlace, onUnplace } = setup();
  const bad = dataTransfer({ [MIME]: '{ not json' });
  dnd.onTimelineDrop({ preventDefault: vi.fn(), dataTransfer: bad, clientY: 500 } as never);
  dnd.onTrayDrop({ preventDefault: vi.fn(), dataTransfer: dataTransfer() } as never);
  expect(onPlace).not.toHaveBeenCalled();
  expect(onUnplace).not.toHaveBeenCalled();
});

test('allowDrop 은 우리 MIME 일 때만 드롭을 허용한다', () => {
  const { dnd } = setup();
  const ours = vi.fn();
  dnd.allowDrop({ preventDefault: ours, dataTransfer: dataTransfer({ [MIME]: 'x' }) } as never);
  expect(ours).toHaveBeenCalled();
  const foreign = vi.fn();
  dnd.allowDrop({ preventDefault: foreign, dataTransfer: dataTransfer({ 'text/plain': 'x' }) } as never);
  expect(foreign).not.toHaveBeenCalled();
});
