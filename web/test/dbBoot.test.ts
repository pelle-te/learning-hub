// @vitest-environment jsdom
/* ============================================================
   dbBoot.test.ts — 부팅 읽기 경로 + localStorage → SQLite 1회 이관(2단계-E).

   이 파일이 잠그는 건 성능이 아니라 **데이터 보존**이다. 빈 DB 를 "새 사용자"로 읽으면
   기존 셸 사용자의 정본(아직 localStorage 에 있다)이 통째로 사라진다. 그리고 실패 경로가
   전부 "localStorage 폴백"으로 수렴해야 한다 — 부팅 실패는 이 앱에서 가장 나쁜 결과다.
============================================================ */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock 은 파일 최상단으로 호이스팅되므로 팩토리가 참조할 값도 함께 호이스팅해야 한다.
const { readRows, writeRows, isDbAvailable, setDiffBaseline, selectDb, execDb } = vi.hoisted(() => ({
  readRows: vi.fn(),
  writeRows: vi.fn(),
  isDbAvailable: vi.fn(),
  setDiffBaseline: vi.fn(),
  // D003 — 이관 완료 마커가 `sync_state` 를 쓴다. 목이 없으면 그 경로가 통째로 안 보인다.
  selectDb: vi.fn(async () => null),
  execDb: vi.fn(async () => true),
}));
vi.mock('@/lib/db/sqlite', () => ({
  readRows,
  writeRows,
  isDbAvailable,
  setDiffBaseline,
  selectDb,
  execDb,
  getDb: vi.fn(),
  // 4단계-J — 저작물 저장소(db/docs.ts)가 쓰는 통로이자 D003 의 마커 통로. 모킹에서 빠지면
  // initDocs 가 터지는데, 그 실패가 AppState 프리로드까지 끌고 내려가면 안 된다.
  /* C-6/§13-8 — `docs.ts` 의 분기가 `isTauri()` 에서 **`isSqlitePrimary()`** 로 바뀌었다
     (폰은 Tauri 가 아닌데 SQLite 가 정본이다). 모킹에서 빠지면 `initDocs` 가 TypeError 로
     터지고 그 실패가 AppState 프리로드까지 끌고 내려가 **세 케이스가 한꺼번에** 빨간불이
     된다 — 위 `readMaxStamp` 주석이 기록한 것과 정확히 같은 함정을 두 번째로 밟았다. */
  isSqlitePrimary: vi.fn(() => true),
  // C-1 — 타임스탬프 발급기의 씨앗(DB 의 최대 updated_at). 부팅의 **첫 쓰기보다 앞**에서
  // 불리므로 여기서 빠지면 이관 경로 전체가 조용히 폴백으로 떨어진다(실제로 그렇게 깨졌다).
  readMaxStamp: vi.fn(async () => 0),
}));

/* C2 — 다운그레이드 가드. `isTauri()` 는 진짜 것을 써야 하므로(`asTauri` 가 window 로 조작한다)
   모듈 전체가 아니라 **이 함수 하나만** 갈아 끼운다. */
const { dbVersionGuard } = vi.hoisted(() => ({ dbVersionGuard: vi.fn() }));
vi.mock('@/lib/tauri', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  dbVersionGuard,
}));

import { initAppStore, preloadedState, didMigrate, resetBootState, dbDowngrade } from '@/lib/db/boot';
import { stateToRows } from '@/lib/db/rows';
import { defaults, persist } from '@/lib/persistence';
import { storage } from '@/lib/kv';
import { dbLastOpenedAt, dbStaleSince, setDbStale } from '@/lib/db/fallback';

/** 활동 흔적이 있는 상태 — 어느 경로가 채택됐는지 marker 로 판별. */
const marked = (m: string): AppState => {
  const s = defaults() as AppState & { completions: Record<string, unknown> };
  s.completions[m] = { 'a|new': { done: true, min: 60 } };
  return s;
};
const markerOf = (s: AppState | null): string | undefined =>
  s ? Object.keys((s as unknown as { completions: Record<string, unknown> }).completions)[0] : undefined;

