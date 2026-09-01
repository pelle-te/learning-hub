// @vitest-environment jsdom
/* ============================================================
   recordEditor.test.tsx — useRecordEditor SSOT(인라인 편집 + 삭제).
   Journal 3카드가 공유하는 편집/삭제 기계 — 검증 abort·저장·삭제를 겨눈다
   (이 경로는 카드 복붙 시절엔 테스트가 없었다 → 추출하며 순 이득으로 잠근다).

   ⚠ **"삭제 후 위치(idx) 복원" 케이스가 사라졌다**(근본① · 2026-08-01) — 그 복원 자체가 사라졌다.
   되돌리기는 전역 ⌘Z(행 단위 pre-image)가 덮고, 배열 순서는 저장 층이 `ord` 열로 이미 들고
   있다(`db/rows.ts`). 그 계약을 잠그는 것은 `undoStack`·`cloudUndo` 테스트다.
============================================================ */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRecordEditor } from '@/shell/useRecordEditor';
import { useApp } from '@/store/useApp';
import * as toast from '@/shell/toast';
import type { AppState } from '@/lib/schema';

interface Row {
  id: string;
  topic: string;
}

/** state.backlog를 대역 목록으로 쓰는 최소 opts(순수 배열 뮤테이션). */
function opts() {
  return {
    emptyDraft: { topic: '' },
    toDraft: (r: Row) => ({ topic: r.topic }),
    validate: (d: { topic: string }) => (!d.topic.trim() ? '주제는 비울 수 없어요.' : null),
    save: (st: AppState, id: string, d: { topic: string }) => {
      const arr = (st as unknown as { rows: Row[] }).rows;
      const r = arr.find((x) => x.id === id);
      if (r) r.topic = d.topic.trim();
    },
    remove: (st: AppState, id: string) => {
      const box = st as unknown as { rows: Row[] };
      box.rows = box.rows.filter((x) => x.id !== id);
    },
    deleteLabel: '삭제됨',
    savedToast: '수정됨',
  };
}

const rows = (): Row[] => [
  { id: 'a', topic: 'A' },
  { id: 'b', topic: 'B' },
  { id: 'c', topic: 'C' },
];

beforeEach(() => {
  useApp.setState({ state: { rows: rows() } as unknown as AppState });
  vi.restoreAllMocks();
});
const getRows = () => (useApp.getState().state as unknown as { rows: Row[] }).rows;

describe('useRecordEditor', () => {
  it('startEdit이 editId·draft를 세팅, cancel이 초기화', () => {
    const { result } = renderHook(() => useRecordEditor(opts()));
    act(() => result.current.startEdit({ id: 'b', topic: 'B' }));
    expect(result.current.editId).toBe('b');
    expect(result.current.draft).toEqual({ topic: 'B' });
    act(() => result.current.cancel());
    expect(result.current.editId).toBeNull();
  });

  it('검증 실패 시 저장하지 않고 warn 토스트', () => {
    const spy = vi.spyOn(toast, 'toast').mockImplementation(() => {});
    const { result } = renderHook(() => useRecordEditor(opts()));
    act(() => result.current.startEdit({ id: 'a', topic: 'A' }));
    act(() => result.current.setDraft({ topic: '   ' })); // 공백만
    act(() => result.current.saveEdit());
    expect(spy).toHaveBeenCalledWith('주제는 비울 수 없어요.', 'warn');
    expect(getRows().find((r) => r.id === 'a')!.topic).toBe('A'); // 미변경
    expect(result.current.editId).toBe('a'); // 편집 유지
  });

  it('검증 통과 시 트림 저장 + 편집 종료 + savedToast', () => {
    const spy = vi.spyOn(toast, 'toast').mockImplementation(() => {});
    const { result } = renderHook(() => useRecordEditor(opts()));
    act(() => result.current.startEdit({ id: 'a', topic: 'A' }));
    act(() => result.current.setDraft({ topic: '  새 주제  ' }));
    act(() => result.current.saveEdit());
    expect(getRows().find((r) => r.id === 'a')!.topic).toBe('새 주제');
    expect(result.current.editId).toBeNull();
    expect(spy).toHaveBeenCalledWith('수정됨', 'ok');
  });

  it('del 이 제거하고 ⌘Z 힌트를 단 토스트를 낸다', () => {
    const spy = vi.spyOn(toast, 'toastUndoable').mockImplementation(() => {});
    const { result } = renderHook(() => useRecordEditor(opts()));
    act(() => result.current.del('b')); // 가운데 항목 삭제
    expect(getRows().map((r) => r.id)).toEqual(['a', 'c']);
    expect(spy, '되돌릴 수 있다는 사실을 말하지 않으면 사용자는 그 길을 모른다').toHaveBeenCalledWith('삭제됨');
  });
});
