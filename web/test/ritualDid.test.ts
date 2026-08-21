/* ============================================================
   ritualDid.test.ts — **기록의 방향을 뒤집는다**(I004 · 2026-08-22 발상 축).

   이 앱의 기록 필드는 전부 **계획을 기준**으로 물었다: 체크박스(계획대로 했나) · `stopWhy`
   (왜 못 했나) · `note`(내일 뭘 할까). 실측이 그 전제를 반증했다 — 학습 표가 전부 0행이다.
   `did` 는 계획을 참조하지 않는 한 줄이다: *"오늘 무슨 일이 있었나."*

   ⚠ 여기서 잠그는 것은 저장 규칙 셋이다. 화면 문구는 스냅샷이 본다.
   ① `stopWhy` 와 **다른 칸**이다(합치면 다시 계획을 기준으로 말하게 된다)
   ② 옛 저장본에 없어도 읽기가 죽지 않는다(무마이그레이션)
   ③ 날짜 키가 그날 것이다 — 하루 틀리면 사용자는 오늘을 적었다고 믿는다
============================================================ */
import { describe, expect, it } from 'vitest';
import { setRitual } from '@/lib/methodology';
import type { AppState } from '@/lib/types';

const st = (): AppState => ({ rituals: {} }) as unknown as AppState;

describe('Ritual.did — 계획을 참조하지 않는 한 줄', () => {
  it('그날 키에 담긴다', () => {
    const s = st();
    setRitual(s, '2026-08-22', 'did', '2장 예제에 막혀서 거기만 팠다');
    expect(s.rituals['2026-08-22']?.did).toBe('2장 예제에 막혀서 거기만 팠다');
  });

  it('⚠ `stopWhy` 와 다른 칸이다 — 한 칸으로 합치면 다시 계획을 기준으로 말한다', () => {
    const s = st();
    setRitual(s, '2026-08-22', 'stopWhy', '늦게 시작함');
    setRitual(s, '2026-08-22', 'did', '대신 오답노트를 30분 봤다');
    expect(s.rituals['2026-08-22']).toMatchObject({
      stopWhy: '늦게 시작함',
      did: '대신 오답노트를 30분 봤다',
    });
  });

  it('옛 저장본(rituals 없음)에서도 첫 쓰기가 성립한다 — 무마이그레이션', () => {
    const s = {} as AppState;
    setRitual(s, '2026-08-22', 'did', '무언가 있었다');
    expect(s.rituals['2026-08-22']).toEqual({ plan: false, shutdown: false, note: '', did: '무언가 있었다' });
  });

  it('다른 날의 기록을 안 건드린다', () => {
    const s = st();
    setRitual(s, '2026-08-21', 'did', '어제');
    setRitual(s, '2026-08-22', 'did', '오늘');
    expect(s.rituals['2026-08-21']?.did).toBe('어제');
    expect(s.rituals['2026-08-22']?.did).toBe('오늘');
  });
});
