/* ============================================================
   persistence.ts — 기본값·검증·migrate·부팅/영속·내보내기·완료추적.
   레거시 js/state.js 이식. **데이터 100% 호환**이 절대 제약:
   - KEY('study_planner_v3')·SCHEMA_VERSION(3)·필드/스키마 불변.
   - migrate/validShape 동작을 손코딩 그대로 보존(state.test.js 회귀 유지).
   브라우저 의존(theme DOM·IDB 미러·toast/confirm UI 흐름)은 제외 →
   IDB 미러는 lib/idb.ts, 테마/되돌리기 UI는 store/features가 조립한다.
   부팅/영속은 KV(localStorage 호환)를 주입받아 순수·테스트 가능하게 만든다.
============================================================ */
import { iso, nowHm, rid, todayISO } from './utils';
import { DEGREE_REQ } from './degree';
import { CbmsCodeSchema } from './schema';
import type { AppState, CompletionEntry, KV, RoutineBlock, SessionType } from './types';

export const KEY = 'study_planner_v3'; // localStorage 키 (모델 변경으로 v3)
export const SCHEMA_VERSION = 3;
export const BACKUP_KEY = KEY + '_backup'; // 초기화/가져오기 직전 백업(되돌리기용)
/* 그 백업을 **언제** 찍었나(epoch ms).
   ⚠ 백업 JSON 안에 넣지 않고 **별도 키**인 것이 요점이다 — 안에 넣으면 저장 형태가 바뀌어
   `parseState` 복원 경로를 건드리고, 그 경로는 사용자의 마지막 안전망이다. 시각은 부가정보라
   없어도 복원은 되어야 하고(옛 백업엔 실제로 없다), 그 비대칭을 키 분리가 그대로 표현한다. */
export const BACKUP_AT_KEY = BACKUP_KEY + '_at';
export const CORRUPT_KEY = KEY + '_corrupt'; // 손상 원본 보존(영구손실 방지 · P1-7)
/** 런타임 캐시 — 기기-로컬 산출물이라 *파일 내보내기(백업) JSON*에서 제외(F-01·F-10). */
export const RUNTIME_CACHE_KEYS = ['_vaultScan', '_ankiFile', '_ankiLive', '_icsExport', '_knowState'] as const;
/** 그중 *로컬 persist에서도* 제외하는 순수 휘발 캐시.
 *  나머지(_ankiLive·_knowState·_icsExport)는 reload 후 오늘 탭 KPI·캘린더 신선도 배지가 읽으므로
 *  로컬엔 남겨 즉시 부팅한다(낙관적 캐시). → 제외는 키별이 아니라 '스코프(내보내기 vs 로컬)'별.
 *
 *  ⚠⚠ **이 두 키는 오늘 쓰는 곳도 읽는 곳도 0이다 — 그런데 목록은 방치가 아니라 방어다**
 *  (2026-07-31 `/감사 근본` F1·F3). 종전 주석은 _"읽는 소비처가 없어 다음 부팅 때 재계산하면 됨"_
 *  이라 적어, 지금은 **쓰는 곳도 없다**는 사실과 **지우면 무슨 일이 나는가**를 둘 다 빠뜨렸다.
 *  그렇게 읽으면 다음 사람이 "죽은 키"로 보고 목록에서 뺀다. 실제로 빼면:
 *
 *   `AppStateSchema` 는 `z.looseObject` 이고 **런타임에서 한 번도 `.parse` 되지 않는다**
 *   (`schema.ts` 가 그렇게 적어 뒀다) → 옛 localStorage 에 남은 `_vaultScan` 이 **그대로 통과해**
 *   `stateToRows` 에 도달하고, `RUNTIME_CACHE_KEYS` 도 아니게 되는 순간 `settings` 행이 된다.
 *   `settings` 는 **`sync: true`** 다 → **로컬 볼트 파일 경로·챕터 이름이 D1 으로 나간다.**
 *   프라이버시 범위 변경이 코드 리뷰에 "미사용 키 정리"로 보이는 형태다.
 *
 *  즉 이 목록은 *현재의 기능*이 아니라 *과거 데이터*에 대한 가드다. 근거 없는 안전은 다음 사람이
 *  그 줄을 지우는 순간 무너지므로, 논거를 여기 적고 `dbRows.test.ts` 가 잠근다. */
export const EPHEMERAL_ONLY_KEYS = ['_vaultScan', '_ankiFile'];

/* ⚠⚠ **이 시드는 `defaults()` 가 아니다**(2026-08-20 리뷰 m-14).

   종전엔 `defaults()` 가 아래 40과목(F 2건 포함)을 무조건 실었다. 그러면 두 가지가 틀린다:
   ① **"전체 초기화"의 결과가 빈 상태가 아니라 옛 성적표 복원**이 된다 — 사용자가 지운 데이터가
      되살아나는 것을 초기화라고 부를 수 없다.
   ② `npm run dev`·부팅 폴백 등 기본값이 쓰이는 모든 경로가 **특정인의 성적** 위에서 돈다.
   그래서 기본값은 요건 임계만 갖고(`DEGREE_REQ`) 학기는 비운다. 데이터를 지우는 것이 아니라
   **명시적 행위로 옮긴** 것이다 — 설정 › 데이터의 "졸업 계획 시드 불러오기"(`shell/actions`)가
   유일한 호출부이고, 이미 저장된 상태는 SQLite 에 그대로 남아 아무 영향이 없다.
   ⚠ e2e 는 자기 픽스처를 쓴다(`e2e/_fixtures.ts` 의 `SEED.degree`) — 이 함수와 무관하다. */
