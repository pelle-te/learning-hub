/* ============================================================
   syllabusIntake.test.ts — N-2 강의계획서 파서.

   잠그는 것 넷:
   ① 한국 강의계획서의 **닫힌 날짜 표기 집합**(`2026-03-02`·`3/2`·`3월 2일`·`1주차`)이 전부 읽힌다.
      — 이 집합이 닫혀 있다는 것이 "AI 대신 정규식"의 근거이므로, 여기가 그 근거의 검사망이다.
   ② **못 읽은 줄을 센다**(`unparsed`). 조용한 축소 보고를 막는 유일한 장치.
   ③ 한 줄이 여러 뜻일 때 **우선순위**(시험 > 과제 > 눈금)가 지켜지고, 주차는 그 위에 겹친다.
   ④ 연도 없는 날짜는 학기에서 빌리고, 시작일보다 이르면 **다음 해**로 넘어간다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { dateOfWeek, draftIsEmpty, parseSyllabus, readDate } from '@/lib/syllabusIntake';

const START = '2026-03-02';

describe('readDate — 표기 집합', () => {
  it('연도가 줄 안에 있으면 학기 없이도 읽는다', () => {
    expect(readDate('2026-03-02 개강')).toBe('2026-03-02');
    expect(readDate('2026.3.2 개강')).toBe('2026-03-02');
    expect(readDate('2026/03/02 개강')).toBe('2026-03-02');
  });

  it('연도가 없으면 학기에서 빌린다 — 시작일이 없으면 지어내지 않는다', () => {
    expect(readDate('3/2 개강', START)).toBe('2026-03-02');
    expect(readDate('3월 2일 개강', START)).toBe('2026-03-02');
    expect(readDate('3.2 개강', START)).toBe('2026-03-02');
    expect(readDate('3/2 개강')).toBeNull();
  });

  it('시작일보다 이른 날짜는 다음 해다(해를 넘기는 학기)', () => {
    expect(readDate('1월 5일 보강', '2026-12-01')).toBe('2027-01-05');
  });

  it('없는 날짜(2월 30일)는 다음 달로 굴리지 않고 버린다', () => {
    expect(readDate('2026-02-30 시험')).toBeNull();
  });
});

describe('parseSyllabus', () => {
  it('주차·시험·과제·눈금을 한 번에 뽑는다', () => {
    const d = parseSyllabus(
      [
        '1주차  강의 소개와 오리엔테이션',
        '2주차  1장 신호와 시스템',
        '수강정정 기간 3/9 ~ 3/13',
        '8주차 4/20 중간고사',
        '과제 1 제출 4/27',
        '11주차 휴강 5/11 (공휴일)',
        '보강 5/16',
        '15주차 6/15 기말고사',
      ].join('\n'),
      { startDs: START },
    );
    expect(d.weeks.map((w) => w.week)).toEqual([1, 2, 8, 11, 15]);
    expect(d.weeks[0]!.topic).toBe('강의 소개와 오리엔테이션');
    expect(d.exams).toEqual([
      { kind: 'mid', date: '2026-04-20', week: 8 },
      { kind: 'final', date: '2026-06-15', week: 15 },
    ]);
    expect(d.tasks).toEqual([{ title: '과제 1 제출', deadline: '2026-04-27' }]);
    expect(d.marks.map((m) => [m.kind, m.ds])).toEqual([
      ['fix', '2026-03-09'],
      ['off', '2026-05-11'],
      ['makeup', '2026-05-16'],
    ]);
    expect(draftIsEmpty(d)).toBe(false);
  });

  it('시험 줄은 과제·눈금으로 세지 않는다(우선순위) — 주차는 겹쳐 기록한다', () => {
    const d = parseSyllabus('8주차 중간고사 대비 과제 안내 4/20', { startDs: START });
    expect(d.exams).toHaveLength(1);
    expect(d.tasks).toHaveLength(0);
    expect(d.weeks).toEqual([{ week: 8, topic: '중간고사 대비 과제 안내 4/20' }]);
  });

  it('날짜를 못 읽은 과제·눈금은 초안에 안 넣고 못 읽은 줄로 센다', () => {
    const d = parseSyllabus('과제는 매주 제출합니다\n\n휴강 공지는 별도 안내', { startDs: START });
    expect(d.tasks).toHaveLength(0);
    expect(d.marks).toHaveLength(0);
    expect(d.unparsed).toBe(2); // 빈 줄은 안 센다
    expect(draftIsEmpty(d)).toBe(true);
  });

  it('날짜 없는 시험은 주차만 갖고 들어온다(적용 때 개강일로 환산한다)', () => {
    const d = parseSyllabus('8주차 중간고사', { startDs: START });
    expect(d.exams).toEqual([{ kind: 'mid', date: null, week: 8 }]);
    expect(dateOfWeek(8, START)).toBe('2026-04-20');
    expect(dateOfWeek(8)).toBeNull();
  });
});
