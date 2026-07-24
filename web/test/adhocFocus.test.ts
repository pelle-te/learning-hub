// @vitest-environment jsdom
/* ============================================================
   adhocFocus.test.ts — 즉석 집중(ID-3) 회귀.
   startFree 가 예약 블록 없는 free 세션을 만들고(완료 토글 대상 없음=유령 완료 방지),
   ⌘K 팔레트가 즉석 집중 프리셋을 노출하는지.
============================================================ */
import { afterEach, describe, expect, it } from 'vitest';
import { useFocus } from '@/store/useFocus';
import { paletteCommands } from '@/shell/palette';

afterEach(() => useFocus.getState().clear());

describe('useFocus.startFree — 즉석 집중', () => {
  it('예약 블록 없는 free 세션을 만든다(ds·sid 비어 완료 토글에서 빠짐)', () => {
    useFocus.getState().startFree(25);
    const s = useFocus.getState().session!;
    expect(s.kind).toBe('free');
    expect(s.ds).toBe('');
    expect(s.sid).toBe('');
    expect(s.total).toBe(25 * 60);
    expect(s.name).toBe('즉석 집중');
    expect(s.blockMin).toBe(0);
  });

  it('임의 길이 수용 · 1분 미만은 1분으로 클램프 · 라벨 커스텀', () => {
    useFocus.getState().startFree(0.4, '정독');
    const s = useFocus.getState().session!;
    expect(s.total).toBe(60); // 0.4분 → 1분
    expect(s.name).toBe('정독');
  });
});

describe('palette — 즉석 집중 프리셋', () => {
  it('⌘K 에 15·25·50분 즉석 집중 명령이 있다', () => {
    const ids = new Set(paletteCommands().map((c) => c.id));
    expect(ids.has('act:focus-free-25')).toBe(true);
    expect(ids.has('act:focus-free-15')).toBe(true);
    expect(ids.has('act:focus-free-50')).toBe(true);
  });
});
