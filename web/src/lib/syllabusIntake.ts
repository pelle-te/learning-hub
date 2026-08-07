/* ============================================================
   syllabusIntake.ts — **N-2 강의계획서 인입구**의 파서. 순수 · React 무관 · IO 0.

   ## 왜 이것이 학기 축의 뼈대인가 (발산 6회차)

   T-1 이 학기라는 **그릇**을 만들었다. 그런데 그 그릇은 지금도 거의 비어 있고, 로드맵이 세운
   가설은 그 이유가 *"값이 없어서"* 가 아니라 **입력 비용**이라는 것이다: 개강 첫 주에 사람이
   손에 쥔 것은 과목당 PDF 한 장이고, 앱이 요구하는 것은 그 PDF 를 눈으로 읽어 **날짜 · 주차
   진도 · 과제 마감 · 학사 눈금**을 네 화면에 나눠 다시 치는 일이다. 그래서 아무도 안 채운다.

   이 파일은 그 넷을 **한 번의 붙여넣기**에서 뽑는 깔때기다. N-1(과제 부하) · N-19(학사일정
   눈금) · N-18(학기 목표) · N-3(결산)이 전부 여기서 들어온 값 위에 선다 — 5회차의 T-1 이
   *그릇*이었다면 이건 **깔때기**다.

   ## ⚠ 왜 로컬 AI 가 아니라 정규식인가 (로드맵의 "붙여넣기 → 로컬 AI" 에 대한 정정)

   로드맵은 Ollama 를 적었고 이 앱엔 이미 그 배선이 있다(`src-tauri/ollama.rs`). 그런데
   ① Ollama 프롬프트 빌더를 하나 더 만드는 것은 **Rust 사이클**이고 이 웨이브의 게이트는
   `verify`+`server verify` 다(W3 이 cargo 를 한 번만 돌기로 묶어 뒀다) ② 그리고 더 중요한 것 —
   **추출 결과를 검사할 수 있어야 한다.** 강의계획서의 날짜 표기는 종류가 열 몇 개로 닫혀 있고
   (`3/2` · `3.2` · `3월 2일` · `2026-03-02` · `1주차`), 그 닫힌 집합은 테스트로 잠글 수 있다.
   LLM 추출은 같은 입력에 다른 답을 줄 수 있어 **회귀를 잠그는 방법이 없다**.

   → 그래서 파서가 뼈대이고, AI 는 *파서가 못 읽은 줄*(`unparsed`)에만 붙일 여지로 남긴다.
   그 자리를 남겨 두는 것이 이 설계의 요점이다(지금은 그 수를 화면이 정직하게 말한다).

   ## ⚠ 이웃 `syllabus.ts` 와 다른 파일인 이유

   그 파일은 **T-17 주차 싱크**(교수 진도 ↔ 교재 챕터)이고 이 파일은 **텍스트 → 초안**이다.
   한 번 같은 이름으로 쓰다 덮어쓸 뻔했는데(`lib/retrieval.ts` 와 `retrievalLatency.ts` 가 5회차에
   겪은 것과 같은 형태), 인접해 보인다고 같은 것이 아니다: 저기는 *지금 어디까지 나갔나*,
   여기는 *계획서에 뭐라고 적혀 있나*다. 적용 단계에서 이 파일의 결과가 저 파일의 뮤테이터
   (`setSyllabusMark`)를 부른다 — 그 방향이 둘의 관계다.

   ## 규율 셋

   1. **여기서 아무것도 저장하지 않는다.** 결과는 *초안*(`SyllabusDraft`)이고, 무엇을 받아들일지는
      사람이 고른다 — 강의계획서는 자주 틀리고(작년 날짜가 남아 있다) 자동 반영은 되돌리기가 비싸다.
   2. **못 읽은 것을 센다.** 파서가 조용히 절반을 버리면 화면은 "다 읽었다"고 말한다 — 이 저장소가
      반복해 물린 *조용한 축소 보고*다.
   3. **연도는 학기에서 온다.** `3/2` 에는 연도가 없다. 학기 시작일을 주면 그 해로 읽고, 시작일보다
      이르면 **다음 해**로 넘긴다(겨울 학기가 해를 넘는 형태).
============================================================ */
import { addDays, iso, parseISO } from './utils';
import type { MarkKind } from './types';

