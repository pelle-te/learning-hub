import { describe, it, expect } from 'vitest';
import { detectConflicts, snapKey, type LocalSnapshot } from '@/lib/cloud/conflicts';
import type { OutboxBatch, OutboxRow } from '@/lib/cloud/contract';

/** 배치 헬퍼 — rows 만 있는 최소 배치(툼스톤은 감지 대상 아님). */
function batchOf(rows: OutboxRow[]): OutboxBatch {
  return { since: 0, upto: 0, rows, tombstones: [] };
}

/** 로컬 스냅샷 헬퍼. */
function snap(entries: { tbl: string; key: string[]; data: unknown[]; updatedAt: number }[]): LocalSnapshot {
  const m: LocalSnapshot = new Map();
  for (const e of entries) m.set(snapKey(e.tbl, e.key), { data: e.data, updatedAt: e.updatedAt });
  return m;
}

describe('detectConflicts', () => {
  it('동시 편집 덮어쓰기를 포착한다(세 조건 모두 만족)', () => {
    // 로컬이 pullMark(100) 이후 편집(local=150), 원격이 더 늦게(200) 다른 값으로 이김.
    const local = snap([{ tbl: 'docs', key: ['note1'], data: ['내 초안'], updatedAt: 150 }]);
    const batch = batchOf([{ tbl: 'docs', key: ['note1'], data: ['다른 기기 초안'], updatedAt: 200 }]);
    const conflicts = detectConflicts(batch, local, /*pullMark*/ 100, /*detectedAt*/ 999);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      tbl: 'docs',
      key: ['note1'],
      localData: ['내 초안'],
      localUpdatedAt: 150,
      remoteData: ['다른 기기 초안'],
      remoteUpdatedAt: 200,
      detectedAt: 999,
    });
  });

  it('원격이 안 이기면 충돌 아님(원격 스탬프 ≤ 로컬)', () => {
    const local = snap([{ tbl: 'docs', key: ['n'], data: ['a'], updatedAt: 200 }]);
    const batch = batchOf([{ tbl: 'docs', key: ['n'], data: ['b'], updatedAt: 150 }]);
    expect(detectConflicts(batch, local, 100, 1)).toHaveLength(0);
  });

  it('로컬이 지난 pull 이후 안 바뀌면 정상 최신화(충돌 아님)', () => {
    // local(80) ≤ pullMark(100) — 로컬은 마지막 수신 이후 손대지 않았다 → 손실 없는 최신화.
    const local = snap([{ tbl: 'docs', key: ['n'], data: ['old'], updatedAt: 80 }]);
    const batch = batchOf([{ tbl: 'docs', key: ['n'], data: ['new'], updatedAt: 200 }]);
    expect(detectConflicts(batch, local, 100, 1)).toHaveLength(0);
  });

  it('같은 값으로 덮이면 손실 0(충돌 아님)', () => {
    const local = snap([{ tbl: 'docs', key: ['n'], data: ['same', 1], updatedAt: 150 }]);
    const batch = batchOf([{ tbl: 'docs', key: ['n'], data: ['same', 1], updatedAt: 200 }]);
    expect(detectConflicts(batch, local, 100, 1)).toHaveLength(0);
  });

  it('로컬에 없던 행(순수 추가)은 충돌 아님', () => {
    const local = snap([]);
    const batch = batchOf([{ tbl: 'docs', key: ['new'], data: ['x'], updatedAt: 200 }]);
    expect(detectConflicts(batch, local, 100, 1)).toHaveLength(0);
  });

  it('에코(같은 스탬프·같은 값)는 충돌 아님', () => {
    const local = snap([{ tbl: 'docs', key: ['n'], data: ['v'], updatedAt: 200 }]);
    const batch = batchOf([{ tbl: 'docs', key: ['n'], data: ['v'], updatedAt: 200 }]);
    expect(detectConflicts(batch, local, 100, 1)).toHaveLength(0);
  });

  it('2열 키(예: completions)도 정확히 매칭한다', () => {
    const local = snap([{ tbl: 'completions', key: ['2026-07-24', 's1|study'], data: [30], updatedAt: 150 }]);
    const batch = batchOf([{ tbl: 'completions', key: ['2026-07-24', 's1|study'], data: [60], updatedAt: 200 }]);
    const conflicts = detectConflicts(batch, local, 100, 1);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.key).toEqual(['2026-07-24', 's1|study']);
  });

  it('여러 행 중 진짜 충돌만 골라낸다', () => {
    const local = snap([
      { tbl: 'docs', key: ['a'], data: ['la'], updatedAt: 150 }, // 충돌
      { tbl: 'docs', key: ['b'], data: ['lb'], updatedAt: 80 }, // pullMark 이하 — 최신화
      { tbl: 'docs', key: ['c'], data: ['lc'], updatedAt: 150 }, // 값 동일 — 손실0
    ]);
    const batch = batchOf([
      { tbl: 'docs', key: ['a'], data: ['ra'], updatedAt: 200 },
      { tbl: 'docs', key: ['b'], data: ['rb'], updatedAt: 200 },
      { tbl: 'docs', key: ['c'], data: ['lc'], updatedAt: 200 },
    ]);
    const conflicts = detectConflicts(batch, local, 100, 1);
    expect(conflicts.map((x) => x.key[0])).toEqual(['a']);
  });
});
