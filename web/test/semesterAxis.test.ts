/* ============================================================
   semesterAxis.test.ts — **W8 학기 축**의 순수 판정 다섯(2026-08-07).

   한 파일인 이유: 다섯 다 *학기라는 명사*에 붙는 판정이고 픽스처가 같다(학기 + 이어 붙은 과목 +
   완료 기록). 가르면 같은 픽스처가 다섯 벌이 되고, 그 사본이 갈리는 순간 무엇이 옳은지 말할 수
   없게 된다.

   ① N-19 눈금 — **지난 것은 안 준다**(지나면 정보가 아니라 자책이다).
   ② N-18 목표 — **모르면 null 이고 0이 아니다**(성적 없는 학기의 GPA 는 0점이 아니다).
   ③ N-3 결산 — 0시간 과목은 학점당 시간의 표본이 아니다 · '예정'은 성적 할 일이 아니다.
   ④ N-6 커버리지 — 전 칸 0은 "구멍"이 아니라 **"셀 수 없다"** 다.
   ⑤ A-14 재회 — 사다리는 앱의 것 그대로이고, 같은 날 두 번은 한 번으로 친다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { defaults } from '@/lib/persistence';
import { marksOf, upcomingMarks } from '@/lib/semester';
import { goalStatus, metricValue } from '@/lib/semesterGoals';
import { pendingCloseSemesters, semesterReport } from '@/lib/semesterClose';
import { coverage, coverageKey } from '@/lib/cardCoverage';
import { dueQuestions, markMet, nextMeetDs } from '@/lib/questions';
import type { Question, Semester } from '@/lib/types';
import type { AppState } from '@/lib/schema';

const DS = '2026-08-07';

function state(): AppState {
  const s = defaults();
  s._today = DS;
  s.items = [
    {
      id: 'i1',
      name: '신호',
      mode: 'weekly',
      chapters: [
        { id: 'c1', name: '1장', hours: 10, done: true, doneDs: '2026-07-10' },
        { id: 'c2', name: '2장', hours: 10, done: false },
      ],
    },
  ];
  s.completions = {
    '2026-07-10': { 'i1|new': { done: true, min: 120, actualMin: 150 } },
    '2026-07-11': { 'i1|rev': { done: true, min: 60 } },
    /* 학기 밖 기록 — 어느 집계에도 들어가면 안 된다. */
    '2026-01-05': { 'i1|new': { done: true, min: 600 } },
  };
  s.degree.semesters = [sem()];
  return s;
}
const sem = (): Semester => ({
  id: 's1',
  name: '2026-1',
  startDs: '2026-07-01',
  endDs: '2026-12-20',
  courses: [{ id: 'co1', name: '신호', credits: 3, category: '전공선택', status: '수강중', itemId: 'i1' }],
  marks: [
    { id: 'm1', kind: 'fix', ds: '2026-07-05', label: '수강 정정' }, // 지났다
    { id: 'm2', kind: 'drop', ds: '2026-08-10', label: '수강 철회' },
    { id: 'm3', kind: 'off', ds: '2026-09-30', label: '휴강' }, // 21일 밖
  ],
});

describe('① N-19 학사일정 눈금', () => {
  it('날짜순으로 주고, 다가오는 것만 준다', () => {
    const s = state();
    expect(marksOf(s.degree.semesters[0]!).map((m) => m.ds)).toEqual(['2026-07-05', '2026-08-10', '2026-09-30']);
    const up = upcomingMarks(s, DS);
    expect(
      up.map((m) => m.mark.id),
      '지난 것과 창 밖의 것은 안 준다',
    ).toEqual(['m2']);
    expect(up[0]!.daysLeft).toBe(3);
  });
});

describe('② N-18 학기 목표', () => {
  it('모르는 지표는 null 이다 — 0 으로 접지 않는다', () => {
    const s = state();
    expect(metricValue(s, s.degree.semesters[0]!, 'gpa', DS), '성적이 없으면 GPA 는 모름').toBeNull();
  });

  it('시간은 실측(actualMin)을 쓰고 학기 밖 기록은 안 센다', () => {
    const s = state();
    // 150(actualMin) + 60 = 210분 = 3.5h. 1월 기록 600분은 학기 밖이라 빠진다.
    expect(metricValue(s, s.degree.semesters[0]!, 'hours', DS)).toBe(3.5);
    expect(metricValue(s, s.degree.semesters[0]!, 'chapters', DS)).toBe(1);
  });

  it('달성 판정은 모름을 달성으로 치지 않는다', () => {
    const s = state();
    const g = { id: 'g1', text: '', metric: 'gpa' as const, target: 4 };
    expect(goalStatus(s, s.degree.semesters[0]!, g, DS)).toMatchObject({ current: null, met: false, ratio: null });
  });
});

