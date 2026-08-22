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
import { addDays, dayDiff, iso, parseISO, todayISO } from './utils';

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

/**
 * **밖에서 일어난 일**(T-11). 앱이 꺼져 있던 동안의 볼트 편집·Anki 복습.
 *
 * ⚠ 위 `AbsenceNow` 와 시제가 같고 **부호가 반대**다. 저기 셋(밀린 복습·미완·마감)은 전부
 * *무너진 것*이라, 그것만 그리면 며칠 만에 연 화면이 **한 일을 없던 것처럼** 말한다 — 볼트에
 * 노트를 다섯 개 쓰고 Anki 를 120장 돌고 온 사람에게 "3개 밀렸어요"만 보여주는 형태다.
 * ⚠⚠ **모르는 것은 `null` 이고 0 이 아니다.** 볼트를 못 읽었거나 Anki 가 안 떠 있는 것과
 * "그 기간에 아무것도 안 했다"는 다른 사실인데, 0 으로 접으면 화면에서 구분이 사라진다.
 */
export interface AbsenceOutside {
  /** 부재 기간에 수정된 볼트 노트 수. 모르면 null. */
  notes: number | null;
  /** 그 노트들의 과목(빈도 순 · 최대 [`OUTSIDE_SUBJECTS`]개). 칩이 아니라 **풀어 쓴 문장**에만 쓴다. */
  subjects: string[];
  /** 부재 기간에 복습한 Anki 카드 수. 모르면 null. */
  ankiCards: number | null;
  /**
   * 볼트에서 **읽지 못한** 폴더 수(O021 · 2026-08-22 운영 축). 0 이면 전량을 봤다.
   *
   * ⚠ `notes` 와 함께 읽어야 한다: 이 값이 0 이 아니면 `notes` 는 **하한**이지 사실이 아니다.
   * 종전엔 그 구분이 없어서 과목 폴더 하나가 재동기화 중일 때 화면이 「밖에서 바뀐 노트 없음」
   * 이라고 말했다 — 「모른다」를 「없다」로 그리는, 이 저장소가 반복해 물린 형태다.
   */
  unreadable: number;
}

/** 문장에 이름을 대는 과목 수 상한. 셋을 넘기면 그건 문장이 아니라 목록이다. */
export const OUTSIDE_SUBJECTS = 3;

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
/* ⚠ **델타 문장 조립을 갈라 둔다**(2026-08-20 리뷰 M-14 원장 축소). 세 축(복습·미완·마감)이
   각자 `parts`/`aria` 두 배열에 밀어 넣는 형태라 분기가 여섯이었고, 그게 `returnBriefing` 의
   인지복잡도 대부분이었다. 이 함수는 **말을 만들 뿐** 무엇을 처방할지는 안 정한다 — 그 판단은
   호출부의 Q-29 순서 규칙이 소유한다(둘을 섞으면 "무엇을 말하나"와 "무엇을 시키나"가 한 덩어리가 된다). */
function delta(snap: AbsenceSnapshot, now: AbsenceNow): { parts: string[]; aria: string[] } {
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
  return { parts, aria };
}

/** T-11 — **밖에서 한 일**은 위 목록에 섞지 않는다. 같은 ` · ` 목록에 넣으면
 *  "복습 18 · 미완 3 · 노트 5" 가 되어 *한 일*이 *밀린 일*과 같은 픽셀로 읽힌다(부호가 반대인데). */
function outsideDid(outside?: AbsenceOutside | null): string[] {
  const did: string[] = [];
  /* ⚠ 일부를 못 읽었으면 **수를 단정하지 않는다**(O021). `노트 5` 와 `노트 5+` 의 차이는
     장식이 아니라, 「이게 전부다」라는 주장을 하느냐 마느냐다. */
  if (outside?.notes) did.push(`노트 ${outside.notes}${outside.unreadable ? '+' : ''}`);
  if (outside?.ankiCards) did.push(`카드 ${outside.ankiCards}`);
  return did;
}

