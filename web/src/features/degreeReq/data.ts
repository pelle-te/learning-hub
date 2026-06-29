/* ============================================================
   degreeReq/data.ts — 졸업요건 정리(정적 참조 데이터)
   출처: 졸업요건_정리.md (전자공학과 2020 요람·ABEEK 인증과정).
   수치가 바뀌면 이 파일만 고친다(레거시 ui-degree-req.js의 상수를 타입화해 이전).
============================================================ */

/** 총괄 표의 상태 색(''=색 없음, ok=초록, warn=주황, bad=빨강). */
export type Tone = 'ok' | 'warn' | 'bad' | '';
/** 인증필수 이수 현황. */
export type Done = 'done' | 'redo' | 'todo';

export interface OverviewRow {
  item: string;
  req: string;
  cur: string;
  tone: Tone;
}

/** 졸업요건 총괄 — [항목, 요건, 내 현황, 상태]. */
export const DR_OVERVIEW: OverviewRow[] = [
  { item: '총 졸업학점', req: '128학점', cur: '94학점 (34학점 남음)', tone: 'warn' },
  { item: '평점', req: '2.0 이상', cur: '2.71', tone: 'ok' },
  { item: '영어 공인성적', req: 'TOEIC 730 / TEPS 329 / iBT 72 / OPIc IL 등', cur: '제출 필요', tone: 'warn' },
  { item: '설계학점', req: '9학점 이상', cur: '약 4.5학점 (보충 필요)', tone: 'warn' },
  { item: '대학필수', req: '2학점 (아주희망1+아주인성1)', cur: '2학점', tone: 'ok' },
  { item: '전문교양', req: '18학점 (영어6·글쓰기3·영역별9)', cur: '15~18 (영역별 보충 가능)', tone: 'warn' },
  { item: '학과필수(기초)', req: '31학점 (수학12·과학15·전산4)', cur: '31학점', tone: 'ok' },
  { item: '전공', req: '68학점 (인증필수41+인증선택27)', cur: '42학점 (26학점 남음)', tone: 'warn' },
  { item: '자유선택', req: '9학점', cur: '심리학개론 3 사용 → 6학점 자유', tone: '' },
];

export interface KpiRow {
  value: string;
  label: string;
  tone: Tone;
}

/** 핵심 숫자(KPI). */
export const DR_KPI: KpiRow[] = [
  { value: '34', label: '남은 졸업학점', tone: 'warn' },
  { value: '26', label: '남은 전공학점', tone: 'warn' },
  { value: '8', label: '비전공(교양·자유)', tone: '' },
  { value: '1', label: '재수강 필수(F)', tone: 'bad' },
];

export interface RequiredRow {
  name: string;
  credit: number;
  term: string;
  grade: string;
  done: Done;
}

/** 전공 인증필수 41 — [과목, 학점, 개설학기, 성적/표시, 완료여부]. */
export const DR_REQUIRED: RequiredRow[] = [
  { name: '어드벤처디자인', credit: 3, term: '2학기', grade: 'B+', done: 'done' },
  { name: '회로이론', credit: 3, term: '양학기', grade: 'B0', done: 'done' },
  { name: '전자기학', credit: 3, term: '양학기', grade: 'C+', done: 'done' },
  { name: '기초전기실험', credit: 2, term: '양학기', grade: 'C+', done: 'done' },
  { name: '논리회로', credit: 3, term: '양학기', grade: 'C+', done: 'done' },
  { name: '전자회로1', credit: 3, term: '양학기', grade: 'C+', done: 'done' },
  { name: '전자장론', credit: 3, term: '양학기', grade: 'C+', done: 'done' },
  { name: '신호 및 시스템', credit: 3, term: '양학기', grade: 'C+', done: 'done' },
  { name: '자료구조및알고리즘이해', credit: 3, term: '양학기', grade: 'C+', done: 'done' },
  { name: '논리회로실험', credit: 2, term: '양학기', grade: 'B+', done: 'done' },
  { name: '전자회로실험', credit: 2, term: '양학기', grade: 'B+', done: 'done' },
  { name: '4차 산업혁명 Connecting Minds', credit: 1, term: '2학기', grade: '미수강', done: 'todo' },
  { name: '전자회로2', credit: 3, term: '양학기', grade: '미수강', done: 'todo' },
  { name: '반도체공학1', credit: 3, term: '양학기', grade: 'F → 재수강', done: 'redo' },
  { name: '융합전자연구1 / 융합캡스톤디자인1', credit: 2, term: '권장 3-2', grade: '미수강', done: 'todo' },
  { name: '융합전자연구2 / 융합캡스톤디자인2', credit: 2, term: '권장 4-1', grade: '미수강', done: 'todo' },
];