/** 졸업 계획 시드 — 졸업요건_정리.md(전자공학과 2020 요람·ABEEK 인증과정)에서 옮긴 실제 수강 이력·요건.
 *  SD-2에서 하드코딩 참조표(degreeReq/data.ts)를 폐기하고 state.degree 구동으로 바꾸며 비었던 데이터를 복원.
 *  · 요건: 총 128 / 전공필수(인증필수) 41 · 전공선택(인증선택) 27 · 교양(학과기초31+전문교양18+대학필수2) 51.
 *  · F 과목(반도체공학1·디지털신호처리)은 '완료'로 두어 재수강 후보로 표면화(집계상 학점엔 포함 — 모델 한계).
 *  · 완료분은 성적·구분 검산 완료(GPA≈2.71로 요람 대조 일치). 남은 필수는 '예정'으로 편성. */
export function degreeSeed(): AppState['degree'] {
  type C = { id: string; name: string; credits: number; category: string; status: string; grade: string };
  const mk = (name: string, credits: number, category: string, status: string, grade: string): C => ({
    id: rid(),
    name,
    credits,
    category,
    status,
    grade,
  });
  const done = (rows: [string, number, string, string][]): C[] =>
    rows.map(([n, cr, cat, g]) => mk(n, cr, cat, '완료', g));

  const completed = done([
    // ── 전공 인증필수 ──
    ['어드벤처디자인', 3, '전공필수', 'B+'],
    ['회로이론', 3, '전공필수', 'B0'],
    ['전자기학', 3, '전공필수', 'C+'],
    ['기초전기실험', 2, '전공필수', 'C+'],
    ['논리회로', 3, '전공필수', 'C+'],
    ['전자회로1', 3, '전공필수', 'C+'],
    ['전자장론', 3, '전공필수', 'C+'],
    ['신호 및 시스템', 3, '전공필수', 'C+'],
    ['자료구조및알고리즘이해', 3, '전공필수', 'C+'],
    ['논리회로실험', 2, '전공필수', 'B+'],
    ['전자회로실험', 2, '전공필수', 'B+'],
    ['반도체공학1', 3, '전공필수', 'F'], // 재수강 필수(졸업)
    // ── 인증선택(전공선택) ──
    ['디지털신호처리', 3, '전공선택', 'F'],
    ['확률 및 랜덤변수', 3, '전공선택', 'D+'],
    ['통신의기초', 3, '전공선택', 'C0'],
    ['디지털통신', 3, '전공선택', 'C+'],
    ['인터넷프로토콜', 3, '전공선택', 'C+'],
    // ── 학과기초(수학·과학·전산) + 전문교양 + 대학필수 → 교양 ──
    ['화학실험', 1, '교양', 'A0'],
    ['아주희망', 1, '교양', 'P'],
    ['융합프로그래밍', 4, '교양', 'B+'],
    ['물리학1', 3, '교양', 'B+'],
    ['물리학실험1', 1, '교양', 'P'],
    ['수학1', 3, '교양', 'A0'],
    ['영어2', 3, '교양', 'A0'],
    ['화학', 3, '교양', 'B+'],
    ['공업수학G', 3, '교양', 'C+'],
    ['물리학실험2', 1, '교양', 'B0'],
    ['공업수학A', 3, '교양', 'B+'],
    ['물리학2', 3, '교양', 'B0'],
    ['수학2', 3, '교양', 'B+'],
    ['영어1', 3, '교양', 'B+'],
    ['대학글쓰기', 3, '교양', 'B+'],
    ['생명과학', 3, '교양', 'B0'],
    ['과학기술과 법', 3, '교양', 'C+'],
    ['서양사상과 지성사', 3, '교양', 'D0'],
    ['아주인을 위한 마중물', 1, '교양', 'P'],
    // ── 자유선택 → 기타(요건 없음) ──
    ['심리학개론', 3, '기타', 'C+'],
    ['아주강좌2', 1, '기타', 'P'],
  ]);

  const planned: C[] = [
    mk('전자회로2', 3, '전공필수', '예정', ''),
    mk('4차 산업혁명 Connecting Minds', 1, '전공필수', '예정', ''),
    mk('융합캡스톤디자인1', 2, '전공필수', '예정', ''),
    mk('융합캡스톤디자인2', 2, '전공필수', '예정', ''),
    mk('인증선택 2그룹 실험(택1)', 3, '전공선택', '예정', ''),
    mk('추가 인증선택(약 4과목)', 12, '전공선택', '예정', ''),
  ];

  return {
    // 요건 임계는 lib/degree.DEGREE_REQ가 단일 출처(볼트 졸업요건_정리.md 미러) — 여기 리터럴 재기입 금지.
    ...DEGREE_REQ,
    semesters: [
      { id: rid(), name: '이수 완료', courses: completed },
      { id: rid(), name: '남은 과목(예정)', courses: planned },
    ],
  };
}

