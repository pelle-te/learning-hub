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
import { minutesOfDay, pickReminderLead, reminderBody, shouldFire } from '@/lib/reminder';

const base = { at: '09:00', lastDs: null, today: '2026-08-02', nowMin: 9 * 60, pending: 3 };

describe('minutesOfDay', () => {
  it('HH:MM 을 분으로', () => {
    expect(minutesOfDay('09:30')).toBe(570);
    expect(minutesOfDay('0:05')).toBe(5);
  });
  it('형식이 아니면 null — 사용자 입력을 신뢰하지 않는다', () => {
    expect(minutesOfDay('9시')).toBeNull();
    expect(minutesOfDay('24:00')).toBeNull();
    expect(minutesOfDay('09:60')).toBeNull();
    expect(minutesOfDay('')).toBeNull();
  });
});

describe('shouldFire', () => {
  it('시각이 되고 할 일이 있으면 쏜다', () => {
    expect(shouldFire(base).fire).toBe(true);
  });
  it('오늘 이미 쐈으면 안 쏜다 — 하루 1회가 유일한 계약이다', () => {
    expect(shouldFire({ ...base, lastDs: '2026-08-02' })).toMatchObject({ fire: false, why: '오늘 이미 보냄' });
  });
  it('어제 쏜 것은 오늘을 막지 않는다', () => {
    expect(shouldFire({ ...base, lastDs: '2026-08-01' }).fire).toBe(true);
  });
  it('할 일이 0 이면 안 쏜다 — "밀린 것 없어요"는 정보가 아니라 방해다', () => {
    expect(shouldFire({ ...base, pending: 0 })).toMatchObject({ fire: false, why: '말할 것이 없음' });
  });
  it('시각 전이면 안 쏜다', () => {
    expect(shouldFire({ ...base, nowMin: 8 * 60 + 59 }).fire).toBe(false);
  });
  it('시각을 지나쳐도 쏜다 — 건너뛰면 상주가 아닌 기기는 영원히 못 받는다', () => {
    expect(shouldFire({ ...base, nowMin: 23 * 60 }).fire).toBe(true);
  });
  it('꺼져 있으면 안 쏘고, 형식이 아닌 시각도 안 쏜다', () => {
    expect(shouldFire({ ...base, at: null })).toMatchObject({ fire: false, why: '꺼짐' });
    expect(shouldFire({ ...base, at: '아홉시' }).fire).toBe(false);
  });
});

describe('reminderBody (A-1)', () => {
  /* ⚠ 이 describe 의 옛 케이스는 `title === '대기 5건'` 을 **단언**하고 있었다 — 즉 검사망이
     회피 유발자를 계약으로 굳히고 있었다. 지금은 반대를 잠근다: **대기 수가 어디에도 안 샌다.**
     ⚠ "숫자가 하나도 없다"로는 못 잠근다 — 챕터명("3장")과 소요("30분")는 정당한 숫자다.
     잠글 것은 *어떤 숫자든 없는 것*이 아니라 **`rest` 가 문구로 새지 않는 것**이다. */

  it('첫 조각을 이름으로 부르고 소요를 말한다 — 제목은 리드 그 자체다', () => {
    const r = reminderBody({ label: '회로이론 · 3장 변위전류', min: 30 }, 4);
    expect(r.title).toBe('회로이론 · 3장 변위전류'); // 꼬리표가 안 붙는다(= 수가 안 샌다)
    expect(r.body).toContain('30분');
  });

  it('`rest` 값이 달라도 문구는 안 바뀐다 — 개수는 문장에 안 들어간다', () => {
    const a = reminderBody({ label: 'A · B', min: 30 }, 2);
    const b = reminderBody({ label: 'A · B', min: 30 }, 97);
    expect(a).toEqual(b); // 있고/없고만 가르므로 2와 97은 같은 말이어야 한다
  });

  it('나머지는 **개수가 아니라 오늘 몫의 언어**로 말한다', () => {
    const many = reminderBody({ label: 'A · B', min: 30 }, 11);
    const only = reminderBody({ label: 'A · B', min: 30 }, 0);
    expect(many.body).toContain('오늘은 이거 하나면');
    expect(only.body).toContain('오늘 몫은 끝');
    // 11 이라는 수가 어디에도 안 나온다(소요 30분 말고는 숫자가 없다)
    expect(many.body.replace('30분', '')).not.toMatch(/\d/);
  });

  it('소요를 모르면 안 적는다 — 틀린 소요는 없는 소요보다 나쁘다', () => {
    expect(reminderBody({ label: '회로 · 보충' }).body).not.toMatch(/\d/);
    expect(reminderBody({ label: '회로 · 보충', min: 0 }).body).not.toMatch(/\d/);
  });

  it('리드가 없어도 수로 돌아가지 않는다', () => {
    const r = reminderBody(null, 23);
    expect(r.title + r.body).not.toMatch(/\d/); // 폴백엔 정당한 숫자가 하나도 없다
  });
});

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
