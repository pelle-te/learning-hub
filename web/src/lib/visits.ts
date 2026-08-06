/* ============================================================
   lib/visits.ts — 방문 원장(N-11). 이 앱이 **자기 사용을 관측하지 못하던** 공백을 메운다.

   25탭 중 무엇을 실제로 여는지 앱은 모른다(`shell/recent.ts` 는 팔레트 명령 LRU 뿐이고
   `lib/telemetry.ts` 는 에러만 보낸다). 2026-07-25 발산에서 **세 각도가 독립적으로
   "관측이 없어 결정 불가"에서 멈췄다** — 탭 은퇴 근거·폰 뷰 사용 여부·all-clear 빈도.
   여기서 세는 것은 그 결정들의 입력이지 그 자체로 화면이 되는 값이 아니다(UI 는 뒤에).

   ## ⚠ 진입 경로(`Via`)를 반드시 쪼갠다

   방문 수는 **가치가 아니라 접근성의 함수**다 — 레일에 있으니 눌린다. 합계만 세면
   _숨겨서 안 쓰이게 만든 것을 안 쓰인다고 지우는_ 순환에 빠지고, 그 순환은 데이터가
   있다는 이유로 **더 자신 있게** 틀린다. 레일을 지웠을 때 ⌘K·딥링크 방문이 남는지가
   "이 목적지가 필요한가"의 진짜 신호다.

   ## 왜 호출부가 `markVia` 로 알려 주는가

   내비게이션은 22곳에서 일어나고 그중 대부분은 `navigate('/x')` 한 줄이다. 각 자리에서
   기록 함수를 부르게 하면 새 링크가 생길 때마다 빠뜨리고, 빠진 것은 **0 으로 보인다**
   (없는 데이터와 안 센 데이터가 구분되지 않는다 — 이 저장소가 반복해서 물린 형태).
   그래서 계수는 **App 의 pathname 이펙트 한 곳**이 하고, 호출부는 "내가 눌렀다"는
   힌트만 남긴다. 힌트가 없으면 `link`(본문 안 링크)로 떨어지므로 **누락이 곧 오분류이지
   유실이 아니다.**

   ⚠ 힌트에 유효기간을 둔다. `markVia` 후 내비게이션이 실제로 일어나지 않으면(막힌 링크·
   같은 경로 클릭) 그 값이 남아 **다음 내비게이션을 오염**시킨다. 1초를 넘기면 버린다.

   ⚠ 브라우저(dev·트랙 A)에선 `getDb()` 가 null 이라 통째로 무동작이다 — 트랙 A 시각 베이스라인과
   개발 경로는 이 파일이 없는 것과 똑같이 돈다.
============================================================ */
import { execDb, isSqlitePrimary, selectDb } from './db/sqlite';
import { addDays, iso, parseISO, todayISO } from './utils';

/** 목적지에 **어떻게 도달했는가**. 합쳐서 세면 안 되는 이유는 머리주석. */
export type Via =
  /** 레일 사이드바(상시 노출 = 가장 싼 경로) */
  | 'rail'
  /** 호스트 상단 세그먼트(SubTabs) */
  | 'seg'
  /** ⌘K 팔레트 — 이름을 알고 찾아간 것 */
  | 'palette'
  /** `g`+키 · `[`/`]` 링 — 손가락이 외운 것 */
  | 'key'
  /** 본문 안 링크·칩·버튼(힌트 없는 내비게이션의 기본값) */
  | 'link'
  /** 앱을 열었을 때의 첫 착지(= 딥링크이거나 그냥 기본 경로) */
  | 'boot'
  /** 폰 웹앱의 뷰 전환(H23 · 2026-07-26 감사). 데스크톱 레일/세그와 **같은 축에 놓지 않는다** —
   *  폰은 화면이 다섯이고 진입 수단이 하단 탭바 하나뿐이라, 섞으면 접근성 함수가 달라진 것을
   *  같은 잣대로 비교하게 된다. 이 값이 있어야 머리주석이 든 동기 셋 중 **"폰 뷰 사용 여부"**
   *  가 실제로 측정된다(그전엔 폰이 `app/` 을 안 써서 계측이 도달하지 않았다 —
   *  2주 뒤 나올 0 은 "폰 안 씀"이 아니라 "안 쟀음"이었다). */
  | 'phone';

