/* ============================================================
   schema.ts — 경계의 데이터 계약(zod). 스키마=타입=런타임 가드를 일원화한다.
   레거시 모델 v3(localStorage KEY 'study_planner_v3')와 **바이트 호환**:
   필드/스키마를 그대로 옮겨 기존 백업 JSON이 100% 로드되게 한다.
   ※ migrate/validShape의 *동작*은 persistence.ts가 손코딩 그대로 보존(테스트 회귀 방지).
     여기 스키마는 (1) 타입 추론의 단일 원천 (2) 선택적 런타임 검증에 쓴다.
============================================================ */
import * as z from 'zod/mini';

export const ThemeSchema = z.enum(['light', 'dark']);
export type Theme = z.infer<typeof ThemeSchema>;

/** doneDs = 챕터를 끝낸 날(N-10 유지 사다리의 앵커). 옵셔널이라 기존 저장은 무마이그레이션.
 *  ⚠ 왜 필요한가: done 챕터는 스케줄러가 더 이상 블록을 안 만들어(`_chs` 가 `!done` 필터)
 *  **과거 날짜와의 링크까지 통째로 끊긴다** — 계획이 매번 재생성되기 때문이다. 그래서 "언제
 *  끝냈나"는 여기 남기지 않으면 앱 어디에도 없다(로드맵 N-10 의 "데이터는 전부 있다"는 전제
 *  정정). 없는 옛 챕터는 '모름'으로 다루고 유지 큐의 세션 상한이 그 불확실성을 감당한다. */
/** deferred = **이번 범위에서 제외**(P-9 컷 리스트). `done` 과 엄격히 다르다 — done 은 "끝냈다",
 *  deferred 는 "이번엔 안 한다". 둘을 한 필드로 합치면 통계(`doneCh`)가 포기를 진척으로 세고,
 *  되돌리기가 "완료 취소"와 구분되지 않는다. 옵셔널이라 기존 저장은 무마이그레이션.
 *  ⚠ **삭제가 아니다.** 로드맵이 못박은 설계 조건 — 삭제로 만들면 아무도 안 누른다. 챕터는 목록에
 *  남고 스케줄러만 이번 회차에서 뺀다. */
export const ChapterSchema = z.object({
  id: z.string(),
  name: z.string(),
  hours: z.number(),
  done: z.boolean(),
  doneDs: z.optional(z.string()),
  deferred: z.optional(z.boolean()),
});

export const ItemModeSchema = z.enum(['weekly', 'daily']);

/* ── T-1 학기 계약 · 시험(Exam) ────────────────────────────────────────────
   왜 생겼나: 5회차 발산에서 **블라인드 7각도가 독립적으로 같은 지점에 도착**했다 —
   "여정의 입구와 출구가 통째로 비어 있고, **'학기'가 데이터에 없다**". `Semester` 는 날짜조차
   없었고(회계용 이름표), 과목이 **두 우주**에 살았다: `Course`(학점·성적) 와 `Item`(챕터·마감)이
   서로를 전혀 참조하지 않았다.

   ⚠⚠ 이 필드는 `schema.ts` 자신이 P-10 에서 못박은 경고를 **정면으로 뒤집는다**. 옛 주석은
   _"'시험' 엔티티(과목당 여러 시험·가중치·유형)로 키우고 싶어지는 **금도금 미끄럼틀**"_ 을 경고하며
   `v1 은 과목당 마감 1개`로 잠갔다. 그 판단은 **실데이터가 0 이던 때** 내려졌다 — 지금은 4과목
   51챕터가 들어와 있고(`e07074f`) 중간·기말이 범위가 다른 두 사건이라는 사실이 그대로 남아 있다.
   경고에 대한 답은 **범위를 좁히는 것**이다:
     - ✅ 만든다: 과목당 시험 **최대 2개**(중간/기말) · 각자 **날짜 + 범위(thru)**.
     - ❌ 안 만든다: **가중치 · 과제 · 출석 · 시험 유형 자유입력 · 과목당 3개 이상.**
       이 넷이 미끄럼틀의 실제 경사면이다. 필요해지면 그때 근거를 들고 다시 연다.

   ⚠ `thru` 는 **인덱스가 아니라 챕터 id** 다 — 인덱스는 *위치*라 삽입·재정렬에 밀리고 id 는
   *정체성*이라 불변이다(과목 색이 `item.id` 를 파생 키로 쓰는 것과 같은 논증).
   ⚠ 저장 계약: `exams` 는 **옵셔널**이라 기존 저장·서버(D1)·폰 전부 무마이그레이션이다. 서버는
   `items` 를 `settings` 한 행의 **불투명 JSON** 으로 다루므로 **서버 계약 변경 0**(P-10 실측). */
export const ExamKindSchema = z.enum(['mid', 'final']);
export const ExamSchema = z.object({
  id: z.string(),
  kind: ExamKindSchema,
  /** 시험 날짜(ISO `YYYY-MM-DD`). */
  date: z.string(),
  /** 이 시험이 덮는 **마지막 챕터 id**. 없으면 "직전 시험 다음부터 끝까지". */
  thru: z.optional(z.string()),
});

/* ── Subject 일반화 · 과목 구분(P10 D6) ────────────────────────────────────
   왜 생겼나: 이 앱의 데이터 모델은 **전공 전제**였다 — 과목은 교재 챕터를 갖고, 시험(중간·기말)이
   있고, 학기의 `Course`(학점·성적)에 이어 붙는다. 그런데 언어 학습은 *학습 그 자체*라 이 앱의
   엔진(복습 주기·숙달도·주간 배분)이 그대로 적용되는데도(D6) 위 셋이 전부 헛돈다: 중간고사가 없고,
   학점으로 세지 않으며, 교수의 주차 진도가 없다. 그래서 소양 과목은 **화면마다 빈 칸으로 남았다.**

   ⚠ 처방이 "필러 이사"가 아닌 이유는 P10 D6 이 못박았다 — 언어를 `survey` 로 빼면 복습·배분 엔진을
   **두 벌** 만들어야 한다. 옮길 것은 과목이 아니라 **전제**다.

   ⚠⚠ 노브는 **하나**다. 여기서 늘리고 싶어지는 것들(과목 유형 자유입력 · 유형별 스케줄러 정책 ·
   '무한 진행' 과목 · 유형별 통계 분리)은 전부 **안 만든다** — `ExamSchema` 머리주석이 시험에 대해
   그은 것과 같은 선이다. 필요해지면 그때 근거를 들고 다시 연다.
   ⚠ 저장 계약: 옵셔널이고 **없으면 `'major'`** 다(옛 저장·서버·폰 전부 무마이그레이션). 읽기는
   `lib/semester.ts` 의 `isSoftSubject()` 하나로 모은다 — `item.kind === 'soft'` 를 직접 쓰지 말 것. */
export const SubjectKindSchema = z.enum(['major', 'soft']);

