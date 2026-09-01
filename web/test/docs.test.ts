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
   존치 근거·재검토일은 **부모** `../docs/유예_원장.md`(hub 안에는 없다 · V091).
============================================================ */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

/** plugin-sql 을 가짜 DB 로 — 실제 SQL 대신 호출을 기록한다. */
/* ⚠ 모의의 시그니처를 명시한다(V068) — 없으면 `mock.calls` 가 `[][]` 라 인자를 못 읽는다. */
const exec = vi.fn(async (_q: string, _args?: unknown[]): Promise<unknown> => undefined);
const select = vi.fn<(q: string, v?: unknown[]) => Promise<unknown>>(async () => []);
vi.mock('@tauri-apps/plugin-sql', () => ({
  default: { load: async () => ({ execute: exec, select }) },
}));

import {
  DOC_KEYS,
  docDelete,
  docGet,
  docSet,
  exportAllDocs,
  importDocs,
  initDocs,
  unknownDocKeys,
  _resetDocs,
} from '@/lib/db/docs';
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

describe('사용자 저작물 저장소 — 세입자 (다시 0 · I050 이 `ics:feed` 를 걷었다)', () => {
  it('레지스트리가 곧 SQLite·동기화 경로의 도달성이다', () => {
    /* ⚠⚠ 이 배열은 세 번 뒤집혔다: P10 W4 에 **0**(화면 다섯이 `survey/` 로 이사) → N-7·W8 이
       `ics:feed` 를 들임 → **I050 이 그 피드를 라우트째 걷어 다시 0**(2026-08-22 · C042).
       0 의 대가는 `DocKey` 가 `never` 라 이 표가 *동작상* 얇은 localStorage 래퍼가 되는 것이다.
       ⚠ 그래서 이 단언은 **개수가 아니라 상태**를 잰다 — 다음 세입자가 한 줄 들어오는 순간
       빨개지고, 그때 `git show 1c21ad5:web/test/docs.test.ts` 의 셋(동기 읽기 · 1회 이관 ·
       ⌘Z pre-image)을 되살리면 된다. 그 신호가 이 케이스의 존재 이유다. */
    expect([...DOC_KEYS]).toEqual([]);
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

/* ============================================================
   D005(2026-08-21 데이터 축) — **도달 불가 행이 실 DB 에 51,793 B 있었다.**

   `lh:reads`·`artifact:reads`·`artifact:markets` — P10 W4 에서 화면이 `survey/` 로 가며
   은퇴한 세입자들이다. 셋 다 ① `DOC_KEYS` 밖이라 **못 읽고** ② 저장소 전체에
   `DELETE FROM docs` 가 0건이었고 `docs` 는 `TABLES` 밖이라 `diffRows` 도 못 지우고
   ③ 그런데 `OUTBOX_TABLES` 에 들어 있어 **D1 과 폰까지 밀려 있었다.**

   ⚠ 순서가 처방의 일부다: **회수(①) → 삭제 경로(②) → 보고(③)**. 뒤집으면 사용자가 쓴 글이
   회수 불가 상태로 사라진다.
============================================================ */
describe('D005 도달 불가 docs 행 — 회수·삭제·보고', () => {
  /** 은퇴한 세입자 셋이 남아 있는 실 DB 를 흉내 낸다. */
  const 유령 = [
    { key: 'lh:reads', value: '{"글":"내가 쓴 것"}' },
    { key: 'artifact:reads', value: 'x'.repeat(40) },
  ];

  it('① 백업이 미지 키까지 전량 담는다 — 이게 없으면 ②가 사용자 저작물을 지운다', async () => {
    enterShell();
    select.mockResolvedValue(유령);
    expect(await exportAllDocs()).toEqual({
      'lh:reads': '{"글":"내가 쓴 것"}',
      'artifact:reads': 'x'.repeat(40),
    });
  });

  it('③ 미지 키를 보고한다 — 지우지는 않는다', async () => {
    enterShell();
    select.mockResolvedValue(유령);
    await initDocs();
    /* ⚠ **레지스트리가 비어 있는 지금은 표의 모든 행이 미지 키다**(C042 · I050 이 `ics:feed`
       를 걷었다). 종전 이 케이스는 아는 키 하나를 섞어 «아는 키는 빠진다»를 함께 쟀는데,
       섞을 아는 키가 없다 — 없는 세입자를 흉내 내면 무대장치가 되므로(이 파일 머리주석)
       지금 참인 것만 잰다. 다음 세입자가 들어오면 그 필터 축을 여기서 되살려라. */
    expect(
      unknownDocKeys().map((d) => d.key),
      '표에 남은 행이 전부 보고돼야 한다',
    ).toEqual(['lh:reads', 'artifact:reads']);
    expect(
      exec.mock.calls.some((c) => /DELETE/.test(String(c[0]))),
      '앱이 스스로 지우면 안 된다',
    ).toBe(false);
  });

  it('⚠⚠ ② 삭제는 **툼스톤을 먼저** 낸다 — 안 그러면 다른 기기가 되살린다', async () => {
    enterShell();
    select.mockResolvedValue(유령);
    await initDocs();
    exec.mockClear();

    expect(await docDelete('artifact:reads')).toBe(true);
    const sqls = exec.mock.calls.map((c) => String(c[0]));
    const t = sqls.findIndex((q) => /tombstones/.test(q));
    const d = sqls.findIndex((q) => /DELETE FROM docs/.test(q));
    expect(t, '툼스톤을 안 낸다').toBeGreaterThanOrEqual(0);
    expect(d, '행을 안 지운다').toBeGreaterThanOrEqual(0);
    expect(t, '툼스톤이 삭제보다 **먼저** 나가야 한다').toBeLessThan(d);
    expect(unknownDocKeys().map((x) => x.key)).toEqual(['lh:reads']);
  });

  it('⚠ 툼스톤을 못 쓰면 행을 지우지 않는다 — 되살아나는 것보다 안 지워지는 편이 낫다', async () => {
    enterShell();
    select.mockResolvedValue(유령);
    await initDocs();
    exec.mockClear();
    exec.mockImplementation(async (q: string) => {
      if (/tombstones/.test(q)) throw new Error('쓰기 실패');
      return undefined;
    });

    expect(await docDelete('artifact:reads')).toBe(false);
    expect(exec.mock.calls.some((c) => /DELETE FROM docs/.test(String(c[0])))).toBe(false);
    expect(unknownDocKeys().map((x) => x.key)).toContain('artifact:reads');
  });

  it('가져오기는 **아는 키만** 되살린다 — 미지 키를 되쓰면 그 상태를 재생산한다', async () => {
    enterShell();
    select.mockResolvedValue([]);
    await initDocs();
    exec.mockClear();
    /* 레지스트리가 비었으므로 «아는 키»가 0이다 → 백업이 아무리 많은 키를 담고 있어도 표로
       되돌아가는 것은 0 이어야 한다. ⚠ 이 단언이 지키는 것은 개수가 아니라 **방향**이다:
       회수(파일에 담기)는 전량이고 복원은 레지스트리가 아는 것뿐이다. 뒤집히면 D005 가 고친
       도달 불가 행을 백업/복원 왕복이 매번 재생산한다. */
    const n = await importDocs({ 'ics:feed': '{"url":"x"}', 'artifact:markets': '옛것', nope: 1 });
    expect(n).toBe(0);
    expect(unknownDocKeys()).toEqual([]);
    expect(
      exec.mock.calls.filter(([q]) => String(q).includes('INSERT OR REPLACE INTO docs')),
      '미지 키가 표로 되돌아갔다 — 도달 불가 행의 재생산이다',
    ).toHaveLength(0);
  });
});
