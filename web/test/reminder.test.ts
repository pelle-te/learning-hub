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
import { minutesOfDay, reminderBody, shouldFire } from '@/lib/reminder';

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

describe('reminderBody', () => {
  it('수와 다음 행동 하나만 — 세 줄을 넘으면 알림이 화면이 된다', () => {
    expect(reminderBody(1).body).toContain('한 건');
    expect(reminderBody(5).title).toBe('대기 5건');
  });
});