const asTauri = (on: boolean): void => {
  if (on) (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  else delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
};

beforeEach(() => {
  localStorage.clear();
  resetBootState();
  readRows.mockReset();
  /* ⚠ `writeRows` 는 **객체**를 준다(`{ ok, touched }`) — 되읽기 대조가 행축으로 바뀌며
     "이번에 손댄 행"을 함께 돌려주게 됐다(2026-07-29). 목이 boolean 을 주면 호출부의
     `const { ok } = …` 이 undefined 를 받아 **쓰기 성공이 실패로 읽힌다**. */
  writeRows.mockReset().mockResolvedValue({ ok: true, touched: [], preImages: [], stamp: 0 });
  isDbAvailable.mockReset().mockResolvedValue(true);
  selectDb.mockReset().mockResolvedValue(null); // 마커 없음 = 기존 설치
  execDb.mockReset().mockResolvedValue(true);
  dbVersionGuard.mockReset().mockResolvedValue(null); // 기본은 "가드 없음"(구 배포본·브라우저)
  setDbStale(null); // D006 — 모듈 지역 세션 상태라 케이스 간에 샌다
  asTauri(true);
});

/* ⚠ 순서가 계약이다(C2 · 2026-07-26 감사). 가드가 `load()` **뒤에** 오면 이미 늦다 —
   다운그레이드는 `load()` 실패로 나타나고, 그 실패는 "조용한 localStorage 폴백"으로 흘러
   **뜨는데 데이터가 옛날 것**이 된다. 그래서 여기서 잠그는 것은 판정값이 아니라 **순서**다. */
describe('initAppStore — 다운그레이드 가드(C2)', () => {
  it('다운그레이드면 DB 를 열지도 않고 멈춘다(폴백 부팅 금지)', async () => {
    dbVersionGuard.mockResolvedValue({ applied: 9, bundled: 7, downgraded: true, drifted: [] });
    persist(storage, marked('로컬')); // 폴백이 돌면 이게 실려 나온다 — 그러면 안 된다
    await initAppStore();
    expect(isDbAvailable).not.toHaveBeenCalled();
    expect(preloadedState()).toBeNull();
    expect(dbDowngrade()).toMatchObject({ applied: 9, bundled: 7 });
  });

  /* I039(2026-08-22) — **번호는 같은데 내용이 다른 경우.** sqlx 는 그것도 거부하지만 그 실패가
     `load()` Err 로 나타나 **같은 조용한 폴백**에 착지한다. 탐지는 있었고 보고가 없었다. */
  it('⚠ 내용 드리프트도 같은 문을 쓴다 — 번호가 같아도 DB 를 열지 않는다', async () => {
    dbVersionGuard.mockResolvedValue({ applied: 7, bundled: 7, downgraded: false, drifted: [3] });
    persist(storage, marked('로컬'));
    await initAppStore();
    expect(isDbAvailable).not.toHaveBeenCalled();
    expect(preloadedState()).toBeNull();
    expect(dbDowngrade()).toMatchObject({ drifted: [3] });
  });

  it('같은 버전이면 평소대로 부팅한다(가드가 정상 경로를 막지 않는다)', async () => {
    dbVersionGuard.mockResolvedValue({ applied: 7, bundled: 7, downgraded: false, drifted: [] });
    readRows.mockResolvedValue(stateToRows(marked('디비')));
    await initAppStore();
    expect(dbDowngrade()).toBeNull();
    expect(markerOf(preloadedState())).toBe('디비');
  });
});

describe('initAppStore — 부팅 경로 선택', () => {
  it('브라우저(비-Tauri)에선 아무것도 안 한다 — dev·트랙 A 가 계속 살아야 한다', async () => {
    asTauri(false);
    await initAppStore();
    expect(preloadedState()).toBeNull();
    expect(isDbAvailable).not.toHaveBeenCalled();
  });

  it('DB 에 데이터가 있으면 그게 정본이다', async () => {
    readRows.mockResolvedValue(stateToRows(marked('2026-05-01')));
    await initAppStore();
    expect(markerOf(preloadedState())).toBe('2026-05-01');
    expect(didMigrate()).toBe(false);
    expect(writeRows).not.toHaveBeenCalled(); // 이미 있는데 덮어쓰지 않는다
  });
});

describe('⚠ 빈 DB = "새 사용자"가 아니라 "아직 이관 안 됨"', () => {
  it('localStorage 정본을 읽어 SQLite 로 옮긴다(기존 셸 사용자 데이터 보존)', async () => {
    persist(storage, marked('2026-06-02')); // 기존 사용자의 정본
    readRows.mockResolvedValue(null); // 빈 DB
    await initAppStore();

    expect(didMigrate()).toBe(true);
    expect(markerOf(preloadedState())).toBe('2026-06-02');
    // 실제로 SQL 로 옮겼는가 — 옮기지 않으면 다음 부팅에 또 빈 DB 다.
    expect(writeRows).toHaveBeenCalledTimes(1);
    const written = writeRows.mock.calls[0]![0] as ReturnType<typeof stateToRows>;
    expect(written.completions.some((r) => r.ds === '2026-06-02')).toBe(true);
  });

  it('저장된 게 아무것도 없으면 기본값을 옮긴다(진짜 새 사용자)', async () => {
    readRows.mockResolvedValue(null);
    await initAppStore();
    expect(didMigrate()).toBe(true);
    expect(preloadedState()).not.toBeNull();
    expect(markerOf(preloadedState())).toBeUndefined();
  });
});

/* ⚠⚠ **C-1(2026-07-30 `/감사 근본`) — 새 기기의 기본값이 계정을 덮던 경로.**

   무엇을 잠그는가: 이관 쓰기에 넘기는 **스탬프**다. 그 한 인자가 세 경로를 결정한다 —
   아웃박스 수집(`updated_at > watermark`)·서버 LWW(`excluded.updated_at >`)·로컬 병합.
   `defaults()` 를 *지금* 스탬프로 쓰면 첫 클라우드 연결의 push-먼저 순서(`run.ts`)에서
   **시드 기본값이 진짜 데이터를 이긴다.**

   ⚠ 여기서 되읽기·서버를 흉내내지 않는다 — 그 층은 `cloudOutbox`·`server/test/roundtrip` 이
     이미 갖고 있다. 이 파일이 볼 수 있는 **관측 지점은 스탬프 인자 하나**이고, 그것이 정확히
     결함의 원인이었다. 결과까지 흉내내면 검사가 대상보다 커진다. */
describe('⚠⚠ 아직 아무것도 안 한 기기는 자기 기본값을 정본처럼 밀어올리지 않는다(C-1)', () => {
  /** `writeRows(rows, stamp)` 의 두 번째 인자. */
  const stampArg = (): unknown => writeRows.mock.calls[0]?.[1];

  it('pristine(진짜 새 사용자)이면 스탬프가 0 이다 — 어떤 LWW 비교에서도 못 이긴다', async () => {
    readRows.mockResolvedValue(null); // 빈 DB + 빈 localStorage = defaults()
    await initAppStore();

    expect(didMigrate()).toBe(true);
    /* 0 이어야 한다. 함수(청크 스탬프)나 양수면 그 값이 곧 "지금"이고, 그러면 이 기기의
       기본값이 서버의 진짜 데이터를 덮는다. */
    expect(stampArg()).toBe(0);
  });

  it('실제로 쓴 데이터를 이관하면 종전대로 청크 스탬프다 — 그 편집은 정말로 최신이다', async () => {
    persist(storage, marked('2026-06-04')); // 활동 흔적 있음 = pristine 아님
    readRows.mockResolvedValue(null);
    await initAppStore();

    /* 함수여야 한다(`chunkedStamp`). 여기까지 0 으로 만들면 C1(2026-07-24)이 고친 결함의
       반대편으로 넘어간다 — 수개월치 로컬 정본이 **영원히 업로드되지 않는다**. */
    expect(typeof stampArg()).toBe('function');
  });

  it('pristine 판정이 시드 데이터에 속지 않는다 — defaults 는 일과·졸업시드를 이미 갖고 있다', async () => {
    readRows.mockResolvedValue(null);
    await initAppStore();
    const written = writeRows.mock.calls[0]![0] as ReturnType<typeof stateToRows>;
    /* `defaults()` 에는 일과 블록 9개가 들어 있다. 그게 있어도 pristine 이어야 한다 —
       pristine 의 뜻은 "행이 없다"가 아니라 **"사용자가 아직 아무것도 안 했다"**다.
       이 단언이 없으면 defaults 에 시드가 하나 늘어날 때 위 두 케이스가 조용히 무의미해진다. */
    expect(written.settings.length).toBeGreaterThan(0);
    expect(stampArg()).toBe(0);
  });
});

describe('실패는 전부 localStorage 폴백으로 수렴한다', () => {
  it('DB 미가용이면 폴백', async () => {
    isDbAvailable.mockResolvedValue(false);
    await initAppStore();
    expect(preloadedState()).toBeNull();
  });

  it('이관 쓰기가 실패하면 폴백(정본은 아직 localStorage 에 있다)', async () => {
    persist(storage, marked('2026-06-03'));
    readRows.mockResolvedValue(null);
    writeRows.mockResolvedValue({ ok: false, touched: [] });
    await initAppStore();
    expect(preloadedState()).toBeNull(); // 옮기지 못했으니 정본을 옮겼다고 주장하지 않는다
    expect(didMigrate()).toBe(false);
  });

  it('읽기가 throw 해도 앱은 뜬다(부팅 실패가 가장 나쁜 결과)', async () => {
    readRows.mockRejectedValue(new Error('디스크 오류'));
    await expect(initAppStore()).resolves.toBeUndefined();
    expect(preloadedState()).toBeNull();
  });
});

/* ============================================================
   D003(2026-08-21 데이터 축) — **부분 이관이 정본이 되는 경로.**

   데스크톱 `writeRows` 는 트랜잭션이 금지돼 있어(sqlx 풀 · `database is locked`) 순차
   `execute` 다. `TABLES` 순서상 `meta`·`settings` 를 쓴 직후 프로세스가 죽으면 예외가
   없으므로 `ok:false` 도 안 난다 — 그런데 다음 부팅의 `readRows()` 는 그 `settings` 한 행을
   보고 non-null 을 주고, 종전 코드는 그걸 **완료된 이관**으로 읽었다.
   원본은 localStorage 에 그대로 있지만 읽는 경로가 더 이상 없다.
============================================================ */
describe('D003 이관 완료 마커 — 부분 이관과 완료를 가른다', () => {
  it('⚠⚠ 마커가 남아 있으면 부분 DB 를 정본으로 확정하지 않고 이관을 재개한다', async () => {
    // 지난 부팅이 남긴 절반: settings 만 들어간 DB + 지워지지 않은 마커.
    const 부분 = stateToRows(marked('부분DB'));
    readRows.mockResolvedValue(부분);
    selectDb.mockResolvedValue([{ value: 'started' }]);
    persist(storage, marked('로컬정본'));

    await initAppStore();

    expect(didMigrate(), '재개했어야 한다').toBe(true);
    expect(markerOf(preloadedState()), 'localStorage 정본이 이겨야 한다').toBe('로컬정본');
    // 부분 DB 를 기준선으로 세운다 — diff 가 나머지만 채우므로 멱등이다(전량 재기입이 아니다).
    expect(setDiffBaseline).toHaveBeenCalledWith(부분);
  });

  it('마커가 없으면 거동이 종전 그대로다 — 기존 설치에 변화 0', async () => {
    readRows.mockResolvedValue(stateToRows(marked('DB정본')));
    selectDb.mockResolvedValue(null);
    persist(storage, marked('로컬옛것'));

    await initAppStore();

    expect(didMigrate()).toBe(false);
    expect(markerOf(preloadedState())).toBe('DB정본');
  });

  it('이관 성공이 마커를 지운다 — 안 지우면 매 부팅이 재개한다', async () => {
    readRows.mockResolvedValue(null);
    persist(storage, marked('첫이관'));

    await initAppStore();

    expect(didMigrate()).toBe(true);
    expect(execDb.mock.calls.some(([sql]) => String(sql).startsWith('DELETE FROM sync_state'))).toBe(true);
  });

  it('⚠ 쓰기 실패는 마커를 **남긴다** — 다음 부팅이 다시 이관해야 한다', async () => {
    readRows.mockResolvedValue(null);
    writeRows.mockResolvedValue({ ok: false, touched: [], preImages: [], stamp: 0 });
    persist(storage, marked('실패'));

    await initAppStore();

    expect(didMigrate()).toBe(false);
    expect(execDb.mock.calls.some(([sql]) => String(sql).startsWith('DELETE FROM sync_state'))).toBe(false);
  });
});

/* ============================================================
   D006(2026-08-21) — **DB 를 못 열면 낡은 사본을 조용히 정본처럼 보여 준다.**

   ⚠ 여기서 잠그는 것은 "배너가 뜬다"가 아니라 **"전에 성공한 적이 있을 때만 뜬다"** 다.
   그 조건이 없으면 트랙 A 에 오폭한다 — 하네스는 `__TAURI_INTERNALS__` 를 심지만
   `plugin:sql|*` 은 거부하므로 DB 가 영원히 안 열리고, 시각 스냅샷 전량에 경고가 뜬다
   (C1 이 이미 한 번 물린 함정이다).
============================================================ */
describe('D006 낡은 사본 위에 떴다는 사실을 화면이 안다', () => {
  it('한 번도 못 연 기기(트랙 A·첫 실행)는 조용하다 — 오폭 금지', async () => {
    isDbAvailable.mockResolvedValue(false);
    await initAppStore();
    expect(dbStaleSince()).toBeNull();
  });

  it('⚠⚠ 전에 열렸던 기기가 못 열면 말한다', async () => {
    readRows.mockResolvedValue(stateToRows(marked('정상')));
    await initAppStore(); // ① 정상 부팅 — 개방 성공을 기록한다
    expect(dbLastOpenedAt()).not.toBeNull();

    resetBootState();
    setDbStale(null);
    isDbAvailable.mockResolvedValue(false);
    await initAppStore(); // ② 다음 부팅에 DB 가 안 열린다

    expect(preloadedState(), 'localStorage 로 폴백한다(종전과 같다)').toBeNull();
    expect(dbStaleSince(), '그런데 종전엔 아무도 이 사실을 말하지 않았다').toBe(dbLastOpenedAt());
  });

  it('부팅 읽기가 던져도 같은 판정이다 — 채널이 catch 에만 있으면 안 된다', async () => {
    readRows.mockResolvedValue(stateToRows(marked('정상')));
    await initAppStore();
    resetBootState();
    setDbStale(null);
    readRows.mockRejectedValue(new Error('디스크 오류'));
    await initAppStore();
    expect(dbStaleSince()).not.toBeNull();
  });
});
