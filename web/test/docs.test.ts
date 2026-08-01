// @vitest-environment jsdom
/* ============================================================
   docs.test.ts — AppState 밖 사용자 저작물의 저장 계약(4단계-J).

   여기서 잠그는 셋은 전부 **조용히 깨지는** 부류다.

   ① **동기 읽기가 유지되는가.** `loadReads()` 는 팔레트·Reads 탭이 **렌더 경로에서** 부른다.
      비동기가 섞이면 첫 렌더가 빈 값을 보고 사용자에겐 "요약이 사라졌다"가 된다.
   ② **1회 이관이 도는가.** 빈 `docs` 를 "새 사용자"로 읽으면 셸로 넘어온 사용자의 저작물이
      localStorage 에 멀쩡히 있는데 화면만 빈다(2단계-E 가 AppState 에서 같은 판단을 했다).
   ③ **브라우저 폴백이 사는가.** `npm run dev`·트랙 A 는 SQLite 가 없다.
============================================================ */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

/** plugin-sql 을 가짜 DB 로 — 실제 SQL 대신 호출을 기록한다. */
const exec = vi.fn(async () => undefined);
const select = vi.fn<(q: string, v?: unknown[]) => Promise<unknown>>(async () => []);
vi.mock('@tauri-apps/plugin-sql', () => ({
  default: { load: async () => ({ execute: exec, select }) },
}));

import { docGet, docSet, initDocs, _resetDocs } from '@/lib/db/docs';
import { loadReads, saveReads } from '@/lib/reads';
import { clearUndo, peekUndo, undoDepth } from '@/lib/db/undoStack';

function enterShell() {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
}

beforeEach(() => {
  localStorage.clear();
  _resetDocs();
  exec.mockClear();
  select.mockClear();
  select.mockResolvedValue([]);
});
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.restoreAllMocks();
});

describe('사용자 저작물 저장소 — 셸', () => {
  it('부팅에 DB 를 읽어 두면 이후 읽기가 동기다', async () => {
    enterShell();
    select.mockResolvedValue([{ key: 'lh:reads', value: '{"work":{},"books":[{"id":"b1"}]}' }]);

    await initDocs();

    // ⚠ await 없이 값이 나와야 한다 — 이게 계약의 본체다.
    const r = loadReads();
    expect(r.books).toHaveLength(1);
    expect(docGet('lh:reads')).toContain('b1');
  });

  it('빈 DB 면 localStorage 에서 1회 이관한다', async () => {
    enterShell();
    localStorage.setItem('lh:reads', '{"work":{},"books":[{"id":"old"}]}');
    localStorage.setItem('atlas.notes', '{"n":1}');
    select.mockResolvedValue([]); // 아직 안 옮겨진 상태

    await initDocs();

    expect(loadReads().books, '이관을 안 해 저작물이 사라진 것처럼 보인다').toHaveLength(1);
    expect(docGet('atlas.notes')).toBe('{"n":1}');
    /* 메모리만 채우고 끝나면 다음 부팅에 또 이관한다 → DB 에도 써야 한다.
       ⚠ DB 쓰기는 **의도적으로 비동기**다(메모리 즉시 + 디스크는 흘려보냄) → waitFor 로 기다린다.
          동기 시점에 검사하면 설계가 맞는데도 빨간불이 난다. */
    await vi.waitFor(() => {
      const wrote = exec.mock.calls.filter(([q]) => String(q).includes('INSERT OR REPLACE INTO docs'));
      expect(wrote.length).toBe(2);
    });
  });

  it('저장은 메모리에 즉시 반영되고 DB 로도 나간다', async () => {
    enterShell();
    await initDocs();

    const ok = saveReads({ work: {}, books: [{ id: 'new' } as never] });

    expect(ok).toBe(true);
    // 동기 재읽기가 방금 쓴 값을 봐야 한다(비동기 DB 왕복을 기다리지 않고).
    expect(loadReads().books[0]?.id).toBe('new');
    // 디스크 쓰기는 비동기 — 메모리 반영(위 줄)과 달리 기다려야 한다.
    await vi.waitFor(() =>
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE INTO docs'),
        expect.arrayContaining(['lh:reads']),
      ),
    );
  });

  it('DB 를 못 열면 localStorage 경로가 살아 있다', async () => {
    enterShell();
    select.mockRejectedValue(new Error('boom'));
    localStorage.setItem('lh:reads', '{"work":{},"books":[{"id":"fallback"}]}');

    await initDocs(); // 실패해도 throw 하지 않는다

    expect(loadReads().books[0]?.id, 'DB 실패가 저작물 접근을 막았다').toBe('fallback');
  });

  it('옮기지 않은 키는 localStorage 로 그대로 흐른다', async () => {
    enterShell();
    await initDocs();
    // lh_ui_v1(테마·액센트)은 기기별 설정이라 일부러 안 옮겼다.
    docSet('lh_ui_v1', '{"accent":"lime"}');
    expect(localStorage.getItem('lh_ui_v1')).toBe('{"accent":"lime"}');
    expect(exec).not.toHaveBeenCalledWith(expect.stringContaining('docs'), expect.arrayContaining(['lh_ui_v1']));
  });
});