/** 힌트 유효 시간(ms) — 이걸 넘긴 `markVia` 는 버린다(머리주석). */
const HINT_TTL = 1000;

/** 보존기간(일). 어떤 IA 결정도 석 달이면 충분하고, 이 표는 무한 성장할 이유가 없다. */
const KEEP_DAYS = 90;

let _hint: { via: Via; at: number } | null = null;
/* 마지막으로 청소한 날(ds). ⚠⚠ 종전엔 부울이라 **세션당 1회**였고, 데스크톱 셸은 며칠씩 열려
   있으므로 보존창이 `KEEP_DAYS + 세션 길이`로 조용히 늘어났다(H24 · 2026-07-30). 90일이라 적고
   120일을 들고 있는 셈이다 — 날짜를 기억하면 자정을 넘긴 첫 기록이 다시 청소한다(하루 1회 유지). */
let _prunedOn: string | null = null;

/**
 * "지금부터 일어날 내비게이션은 이 경로로 들어간 것" — 호출 직후 {@link HINT_TTL} 안에만 유효.
 *
 * ⚠ `now` 를 **양쪽 다** 인자로 뺀 것이 의도다. 한쪽만 주입하면 테스트가 두 시계를 섞어
 * 쓰게 되고(마크는 실시계·소비는 가짜), TTL 검사가 조용히 무의미해진다 — 실제로 이 파일의
 * 첫 판이 그렇게 통과했다.
 */
export function markVia(via: Via, now: number = Date.now()): void {
  _hint = { via, at: now };
}

/** 힌트를 소비한다(1회용). 없거나 낡았으면 `fallback`. */
export function takeVia(fallback: Via, now: number = Date.now()): Via {
  const h = _hint;
  _hint = null;
  if (!h || now - h.at > HINT_TTL) return fallback;
  return h.via;
}

/** 테스트 격리용 — 모듈 전역 힌트를 비운다. */
export function resetVia(): void {
  _hint = null;
  _prunedOn = null;
}

/** 원장 한 줄(요약 읽기용). */
export interface VisitRow {
  key: string;
  via: Via;
  n: number;
}

/**
 * 최근 `days` 일의 방문 합계(많은 순). **소비처가 없는 계측은 계측이 아니다**(H23).
 *
 * 도입 나흘 뒤 감사가 잡은 것: 이 원장은 쓰기만 있고 **읽는 곳이 0** 이었고, 그동안 로드맵의
 * 다섯 항목이 이 데이터를 기다리고 있었다. 사람이 값을 볼 수 없으면 "쌓이고 있다"는 믿음만
 * 쌓인다 — 실제로 폰 계측은 도달조차 못 하고 있었고, 리드아웃이 있었다면 첫날에 드러났다.
 */
export async function visitSummary(days = 14, todayDs: string = todayISO()): Promise<VisitRow[]> {
  const from = iso(addDays(parseISO(todayDs), -days));
  const rows = await selectDb<{ key: string; via: string; n: number }>(
    `SELECT key, via, SUM(n) AS n FROM route_visits WHERE day >= ? GROUP BY key, via ORDER BY n DESC`,
    [from],
  );
  return (rows ?? []).map((r) => ({ key: String(r.key), via: String(r.via) as Via, n: Number(r.n) || 0 }));
}

/**
 * 표본이 판정을 지지하는가 — **분모**(P1/P2 · 2026-08-01 `/감사 근본` · 사용자 승인).
 *
 * ## ⚠⚠ 왜 합계와 따로 있는가
 *
 * `visitSummary()` 는 **분자**만 준다("이 탭이 몇 번 열렸나"). 그런데 `shell/tabs.ts` 가
 * 사전등록한 은퇴 규칙은 그 분자만 보고 *"미만이면 삭제"* 한다 — 그래서 **관측이 없는 상태와
 * 안 쓰는 상태를 구분하지 못한다.** 실측(2026-08-01): 실 DB 의 `route_visits` 는 **2행 · 키 1개 ·
 * 날짜 1일**이었다. 그 규칙을 그대로 실행하면 8/12 에 합계 0 이 나오고 탭이 지워지는데, 그 0 은
 * "안 쓴다"가 아니라 **"앱이 두 번 열렸을 뿐"** 이다.
 *
 * 이 파일 머리주석이 이미 경고한 순환(*"자명한 0 을 근거로 쓰면 그건 관측이 아니라 순환"*)이
 * 정확히 그 규칙에 발동한 것이고, 이 저장소가 스냅샷·a11y 에서 두 번 물린 **"녹색이 '회귀 없음'이
 * 아니라 '안 쟀음'을 뜻하는"** 형태와 같다. 그래서 분모를 **화면에 올린다** — 판정하는 사람이
 * 분자만 보고 결론 내릴 수 없게.
 *
 * @returns `days` = 실제 관측된 **서로 다른 날짜 수**, `total` = 전 출처 방문 합.
 */
