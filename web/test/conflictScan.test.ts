import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OutboxBatch } from '@/lib/cloud/contract';

// selectDb 를 모킹한다 — scanConflicts 의 IO 글루만 검증(순수 판정은 cloudConflicts.test 가 덮는다).
const { selectDbMock } = vi.hoisted(() => ({ selectDbMock: vi.fn() }));
vi.mock('@/lib/db/sqlite', () => ({ selectDb: selectDbMock }));

const { scanConflicts } = await import('@/lib/cloud/conflictScan');

function batchOf(rows: OutboxBatch['rows']): OutboxBatch {
  return { since: 0, upto: 0, rows, tombstones: [] };
}

describe('scanConflicts', () => {
  beforeEach(() => selectDbMock.mockReset());

  it('빈 배치는 SELECT 없이 즉시 빈 결과', async () => {
    const out = await scanConflicts(batchOf([]), 100);
    expect(out).toEqual([]);
    expect(selectDbMock).not.toHaveBeenCalled();
  });

  it('docs 동시 편집 덮어쓰기를 로컬 SELECT 로 확인해 포착한다', async () => {
    // 로컬 docs 행: value='내 값', updated_at=150 (pullMark 100 이후 편집).
    selectDbMock.mockResolvedValue([{ key: 'note1', value: '내 값', updated_at: 150 }]);
    const batch = batchOf([{ tbl: 'docs', key: ['note1'], data: ['다른 기기 값'], updatedAt: 200 }]);
    const out = await scanConflicts(batch, 100);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      tbl: 'docs',
      key: ['note1'],
      localData: ['내 값'],
      remoteData: ['다른 기기 값'],
    });
    // key 열(docs=key)로 IN 조회했는지 확인.
    expect(selectDbMock).toHaveBeenCalledWith(expect.stringContaining('FROM docs WHERE key IN'), ['note1']);
  });

  it('로컬이 지난 pull 이후 안 바뀌었으면 충돌 아님(정상 최신화)', async () => {
    selectDbMock.mockResolvedValue([{ key: 'note1', value: '오래된 값', updated_at: 80 }]);
    const batch = batchOf([{ tbl: 'docs', key: ['note1'], data: ['새 값'], updatedAt: 200 }]);
    expect(await scanConflicts(batch, 100)).toHaveLength(0);
  });

  it('로컬에 없던 행(SELECT 결과 없음)은 충돌 아님', async () => {
    selectDbMock.mockResolvedValue([]);
    const batch = batchOf([{ tbl: 'docs', key: ['fresh'], data: ['x'], updatedAt: 200 }]);
    expect(await scanConflicts(batch, 100)).toHaveLength(0);
  });

  it('selectDb 가 null 을 줘도 안전하게 빈 결과(관측이 병합을 막지 않는다)', async () => {
    selectDbMock.mockResolvedValue(null);
    const batch = batchOf([{ tbl: 'docs', key: ['note1'], data: ['x'], updatedAt: 200 }]);
    expect(await scanConflicts(batch, 100)).toHaveLength(0);
  });

  it('알 수 없는 테이블은 건너뛴다(SELECT 안 함)', async () => {
    const batch = batchOf([{ tbl: 'nope', key: ['a'], data: ['x'], updatedAt: 200 }]);
    expect(await scanConflicts(batch, 100)).toHaveLength(0);
    expect(selectDbMock).not.toHaveBeenCalled();
  });
});
