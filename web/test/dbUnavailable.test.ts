// @vitest-environment jsdom
/* ============================================================
   dbUnavailable.test.ts — **정본이 죽었을 때**의 계약(C1 · 2026-07-26 감사 Critical).

   잠그는 것은 성능도 SQL 도 아니고 **침묵의 부재**다. 결함의 형태:
   `getDb()` 가 null 을 주는 두 사건("브라우저라 SQL 을 안 쓴다" · "정본 연결이 실패했다")이
   한 값(`skipped`)으로 뭉쳐, 저장 실패가 성공처럼 보고되고 `useApp.flush` 의 `return` 때문에
   localStorage 폴백도 안 탔다 → 그 세션 편집이 메모리에만 살고 재시작하면 사라졌다.

   그래서 여기선 **모킹을 얕게** 한다: 진짜 `sqlite.ts`·`write.ts`·`useApp` 을 그대로 태우고
   plugin-sql 의 `load()` 만 실패시킨다. 판정 함수 하나를 단위로 검사하면 "값을 옳게 계산한다"만
   증명되고, 정작 깨져 있던 **연결(판정→폴백→마커→배너 신호)** 은 안 보이기 때문이다.
============================================================ */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** 실행 경로 스위치 — 테스트마다 "셸인가"를 뒤집는다. */
const tauri = { on: false };
/** plugin-sql `load()` — 기본은 **실패**(이 파일의 주제). 회복 케이스에서만 갈아 끼운다. */
const load = vi.fn(async (): Promise<unknown> => {
  throw new Error('연결 실패(테스트)');
});

vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load } }));
vi.mock('@/lib/tauri', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  isTauri: () => tauri.on,
  dbUrl: async () => 'sqlite:test.db',
}));
vi.mock('@/lib/idb', () => ({ idbMirror: vi.fn(), idbLoad: vi.fn(async () => null) }));

import { writeAndVerify } from '@/lib/db/write';
import { dbFallbackAt, isSaveFallback, onSaveFallback } from '@/lib/db/fallback';
import { KEY, defaults } from '@/lib/persistence';
import { useApp } from '@/store/useApp';

const sleep = (ms: number): Promise<unknown> => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  localStorage.clear();
});

describe('정본 가용성 — `skipped`(정상)와 `unavailable`(유실 직전)을 가른다', () => {
  it('브라우저(SQLite 가 정본이 아님)에선 skipped — 이 폴백은 dev·트랙 A 의 생명줄이다', async () => {
    tauri.on = false;
    const r = await writeAndVerify(defaults());
    expect(r).toMatchObject({ ok: true, skipped: true, unavailable: false });
  });

  it('셸인데 연결 실패면 unavailable + ok:false — 여기가 skipped 로 보고되던 자리다', async () => {
    tauri.on = true;
    const r = await writeAndVerify(defaults());
    expect(r).toMatchObject({ ok: false, skipped: false, unavailable: true });
  });
});

describe('useApp.flush — 정본이 죽으면 임시 저장으로 떨어진다(무음 유실 차단)', () => {
  it('편집이 localStorage 임시 사본 + 회수 마커로 남고, 배너 신호가 켜진다', async () => {
    tauri.on = true;
    localStorage.clear();
    const seen: boolean[] = [];
    const un = onSaveFallback(() => seen.push(isSaveFallback()));
    useApp.getState().mutate((s) => {
      s.moduleLen = 77;
    });
    await sleep(600); // 디바운스(400ms) + 비동기 쓰기 판정
    un();
    /* ⚠ 신호는 **편집이 실제로 저장에 실패했을 때** 켜진다(연결 실패가 아니라). 그 차이를
       트랙 A 가 드러냈다 — 스텁이 Tauri 를 흉내내지만 SQL 을 거부해, 연결 기준이면 시각
       스냅샷 전량에 경고 배너가 떴다(`db/fallback.ts` 머리주석). */
    expect(seen).toContain(true);
    expect(isSaveFallback()).toBe(true);
    const raw = localStorage.getItem(KEY);
    expect(raw).not.toBeNull();
    expect((JSON.parse(raw!) as { moduleLen: number }).moduleLen).toBe(77);
    // 마커가 있어야 **다음 부팅에 DB 가 회복돼도** 그 편집의 존재를 사용자에게 말할 수 있다
    expect(dbFallbackAt()).toBeGreaterThan(0);
  });
});

/* ⚠ 이 describe 는 **맨 뒤여야 한다**. `getDb()` 의 핸들 캐시(`_db`)는 성공하면 남고 실패하면
   비워진다 — 회복을 앞에서 돌리면 그 뒤 케이스들이 살아 있는 DB 를 물려받아, "죽었을 때"를
   검사한다고 적어 놓고 실제로는 정상 경로를 검사하게 된다(정확히 이 파일이 잠그려는 부류의 침묵). */
describe('회복 — 한 번의 실패가 영구 표시가 되지 않는다', () => {
  it('저장이 다시 성공하면 배너 신호가 내려간다', async () => {
    tauri.on = true;
    const exec = vi.fn(async () => undefined);
    const select = vi.fn(async () => [] as unknown[]);
    load.mockImplementation(async () => ({ execute: exec, select }));

    useApp.getState().mutate((s) => {
      s.moduleLen = 78;
    });
    await sleep(600);

    expect(isSaveFallback()).toBe(false);
    expect(exec).toHaveBeenCalled(); // 실제로 SQL 이 돌았다(= 회복 판정이 관측에 근거한다)
  });
});
