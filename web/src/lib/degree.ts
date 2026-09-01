/* ============================================================
   lib/degree.ts — 졸업(학점·GPA·요건 충족·재수강) 순수 집계.
   졸업 계획(Degree)·졸업요건 정리(DegreeReq) 두 뷰가 공유하는 단일 출처.
   state.degree(학기·과목·성적)만으로 파생 — 서버·DOM 비의존, 단위테스트 대상.
============================================================ */
import type { Degree } from './types';

/** 과목 구분(카테고리) — 요건 매핑·집계 키.
 *  ⚠ `as const` 가 장식이 아니다: 아래 `REQ_FIELD` 가 `Record<DegreeCat, …>` 라 **라벨을 바꾸면
 *  그 표가 컴파일 에러로 붙잡는다.** 종전엔 `string[]` 이라 라벨 하나만 다듬어도 요건 매핑이
 *  조용히 `0`(요건 없음)으로 떨어졌다(2026-08-20 리뷰 M-8). */
export const CATS = ['전공필수', '전공선택', '교양', '기타'] as const;
export type DegreeCat = (typeof CATS)[number];
/** 수강 상태. */
export const STATUSES = ['예정', '수강중', '완료'] as const;
export type CourseStatus = (typeof STATUSES)[number];

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

/* ============================================================
   ⭐⭐ **상태는 과목이 아니라 학기의 것이다** (2026-08-31 · 사용자 판정)

   ## 무엇이 틀렸었나 — 「지금 어느 학기인가」의 정본이 둘이었다

   · `lib/semester.ts` 의 `semesterPhase()` 는 **날짜**(`startDs`/`endDs`)로 국면을 답하고,
   · 여기 `semesterStat().phase` 는 **과목 상태 집계**로 답했다(`inprog>0 ? current : …`).

   둘은 서로를 몰랐고 어긋날 수 있었다 — 종강일이 지났는데 과목 하나가 「수강중」이면 전자는
   `off` 인데 후자는 `current` 다. 그리고 상태를 과목마다 손으로 찍는 대가가 셋이었다:
   ⓐ 과목 스무 개를 하나씩 눌러야 하고 ⓑ 하나만 안 바꾸면 그 학점이 **조용히 `earned` 에서
   빠지고** ⓒ 완료+예정이 섞인 학기가 `'future'` 로 떨어졌다.

   ## 지금 — **날짜가 정본**이고, 나머지는 폴백이다

   우선순위가 계약이다(위에서부터 먼저 이긴다):
     ① **날짜**(`startDs`/`endDs`)가 있으면 그것이 답이다 — 파생이라 드리프트가 원리적으로 없다.
     ② 날짜가 없고 `sem.status` 가 있으면 그것(사람이 못박았거나 마이그레이션이 옮긴 값).
     ③ 옛 저장 호환 — **과목마다 흩어져 있던 `c.status` 를 여기서 롤업**한다.
     ④ 그 밖은 **성적 유무** — `semesterClose.ts` 가 이미 *"아직 안 넣은 성적 = 그 학기가
        닫히지 않았다는 **유일한 관측 가능한 신호**"* 라 쓰던 그 판단을 그대로 재사용한다.

   ## ⚠⚠ ③이 **마이그레이션이 아니라 파생 안에** 있는 이유 — 그러지 않으면 학점이 증발한다

   성적을 안 넣고 「완료」로만 찍어 둔 학기가 흔하다(사용자 신고 케이스가 정확히 그랬다:
   「이수 완료」 학기에 85학점). ④만으로는 그게 «예정» 이 되어 **이수 학점이 통째로 사라진다.**

   처음엔 이 롤업을 `persistence.migrateSemesterStatus` **에만** 뒀는데, 실측하니 그 경로는
   **셸·폰에서 돌지 않는다**: 정본이 SQLite 이고 `db/boot.ts` 는 `rowsToState()` 로 DB JSON 에서
   곧장 `AppState` 를 만든다 — 그 파일들에 `migrate()` 호출이 **0건**이다(전수 grep).
   즉 마이그레이션만 믿으면 **기존 셸 사용자 전원에게서 학점이 사라졌을 것**이다.
   → 그래서 판정은 **읽는 자리 하나**에 둔다. 저장 백엔드가 셋이어도(localStorage·SQLite·D1 pull)
   이 함수는 하나이므로 어느 경로로 들어온 데이터든 같은 답을 받는다.
   ⭐ 마이그레이션은 남지만 이제 **정규화**일 뿐 정확성의 전제가 아니다(그 값이 있으면 화면의
   상태 셀렉트가 그것을 보여 줄 수 있다 — 없으면 「자동」으로 보이는데 실제로는 완료라 헷갈린다).

   ⛔ 이 롤업을 날짜 **추정**으로 대신하지 마라 — 없는 개강일을 지어내는 것은 거짓말이고,
   그 거짓 날짜가 이후 주차·D-day·`semesterPhase` 를 전부 오염시킨다.

   ⚠ `Course.status` 는 **강등이지 제거가 아니다**(이 저장소의 «지우지 않는다 — 도달성만 회수»
   규율). 스키마에 옵셔널로 남고, 읽는 곳은 **이 함수 ③ 하나**다. 다른 새 코드는 읽지 마라.
   ⚠ 철회는 상태가 아니라 **`Course.dropped`** 다 — 「듣다 말았다」는 학기의 성질이 아니라 그
   과목의 성질이고, 상태 축에 섞으면 학기 단위로 접을 수 없다.
============================================================ */

