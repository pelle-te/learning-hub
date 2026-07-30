/* ============================================================
   dbRows.test.ts — AppState ↔ 행 표현의 왕복 동형성(2단계-B).

   이 파일이 2단계의 **안전벨트**다. 저장소를 localStorage JSON 블롭에서 SQLite 행으로
   바꿀 때 진짜 위험은 SQL 문법이 아니라 **왕복에서 필드가 조용히 사라지는 것**이고,
   그건 앱을 띄워도 한참 뒤에야(그 탭을 열어야) 드러난다.

   매퍼를 IO 에서 분리한 이유가 여기 있다 — Tauri 런타임 없이 대용량 표본까지 전량 검증한다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { stateToRows, rowsToState, ARRAY_SLICES, diffRows } from '@/lib/db/rows';
import { defaults, exportSnapshot, RUNTIME_CACHE_KEYS, EPHEMERAL_ONLY_KEYS } from '@/lib/persistence';
import { chunkedStamp, _resetStamp } from '@/lib/db/stamp';
import { MAX_BATCH_ITEMS } from '@/lib/cloud/contract';
import type { AppState } from '@/lib/types';

const roundTrip = (s: AppState): AppState => rowsToState(stateToRows(s));

describe('왕복 동형 — 기본 상태', () => {
  it('defaults()가 바이트 동일하게 돌아온다', () => {
    const d = defaults();
    expect(roundTrip(d)).toEqual(d);
  });

  it('⚠ 빈 슬라이스는 "없음"이 아니라 "비어 있음"으로 돌아온다', () => {
    const d = defaults();
    const back = roundTrip(d);
    // defaults()는 completions·summaries·cbms…를 빈 채로 **정의**한다. 행이 0개라고
    // undefined 로 되살리면 하류가 `s.cbms.length`에서 터진다.
    expect(back.completions).toEqual({});
    expect(back.cbms).toEqual([]);
    expect(back.summaries).toEqual({});
    expect('completions' in back).toBe(true);
  });

  it('진짜 옵셔널 슬라이스는 없으면 없는 채로 돌아온다(빈 배열로 발명하지 않는다)', () => {
    const d = defaults();
    expect(d.tasks).toBeUndefined(); // defaults()가 안 만드는 옵셔널
    const back = roundTrip(d);
    expect('tasks' in back).toBe(false);
    expect('dayPlans' in back).toBe(false);
  });
});

describe('왕복 동형 — 슬라이스별', () => {
  const rich = (): AppState => {
    const s = defaults() as AppState & Record<string, unknown>;
    s.completions = {
      '2026-03-01': { 'a|new': { done: true, min: 90, doneDs: '2026-03-02' }, 'b|rev': { done: false, min: 0 } },
      '2026-03-02': { 'a|blank': { done: true, min: 30 } },
    };
    s.dayPlans = { '2026-03-01': { mode: 'manual', blocks: [{ id: 'x', type: 'new', sid: 'a', name: 'n', min: 60 }] } };
    s.dayOverrides = { '2026-03-01': 1.5, '2026-03-02': '3' };
    s.rituals = { '2026-03-01': { plan: true, shutdown: false, note: '메모' } };
    s.weekAlloc = { '2026-02-23': { a: [0, 60, 0, 0, 0, 0, 0], b: [30, 0, 0, 0, 0, 0, 0] } };
    s.summaries = {
      a: [
        { id: 's1', sid: 'a', name: '1장', s1: 'x', s2: 'y', s3: 'z' },
        { id: 's2', sid: 'a', name: '2장', s1: 'x', s2: 'y', s3: 'z' },
      ],
    };
    s.cbms = [{ id: 'c1', ds: '2026-03-01', sid: 'a', name: 'n', chapter: '1장', code: 'C', note: '메모' }];
    s.retentionLog = [
      { wk: '2026-02-23', at: '2026-02-23T00:00:00.000Z', due: 10, cards: 100 },
      { wk: '2026-03-02', at: '2026-03-02T00:00:00.000Z', due: 20, cards: 120 },
    ];
    s.tasks = [{ id: 't1', title: '과제', done: false }];
    s.events = [{ id: 'e1', ds: '2026-03-01', start: 600, min: 60, title: '시험' }];
    return s as AppState;
  };

  it('전 슬라이스가 바이트 동일하게 돌아온다', () => {
    const s = rich();
    expect(roundTrip(s)).toEqual(s);
  });

  it('배열 순서가 보존된다(로그·정렬이 순서에 의미를 둔다)', () => {
    const s = rich();
    const back = roundTrip(s);
    expect(back.retentionLog.map((r) => r.wk)).toEqual(['2026-02-23', '2026-03-02']);
    expect(back.summaries.a!.map((x) => x.id)).toEqual(['s1', 's2']);
  });

  it('`id` 필드가 없는 로그(retentionLog)도 왕복한다', () => {
    const s = defaults() as AppState & Record<string, unknown>;
    s.retentionLog = [
      { wk: 'w1', at: 'a1', due: 1, cards: 1 },
      { wk: 'w2', at: 'a2', due: 2, cards: 2 },
      { wk: 'w3', at: 'a3', due: 3, cards: 3 },
    ];
    expect(roundTrip(s as AppState).retentionLog).toEqual(s.retentionLog);
  });
});

/* ============================================================
   C-3(2026-07-30 `/감사 근본`) — **동기화 행 키는 위치가 아니라 정체성이다.**

   ⚠ 이 절의 첫 케이스는 옛 테스트 이름을 뒤집는다. 종전 케이스는 _"순번이 정체성"_ 이라고
   **결함을 계약으로 적어** 두고 있었다(retentionLog). 행 단위 LWW 에서 위치를 키로 쓰면:

   · 두 기기의 **동시 추가**가 같은 키를 써서 하나가 툼스톤도 없이 사라진다.
   · 앞을 잘라내는 로그(`slice(-26)`)에서 **전 행의 키가 한 칸씩 밀려** 통째로 재전송된다.
   · 중간 삭제가 뒤 행 전부를 "다른 행"으로 만들어 툼스톤을 대량 발생시킨다.

   여기서 잠그는 것은 왕복이 아니라 **키의 안정성**이다 — 왕복은 위 절이 이미 본다.
============================================================ */
describe('⚠⚠ C-3 — 행 키가 위치에 흔들리지 않는다', () => {
  /** `diffRows` 가 낸 문장에서 (테이블, 키) 쌍만 뽑는다. */
  const keysOf = (stmts: { sql: string; args: unknown[] }[], tbl: string): string[] =>
    stmts
      .filter((s) => s.sql.includes(`INTO ${tbl} `) || s.sql.includes(`FROM ${tbl} `))
      .map((s) => `${s.args[0]}|${s.args[1]}`);

  const withSummaries = (list: { id: string; s1: string }[]): AppState => {
    const s = defaults() as AppState & Record<string, unknown>;
    s.summaries = { math: list };
    return s as AppState;
  };

  it('같은 과목의 요약 둘은 **서로 다른 행 키**를 갖는다 — 동시 추가가 뭉개지지 않는다', () => {
    const rows = stateToRows(
      withSummaries([
        { id: 'aaa', s1: 'A' },
        { id: 'bbb', s1: 'B' },
      ]),
    );
    expect(rows.summaries.map((r) => r.id)).toEqual(['aaa', 'bbb']);
    /* 종전엔 둘 다 ord 0,1 이었고 **다른 기기의 첫 요약도 0** 이었다 — 그래서 충돌했다.
       지금 키의 두 번째 성분은 위치와 무관한 값이다. */
    expect(rows.summaries.map((r) => r.ord)).toEqual([0, 1]);
  });

  it('맨 앞 요약을 지워도 남은 요약의 키가 안 바뀐다 — 툼스톤 대량 발생 차단', () => {
    _resetStamp();
    const before = stateToRows(
      withSummaries([
        { id: 'aaa', s1: 'A' },
        { id: 'bbb', s1: 'B' },
        { id: 'ccc', s1: 'C' },
      ]),
    );
    const after = stateToRows(
      withSummaries([
        { id: 'bbb', s1: 'B' },
        { id: 'ccc', s1: 'C' },
      ]),
    );
    const stmts = diffRows(before, after, 1000);

    // 지워진 것은 'aaa' 하나여야 한다 — 위치 키였다면 세 행 전부가 다른 행이 된다.
    const tombs = stmts.filter((s) => s.sql.includes('INTO tombstones'));
    expect(tombs).toHaveLength(1);
    expect(tombs[0]!.args).toContain('aaa');

    /* 남은 둘은 `ord` 가 1,2 → 0,1 로 바뀌므로 upsert 는 일어난다(표시 순서는 데이터다).
       핵심은 그것이 **같은 키의 갱신**이라는 것 — 삭제+삽입이 아니다. */
    const upserted = keysOf(
      stmts.filter((s) => s.sql.includes('INSERT OR REPLACE INTO summaries')),
      'summaries',
    );
    expect(upserted).toEqual(['math|bbb', 'math|ccc']);
  });

  it('retentionLog 의 키는 `wk` 다 — 앞을 잘라내도 남은 행의 키가 안 밀린다', () => {
    _resetStamp();
    const mk = (wks: string[]): AppState => {
      const s = defaults() as AppState & Record<string, unknown>;
      s.retentionLog = wks.map((wk, i) => ({ wk, at: `a${i}`, due: i, cards: i }));
      return s as AppState;
    };
    const before = stateToRows(mk(['w1', 'w2', 'w3']));
    expect(before.arrays.retentionLog.map((r) => r.id)).toEqual(['w1', 'w2', 'w3']);

    // `slice(-2)` 흉내 — 가장 오래된 주가 떨어진다.
    const stmts = diffRows(before, stateToRows(mk(['w2', 'w3'])), 1000);
    const tombs = stmts.filter((s) => s.sql.includes('INTO tombstones'));
    /* 순번 키였을 때: 'w1' 이 아니라 **index 2** 가 지워지고 0·1 이 재기입됐다(= 매주 26행 전량
       재전송). 지금은 떨어진 주 하나만 툼스톤이 된다. */
    expect(tombs).toHaveLength(1);
    expect(tombs[0]!.args).toContain('w1');
  });
});