export function defaults(): AppState {
  const t = new Date();
  const blk = (name: string, type: string, s: string, e: string, days: number[]): RoutineBlock => ({
    id: rid(),
    name,
    type,
    start: s,
    end: e,
    days,
  });
  return {
    schemaVersion: SCHEMA_VERSION,
    theme: 'dark', // 다크 기본(에디토리얼 다크 리디자인 — 단일 네온·딥블랙)
    completions: {}, // { '2026-06-23': { 'sid|type': {done:true, min:90} } }
    startDate: iso(t),
    moduleLen: 120, // 모듈(공부 슬롯) 분 — 기본 2시간
    reviewRatio: 20, // 가용시간 중 복습용 비중(%)
    routine: [
      blk('수면', '수면', '00:00', '07:00', [0, 1, 2, 3, 4, 5, 6]),
      blk('아침', '식사', '07:30', '08:00', [0, 1, 2, 3, 4, 5, 6]),
      blk('점심', '식사', '12:00', '13:00', [0, 1, 2, 3, 4, 5, 6]),
      blk('저녁', '식사', '18:00', '19:00', [0, 1, 2, 3, 4, 5, 6]),
      blk('취미/휴식', '취미', '21:30', '23:00', [0, 1, 2, 3, 4, 5, 6]),
      blk('수업', '수업', '09:00', '12:00', [1]),
      blk('수업', '수업', '13:00', '15:00', [2]),
      blk('수업', '수업', '09:00', '12:00', [3]),
      blk('수업', '수업', '13:00', '15:00', [4]),
    ],
    dayOverrides: {}, // {'2026-06-25': 1.5}
    items: [],
    /* ── 학습방법론 실행 레이어 ── */
    summaries: {},
    cbms: [],
    backlog: [],
    blankResults: [],
    retentionLog: [],
    weekly: {},
    rituals: {},
    blankReviewWeekly: true,
    mockEveryWeeks: 0,
    /* ── 적응·배치 설정 ── */
    adaptiveCapacity: true,
    peakStart: '',
    peakEnd: '',
    reviewViaAnki: false,
    /* ── I-6(W7 · 발산 6회차 · 2026-08-07) — **기본 on 으로 뒤집는다** ────────────────────
       ⚠⚠ 명시 결정을 뒤집는 것이라 근거를 여기 남긴다(절대규칙 #4 · 로드맵 W0 표에 승인 기록).
       원 결정은 *기본 off*(약점→배분 배선이 꺼진 채 출하)였고, Q-3 이 고친 것은 *"표시만 한다"*
       였다. 그런데 **켜야 작동하는 상태**로 남으면 기본값에서는 여전히 1분도 안 바뀐다 — 즉
       그 배선은 존재하되 **아무에게도 도달하지 않는** 상태였다(이 저장소가 반복해서 잡아 온
       "선언은 있는데 집행자가 없다"의 데이터 판).
       ⚠ 안전한 이유: 이 스위치가 켜도 하는 일은 **우선순위 가중**이지 계획을 지우거나 늘리는
       것이 아니다(`scheduler/priority.ts` 의 두 함수가 0 대신 값을 낸다). 그리고 근거가 없으면
       (지식상태 산출물이 없으면) 그 함수들은 여전히 0을 낸다 — 콜드 상태에서 동작이 안 바뀐다.
       ⚠ **기존 사용자는 안 건드린다**: 아래 마이그레이션은 `== null` 일 때만 채우므로, 이미
       `false` 로 저장된 상태는 그대로 꺼진 채 남는다(사용자가 끈 것을 앱이 되켜지 않는다). */
    graphPriority: true,
    /* 요건 임계만 — 학기는 비운다(근거는 `degreeSeed` 위 ⚠⚠). `DEGREE_REQ` 는 부모 `goals.json`
       에서 codegen 이 파생하므로 여기 리터럴이 아니고, `validShape` 도 `semesters` 배열만 본다. */
    degree: { ...DEGREE_REQ, semesters: [] },
    anki: { source: 'file' },
  };
}

/* ── defaults-동형(무활동) 판정(감사 재검증 ⑩#1·#2) ──
   fallback 부팅한 탭의 첫 flush가 IDB 미러를 defaults로 덮으면 그 미러는 '유효한 JSON'이라
   parse 검사를 통과한다 — 복구·백업 링이 실데이터 대신 defaults를 잡는 원인. 사용자 활동
   흔적이 전혀 없는 상태를 판정해 (a) restoreFromIDB가 세대 백업을 우선하고 (b) 백업 링에
   defaults를 밀어넣지 않게 한다. routine/설정 커스터마이즈만 있고 활동 0인 상태도 pristine으로
   보는 보수적 판정(활동 데이터 보존이 우선). */