export function returnBriefing(
  snap: AbsenceSnapshot,
  now: AbsenceNow,
  todayDs: string,
  /** T-11 — 밖에서 일어난 일. 안 주면 종전 동작 그대로(브라우저·폰이 그 경로다). */
  outside?: AbsenceOutside | null,
): ReturnBriefing | null {
  if (!snap.lastDs) return null;
  const days = dayDiff(snap.lastDs, todayDs);
  if (days < ABSENCE_MIN_DAYS) return null;

  const { parts, aria } = delta(snap, now);
  const did = outsideDid(outside);
  if (did.length) {
    const where = outside?.subjects.length ? `${outside.subjects.join('·')} 쪽으로 ` : '';
    aria.push(`그동안 앱 밖에서 ${where}${did.join(', ')}만큼 했습니다`);
  }

  // ⚠ 밖에서 한 일**만** 있어도 브리핑은 그린다 — 그게 이 항목의 요지다(할 말이 생겼다).
  if (!parts.length && !did.length) return null;

  /* Q-29 처방 — **순서가 규칙이다**(하나만 말한다 · 셋을 늘어놓으면 다시 목록이 된다):
       ① 마감이 있으면 그것이 이긴다 — 날짜는 협상 대상이 아니다.
       ② 아니면 밀린 복습을 **상한만큼만**. "전부"라고 말하지 않는 것이 이 항목의 전부다.
       ③ 아니면 미완 — 밀린 것을 따라잡는 대신 **오늘 것부터** 시작하라고 말한다.
       ④ (T-11) 앱 안이 평온하고 밖에서만 일이 있었으면 **진도 반영**이 유일하게 남는 행동이다.
     ⚠ 어느 가지도 "따라잡아라"를 말하지 않는다.
     ⚠ 밖에서 한 일이 ①~③ 을 이기지 않는 이유: 그건 *이미 한 일*이라 마감보다 급할 수 없다. */
  const advice = now.deadline
    ? `${now.deadline.name}부터 — 마감이 가장 가깝습니다.`
    : now.review > 0
      ? `오늘은 밀린 복습 중 ${Math.min(RETURN_REVIEW_CAP, now.review)}개만 하세요.`
      : now.missed > 0
        ? `밀린 것은 두고 오늘 블록부터 시작하세요.`
        : outside?.notes
          ? `밖에서 쓴 노트 ${outside.notes}개를 진도에 반영하세요.`
          : `밀린 것은 두고 오늘 블록부터 시작하세요.`;

  const tail = did.length ? ` (밖에서 ${did.join(' · ')})` : '';
  return {
    days,
    line: `${days}일 비었어요${parts.length ? ` — ${parts.join(' · ')}` : ''}${tail}`,
    aria: `${days}일 만의 복귀입니다. ${aria.join(', ')}. ${advice}`,
    advice,
  };
}

/**
 * 두 원장에서 스냅샷을 읽는다. **실패하면 빈 스냅샷** — 관측이 화면을 막으면 안 된다
 * (`visits.ts`·`daySignals.ts` 와 같은 계약).
 */
/**
 * T-11 — 부재 기간에 **밖에서** 일어난 일을 모은다. 실패하면 그 축만 `null`(화면은 그대로 뜬다).
 *
 * ⚠ **창의 시작은 `lastDs` 의 *다음날* 자정**이다. `lastDs` 당일에 한 볼트 편집은 사용자가 앱을
 * 열어 놓고 한 것일 수 있어 "밖에서"라고 부를 수 없다.
 * ⚠ **끝은 지금이다 — `missedSince` 와 경계가 다르고, 그게 의도다.** 저기가 오늘을 빼는 것은
 * *미완을 부재 탓으로 세지 않기 위해서*고(오늘은 아직 안 지나갔다), 여기는 반대다: 오늘 아침
 * 앱을 열기 전에 돈 Anki 도 **앱이 모르는 사이에 일어난 일**이라 브리핑의 대상이다.
 *
 * ⚠ import 를 동적으로 하는 이유: 이 모듈은 **폰 홈**(`phone/TodayView`)도 쓰는데 폰은 이 조각을
 * 부르지 않는다(셸 전용 커맨드 + Anki 는 PC 에 있다). 정적으로 끌면 폰 번들이 볼트·Anki 계열을
 * 통째로 데려간다 — 예산 축 ③(플랫폼별 산출물)이 정확히 그런 새는 것을 잡으라고 있는 축이다.
 */
export async function loadOutside(lastDs: string, todayDs: string): Promise<AbsenceOutside> {
  const fromDs = iso(addDays(parseISO(lastDs), 1));
  const [{ vaultTouched }, { ankiReviewedBetween }] = await Promise.all([import('./tauri'), import('./anki')]);
  const [touched, ankiCards] = await Promise.all([
    vaultTouched(parseISO(fromDs).getTime()),
    ankiReviewedBetween(fromDs, todayDs),
  ]);

  /* 과목은 **빈도 순**이다 — 알파벳 순이면 한 과목에 몰아 쓴 날에도 엉뚱한 이름이 앞에 온다. */
  const freq = new Map<string, number>();
  for (const n of touched?.notes ?? []) {
    const s = n.subject;
    if (s) freq.set(s, (freq.get(s) ?? 0) + 1);
  }
  const subjects = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, OUTSIDE_SUBJECTS)
    .map(([s]) => s);

  return {
    notes: touched ? touched.count : null,
    subjects,
    ankiCards,
    /* ⚠ 조회 자체가 실패했으면(`touched === null`) 그건 이미 `notes: null` 이 말한다 —
       여기서 또 세면 같은 사실을 두 번 말하게 된다. 0 으로 둔다. */
    unreadable: touched?.unreadable ?? 0,
  };
}

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