export async function visitSample(days = 14, todayDs: string = todayISO()): Promise<{ days: number; total: number }> {
  const from = iso(addDays(parseISO(todayDs), -days));
  const rows = await selectDb<{ d: number; t: number }>(
    `SELECT COUNT(DISTINCT day) AS d, COALESCE(SUM(n), 0) AS t FROM route_visits WHERE day >= ?`,
    [from],
  );
  const r = rows?.[0];
  return { days: Number(r?.d) || 0, total: Number(r?.t) || 0 };
}

/** 판정을 내릴 만큼 표본이 쌓였는가(`tabs.ts` 의 은퇴 규칙 ①단계와 **같은 임계**). */
export const SAMPLE_MIN = { days: 10, total: 30 } as const;
export const hasSample = (s: { days: number; total: number }): boolean =>
  s.days >= SAMPLE_MIN.days && s.total >= SAMPLE_MIN.total;

/* ── 홉 원장(W2 · 발산 6회차) ───────────────────────────────────────────────
   007 이 "어디를 열었나"를 셌다면 여기는 **"무엇 다음에 무엇을, 몇 시에"** 를 센다.
   막고 있던 결정 셋이 여기 걸려 있다(마이그레이션 010 머리주석이 SSOT):
   ① 두 페인 — `A→B→A` 왕복이 실재하나 ② 조명이 상수인가 ③ 저녁에 앱을 여나.

   ⚠⚠ **셋 다 "안 만든다"가 정당한 답이다.** 그래서 계측이 먼저다 — 이 저장소는 관측을
   기다리면서 관측 장치를 안 다는 순환에 T-5·T-8·T-10 에서 이미 물렸다. */

/** 왕복쌍 한 줄 — `a` 와 `b` 사이를 오간 횟수(방향 합산). */
export interface RoundTrip {
  a: string;
  b: string;
  /** `a→b` + `b→a` 합. 한 방향만 있으면 왕복이 아니다(아래 참조). */
  n: number;
}

/**
 * 최근 `days` 일의 **왕복쌍**(많은 순).
 *
 * ⚠⚠ **양방향이 모두 있어야 왕복이다.** `a→b` 만 100번인 것은 왕복이 아니라 *경로*이고
 * (예: 레일 → 호스트), 두 페인이 없애려는 마찰은 **오가는 것**이지 가는 것이 아니다.
 * 한 방향만 세면 목록 상단이 전부 단방향 경로로 차서 판정이 뒤집힌다.
 * ⚠ 자기 자신으로의 홉(`a===b`)은 안 센다 — 같은 화면 안의 쿼리 변경이 그렇게 보인다.
 */