const ACTIVITY_KEYS = [
  'completions',
  'dayOverrides',
  'items',
  'summaries',
  'cbms',
  'backlog',
  'blankResults',
  'retentionLog',
  'weekly',
  'rituals',
  'reviewTouches',
  'dayPlans', // 일일 배치 오버라이드(§4-1) — 사용자 소유 활동
  'tasks', // 자유 할 일(§4-4) — 사용자 소유 활동
  'events', // 일정(Wave 5) — 사용자 소유 활동
  'weekAlloc', // 주간 배분(§12-3) — 사용자 소유 활동
] as const;
export function isPristineState(s: AppState): boolean {
  const src = s as unknown as Record<string, unknown>;
  return ACTIVITY_KEYS.every((k) => {
    const v = src[k];
    if (v == null) return true;
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === 'object') return Object.keys(v).length === 0;
    return false;
  });
}

/** 최소 구조 검증 — 엉뚱한 JSON을 그대로 덮어써 앱이 깨지는 것 방지. */
export function validShape(s: unknown): boolean {
  if (!s || typeof s !== 'object') return false;
  const o = s as Record<string, unknown>;
  const deg = o.degree as { semesters?: unknown } | undefined;
  return (
    Array.isArray(o.items) &&
    Array.isArray(o.routine) &&
    !!deg &&
    Array.isArray(deg.semesters) &&
    typeof o.startDate === 'string'
  );
}

/* ── `migrate` 의 표 (2026-08-20 리뷰 M-14 원장 축소) ──────────────────────────
   ⚠ **동작은 한 글자도 안 바뀐다.** 종전엔 같은 모양의 `if` 가 열아홉 줄 늘어서 있었고 그게
   `migrate` 인지복잡도의 대부분이었다 — 어려운 분기가 아니라 **많은 분기**였다. 표로 옮기면
   "새 필드가 생기면 여기 한 줄"이라는 규칙이 코드 모양으로 드러나고, 분기 수는 셋이 된다.
   ⚠ `migrate` 자체는 여전히 **회귀로 동결**이다(byte-exact) — 그래서 표의 키 순서도 옛 코드
   순서 그대로 뒀다(순서 의존은 없지만, 대조를 사람이 눈으로 할 수 있어야 한다). */

/** `null`/`undefined` 면 기본값에서 채우는 키. */
const FILL_FROM_DEFAULTS = [
  'dayOverrides',
  'blankReviewWeekly',
  'mockEveryWeeks',
  'adaptiveCapacity',
  'peakStart',
  'peakEnd',
  'reviewViaAnki',
  'graphPriority',
] as const;
/** 객체가 아니면 `{}` 로 세우는 키(값의 내용은 안 본다 — 그건 `sanitizeImported` 몫). */
const ENSURE_OBJECT = ['completions', 'summaries', 'weekly', 'rituals'] as const;
/** 배열이 아니면 `[]` 로 세우는 키. */
const ENSURE_ARRAY = ['cbms', 'backlog', 'blankResults', 'retentionLog'] as const;

function fillDefaults(s: Record<string, unknown>, d: AppState): void {
  const dd = d as unknown as Record<string, unknown>;
  // 테마는 **정규화**라 표와 다르다: 폐기된 값(세피아 등)도 다크로 되돌린다.
  if (s.theme !== 'light' && s.theme !== 'dark') s.theme = d.theme;
  for (const k of FILL_FROM_DEFAULTS) if (s[k] == null) s[k] = dd[k];
  for (const k of ENSURE_OBJECT) if (s[k] == null || typeof s[k] !== 'object') s[k] = {};
  for (const k of ENSURE_ARRAY) if (!Array.isArray(s[k])) s[k] = [];
}

/** 졸업 계획 백필 — '손대지 않은 기본값'(과목 0 + 요건 3값 모두 0 = 옛 defaults)일 때만 1회.
 *  과목을 하나라도 편성했거나 요건을 설정한 사용자는 절대 건드리지 않는다(빈 상태 존중).
 *  ⚠ m-14 이후 `d.degree` 는 **요건 임계 + 빈 학기**다(옛 성적표 시드가 아니다). */
function backfillDegree(s: Record<string, unknown>, d: AppState): void {
  const dg = s.degree as
    | { reqMajorReq?: number; reqMajorSel?: number; reqLiberal?: number; semesters?: { courses?: unknown[] }[] }
    | undefined;
  if (!dg) return;
  const hasCourses =
    Array.isArray(dg.semesters) && dg.semesters.some((se) => Array.isArray(se.courses) && se.courses.length > 0);
  const untouchedReqs = !dg.reqMajorReq && !dg.reqMajorSel && !dg.reqLiberal;
  if (!hasCourses && untouchedReqs) s.degree = d.degree;
}

/** 불러온 데이터에 새 필드 채우기(구버전 호환). 무효 입력은 null. 동작은 레거시와 동일. */
export function migrate(input: unknown): AppState | null {
  if (!input || typeof input !== 'object') return null;
  if (!validShape(input)) return null;
  const s = input as Record<string, unknown>;
  const d = defaults();
  s.schemaVersion = SCHEMA_VERSION;
  fillDefaults(s, d);
  backfillDegree(s, d);
  /* _today·_nowHm 은 테스트 시드 — 평소 데이터엔 없어야 한다(가져온 파일에 묻어오면 제거).
     ⚠ `_nowHm`(T-8)도 같은 규약이다. 빠뜨리면 시드가 실데이터에 눌러앉아 모든 완료 시각이
     고정값으로 기록된다 — 그러면 T-8 이 쌓으려는 표본이 통째로 거짓이 된다. */
  if (s._today != null) delete s._today;
  if (s._nowHm != null) delete s._nowHm;
  /* '공부' 블록 개념 폐지: 잔존 공부 블록 제거(그 시간은 자동으로 빈 시간=공부 가능). */
  if (Array.isArray(s.routine)) s.routine = (s.routine as RoutineBlock[]).filter((b) => b && b.type !== '공부');
  return s as unknown as AppState;
}

