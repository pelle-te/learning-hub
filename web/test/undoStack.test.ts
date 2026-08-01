/* ============================================================
   undoStack.test.ts — 전역 ⌘Z 의 **pre-image 캡처와 예산**(근본① · 2026-08-01).

   두 층을 겨눈다:
   ① **캡처**(`diffRowsDetailed.preImages`) — *무엇을* 담는가. 여기서 틀리면 되돌리기는
      "동작하는데 엉뚱한 것을 되돌린다"가 되고, 그건 화면으로 못 잡는 부류다.
   ② **예산**(`undoStack`) — 상한이 **바이트**인가. 엔트리 수로 걸면 메모리에 상한이 없다는 것이
      착수 전 실측의 결론이었다(행 하나의 크기 편차 670배).

   ⚠ 여기에 **왕복 속성 테스트**가 있다: `쓰기 → pre-image 적용 → 쓰기 전과 같다`. 적용을 SQL 로
   하지 않고 **행 모델**(`toTableData`)에서 하는 것이 의도다 — 실제 적용은 이미 검증된 병합 기계
   (`applyPull`)가 하고(`cloudUndo.test.ts` 가 그 배선을 본다), 여기서 물어야 하는 것은
   "그 기계에 먹일 pre-image 가 옳게 떠졌는가"이기 때문이다.
============================================================ */
import { beforeEach, describe, expect, it } from 'vitest';
import { diffRowsDetailed, stateToRows, toTableData, TABLES } from '@/lib/db/rows';
import {
  clearUndo,
  dropUndo,
  peekUndo,
  preImageBytes,
  pushUndo,
  undoBytes,
  undoDepth,
  UNDO_BYTE_BUDGET,
} from '@/lib/db/undoStack';
import { defaults } from '@/lib/persistence';
import type { PreImageRow } from '@/lib/db/undoStack';
import type { AppState } from '@/lib/types';

const st = (recipe: (s: AppState) => void): AppState => {
  const s = defaults();
  recipe(s);
  return s;
};

/** 행 모델에 pre-image 를 적용한다 — 되돌리기의 **의미**(SQL 이 아니라)를 그대로 옮긴 것. */
function applyPre(model: Record<string, Map<string, unknown[]>>, pre: readonly PreImageRow[]): void {
  for (const p of pre) {
    const spec = TABLES.find((t) => t.name === p.table)!;
    const key = JSON.stringify(p.key.slice(0, spec.keyLen));
    if (p.vals) model[p.table]!.set(key, p.vals);
    else model[p.table]!.delete(key);
  }
}

/** 동기화 테이블만 남긴 비교용 투영 — pre-image 는 그 범위만 담는다(파생·로컬 캐시는 제외). */
function syncOnly(model: Record<string, Map<string, unknown[]>>): Record<string, unknown[][]> {
  const out: Record<string, unknown[][]> = {};
  for (const spec of TABLES) {
    if (!spec.sync) continue;
    out[spec.name] = [...model[spec.name]!.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, v]) => v);
  }
  return out;
}

beforeEach(() => clearUndo());