describe('I1 — passthrough 필드가 살아남는다', () => {
  it('스키마에 없는 최상위 필드가 왕복에서 보존된다', () => {
    const s = defaults() as AppState & Record<string, unknown>;
    s.미래필드 = { 무엇: '보존돼야 함' };
    expect((roundTrip(s as AppState) as unknown as Record<string, unknown>).미래필드).toEqual({ 무엇: '보존돼야 함' });
  });

  it('레코드 안의 모르는 필드도 보존된다(열로 펼치지 않는 이유)', () => {
    const s = defaults() as AppState & Record<string, unknown>;
    s.cbms = [{ id: 'c1', ds: 'd', sid: 's', name: 'n', chapter: 'c', code: 'C', note: '', 실험필드: 42 }];
    const back = roundTrip(s as AppState) as unknown as { cbms: Record<string, unknown>[] };
    expect(back.cbms[0]!.실험필드).toBe(42);
  });

  it('형태가 깨진 행 슬라이스는 떨구지 않고 통째로 보존한다', () => {
    const s = defaults() as AppState & Record<string, unknown>;
    s.cbms = '이건 배열이 아님' as unknown as AppState['cbms'];
    expect((roundTrip(s as AppState) as unknown as Record<string, unknown>).cbms).toBe('이건 배열이 아님');
  });
});