/** 가져오기(신뢰 불가 파일) 전용 방어선 — migrate가 구조를 갖춘 뒤, 다운스트림 feature를 깨뜨릴 수 있는
    *크래시 유발 필드*만 레코드 단위로 검증해 제거한다. migrate는 회귀로 동결(byte-exact)이고 boot(로컬 데이터)는
    신뢰하므로, 이 함수는 오직 importJSON 경로에서만 호출한다.
    ⚠ 전체 zod 스키마 필터를 쓰지 않는 이유: schema.ts의 element 스키마는 '타입 출처'로만 유지돼 실제 영속
    데이터와 정밀히 대조된 적이 없다(schema.ts:114 주석) — 필터로 쓰면 정상 레코드를 오폭 삭제할 위험이 있다.
    그래서 실제로 소비처를 깨는 필드(cbms.code 열거·completions.min 수치·dayOverrides 타입)만 좁게 검사한다. */
/* ── `sanitizeImported` 의 필드별 방어선 (2026-08-20 리뷰 M-14 원장 축소) ────────────
   ⚠ **동작은 안 바뀐다.** 종전엔 일곱 축(cbms·completions·events·tasks·items·routine·dayOverrides)이
   한 함수 안에 순서대로 있었고, 각각이 다시 조건 서넛을 품어 인지복잡도의 전부를 만들었다.
   축끼리는 서로를 모른다 — 각자 *한 슬라이스가 어떻게 소비처를 깨뜨리는가* 만 안다.
   ⚠ 처방이 축마다 다르다는 것이 이 절의 요점이다: **레코드째 거를지, 필드만 뗄지**가 다르고
   그 근거가 각 함수 주석에 있다. 한 함수에 뭉쳐 있으면 그 차이가 안 보인다. */

/** cbms — 코드 열거 이탈은 롤업 집계를 깬다.
 *  ⚠⚠ **열거를 손으로 다시 적지 않는다 — 정본은 `schema.ts` 의 `CbmsCodeSchema` 다.**
 *  종전엔 여기 생 리터럴 `['C','B','M','S','T']` 가 있었고, 그건 그 열거의 **네 번째 사본**
 *  이었다(스키마 · `CBMS_INFO` · `CBMS_CODES` · 여기). 그리고 `methodology.ts` 의 `CBMS_CODES`
 *  주석은 바로 그 드리프트를 *"봉쇄했다"* 고 선언하고 있었다 — 사실이 아니었다.
 *  이 자리가 특히 나쁜 이유: 여기는 **가져오기(백업 복원) 경로의 필터**다. 여섯 번째 코드가
 *  생기면 `CBMS_INFO` 는 `Record<CbmsCode,…>` 라 TS 가 키 추가를 강제하지만 이 `Set` 은
 *  아무 신호도 안 내고, 그 코드가 붙은 오답 레코드가 **복원에서 통째로 삭제된다.**
 *  (`uiState.ts` 의 `AccentSchema.options` 가 같은 관용구 — 순환 없음: persistence → schema.) */
function sanitizeCbms(s: Record<string, unknown>): void {
  if (!Array.isArray(s.cbms)) return;
  const codes = new Set<string>(CbmsCodeSchema.options);
  s.cbms = (s.cbms as Record<string, unknown>[]).filter(
    (c) => !!c && typeof c === 'object' && codes.has(c.code as string),
  );
}

/** completions: sid → ds → {done, min}. `min` 은 학습분 합산의 입력 — 비수치면 NaN 전파. */
function sanitizeCompletions(s: Record<string, unknown>): void {
  if (!s.completions || typeof s.completions !== 'object') return;
  for (const days of Object.values(s.completions as Record<string, Record<string, unknown>>)) {
    if (!days || typeof days !== 'object') continue;
    for (const [ds, e] of Object.entries(days)) {
      const ent = e as { min?: unknown } | null;
      if (!ent || typeof ent !== 'object' || typeof ent.min !== 'number' || !Number.isFinite(ent.min)) delete days[ds];
    }
  }
}

/** events(Wave 5): 일정은 **스케줄 입력**(가용시간 차감)이라 비수치 start/min 이 NaN 구간을 만들어
 *  그날 studyMin 전체를 오염시킨다. ds(문자열)·start/min(유한수)만 통과시킨다. */
function sanitizeEvents(s: Record<string, unknown>): void {
  if (!Array.isArray(s.events)) return;
  s.events = (s.events as Record<string, unknown>[]).filter(
    (e) =>
      !!e &&
      typeof e === 'object' &&
      typeof e.ds === 'string' &&
      Number.isFinite(e.start as number) &&
      Number.isFinite(e.min as number),
  );
}

