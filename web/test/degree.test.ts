/* ============================================================
   degree.test.ts — 졸업 집계(lib/degree) 순수 회귀(Vitest).
   학점/GPA/요건 충족/재수강 후보를 state.degree만으로 파생 — DegreeReq·Degree 공유 출처.
============================================================ */
import { describe, expect, it } from 'vitest';
import {
  degreeStats,
  progressPct,
  requirementRows,
  retakeCandidates,
  categoryReq,
  semesterGpa,
  semesterStat,
  gpaForecast,
} from '@/lib/degree';
import type { Degree } from '@/lib/types';

function deg(over?: Partial<Degree>): Degree {
  return {
    targetTotal: 130,
    reqMajorReq: 60,
    reqMajorSel: 30,
    reqLiberal: 30,
    semesters: [
      {
        id: 's1',
        name: '2026-1학기',
        courses: [
          { id: 'c1', name: '미적분학', credits: 3, category: '전공필수', status: '완료', grade: 'A+' }, // 4.5
          { id: 'c2', name: '반도체', credits: 3, category: '전공필수', status: '완료', grade: 'F' }, // 0 · 재수강 필수
          { id: 'c3', name: '통신', credits: 3, category: '전공선택', status: '완료', grade: 'C+' }, // 2.5 · 재수강 후보
          { id: 'c4', name: '이수과목', credits: 2, category: '교양', status: '완료', grade: 'P' }, // GPA 제외
          { id: 'c5', name: '수강중과목', credits: 3, category: '전공선택', status: '수강중', grade: '' },
          { id: 'c6', name: '예정과목', credits: 3, category: '교양', status: '예정', grade: '' },
        ],
      },
    ],
    ...over,
  };
}

describe('degreeStats', () => {
  it('상태별 학점 집계 — 완료/수강중/예정', () => {
    const s = degreeStats(deg());
    expect(s.earned).toBe(3 + 3 + 3 + 2); // 완료 4과목 = 11
    expect(s.inprog).toBe(3);
    expect(s.planned).toBe(3);
  });

  it('카테고리별 이수 학점(완료만)', () => {
    const s = degreeStats(deg());
    expect(s.byCat['전공필수']).toBe(6); // 미적분3 + 반도체3(F도 완료로 집계)
    expect(s.byCat['전공선택']).toBe(3); // 통신3(수강중은 제외)
    expect(s.byCat['교양']).toBe(2);
  });

  it('GPA는 점수 있는 성적만 가중평균(P·미입력 제외)', () => {
    const s = degreeStats(deg());
    // (4.5*3 + 0*3 + 2.5*3) / (3+3+3) = 21/9 ≈ 2.333
    expect(s.gradedCr).toBe(9); // P(2학점)는 제외
    expect(s.gpa).toBeCloseTo(21 / 9, 5);
  });

  it('성적 과목이 하나도 없으면 gpa=null', () => {
    const s = degreeStats(deg({ semesters: [{ id: 'x', name: 'x', courses: [] }] }));
    expect(s.gpa).toBeNull();
  });
});

describe('categoryReq', () => {
  it('카테고리별 요건 학점 매핑, 기타=0', () => {
    const d = deg();
    expect(categoryReq(d, '전공필수')).toBe(60);
    expect(categoryReq(d, '전공선택')).toBe(30);
    expect(categoryReq(d, '교양')).toBe(30);
    expect(categoryReq(d, '기타')).toBe(0);
  });
});

describe('requirementRows', () => {
  it('요건 대비 이수·남은·충족 여부', () => {
    const rows = requirementRows(deg());
    const req = rows.find((r) => r.cat === '전공필수')!;
    expect(req.req).toBe(60);
    expect(req.have).toBe(6);
    expect(req.gap).toBe(54);
    expect(req.met).toBe(false);
    // 기타는 요건 없음 → 항상 충족.
    const etc = rows.find((r) => r.cat === '기타')!;
    expect(etc.req).toBe(0);
    expect(etc.met).toBe(true);
  });

  it('요건 이상 이수하면 met=true·gap=0', () => {
    const rows = requirementRows(deg({ reqMajorReq: 5 }));
    const req = rows.find((r) => r.cat === '전공필수')!;
    expect(req.have).toBe(6);
    expect(req.met).toBe(true);
    expect(req.gap).toBe(0);
    expect(req.pct).toBe(100);
  });
});

describe('retakeCandidates', () => {
  it('C+ 이하 이수 과목만, F는 필수·나쁜 성적 우선', () => {
    const r = retakeCandidates(deg());
    expect(r.map((x) => x.name)).toEqual(['반도체', '통신']); // F(0) 먼저, C+(2.5) 다음
    expect(r[0]!.mandatory).toBe(true); // F
    expect(r[1]!.mandatory).toBe(false); // C+
    // A+·P·수강중·예정은 제외.
    expect(r.some((x) => x.name === '미적분학')).toBe(false);
  });

  it('모두 C+ 초과면 빈 배열', () => {
    const clean = deg({
      semesters: [
        {
          id: 's',
          name: 's',
          courses: [{ id: 'a', name: 'A', credits: 3, category: '교양', status: '완료', grade: 'B+' }],
        },
      ],
    });
    expect(retakeCandidates(clean)).toEqual([]);
  });
});