describe('③ N-3 학기 결산', () => {
  it('투입·계획·배율을 과목마다 내고, 성적 없는 과목만 할 일로 센다', () => {
    const s = state();
    const rep = semesterReport(s, s.degree.semesters[0]!, DS);
    expect(rep.rows[0]).toMatchObject({ investedH: 3.5, plannedH: 20, hoursPerCredit: 1.2, graded: false });
    expect(rep.ratio).toBeCloseTo(0.18, 2);
    expect(rep.missingGrades.map((c) => c.id)).toEqual(['co1']);
  });

  /* ⚠ 판정이 **과목 → 학기**로 올라갔다(2026-08-31). 종전엔 `courses[0].status = '예정'` 로
     과목 하나만 바꿨는데, 상태는 이제 학기의 것이라 **아직 시작 안 한 학기**로 민다.
     (같은 것을 새 모델로 적은 것이지 다른 것을 재는 게 아니다: 둘 다 «성적을 기대할 수 없는
     시점의 과목을 할 일로 세지 않는다»를 잠근다.) */
  it("'예정' 학기의 과목은 성적 할 일이 아니다(지워지지 않는 잔소리를 만들지 않는다)", () => {
    const s = state();
    s.degree.semesters[0]!.startDs = '2026-09-01'; // DS(2026-08-07) 보다 뒤 → 예정
    s.degree.semesters[0]!.endDs = '2027-01-20';
    expect(semesterReport(s, s.degree.semesters[0]!, DS).missingGrades).toEqual([]);
  });

  it('결산 대기 목록은 **끝난 학기**만 본다', () => {
    const s = state();
    expect(pendingCloseSemesters(s, DS), '아직 안 끝난 학기').toEqual([]);
    expect(pendingCloseSemesters(s, '2027-01-05').map((x) => x.id)).toEqual(['s1']);
  });
});

describe('④ N-6 카드 커버리지', () => {
  it('전 칸 0 은 구멍이 아니라 "셀 수 없다"다', () => {
    const s = state();
    expect(coverage(s.items, {}).verdict).toBe('none');
  });

  it('끝낸 챕터만 구멍으로 센다', () => {
    const s = state();
    const cov = coverage(s.items, { [coverageKey('i1', '2장')]: 5 });
    expect(cov.verdict).toBe('partial');
    // 1장은 끝냈는데 카드 0 → 구멍. 2장은 카드가 있다.
    expect(cov.gaps.map((g) => g.chapter)).toEqual(['1장']);
    expect(cov.rows[0]).toMatchObject({ withCards: 1, total: 2 });
  });
});

describe('⑤ A-14 오답 재회', () => {
  const q = (p: Partial<Question>): Question => ({ id: 'q1', ds: '2026-08-01', sid: 'i1', prompt: '문제', ...p });

  it('간격은 앱의 복습 사다리 그대로다(1·3·7·16 → 34)', () => {
    expect(nextMeetDs(q({}))).toBe('2026-08-02');
    expect(nextMeetDs(q({ met: ['2026-08-02'] }))).toBe('2026-08-05');
    expect(nextMeetDs(q({ met: ['2026-08-02', '2026-08-05', '2026-08-12', '2026-08-28'] }))).toBe('2026-10-01');
  });

  it('때가 된 것만 오래 지난 순으로 준다', () => {
    const s = state();
    s.questions = [q({ id: 'old', ds: '2026-07-01' }), q({ id: 'fresh', ds: DS })];
    expect(dueQuestions(s, DS).map((d) => d.q.id)).toEqual(['old']);
  });

  it('같은 날 두 번 "다시 봤어요"는 한 번으로 친다', () => {
    const s = state();
    s.questions = [q({})];
    markMet(s, 'q1', DS);
    markMet(s, 'q1', DS);
    expect(s.questions[0]!.met).toEqual([DS]);
  });
});
