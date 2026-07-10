/* ============================================================
   lib/degree.ts — 졸업(학점·GPA·요건 충족·재수강) 순수 집계.
   졸업 계획(Degree)·졸업요건 정리(DegreeReq) 두 뷰가 공유하는 단일 출처.
   state.degree(학기·과목·성적)만으로 파생 — 서버·DOM 비의존, 단위테스트 대상.
============================================================ */
import type { Degree } from './types';

/** 과목 구분(카테고리) — 요건 매핑·집계 키. */
export const CATS = ['전공필수', '전공선택', '교양', '기타'];
/** 수강 상태. */
export const STATUSES = ['예정', '수강중', '완료'];

/** 성적 → 평점(4.5 만점). P(이수)는 없음 → GPA에서 자동 제외(Pass/Fail). */
export const GRADE_POINTS: Record<string, number> = {
  'A+': 4.5,
  A0: 4.0,
  A: 4.0,
  'A-': 3.7,
  'B+': 3.5,
  B0: 3.0,
  B: 3.0,
  'B-': 2.7,
  'C+': 2.5,
  C0: 2.0,
  C: 2.0,
  'C-': 1.7,
  'D+': 1.5,
  D0: 1.0,
  D: 1.0,
  'D-': 0.7,
  F: 0,
};
/** 성적 드롭다운 순서(정규 키) — P(이수)는 GRADE_POINTS에 없어 GPA에서 자동 제외. */
export const GRADE_KEYS = ['A+', 'A0', 'A-', 'B+', 'B0', 'B-', 'C+', 'C0', 'C-', 'D+', 'D0', 'D-', 'F', 'P'];

/** 재수강 판정 임계 — 이 평점 이하(C+ 포함)면 재수강 후보. */
export const RETAKE_MAX_POINTS = GRADE_POINTS['C+']!; // 2.5

export interface DegreeStats {
  earned: number; // 완료(이수) 학점
  inprog: number;
  planned: number;
  byCat: Record<string, number>;
  gpa: number | null;
  gradedCr: number;
  semDone: number;
}

/** 학기·과목 전체를 한 번만 순회해 모든 집계를 낸다(요건 요약·졸업 인사이트 공유 · 이중순회 제거). */
export function degreeStats(d: Degree): DegreeStats {
  let earned = 0;
  let inprog = 0;
  let planned = 0;
  let pts = 0;
  let gradedCr = 0;
  let semDone = 0;
  const byCat: Record<string, number> = {};
  CATS.forEach((c) => (byCat[c] = 0));
  d.semesters.forEach((s) => {
    let hasDone = false;
    s.courses.forEach((c) => {
      const cr = +c.credits || 0;
      if (c.status === '완료') {
        earned += cr;
        byCat[c.category] = (byCat[c.category] || 0) + cr;
        hasDone = true;
        const g = (c.grade || '').toUpperCase().trim();
        if (g in GRADE_POINTS) {
          pts += GRADE_POINTS[g]! * cr;
          gradedCr += cr;
        }
      } else if (c.status === '수강중') inprog += cr;
      else planned += cr;
    });
    if (hasDone) semDone++;
  });
  return { earned, inprog, planned, byCat, gpa: gradedCr ? pts / gradedCr : null, gradedCr, semDone };
}

/** 카테고리별 졸업요건 학점(설정값). '기타'는 별도 요건 없음(0). */
export function categoryReq(d: Degree, cat: string): number {
  return cat === '전공필수' ? d.reqMajorReq : cat === '전공선택' ? d.reqMajorSel : cat === '교양' ? d.reqLiberal : 0;
}

export interface RequirementRow {
  cat: string;
  req: number; // 요건 학점(0=요건 없음)
  have: number; // 이수 학점
  gap: number; // 남은 학점(max(0, req-have))
  met: boolean; // 요건 충족 여부(요건 없으면 항상 충족)
  pct: number; // 진행률 0~100(요건 없으면 have>0시 100)
}

/** 카테고리별 요건 대비 이수 현황 — DegreeReq의 핵심 '요건 충족' 표. */
export function requirementRows(d: Degree): RequirementRow[] {
  const { byCat } = degreeStats(d);
  return CATS.map((cat) => {
    const req = categoryReq(d, cat);
    const have = byCat[cat] || 0;
    const gap = Math.max(0, req - have);
    const met = req ? have >= req : true;
    const pct = req ? Math.min(100, Math.round((have / req) * 100)) : have ? 100 : 0;
    return { cat, req, have, gap, met, pct };
  });
}

export interface RetakeCandidate {
  id: string;
  name: string;
  credit: number;
  grade: string;
  points: number;
  category: string;
  semester: string;
  /** F(학점 미취득) — 졸업을 위해 반드시 재수강. 그 외는 평점 향상용 선택 재수강. */
  mandatory: boolean;
}

/** 이수 완료했으나 성적이 C+(2.5) 이하인 과목 — 재수강 후보. F=필수. 나쁜 성적 우선 정렬. */
export function retakeCandidates(d: Degree): RetakeCandidate[] {
  const out: RetakeCandidate[] = [];
  d.semesters.forEach((s) => {
    s.courses.forEach((c) => {
      if (c.status !== '완료') return;
      const g = (c.grade || '').toUpperCase().trim();
      if (!(g in GRADE_POINTS)) return; // P/미입력 등은 제외
      const points = GRADE_POINTS[g]!;
      if (points > RETAKE_MAX_POINTS) return;
      out.push({
        id: c.id,
        name: c.name,
        credit: +c.credits || 0,
        grade: g,
        points,
        category: c.category,
        semester: s.name,
        mandatory: g === 'F',
      });
    });
  });
  // 성적 낮은 순 → 학점 큰 순(우선순위 높은 것 먼저).
  return out.sort((a, b) => a.points - b.points || b.credit - a.credit);
}