describe('2계층 스코프 — 런타임 캐시의 처지가 테이블 정책으로 직역된다', () => {
  const withCaches = (): AppState => {
    const s = defaults() as AppState & Record<string, unknown>;
    s._vaultScan = { at: 'x' }; // EPHEMERAL_ONLY — 저장 자체를 안 한다
    s._ankiFile = { at: 'y' }; // EPHEMERAL_ONLY
    s._ankiLive = { decks: [] }; // 로컬 저장은 하되 내보내기에서 제외
    s._knowState = { subjects: [] };
    s._lastBackupAt = '2026-07-01T00:00:00.000Z'; // 런타임 캐시가 아니다 — 영속 마커
    return s as AppState;
  };

  it('EPHEMERAL_ONLY_KEYS는 행을 아예 만들지 않는다', () => {
    const rows = stateToRows(withCaches());
    const keys = [...rows.settings, ...rows.runtime].map((r) => r.key);
    for (const k of EPHEMERAL_ONLY_KEYS) expect(keys).not.toContain(k);
  });

  it('나머지 런타임 캐시는 runtime 테이블로, 그 외는 settings 로 갈린다', () => {
    const rows = stateToRows(withCaches());
    const runtimeKeys = rows.runtime.map((r) => r.key);
    const settingKeys = rows.settings.map((r) => r.key);
    expect(runtimeKeys).toContain('_ankiLive');
    expect(runtimeKeys).toContain('_knowState');
    expect(settingKeys).toContain('_lastBackupAt'); // 영속 마커는 내보내기에 남아야 한다
    for (const k of RUNTIME_CACHE_KEYS) expect(settingKeys).not.toContain(k);
  });

  it('runtime 행을 버리면 내보내기 스냅샷과 같은 범위가 된다', () => {
    const s = withCaches();
    const rows = stateToRows(s);
    const withoutRuntime = rowsToState({ ...rows, runtime: [] });
    // exportSnapshot 은 RUNTIME_CACHE_KEYS 를 전부 뺀 것 — 두 경로가 일치해야 I1 이 성립한다.
    expect(withoutRuntime).toEqual(exportSnapshot(s));
  });
});