export const ItemSchema = z.looseObject({
  id: z.string(),
  source: z.optional(z.string()),
  name: z.string(),
  /** P10 D6. `'soft'` = 학기 회계 밖의 과목(언어 등). 없으면 `'major'`. */
  kind: z.optional(SubjectKindSchema),
  color: z.optional(z.string()),
  mode: ItemModeSchema,
  weeklyHours: z.optional(z.number()),
  dailyMin: z.optional(z.number()),
  /** N-1 **주당 과제 시간**(h). 이 과목이 매주 먹는 *공부 아닌* 시간 — 문제풀이 숙제·레포트.
   *
   *  ⚠ `weeklyHours`(주당 학습 시간)와 **다른 예산이다.** 합치면 "챕터를 나가는 시간"과
   *  "제출물을 만드는 시간"이 한 통에 들어가고, 그러면 과제가 많은 주에 진도가 조용히 밀린다 —
   *  지금 상태가 정확히 그것이고, 그 밀림이 어디서 왔는지 화면 어디에도 안 적힌다.
   *  ⚠ **날짜가 정해진 과제는 `tasks` 가 갖는다.** 이 필드는 *경상비*(매주 반복되는 부하)이고
   *  `tasks` 는 *특정일의 소비*다. 둘을 한 곳에 담으면 학기 부하 시뮬(`simulateSemester`)이
   *  아직 안 만든 과제를 셀 방법이 없어진다(개강 전엔 tasks 가 0이다).
   *  ⚠ 옵셔널 — 없으면 0. 옛 저장·서버·폰 전부 무마이그레이션. */
  choreWeeklyH: z.optional(z.number()),
  deadline: z.optional(z.string()),
  /** deadlineThru = **마감이 덮는 범위**의 마지막 챕터 id(P-10). 없으면 종전대로 "안 끝난 챕터 전부".
   *  ⚠ 왜 필요한가: 없으면 중간고사를 마감으로 넣는 순간 **영구히 빨간 경고**가 뜬다 — 마감을 넣은
   *  첫 입력의 보상이 음수라 사용자가 마감을 아예 안 쓰게 된다(`engine.ts` 의 `!finished` 판정).
   *  ⚠ **인덱스가 아니라 id 다** — 인덱스는 *위치*라 챕터 삽입·재정렬에 밀리고, id 는 *정체성*이라
   *  불변이다(과목 색이 `item.id` 를 파생 키로 쓰는 것과 같은 논증).
   *  ⚠ v1 은 **과목당 마감 1개 · 범위 칸 하나**다. "시험" 엔티티(과목당 여러 시험·가중치·유형)로
   *  키우고 싶어지는 금도금 미끄럼틀이 여기 붙어 있다 — 로드맵 P-10 이 미리 못박아 뒀다. */
  deadlineThru: z.optional(z.string()),
  /** T-1. 과목의 시험들(최대 2 · 날짜순). **`deadline`/`deadlineThru` 의 상위 집합**이다.
   *  ⚠ 두 원천을 동시에 읽지 말 것 — 읽기는 **`lib/semester.ts` 의 `examsOf(item)` 하나**로 모은다.
   *  `exams` 가 없으면 `examsOf` 가 옛 두 필드를 시험 1개로 승격시켜 돌려주므로, 옛 저장은 **한 글자도
   *  다르게 동작하지 않는다**(`scheduler.test.ts` 가 그 동작 보존을 잠그고 있다). */
  exams: z.optional(z.array(ExamSchema)),
  /** T-17 **주차 싱크** — 주차 n 에 교수가 나간 데까지의 **마지막 챕터 id**.
   *
   *  왜 필요한가: 교수는 교재 순서대로 안 나간다. 앱은 챕터를 *내* 진도로만 알고 있어서,
   *  "지금 수업이 어디인가"와 "내가 어디까지 했나"를 **비교할 수 없었다** — 그 어긋남이
   *  시험 범위 확정의 유일한 입력인데도 머릿속에만 있었다.
   *  ⚠ 주차별 **한 점**만 찍는다(구간이 아니라 누적 끝점). 구간으로 두면 빈 주·중복 주를
   *  사용자가 관리해야 하고, 그 복잡도가 정확히 T-1 이 거절한 금도금이다.
   *  ⚠ 인덱스가 아니라 챕터 id(`deadlineThru` 와 같은 논증). 주차는 `semesterPhase().week` 와
   *  같은 1-based 다 — 두 원천이 갈리면 "이번 주"가 화면마다 달라진다. */
  syllabus: z.optional(z.array(z.object({ week: z.number(), thru: z.string() }))),
  /** T-27 **선수 관계**(과목 → 이 과목보다 먼저인 과목들의 `Item.id`).
   *
   *  왜 필요한가: 결손은 **시험 때** 발견된다 — 그때는 늦다. 링크가 있으면 앱이 "이 과목을
   *  열기 전에 저 과목의 이 챕터가 비어 있다"를 개강 전에 말할 수 있다(T-15 가 소비한다).
   *  ⚠ **한 방향**이다(후행 → 선행). 양방향은 갈릴 수 있고, 갈리면 정본을 말할 수 없다
   *  (`Course.itemId` 와 같은 판단). 역방향 조회는 `lib/prereq.ts` 가 순회로 답한다.
   *  ⚠ 순환을 스키마가 막지 않는다 — 검증은 읽기 쪽(`prereqChain`)이 방문집합으로 한다.
   *    스키마에 넣으면 저장이 거부되고, 사용자는 *왜* 거부됐는지 알 방법이 없다. */
  prereqIds: z.optional(z.array(z.string())),
  chapters: z._default(z.array(ChapterSchema), []),
});

export const RoutineBlockSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  start: z.string(),
  end: z.string(),
  days: z.array(z.number()),
  /* ── I013 — **수업이 어느 과목인가**(2026-08-22 발상 축) ─────────────────────────────
     종전엔 수업 블록이 «가용시간을 깎는 장애물» 이기만 했다. 실측(2026-08-22): 실 DB 의 수업
     블록 넷이 **전부 이름이 「수업」** 이고 주 10시간을 먹는데, 같은 사람의 자습 목표 합은
     주 3시간이다 — 즉 앱이 세는 학습의 **세 배**가 이름 없이 앉아 있었다.
     ⚠ **옵셔널이고 없으면 「과목 미상」이다**(옛 저장·서버·폰 전부 무마이그레이션). 일과는
       `settings.routine` 한 행의 불투명 JSON 안에 살므로 **D1 계약 변경 0**이다.
     ⚠⚠ **이 필드는 계산을 바꾸지 않는다.** 가용시간 차감은 종전 그대로다(`scheduler/windows`
       는 `type` 만 본다) — 여기서 스케줄러 거동까지 바꾸면 «이름을 붙였더니 계획이 달라졌다»가
       되어, 되돌리기 비용이 이름표 하나의 값을 넘는다. 지금 지는 것은 **표시**뿐이다. */
  sid: z.optional(z.string()),
  // 요일별 시간 오버라이드(선택) — 키=요일(일0..토6) 문자열. 없으면 start/end 공통 적용.
  // 일과 블록도 수업처럼 요일마다 다른 시간을 가질 수 있게(blocksForWeekday가 단일 지점서 해석).
  times: z.optional(z.record(z.string(), z.object({ start: z.string(), end: z.string() }))),
});