export interface RetakeItem {
  name: string;
  grade: string;
  credit: number;
  term: string;
  note: string;
}
export interface RetakeGroup {
  title: string;
  sub: string;
  rows: RetakeItem[];
}

/** 재수강 대상(C+ 이하) — 그룹별. */
export const DR_RETAKE: RetakeGroup[] = [
  {
    title: '전공필수',
    sub: '8과목 · 23학점',
    rows: [
      { name: '반도체공학1', grade: 'F', credit: 3, term: '양학기', note: '재수강 필수(졸업)' },
      { name: '전자기학', grade: 'C+', credit: 3, term: '양학기', note: '' },
      { name: '신호 및 시스템', grade: 'C+', credit: 3, term: '양학기', note: '' },
      { name: '전자회로1', grade: 'C+', credit: 3, term: '양학기', note: '' },
      { name: '전자장론', grade: 'C+', credit: 3, term: '양학기', note: '' },
      { name: '논리회로', grade: 'C+', credit: 3, term: '양학기', note: '' },
      { name: '기초전기실험', grade: 'C+', credit: 2, term: '양학기', note: '' },
      { name: '자료구조및알고리즘이해', grade: 'C+', credit: 3, term: '양학기', note: '실제 전공필수' },
    ],
  },
  {
    title: '전공선택',
    sub: '5과목 · 15학점',
    rows: [
      { name: '디지털신호처리', grade: 'F', credit: 3, term: '2학기', note: '' },
      { name: '확률 및 랜덤변수', grade: 'D+', credit: 3, term: '양학기', note: '' },
      { name: '통신의기초', grade: 'C0', credit: 3, term: '확인 필요', note: '요람에 없음' },
      { name: '디지털통신', grade: 'C+', credit: 3, term: '2학기', note: '' },
      { name: '인터넷프로토콜', grade: 'C+', credit: 3, term: '2학기', note: '' },
    ],
  },
  {
    title: '교양·학과기초',
    sub: '4과목 · 12학점',
    rows: [
      { name: '공업수학G', grade: 'C+', credit: 3, term: '1학기', note: '학과필수(수학)' },
      { name: '서양사상과 지성사', grade: 'D0', credit: 3, term: '양학기', note: '전문교양 영역별' },
      { name: '과학기술과 법', grade: 'C+', credit: 3, term: '2학기', note: '전문교양 영역별' },
      { name: '심리학개론', grade: 'C+', credit: 3, term: '확인', note: '교양(전공 아님)' },
    ],
  },
];

export interface RemainingRow {
  cat: string;
  name: string;
  credit: number;
  term: string;
}

/** 앞으로 더 들어야 할 전공 26 — [분류, 과목, 학점, 개설학기]. */
export const DR_REMAINING: RemainingRow[] = [
  { cat: '인증필수', name: '반도체공학1 (재수강)', credit: 3, term: '양학기' },
  { cat: '인증필수', name: '전자회로2', credit: 3, term: '양학기' },
  { cat: '인증필수', name: '4차 산업혁명 Connecting Minds', credit: 1, term: '2학기' },
  { cat: '인증필수', name: '캡스톤 1 + 2 (한 세트)', credit: 4, term: '권장 3-2→4-1' },
  { cat: '인증선택', name: '2그룹 실험 택1', credit: 3, term: '2학기' },
  { cat: '인증선택', name: '추가 인증선택 (약 4과목)', credit: 12, term: '1·2학기' },
];

/** 추가 확인 필요 체크리스트. */
export const DR_CHECKLIST: string[] = [
  '영역별교양: {창의적사고·과학과철학·현대사회의윤리} 중 1과목 더 필요할 수 있음(심리학개론 인정 여부에 따라).',
  '설계 9학점: 현재 약 4.5 → 캡스톤 2과목(+4)으로 8.5. 캡스톤2 이수 전에 0.5↑ 보충(이후 설계 불인정).',
  '기초과학 택1: 생명과학(3)으로 충족 — 생명과학실험 동반 여부 학과 확인.',
  '아주인성: "아주인을 위한 마중물" 대체 인정 여부 확인.',
  '영어 공인성적 제출(TOEIC 730 / TEPS 329 / iBT 72 / OPIc IL 등).',
  '학수구분 표기 차이(자료구조 등)·통신의기초 코드 매핑은 학과 졸업사정에서 최종 확인.',
];

/** 진행도(이수/졸업). */
export const DR_PROGRESS = { earned: 94, total: 128 } as const;
