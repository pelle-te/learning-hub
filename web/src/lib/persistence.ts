/* ============================================================
   persistence.ts — 기본값·검증·migrate·부팅/영속·내보내기·완료추적.
   레거시 js/state.js 이식. **데이터 100% 호환**이 절대 제약:
   - KEY('study_planner_v3')·SCHEMA_VERSION(3)·필드/스키마 불변.
   - migrate/validShape 동작을 손코딩 그대로 보존(state.test.js 회귀 유지).
   브라우저 의존(theme DOM·IDB 미러·toast/confirm UI 흐름)은 제외 →
   IDB 미러는 lib/idb.ts, 테마/되돌리기 UI는 store/features가 조립한다.
   부팅/영속은 KV(localStorage 호환)를 주입받아 순수·테스트 가능하게 만든다.
============================================================ */
import { addDays, iso, parseISO, rid, todayISO } from './utils';
import { DEGREE_REQ } from './degree';
import type { AppState, CompletionEntry, KV, RoutineBlock, SessionType } from './types';

export const KEY = 'study_planner_v3'; // localStorage 키 (모델 변경으로 v3)
export const SCHEMA_VERSION = 3;
export const BACKUP_KEY = KEY + '_backup'; // 초기화/가져오기 직전 백업(되돌리기용)
export const CORRUPT_KEY = KEY + '_corrupt'; // 손상 원본 보존(영구손실 방지 · P1-7)
/** 런타임 캐시 — 기기-로컬 산출물이라 *파일 내보내기(백업) JSON*에서 제외(F-01·F-10). */
export const RUNTIME_CACHE_KEYS = ['_vaultScan', '_ankiFile', '_ankiLive', '_icsExport', '_knowState'] as const;
/** 그중 *로컬 persist에서도* 제외하는 순수 휘발 캐시 — 읽는 소비처가 없어 다음 부팅 때 재계산하면 됨.
 *  나머지(_ankiLive·_knowState·_icsExport)는 reload 후 오늘 탭 KPI·캘린더 신선도 배지가 읽으므로
 *  로컬엔 남겨 즉시 부팅한다(낙관적 캐시). → 제외는 키별이 아니라 '스코프(내보내기 vs 로컬)'별. */
export const EPHEMERAL_ONLY_KEYS = ['_vaultScan', '_ankiFile'];

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
    graphPriority: false,
    degree: degreeSeed(),
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