/** doneDs = 실제 완료 날짜(감사 2026-07-16 ②#23) — 복습 사다리 앵커. 옵셔널이라 기존 저장 무마이그레이션
 *  (없으면 계획일 앵커 = 종전 동작). 계획일(completions 키)과 다르면 '늦게 완료'를 뜻한다. */
/* ⚠ `min` 은 **계획된 분**이다(체크 시점의 블록 길이). G-1 이전엔 회고 전량이 이 값을
   "집중한 시간"으로 읽었고, 그중 `adherenceFactor` 는 그 값으로 **계획 용량을 0.5~1.0배 실제로
   깎았다** — 즉 체크박스가 미래 일정을 바꾸는데 아무도 그 사실을 몰랐다. `actualMin` 은
   `useFocus` 가 아는 **실제 경과 분**이고, 있으면 그것을 쓴다(`completionMin`). 옵셔널이라
   기존 저장·서버 계약(값을 불투명하게 다룬다)·폰 모두 무마이그레이션. */
export const CompletionEntrySchema = z.object({
  done: z.boolean(),
  min: z.number(),
  doneDs: z.optional(z.string()),
  actualMin: z.optional(z.number()),
  /** T-8 **시각 원장** — 완료를 체크한 **하루 중 시각**(`HH:MM`, 로컬).
   *
   *  ⚠⚠ 이 필드가 없어서 로드맵의 T-8·T-10·T-5 가 **"표본 대기"로 영원히 멈춰 있었다.** 셋 다
   *  "관측이 쌓이면 판정한다"고 적혀 있었는데, **관측을 만드는 코드가 바로 그 항목 자신**이었다
   *  (완료에 시각 필드가 없으면 완료 시각은 영원히 안 쌓인다). 순환 대기를 끊는 한 줄이다.
   *  ⚠ **날짜가 아니라 시각만** 담는다 — 날짜는 이미 `doneDs` 가 갖고 있고, 둘을 한 필드에
   *  합치면 기존 `doneDs` 소비처(복습 사다리 앵커)가 파싱을 다시 해야 한다.
   *  ⚠ 지금은 **아무 화면도 이 값을 안 그린다.** 그게 의도다 — 로드맵 T-8 의 "가장 싼 검증"이
   *  _"`doneAt` 한 필드만 추가하고 2주 방치"_ 다. 표본이 쌓인 뒤에 무엇을 그릴지 정한다. */
  doneAt: z.optional(z.string()),
});
/** completions[ds][`${sid}|${type}`] = {done,min} */
export const CompletionsSchema = z.record(z.string(), z.record(z.string(), CompletionEntrySchema));

export const SummarySchema = z.object({
  id: z.string(),
  sid: z.string(),
  name: z.string(),
  s1: z.string(),
  s2: z.string(),
  s3: z.string(),
  at: z.optional(z.number()), // 작성 시각(epoch ms) — 구버전엔 없음(로그 타임스탬프·정렬용)
});

export const CbmsCodeSchema = z.enum(['C', 'B', 'M', 'S', 'T']);
export const CbmsSchema = z.object({
  id: z.string(),
  ds: z.string(),
  sid: z.string(),
  name: z.string(),
  chapter: z.string(),
  code: CbmsCodeSchema,
  note: z.string(),
  conf: z.optional(z.boolean()), // 구버전엔 없음 — '찍어서 맞음' 플래그(F-06)
  at: z.optional(z.number()), // 작성 시각(epoch ms) — 구버전엔 없음(로그 타임스탬프)
  /* ── N-4 **지식요소(KC)**(발산 6회차 · 2026-08-07) ────────────────────────────
     이 오답이 어느 *도구*에서 났나 — 챕터를 **가로지르는** 축.

     ## 왜 필요한가: 지금은 원리적으로 표현이 불가능하다
     이 앱의 모든 약점 축이 `sid|챕터명` 문자열이다. 그래서 3장·5장·7장에서 각각 한 번씩
     막히면 **어느 챕터도 `weakSpots` 임계(2회)에 안 들어오고**, 앱은 "괜찮다"고 말한다.
     실제로는 세 챕터의 공통 도구(예: 라플라스 역변환)에서 세 번 막힌 것이다 — 단원별로는
     다 통과인데 시험에서 무너지는 전형적 형태이고, 밖에서는 이걸 Q-matrix/지식요소로 푼다.

     ## ⚠ 자유 텍스트 배열이다 — 분류 체계를 만들지 않는다
     코드표(CBMS 5분류)를 하나 더 만들고 싶어지는 자리인데, 그건 **사용자가 자기 과목의
     도구 이름을 미리 알 수 없다**는 사실과 어긋난다. 태그는 쓰면서 생기는 것이지 미리
     정하는 것이 아니다. ⚠ 그래서 **정규화도 안 한다**(trim 만) — 동의어 통합은 표본이
     쌓인 뒤 사람이 볼 문제이고, 지금 자동으로 묶으면 묶은 근거가 어디에도 안 남는다.

     ## ⚠ 이 필드의 검증은 "달아 보는 것" 자체다
     로드맵 N-4 의 가장 싼 검증이 _"기존 `cbms.note` 30건에 손으로 태그를 달아 본다.
     다른 챕터에서 같은 태그가 2회 이상 나오면 참, **0이면 폐기**"_ 다. 그 실험을 앱 안에서
     할 수 있게 하는 것이 이 한 줄이고, 결과가 0이면 **이 축은 지운다.**

     ⚠ `records` 슬라이스라 D1 DDL 0 · 서버 zod 0 · 폰 전파 0. 옵셔널이 계약. */
  kc: z.optional(z.array(z.string())),
});

/* ── T-7 문항 원장 · T-2 시험 회수 창 ──────────────────────────────────────
   왜 CBMS 로 안 되나: `cbms` 는 **틀린 사건**의 기록이다(코드·메모). 문항은 *다시 풀 수 있는
   대상*이라 수명이 다르다 — 시험 2주 전에 열리는 것은 "무엇을 틀렸나"가 아니라 "그 문제"다.
   둘을 한 배열에 섞으면 오답 노트가 문제은행이 되고, 오답의 시제(과거 사건)가 흐려진다.

   ⚠ **`records` 슬라이스라 D1 DDL 0 · 서버 zod 0 이다** — `records` 는 `(slice, id, ord, value)`
   이고 `value` 는 불투명 JSON 이라 서버가 그 안을 한 번도 안 본다(`blankResults` 가 P-11 에서
   같은 경로로 들어간 선례). 슬라이스 이름은 **데이터**이지 스키마가 아니다.

   ⚠ 안 만드는 것: 정답·해설 본문 · 이미지 · 태그 분류 체계 · 자동 채점. 문항 하나에 30초라는
   전제가 이 항목의 근거인데, 그 넷이 붙는 순간 30초가 5분이 되고 아무도 안 적는다. */