/* ============================================================
   H3 — **저작물 쓰기도 ⌘Z 스택에 든다**(2026-08-01 `/감사 근본` · 사용자 승인).

   고친 것은 침묵이 아니라 **거짓말**이다: `docSet` 이 pre-image 를 안 잡아서, 독후감을 쓴 뒤
   ⌘Z 를 누르면 *10분 전 챕터 편집*이 되돌아가는데 토스트는 "직전 편집을 되돌렸어요"라 말했다.
   그래서 여기서 잠그는 것은 "쌓이는가" 하나가 아니라 **누가 쌓고 누가 안 쌓는가** 둘 다다 —
   기계가 낸 쓰기(미러·가져오기·복구)가 섞이면 같은 형태의 거짓말이 되돌아온다.
============================================================ */
describe('저작물 쓰기의 ⌘Z 캡처 (H3)', () => {
  it('독후감 저장은 **직전 값**을 pre-image 로 쌓는다', async () => {
    enterShell();
    select.mockResolvedValue([{ key: 'lh:reads', value: '{"work":{},"books":[{"id":"old"}]}' }]);
    await initDocs();
    clearUndo();

    saveReads({ work: {}, books: [{ id: 'new' } as never] });

    await vi.waitFor(() => expect(undoDepth()).toBe(1));
    const e = peekUndo()!;
    expect(e.rows).toHaveLength(1);
    expect(e.rows[0]!.table, 'docs 는 OUTBOX_TABLES 에 DOCS_SPEC 으로 있다').toBe('docs');
    expect(e.rows[0]!.key).toEqual(['lh:reads']);
    // vals = [key, 직전 value] — `cloud/undo.ts` 가 keyLen 만큼 slice 해 data 로 쓴다.
    expect(e.rows[0]!.vals?.[1], '되돌리면 이 값이 다시 쓰여야 한다').toContain('old');
    expect(e.stamp, '스탬프가 없으면 툼스톤 가드가 기준을 잃는다').toBeGreaterThan(0);
  });

  it('처음 쓰는 키는 `vals: null` — 되돌리기가 *삭제*여야 한다', async () => {
    enterShell();
    await initDocs(); // 빈 DB · localStorage 도 비어 있다
    clearUndo();

    saveReads({ work: {}, books: [{ id: 'first' } as never] });

    await vi.waitFor(() => expect(undoDepth()).toBe(1));
    expect(peekUndo()!.rows[0]!.vals, 'null 이 아니면 "추가"를 영원히 못 되돌린다').toBeNull();
  });

  it('⚠ 기계가 낸 쓰기(`undo` 미지정)는 **안 쌓는다** — 미러·가져오기·IDB 복구', async () => {
    enterShell();
    await initDocs();
    clearUndo();

    docSet('atlas.notes', '{"n":1}'); // 옵션 없음 = 기본 비캡처
    docSet('artifact:reads', '{"a":1}');

    await vi.waitFor(() =>
      expect(exec.mock.calls.filter(([q]) => String(q).includes('INSERT OR REPLACE INTO docs')).length).toBe(2),
    );
    expect(undoDepth(), '내 편집이 아닌 쓰기가 ⌘Z 를 오염시키면 H3 이 되돌아온다').toBe(0);
  });

  it('무변경 저장은 안 쌓는다 — ⌘Z 한 번이 "아무 일도 안 함"이 되지 않게', async () => {
    enterShell();
    const same = '{"work":{},"books":[]}';
    select.mockResolvedValue([{ key: 'lh:reads', value: same }]);
    await initDocs();
    clearUndo();

    saveReads({ work: {}, books: [] });

    // 쓰기 자체는 나가되(스탬프 갱신) 스택은 안 는다.
    await vi.waitFor(() =>
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE INTO docs'),
        expect.arrayContaining(['lh:reads']),
      ),
    );
    expect(undoDepth()).toBe(0);
  });
});

describe('사용자 저작물 저장소 — 브라우저 폴백', () => {
  it('셸이 아니면 localStorage 로 읽고 쓴다', async () => {
    await initDocs(); // no-op

    expect(saveReads({ work: {}, books: [{ id: 'web' } as never] })).toBe(true);
    expect(localStorage.getItem('lh:reads')).toContain('web');
    expect(loadReads().books[0]?.id).toBe('web');
    expect(exec, '브라우저에서 SQL 을 쳤다').not.toHaveBeenCalled();
  });
});
