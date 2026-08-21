/* ============================================================
   lib/idleLedger.ts — **유휴 원장**(N-8 · W3 · 발산 6회차).

   ## ⚠⚠ 이 파일은 개입을 안 한다 — 자만 댄다

   N-8(재수신성 트리거 · "PC 앞인데 5분째 무입력")의 전제는 *앱이 떠 있는 채로 사람이 자리를
   비우거나 다른 창에서 일하는 구간이 실재한다* 이다. 그 전제의 근거로 인용되던 실측(T-3 의
   _"사용자는 켜 놓고 살지 않는다"_)은 **트레이·자동시작이 생기기 전** 것이라 지금은 유효하지
   않다. 그래서 로드맵이 적은 가장 싼 검증이 _"알림 0으로 3일 유휴 로그만"_ 이고, 이 파일이
   그것이다. 개입을 먼저 붙였다가 전제가 틀리면 남는 것은 알림 피로뿐이고 그건 되돌리기 어렵다.

   ## 상태 기계가 왜 필요한가 — 폴링은 **구간**을 못 본다

   `systemIdleSeconds()` 는 *지금 몇 초째인지*만 준다. 그걸 그대로 쌓으면 같은 부재를 폴링
   횟수만큼 센다(60초 폴링이면 30분 자리 비움이 30번). 그래서 **임계를 넘는 순간 한 번만**
   세고, 되돌아올 때 길이를 기록한다. 세는 시각이 *넘은 시각*인 이유는 그 순간이 곧 개입이
   발사됐을 시각이기 때문이다(구간이 끝난 시각이 아니다).

   ⚠ **표본이 하나 늦게 확정된다.** 길이는 "임계를 넘은 뒤 마지막으로 관측된 유휴 초"이므로
   폴링 간격만큼 과소 추정된다. 그 오차(≤60초)는 이 원장이 답하려는 질문(몇 번·몇 시·대략
   얼마나)에 영향을 주지 않는다 — 정밀도를 올리려고 폴링을 촘촘히 하면 관측이 관측 대상보다
   비싸진다(`visits.ts` 의 청소 주기가 같은 판단을 이미 했다).

   ⚠ 브라우저(dev·트랙 A)에선 `systemIdleSeconds()` 가 0 이라 임계를 영원히 못 넘고, `execDb`
   도 무동작이다 — 이 파일이 없는 것과 똑같이 돈다.
============================================================ */
import { execDb, isSqlitePrimary, selectDb } from './db/sqlite';
import { addDays, iso, parseISO, todayISO } from './utils';

/**
 * 몇 초부터 "부재"로 볼 것인가. **5분**은 N-8 의 문장 그대로다("5분째 무입력").
 *
 * ⚠ 이 값은 원장의 뜻을 정한다 — 나중에 바꾸면 이전 행과 단위가 달라진다(임계가 다른 두
 * 구간을 같은 열에 섞게 된다). 바꿔야 하면 새 열이 아니라 **새 표**다(007→010 의 판정).
 */
export const IDLE_MIN_SEC = 300;

/** 구간 한 줄(시각별 집계). */
export interface IdleRow {
  hour: number;
  /** 임계를 넘은 횟수. */
  n: number;
  /** 그 구간들의 총 길이(초). */
  sec: number;
}

/* 진행 중인 구간. 모듈 상태인 이유는 **폴링 사이에만** 살면 되기 때문이다 — 앱을 재시작하면
   그 구간은 어차피 관측 밖이다(프로세스가 죽은 동안의 유휴는 잴 방법이 없고, 있는 척하면
   그게 곧 지어낸 데이터다). */
let spell: { hour: number; ds: string; sec: number } | null = null;

/** 테스트 격리용 — 진행 중 구간과 청소 가드를 버린다. */
export function resetIdleSpell(): void {
  spell = null;
  _prunedOn = null;
}

/**
 * 폴링 한 번. **부작용은 임계를 넘을 때와 돌아올 때만** 일어난다.
 *
 * @param idleSec 지금 몇 초째 무입력인가(`systemIdleSeconds()`).
 * @returns 이번 호출이 **구간 하나를 닫았으면** 그 길이(초), 아니면 `null`.
 *   반환값이 있는 이유: 소비처(뒤 웨이브의 트리거)가 *돌아왔다*를 알아야 하는데, 그 사실은
 *   이 함수 안에만 있다(밖에서 `idleSec` 만 보면 임계 아래 두 값이 구분되지 않는다).
 */
export async function observeIdle(
  idleSec: number,
  ds: string = todayISO(),
  hour: number = new Date().getHours(),
): Promise<number | null> {
  if (idleSec >= IDLE_MIN_SEC) {
    if (!spell) {
      /* 넘은 **순간** 한 번만 센다. 길이는 아직 모른다 — 아래 닫는 쪽이 더한다. */
      spell = { hour, ds, sec: idleSec };
      await bump(ds, hour, 1, 0);
    } else {
      spell.sec = idleSec; // 자라는 중 — 쓰지는 않는다(닫을 때 한 번)
    }
    return null;
  }
  /* 돌아왔다. ⚠ 길이는 **넘은 시각의 칸**에 적는다(구간을 시작한 곳) — 자정을 넘긴 구간이
     다음 날 칸에 길이만 얹히면 그 날의 `n` 과 `sec` 이 서로 다른 구간을 말하게 된다. */
  const done = spell;
  spell = null;
  if (!done) return null;
  await bump(done.ds, done.hour, 0, done.sec);
  return done.sec;
}