describe('대용량 표본 — 규모에서도 동형', () => {
  it('완료 500일·cbms 800건 규모가 바이트 동일하게 왕복한다', () => {
    const s = defaults() as AppState & Record<string, unknown>;
    const ds = (n: number): string => new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10);
    const comp: Record<string, Record<string, unknown>> = {};
    for (let d = 0; d < 500; d++) comp[ds(d)] = { 'a|new': { done: true, min: 60 }, 'b|rev': { done: false, min: 30 } };
    s.completions = comp;
    s.cbms = Array.from({ length: 800 }, (_, i) => ({
      id: `c${i}`,
      ds: ds(i % 500),
      sid: 'a',
      name: `n${i}`,
      chapter: '1장',
      code: 'C',
      note: '메모'.repeat(10),
    }));
    const rows = stateToRows(s as AppState);
    expect(rows.completions).toHaveLength(1000);
    expect(rows.arrays.cbms).toHaveLength(800);
    expect(roundTrip(s as AppState)).toEqual(s);
  });

  it('⚠ 증분 diff — 한 건만 바뀌면 문장도 한 건이다(편집당 전량 재직렬화 해소)', () => {
    const s = defaults() as AppState & Record<string, unknown>;
    const ds = (n: number): string => new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10);
    const comp: Record<string, Record<string, unknown>> = {};
    for (let d = 0; d < 500; d++) comp[ds(d)] = { 'a|new': { done: true, min: 60 } };
    s.completions = comp;
    const before = stateToRows(s as AppState);

    // 완료 한 건만 바꾼다.
    (s.completions as Record<string, Record<string, unknown>>)[ds(3)]!['a|new'] = { done: true, min: 120 };
    const after = stateToRows(s as AppState);

    const stmts = diffRows(before, after);
    expect(stmts).toHaveLength(1); // 500일치를 다시 쓰지 않는다
    expect(stmts[0]!.sql).toContain('INSERT OR REPLACE INTO completions');
  });

  it('⚠ upsert 가 삭제보다 먼저 나온다(중간에 죽어도 "여분"이지 "유실"이 아니다)', () => {
    const s = defaults() as AppState & Record<string, unknown>;
    s.cbms = [
      { id: 'c1', ds: 'd', sid: 's', name: 'n', chapter: 'c', code: 'C', note: '' },
      { id: 'c2', ds: 'd', sid: 's', name: 'n', chapter: 'c', code: 'B', note: '' },
    ];
    const before = stateToRows(s as AppState);
    s.cbms = [{ id: 'c3', ds: 'd', sid: 's', name: 'n', chapter: 'c', code: 'M', note: '' }];
    const stmts = diffRows(before, stateToRows(s as AppState));

    const firstDelete = stmts.findIndex((x) => x.sql.startsWith('DELETE'));
    const lastUpsert = stmts.map((x) => x.sql.startsWith('INSERT')).lastIndexOf(true);
    expect(firstDelete).toBeGreaterThan(lastUpsert);
    expect(stmts.filter((x) => x.sql.startsWith('DELETE'))).toHaveLength(2); // c1·c2 제거
  });

  it('변경 없으면 문장도 없다', () => {
    const rows = stateToRows(defaults());
    expect(diffRows(rows, rows)).toEqual([]);
  });

  it('기준선이 없으면 전량 upsert(삭제는 없다 — DB 를 비우지 않는다)', () => {
    const stmts = diffRows(null, stateToRows(defaults()));
    expect(stmts.length).toBeGreaterThan(0);
    expect(stmts.every((s) => s.sql.startsWith('INSERT OR REPLACE'))).toBe(true);
  });

  it('행 슬라이스 목록에 배열 슬라이스가 전부 들어 있다(신규 슬라이스 누락 감지)', () => {
    expect([...ARRAY_SLICES].sort()).toEqual(
      ['backlog', 'blankResults', 'cbms', 'events', 'retentionLog', 'tasks'].sort(),
    );
  });
});

