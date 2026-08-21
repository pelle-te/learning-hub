/* ============================================================
   visits.test.ts — 방문 원장의 **분류 규칙**(N-11).

   SQL 자체(기본키·인덱스·동기화 배제)는 `dbMigrations.test.ts` 가 실제 SQLite 로 잠근다.
   여기서 잠그는 것은 그 위의 유일한 로직 — **힌트를 언제 믿는가**다. 이게 틀리면 표는
   가득 차는데 값이 거짓이 되고, 거짓 관측은 관측 없음보다 나쁘다(데이터가 있다는 이유로
   더 자신 있게 틀린 결정을 내린다).
============================================================ */
import { describe, expect, it, beforeEach, vi } from 'vitest';

/* ⚠ SQLite 층을 대역으로 세운다 — 브라우저(vitest)에선 `isSqlitePrimary()` 가 false 라
   기록 경로가 통째로 조기 반환하고, 그러면 아래 보존-주기 계약을 **한 줄도 못 잰다**. */
const db = vi.hoisted(() => ({ sql: [] as string[] }));
vi.mock('@/lib/db/sqlite', () => ({
  isSqlitePrimary: (): boolean => true,
  execDb: (sql: string): Promise<void> => {
    db.sql.push(sql);
    return Promise.resolve();
  },
  selectDb: (): Promise<unknown[]> => Promise.resolve([]),
}));

import { markVia, takeVia, resetVia, recordVisit, recordHop, setInspectDs } from '../src/lib/visits';

beforeEach(() => {
  resetVia();
  db.sql.length = 0;
});

/** 주어진 날짜들로 차례로 방문을 기록하고, 그동안 실행된 SQL 전량을 돌려준다. */
async function recordAndCollect(days: string[]): Promise<string[]> {
  for (const ds of days) await recordVisit('today', 'rail', ds);
  return db.sql;
}

describe('진입 경로 힌트', () => {
  it('힌트가 없으면 폴백이다 — 누락은 오분류이지 유실이 아니다', () => {
    expect(takeVia('link')).toBe('link');
  });

  it('힌트는 1회용이다 — 한 번 누른 것이 두 번 세어지면 안 된다', () => {
    markVia('rail');
    expect(takeVia('link')).toBe('rail');
    expect(takeVia('link')).toBe('link');
  });

  /* ⚠ 이 케이스가 실제 오염을 막는다. 같은 경로를 다시 클릭하면 라우터가 리렌더를 안 하고,
     그 자리에 남은 `rail` 힌트가 **다음** 내비게이션(본문 링크일 수 있다)에 붙는다. */
  it('낡은 힌트는 버린다 — 내비게이션 없이 남은 값이 다음 이동을 오염시킨다', () => {
    const t0 = 1_000_000;
    markVia('rail', t0);
    expect(takeVia('link', t0 + 5_000)).toBe('link');
  });

  it('유효 시간 안이면 그대로 쓴다', () => {
    const t0 = 1_000_000;
    markVia('palette', t0);
    expect(takeVia('link', t0 + 500)).toBe('palette');
  });

  it('나중 힌트가 앞선 힌트를 덮는다(마지막 의도가 이긴다)', () => {
    markVia('rail');
    markVia('key');
    expect(takeVia('link')).toBe('key');
  });
});

/* ⚠⚠ **보존 청소는 하루 1회다 — 세션당 1회가 아니다**(H24 · 2026-07-30 `/감사 근본`).

   종전엔 모듈 전역 부울 하나로 "이미 청소했다"를 기억했다. 브라우저 탭이라면 맞는 가정이지만
   이 앱의 배포 형태는 **며칠씩 열려 있는 데스크톱 셸**이다 — 그러면 보존창이 `KEEP_DAYS +
   세션 길이`로 조용히 늘어난다(90일이라 적어 두고 실제로는 120일을 들고 있다). 무한 성장은
   아니라서 아무 증상도 없고, 그래서 계약과 실제가 갈렸다는 사실만 남는다.

   ⚠ 아래 두 케이스가 **양쪽**을 잠근다: 같은 날 반복 기록이 DELETE 를 다시 쏘지 않는 것(비용)과,
   날이 바뀌면 다시 쏘는 것(계약). 한쪽만 보면 "매번 청소"도 통과한다. */
describe('보존 청소 주기(H24)', () => {
  const DEL = /DELETE FROM route_visits/;

  it('같은 날 여러 번 기록해도 청소는 한 번이다', async () => {
    const sql = await recordAndCollect(['2026-07-30', '2026-07-30', '2026-07-30']);
    expect(sql.filter((s) => DEL.test(s))).toHaveLength(1);
  });

  it('⚠ 날이 바뀌면 다시 청소한다 — 셸이 며칠 열려 있어도 90일 창이 유지된다', async () => {
    const sql = await recordAndCollect(['2026-07-30', '2026-07-30', '2026-07-31', '2026-08-01']);
    expect(sql.filter((s) => DEL.test(s))).toHaveLength(3);
  });
});

/* ⚠⚠ **점검 트래픽은 사용이 아니다**(I030 · 2026-08-22 발상 축).

   실 DB 의 마지막 10홉이 **전 화면 순회**였다 — 감사 세션이 훑은 기록이 그대로 `route_visits`
   에 들어가고, `shell/tabs.ts` 의 은퇴 규칙이 그 합계를 읽는다. 관측이 자기 근거를 오염시키는
   형태이고, 이 파일 머리주석이 이미 경고한 순환의 실현이다.

   ⚠ 아래 넷이 잠그는 계약: ① 켠 날은 방문이 안 남는다 ② 홉도 안 남는다 ③ **청소도 안 돈다**
   (점검 세션이 90일 경계를 미는 것도 «점검이 원장을 바꾼다»의 한 형태) ④ **날짜가 다르면
   기록한다** — ④ 가 없으면 «부울로 켜 두고 잊는다»와 구분이 안 되고, 그건 이 노브가 관측을
   영원히 끄는 함정이 되는 정확한 경로다. */
describe('점검 모드(I030)', () => {
  it('점검 중인 날은 방문을 기록하지 않는다', async () => {
    setInspectDs('2026-08-22');
    await recordVisit('today', 'rail', '2026-08-22');
    expect(db.sql).toHaveLength(0);
  });

  it('점검 중인 날은 홉도 기록하지 않는다', async () => {
    setInspectDs('2026-08-22');
    await recordHop('today', 'plan', '2026-08-22');
    expect(db.sql).toHaveLength(0);
  });

  it('⚠ 점검 중엔 보존 청소도 안 돈다 — 점검 세션은 이 표에 어떤 흔적도 남기지 않는다', async () => {
    setInspectDs('2026-08-22');
    await recordVisit('today', 'rail', '2026-08-22');
    expect(db.sql.filter((s) => /DELETE FROM route_visits/.test(s))).toHaveLength(0);
  });

  it('⚠⚠ 날짜가 다르면 정상 기록한다 — 자정에 스스로 꺼져야 「켜 두고 잊는」 함정이 안 된다', async () => {
    setInspectDs('2026-08-22');
    await recordVisit('today', 'rail', '2026-08-23');
    expect(db.sql.some((s) => /INSERT INTO route_visits/.test(s))).toBe(true);
  });

  it('끄면(null) 다시 기록한다', async () => {
    setInspectDs('2026-08-22');
    setInspectDs(null);
    await recordVisit('today', 'rail', '2026-08-22');
    expect(db.sql.some((s) => /INSERT INTO route_visits/.test(s))).toBe(true);
  });
});
