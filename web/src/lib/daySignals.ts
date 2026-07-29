/* ============================================================
   lib/daySignals.ts — 하루 신호 원장(E23 · 2026-07-29).

   ## 무엇을 재는가 — 미지수 하나다

   E8 이 오늘 탭 하단 스트립을 "말할 것이 있을 때만 그린다"로 바꿨다(그전엔 all-clear 인 날에도
   `마감 임박 없음`·`열린 보충 0 건` 을 그렸다). 그 변경의 값어치는 **all-clear 가 얼마나 자주
   오는가**에 달려 있다 — 거의 안 오면 금도금이고, 자주 오면 매일 0의 벽을 치우는 것이다.
   로드맵은 '정적(quiet)의 설계'를 그 한 가지 이유로 Later 에 묶어 뒀다. 아이디어가 아니라
   계기가 없었다(`visits.ts` 가 IA 결정에 대해 받은 것과 같은 진단).

   ## ⚠ 조용함의 정의는 **화면과 같은 규칙**이어야 한다

   `isQuiet` 는 오늘 탭 스트립의 표시 조건을 그대로 옮긴 것이다(마감 임박 · Anki due>0 ·
   열린 보충 셋 중 아무것도 없으면 스트립 줄 자체가 없다). 여기서 조건을 다시 정하면
   "우리가 재는 조용함"과 "사용자가 보는 조용함"이 갈리고, 그 차이는 아무 데도 안 적힌다.
   화면 쪽 조건이 바뀌면 이 함수도 함께 바뀌어야 한다 — 유닛이 그 쌍을 문장으로 잠근다.

   ## ⚠ 쓰기만 하는 계측은 계측이 아니다

   `visits.ts` 는 도입 나흘 뒤 감사에서 **읽는 곳이 0** 으로 잡혔다(H23). 그동안 로드맵 다섯
   항목이 그 데이터를 기다렸고, 사람이 값을 볼 수 없으니 "쌓이고 있다"는 믿음만 쌓였다.
   그래서 이 모듈은 `quietSummary()` 를 함께 낸다 — 소비처(연동 탭 텔레메트리)와 같은 커밋에서.

   ⚠ 브라우저(dev·트랙 A)에선 `getDb()` 가 null 이라 통째로 무동작이다.
============================================================ */
import { execDb, isSqlitePrimary, selectDb } from './db/sqlite';
import { addDays, iso, parseISO, todayISO } from './utils';

/** 하루치 관측. `ankiDue` 는 **미연결이면 -1** — 0(없음)과 구분한다(모름 ≠ 없음). */
export interface DaySignal {
  pending: number;
  overdue: number;
  backlog: number;
  ankiDue: number;
  dueSoon: number;
}

/** 보존기간(일). 빈도 판단에 석 달이면 충분하고, 이 표는 무한 성장할 이유가 없다. */
const KEEP_DAYS = 90;

/**
 * 그날 하단 스트립이 **아무것도 안 그렸는가**(= 조용한 날).
 *
 * ⚠ 조건은 `features/today/TodaySignature` 의 `stripGroups` 와 **같은 규칙**이다:
 * 마감 임박(`dueSoon>0`) · Anki(`ankiDue>0`) · 열린 보충(`backlog>0`) 셋 중 하나라도 있으면
 * 스트립이 존재한다. `ankiDue === -1`(미연결)은 그리지 않으므로 조용함에 기여한다.
 * ⚠ `pending`·`overdue` 는 **판정에 안 들어간다** — 스트립이 그 둘을 그리지 않기 때문이다
 * (남은 블록은 흐름 레일이, 밀린 복습은 레일 신호가 소유한다). 재되 판정엔 안 쓴다.
 */
export function isQuiet(s: DaySignal): boolean {
  return s.dueSoon === 0 && s.ankiDue <= 0 && s.backlog === 0;
}

/**
 * 하루 신호를 남긴다(같은 날이면 **마지막 관측이 이긴다**).
 *
 * 값은 하루 동안 변하므로(블록을 끝내면 pending 이 준다) upsert 로 최신을 남긴다 — 그것이
 * "하루가 어떻게 끝났나"에 가장 가깝다. 정오에 앱을 닫으면 정오 값이 남고, 그건 거짓이 아니라
 * **그날 마지막으로 관측된 사실**이다.
 *
 * ⚠ 실패해도 조용히 넘어간다 — 관측이 앱 동작을 막으면 안 된다(`visits.ts` 와 같은 계약).
 */
export async function recordDaySignal(s: DaySignal, todayDs: string = todayISO()): Promise<void> {
  if (!isSqlitePrimary()) return;
  await execDb(
    `INSERT INTO day_signals (ds, pending, overdue, backlog, anki_due, due_soon)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(ds) DO UPDATE SET
       pending = excluded.pending, overdue = excluded.overdue, backlog = excluded.backlog,
       anki_due = excluded.anki_due, due_soon = excluded.due_soon`,
    [todayDs, s.pending, s.overdue, s.backlog, s.ankiDue, s.dueSoon],
  );
}

/** 세션당 1회 청소 — 매 갱신마다 DELETE 를 쏘면 관측이 관측 대상보다 비싸진다. */
let _pruned = false;

export async function pruneDaySignals(todayDs: string = todayISO()): Promise<void> {
  if (_pruned || !isSqlitePrimary()) return;
  _pruned = true;
  await execDb(`DELETE FROM day_signals WHERE ds < ?`, [iso(addDays(parseISO(todayDs), -KEEP_DAYS))]);
}

/**
 * 최근 `days` 일 중 **관측된 날**과 그중 **조용했던 날**.
 *
 * ⚠ 분모가 `days` 가 아니라 `observed` 인 것이 중요하다 — 앱을 안 연 날은 조용했는지 알 수
 * 없고, 그걸 조용한 날로 세면 "안 썼다"가 "평온했다"로 둔갑한다(없는 데이터와 안 센 데이터를
 * 섞지 않는다 — 이 저장소가 반복해 물린 형태).
 */
export async function quietSummary(
  days = 14,
  todayDs: string = todayISO(),
): Promise<{ observed: number; quiet: number }> {
  const from = iso(addDays(parseISO(todayDs), -days));
  const rows = await selectDb<{ backlog: number; anki_due: number; due_soon: number }>(
    `SELECT backlog, anki_due, due_soon FROM day_signals WHERE ds >= ?`,
    [from],
  );
  const list = rows ?? [];
  const quiet = list.filter((r) =>
    isQuiet({
      pending: 0,
      overdue: 0,
      backlog: Number(r.backlog),
      ankiDue: Number(r.anki_due),
      dueSoon: Number(r.due_soon),
    }),
  ).length;
  return { observed: list.length, quiet };
}