describe('캡처 — 무엇을 담는가', () => {
  it('기준선이 없으면(첫 쓰기) 아무것도 안 담는다 — 담으면 ⌘Z 한 번이 DB 를 통째로 비운다', () => {
    const { preImages } = diffRowsDetailed(null, stateToRows(defaults()), 1);
    expect(preImages).toEqual([]);
  });

  it('바뀐 행은 **바뀌기 전 값**을 담는다', () => {
    const a = stateToRows(st((s) => void (s.theme = 'dark')));
    const b = stateToRows(st((s) => void (s.theme = 'light')));
    const pre = diffRowsDetailed(a, b, 1).preImages.filter((p) => p.key[0] === 'theme');
    expect(pre).toHaveLength(1);
    expect(pre[0]!.vals, '되돌릴 값이 아니라 새 값을 담으면 되돌리기가 아무 일도 안 한다').toEqual(['theme', '"dark"']);
  });

  it('⚠ 새로 생긴 행은 `vals:null` 이다 — 되돌리기가 **삭제**여야 한다', () => {
    const a = stateToRows(defaults());
    const b = stateToRows(st((s) => void (s.weekAlloc = { '2026-08-03': { sid1: 120 } })));
    const pre = diffRowsDetailed(a, b, 1).preImages.filter((p) => p.table === 'week_alloc');
    expect(pre).toHaveLength(1);
    expect(pre[0]!.vals).toBeNull();
    expect(pre[0]!.key).toEqual(['2026-08-03', 'sid1']);
  });

  it('⚠⚠ **삭제된 행도 담는다** — 착수 계획이 `touched`(upsert 만)로 충분하다고 본 자리다', () => {
    const a = stateToRows(st((s) => void (s.tasks = [{ id: 't1', title: '할 일', done: false } as never])));
    const b = stateToRows(st((s) => void (s.tasks = [])));
    const pre = diffRowsDetailed(a, b, 1).preImages.filter((p) => p.table === 'records');
    expect(pre, '지운 것을 못 살리면 되돌리기가 가장 필요한 경우를 못 덮는다').toHaveLength(1);
    expect(pre[0]!.vals).not.toBeNull();
  });

  it('동기화 대상이 아닌 테이블(meta·runtime_cache)은 안 담는다 — 담아도 병합 기계가 버린다', () => {
    const a = stateToRows(defaults());
    const b = stateToRows(st((s) => void (s._knowState = { x: 1 } as never)));
    const pre = diffRowsDetailed(a, b, 1).preImages;
    expect(pre.some((p) => p.table === 'runtime_cache' || p.table === 'meta')).toBe(false);
  });
});

describe('왕복 속성 — 쓰기 → 되돌리기 → 쓰기 전과 같다', () => {
  const scenarios: [string, (s: AppState) => void][] = [
    ['설정 값 변경', (s) => void (s.theme = 'light')],
    ['배열 추가', (s) => void (s.tasks = [{ id: 'n1', title: '새 할일', done: false } as never])],
    ['주간 배분 1칸', (s) => void (s.weekAlloc = { '2026-08-03': { a: 60 } })],
    ['완료 체크', (s) => void (s.completions = { '2026-08-03': { 'a|study': { min: 30 } as never } })],
    ['요약 추가', (s) => void (s.summaries = { '2026-08-03': [{ id: 's1', name: 'A' } as never] })],
  ];
  const base = st((s) => {
    s.tasks = [{ id: 't0', title: '기존', done: false } as never];
    s.weekAlloc = { '2026-07-27': { a: 30 } };
    s.summaries = { '2026-07-27': [{ id: 's0', name: 'Z' } as never] };
  });

  for (const [name, recipe] of scenarios) {
    it(`${name} → 되돌리면 행이 통째로 원상복구`, () => {
      const before = stateToRows(base);
      const after = stateToRows(
        st((s) => {
          Object.assign(s, structuredClone(base));
          recipe(s);
        }),
      );
      const { preImages } = diffRowsDetailed(before, after, 1);
      const model = toTableData(after);
      applyPre(model, preImages);
      expect(syncOnly(model)).toEqual(syncOnly(toTableData(before)));
    });
  }

  it('되돌리기의 되돌리기(= 두 번 적용)는 원상복구가 아니다 — 스택이 단방향인 이유', () => {
    const before = stateToRows(base);
    const after = stateToRows(st((s) => void Object.assign(s, structuredClone(base), { theme: 'light' })));
    const { preImages } = diffRowsDetailed(before, after, 1);
    const model = toTableData(after);
    applyPre(model, preImages);
    applyPre(model, preImages); // 멱등이다(같은 값을 다시 쓴다) — "다시 실행"이 아니다
    expect(syncOnly(model)).toEqual(syncOnly(toTableData(before)));
  });
});