export async function roundTrips(days = 14, todayDs: string = todayISO()): Promise<RoundTrip[]> {
  const from = iso(addDays(parseISO(todayDs), -days));
  const rows = await selectDb<{ from_key: string; to_key: string; n: number }>(
    `SELECT from_key, to_key, SUM(n) AS n FROM route_hops WHERE day >= ? AND from_key <> to_key GROUP BY from_key, to_key`,
    [from],
  );
  const dir = new Map<string, number>();
  for (const r of rows ?? []) dir.set(`${r.from_key} ${r.to_key}`, Number(r.n) || 0);
  const seen = new Set<string>();
  const out: RoundTrip[] = [];
  for (const [k, n] of dir) {
    const [a = '', b = ''] = k.split(' ');
    const back = dir.get(`${b} ${a}`);
    if (!back) continue; // 단방향 = 경로이지 왕복이 아니다
    const pair = a < b ? `${a} ${b}` : `${b} ${a}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    out.push({ a: a < b ? a : b, b: a < b ? b : a, n: n + back });
  }
  return out.sort((x, y) => y.n - x.n || (x.a + x.b < y.a + y.b ? -1 : 1));
}

/**
 * 최근 `days` 일의 **시각 분포** — 길이 24 배열(로컬 시각 버킷).
 *
 * ⚠ 이 값이 답하는 것은 "몇 번 썼나"가 아니라 **"하루 중 언제 여나"** 다. 한 시각에 몰려
 * 있으면 조명(캔버스가 하루의 위치를 싣는 안)은 상수가 되어 값이 0이고, 저녁이 비어 있으면
 * 내일 확정판은 **저녁판이 아니라 아침판**이어야 한다.
 */
export async function hourHistogram(days = 14, todayDs: string = todayISO()): Promise<number[]> {
  const from = iso(addDays(parseISO(todayDs), -days));
  const rows = await selectDb<{ hour: number; n: number }>(
    `SELECT hour, SUM(n) AS n FROM route_hops WHERE day >= ? GROUP BY hour`,
    [from],
  );
  const out = Array<number>(24).fill(0);
  for (const r of rows ?? []) {
    const h = Number(r.hour);
    if (Number.isInteger(h) && h >= 0 && h < 24) out[h] = (out[h] ?? 0) + (Number(r.n) || 0);
  }
  return out;
}

/** 저녁(18~24시) 방문 비율 — 내일 확정판이 **저녁판인가 아침판인가**를 가르는 유일한 수. */
export function eveningShare(hist: readonly number[]): number {
  const total = hist.reduce((t, n) => t + n, 0);
  if (!total) return 0;
  return hist.slice(18, 24).reduce((t, n) => t + n, 0) / total;
}

/**
 * 홉 1회를 기록한다. **실패해도 조용히 넘어간다**(`recordVisit` 과 같은 계약).
 *
 * ⚠ `from` 이 없으면(부팅 첫 착지) 기록하지 않는다 — 홉이 아니라 시작점이고, `boot` 는
 * `route_visits` 가 이미 `via` 로 센다. 여기에 빈 문자열을 넣으면 그 행이 왕복쌍 집계에서
 * 유령 노드가 된다.
 */
export async function recordHop(
  from: string | null,
  to: string,
  todayDs: string = todayISO(),
  hour: number = new Date().getHours(),
): Promise<void> {
  if (!isSqlitePrimary() || !from || from === to) return;
  await execDb(
    `INSERT INTO route_hops (from_key, to_key, day, hour, n) VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(from_key, to_key, day, hour) DO UPDATE SET n = n + 1`,
    [from, to, todayDs, hour],
  );
}

/**
 * 방문 1회를 기록한다. **실패해도 조용히 넘어간다** — 관측이 앱 동작을 막으면 안 된다.
 *
 * ⚠ `await` 하지 않는 호출을 전제로 만들었다(내비게이션은 사용자 입력 경로다).
 * 반환 Promise 는 테스트가 쓴다.
 */
export async function recordVisit(key: string, via: Via, todayDs: string = todayISO()): Promise<void> {
  if (!isSqlitePrimary()) return;
  await execDb(
    `INSERT INTO route_visits (key, day, via, n) VALUES (?, ?, ?, 1)
     ON CONFLICT(key, day, via) DO UPDATE SET n = n + 1`,
    [key, todayDs, via],
  );
  // 청소는 **하루 1회**로 족하다 — 매 내비게이션마다 DELETE 를 쏘면 관측이 관측 대상보다 비싸진다.
  if (_prunedOn !== todayDs) {
    _prunedOn = todayDs;
    const cutoff = iso(addDays(parseISO(todayDs), -KEEP_DAYS));
    await execDb(`DELETE FROM route_visits WHERE day < ?`, [cutoff]);
    /* ⚠ 홉 원장도 **같은 자리에서** 청소한다. 별도 게이트를 두면 두 표의 보존창이 갈리고,
       그건 007 이 `_prunedOn` 을 부울에서 날짜로 고치며 이미 한 번 물린 형태다(90일이라
       적고 120일을 들고 있던 것). 한 번 도는 김에 둘 다 자른다. */
    await execDb(`DELETE FROM route_hops WHERE day < ?`, [cutoff]);
  }
}
