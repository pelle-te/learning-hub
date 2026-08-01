/* ============================================================
   lib/absence.ts — **부재 델타**(P-1 · 2026-08-01). "며칠 비었고, 그 사이 무엇이 무너졌나."

   ## 무엇이 없었나

   이 앱의 복귀 지원은 `resume` 커서 하나였는데 그건 **TTL 6시간**이라(`resume.ts`) 정의상
   *며칠 만의 복귀에는 존재하지 않는다*. 그리고 폰 홈·데스크톱 today 는 언제나 **"오늘"만**
   말한다. 그래서 4일 만에 열었을 때 "그 사이 뭐가 밀렸나"를 알려면 복습 탭(밀린 수) →
   계획 탭(미완 블록) → 통계 = **3화면·4클릭**이었다.

   ## 왜 새 저장값이 0인가

   부재 길이는 `route_visits`(N-11)의 **마지막 방문일**에서 나오고, 그때의 값은
   `day_signals`(E23)가 **이미 90일치 적고 있다**. 둘 다 이 항목보다 먼저 존재했고 둘 다
   "쓰기만 하고 읽는 곳이 없다"로 감사에 잡힌 이력이 있다(H23) — 이 모듈이 그 소비처다.
   새 테이블 0 · 서버 DDL 0.

   ⚠⚠ **관측이 없으면 델타를 지어내지 않는다.** `day_signals` 에 그날 행이 없으면 `then` 은
   `null` 이고 문장은 화살표 없이 **현재값만** 말한다. 과거값을 지금 state 로 역산하는 길이
   있긴 한데(`riskSummary(state, days, 그날)`) 그러면 **그 뒤에 지워진 챕터·바뀐 마감이 과거를
   소급해 바꾼다** — 관측된 적 없는 숫자를 관측된 것처럼 그리는 형태라 하지 않는다.
   (`daySignals.ts` 머리주석이 같은 이유로 "지나가면 재구성이 불가능하다"고 적어 뒀다.)

   ⚠ 브라우저(dev·트랙 A)에선 두 원장이 통째로 무동작이라(`isSqlitePrimary()` 가 false)
   `lastDs` 가 null 이고, 그러면 브리핑은 **그리지 않는다**. 시각 베이스라인은 안 흔들린다.
============================================================ */
import { selectDb } from './db/sqlite';
import { dayDiff, todayISO } from './utils';

/** 브리핑을 그리는 최소 부재 일수. 어제 열었으면(1) 부재가 아니다 — 그 화면은 '오늘'이 소유한다. */
export const ABSENCE_MIN_DAYS = 2;

/** 두 원장에서 읽어 온 "마지막으로 본 하루". 관측이 없으면 각 필드가 null 이다. */
export interface AbsenceSnapshot {
  /** 오늘 이전에 앱을 연 마지막 날(ds). 없으면 null. */
  lastDs: string | null;
  /** 그날 관측된 밀린+대기 복습 수. 관측 없으면 null.
   *  ⚠ 원장 열 이름은 `overdue` 지만 담기는 값은 **`overdue + due`** 다(`TodaySignature` 가
   *  `riskN` 을 넣는다). 아래 `AbsenceNow.review` 와 같은 양이어야 화살표가 거짓말을 안 하므로
   *  열 이름이 아니라 **채워지는 값**에 맞춘다 — 이름을 믿고 `overdue` 만 비교하면 델타가
   *  조용히 틀린다. */
  thenReview: number | null;
}

/** 브리핑에 필요한 지금 값 — 전부 호출부가 이미 들고 있는 것들이다(신규 IO 0). */
export interface AbsenceNow {
  /** 지금 밀린+대기 복습 수. */
  review: number;
  /** 부재 기간에 배치됐지만 완료되지 않은 학습 블록 수. `missedSince` 산출값. */
  missed: number;
  /** 가장 가까운 마감(있으면). */
  deadline: { name: string; dday: number } | null;
}

export interface ReturnBriefing {
  /** 비어 있던 일수(마지막 방문일 → 오늘). */
  days: number;
  /** 사람이 읽는 한 줄. */
  line: string;
  /** SR·title 용 — 같은 사실의 풀어 쓴 형태. */
  aria: string;
  /**
   * **Q-29 처방** — 숫자 다음에 오는 *하라는 말* 한 마디.
   *
   * ⚠ 종전엔 이 칩이 13px 안에 숫자를 최대 6개 담고 **행동 정보가 0**이었다. 복귀한 사람에게
   * 필요한 것은 "얼마나 밀렸나"가 아니라 "그래서 지금 뭘 하나"다 — 숫자만 주면 그건 정보가
   * 아니라 부재에 대한 지적이 된다(방향 §2 (d)의 정반대).
   * ⚠⚠ 처방의 원칙은 하나다: **재건된 첫 계획은 깨진 계획보다 작아야 한다.** 그래서 어떤
   * 처방도 "전부 따라잡아라"라고 말하지 않는다 — 그 말이 복귀 첫날을 다시 실패로 만든다.
   */
  advice: string;
}

/** 복귀 첫날에 권하는 복습 상한(개). 밀린 전부가 아니라 **한 줌**이다(위 원칙). */
export const RETURN_REVIEW_CAP = 3;