/** tasks(§4-4): events 와 같은 위험인데 방어가 빠져 있었다(2026-07-19 감사 ⑤ — ACTIVITY_KEYS·
 *  TaskSchema 에는 들어갔는데 여기만 누락). start/min 이 문자열이면 캘린더 배치 산술이 NaN 이 된다.
 *  ⚠ events 와 달리 **레코드를 지우지 않는다** — start/min 이 옵셔널이라 그 필드만 떼면 할 일이
 *  '미지정 트레이 항목'으로 살아남는다. 사용자 저작물이라 최소 파괴가 옳다(events 는 시각이 필수라
 *  시각 없는 일정이 성립하지 않아 레코드째 걸렀다). */
function sanitizeTasks(s: Record<string, unknown>): void {
  if (!Array.isArray(s.tasks)) return;
  s.tasks = (s.tasks as unknown[]).filter((t) => !!t && typeof t === 'object');
  for (const t of s.tasks as Record<string, unknown>[]) {
    if (t.start !== undefined && !Number.isFinite(t.start as number)) delete t.start;
    if (t.min !== undefined && !Number.isFinite(t.min as number)) delete t.min;
  }
}

/** items·routine — 둘 다 **부팅·스케줄 경로에서 throw** 하는 부류다(렌더 밖이라 폴백도 못 잡는다).
 *  items: 비객체 원소는 `refineItemColors` 에서 throw 해 앱을 영구 백지로 만든다.
 *  routine: `days` 가 배열이 아니면 `blocksForWeekday` 의 `.includes` 에서, `start/end` 가
 *  문자열이 아니면 `toMin` 의 `.split` 에서 TypeError → `schedule()` 전체가 throw 하고
 *  스케줄을 읽는 모든 탭이 폴백으로 떨어진다. */
function sanitizeSchedInputs(s: Record<string, unknown>): void {
  if (Array.isArray(s.items)) s.items = (s.items as unknown[]).filter((it) => !!it && typeof it === 'object');
  if (Array.isArray(s.routine))
    s.routine = (s.routine as Record<string, unknown>[]).filter(
      (b) =>
        !!b &&
        typeof b === 'object' &&
        Array.isArray(b.days) &&
        typeof b.start === 'string' &&
        typeof b.end === 'string',
    );
}

/** dayOverrides: ds → 분(number) | 프리셋(string). 그 외 타입은 가용시간 계산을 깬다. */
function sanitizeOverrides(s: Record<string, unknown>): void {
  if (!s.dayOverrides || typeof s.dayOverrides !== 'object') return;
  const ov = s.dayOverrides as Record<string, unknown>;
  for (const [ds, v] of Object.entries(ov)) if (typeof v !== 'number' && typeof v !== 'string') delete ov[ds];
}

export function sanitizeImported(state: AppState): AppState {
  const s = state as unknown as Record<string, unknown>;
  sanitizeCbms(s);
  sanitizeCompletions(s);
  sanitizeEvents(s);
  sanitizeTasks(s);
  sanitizeSchedInputs(s);
  sanitizeOverrides(s);
  return state;
}

/** 내보내기 스냅샷 — 런타임 스캔 캐시 제외(파일 백업은 가볍게·깨끗하게). */
export function exportSnapshot(state: AppState): Partial<AppState> {
  const src = state as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k in src) if (!(RUNTIME_CACHE_KEYS as readonly string[]).includes(k)) out[k] = src[k];
  return out as Partial<AppState>;
}

export function serialize(state: AppState): string {
  // 로컬 저장: 순수 휘발 캐시(EPHEMERAL_ONLY_KEYS)만 떼고 나머지는 유지.
  // _ankiLive·_knowState·_icsExport는 reload 후 오늘 탭·캘린더 배지가 읽으므로 로컬엔 남긴다(즉시 부팅).
  // 파일 내보내기(exportSnapshot)는 별도로 모든 런타임 캐시를 제외(이식성).
  const src = state as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k in src) if (!EPHEMERAL_ONLY_KEYS.includes(k)) out[k] = src[k];
  return JSON.stringify(out);
}

/* 부팅이 기본값으로 떨어진 사유 마커 — 'missing'(저장본 없음: 첫 방문 또는 localStorage 전소),
   'corrupt'(저장본은 있는데 못 살림). App 마운트 후 복구 안내(BootRecovery)가 1회 소비한다.
   정상 부팅·의도적 초기화(초기화는 유효한 기본값을 즉시 persist → 다음 부팅 정상)에선 null. */
export type BootFallback = 'missing' | 'corrupt';
let _bootFallback: BootFallback | null = null;
/** 마커를 읽고 즉시 지운다(1회 소비) — StrictMode 이중 이펙트에도 안내가 한 번만 뜨게. */
export function consumeBootFallback(): BootFallback | null {
  const v = _bootFallback;
  _bootFallback = null;
  return v;
}

/** 직렬화 문자열을 파싱→마이그레이션. 손상/형식불일치면 null(throw 안 함).
   `migrate(JSON.parse(raw))`+try/catch 관용구가 boot·undoLast·restoreFromIDB·BootRecovery에
   복제돼 있던 것을 단일 가드로 수렴 — migrate SSOT를 소유한 이 모듈이 파싱 가드도 소유. */