/* ── 5단계-D — 동기화 가능한 데이터 모델 ─────────────────────────────────────
   클라우드로 가면 폰과 PC 가 각자 편집하고 나중에 합쳐진다. 그때 필요한 두 가지를
   diff 가 실제로 내는지 잠근다. 여기가 비면 "삭제가 부활하는" 버그를 사용자 데이터에서
   처음 만나게 된다(설계 §5단계 재범위 v7). */
describe('5단계-D — updated_at 과 툼스톤', () => {
  const now = 1_700_000_000_000;

  it('동기화 대상 테이블만 updated_at 을 싣는다', () => {
    const rows = stateToRows({ theme: 'dark', _knowState: { c: 1 }, tasks: [{ id: 't1' }] } as never);
    const stmts = diffRows(null, rows, now);

    const settings = stmts.find((s) => s.sql.includes('INTO settings'))!;
    expect(settings.sql).toContain('updated_at');
    expect(settings.args.at(-1)).toBe(now);

    // runtime_cache 는 내보내기에서 빠지는 로컬 캐시라 유선으로 나를 이유가 없다.
    const runtime = stmts.find((s) => s.sql.includes('INTO runtime_cache'))!;
    expect(runtime.sql).not.toContain('updated_at');
    // meta.present 는 상태에서 파생된다 — 파생을 LWW 로 병합하면 원본과 어긋난다.
    const meta = stmts.find((s) => s.sql.includes('INTO meta'))!;
    expect(meta.sql).not.toContain('updated_at');
  });

  it('⚠ 삭제는 툼스톤을 남긴다 — 없으면 다른 기기가 지운 행을 되살린다', () => {
    const prev = stateToRows({ tasks: [{ id: 't1' }, { id: 't2' }] } as never);
    const next = stateToRows({ tasks: [{ id: 't1' }] } as never);
    const stmts = diffRows(prev, next, now);

    const tomb = stmts.find((s) => s.sql.includes('INTO tombstones'));
    expect(tomb, 't2 를 지웠는데 툼스톤이 없다').toBeDefined();
    // (tbl, k1, k2, deleted_at) — records 는 2열 키라 k2 가 실제 id 다.
    expect(tomb!.args).toEqual(['records', 'tasks', 't2', now]);
  });

  it('⚠ 툼스톤이 데이터 삭제보다 먼저 나온다(중간에 죽어도 "지워진 것"으로 판정되게)', () => {
    const prev = stateToRows({ tasks: [{ id: 't1' }] } as never);
    const next = stateToRows({} as never);
    const stmts = diffRows(prev, next, now);

    const tombAt = stmts.findIndex((s) => s.sql.includes('INTO tombstones'));
    const delAt = stmts.findIndex((s) => s.sql.startsWith('DELETE FROM records'));
    expect(tombAt).toBeGreaterThanOrEqual(0);
    expect(delAt).toBeGreaterThan(tombAt);
  });

  it('단일키 테이블의 툼스톤은 k2 가 빈 문자열이다(db.rs v3 규약)', () => {
    const prev = stateToRows({ theme: 'dark', startDate: '2026-01-01' } as never);
    const next = stateToRows({ theme: 'dark' } as never);
    const tomb = diffRows(prev, next, now).find((s) => s.sql.includes('INTO tombstones'))!;
    expect(tomb.args).toEqual(['settings', 'startDate', '', now]);
  });

  it('안 바뀐 행은 updated_at 도 안 찍는다 — 아니면 증분이 전량 쓰기로 퇴화한다', () => {
    const rows = stateToRows({ theme: 'dark', tasks: [{ id: 't1' }] } as never);
    expect(diffRows(rows, rows, now)).toEqual([]);
  });
});

