// @vitest-environment jsdom
/* ============================================================
   loadStateUndo.test.ts — **정본이 통째로 갈리면 ⌘Z 스택도 무효다**(H-4 · 2026-08-06 감사).

   `undoCapture.test.ts` 는 *어떤 쓰기가 스택에 쌓이는가*(`undo:false` 배선)를 잠근다. 이 파일은
   그 반대 축, **쌓여 있던 것을 언제 버리는가**를 잠근다 — 그 축이 한 곳에서 비어 있었다.

   `applyPull`(pull 병합)은 `clearUndo()` 를 부른다. 근거는 "받아온 행이 로컬 행을 덮으면 쌓아 둔
   pre-image 는 더 이상 어떤 상태의 직전도 아니고, 그대로 다시 쓰면 fresh 스탬프로 LWW 를 이겨
   **서버까지 밀어올린다**"이다. 그런데 `loadState`(가져오기·초기화·복구)는 정본을 **더 크게**
   갈아엎으면서 그 호출이 없었다 → 가져오기 직후 ⌘Z 한 번이 가져오기 전 값을 서버로 되돌렸다.

   ⚠ 옛 `undo:false` 주석이 이 구멍을 가리고 있었다: 그건 *새 항목을 안 쌓는다*는 뜻이지
   *쌓여 있던 것을 버린다*가 아니다. 두 축을 한 문장으로 읽으면 이 결함이 안 보인다.
============================================================ */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/shell/toast', () => ({ toast: vi.fn(), toastUndo: vi.fn(), toastUndoable: vi.fn(), ToastHost: () => null }));
vi.mock('@/lib/idb', () => ({
  idbMirror: vi.fn(),
  idbLoad: vi.fn(async () => null),
  idbGet: vi.fn(async () => null),
  idbPut: vi.fn(async () => {}),
  idbDel: vi.fn(async () => {}),
  idbPreserveBackup: vi.fn(async () => {}),
  IDB_BACKUP_KEY: 'state_backup',
  IDB_BACKUP2_KEY: 'state_backup2',
}));

import { defaults } from '@/lib/persistence';
import { clearUndo, pushUndo, undoDepth } from '@/lib/db/undoStack';
import { useApp } from '@/store/useApp';

/** 평범한 편집이 남긴 항목 하나 — 가져오기 전 상태의 pre-image. */
const seedStack = () => pushUndo([{ table: 'settings', key: ['theme'], vals: ['theme', '"dark"'] }], 100);

beforeEach(() => {
  clearUndo();
});

describe('loadState(가져오기·초기화·복구)는 쌓인 되돌리기를 버린다', () => {
  it('⚠⚠ 통째 교체 뒤 스택이 비어 있다 — 남아 있으면 ⌘Z 가 가져오기를 서버까지 취소한다', () => {
    seedStack();
    expect(undoDepth(), '전제: 편집이 하나 쌓여 있다').toBe(1);

    useApp.getState().loadState(defaults());

    expect(undoDepth(), 'pre-image 가 새 정본의 "직전"이 아니므로 재적용은 원격 소실이다').toBe(0);
  });

  it('평범한 편집(mutate)은 스택을 안 건드린다 — 무효화가 상시 발생하면 ⌘Z 가 늘 빈손이 된다', () => {
    seedStack();
    useApp.getState().mutate((s) => {
      s.moduleLen = 90;
    });
    expect(undoDepth()).toBe(1);
  });
});