export const QuestionSchema = z.object({
  id: z.string(),
  ds: z.string(),
  sid: z.string(),
  /** 챕터 이름(있으면). ⚠ `cbms.chapter` 와 **같은 축**이다(이름 문자열) — 거기서 이미
   *  이름으로 다니고 있어 id 로 바꾸면 두 원장이 다른 키로 같은 챕터를 가리킨다. */
  chapter: z.optional(z.string()),
  /** 문제 자체(짧게 · 4칸 중 첫 칸). */
  prompt: z.string(),
  /** 어디서 나왔나 — `교재 3-2` · `중간 5번` · `퀴즈`. */
  source: z.optional(z.string()),
  /** 무엇이 관건이었나 / 왜 틀렸나. */
  why: z.optional(z.string()),
  /** T-2 회수 창에서 들어왔나. **직후 20분의 기억은 나중보다 정확하다**는 전제가 이 항목의
   *  근거라, 그 사실을 값에 남긴다 — 안 남기면 나중에 신뢰도를 가를 수 없다. */
  fromRecall: z.optional(z.boolean()),
  /* ── A-14 **다시 만날 날**(발산 6회차 · 2026-08-07) ──────────────────────────
     이 원장의 결함은 내용이 아니라 **시제**였다: 아카이브는 *사용자가 갈 때만* 존재하는데,
     갈 이유가 발생하지 않는다(문항이 스스로 부르지 않는다). 챕터는 `spacedReview` 사다리가
     불러 주고 오답(`cbms`)은 약점 배분이 불러 주는데, 문항만 부르는 사람이 없었다.

     ⚠ **새 사다리를 만들지 않는다.** 간격은 `REVIEW_OFFSETS`(1·3·7·16 → 34) 그대로이고,
     `met` 의 길이가 사다리의 몇 번째 칸인지를 말한다 — 별도 `nextDs` 를 저장하지 않는 이유는
     그것이 **파생값**이기 때문이다(저장하면 자정마다 낡는다 · `semesterPhase` 와 같은 논증).
     ⚠ 배열인 것이 계약: "몇 번 다시 만났나"와 "마지막이 언제였나"를 한 필드가 함께 답한다. */
  /** 다시 만난 날들(ISO · 오름차순). 없으면 아직 한 번도 안 만난 것. */
  met: z.optional(z.array(z.string())),
});

export const BacklogSchema = z.object({
  id: z.string(),
  ds: z.string(),
  sid: z.string(),
  name: z.string(),
  topic: z.string(),
  note: z.string(),
  done: z.boolean(),
  doneDs: z.string(),
  at: z.optional(z.number()), // 작성 시각(epoch ms) — 구버전엔 없음(로그 타임스탬프)
  /* ── I042 **캡처 트리아지**(2026-08-22 발상 축) ────────────────────────────────────────
     ⚠⚠ **캡처는 판정 없이 백로그로 직행했다.** 세 입구(⌘K·미니 HUD·폰 캡처 바)가 전부
     `addBacklog` 로 곧장 들어가므로, «지하철에서 떠오른 한 줄»과 «수업 중 정말 막힌 것»이
     같은 목록의 같은 무게로 쌓인다. 밖의 표본이 경고하는 결말이 그것이다:
     *"검증 안 된 유입이 쌓여 백로그 전체가 아무도 안 읽는 목록이 된다"*(linear.app/docs/triage ·
     확인 2026-08-22). 그 문서가 함께 적는 대가도 그대로 가져온다 — **판정 노동이 의무가 된다.**

     그래서 이 앱의 형태: 트리아지는 **별도 목록이 아니라 플래그**다. 캡처가 만든 것은
     `triaged:false` 로 들어오고, 손으로 만든 보충은 처음부터 판정된 것이다. 나가는 길은 셋 —
     지금 배정(과목을 준다) · 버림(지운다) · **N일 뒤**(`snoozeUntil`).
     ⚠ 스누즈가 이 앱에 없었다는 지적이 이 항목의 각주였는데, 같은 회차의 I040 이 복습 축에
     그 어휘를 세웠다(`reviewSnooze`). 여기는 **날짜까지**를 담는다 — 복습의 「오늘만」과 달리
     보충은 «다음 주에 다시 보자»가 자연스러운 단위다.
     ⚠ 둘 다 옵셔널 — 옛 저장 무마이그레이션(없으면 판정된 것으로 읽는다). */
  /** 트리아지를 거쳤는가. **없으면 참**으로 읽는다 — 옛 항목을 미분류로 되살리지 않는다. */
  triaged: z.optional(z.boolean()),
  /** 이 날짜까지 목록에서 숨긴다(`YYYY-MM-DD`). 지나면 스스로 돌아온다. */
  snoozeUntil: z.optional(z.string()),
});

export const BlankResultSchema = z.object({
  id: z.string(),
  ds: z.string(),
  sid: z.string(),
  name: z.string(),
  passed: z.boolean(),
  note: z.string(),
  /* ⚠⚠ **챕터 단위 실패 기록**(근본이관 ① · 2026-08-01 `/감사 근본` · 사용자 승인).

     로드맵은 이 한 줄에서 **갈림길을 만나 멈춰** 있었다: *"스키마 추가가 D1·서버 strict zod·
     폰까지 번진다 — `ds_map` 슬라이스로 실을 수 있는지가 갈림길"*. 감사가 그 갈림길을 측정으로
     해소했다 — `blankResults` 는 `records` 슬라이스이고(`db/rows.ts:31 ARRAY_SLICES`),
     `records.value` 는 `JSON.stringify` 된 **불투명 문자열**이라 서버 `TABLE_COLS`
     (`server/src/index.ts:76`)가 그 안을 **한 번도 안 본다.**
     → **D1 DDL 0 · 서버 zod 0 · 폰 전파 0 · 별도 `reviewMiss` 맵 불필요.**
     선례는 같은 파일의 `conf`·`at` 이고, 이 필드는 그 관용구를 그대로 따른다.

     ⚠ **옵셔널인 것이 계약이다** — 구버전 저장본·다른 기기가 보내온 행에는 이 키가 없다.
     필수로 두면 `parseState` 가 옛 데이터를 통째로 거부한다(가져오기·pull 이 함께 죽는다).

     ⚠ **남은 위험 둘은 이 필드가 안 푼다**(로드맵이 이미 적어 둔 것): ① 기록은 여전히
     *하루·과목당 하나*라 한 과목에서 두 챕터를 본 날은 뒤엣것이 앞엣것을 덮는다 ② '넘김'과
     '실패'는 다르다. 둘은 이 줄이 아니라 기록 단위·어휘의 문제다. */
  chapter: z.optional(z.string()),
});

export const RetentionSchema = z.object({
  wk: z.string(),
  at: z.string(),
  due: z.number(),
  cards: z.number(),
});

export const WeeklySchema = z.object({
  checks: z.record(z.string(), z.boolean()),
  note: z.string(),
});