describe('semesterGpa', () => {
  it('완료·점수 있는 성적만 가중평균(P·수강중·예정 제외)', () => {
    const sem = deg().semesters[0]!;
    // (4.5*3 + 0*3 + 2.5*3) / 9 — P(2학점)·수강중·예정 제외, 전체 GPA와 동일 규칙.
    expect(semesterGpa(sem)).toBeCloseTo(21 / 9, 5);
  });

  it('성적 매겨진 완료 과목이 없으면 null(성적 없는 학기)', () => {
    expect(semesterGpa({ id: 'x', name: 'x', courses: [] })).toBeNull();
    // 이수(P)만 있는 학기도 gradedCr=0 → null.
    expect(
      semesterGpa({
        id: 'y',
        name: 'y',
        courses: [{ id: 'a', name: 'A', credits: 2, category: '교양', status: '완료', grade: 'P' }],
      }),
    ).toBeNull();
    // 수강중만 있는 학기도 null.
    expect(
      semesterGpa({
        id: 'z',
        name: 'z',
        courses: [{ id: 'b', name: 'B', credits: 3, category: '교양', status: '수강중', grade: '' }],
      }),
    ).toBeNull();
  });

  it('학기 GPA는 전체 GPA와 독립(학기별 추세 신호)', () => {
    const a = semesterGpa({
      id: 'a',
      name: 'a',
      courses: [{ id: 'c1', name: 'X', credits: 3, category: '교양', status: '완료', grade: 'A+' }],
    });
    const b = semesterGpa({
      id: 'b',
      name: 'b',
      courses: [{ id: 'c2', name: 'Y', credits: 3, category: '교양', status: '완료', grade: 'B0' }],
    });
    expect(a).toBeCloseTo(4.5, 5);
    expect(b).toBeCloseTo(3.0, 5);
  });
});

describe('semesterStat', () => {
  it('상태별 학점 롤업 + 수강중 과목수 + phase', () => {
    const st = semesterStat(deg().semesters[0]!);
    expect(st.tot).toBe(17); // 3+3+3+2+3+3
    expect(st.done).toBe(11); // 완료 4과목
    expect(st.inprog).toBe(3); // 수강중 학점
    expect(st.planned).toBe(3);
    expect(st.inprogCount).toBe(1); // 수강중 과목 수(SemCard 헤더)
    expect(st.phase).toBe('current'); // 수강중 있음
    expect(st.pct).toBe(Math.round((11 / 17) * 100));
  });

  it('phase: 완료만(예정 없음)=done, 예정만=future', () => {
    const done = semesterStat({
      id: 'd',
      name: 'd',
      courses: [{ id: 'a', name: 'A', credits: 3, category: '교양', status: '완료', grade: 'A0' }],
    });
    expect(done.phase).toBe('done');
    const future = semesterStat({
      id: 'f',
      name: 'f',
      courses: [{ id: 'b', name: 'B', credits: 3, category: '교양', status: '예정', grade: '' }],
    });
    expect(future.phase).toBe('future');
  });
});

describe('gpaForecast', () => {
  it('목표 미달 시 필요 평균 평점 역산(불가능=feasible false)', () => {
    // 현재 gpa=21/9, gradedCr=9, 남은(수강중3+예정3)=6. 목표 3.5 → (3.5*15-21)/6 = 5.25 > 4.5.
    const f = gpaForecast(deg(), 3.5);
    expect(f.futureCr).toBe(6);
    expect(f.neededAvg).toBeCloseTo(5.25, 5);
    expect(f.feasible).toBe(false);
    expect(f.alreadyMet).toBe(false);
  });

  it('달성 가능한 목표는 feasible true', () => {
    const f = gpaForecast(deg(), 2.5); // (2.5*15-21)/6 = 2.75 ≤ 4.5
    expect(f.neededAvg).toBeCloseTo(2.75, 5);
    expect(f.feasible).toBe(true);
  });

  it('이미 목표 이상이면 alreadyMet true', () => {
    const f = gpaForecast(deg(), 2.0); // 현재 2.333 ≥ 2.0
    expect(f.alreadyMet).toBe(true);
  });

  it('남은 성적학점 0이면 neededAvg=null(더 못 바꿈)', () => {
    const allDone = deg({
      semesters: [
        {
          id: 's',
          name: 's',
          courses: [{ id: 'a', name: 'A', credits: 3, category: '교양', status: '완료', grade: 'A0' }],
        },
      ],
    });
    const f = gpaForecast(allDone, 4.0);
    expect(f.futureCr).toBe(0);
    expect(f.neededAvg).toBeNull();
  });
});

/* 세 화면(상단 리드아웃·요건 탭·학기 로드맵)이 각자 인라인으로 계산하다 둘만 클램프가 없어,
   초과이수에서 한쪽은 108% 다른 쪽은 100% 를 말했다. 정의를 하나로 모은 자리. */
describe('progressPct — 졸업 진행률의 단일 정의', () => {
  // 공용 픽스처의 이수(완료) 학점은 11 — 목표만 갈아 끼워 세 경우를 만든다.
  it('초과이수를 자르지 않는다 — 자르면 "얼마나 넘겼나"가 사라진다', () => {
    expect(progressPct(deg({ targetTotal: 10 }))).toBe(110);
  });

  it('평범한 경우', () => {
    expect(progressPct(deg({ targetTotal: 22 }))).toBe(50);
  });

  it('목표가 0이면 0 — 0으로 나누지 않는다', () => {
    expect(progressPct(deg({ targetTotal: 0 }))).toBe(0);
  });
});