describe('C2 — 대량 단일 flush 의 스탬프 청킹(아웃박스 영구 차단 방지)', () => {
  /* ⚠ 결함: 런타임 `loadState`(가져오기·복구·되돌리기)는 상태를 통째로 써서 sync 행이 500 을 넘을
     수 있는데, `writeRows` 가 단일 `nextStamp()` 를 쓰면 전부 **한 스탬프 그룹**이 된다. capBatch 가
     스탬프 경계에서만 자를 수 있어 그 그룹이 상한(500)을 넘으면 스키마가 거부 → 아웃박스 영구 차단
     (이후 모든 편집이 조용히 동기화 안 됨). 최초 이관만 chunkedStamp 로 막던 비대칭이었다.
     고침: `writeRows` 기본을 `chunkedStamp(400)` 로 → 어느 호출자든 단일 그룹이 상한을 못 넘는다. */
  it('chunkedStamp(400) 은 500 초과 sync 행을 400 이하 그룹들로 쪼갠다', () => {
    _resetStamp();
    const s = {
      ...defaults(),
      events: Array.from({ length: 600 }, (_, i) => ({ id: `e${i}`, ds: '2026-07-24', title: `x${i}` })),
    };
    // writeRows 가 인자 없이 쓰는 것과 **같은** 배급기(sqlite.ts `WRITE_STAMP_CHUNK`).
    const stmts = diffRows(null, stateToRows(s as unknown as AppState), chunkedStamp(400));

    // sync upsert(끝 인자가 updated_at 스탬프)의 스탬프별 건수.
    const counts = new Map<number, number>();
    for (const st of stmts) {
      if (!/INSERT OR REPLACE INTO (records|settings|completions|ds_map|summaries|week_alloc) /.test(st.sql)) continue;
      const stamp = st.args[st.args.length - 1] as number;
      counts.set(stamp, (counts.get(stamp) ?? 0) + 1);
    }
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    const maxGroup = Math.max(...counts.values());

    expect(total).toBeGreaterThan(MAX_BATCH_ITEMS); // 테스트가 헛돌지 않게 — 실제로 상한 초과를 만들었다
    expect(maxGroup).toBeLessThanOrEqual(400); // 어떤 단일 그룹도 청크 상한 이하
    expect(maxGroup).toBeLessThan(MAX_BATCH_ITEMS); // → capBatch 가 못 쪼개는 oversized 가 생기지 않는다
  });
});