export const RitualSchema = z.object({
  plan: z.boolean(),
  shutdown: z.boolean(),
  note: z.string(),
  /* ── T-10 **중단 지점** ────────────────────────────────────────────────────────────
     왜 여기인가: 미완의 이유를 담을 곳이 앱에 **한 군데도 없었다.** 완료를 해제하면
     `setDone` 이 `delete m[k]` 로 **기록 자체를 지우므로**(`persistence.ts`), "하려다 못 했다"는
     사실이 흔적 없이 사라진다. 그래서 "왜 매번 이 과목만 밀리나"를 물을 근거가 0이었다.
     ⚠ **`completions` 를 건드려 담지 않는다** — 그 맵의 존재=완료라는 뜻을 여러 소비처가
     의존한다(`adherenceFactor` 는 그 값으로 미래 용량을 깎는다). 하루 단위 의식에 붙이는 편이
     의미도 맞다: 중단은 블록의 속성이 아니라 **그날의 속성**이다.
     ⚠ 둘 다 옵셔널 — 옛 저장 무마이그레이션. */
  /** 그날 못 끝낸 이유 한 줄(자유 입력 · 강제하지 않는다). */
  stopWhy: z.optional(z.string()),
  /** 그 시점에 남아 있던 블록 수 — **표본의 분모**다. 이유만 있고 규모가 없으면 나중에 비교가 안 된다. */
  stopPending: z.optional(z.number()),
  /* ── I004 **기록의 방향을 뒤집는다**(2026-08-22 발상 축) ────────────────────────────────
     이 앱의 기록 필드는 전부 **계획을 기준**으로 묻는다: 체크박스(계획대로 했나) · `stopWhy`
     (왜 못 했나) · `note`(내일 뭘 할까). 실측은 그 전제를 반증했다 — 학습 표가 전부 0행이다.
     즉 사람이 사전 계획에 자기를 맞춰 보고하는 형태 자체가 안 채워졌다.

     여기 담는 것은 **계획을 참조하지 않는 한 줄**이다: *"오늘 무슨 일이 있었나."* 계획 밖에서
     한 것도, 계획을 통째로 갈아엎은 것도 그대로 적힌다. 사후 30초이고, 안 적어도 아무 일도
     안 일어난다(강제 0).
     ⚠ **`stopWhy` 와 다르다**: 저기는 «못 한 것»의 이유이고 여기는 «한 것»이다. 한 칸으로
       합치면 그 칸은 다시 계획을 기준으로 말하게 된다(그게 이 항목이 뒤집으려는 방향이다).
     ⚠ 옵셔널 — 옛 저장 무마이그레이션. */
  /** 그날 실제로 있었던 일 한 줄(계획 무관 · 자유 입력). */
  did: z.optional(z.string()),
});

// 학기 과목. (이 스키마들은 영속 데이터 검증이 아니라 *타입 출처*로만 쓰인다 — validShape는 손코딩,
//  AppStateSchema는 어디서도 .parse되지 않음. 그래서 실제 필드로 정밀화해도 기존 데이터 호환에 영향 0.)
export const CourseSchema = z.object({
  id: z.string(),
  name: z.string(),
  credits: z.number(),
  category: z.string(),
  status: z.string(),
  grade: z.optional(z.string()),
  /** T-1. **두 우주를 잇는 유일한 다리** — 실행 쪽 `Item.id`. 링크는 **한 방향**이다(회계 → 실행):
   *  양방향으로 두면 갈라질 수 있고, 갈라지면 어느 쪽이 정본인지 말할 수 없다. 역방향 조회는
   *  `lib/semester.ts` 의 `courseOfItem` 이 순회로 답한다(학기당 과목 수가 한 자릿수라 비용이 0). */
  itemId: z.optional(z.string()),
});
/* ── N-19 **학사일정 눈금**(발산 6회차 · 2026-08-07) ──────────────────────────
   정정·철회·휴강·보강. 지금 이 넷은 **머릿속 + 포털**에 있고, 앱은 학기가 *언제 시작해 언제
   끝나는지*만 안다. 그런데 이 넷은 전부 **되돌릴 수 없는 마감**이다 — 철회 기한을 넘기면 그
   과목은 학기 내내 분모에 남고(`staleSemesterLinks` 가 사후에 그 대가를 잰다), 휴강·보강은
   그 주의 가용 시간을 통째로 바꾼다.

   ⚠ **일정(`events`)이 아니다.** 일정은 *그 시간에 일어나는 일*이라 가용 시간을 깎는데, 눈금은
   **날짜의 성질**이라 길이가 없다(정정 기간은 하루 종일 공부할 수 있다). 같은 배열에 넣으면
   `eventIntervals` 가 그것을 점유로 읽어 그날 계획이 통째로 비는, 조용한 오작동이 된다.
   ⚠ 종류를 **넷으로 닫는다** — 자유 입력을 열면 눈금이 일정의 다른 이름이 된다(`ExamSchema`
   머리주석이 시험에 그은 것과 같은 선). 파서·라벨의 SSOT 는 `lib/syllabus.ts`.
   ⚠ 옵셔널이라 옛 저장·서버(`items`·`degree` 는 `settings` 한 행의 불투명 JSON)·폰 전부
   무마이그레이션이다. */
export const MarkKindSchema = z.enum(['fix', 'drop', 'off', 'makeup']);
export const AcademicMarkSchema = z.object({
  id: z.string(),
  kind: MarkKindSchema,
  /** ISO `YYYY-MM-DD`. */
  ds: z.string(),
  label: z.string(),
});

/* ── N-18 **이번 학기 목표**(발산 6회차 · 2026-08-07) ─────────────────────────
   장기 목표는 지금 **볼트 손저작**(= 다른 앱)에 있고, 그래서 앱의 수와 한 번도 만나지 않는다.
   목표를 적는 칸을 만드는 것은 쉽지만 그건 메모장이다 — 이 항목의 값은 **판정하는 수를 함께
   고르게 하는 것**이다(로드맵의 가장 싼 검증이 정확히 _"목표 3줄 옆에 앱의 어느 수가 판정하나"_).

   ⚠ `metric` 을 **닫힌 넷**으로 두는 이유: 자유 텍스트 목표는 앱이 진척을 말할 수 없고, 말할 수
   없으면 학기 말에 아무도 다시 안 본다(= 볼트 메모와 같아진다). 판정은 `lib/semesterGoals.ts`
   하나가 소유한다.
   ⚠ **셋까지**다(읽기에서 자른다). 넷째 목표는 우선순위가 없다는 뜻이고, 이 항목이 없애려는
   것이 정확히 그것이다. */
export const GoalMetricSchema = z.enum(['gpa', 'hours', 'chapters', 'adherence']);
export const SemesterGoalSchema = z.object({
  id: z.string(),
  /** 사람의 말로 쓴 목표 한 줄. */
  text: z.string(),
  metric: GoalMetricSchema,
  /** 그 지표의 목표값(GPA 는 점, hours 는 시간, chapters 는 개, adherence 는 %). */
  target: z.number(),
});