/** 눈금 종류의 표시 이름 — 화면이 문구를 새로 지으면 같은 눈금을 화면마다 다르게 부른다.
 *  ⚠ 종류 자체(`MarkKind`)는 **저장 계약**이라 `schema.ts` 가 소유한다(넷으로 닫힌 이유도 거기). */
export const MARK_LABEL: Record<MarkKind, string> = {
  fix: '수강 정정',
  drop: '수강 철회',
  off: '휴강',
  makeup: '보강',
};

/** 주차 진도 한 줄 — `week` 는 1-based(`semesterPhase().week` 와 같은 축). */
export interface SyllabusWeek {
  week: number;
  topic: string;
}

/** 강의계획서에서 읽은 시험 하나. `date` 가 없으면 주차만 알아낸 것(적용 시 개강일로 환산한다). */
export interface SyllabusExam {
  kind: 'mid' | 'final';
  date: string | null;
  week: number | null;
}

/** 과제 하나 — N-1 이 소비한다(마감이 있어야 시간 예산에 들어간다). */
export interface SyllabusTask {
  title: string;
  /** ISO `YYYY-MM-DD`. 마감을 못 읽은 과제는 **초안에 넣지 않는다**(날짜 없는 과제는 예산이 못 쓴다). */
  deadline: string;
}

/** 학사일정 눈금 하나 — N-19.
 *  ⚠ 이름이 `IntakeMark` 인 이유: 이웃 `syllabus.ts`(T-17 주차 싱크)의 `SyllabusMark` 는 **주차 한 점**
 *  이라 같은 이름이 두 뜻을 갖는다. 저기는 *교수가 어디까지 나갔나*, 여기는 *학사일정의 날짜*다. */
export interface IntakeMark {
  kind: MarkKind;
  ds: string;
  label: string;
}

export interface SyllabusDraft {
  weeks: SyllabusWeek[];
  exams: SyllabusExam[];
  tasks: SyllabusTask[];
  marks: IntakeMark[];
  /** 뜻을 못 붙인 **비어 있지 않은** 줄 수. 규율 2 — 화면이 이 수를 그대로 말한다. */
  unparsed: number;
}

export interface ParseOptions {
  /** 학기 시작일(ISO). 연도 없는 날짜(`3/2`)와 주차→날짜 환산의 기준. */
  startDs?: string;
}

/* ── 날짜 읽기 ─────────────────────────────────────────────────────────── */

/** `2026-03-02` · `2026.3.2` · `2026/03/02` — 연도가 **줄 안에** 있는 형태. */
const FULL_DATE = /(20\d{2})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})/;
/** `3/2` · `3.2` · `3-2` · `3월 2일` — 연도가 없는 형태(학기에서 빌린다).
 *  ⚠ 공백을 `\s?`(하나까지)로 **묶는다** — `\s*` 를 교대(`|`) 양쪽에 두면 역추적이 초선형이 되고
 *  린트(`sonarjs/super-linear-regex`)가 그 자리에서 막는다. 실제 계획서에 `3 / 2` 는 없다. */
const SHORT_DATE = /(?<![\d년])(\d{1,2})\s?(?:월\s?(\d{1,2})\s?일?|[/.-](\d{1,2}))/;
/** `1주차` · `3 주` · `Week 5`. */
const WEEK_NO = /(?:(\d{1,2})\s*주\s*차?|week\s*(\d{1,2}))/i;

function clampDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso0 = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  // 2월 30일 같은 값은 Date 가 다음 달로 굴린다 — 되읽어 대조해 조용한 이동을 막는다.
  return iso(parseISO(iso0)) === iso0 ? iso0 : null;
}

/**
 * 한 줄에서 날짜 하나를 읽는다. 없으면 null.
 *
 * ⚠ 연도 없는 날짜는 **학기 시작일의 해**로 읽고, 그 결과가 시작일보다 이르면 다음 해로 넘긴다 —
 * 겨울 계절학기·해를 넘기는 학기가 그 형태다. 시작일이 없으면 연도를 **지어내지 않는다**(null).
 */
