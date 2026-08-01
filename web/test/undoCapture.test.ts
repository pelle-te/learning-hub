/* ============================================================
   undoCapture.test.ts — **어떤 쓰기가 ⌘Z 스택에 쌓이는가**(근본① · 2026-08-01).

   `undoStack.test.ts` 가 *무엇을 담는가*(pre-image 의 내용)를, 이 파일이 *언제 담는가*(배선)를
   잠근다. 배선이 틀리면 증상이 조용하다 — 되돌리기가 **엉뚱한 시점**으로 가거나(대량 쓰기가
   섞임) **아무 데도 안 간다**(캡처 누락). 둘 다 화면으로는 안 보인다.

   ⚠ 캡처 지점이 `db/write.ts` **한 곳**인 것이 설계다. 병합 쓰기는 `batchDb` 로 가고(내 편집이
   아니다) 최초 이관은 기준선이 없어 pre-image 가 빈 배열이다 — 즉 "안 쌓여야 하는 것"의 대부분이
   구조상 도달조차 하지 않는다. 여기서 보는 것은 **같은 함수를 타면서 갈라지는 하나**다:
   평범한 편집 flush vs `loadState`(가져오기·초기화·복구).
============================================================ */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { writeRows, isDbAvailable, isSqlitePrimary, readTouched, readRows } = vi.hoisted(() => ({
  writeRows: vi.fn(),
  isDbAvailable: vi.fn(),
  isSqlitePrimary: vi.fn(),
  readTouched: vi.fn(),
  readRows: vi.fn(),
}));

vi.mock('@/lib/db/sqlite', () => ({
  writeRows,
  isDbAvailable,
  isSqlitePrimary,
  readTouched,
  readRows,
  touchedKey: (t: string, k: unknown[]) => [t, ...k].join('|'),
}));

import { writeAndVerify, endMergeApply } from '@/lib/db/write';
import { clearUndo, dropUndo, peekUndo, undoDepth } from '@/lib/db/undoStack';
import { defaults } from '@/lib/persistence';

const PRE = [{ table: 'settings', key: ['theme'], vals: ['theme', '"dark"'] }];

beforeEach(() => {
  endMergeApply();
  clearUndo();
  writeRows.mockReset().mockResolvedValue({ ok: true, touched: [], preImages: PRE, stamp: 777 });
  isDbAvailable.mockReset().mockResolvedValue(true);
  isSqlitePrimary.mockReset().mockReturnValue(true);
  readTouched.mockReset().mockResolvedValue(new Map());
  readRows.mockReset().mockResolvedValue(null);
});

describe('평범한 편집은 쌓인다', () => {
  it('성공한 쓰기의 pre-image 와 **그 쓰기가 발급한 스탬프**를 함께 쌓는다', async () => {
    await writeAndVerify(defaults());
    expect(undoDepth()).toBe(1);
    const e = peekUndo()!;
    dropUndo(e);
    expect(e.rows).toEqual(PRE);
    expect(e.stamp, '스탬프가 없으면 툼스톤 가드가 기준을 잃는다').toBe(777);
  });

  it('연속 편집은 각각 한 항목이다(되돌리기 단위 = flush)', async () => {
    await writeAndVerify(defaults());
    await writeAndVerify(defaults());
    expect(undoDepth()).toBe(2);
  });
});

describe('⚠ 쌓이면 안 되는 쓰기', () => {
  it('`undo:false`(loadState — 가져오기·초기화·복구)는 안 쌓는다', async () => {
    await writeAndVerify(defaults(), { undo: false });
    expect(undoDepth(), '통째 교체가 예산을 먹으면 평범한 편집의 되돌리기가 전부 밀려난다').toBe(0);
  });

  it('쓰기 실패는 안 쌓는다 — 부분 적용됐을 수 있어 "직전"이 무엇인지 모른다', async () => {
    writeRows.mockResolvedValue({ ok: false, touched: [], preImages: [], stamp: 0 });
    await writeAndVerify(defaults());
    expect(undoDepth()).toBe(0);
  });

  it('DB 미가용(브라우저·dev·트랙 A)은 안 쌓는다 — 쓴 것이 없으므로 되돌릴 것도 없다', async () => {
    isDbAvailable.mockResolvedValue(false);
    isSqlitePrimary.mockReturnValue(false);
    await writeAndVerify(defaults());
    expect(undoDepth()).toBe(0);
  });

  it('바뀐 행이 없으면(빈 pre-image) 항목을 안 만든다 — ⌘Z 가 "아무 일도 안 함"이 되지 않게', async () => {
    writeRows.mockResolvedValue({ ok: true, touched: [], preImages: [], stamp: 5 });
    await writeAndVerify(defaults());
    expect(undoDepth()).toBe(0);
  });
});