export function parseState(raw: string): AppState | null {
  try {
    return migrate(JSON.parse(raw));
  } catch {
    return null;
  }
}

/* 부팅 — 저장된 상태를 살리되, 손상/형식불일치면 *원본 raw를 CORRUPT_KEY에 보존*한 뒤
   기본값으로 시작(첫 persist가 복구가능한 원본을 덮어 영구손실하는 것 방지 · P1-7). */
export function boot(storage: KV): AppState {
  _bootFallback = null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(KEY);
  } catch {
    /* ignore */
  }
  const s: AppState | null = raw == null ? null : parseState(raw);
  if (!s && raw) {
    // 원본은 있는데 못 살림 = 손상/형식불일치
    try {
      if (storage.getItem(CORRUPT_KEY) == null) storage.setItem(CORRUPT_KEY, raw);
    } catch {
      /* ignore */
    }
  }
  if (!s) _bootFallback = raw == null ? 'missing' : 'corrupt';
  return s || defaults();
}

/** localStorage(동기 1차 저장)에 KEY를 기록하고 직렬화 문자열을 반환(호출부가 IDB 미러에 전달). */
export function persist(storage: KV, state: AppState): string {
  const json = serialize(state);
  storage.setItem(KEY, json);
  return json;
}

/* ── 실행 추적: 그 날 그 과목의 학습/복습/Anki를 '완료'로 기록 ── */
export function compMap(state: AppState, ds: string): Record<string, CompletionEntry> {
  state.completions = state.completions || {};
  return (state.completions[ds] = state.completions[ds] || {});
}
export function isDone(state: AppState, ds: string, sid: string, type: SessionType): boolean {
  const m = state.completions && state.completions[ds];
  const e = m && m[sid + '|' + type];
  return !!(e && e.done);
}
/** 완료 토글(스토어 액션이 호출 후 persist). on=false면 기록 제거. */
/** 회고가 읽어야 하는 '집중한 분'(G-1) — **실측이 있으면 실측, 없으면 계획**.
 *
 *  왜 함수인가: `min` 을 그대로 읽던 곳이 넷(`records.bestFocusMin`·`seasonPace`·
 *  `insights.dayShape`·`scheduler.adherenceFactor`)이었고, 그중 하나는 그 값으로 **미래 계획
 *  용량을 깎는다**. 폴백 규칙을 네 곳에 복제하면 언젠가 한 곳만 남아 "회고는 실측인데 계획은
 *  체크박스"가 된다 — 그 어긋남은 화면 어디에도 안 보인다. 규칙은 여기 한 줄이다. */
export function completionMin(e: { min?: number; actualMin?: number } | undefined): number {
  if (!e) return 0;
  return typeof e.actualMin === 'number' && e.actualMin > 0 ? e.actualMin : +(e.min || 0);
}

/**
 * **Q-1 진도 커밋** — 챕터의 `done` 을 이름으로 확정한다.
 *
 * ## 왜 이 함수가 없었나 (그리고 그게 왜 문제였나)
 * `setDone`(블록 완료)은 `completions[ds]["sid|type"]` 만 쓰고 **챕터를 안 건드린다** — 아래
 * 그 함수의 코드가 스스로 자인한다. 그런데 스케줄러의 계획은 **전적으로 `c.done`** 에서 나온다
 * (`engine.ts` 의 `!c.done && !c.deferred` 필터). 즉 **계획의 유일한 진짜 입력이, 앱에서 가장
 * 비싼 편집이었다**: 씨앗이 51챕터를 넣은 뒤 30번째 챕터를 체크하려면 챕터 표까지 가서
 * `<details>` 를 펼치고(기본 접힘) Tab 약 150회를 눌러야 했다. 발산 7각도 중 셋이 독립적으로
 * 이 지점에 도착했다.
 *
 * ## ⚠ 이름으로 찾는다 — 그게 블록이 가진 전부다
 * `ScheduleItem.chapters` 는 **이름 배열**이다(id 가 아니다). 엔진이 `advance()` 에서 챕터
 * *이름*을 담기 때문이고, 그 계약을 여기서 바꾸면 블록·복습·볼트 앵커가 전부 따라 움직인다.
 * 그래서 이 함수만 이름으로 찾는다. 동명 챕터가 있으면 **첫 번째**가 이긴다 — 표시상 구분이
 * 안 되는 두 행 중 하나를 고르는 것은 어차피 임의이고, 사용자는 챕터 표에서 고칠 수 있다.
 * ⚠ `doneDs` 를 함께 쓴다 — 복습 사다리가 계획일이 아니라 이 날을 앵커한다(②#23).
 */
export function setChapterDone(state: AppState, sid: string, chapterName: string, on: boolean, ds: string): void {
  const it = (state.items || []).find((x) => x.id === sid);
  const ch = (it?.chapters || []).find((c) => c.name === chapterName);
  if (!ch) return;
  ch.done = on;
  if (on) ch.doneDs = ds;
  else delete ch.doneDs;
}

