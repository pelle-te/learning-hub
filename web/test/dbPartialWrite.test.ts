// @vitest-environment jsdom
/* ============================================================
   dbPartialWrite.test.ts — **k번째 문장에서 죽으면 어떻게 되나**(C056 · 2026-08-22 코드 축).

   ## 왜 이 층이 없었나

   `sqlite.ts` 의 `writeRows` 머리주석이 안전 속성을 **선언**한다:

     *"트랜잭션을 쓰지 않는 것이 의도다 … diff 방식이 트랜잭션 없이도 안전하다 —
      DELETE-후-INSERT 와 달리 **DB 가 비는 순간이 없고**, 중간에 죽어도 남는 건 '여분의 옛 행'
      이지 '사라진 행'이 아니다(다음 쓰기가 정리한다)."*

   그 선언은 옳지만, **부분 실패를 실제로 밟는 검사가 없었다.** 셸 경로는 `db.batch` 가 없어
   `for (const s of folded) await db.execute(...)` 로 떨어지므로 «k번째에서 죽는 것»이 정상
   경로다(디스크 가득 · 잠금 · 프로세스 종료). 즉 이 저장소에서 가장 비싼 실패(정본 손상)의
   방어망이 **주석에만** 있었다.

   ## 무엇을 잰다 — 세 갈래

   ① **기준선 무효화** — 부분 적용 뒤 메모리 기준선을 그대로 두면 다음 diff 가 «DB 에 이미 있다»고
      착각해 못 쓴 문장을 **영영 안 쓴다**. 다음 쓰기가 DB 를 재독하는지 본다.
   ② **pre-image 를 주지 않는다** — 부분 적용 상태에서 "직전"이 무엇인지 모른다. 그걸 ⌘Z 스택에
      얹으면 되돌리기가 **실제로 없던 상태**를 만들어 낸다(그리고 LWW 라 서버까지 이긴다).
   ③ **삭제가 앞서지 않는다** — «DB 가 비는 순간이 없다»의 실제 내용. 어느 k 에서 끊겨도
      그 시점까지 나간 문장에 «남은 행보다 많은 DELETE» 가 없어야 한다.
============================================================ */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbRows } from '@/lib/db/rows';

/** 나간 문장과 실패 지점. `k` 번째(1-based) `execute` 에서 던진다. `0` 이면 안 던진다. */
const 실행 = { sql: [] as string[], failAt: 0 };
const execute = vi.fn(async (sql: string) => {
  실행.sql.push(sql);
  if (실행.failAt && 실행.sql.length === 실행.failAt) throw new Error(`디스크 가득(문장 ${실행.failAt})`);
  return undefined;
});
const select = vi.fn(async () => []);
/** ⚠ `batch` 를 **주지 않는다** — 셸(plugin-sql) 경로가 순차 `execute` 폴백이고, k번째 실패는 거기서만 성립한다. */
vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: async () => ({ execute, select }) } }));
vi.mock('@/lib/isTauri', () => ({ isTauri: () => true }));
vi.mock('@/lib/tauri', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  dbUrl: async () => 'sqlite:test.db',
}));

const { writeRows, setDiffBaseline } = await import('@/lib/db/sqlite');

/** 빈 행 표현 — `DbRows` 의 총체 타입이라 슬라이스가 늘면 여기가 **컴파일 에러**가 된다(의도). */
const empty = (): DbRows => ({
  present: [],
  settings: [],
  runtime: [],
  completions: [],
  dsMaps: { dayOverrides: [], dayPlans: [], rituals: [], resume: [] },
  arrays: {
    cbms: [],
    backlog: [],
    blankResults: [],
    retentionLog: [],
    events: [],
    tasks: [],
    questions: [],
    jolAsks: [],
    retrievals: [],
  },
  summaries: [],
  weekAlloc: [],
});

/** settings 몇 줄 — 문장이 여러 개 나오게. */
const rows = (kv: Record<string, string>): DbRows => ({
  ...empty(),
  settings: Object.entries(kv).map(([key, v]) => ({ key, json: JSON.stringify(v) })),
});

beforeEach(() => {
  실행.sql = [];
  실행.failAt = 0;
  execute.mockClear();
  select.mockClear();
  setDiffBaseline(empty()); // 기준선을 «빈 DB» 로 못박는다(재독을 안 타게)
});