export function readDate(line: string, startDs?: string): string | null {
  const full = FULL_DATE.exec(line);
  if (full) return clampDate(+full[1]!, +full[2]!, +full[3]!);
  if (!startDs) return null;
  const short = SHORT_DATE.exec(line);
  if (!short) return null;
  const m = +short[1]!;
  const d = +(short[2] ?? short[3])!;
  const y = +startDs.slice(0, 4);
  const same = clampDate(y, m, d);
  if (!same) return null;
  return same >= startDs ? same : clampDate(y + 1, m, d);
}

/** 주차 번호 → 그 주의 **월요일 기준 첫날**. 개강일이 없으면 null(주차만으로는 날짜가 없다). */
export function dateOfWeek(week: number, startDs?: string): string | null {
  if (!startDs || week < 1) return null;
  return iso(addDays(parseISO(startDs), (week - 1) * 7));
}

/* ── 줄 분류 ───────────────────────────────────────────────────────────── */

const MARK_WORDS: { kind: MarkKind; re: RegExp }[] = [
  { kind: 'fix', re: /수강\s*(정정|변경|신청\s*정정)/ },
  { kind: 'drop', re: /(수강\s*)?(철회|취소|드랍|드롭)/ },
  { kind: 'off', re: /휴강|공휴일|개교기념/ },
  { kind: 'makeup', re: /보강/ },
];
/** 과제로 읽는 말. ⚠ **'제출' 하나로는 안 잡는다** — 시험 답안 제출까지 과제가 된다. */
const TASK_WORD = /과제|레포트|리포트|보고서|퀴즈|발표|프로젝트/;
const MID_WORD = /중간\s*(고사|시험|평가)/;
const FINAL_WORD = /기말\s*(고사|시험|평가)/;

/** 주차 줄에서 주제만 남긴다(`3주차:` · 앞의 날짜 · 구분자 제거). */
function topicOf(line: string): string {
  return line
    .replace(WEEK_NO, ' ')
    .replace(FULL_DATE, ' ')
    .replace(/^[\s:·\-—|\t]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * 강의계획서 텍스트 → 초안.
 *
 * ⚠ **한 줄이 여러 뜻을 가질 수 있다**(`7주차 3/2 중간고사`). 우선순위는 시험 > 과제 > 눈금이고
 * 주차 진도는 **그 위에 겹쳐서** 기록한다 — 시험 주에도 진도 칸에 내용이 적혀 있기 때문이다.
 * 우선순위를 안 정하면 같은 줄이 두 목록에 들어가 사용자가 지우는 일이 생긴다.
 */
export function parseSyllabus(text: string, opts: ParseOptions = {}): SyllabusDraft {
  const { startDs } = opts;
  const weeks: SyllabusWeek[] = [];
  const exams: SyllabusExam[] = [];
  const tasks: SyllabusTask[] = [];
  const marks: IntakeMark[] = [];
  let unparsed = 0;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const wk = WEEK_NO.exec(line);
    const week = wk ? +(wk[1] ?? wk[2])! : null;
    const date = readDate(line, startDs);
    let used = false;

    if (week !== null && week >= 1 && week <= 30) {
      const topic = topicOf(line);
      if (topic) weeks.push({ week, topic });
      used = true;
    }

    const isMid = MID_WORD.test(line);
    const isFinal = FINAL_WORD.test(line);
    if (isMid || isFinal) {
      exams.push({ kind: isMid ? 'mid' : 'final', date, week });
      used = true;
    } else if (TASK_WORD.test(line) && date) {
      // 제목은 날짜·주차를 걷어낸 나머지 — 없으면 '과제'로 둔다(빈 제목은 목록에서 못 고른다).
      const title = topicOf(line)
        .replace(SHORT_DATE, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
      tasks.push({ title: title || '과제', deadline: date });
      used = true;
    } else {
      const hit = MARK_WORDS.find((m) => m.re.test(line));
      if (hit && date) {
        marks.push({ kind: hit.kind, ds: date, label: topicOf(line).slice(0, 40) || MARK_LABEL[hit.kind] });
        used = true;
      }
    }
    if (!used) unparsed++;
  }

  return { weeks, exams, tasks, marks, unparsed };
}

/** 초안이 비었나 — 화면이 "한 줄도 못 읽었다"를 말할 수 있게(규율 2). */
export function draftIsEmpty(d: SyllabusDraft): boolean {
  return !d.weeks.length && !d.exams.length && !d.tasks.length && !d.marks.length;
}