export const SemesterSchema = z.object({
  id: z.string(),
  name: z.string(),
  courses: z._default(z.array(CourseSchema), []),
  /** N-19 학사일정 눈금(위 주석). 옵셔널 — 옛 저장 무마이그레이션. */
  marks: z.optional(z.array(AcademicMarkSchema)),
  /** N-18 이번 학기 목표(최대 3 · 위 주석). 옵셔널 — 옛 저장 무마이그레이션. */
  goals: z.optional(z.array(SemesterGoalSchema)),
  /** T-1. 학기의 **시작·종료 날짜**(ISO). 종전엔 학기에 날짜가 아예 없어서 "지금이 학기 중인가
   *  방학인가"를 앱이 **원리적으로 알 수 없었다** — 그래서 모든 화면이 *지금 상태*만 그렸고
   *  시간축이 수개월인 것이 0 이었다(각도 3 의 관측). 둘 다 옵셔널 — 옛 저장 무마이그레이션. */
  startDs: z.optional(z.string()),
  endDs: z.optional(z.string()),
});
export const DegreeSchema = z.object({
  targetTotal: z.number(),
  reqMajorReq: z.number(),
  reqMajorSel: z.number(),
  reqLiberal: z.number(),
  semesters: z.array(SemesterSchema),
  targetGpa: z.optional(z.number()), // 목표 졸업 GPA(역산 계산기) — 옵셔널이라 기존 저장 상태 무마이그레이션.
});

export const AnkiSchema = z.object({ source: z.string() });

/* ── 일일 배치 오버라이드(계획 개편 §4-1) ─────────────────────────────
   자동초안 위에 얹는 수동 배치. 옵셔널·passthrough라 기존 저장 100% 호환(무마이그레이션).
   dayOverrides(그날 가용 *시간 수*)와 직교 — 이건 그날 *배치*의 진리다. */
export const PlacedBlockSchema = z.object({
  id: z.string(),
  type: z.enum(['anki', 'new', 'rev', 'blank', 'mock']), // SessionType
  sid: z.string(), // 과목 id('mock'은 모의)
  name: z.string(),
  color: z.optional(z.string()),
  start: z.optional(z.number()), // 자정 기준 분(명시 배치) — layoutDay가 존중. 없으면 미지정(트레이).
  min: z.number(),
  chapters: z.optional(z.array(z.string())),
  pinned: z.optional(z.boolean()), // 자동 재계산에서 보존
  // 블록별 완료(수동 날 · 같은 sid|type 여러 블록을 독립 체크). completions[ds][sid|type] 집계는
  // setBlockDone이 이 플래그들의 OR/합으로 미러링해 하류(스케줄러 복습씨앗·통계·.ics)는 무변경.
  done: z.optional(z.boolean()),
});
export const DayPlanSchema = z.object({
  mode: z.enum(['auto', 'manual']), // manual = 그날 배치의 진리는 사용자
  blocks: z.array(PlacedBlockSchema),
});

/* ── 자유 할 일(계획 개편 §4-4) ────────────────────────────────────────
   과목에 안 묶인 할 일(과제 제출·도서 반납). 공부 블록(스케줄러 소유)과 별개 독립 리스트(저위험 분리).
   신규·옵셔널·무마이그레이션. */
export const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  sid: z.optional(z.string()), // 연결 과목(선택) — 색·필터용. 없으면 순수 자유 할 일
  color: z.optional(z.string()),
  ds: z.optional(z.string()), // 배정 날짜(YYYY-MM-DD). 없으면 '언젠가'(인박스)
  start: z.optional(z.number()), // 시각(분). 없으면 그날 미지정 트레이
  min: z.optional(z.number()), // 소요(선택) — 캘린더 블록 높이
  /* ⚠ 이 필드는 2026-07-29 까지 **쓰기 0·읽기 0** 이었다(스키마·동기화 계약엔 있는데 사용자는
     넣을 수도 볼 수도 없었다). 같은 날 배선했다 — 쓰기는 `DayPlanner` 편집 바의 날짜 입력,
     읽기는 트레이 칩의 D-day 배지(`ddayInfo`). 둘 중 하나만 있으면 나머지 하나가 영원히
     빈다는 것이 이 필드가 죽어 있던 이유다.
     ⚠ `Item.deadline`(과목 마감)과 **다른 것**이다 — 이름이 같아 혼동하기 쉽다. */
  deadline: z.optional(z.string()), // ⏰ 마감(선택 · 할 일 전용)
  done: z.optional(z.boolean()),
  doneDs: z.optional(z.string()),
  at: z.optional(z.number()), // 생성 시각(로그·정렬)
  repeat: z.optional(z.enum(['daily', 'weekly'])), // 반복(선택) — 완료 시 다음 occurrence를 새 task로 spawn
});

/* ── 일정(Wave 5) ──────────────────────────────────────────────────────
   과목과 무관하고 반복도 아닌 **단발 일정**(약속·시험·행사). tasks(할 일: 체크해서 완료)와
   의미가 다르다 — 일정은 '그 시각에 일어나는 일'이라 **완료 개념이 없고**, 반드시 날짜를 가진다
   (인박스가 없다).
   ⚠ **종전 이 자리는 «대신 그 시간만큼 공부 가용시간을 깎는다»가 일정만의 성질이라 말했는데,
     2026-08-07 의 N-1 이 그것을 뒤집었다** — `scheduler/windows.ts` 의 `dayOccupancy` 는 이제
     `events ∪ 시각이 박힌 미완 과제` 다. 즉 **가용시간을 깎는 것은 둘의 공통점**이고, 남은 차이는
     위 두 줄(완료 · 날짜 필수)뿐이다. 이 문장이 2주 넘게 낡아 있었고, 발상 축 I028 이
     «둘을 병합하라»는 처방을 이 낡은 문장 위에서 냈다(2026-08-22 실측으로 기각).
   반복 일과는 routine(요일 기반), 과목 파생 블록은 dayPlans — 셋과 직교한다.
   이름이 PlanEvent인 이유: `Event`는 DOM 전역과 충돌한다.
   ⚠ allDay는 일부러 없다 — '종일'의 가용시간 의미가 모호해(하루 전체를 0으로?) 과설계가 된다.
     종일이 필요하면 start=0·min=1440으로 표현되며, 그 해석은 산술 하나로 일관된다.
   신규·옵셔널·무마이그레이션(기존 저장본은 필드 부재 → 빈 배열로 동작). */
export const PlanEventSchema = z.object({
  id: z.string(),
  ds: z.string(), // 날짜(YYYY-MM-DD) — 일정은 반드시 날짜를 가진다(인박스 없음. 그게 할 일과의 차이)
  start: z.number(), // 자정 기준 분(0~1439)
  min: z.number(), // 길이(분) — start+min<=1440 클램프(events.ts)
  title: z.string(),
  note: z.optional(z.string()),
  color: z.optional(z.string()), // 캘린더 칩 색(선택) — Task와 같은 관례
  at: z.optional(z.number()), // 생성 시각(로그·정렬)
});

/* ── 주간 배분(재개편 v2 §12-3) ─────────────────────────────────────────
   weekMon(ISO 월요일) → sid → 7요일[분](index=wd, 0=일..6=토). '이번 주 어느 과목을 어느 요일에 얼마씩'.
   **매주 새로**(반복 템플릿 아님) · dayPlans(그날 시각 배치)와 직교(이건 그 주 요일 분배 예산).
   옵셔널·passthrough라 기존 저장 100% 호환(무마이그레이션). 배분 있는 주만 스케줄러가 배분 구동, 없으면 자동 불변(§12-4). */
export const WeekAllocSchema = z.record(z.string(), z.record(z.string(), z.array(z.number())));

