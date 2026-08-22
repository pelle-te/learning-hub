/* ============================================================
   applyLectureBlocks.test.ts — **시간표 인입 규칙**(C068 · 2026-08-22 코드 축 실행).

   ## 왜 이 파일이 여태 없었나

   `C036`(학사 눈금)과 **글자 그대로 같은 짝**이다: 규칙이 `degree/CalendarIntake.tsx` 의
   `mutate` 콜백 안에 살아 **컴포넌트를 렌더하지 않으면 도달 방법 자체가 없었다.**
   근본 원인 **R3**. C036 이 눈금 쪽만 내렸을 때 이 항목이 남았고, 불변식 ㉓(뷰 콜백 래칫)이
   그 크기를 계속 가리키고 있었다 — 내리고 나니 22 → 14 다.

   ## 중복 판정이 규칙의 본체다

   학기 중에 시간표를 다시 받는 것이 **정상 사용**이고(I010 — 시간표는 바뀐다), 그때마다 쌓이면
   **가용시간이 실제보다 적어진다**: 스케줄러는 일과 블록을 점유로 빼므로 유령 수업 하나가
   매주 그 시간만큼 계획 전체를 누른다. `icsParse` 가 `INTERVAL !== 1`·`COUNT=n` 을 거부하는
   것과 같은 축의 방어다(그쪽은 «없는 수업이 매주 시간을 먹는다», 이쪽은 «있는 수업이 두 번»).
============================================================ */
import { describe, expect, it } from 'vitest';
import { applyLectureBlocks } from '@/lib/icsParse';
import type { RoutineBlock } from '@/lib/types';

const 강의 = (name: string, start: string, end: string, days: number[]) => ({ name, start, end, days });
const 없음 = () => undefined;

describe('applyLectureBlocks — 시간표 인입의 단일 정본(C068)', () => {
  it('고른 강의를 일과 블록으로 넣고 들어간 수를 돌려준다', () => {
    const routine: RoutineBlock[] = [];
    expect(applyLectureBlocks(routine, [강의('회로이론', '09:00', '10:45', [1, 3])], '수업', 없음)).toBe(1);
    expect(routine).toHaveLength(1);
    expect(routine[0]).toMatchObject({ name: '회로이론', start: '09:00', end: '10:45', days: [1, 3], type: '수업' });
    expect(routine[0]!.id, 'id 없이 들어가면 편집·삭제가 대상을 못 고른다').toBeTruthy();
  });

  it('⚠⚠ 같은 블록을 두 번 넣지 않는다 — 학기 중 재인입(I010)이 정상 사용이다', () => {
    const routine: RoutineBlock[] = [];
    const l = 강의('회로이론', '09:00', '10:45', [1, 3]);
    applyLectureBlocks(routine, [l], '수업', 없음);
    expect(applyLectureBlocks(routine, [l], '수업', 없음), '재인입이 블록을 쌓았다').toBe(0);
    expect(routine, '유령 수업이 매주 그 시간을 먹으면 계획 전체가 눌린다').toHaveLength(1);
  });

  it('한 번의 호출 안에서도 중복은 한 번만 — 파일에 같은 줄이 둘이어도 마찬가지다', () => {
    const routine: RoutineBlock[] = [];
    const l = 강의('회로이론', '09:00', '10:45', [1]);
    expect(applyLectureBlocks(routine, [l, { ...l }], '수업', 없음)).toBe(1);
    expect(routine).toHaveLength(1);
  });

  it('네 축 중 하나라도 다르면 다른 수업이다 — 판정이 과하게 넓지 않다', () => {
    const base = 강의('회로이론', '09:00', '10:45', [1, 3]);
    for (const 다른 of [
      강의('전자기학', '09:00', '10:45', [1, 3]), // 이름
      강의('회로이론', '11:00', '12:45', [1, 3]), // 시작
      강의('회로이론', '09:00', '12:00', [1, 3]), // 끝
      강의('회로이론', '09:00', '10:45', [2, 4]), // 요일
    ]) {
      const routine: RoutineBlock[] = [];
      applyLectureBlocks(routine, [base], '수업', 없음);
      expect(applyLectureBlocks(routine, [다른], '수업', 없음), JSON.stringify(다른)).toBe(1);
    }
  });

  it('⚠⚠ `sid` 는 판정 키가 **아니다** — 연결이 붙거나 떨어져도 같은 수업은 같은 수업이다', () => {
    const routine: RoutineBlock[] = [];
    const l = 강의('회로이론', '09:00', '10:45', [1]);
    applyLectureBlocks(routine, [l], '수업', 없음); // 아직 과목이 없어 연결 실패
    /* 나중에 과목을 만들고 시간표를 다시 받는다 — 이때 `sid` 를 키에 넣었다면 같은 시간에
       블록이 둘 생기고 가용시간이 그만큼 더 깎인다. */
    expect(
      applyLectureBlocks(routine, [l], '수업', () => 'sub1'),
      'sid 가 판정 키가 됐다',
    ).toBe(0);
    expect(routine).toHaveLength(1);
  });

  it('연결된 강의는 `sid` 를 달고, 못 맞춘 강의는 그 키 자체를 안 만든다', () => {
    const routine: RoutineBlock[] = [];
    applyLectureBlocks(
      routine,
      [강의('회로이론', '09:00', '10:45', [1]), 강의('교양영어', '13:00', '14:00', [2])],
      '수업',
      (name) => (name === '회로이론' ? 'sub1' : undefined),
    );
    expect(routine[0]!.sid).toBe('sub1');
    expect('sid' in routine[1]!, '못 맞춘 강의에 sid 키를 만들면 「연결됨」이 거짓이 된다').toBe(false);
  });

  it('기존 블록(수면·일과)을 건드리지 않는다 — 인입이 일과를 갈아엎지 않는다', () => {
    const routine: RoutineBlock[] = [
      { id: 'sleep', name: '수면', type: '수면', start: '23:00', end: '07:00', days: [0, 1, 2, 3, 4, 5, 6] },
    ];
    applyLectureBlocks(routine, [강의('회로이론', '09:00', '10:45', [1])], '수업', 없음);
    expect(routine.map((b) => b.id)).toContain('sleep');
    expect(routine).toHaveLength(2);
  });

  it('빈 입력은 아무것도 안 만든다', () => {
    const routine: RoutineBlock[] = [];
    expect(applyLectureBlocks(routine, [], '수업', 없음)).toBe(0);
    expect(routine).toEqual([]);
  });
});
