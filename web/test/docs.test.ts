// @vitest-environment jsdom
/* ============================================================
   docs.test.ts — AppState 밖 사용자 저작물의 저장 계약(4단계-J).

   ## ⚠⚠ **이 표의 세입자가 P10 W4 에서 0이 됐다**(2026-08-07)

   다섯이 있었다: `lh:reads`(내 요약·독후감) · `atlas.notes`·`atlas.stars`(진로 지도 메모·관심) ·
   `artifact:reads`·`artifact:markets`(PC→폰 산출물 미러). **다섯 다 그 화면이 `survey/` 필러로
   가면서 사라졌다.** 그래서 이 파일이 잠그던 셋(동기 읽기 · 1회 이관 · ⌘Z pre-image 캡처)은
   지금 **관측할 대상이 없다** — 없는 세입자로 흉내를 내면 그건 테스트가 아니라 무대장치다.

   대신 지금 참인 것을 잠근다: **레지스트리가 비면 모든 키가 localStorage 로 흐르고 SQL 은 한
   줄도 안 나간다.** 이게 중요한 이유는 배관이 *조용히* 죽지 않았음을 여기서 말해 두어야
   하기 때문이다 — 다음 저작물 키가 `DOC_KEYS` 에 한 줄 들어오는 순간 이 단언들이 빨개지고,
   그때 위 셋을 `git show 1c21ad5:web/test/docs.test.ts` 에서 되살리면 된다.
   존치 근거·재검토일은 `docs/유예_원장.md`.
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

import { DOC_KEYS, docGet, docSet, initDocs, _resetDocs } from '@/lib/db/docs';
import { clearUndo, undoDepth } from '@/lib/db/undoStack';

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

describe('사용자 저작물 저장소 — 세입자 (N-7 이 P10 W4 의 0 을 되돌렸다)', () => {
  it('레지스트리가 곧 SQLite·동기화 경로의 도달성이다', () => {
    /* ⚠⚠ 이 배열은 **비어 있었다**(P10 W4 · 화면 다섯이 필러로 이사하며 세입자가 0 이 됐다).
       그 상태의 대가는 `DocKey` 가 `never` 라 이 표가 *동작상* 얇은 localStorage 래퍼였던 것이다.
       N-7(W8)이 첫 세입자를 들였다 — ics 피드는 **서버가 읽을 수 있는 곳**에 있어야 하는데
       `docs` 가 D1 까지 동기화되는 유일한 자유 KV 다. 새 테이블·마이그레이션·인증 경로가 0. */
    expect([...DOC_KEYS]).toEqual(['ics:feed']);
  });

  it('셸에서도 모든 키가 localStorage 로 흐르고 SQL 은 안 나간다', async () => {
    enterShell();
    await initDocs();

    expect(docSet('lh_ui_v1', '{"accent":"lime"}')).toBe(true);
    expect(localStorage.getItem('lh_ui_v1')).toBe('{"accent":"lime"}');
    expect(docGet('lh_ui_v1')).toBe('{"accent":"lime"}');
    expect(
      exec.mock.calls.filter(([q]) => String(q).includes('INSERT OR REPLACE INTO docs')),
      '등록되지 않은 키가 docs 표에 새어 들어갔다',
    ).toHaveLength(0);
  });

  it('부팅 읽기는 안전한 no-op 이다 — 실패해도 throw 하지 않는다', async () => {
    enterShell();
    select.mockRejectedValue(new Error('boom'));
    localStorage.setItem('lh_ui_v1', '{"accent":"cyan"}');

    await expect(initDocs()).resolves.toBeUndefined();

    expect(docGet('lh_ui_v1'), 'DB 실패가 저작물 접근을 막았다').toBe('{"accent":"cyan"}');
  });

  /* ⚠ H3(2026-08-01) 이 고친 것은 침묵이 아니라 **거짓말**이었다: `docSet` 이 pre-image 를 안 잡아
     독후감을 쓴 뒤 ⌘Z 를 누르면 *10분 전 챕터 편집*이 되돌아가는데 토스트는 "직전 편집을
     되돌렸어요"라 말했다. 세입자가 없는 지금 그 캡처를 관측할 수는 없지만, **반대 방향**은
     여전히 관측 가능하고 그게 더 중요하다 — 등록되지 않은 키가 ⌘Z 를 오염시키면 안 된다. */
  it('등록되지 않은 키의 쓰기는 ⌘Z 스택을 오염시키지 않는다', async () => {
    enterShell();
    await initDocs();
    clearUndo();

    docSet('lh_ui_v1', '{"accent":"lime"}', { undo: true });

    expect(undoDepth(), '앱 데이터가 아닌 쓰기가 ⌘Z 에 실렸다').toBe(0);
  });
});

describe('사용자 저작물 저장소 — 브라우저 폴백', () => {
  it('셸이 아니면 localStorage 로 읽고 쓴다', async () => {
    await initDocs(); // no-op

    expect(docSet('lh_ui_v1', '{"a":1}')).toBe(true);
    expect(docGet('lh_ui_v1')).toBe('{"a":1}');
    expect(exec, '브라우저에서 SQL 을 쳤다').not.toHaveBeenCalled();
  });
});