/** 지식상태(_지식상태.json) — graphPriority 보정에 쓰는 과목 숙달도(서버/외부 캐시). */
export const KnowStateSchema = z.looseObject({
  subjects: z.optional(z.array(z.looseObject({ subject: z.string(), mastery: z.number() }))),
});

export const AppStateSchema = z.looseObject({
  schemaVersion: z.number(),
  theme: ThemeSchema,
  completions: CompletionsSchema,
  startDate: z.string(),
  moduleLen: z.number(),
  reviewRatio: z.number(),
  routine: z.array(RoutineBlockSchema),
  dayOverrides: z.record(z.string(), z.union([z.number(), z.string()])),
  items: z.array(ItemSchema),
  summaries: z.record(z.string(), z.array(SummarySchema)),
  cbms: z.array(CbmsSchema),
  /** T-7 문항 원장. **옵셔널이 계약이다** — 구버전 저장본·다른 기기 pull 에는 이 키가 없고,
   *  필수로 두면 `parseState` 가 옛 데이터를 통째로 거부한다(가져오기·pull 이 함께 죽는다). */
  questions: z.optional(z.array(QuestionSchema)),
  /** T-9 지연 JOL — **예측만** 적는다(해소는 `blankResults` 에서 파생 · `lib/delayedJol` 머리주석).
   *  옵셔널이 계약인 이유는 `questions` 와 같다. */
  jolAsks: z.optional(
    z.array(
      z.object({
        id: z.string(),
        ds: z.string(),
        sid: z.string(),
        chapter: z.string(),
        predicted: z.boolean(),
      }),
    ),
  ),
  /* ── A-2 **인출 지연 원장**(발산 6회차 · 2026-08-07) ─────────────────────────
     카드를 띄운 순간부터 '펼치기'까지의 경과 ms + 그 카드의 판정.

     ## 왜 새 슬라이스인가 — **숙주를 한 번 잘못 골랐다**
     처음엔 `blankResults` 에 필드를 달았다. 틀렸다: 그 배열을 쓰는 곳은 `TodayBlocks`
     (백지 복습)뿐이고 **`ReviewRun` 은 안 쓴다**. 러너의 인출은 `reviewTouches`(날짜 문자열
     하나)만 남기므로 담을 자리가 원리적으로 없었다. 아무도 안 쓰는 필드를 남기면 이 저장소가
     반복해서 잡아 온 *"쓰기 0 · 소비처 0"* 결함이 된다 → 되돌리고 여기로 옮겼다.

     ## 왜 이 신호인가
     이 앱의 인출 관측은 **통과/막힘 1비트가 전부**였다(`ReviewRun.tsx` 에 `performance.now`
     0건). 같은 통과라도 3초와 40초는 다른 상태다 — 후자는 붙은 것이 아니라 *더듬어 찾아낸*
     것이고, 시험은 그것을 통과로 안 쳐 준다. CBMS 의 `T`(시간) 코드가 사후 자기보고로 같은
     것을 잡고 있었는데 그건 이미 늦은 관측이다.
     ⚠⚠ **사용자가 아무것도 더 안 해도 생기는 유일한 신호다.** 이 회차의 다른 신규 신호는
     전부 새 입력을 요구한다 — 그래서 이것을 가장 먼저 단다. 표본은 시간이 만든다.

     ⚠ `records` 슬라이스라 **D1 DDL 0 · 서버 zod 0 · 폰 전파 0**(`questions`·`jolAsks` 선례).
     ⚠ **옵셔널이 계약**이다 — 옛 저장·다른 기기 pull 에 이 키가 없다.
     ⚠ **지금은 아무 화면도 이 값을 안 그린다.** 그게 의도다(`doneAt`(T-8)이 세운 관용구):
     관측 며칠치로 챕터를 줄 세우면 `chapterStrength` 가 이미 거절한 정밀도의 착시가 된다.
     소비처는 표본이 쌓인 뒤에 정한다. */
  retrievals: z.optional(
    z.array(
      z.object({
        id: z.string(),
        ds: z.string(),
        sid: z.string(),
        chapter: z.string(),
        /** 카드 노출 → 펼치기까지의 ms. */
        ms: z.number(),
        /** 그 카드를 떠올렸나(펼친 뒤의 판정). 넘김이면 false. */
        got: z.boolean(),
      }),
    ),
  ),
  backlog: z.array(BacklogSchema),
  blankResults: z.array(BlankResultSchema),
  retentionLog: z.array(RetentionSchema),
  weekly: z.record(z.string(), WeeklySchema),
  rituals: z.record(z.string(), RitualSchema),
  /* 이어하기 커서(N-7) — **기기 id → 커서**. 옵셔널이라 기존 저장은 무마이그레이션.
       `ds_map` 슬라이스라 기기당 1행이고, 각 기기가 자기 행만 써서 병합 충돌이 없다.
       6시간 TTL 은 읽는 쪽(`latestResume`)이 판정한다 — 저장된 값을 시간이 지났다고 지우는
       배경 작업을 만들면 그게 또 하나의 동기화 쓰기가 되고, 그 쓰기는 아무도 안 읽는다. */
  resume: z.optional(
    z.record(
      z.string(),
      z.object({
        kind: z.enum(['review', 'focus', 'journal']),
        label: z.string(),
        at: z.number(),
        progress: z.optional(z.string()),
        /* E26(2026-07-29) — 집중 세션의 종료 시각(epoch ms). `kind:'focus'` 에만 실린다.
             ⚠ 서버 DDL·zod 가 0인 이유: `resume` 은 `ds_map` 슬라이스이고 그 `value` 는 **JSON
             문자열이라 서버에 불투명**하다. 즉 이 필드는 클라 계약에만 존재한다.
             ⚠ optional 이라 옛 저장본은 무마이그레이션으로 그대로 읽힌다. */
        endsAt: z.optional(z.number()),
      }),
    ),
  ),
  blankReviewWeekly: z.boolean(),
  mockEveryWeeks: z.number(),
  adaptiveCapacity: z.boolean(),
  peakStart: z.string(),
  peakEnd: z.string(),
  reviewViaAnki: z.boolean(),
  graphPriority: z.boolean(),
  degree: DegreeSchema,
  anki: AnkiSchema,
  /** reviewTouches[`${sid}|${chapter}`] = ds(YYYY-MM-DD) — ReviewRun의 챕터 단위 인출 기록.
   *  위험모델(spacedReview)의 lastDs를 계획 밖 복습에서도 갱신(감사 #22). 구버전엔 없음. */
  reviewTouches: z.optional(z.record(z.string(), z.string())),
  /** reviewHold[`${sid}|${chapter}`] = ds(뺀 날) — **복습 보류 선반**(P-11). 규약·근거는
   *  `lib/reviewHold.ts` 머리주석이 SSOT. 요지: `건너뛰기` 가 아무것도 안 써서 밀린 챕터가
   *  **내일 완전히 동일하게 돌아왔고**, 앱 안에 "이건 안 볼게"라고 말할 문법이 없었다.
   *  ⚠ 값이 날짜인 것은 선반이 "언제 뺐나"를 말하기 위해서다 — **자동 만료용이 아니다**
   *  (P-9 와 같은 되돌리기 규칙을 공유해야 하고, 거긴 만료가 없다). */
  reviewHold: z.optional(z.record(z.string(), z.string())),
  /** reviewSnooze[`${sid}|${chapter}`] = ds(미룬 날) — **「오늘은 빼기」**(I040 · 2026-08-22).
   *  ⚠⚠ `reviewHold` 와 **시제가 다르다**: 저기는 「당분간 안 본다」(자동 만료 없음)이고 여기는
   *  「오늘만 안 본다」(자정에 스스로 풀린다). 종전엔 미루기가 하나뿐이라 **영구 포기와 하루
   *  미룸이 같은 버튼**이었고, 그래서 오늘 컨디션 때문에 미룬 챕터가 되돌리기 전까지 큐에서
   *  영영 빠졌다. 배타성은 `lib/reviewHold` 의 `reviewPause` 한 곳이 판정한다. */
  reviewSnooze: z.optional(z.record(z.string(), z.string())),
  /** 일일 배치 오버라이드(§4-1) — 키=ds(YYYY-MM-DD). manual인 날은 그날 배치의 진리=사용자.
   *  옵셔널·무마이그레이션(구버전 저장 무손상 로드). RUNTIME_CACHE_KEYS 아님 → 영속·백업·.ics 대상. */
  dayPlans: z.optional(z.record(z.string(), DayPlanSchema)),
  /** 자유 할 일(§4-4) — 과목 무관 할 일(과제·심부름). 공부 블록과 별개 독립 리스트. 신규·옵셔널·무마이그레이션. */
  tasks: z.optional(z.array(TaskSchema)),
  /** 일정(Wave 5) — 과목 무관 단발 일정(약속·시험·행사). **스케줄 입력**이다(그 시간만큼 가용시간을 깎는다)
   *  → SCHEDULE_INPUT_KEYS에 반드시 포함. 신규·옵셔널·무마이그레이션. RUNTIME_CACHE_KEYS 아님 → 영속·백업 대상. */
  events: z.optional(z.array(PlanEventSchema)),
  /** 주간 배분(§12-3) — 키=weekMon(ISO). 배분 있는 주는 스케줄러 new 블록을 이 요일 벡터로 구동(§12-4).
   *  없는 주는 자동(종전 100% 불변). 옵셔널·무마이그레이션. RUNTIME_CACHE_KEYS 아님 → 영속·백업 대상. */
  weekAlloc: z.optional(WeekAllocSchema),
  /* ── I053 「전공 밖」 레인(2026-08-22 발상 축) ────────────────────────────────────────
     weekMon(ISO) → 7요일[분]. 배분판이 **전공 밖 학습**(교양축 등)을 한 줄로 안다.

     ⚠⚠ **`weekAlloc` 안에 넣지 않은 것이 이 항목의 전부다.** 거기 합성 sid 로 두면 칸에 값을
     넣는 순간 `setAllocCell → ensureWeekAlloc` 이 **그 주 전체를 managed 로 승격**시킨다 —
     «교양 2시간을 적었다»가 그 주 배치를 자동에서 수동으로 바꾼다(2026-08-22 착수 전 확인에서
     드러난 결합). 별도 키라 그 경로를 아예 안 지난다.
     ⚠ **스케줄러가 이 값을 안 읽는다** — `SCHEDULE_INPUT_KEYS` 밖이고, 하는 일은 **분모를
     정직하게** 만드는 것뿐이다(부모 규약의 «교양축과 계약 0»을 지키는 유일한 형태 · 리포트 §7).
     ⚠ `ROW_SLICES` 에 없으므로 `settings` 한 행으로 간다 — **새 표 0 · D1 DDL 0**. */
  outsideAlloc: z.optional(z.record(z.string(), z.array(z.number()))),
  // ── 런타임 캐시(영속/내보내기에서 제외 · RUNTIME_CACHE_KEYS) + 테스트 시드 ──
  _today: z.optional(z.string()),
  /** T-8. `_today` 의 시각판 시드 — `nowHm()` 이 존중한다. 테스트·e2e 결정성 전용(런타임 캐시). */
  _nowHm: z.optional(z.string()),
  _knowState: z.optional(KnowStateSchema),
  _vaultScan: z.optional(z.unknown()),
  _ankiFile: z.optional(z.unknown()),
  _ankiLive: z.optional(z.unknown()),
  _icsExport: z.optional(z.unknown()),
  _lastBackupAt: z.optional(z.string()),
  // 축하 모먼트 중복발화 방지 마커 — 영속(RUNTIME_CACHE_KEYS 아님)이라 재로드해도 재발화 안 함.
  /* ⚠ `_lastStreakCele`(마지막으로 축하한 연속 임계)가 여기 있었다 — 축하가 은퇴했다(I054). */
  _degreeCele: z.optional(z.boolean()), // 졸업요건 100% 축하 완료 플래그
});

