/* ============================================================
   persistence.ts — 기본값·검증·migrate·부팅/영속·내보내기·완료추적.
   레거시 js/state.js 이식. **데이터 100% 호환**이 절대 제약:
   - KEY('study_planner_v3')·SCHEMA_VERSION(3)·필드/스키마 불변.
   - migrate/validShape 동작을 손코딩 그대로 보존(state.test.js 회귀 유지).
   브라우저 의존(theme DOM·IDB 미러·toast/confirm UI 흐름)은 제외 →
   IDB 미러는 lib/idb.ts, 테마/되돌리기 UI는 store/features가 조립한다.
   부팅/영속은 KV(localStorage 호환)를 주입받아 순수·테스트 가능하게 만든다.
============================================================ */
import { addDays, iso, rid } from './utils';
import type { AppState, CompletionEntry, KV, RoutineBlock, SessionType } from './types';

export const KEY = 'study_planner_v3'; // localStorage 키 (모델 변경으로 v3)
export const SCHEMA_VERSION = 3;
export const BACKUP_KEY = KEY + '_backup'; // 초기화/가져오기 직전 백업(되돌리기용)
export const CORRUPT_KEY = KEY + '_corrupt'; // 손상 원본 보존(영구손실 방지 · P1-7)
/** 런타임 캐시 — 기기-로컬 산출물이라 *파일 내보내기(백업) JSON*에서 제외(F-01·F-10). */
export const RUNTIME_CACHE_KEYS = ['_vaultScan', '_ankiFile', '_ankiLive', '_icsExport', '_knowState'];
/** 그중 *로컬 persist에서도* 제외하는 순수 휘발 캐시 — 읽는 소비처가 없어 다음 부팅 때 재계산하면 됨.
 *  나머지(_ankiLive·_knowState·_icsExport)는 reload 후 오늘 탭 KPI·캘린더 신선도 배지가 읽으므로
 *  로컬엔 남겨 즉시 부팅한다(낙관적 캐시). → 제외는 키별이 아니라 '스코프(내보내기 vs 로컬)'별. */
export const EPHEMERAL_ONLY_KEYS = ['_vaultScan', '_ankiFile'];

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
    theme: 'light', // 라이트 기본(긴 글 가독성·브랜드 인디고)
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
    degree: {
      targetTotal: 130,
      reqMajorReq: 0,
      reqMajorSel: 0,
      reqLiberal: 0,
      semesters: [{ id: rid(), name: '2026-1학기', courses: [] }],
    },
    anki: { source: 'file' },
  };
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
  /* _today는 테스트 시드 — 평소 데이터엔 없어야 한다(가져온 파일에 묻어오면 제거). */
  if (s._today != null) delete s._today;
  /* '공부' 블록 개념 폐지: 잔존 공부 블록 제거(그 시간은 자동으로 빈 시간=공부 가능). */
  if (Array.isArray(s.routine)) s.routine = (s.routine as RoutineBlock[]).filter((b) => b && b.type !== '공부');
  return s as unknown as AppState;
}

/** 내보내기 스냅샷 — 런타임 스캔 캐시 제외(파일 백업은 가볍게·깨끗하게). */
export function exportSnapshot(state: AppState): Partial<AppState> {
  const src = state as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k in src) if (!RUNTIME_CACHE_KEYS.includes(k)) out[k] = src[k];
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

/* 부팅 — 저장된 상태를 살리되, 손상/형식불일치면 *원본 raw를 CORRUPT_KEY에 보존*한 뒤
   기본값으로 시작(첫 persist가 복구가능한 원본을 덮어 영구손실하는 것 방지 · P1-7). */
export function boot(storage: KV): AppState {
  let raw: string | null = null;
  try {
    raw = storage.getItem(KEY);
  } catch {
    /* ignore */
  }
  let s: AppState | null = null;
  try {
    s = raw == null ? null : migrate(JSON.parse(raw));
  } catch {
    s = null;
  }
  if (!s && raw) {
    // 원본은 있는데 못 살림 = 손상/형식불일치
    try {
      if (storage.getItem(CORRUPT_KEY) == null) storage.setItem(CORRUPT_KEY, raw);
    } catch {
      /* ignore */
    }
  }
  return s || defaults();
}

/** localStorage(동기 1차 저장)에 KEY를 기록하고 직렬화 문자열을 반환(호출부가 IDB 미러에 전달). */
export function persist(storage: KV, state: AppState): string {
  const json = serialize(state);
  storage.setItem(KEY, json);
  return json;
}

export function hasCorrupt(storage: KV): boolean {
  try {
    return !!storage.getItem(CORRUPT_KEY);
  } catch {
    return false;
  }
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
export function doneMin(state: AppState, ds: string, sid: string, type: SessionType): number {
  const m = state.completions && state.completions[ds];
  const e = m && m[sid + '|' + type];
  return e && e.done ? +e.min || 0 : 0;
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
  if (on) m[k] = { done: true, min: Math.round(plannedMin) };
  else delete m[k];
  if (!Object.keys(m).length) delete state.completions[ds];
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
  let cur = new Date();
  cur.setHours(0, 0, 0, 0);
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