describe('writeRows — k번째 문장에서 죽었을 때(C056)', () => {
  it('먼저 정상 경로를 확인한다 — 실패 케이스가 «원래 안 되던 것»이 아님의 증거', async () => {
    const r = await writeRows(rows({ a: '1', b: '2', c: '3' }));
    expect(r.ok).toBe(true);
    expect(실행.sql.length, '문장이 안 나갔다 — 아래 k 실험이 의미를 잃는다').toBeGreaterThan(0);
  });

  it('⚠⚠ 부분 적용이면 `ok:false` 이고 **pre-image 를 주지 않는다** — 되돌리기가 없던 상태를 만든다', async () => {
    실행.failAt = 1;
    const r = await writeRows(rows({ a: '1', b: '2', c: '3' }));
    expect(r.ok).toBe(false);
    expect(r.preImages, '부분 적용 상태에서 "직전"은 모른다 — 얹으면 ⌘Z 가 허구를 만든다').toEqual([]);
    expect(r.touched, '안 쓴 행을 "썼다"고 보고하면 되읽기 대조가 엉뚱한 것을 본다').toEqual([]);
  });

  it('⚠⚠ 기준선을 무효화한다 — 안 하면 못 쓴 문장이 **영영** 안 나간다', async () => {
    실행.failAt = 1;
    await writeRows(rows({ a: '1', b: '2' }));

    /* 다음 쓰기는 DB 를 **재독**해야 한다(기준선이 없으므로). 재독이 없으면 메모리 기준선이
       "이미 다 썼다"고 말해 diff 가 비고, 실패한 쓰기가 조용히 사라진다. */
    select.mockClear();
    실행.failAt = 0;
    const r2 = await writeRows(rows({ a: '1', b: '2' }));
    expect(select, '기준선이 살아 있어 DB 재독을 건너뛰었다').toHaveBeenCalled();
    expect(r2.ok).toBe(true);
    expect(r2.touched.length, '재독 뒤 diff 가 비면 실패한 쓰기가 영영 유실된다').toBeGreaterThan(0);
  });

  it('⚠ 어느 k 에서 끊겨도 DELETE 가 앞서지 않는다 — 「DB 가 비는 순간이 없다」의 실제 내용', async () => {
    /* 기준선에 셋이 있고 새 상태엔 하나만 남는다 → upsert 1 + delete 2 가 나올 수 있는 모양.
       ⚠⚠ 종전 단언은 «DELETE 가 있으면 upsert 도 ≥1» 이었고 upsert 판정이 `/INSERT|REPLACE|UPDATE/`
       였다(C073 · 2026-09-02). 그런데 `settings` 는 동기화 표라 삭제마다 **툼스톤 문장**이 나가고 그
       SQL 이 `INSERT OR REPLACE INTO tombstones …` 라 **툼스톤이 upsert 로 세어졌다** — 순서가
       `[툼스톤, 툼스톤, DELETE, upsert]` 로 뒤집혀도 초록이었다. 게다가 DELETE 를 한 번도 못 봐도
       단언 0개로 통과했다. 이제 **순서**(첫 DELETE 가 마지막 진짜 upsert 뒤)와 **분모**를 함께 잰다. */
    const isUp = (q: string) => /^\s*(INSERT|UPDATE)/i.test(q) && !/INTO\s+tombstones/i.test(q);
    const isDel = (q: string) => /^\s*DELETE/i.test(q);
    let sawDel = false;
    for (let k = 1; k <= 6; k++) {
      setDiffBaseline(rows({ a: '1', b: '2', c: '3' }));
      실행.sql = [];
      실행.failAt = k;
      await writeRows(rows({ a: '9' }));
      const firstDel = 실행.sql.findIndex(isDel);
      const lastUp = 실행.sql.map(isUp).lastIndexOf(true);
      if (firstDel < 0) continue;
      sawDel = true;
      /* 요구는 «비는 순간이 없다» 이므로, 끊긴 지점까지 나간 문장이 전부 DELETE 이기만 하면 안 된다.
         diff 방식은 upsert 를 먼저 내므로 이 성질이 성립한다 — 순서가 뒤집히면 여기서 잡힌다. */
      expect(lastUp, `k=${k}: DELETE 앞에 진짜 upsert 가 없다 — 표가 비는 창이 생긴다`).toBeGreaterThanOrEqual(0);
      expect(firstDel, `k=${k}: DELETE 가 upsert 보다 앞서 나갔다 — 표가 비는 창이 생긴다`).toBeGreaterThan(lastUp);
    }
    expect(sawDel, '삭제 문장이 한 번도 안 나왔다 — 이 루프가 아무것도 안 쟀다').toBe(true);
  });

  it('⚠ 마지막 문장에서 죽어도 같은 계약이다 — k 가 끝일 때만 통과하는 방어가 아니다', async () => {
    실행.failAt = 0;
    setDiffBaseline(empty());
    const 정상 = await writeRows(rows({ a: '1', b: '2', c: '3' }));
    expect(정상.ok).toBe(true);
    const 총문장 = 실행.sql.length;

    setDiffBaseline(empty());
    실행.sql = [];
    실행.failAt = 총문장;
    const r = await writeRows(rows({ a: '1', b: '2', c: '3' }));
    expect(r.ok).toBe(false);
    expect(r.preImages).toEqual([]);
  });
});
