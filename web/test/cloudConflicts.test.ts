import { describe, it, expect } from 'vitest';
import { _resetStamp, nextStamp, seedStamp } from '@/lib/db/stamp';
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

/* ============================================================
   ⚠⚠ 시계 공간 — H31-① (2026-07-30 `/감사 근본`)

   감사는 `detectConflicts` 가 _"기기 간 시계 공간을 섞는다"_ 고 의심했다(`r.updatedAt`·
   `pullMark` 는 남의 시계, `cur.updatedAt` 은 내 시계). **결론은 안전인데 그 근거가 어디에도
   적혀 있지 않았다** — 근거는 `merge.ts` 가 받아온 스탬프로 `seedStamp` 하는 한 줄이고,
   그래서 스탬프가 기기별 벽시계가 아니라 **공유 단조 공간**에 산다.

   여기서 잠그는 것은 판정 함수가 아니라 **그 전제**다: 내 시계가 아무리 느려도 pull 이후의
   로컬 편집은 pullMark 보다 큰 스탬프를 받는가. 이게 깨지면 (2) 조건이 진짜 충돌을 조용히
   건너뛴다 — 이 모듈이 존재하는 이유 그 자체가 무효가 된다.
============================================================ */
describe('⚠ 시계 공간 — 느린 시계에서도 충돌이 안 묻힌다(H31-①)', () => {
  it('받아온 스탬프가 발급기의 하한이 된다 — 내 벽시계가 한참 뒤여도', () => {
    _resetStamp();
    const 남의_스탬프 = Date.now() + 10 * 60_000; // 상대 기기 시계가 10분 빠르다
    seedStamp(남의_스탬프);
    const 내_다음_편집 = nextStamp();
    expect(내_다음_편집, 'pull 이후 로컬 편집이 pullMark 보다 작으면 (2)가 충돌을 건너뛴다').toBeGreaterThan(
      남의_스탬프,
    );
    _resetStamp();
  });

  it('그 전제 위에서 (2) 조건이 진짜 동시 편집을 잡는다', () => {
    _resetStamp();
    const pullMark = Date.now() + 10 * 60_000; // 남의 시계에서 온 워터마크
    seedStamp(pullMark);
    const 내_편집 = nextStamp(); // pull 이후 내가 고쳤다
    const 원격 = 내_편집 + 1; // 그런데 상대가 더 나중 값으로 덮는다

    const local = new Map([[snapKey('settings', ['k']), { data: ['mine'], updatedAt: 내_편집 }]]);
    const out = detectConflicts(
      {
        since: 0,
        upto: 원격,
        rows: [{ tbl: 'settings', key: ['k'], data: ['theirs'], updatedAt: 원격 }],
        tombstones: [],
      },
      local,
      pullMark,
      1,
    );
    expect(out, '느린 시계 때문에 (2)가 걸러 버리면 이 배열이 빈다 = 조용한 손실').toHaveLength(1);
    expect(out[0]!.localData).toEqual(['mine']);
    _resetStamp();
  });
});