/** 보존기간(일) — `visits.ts` 의 90일과 같은 자. 이 표도 무한 성장할 이유가 없다. */
const KEEP_DAYS = 90;

/* **하루 1회** 청소(D013 · 2026-08-21). 자매 둘이 이미 갖고 있던 가드다
   (`visits.ts:_prunedOn` · `daySignals.ts:_prunedOn`) — 그리고 그건 H24 에서 *부울→날짜*로
   고친 바로 그 자리다(부울이면 세션당 1회라, 며칠씩 열려 있는 데스크톱 셸에서 보존창이
   `KEEP_DAYS + 세션 길이`로 조용히 늘어난다). ⚠ 부울로 되돌리지 말 것. */
let _prunedOn: string | null = null;

/** 원장 갱신 한 줄. **실패해도 조용히 넘어간다**(`visits.recordVisit` 과 같은 계약). */
async function bump(ds: string, hour: number, n: number, sec: number): Promise<void> {
  if (!isSqlitePrimary()) return;
  await execDb(
    `INSERT INTO idle_spells (day, hour, n, sec) VALUES (?, ?, ?, ?)
     ON CONFLICT(day, hour) DO UPDATE SET n = n + ?, sec = sec + ?`,
    [ds, hour, n, sec, n, sec],
  );
  /* ⚠⚠ 청소가 **쓰기 경로**에 있다(D013). 종전엔 `idleSummary()` 안에 있었고 그 유일한
     호출부가 «설정 › 진단» 화면이라, **그 화면을 안 여는 사용자에게 `KEEP_DAYS` 는 한 번도
     집행되지 않았다.** 자매 둘은 처음부터 쓰기 경로에 달려 있었다 — 읽기는 읽기만 한다. */
  if (_prunedOn !== ds) {
    _prunedOn = ds;
    await execDb(`DELETE FROM idle_spells WHERE day < ?`, [iso(addDays(parseISO(ds), -KEEP_DAYS))]);
  }
}

/** 최근 `days` 일의 시각별 유휴 구간. ⚠ **읽기는 읽기만 한다** — 청소는 `bump` 가 진다(D013). */
export async function idleSummary(days = 14, todayDs: string = todayISO()): Promise<IdleRow[]> {
  const from = iso(addDays(parseISO(todayDs), -days));
  const rows = await selectDb<{ hour: number; n: number; sec: number }>(
    `SELECT hour, SUM(n) AS n, SUM(sec) AS sec FROM idle_spells WHERE day >= ? GROUP BY hour ORDER BY hour`,
    [from],
  );
  return (rows ?? []).map((r) => ({ hour: Number(r.hour) || 0, n: Number(r.n) || 0, sec: Number(r.sec) || 0 }));
}

/** 관측된 날 수 — **분모**. 없으면 표는 0 을 "부재가 없다"로 읽히게 만든다(`visitSample` 과 같은 이유). */
export async function idleSample(days = 14, todayDs: string = todayISO()): Promise<{ days: number; spells: number }> {
  const from = iso(addDays(parseISO(todayDs), -days));
  const rows = await selectDb<{ d: number; t: number }>(
    `SELECT COUNT(DISTINCT day) AS d, COALESCE(SUM(n), 0) AS t FROM idle_spells WHERE day >= ?`,
    [from],
  );
  const r = rows?.[0];
  return { days: Number(r?.d) || 0, spells: Number(r?.t) || 0 };
}

/**
 * 이 전제가 지지되는가 — **판정을 여기서 한다**(화면이 아니라).
 *
 * ⚠⚠ 판정 문장을 하드코딩하지 않고 셋으로 가르는 이유: "구간이 0"과 "표본이 없다"가 같은
 * 0 으로 보이는 것이 이 저장소가 `route_visits` 에서 이미 물린 형태다(그 0 은 *안 쓴다*가
 * 아니라 *앱이 두 번 열렸을 뿐*이었다).
 *
 * @param minDays 로드맵이 적은 검증 기간(3일).
 */
export function idleVerdict(
  rows: readonly IdleRow[],
  sample: { days: number; spells: number },
  minDays = 3,
): { ok: boolean; text: string } {
  if (sample.days < minDays) {
    return { ok: false, text: `관측 ${sample.days}일 — ${minDays}일 미만이면 판정하지 말 것(0 은 "없다"가 아니다)` };
  }
  if (sample.spells === 0) {
    return { ok: false, text: '부재 구간 0 — 앱이 떠 있는 동안 자리를 뜨지 않는다. **트리거를 만들지 말 것**' };
  }
  const perDay = sample.spells / sample.days;
  const avgMin = rows.reduce((t, r) => t + r.sec, 0) / sample.spells / 60;
  /* ⚠ **짧게 자주면 값이 없다.** 5~10분짜리가 하루 열 번이면 그건 "자리를 떴다"가 아니라
     생각하느라 손을 멈춘 것이고, 거기에 알림을 쏘면 정확히 JITAI 가 경고하는 무시 습관을 만든다. */
  if (avgMin < 10) {
    return {
      ok: false,
      text: `평균 ${avgMin.toFixed(0)}분 — 짧게 자주(하루 ${perDay.toFixed(1)}회). 트리거는 방해가 된다`,
    };
  }
  return { ok: true, text: `하루 ${perDay.toFixed(1)}회 · 평균 ${avgMin.toFixed(0)}분 — 트리거가 설 자리가 있다` };
}