/** 한 학기의 상태 — **파생값이다. 저장하지 마라**(자정 하나로 낡는다 · `semesterPhase` 와 같은 논증). */
export function semesterStatus(sem: DegreeSemester, ds: string): CourseStatus {
  // ① 날짜가 정본
  if (sem.startDs) {
    if (ds < sem.startDs) return '예정';
    return !sem.endDs || ds <= sem.endDs ? '수강중' : '완료';
  }
  // ② 옮겨 담은/못박은 값
  if (sem.status === '완료' || sem.status === '수강중' || sem.status === '예정') return sem.status;
  /* ③ 옛 저장 호환 — 과목마다 흩어져 있던 상태를 여기서 접는다(머리주석의 「증발」 절).
     보수적으로: 하나라도 '완료' 면 완료(가장 흔한 형태는 지난 학기에 성적이 일부만 들어온 것 ·
     여기서 «수강중» 을 고르면 그 학기 학점이 `earned` 에서 빠진다 — 잃는 쪽을 피한다). */
  const 옛상태 = sem.courses.filter((c) => !c.dropped).map((c) => c.status);
  if (옛상태.includes('완료')) return '완료';
  if (옛상태.includes('수강중')) return '수강중';
  // ④ 성적이 곧 닫힘 신호 — 학점 있는 과목이 하나라도 있고 그 전부에 성적이 들어왔나
  const 채점대상 = sem.courses.filter((c) => !c.dropped && (+c.credits || 0) > 0);
  if (!채점대상.length) return '예정';
  return 채점대상.every((c) => (c.grade || '').trim() !== '') ? '완료' : '예정';
}

/** 이 과목이 집계에 드는가 — 철회는 학점·GPA 어디에도 안 든다(기록은 남는다). */
const 셈에드나 = (c: DegreeCourse): boolean => !c.dropped;

/** 한 학기 GPA(완료·점수 있는 성적만 가중평균). P/미입력은 제외, 성적 없는 학기는 null.
 *  전체 GPA(degreeStats.gpa)와 동일 규칙을 학기 단위로 — SeasonRoadmap·SemCard가 공유.
 *  ⚠ `ds` 가 **필수**인 것이 의도다 — 기본값을 주면 시간 의존이 시그니처에서 사라지고,
 *  그러면 시드(`_today`)와 실시계가 갈린 화면이 조용히 생긴다. 타입이 호출부를 전부 잡는다. */
