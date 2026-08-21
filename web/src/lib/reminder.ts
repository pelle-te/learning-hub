/* ============================================================
   reminder.ts — **T-6 예약 한 발**의 판정(순수 · React 무관).

   ## 왜 이 앱이 먼저 말을 건 적이 없었나

   개입 채널이 **0개**였다. P-8 이 알림을 고쳤지만(웹 `Notification` 이 `tauri://` 에서 항상
   거부되던 것) 그건 *세션 종료 알림* 하나였고, 그것도 앱이 열려 있고 사용자가 집중 세션을
   돌리는 중에만 뜬다. 즉 **앱을 안 여는 날에는 아무 일도 안 일어난다** — 그리고 그게 정확히
   말을 걸어야 하는 날이다.

   ## ⚠⚠ "하루 최대 1회"가 이 항목의 전부다

   여러 발이면 그건 다른 항목(알림 스트림)이고, 로드맵이 걸러낸 것이다(_"같은 사실을 두 번
   말할 위험 — 알림 피로의 교과서적 시작"_). 그래서 판정이 셋뿐이다: **시각이 지났나 ·
   오늘 이미 쐈나 · 말할 것이 있나.** 셋째가 특히 중요하다 — **할 일이 0 이면 안 쏜다.**
   "오늘 밀린 것 없어요"는 정보가 아니라 방해이고, 그 한 번이 다음 알림의 신뢰를 깎는다.

   ## 왜 프런트인가 (그리고 왜 T-3 이 선행인가)

   `tauri-plugin-notification` 에 **스케줄 API 가 없다**(v2 문서 확인 2026-08-02) — 발사 시각에
   프로세스가 살아 있어야 하고, 우회가 없다. 그래서 T-3(상주 트레이 + 자동 시작)이 원리적
   선행이다. 프로세스가 살아 있다면 시각 판정은 그냥 타이머라, 굳이 Rust 로 내릴 이유가 없다
   (내리면 "무엇을 말할까"가 앱 상태를 알아야 해서 계산이 두 벌이 된다).

   ⚠ **시각을 지나쳐 켜도 쏜다**(자정~시각 사이에 앱을 켠 경우). 지나쳤다고 건너뛰면 상주
   모드가 아닌 기기에서는 **영원히 안 쏘는** 상태가 되는데, 그 기기가 알림이 가장 필요한 쪽이다.
============================================================ */

/** `HH:MM` → 자정 기준 분. 형식이 아니면 null(사용자 입력을 신뢰하지 않는다). */
/* ⚠⚠ **여기 알림 발사 판정(`minutesOfDay`·`shouldFire`)이 있었다 — 은퇴했다**(I049 ·
   2026-08-22 발상 축). 그것을 부르던 `app/useDailyReminder` 와 함께 갔다. 남은 것은
   **후보 고르기**(`pickReminderLead`) 하나이고, 소비처는 `app/MiniHud`(미니 창의 「지금 이것」
   한 줄)다 — 그건 말 걸기 채널이 아니라 **열어 놓은 창 안의 리드아웃**이라 남는다. */

export interface ReminderLead {
  /** 사람이 읽는 한 줄(예: `회로이론 · 3장 변위전류`). */
  label: string;
  /** 예상 소요(분). 0 이하·미상이면 안 적는다 — 틀린 소요는 없는 소요보다 나쁘다. */
  min?: number;
  /** 클릭했을 때 **착지할 경로**(W3). 이름을 말한 알림이 그 이름으로 데려가지 않으면
   *  절약한 홉이 도로 생긴다 — A-1 이 "알림을 확인이 아니라 시작으로" 만든 그 값이 반쪽이 된다. */
  route: string;
}

/* ── 착지 경로(W3 · 발산 6회차) ─────────────────────────────────────────────
   ⚠ **여기가 정본이다.** 훅이 정하면 채널마다(알림·트레이·배지) 다른 곳으로 데려갈 수 있고,
   그 셋은 같은 리드를 말한다 — `pickReminderLead` 가 리드를 소유하므로 착지도 여기가 진다.
   ⚠ 리드 종류마다 갈린다: 밀린 챕터는 **인출을 굴리는 화면**, 보충은 **오늘 화면**이다
   (보충은 오늘의 몫으로 배치되는 것이라 러너 큐에 없다). */
const LEAD_ROUTE = { chapter: '/review-run', backlog: '/today' } as const;

/** 리드를 고를 재료. **훅은 시계와 채널만 안다** — *무엇을 말할까* 는 이 파일이 소유한다. */
export interface ReminderCandidates {
  /** 밀린 챕터, **위험 큰 순**(`riskChapters` 산출 순서 그대로). */
  chapters: readonly { subject: string; chapter: string }[];
  /** 열린 보충. */
  backlog: readonly { name: string; topic: string }[];
  /** 복습 1블록 분(`reviewBlockMin`) — 챕터 리드의 소요. 새 상수를 만들지 않는다. */
  reviewMin: number;
}

/**
 * 무엇을 첫 조각으로 부를까 + 나머지가 있나.
 *
 * ⚠ **챕터가 보충을 이긴다.** 밀린 복습은 시간이 갈수록 비용이 커지고(망각) 보충은 안 그렇다 —
 * 순서를 뒤집으면 알림이 매일 가장 안 급한 것을 부른다.
 * ⚠ 소요는 **챕터에만** 붙인다. 보충은 분량이 데이터에 없고, 없는 값을 지어내면 그 알림은
 * 한 번 틀린 뒤로 아무도 안 믿는다.
 */
export function pickReminderLead(c: ReminderCandidates): { lead: ReminderLead | null; rest: number } {
  const total = c.chapters.length + c.backlog.length;
  const head = c.chapters[0];
  if (head) {
    const label = `${head.subject} · ${head.chapter}`;
    return { lead: { label, min: c.reviewMin, route: LEAD_ROUTE.chapter }, rest: total - 1 };
  }
  const b = c.backlog[0];
  if (b) return { lead: { label: `${b.name} · ${b.topic}`.trim(), route: LEAD_ROUTE.backlog }, rest: total - 1 };
  return { lead: null, rest: 0 };
}

/* ⚠ **`reminderBody`(알림 문구)·`trayTooltip`(트레이 툴팁)이 여기 있었다 — 둘 다 채널과
   함께 은퇴했다**(I049 · 2026-08-22). 문구를 만드는 층은 채널이 없으면 존재 이유가 없다. */
