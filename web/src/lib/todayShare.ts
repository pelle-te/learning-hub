/* ============================================================
   lib/todayShare.ts — **적재량이 아니라 오늘 몫**(A-10 · W7 · 발산 6회차).

   ## 무엇이 틀렸나

   '오늘 밖' 스트립의 세 신호(`복습 N개 밀림` · `열린 보충 N건` · 밀린 Anki)는 전부 **적재량**을
   말했고, 화면이 이미 알고 있는 `freeLeftMin`(오늘 남은 자유 시간)과 **연결이 0** 이었다.
   그래서 `12` 같은 수가 뜨는데, 그 12는 **어떤 행동으로도 오늘 안에 0이 될 수 없다** — 그건
   목표가 아니라 마비다. 알림(A-1)이 같은 이유로 수를 버리고 한 조각을 부르게 됐는데,
   **화면은 여전히 수를 들이밀고 있었다**(두 표면이 같은 사실을 다르게 말한다).

   ## 규칙 하나 — **오늘 들어가는 만큼만 센다**

   남은 자유 시간을 복습 블록 길이로 나눈 것이 오늘의 상한이다. 그 상한과 실제 적재량 중
   **작은 쪽**이 오늘 몫이고, 나머지는 *수로 말하지 않는다*("남은 것은 내일") — 그 문장이 A-1 의
   화법과 같아야 두 표면이 한 목소리가 된다.

   ⚠ **0을 만들 수 있는 수만 보여 준다**가 이 파일의 전부다. 오늘 몫이 0이면(시간이 없다)
     "지금은 시간이 없다"고 말하지 `12`라고 말하지 않는다.
   ⚠ 적재량을 **버리지 않는다** — `total` 로 남긴다. 상세를 보러 간 사람에게는 여전히 필요한
     값이고, 이 항목이 없애려는 것은 *첫 화면이 그 수를 들이미는 것*이지 그 수 자체가 아니다.
   ⚠ 순수다: 시계·스토어를 안 읽는다(호출부가 이미 아는 값만 받는다). 그래야 "12가 2가 된다"는
     규칙 자체를 유닛으로 잴 수 있다.
============================================================ */

/** 오늘 몫 한 축(복습 또는 보충). */
export interface Share {
  /** 오늘 실제로 손댈 수 있는 수(0 이상). */
  today: number;
  /** 전체 적재량 — 상세 화면이 쓴다(첫 화면은 위 `today` 만 말한다). */
  total: number;
}

export interface ShareInput {
  /** 밀린 복습 챕터 수. */
  overdue: number;
  /** 열린 보충 건수. */
  backlog: number;
  /** 오늘 남은 자유 시간(분). 모르면 0 — 그때는 오늘 몫도 0이다(지어내지 않는다). */
  freeLeftMin: number;
  /** 복습 1블록 분(`reviewBlockMin`). 새 상수를 만들지 않는다. */
  reviewMin: number;
}

/**
 * 적재량 + 남은 시간 → **오늘 몫**.
 *
 * ⚠ 복습이 보충보다 먼저 시간을 가져간다 — 밀린 복습은 시간이 갈수록 비싸지고(망각) 보충은
 * 그렇지 않다. `pickReminderLead` 가 같은 순서를 쓰고, 두 표면이 다른 순서를 쓰면 알림이
 * 부른 것과 화면이 세는 것이 어긋난다.
 */
export function todayShare(i: ShareInput): { review: Share; backlog: Share; slots: number } {
  const slots = i.reviewMin > 0 ? Math.max(0, Math.floor(i.freeLeftMin / i.reviewMin)) : 0;
  const review = Math.min(Math.max(0, i.overdue), slots);
  const backlog = Math.min(Math.max(0, i.backlog), slots - review);
  return {
    review: { today: review, total: Math.max(0, i.overdue) },
    backlog: { today: backlog, total: Math.max(0, i.backlog) },
    slots,
  };
}

/**
 * 사람이 읽는 한 줄. **수는 오늘 몫만** 쓴다(A-1 과 같은 화법).
 *
 * @returns 말할 것이 없으면 `null` — 없는 일을 문장으로 만들지 않는다.
 */
export function shareLine(s: { review: Share; backlog: Share; slots: number }): string | null {
  const load = s.review.total + s.backlog.total;
  if (load <= 0) return null;
  /* 시간이 없는데 적재량은 있는 상태 — **수를 말하지 않는다.** 여기서 `12` 를 보여 주면 그건
     정확히 이 항목이 없애려는 마비이고, 게다가 오늘은 손댈 수도 없다. */
  if (s.slots <= 0) return '오늘은 시간이 없어요 — 남은 건 내일 몫';
  const n = s.review.today + s.backlog.today;
  if (n <= 0) return '오늘 몫은 끝났어요';
  const rest = load - n;
  return rest > 0 ? `오늘은 ${n}개면 충분` : `${n}개면 오늘 몫은 끝`;
}
