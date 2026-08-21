/* ============================================================
   reminder.test.ts — T-6 예약 한 발.

   ⚠ 여기서 특히 잠그는 것 넷 — 넷 다 "조용히 알림 피로를 만드는" 경로다:
   - **하루 1회.** 오늘 이미 쐈으면 안 쏜다. 이게 이 항목의 유일한 계약이다.
   - **할 일이 0 이면 안 쏜다.** "밀린 것 없어요" 한 번이 다음 알림의 신뢰를 깎는다.
   - **시각을 지나쳐 켜도 쏜다.** 건너뛰면 상주가 아닌 기기에서 *영원히* 안 쏜다 —
     그 기기가 알림이 가장 필요한 쪽이다.
   - **형식이 아닌 시각은 안 쏜다.** 사용자 입력이라 신뢰하지 않는다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { pickReminderLead } from '@/lib/reminder';

/* ⚠⚠ **`minutesOfDay`·`shouldFire`·`reminderBody` 케이스가 여기 있었다 — 그 함수들이
   은퇴했다**(I049 · 2026-08-22 발상 축). 알림 채널이 사라지면 «언제 쏘나»·«뭐라고 쏘나»를
   재는 층도 함께 사라진다. 남은 `pickReminderLead` 의 소비처는 `app/MiniHud` 하나다 —
   그건 말 걸기가 아니라 **열어 놓은 창 안의 리드아웃**이다. */

describe('pickReminderLead (A-1)', () => {
  const ch = { subject: '회로이론', chapter: '3장 변위전류' };
  const bl = { name: '선형대수', topic: '고유값' };

  it('챕터가 보충을 이긴다 — 밀린 복습만 시간이 갈수록 비싸진다', () => {
    const { lead, rest } = pickReminderLead({ chapters: [ch], backlog: [bl], reviewMin: 30 });
    expect(lead).toEqual({ label: '회로이론 · 3장 변위전류', min: 30, route: '/review-run' });
    expect(rest).toBe(1);
  });

  it('챕터가 없으면 보충으로 떨어지되 **소요는 안 붙인다**(분량이 데이터에 없다)', () => {
    const { lead } = pickReminderLead({ chapters: [], backlog: [bl], reviewMin: 30 });
    expect(lead).toEqual({ label: '선형대수 · 고유값', route: '/today' });
    expect(lead?.min).toBeUndefined();
  });

  /* W3 — 착지는 **리드 종류의 함수**다. 두 종류가 같은 곳으로 가면 알림이 이름을 부르고
     엉뚱한 화면을 여는 셈이라, A-1 이 없앤 홉이 도로 생긴다. */
  it('착지 경로가 리드 종류로 갈린다 — 챕터는 러너, 보충은 오늘', () => {
    expect(pickReminderLead({ chapters: [ch], backlog: [], reviewMin: 30 }).lead?.route).toBe('/review-run');
    expect(pickReminderLead({ chapters: [], backlog: [bl], reviewMin: 30 }).lead?.route).toBe('/today');
  });

  it('둘 다 비면 리드가 없다', () => {
    expect(pickReminderLead({ chapters: [], backlog: [], reviewMin: 30 })).toEqual({ lead: null, rest: 0 });
  });
});