describe('⚠ 예산은 바이트다 — 엔트리 수가 아니다', () => {
  const row = (id: string, size: number): PreImageRow => ({
    table: 'settings',
    key: [id],
    vals: [id, 'x'.repeat(size)],
  });

  it('빈 pre-image 는 항목을 만들지 않는다 — 만들면 ⌘Z 가 "아무 일도 안 함"이 된다', () => {
    expect(pushUndo([], 1)).toBe(false);
    expect(undoDepth()).toBe(0);
  });

  it('예산 안에서는 전부 쌓인다', () => {
    for (let i = 0; i < 50; i++) pushUndo([row(`k${i}`, 100)], i + 1);
    expect(undoDepth()).toBe(50);
    expect(undoBytes()).toBeLessThanOrEqual(UNDO_BYTE_BUDGET);
  });

  it('⚠⚠ `settings.items` 한 건이 예산을 통째로 먹는 경우 — 오래된 것부터 버린다(17KB × N)', () => {
    const ITEMS = 17_353; // 실측값(2026-07-31) — 한 행 = 슬라이스 전체라 이 크기가 나온다
    for (let i = 0; i < 40; i++) pushUndo([row(`items${i}`, ITEMS)], i + 1);
    expect(undoBytes(), '엔트리 수로 상한을 걸었다면 여기서 694KB 가 남는다').toBeLessThanOrEqual(UNDO_BYTE_BUDGET);
    expect(undoDepth()).toBeLessThan(40);
    // 남은 것은 **최신** 쪽이어야 한다 — 방금 한 편집을 못 되돌리면 되돌리기가 아니다.
    expect(peekUndo()!.stamp).toBe(40);
  });

  it('⚠ 한 항목이 예산보다 커도 **가장 최근 하나는 남긴다**(정확성이 예산보다 우선)', () => {
    pushUndo([row('old', 1000)], 1);
    pushUndo([row('huge', UNDO_BYTE_BUDGET * 2)], 2);
    expect(undoDepth()).toBe(1);
    expect(undoBytes()).toBeGreaterThan(UNDO_BYTE_BUDGET);
    expect(peekUndo()!.stamp).toBe(2);
  });

  it('peek 은 최신부터 · drop 이 회계까지 줄인다 · 비면 null · clear 는 통째로 되돌린다', () => {
    pushUndo([row('a', 10)], 1);
    pushUndo([row('b', 10)], 2);
    const top = peekUndo()!;
    expect(top.stamp).toBe(2);
    expect(peekUndo(), 'peek 은 소비하지 않는다 — 그게 H2 처방의 전부다').toBe(top);
    dropUndo(top);
    expect(peekUndo()!.stamp).toBe(1);
    dropUndo(peekUndo()!);
    expect(peekUndo()).toBeNull();
    pushUndo([row('c', 10)], 3);
    clearUndo();
    expect(undoDepth()).toBe(0);
    expect(undoBytes(), '바이트 회계가 안 따라오면 다음 push 부터 예산이 거짓말을 한다').toBe(0);
  });

  /* ⚠⚠ H2 회귀 — **적용이 실패해도 항목이 남아야 한다.** 종전엔 `cloud/undo.ts` 가 맨 처음
     `popUndo()` 를 불러서, 그 뒤 `applyPull` 이 던지면 항목이 이미 사라진 뒤였다(= ⌘Z 를 누를
     때마다 스택이 한 칸씩 조용히 파괴). 여기서 잠그는 것은 그 순서 계약이다. */
  it('⚠ drop 은 **그 항목이 아직 꼭대기일 때만** 버린다(적용 중 pull 이 오면 남의 것을 안 버린다)', () => {
    pushUndo([row('a', 10)], 1);
    const held = peekUndo()!;
    clearUndo(); // 적용 도중 pull 병합 도착 → 스택 무효화
    pushUndo([row('b', 10)], 2);
    dropUndo(held); // 들고 있던 옛 항목으로 버리려 한다
    expect(undoDepth(), '항등 대조가 없으면 여기서 남의 항목이 사라진다').toBe(1);
    expect(peekUndo()!.stamp).toBe(2);
  });

  it('바이트 계산은 키까지 센다(단일키 테이블의 키가 곧 슬라이스 이름이다)', () => {
    expect(preImageBytes([{ table: 'settings', key: ['ab'], vals: ['ab', 'cde'] }])).toBe(2 + 2 + 3);
    expect(preImageBytes([{ table: 'records', key: ['x', 'y'], vals: null }])).toBe(2);
  });
});
