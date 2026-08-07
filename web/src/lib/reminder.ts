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
export function minutesOfDay(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export interface ReminderInput {
  /** 설정된 발사 시각(`HH:MM`). `null` 이면 꺼짐. */
  at: string | null;
  /** 마지막으로 쏜 날(ISO). */
  lastDs: string | null;
  /** 오늘(ISO). */
  today: string;
  /** 지금 시각(자정 기준 분). */
  nowMin: number;
  /** 말할 것의 개수(밀린 복습 + 보충). **0 이면 안 쏜다.** */
  pending: number;
}

/** 지금 쏴야 하나. 이유를 함께 돌려준다 — 안 쏘는 이유가 화면에서 설명 가능해야 한다. */
export function shouldFire(i: ReminderInput): { fire: boolean; why: string } {
  if (!i.at) return { fire: false, why: '꺼짐' };
  const target = minutesOfDay(i.at);
  if (target === null) return { fire: false, why: '시각 형식이 아님' };
  if (i.lastDs === i.today) return { fire: false, why: '오늘 이미 보냄' };
  if (i.nowMin < target) return { fire: false, why: '아직 시각 전' };
  /* ⚠ 여기가 이 파일의 요지 — 할 일이 없으면 **말하지 않는다**. "밀린 것 없어요" 한 번이
     다음 알림의 신뢰를 깎는다(알림 피로는 내용이 아니라 빈도가 만든다). */
  if (i.pending <= 0) return { fire: false, why: '말할 것이 없음' };
  return { fire: true, why: '보냄' };
}

/* ── 본문(A-1 · 2026-08-07) ────────────────────────────────────────────────
   ⚠⚠ **이 앱이 먼저 거는 유일한 말이 곧 회피 유발자였다.** 종전 본문은 제목 `대기 N건` +
   본문 `N건 남았어요` 로, **한 알림에 수를 두 번** 말했다. 밖에서 캔 것의 요지가 정확히
   그것이다 — 밀린 수를 본 순간이 이탈 지점이고("열었더니 밀린 수가 보여서 닫았다"), 그
   숫자는 **어떤 행동으로도 오늘 안에 0이 될 수 없어서** 마비를 만든다.

   그래서 규칙 하나: **수를 말하지 않고 한 조각을 이름으로 부른다.** 알림이 "무엇을"까지
   말하면 앱을 여는 행위가 *확인*이 아니라 *시작*이 된다(알림 → 앱 → 판단에서 중간 한 홉이
   사라진다).

   ⚠ 나머지는 **개수가 아니라 오늘 몫의 언어**로 말한다("오늘은 이거 하나면 충분") — 그게
   A-10 이 '오늘 밖' 스트립에 거는 것과 같은 화법이고, 두 표면이 다른 말을 하면 안 된다.
   ⚠ `lead` 가 없으면(이름을 못 뽑는 상태) **그때도 수로 돌아가지 않는다.** 이름을 모르는 것은
   앱의 사정이지 사용자의 사정이 아니다. */

/** 알림이 가리킬 **첫 행동 하나**. */
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

/**
 * 알림 본문. **수가 아니라 한 조각**을 말한다(A-1).
 *
 * @param lead 첫 행동. `null` 이면 이름 없는 폴백(그래도 수는 안 쓴다).
 * @param rest `lead` 를 뺀 나머지 개수 — **문구에 숫자로 안 들어간다.** 있고 없고만 가른다.
 */
export function reminderBody(lead: ReminderLead | null, rest = 0): { title: string; body: string } {
  if (!lead) {
    return { title: '밀린 것부터 하나만', body: '가장 오래된 것 하나면 오늘 몫은 충분합니다.' };
  }
  const dur = typeof lead.min === 'number' && lead.min > 0 ? `${Math.round(lead.min)}분` : null;
  const tail = rest > 0 ? '오늘은 이거 하나면 충분합니다.' : '이거면 오늘 몫은 끝입니다.';
  return { title: lead.label, body: dur ? `${dur} — ${tail}` : tail };
}

/* ── A-6 트레이 툴팁(발산 6회차 · 2026-08-07) ──────────────────────────────
   ⚠⚠ 상주 모드를 켜면 **정보가 있는 표면이 0이 된다**: 창을 숨기면 작업표시줄 버튼이 사라지고
   거기 붙은 오버레이 배지(Q-30)도 함께 사라진다. 남는 것은 아무것도 말하지 않는 아이콘 하나다.

   ⚠ 문구를 **여기서** 만드는 이유: A-1(알림)과 **같은 어휘**여야 한다. 두 채널이 같은 사실을
   다르게 말하면(하나는 "회로이론 3장", 하나는 "대기 3건") 사용자는 둘을 다른 것으로 읽는다.
   그래서 리드 선택은 `pickReminderLead` 를 그대로 재사용하고, 이 함수는 **조판만** 한다.

   ⚠ 여기서는 **수를 써도 된다.** 알림이 수를 안 쓰는 이유는 *말을 걸기 때문*이고(밀린 수를
   들이밀면 회피가 된다), 툴팁은 **보러 간 사람에게만** 보인다 — 갔다는 것 자체가 알고 싶다는
   뜻이다. Q-30 이 배지를 "말 걸지 않는 알림"이라 부른 것과 같은 구분이다. */

/** 트레이 툴팁(여러 줄). 첫 줄은 앱 이름 — OS 가 그 자리를 이름으로 기대한다. */
export function trayTooltip(lead: ReminderLead | null, pending: number): string {
  const lines = ['러닝허브'];
  if (lead) lines.push(lead.min ? `다음 · ${lead.label} (${Math.round(lead.min)}분)` : `다음 · ${lead.label}`);
  lines.push(pending > 0 ? `대기 ${pending}건` : '대기 없음');
  return lines.join('\n');
}