export type Chapter = z.infer<typeof ChapterSchema>;
export type SubjectKind = z.infer<typeof SubjectKindSchema>;
export type Item = z.infer<typeof ItemSchema>;
export type RoutineBlock = z.infer<typeof RoutineBlockSchema>;
export type CompletionEntry = z.infer<typeof CompletionEntrySchema>;
export type Summary = z.infer<typeof SummarySchema>;
export type CbmsCode = z.infer<typeof CbmsCodeSchema>;
export type Cbms = z.infer<typeof CbmsSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type JolAsk = NonNullable<z.infer<typeof AppStateSchema>['jolAsks']>[number];
/** A-2 인출 지연 한 건. */
export type Retrieval = NonNullable<z.infer<typeof AppStateSchema>['retrievals']>[number];
export type Backlog = z.infer<typeof BacklogSchema>;
export type BlankResult = z.infer<typeof BlankResultSchema>;
export type Weekly = z.infer<typeof WeeklySchema>;
export type Ritual = z.infer<typeof RitualSchema>;
export type ExamKind = z.infer<typeof ExamKindSchema>;
export type Exam = z.infer<typeof ExamSchema>;
export type Course = z.infer<typeof CourseSchema>;
/** N-19 학사일정 눈금의 종류(정정·철회·휴강·보강). 라벨은 `lib/syllabus.MARK_LABEL`. */
export type MarkKind = z.infer<typeof MarkKindSchema>;
/** N-19 학사일정 눈금 한 건. */
export type AcademicMark = z.infer<typeof AcademicMarkSchema>;
/** N-18 학기 목표가 바인딩하는 지표. 판정은 `lib/semesterGoals.ts` 하나가 소유한다. */
export type GoalMetric = z.infer<typeof GoalMetricSchema>;
/** N-18 학기 목표 한 줄. */
export type SemesterGoal = z.infer<typeof SemesterGoalSchema>;
export type Semester = z.infer<typeof SemesterSchema>;
export type Degree = z.infer<typeof DegreeSchema>;
export type PlacedBlock = z.infer<typeof PlacedBlockSchema>;
export type DayPlan = z.infer<typeof DayPlanSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type PlanEvent = z.infer<typeof PlanEventSchema>;
export type WeekAlloc = z.infer<typeof WeekAllocSchema>;
export type AppState = z.infer<typeof AppStateSchema>;