export function semesterGpa(sem: DegreeSemester, ds: string): number | null {
  let pts = 0;
  let cr = 0;
  if (semesterStatus(sem, ds) !== '완료') return null;
  sem.courses.forEach((c) => {
    if (!셈에드나(c)) return;
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

/** 학기·과목 전체를 한 번만 순회해 모든 집계를 낸다(요건 요약·졸업 인사이트 공유 · 이중순회 제거).
 *  ⚠ 상태는 **학기가 준다**(`semesterStatus`) — 과목마다 찍던 `c.status` 는 더 읽지 않는다. */
export function degreeStats(d: Degree, ds: string): DegreeStats {
  let earned = 0;
  let inprog = 0;
  let planned = 0;
  let pts = 0;
  let gradedCr = 0;
  let semDone = 0;
  const byCat: Record<string, number> = {};
  CATS.forEach((c) => (byCat[c] = 0));
  d.semesters.forEach((s) => {
    const 상태 = semesterStatus(s, ds);
    let hasDone = false;
    s.courses.forEach((c) => {
      if (!셈에드나(c)) return; // 철회 — 어느 칸에도 안 든다
      const cr = +c.credits || 0;
      if (상태 === '완료') {
        earned += cr;
        byCat[c.category] = (byCat[c.category] || 0) + cr;
        hasDone = true;
        const g = (c.grade || '').toUpperCase().trim();
        if (g in GRADE_POINTS) {
          pts += GRADE_POINTS[g]! * cr;
          gradedCr += cr;
        }
      } else if (상태 === '수강중') inprog += cr;
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

/** 한 학기의 상태별 학점 롤업 — SeasonRoadmap(로드맵 노드)·SemCard(학기 카드)가 공유(3중 재구현 제거).
 *
 *  ⚠⚠ **학기는 이제 한 상태다** — 그래서 `done`·`inprog`·`planned` 중 **정확히 하나만** 찬다.
 *  종전엔 과목마다 상태가 달라 셋이 동시에 찰 수 있었고, 그래서 `phase` 를 «`inprog>0` 이면
 *  current, `done>0 && planned===0` 이면 done» 같은 **집계에서 역추론**해야 했다 — 완료+예정이
 *  섞인 학기가 `'future'` 로 떨어지던 것이 그 추론의 대가였다. 지금은 상태가 곧 국면이다.
 *  ⚠ `pct` 도 그래서 0 아니면 100 이다. 학기 안의 «몇 % 진행»은 학점이 아니라 **주차**가 답할
 *  질문이고 그건 `semesterPhase().week` 가 이미 소유한다(여기서 흉내 내지 마라). */
export function semesterStat(sem: DegreeSemester, ds: string): SemesterStat {
  const 상태 = semesterStatus(sem, ds);
  let tot = 0;
  let 과목수 = 0;
  sem.courses.forEach((c) => {
    if (!셈에드나(c)) return;
    tot += +c.credits || 0;
    과목수 += 1;
  });
  const done = 상태 === '완료' ? tot : 0;
  const inprog = 상태 === '수강중' ? tot : 0;
  const planned = 상태 === '예정' ? tot : 0;
  const phase: SemesterStat['phase'] = 상태 === '완료' ? 'done' : 상태 === '수강중' ? 'current' : 'future';
  return {
    tot,
    done,
    inprog,
    planned,
    inprogCount: 상태 === '수강중' ? 과목수 : 0,
    phase,
    pct: 상태 === '완료' && tot > 0 ? 100 : 0,
  };
}

export interface GpaForecast {
  targetGpa: number;
  futureCr: number; // 역산의 **분모** — 졸업 전에 앞으로 성적이 매겨질 학점
  plannedCr: number; // 그중 실제로 학기에 입력해 둔 것(수강중+예정)
  gapCr: number; // 졸업까지 더 필요한 학점(targetTotal − 이수)
  neededAvg: number | null; // 목표 달성에 필요한 남은 평균 평점(null=남은 학점 0)
  feasible: boolean; // neededAvg가 만점(4.5) 이내라 달성 가능
  alreadyMet: boolean; // 현재 GPA가 이미 목표 이상
}

/** 목표 **졸업** GPA 달성에 필요한 '남은 학점 평균 평점' 역산 — 학위 플래너 표준 역량.
 *  필요평점 = (목표*(기성적학점 + 남은) − 현재점수) / 남은. P 는 알 수 없어 근사.
 *
 *  ## ⚠⚠ 분모는 «입력해 둔 학점» 이 아니라 «졸업까지 남은 학점» 이다 (2026-08-31 · 사용자 신고)
 *
 *  종전 분모는 `수강중 + 예정` — 즉 **플래너에 이미 입력해 둔 과목**뿐이었다. 그런데 이 함수가
 *  답하는 질문은 *"졸업 평점을 목표까지 올리려면"* 이라 분모가 **졸업 시점의 학점**이어야 한다.
 *  둘이 갈리면 «아직 입력을 덜 했다» 가 «목표가 불가능하다» 로 잘못 보고된다 — 실측 신고:
 *  이수 85 · 졸업요건 128 · 입력해 둔 앞으로 18 · 현재 3.0 · 목표 3.5 에서
 *    · 옛 분모 18 → (3.5×103 − 255)/18 = **5.86** → "만점으로도 도달 어려움"
 *    · 새 분모 43 → (3.5×128 − 255)/43 = **4.49** → 달성 가능
 *  같은 화면 네 줄 위의 게이지가 「남은 학점 43」을 띄우는데 이 줄만 「남은 18학점」이라 말했고,
 *  **같은 말이 서로 다른 두 수**였던 것이 신고의 표면이었다.
 *
 *  ⚠ `max` 인 이유: 졸업요건을 넘겨 듣는 학기가 있으면(초과 이수) 그 초과분도 성적에 들어간다 —
 *  그때는 입력해 둔 쪽이 크므로 그것이 분모다. 즉 **둘 중 큰 쪽**이 언제나 옳은 근사다.
 *  ⚠ `plannedCr`·`gapCr` 을 함께 내는 것은 화면이 «분모가 무엇인지» 말할 수 있게 하기 위해서다.
 *  그것을 안 내면 이 함수가 고친 혼동이 화면 쪽에서 되살아난다. */
export function gpaForecast(d: Degree, targetGpa: number, ds: string): GpaForecast {
  const { gpa, gradedCr, inprog, planned, earned } = degreeStats(d, ds);
  const curPts = (gpa ?? 0) * gradedCr;
  const plannedCr = inprog + planned;
  const gapCr = Math.max(0, d.targetTotal - earned);
  const futureCr = Math.max(gapCr, plannedCr);
  const alreadyMet = gpa != null && gpa >= targetGpa;
  if (futureCr <= 0)
    return { targetGpa, futureCr: 0, plannedCr, gapCr, neededAvg: null, feasible: alreadyMet, alreadyMet };
  const neededAvg = (targetGpa * (gradedCr + futureCr) - curPts) / futureCr;
  return { targetGpa, futureCr, plannedCr, gapCr, neededAvg, feasible: neededAvg <= 4.5, alreadyMet };
}

/* ⚠⚠ 카테고리 → 요건 필드의 **매핑표**. 삼항 사슬이 아니라 표인 것이 요점이다(M-8).

   종전엔 이 사슬이 **두 벌**이었다 — 여기와 `features/degree/Degree.tsx` 의 진행바 계산에
   글자단위로 복제돼 있었고, 이 파일 머리주석은 *"두 뷰가 공유하는 단일 출처"* 라 적고 있었다.
   그리고 라벨이 타입에 안 묶여 있어서(`CourseSchema.category` 는 `z.string()`) `'교양'` 을
   `'교양·기초'` 로 다듬으면 **두 벌 모두 조용히 `0` 으로 떨어져** 진행바가 "요건 없음"으로
   중립화됐다 — 컴파일 에러 0 · 테스트 0.

   `Record<DegreeCat, …>` 는 그 두 가지를 동시에 막는다: 사본이 하나가 되고, 라벨을 바꾸면
   이 표가 **컴파일 에러**를 낸다. */
const REQ_FIELD: Record<DegreeCat, 'reqMajorReq' | 'reqMajorSel' | 'reqLiberal' | null> = {
  전공필수: 'reqMajorReq',
  전공선택: 'reqMajorSel',
  교양: 'reqLiberal',
  기타: null, // 별도 요건 없음
};

/** 카테고리별 졸업요건 학점(설정값). '기타'와 모르는 라벨은 요건 없음(0). */
export function categoryReq(d: Degree, cat: string): number {
  const f = REQ_FIELD[cat as DegreeCat];
  return f ? d[f] : 0;
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
export function progressPct(d: Degree, ds: string): number {
  const { earned } = degreeStats(d, ds);
  return d.targetTotal > 0 ? Math.round((earned / d.targetTotal) * 100) : 0;
}

/** 카테고리별 요건 대비 이수 현황 — DegreeReq의 핵심 '요건 충족' 표. */
export function requirementRows(d: Degree, ds: string): RequirementRow[] {
  const { byCat } = degreeStats(d, ds);
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
export function retakeCandidates(d: Degree, ds: string): RetakeCandidate[] {
  const out: RetakeCandidate[] = [];
  d.semesters.forEach((s) => {
    if (semesterStatus(s, ds) !== '완료') return; // 끝난 학기의 과목만 재수강 후보다
    s.courses.forEach((c) => {
      if (!셈에드나(c)) return;
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