/** 불러온 데이터에 새 필드 채우기(구버전 호환). 무효 입력은 null. 동작은 레거시와 동일. */
export function migrate(input: unknown): AppState | null {
  if (!input || typeof input !== 'object') return null;
  if (!validShape(input)) return null;
  const s = input as Record<string, unknown>;
  const d = defaults();
  s.schemaVersion = SCHEMA_VERSION;
  if (s.theme == null) s.theme = d.theme;
  if (s.theme !== 'light' && s.theme !== 'dark') s.theme = d.theme; // 폐기된 세피아 등 → 다크로 정규화
  if (s.completions == null || typeof s.completions !== 'object') s.completions = {};
  if (s.dayOverrides == null) s.dayOverrides = {};
  /* 학습방법론 실행 레이어 보강 */
  if (s.summaries == null || typeof s.summaries !== 'object') s.summaries = {};
  if (!Array.isArray(s.cbms)) s.cbms = [];
  if (!Array.isArray(s.backlog)) s.backlog = [];
  if (!Array.isArray(s.blankResults)) s.blankResults = [];
  if (!Array.isArray(s.retentionLog)) s.retentionLog = [];
  if (s.weekly == null || typeof s.weekly !== 'object') s.weekly = {};
  if (s.rituals == null || typeof s.rituals !== 'object') s.rituals = {};
  if (s.blankReviewWeekly == null) s.blankReviewWeekly = d.blankReviewWeekly;
  if (s.mockEveryWeeks == null) s.mockEveryWeeks = d.mockEveryWeeks;
  /* 적응·배치 설정 보강 */
  if (s.adaptiveCapacity == null) s.adaptiveCapacity = d.adaptiveCapacity;
  if (s.peakStart == null) s.peakStart = d.peakStart;
  if (s.peakEnd == null) s.peakEnd = d.peakEnd;
  if (s.reviewViaAnki == null) s.reviewViaAnki = d.reviewViaAnki;
  if (s.graphPriority == null) s.graphPriority = d.graphPriority;
  /* 졸업 계획 시드 백필 — SD-2에서 state.degree 구동으로 바뀌며 비어 있던 기존 데이터를 복원.
     '손대지 않은 기본값'(과목 0 + 요건 3값 모두 0=옛 defaults)일 때만 1회 채운다.
     과목을 하나라도 편성했거나 요건을 설정한 사용자는 절대 건드리지 않는다(빈 상태 존중). */
  const dg = s.degree as
    | { reqMajorReq?: number; reqMajorSel?: number; reqLiberal?: number; semesters?: { courses?: unknown[] }[] }
    | undefined;
  const hasCourses =
    !!dg &&
    Array.isArray(dg.semesters) &&
    dg.semesters.some((se) => Array.isArray(se.courses) && se.courses.length > 0);
  const untouchedReqs = !!dg && !dg.reqMajorReq && !dg.reqMajorSel && !dg.reqLiberal;
  if (!hasCourses && untouchedReqs) s.degree = d.degree;
  /* _today는 테스트 시드 — 평소 데이터엔 없어야 한다(가져온 파일에 묻어오면 제거). */
  if (s._today != null) delete s._today;
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
export function sanitizeImported(state: AppState): AppState {
  const s = state as unknown as Record<string, unknown>;
  const CBMS = new Set(['C', 'B', 'M', 'S', 'T']); // CBMS_CODES 롤업이 이 열거를 가정 — 이탈 code는 집계를 깬다.
  if (Array.isArray(s.cbms))
    s.cbms = (s.cbms as Record<string, unknown>[]).filter(
      (c) => !!c && typeof c === 'object' && CBMS.has(c.code as string),
    );
  // completions: sid → ds → {done, min}. min은 학습분 합산의 입력 — 비수치면 NaN 전파.
  if (s.completions && typeof s.completions === 'object') {
    for (const days of Object.values(s.completions as Record<string, Record<string, unknown>>)) {
      if (!days || typeof days !== 'object') continue;
      for (const [ds, e] of Object.entries(days)) {
        const ent = e as { min?: unknown } | null;
        if (!ent || typeof ent !== 'object' || typeof ent.min !== 'number' || !Number.isFinite(ent.min))
          delete days[ds];
      }
    }
  }
  // events(Wave 5): 일정은 **스케줄 입력**(가용시간 차감)이라 비수치 start/min이 NaN 구간을 만들어
  // 그날 studyMin 전체를 오염시킨다. ds(문자열)·start/min(유한수)만 통과시킨다.
  if (Array.isArray(s.events))
    s.events = (s.events as Record<string, unknown>[]).filter(
      (e) =>
        !!e &&
        typeof e === 'object' &&
        typeof e.ds === 'string' &&
        Number.isFinite(e.start as number) &&
        Number.isFinite(e.min as number),
    );
  // tasks(§4-4): events 와 같은 위험인데 방어가 빠져 있었다(2026-07-19 감사 ⑤ — ACTIVITY_KEYS·
  // TaskSchema 에는 들어갔는데 여기만 누락). start/min 이 문자열이면 캘린더 배치 산술이 NaN 이 된다.
  // ⚠ events 와 달리 **레코드를 지우지 않는다** — start/min 이 옵셔널이라 그 필드만 떼면 할 일이
  //   '미지정 트레이 항목'으로 살아남는다. 사용자 저작물이라 최소 파괴가 옳다(events 는 시각이 필수라
  //   시각 없는 일정이 성립하지 않아 레코드째 걸렀다).
  if (Array.isArray(s.tasks)) {
    s.tasks = (s.tasks as unknown[]).filter((t) => !!t && typeof t === 'object');
    for (const t of s.tasks as Record<string, unknown>[]) {
      if (t.start !== undefined && !Number.isFinite(t.start as number)) delete t.start;
      if (t.min !== undefined && !Number.isFinite(t.min as number)) delete t.min;
    }
  }
  // items: 비객체 원소는 refineItemColors(부팅 경로·렌더 밖)에서 throw해 앱을 영구 백지로 만든다.
  // 여기서 걸러야 손상 백업이 localStorage에 영속되는 것 자체를 막는다.
  if (Array.isArray(s.items)) s.items = (s.items as unknown[]).filter((it) => !!it && typeof it === 'object');
  // routine: 요일 블록은 **스케줄 입력**이다. days가 배열이 아니면 blocksForWeekday의 .includes에서,
  // start/end가 문자열이 아니면 toMin의 .split에서 TypeError → schedule() 전체가 throw하고
  // 스케줄을 읽는 모든 탭이 폴백으로 떨어진다.
  if (Array.isArray(s.routine))
    s.routine = (s.routine as Record<string, unknown>[]).filter(
      (b) =>
        !!b &&
        typeof b === 'object' &&
        Array.isArray(b.days) &&
        typeof b.start === 'string' &&
        typeof b.end === 'string',
    );
  // dayOverrides: ds → 분(number) | 프리셋(string). 그 외 타입은 가용시간 계산을 깬다.
  if (s.dayOverrides && typeof s.dayOverrides === 'object') {
    const ov = s.dayOverrides as Record<string, unknown>;
    for (const [ds, v] of Object.entries(ov)) if (typeof v !== 'number' && typeof v !== 'string') delete ov[ds];
  }
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
export function setDone(
  state: AppState,
  ds: string,
  sid: string,
  type: SessionType,
  plannedMin: number,
  on: boolean,
): void {
  const m = compMap(state, ds);
  const k = sid + '|' + type;
  // doneDs = 실제 완료일(②#23 · todayISO는 _today 시드 존중) — 복습 사다리가 계획일이 아니라
  // 이 날을 앵커한다(늦게 완료해도 복습이 앞당겨진 채 고정되지 않게 · 망각곡선 정합).
  if (on) m[k] = { done: true, min: Math.round(plannedMin), doneDs: todayISO(state) };
  else delete m[k];
  if (!Object.keys(m).length) delete state.completions[ds];
}
/** ReviewRun 챕터 인출 기록 — 위험모델(spacedReview)의 lastDs를 계획 밖 복습에서도 갱신(감사 #22).
 *  완료(completions)는 `sid|type` 키라 챕터 무구분 — 밀린 챕터를 복습해도 '망각곡선 리셋'이
 *  모델에 반영되지 않던 루프를 챕터 단위 터치 로그로 닫는다. 최신 ds만 유지(단조 증가). */
export function touchReview(state: AppState, sid: string, chapter: string, ds: string): void {
  const m = (state.reviewTouches = state.reviewTouches || {});
  const k = sid + '|' + chapter;
  const cur = m[k];
  if (!cur || ds > cur) m[k] = ds;
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
/** 연속 학습일(스트릭): 오늘(또는 어제)부터 거꾸로 완료기록 연속 카운트. */
export function studyStreak(state: AppState): number {
  const c = state.completions || {};
  const has = (ds: string) => c[ds] && Object.keys(c[ds]).length;
  let cur = parseISO(todayISO(state)); // 앱의 '오늘' 단일 출처(_today 시드 존중) — new Date() 직접 사용 제거.
  if (!has(iso(cur))) {
    cur = addDays(cur, -1);
    if (!has(iso(cur))) return 0;
  }
  let n = 0;
  while (has(iso(cur))) {
    n++;
    cur = addDays(cur, -1);
  }
  return n;
}
