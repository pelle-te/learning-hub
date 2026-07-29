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

/** 졸업요건 임계(전자공학과 2020 요람·ABEEK 인증과정) — SSOT 는 부모 goals.json
 *  'degree-requirement' 노드의 `degree_req`, codegen(artifacts.gen)이 파생(감사 2026-07-16 #7 3중화 해소).
 *  과거 여기 리터럴 + goals.json + 졸업요건_정리.md 3중이 드리프트 위험 → 생성물화로 리와이어.
 *  숫자를 바꿀 땐 goals.json 한 곳 → `npm run codegen` (드리프트는 codegen:check 게이트 RED).
 *  · 총 128 / 전공필수(인증필수) 41 · 전공선택(인증선택) 27 · 교양(학과기초31+전문교양18+대학필수2) 51. */
export { DEGREE_REQ } from './artifacts.gen';

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

/** 학기·과목 타입(state.degree 파생) — 컴포넌트 로컬 재정의 대신 lib에서 공유(SSOT). */
export type DegreeSemester = Degree['semesters'][number];
export type DegreeCourse = DegreeSemester['courses'][number];

/** 한 학기 GPA(완료·점수 있는 성적만 가중평균). P/미입력은 제외, 성적 없는 학기는 null.
 *  전체 GPA(degreeStats.gpa)와 동일 규칙을 학기 단위로 — SeasonRoadmap·SemCard가 공유. */
export function semesterGpa(sem: DegreeSemester): number | null {
  let pts = 0;
  let cr = 0;
  sem.courses.forEach((c) => {
    if (c.status !== '완료') return;
    const g = (c.grade || '').toUpperCase().trim();
    if (g in GRADE_POINTS) {
      const w = +c.credits || 0;
      pts += GRADE_POINTS[g]! * w;
      cr += w;
    }
  });
  return cr ? pts / cr : null;
}

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

export interface SemesterStat {
  tot: number; // 총 학점
  done: number; // 완료 학점
  inprog: number; // 수강중 학점
  planned: number; // 예정 학점
  inprogCount: number; // 수강중 과목 수(SemCard 헤더용)
  phase: 'done' | 'current' | 'future';
  pct: number; // 완료 비율 0~100
}

/** 한 학기의 상태별 학점 롤업 — SeasonRoadmap(로드맵 노드)·SemCard(학기 카드)가 공유(3중 재구현 제거). */
export function semesterStat(sem: DegreeSemester): SemesterStat {
  let tot = 0;
  let done = 0;
  let inprog = 0;
  let planned = 0;
  let inprogCount = 0;
  sem.courses.forEach((c) => {
    const cr = +c.credits || 0;
    tot += cr;
    if (c.status === '완료') done += cr;
    else if (c.status === '수강중') {
      inprog += cr;
      inprogCount++;
    } else planned += cr;
  });
  const phase: SemesterStat['phase'] = inprog > 0 ? 'current' : done > 0 && planned === 0 ? 'done' : 'future';
  return { tot, done, inprog, planned, inprogCount, phase, pct: tot > 0 ? Math.round((done / tot) * 100) : 0 };
}

export interface GpaForecast {
  targetGpa: number;
  futureCr: number; // 앞으로 성적이 매겨질 학점(수강중+예정)
  neededAvg: number | null; // 목표 달성에 필요한 남은 평균 평점(null=남은 학점 0)
  feasible: boolean; // neededAvg가 만점(4.5) 이내라 달성 가능
  alreadyMet: boolean; // 현재 GPA가 이미 목표 이상
}

/** 목표 졸업 GPA 달성에 필요한 '남은 학점 평균 평점' 역산 — 학위 플래너 표준 역량.
 *  남은 성적학점=수강중+예정(P는 알 수 없어 근사). 필요평점 = (목표*(기성적학점+남은) − 현재점수) / 남은. */
export function gpaForecast(d: Degree, targetGpa: number): GpaForecast {
  const { gpa, gradedCr, inprog, planned } = degreeStats(d);
  const curPts = (gpa ?? 0) * gradedCr;
  const futureCr = inprog + planned;
  const alreadyMet = gpa != null && gpa >= targetGpa;
  if (futureCr <= 0) return { targetGpa, futureCr: 0, neededAvg: null, feasible: alreadyMet, alreadyMet };
  const neededAvg = (targetGpa * (gradedCr + futureCr) - curPts) / futureCr;
  return { targetGpa, futureCr, neededAvg, feasible: neededAvg <= 4.5, alreadyMet };
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

/**
 * 졸업 진행률(%) — **초과이수를 있는 그대로** 돌려준다(130/120 = 108).
 *
 * ⚠ 이 한 줄이 세 화면에 각자 인라인돼 있었고, 그중 둘만 클램프가 없었다: 상단 리드아웃·
 * 요건 탭은 **108%**, 학기 로드맵은 **100%** 를 같은 상태에 대해 말했다. 초과이수는 흔한
 * 상태라 "한 화면에서 다른 답"이 실제로 보이던 자리다.
 * ⚠ **클램프는 여기서 안 한다.** 자르면 "얼마나 넘겼나"라는 정보가 lib 에서 사라지고, 정작
 * 잘라야 하는 곳(막대 폭)은 이미 `ProgressBar` 가 자기 기하로 클램프한다 — 숫자는 진실을,
 * 기하는 화면 안을 각자 책임진다.
 */
export function progressPct(d: Degree): number {
  const { earned } = degreeStats(d);
  return d.targetTotal > 0 ? Math.round((earned / d.targetTotal) * 100) : 0;
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