export function setDone(
  state: AppState,
  ds: string,
  sid: string,
  type: SessionType,
  plannedMin: number,
  on: boolean,
  actualMin?: number,
): void {
  const m = compMap(state, ds);
  const k = sid + '|' + type;
  // doneDs = 실제 완료일(②#23 · todayISO는 _today 시드 존중) — 복습 사다리가 계획일이 아니라
  // 이 날을 앵커한다(늦게 완료해도 복습이 앞당겨진 채 고정되지 않게 · 망각곡선 정합).
  if (on)
    m[k] = {
      done: true,
      min: Math.round(plannedMin),
      doneDs: todayISO(state),
      // T-8 시각 원장 — **완료를 누른 하루 중 시각**. 지금은 어느 화면도 안 그린다(로드맵 T-8 의
      // 가장 싼 검증이 "한 필드만 추가하고 2주 방치"다). 이 한 줄이 없어서 T-5·T-8·T-10 이 전부
      // "표본 대기"로 멈춰 있었다 — 관측을 기다리면서 관측 장치를 안 달고 있었다.
      doneAt: nowHm(state),
      // 실측은 **있을 때만** 싣는다 — 0/undefined 를 넣으면 "쟀는데 0분"과 "안 쟀다"가 섞인다.
      ...(actualMin && actualMin > 0 ? { actualMin: Math.round(actualMin) } : {}),
    };
  else delete m[k];
  if (!Object.keys(m).length) delete state.completions[ds];
}
/** ReviewRun 챕터 인출 기록 — 위험모델(spacedReview)의 lastDs를 계획 밖 복습에서도 갱신(감사 #22).
 *  완료(completions)는 `sid|type` 키라 챕터 무구분 — 밀린 챕터를 복습해도 '망각곡선 리셋'이
 *  모델에 반영되지 않던 루프를 챕터 단위 터치 로그로 닫는다. 최신 ds만 유지(단조 증가).
 *
 *  ⚠ **E1(2026-07-29) 이전까지 이 함수의 쓰기 호출부는 `app/FocusChip.tsx` 하나였다.** 그 경로는
 *  조건이 셋이다(집중 세션 완주 + 토스트 수명 안에 '블록 완료로 표시' 클릭 + `chapter` 존재).
 *  그래서 러너에서 챕터를 아무리 인출해도 앵커가 안 생겼고, `reviewQueue.ts` 의 `MAINTENANCE_CAP`
 *  주석이 유지 큐의 존립 근거로 든 _"볼 때마다 진짜 앵커가 하나씩 생겨 큐가 스스로 수렴한다"_ 가
 *  **작동한 적이 없다**(끝낸 챕터는 앵커가 없어 영구히 `due`). 러너가 이제 직접 부른다. */
export function touchReview(state: AppState, sid: string, chapter: string, ds: string): void {
  const m = (state.reviewTouches = state.reviewTouches || {});
  const k = sid + '|' + chapter;
  const cur = m[k];
  if (!cur || ds > cur) m[k] = ds;
}
/** 터치 로그 조회(되돌리기용 이전 값 확보) — 없으면 undefined. */
export function reviewTouchOf(state: AppState, sid: string, chapter: string): string | undefined {
  return (state.reviewTouches || {})[sid + '|' + chapter];
}
/** 되돌리기 전용 — 터치를 **이전 값으로 되돌린다**(원래 없었으면 지운다).
 *
 *  `touchReview` 는 단조 증가라 되감기가 원리적으로 불가능하다. 러너의 `U`(되돌리기)는 세션
 *  상태를 전량 스냅샷으로 되돌리는데, 앵커만 앞으로 간 채 남으면 **화면은 물렸다고 하고 모델은
 *  인출했다고 하는** 상태가 된다 — 그리고 그 어긋남은 조용하다(D-3 이 되돌리기를 키보드 계약의
 *  짝으로 둔 이유가 정확히 "키가 빨라지면 오타도 빨라진다"였다). */
export function restoreReviewTouch(state: AppState, sid: string, chapter: string, prev: string | undefined): void {
  const m = (state.reviewTouches = state.reviewTouches || {});
  const k = sid + '|' + chapter;
  if (prev === undefined) delete m[k];
  else m[k] = prev;
}

/** 총 완료 학습시간(시간). */
export function totalDoneHours(state: AppState): number {
  let mins = 0;
  const c = state.completions || {};
  for (const ds in c) {
    const m = c[ds]!;
    for (const k in m) mins += +m[k]!.min || 0;
  }
  return mins / 60;
}
/* ⚠⚠ **`studyStreak`(연속 학습일)이 여기 있었다 — 소비처 둘이 함께 은퇴했다**(I046 통계 탭 ·
   I054 오늘 탭 · 2026-08-22 발상 축). 근거: 그 수의 입력(`completions`)이 실물에서 **0행**이라
   화면에서 항상 0이었고, 0을 크게 그리는 것은 조망이 아니다. 스트릭 자체가 나쁘다는 판정이
   아니라 **이 앱에서 그 수가 관측된 적이 없다**는 판정이다 — 입력 파이프(묶음 A)가 채워지면
   다시 열 수 있고, 그때는 `git show <이 커밋의 부모>:web/src/lib/persistence.ts`. */