/** 부재 기간 판정에 쓰는 블록 한 개. `ds` 는 배치된 날, `done` 은 완료 여부. */
export interface PlannedBlock {
  ds: string;
  done: boolean;
}

/**
 * 부재 기간(`lastDs` 다음날 ~ 어제)에 배치됐는데 **완료되지 않은** 블록 수.
 *
 * ⚠ 경계가 양쪽 다 열려 있는 것이 의도다. `lastDs` 당일은 사용자가 **봤고**(그날 안 한 것은
 * 부재의 결과가 아니라 그날의 선택이다), 오늘은 아직 안 지나갔다(미완이 아니라 할 일이다).
 * 이 경계를 닫으면 브리핑이 "네가 오늘 아직 안 한 것"까지 부재 탓으로 세어 죄책감만 키운다.
 */
export function missedSince(blocks: readonly PlannedBlock[], lastDs: string, todayDs: string): number {
  let n = 0;
  for (const b of blocks) {
    if (b.done) continue;
    if (b.ds <= lastDs || b.ds >= todayDs) continue;
    n++;
  }
  return n;
}

/**
 * 복귀 브리핑 한 줄. 부재가 {@link ABSENCE_MIN_DAYS} 미만이거나 말할 것이 없으면 **null**
 * (0·평온은 아무것도 안 그린다 — 이 앱의 빈 상태 규율).
 *
 * ⚠ 말할 것이 없다 = 복습도 그대로고 미완도 0이고 마감도 없다. 그때 `4일 비었어요` 만 남기면
 * 그건 정보가 아니라 **부재 자체에 대한 지적**이다(방향 §2 (d)의 정반대). 부재 길이는 델타의
 * *맥락*이지 델타가 아니다.
 */
export function returnBriefing(snap: AbsenceSnapshot, now: AbsenceNow, todayDs: string): ReturnBriefing | null {
  if (!snap.lastDs) return null;
  const days = dayDiff(snap.lastDs, todayDs);
  if (days < ABSENCE_MIN_DAYS) return null;

  const parts: string[] = [];
  const aria: string[] = [];
  /* 복습은 **늘어난 경우에만** 화살표로 말한다 — 줄었거나 같으면 그건 부재의 결과가 아니다
     (관측이 없으면 `then` 이 null 이라 자연히 현재값만 남는다). */
  if (snap.thenReview != null && now.review > snap.thenReview) {
    parts.push(`복습 ${snap.thenReview}→${now.review}`);
    aria.push(`밀린 복습이 ${snap.thenReview}개에서 ${now.review}개로 늘었습니다`);
  } else if (now.review > 0) {
    parts.push(`복습 ${now.review}`);
    aria.push(`밀린 복습 ${now.review}개`);
  }
  if (now.missed > 0) {
    parts.push(`미완 ${now.missed}`);
    aria.push(`그 사이 미완 블록 ${now.missed}개`);
  }
  if (now.deadline) {
    parts.push(`${now.deadline.name} D-${now.deadline.dday}`);
    aria.push(`가장 가까운 마감은 ${now.deadline.name} D-${now.deadline.dday}`);
  }
  if (!parts.length) return null;

  /* Q-29 처방 — **순서가 규칙이다**(하나만 말한다 · 셋을 늘어놓으면 다시 목록이 된다):
       ① 마감이 있으면 그것이 이긴다 — 날짜는 협상 대상이 아니다.
       ② 아니면 밀린 복습을 **상한만큼만**. "전부"라고 말하지 않는 것이 이 항목의 전부다.
       ③ 아니면 미완 — 밀린 것을 따라잡는 대신 **오늘 것부터** 시작하라고 말한다.
     ⚠ 어느 가지도 "따라잡아라"를 말하지 않는다. */
  const advice = now.deadline
    ? `${now.deadline.name}부터 — 마감이 가장 가깝습니다.`
    : now.review > 0
      ? `오늘은 밀린 복습 중 ${Math.min(RETURN_REVIEW_CAP, now.review)}개만 하세요.`
      : `밀린 것은 두고 오늘 블록부터 시작하세요.`;

  return {
    days,
    line: `${days}일 비었어요 — ${parts.join(' · ')}`,
    aria: `${days}일 만의 복귀입니다. ${aria.join(', ')}. ${advice}`,
    advice,
  };
}

/**
 * 두 원장에서 스냅샷을 읽는다. **실패하면 빈 스냅샷** — 관측이 화면을 막으면 안 된다
 * (`visits.ts`·`daySignals.ts` 와 같은 계약).
 */
export async function loadAbsence(todayDs: string = todayISO()): Promise<AbsenceSnapshot> {
  const empty: AbsenceSnapshot = { lastDs: null, thenReview: null };
  try {
    const visit = await selectDb<{ last: string | null }>(`SELECT MAX(day) AS last FROM route_visits WHERE day < ?`, [
      todayDs,
    ]);
    const lastDs = visit?.[0]?.last ?? null;
    if (!lastDs) return empty;
    const sig = await selectDb<{ overdue: number }>(`SELECT overdue FROM day_signals WHERE ds = ?`, [lastDs]);
    const overdue = sig?.[0]?.overdue;
    return { lastDs, thenReview: typeof overdue === 'number' ? overdue : null };
  } catch {
    return empty;
  }
}
