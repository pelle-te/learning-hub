/* ============================================================
   degree.test.ts — 졸업 집계(lib/degree) 순수 회귀(Vitest).
   학점/GPA/요건 충족/재수강 후보를 state.degree만으로 파생 — DegreeReq·Degree 공유 출처.
============================================================ */
import { describe, expect, it } from 'vitest';
import { degreeStats, requirementRows, retakeCandidates, categoryReq } from '@/lib/degree';
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
