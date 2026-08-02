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

/** 알림 본문. **수와 다음 행동 하나**만 — 세 줄을 넘으면 알림이 화면이 된다. */
export function reminderBody(pending: number): { title: string; body: string } {
  return {
    title: `대기 ${pending}건`,
    body: pending === 1 ? '한 건 남았어요 — 지금이면 5분입니다.' : `${pending}건 남았어요 — 밀린 것부터 하나만.`,
  };
}
