/* ============================================================
   uiState.ts — UI 환경설정의 단일 원천(영속). 앱 데이터(study_planner_v3)와 분리된
   '뷰 선택·최근 명령' 같은 가벼운 기기별 설정을 한 키로 모은다.
   목적: 산재하던 localStorage 키(sched_view·lh_recent_cmds)를 단일화 + 스키마 검증 + 테스트 가능.
   useApp과 동일한 KV 주입 패턴(순수)이라 노드/테스트에서도 그대로 동작.
============================================================ */
import { z } from 'zod';
import type { KV } from './types';

// 배치 세그먼트 뷰(계획개편 §12-5) — [배분·주·일·월]. 배분(alloc)=주간 배분 보드(계획의 중심 · v2).
// 구 값(overview·cards)은 주(week)로 흡수.
export const SchedViewSchema = z.enum(['day', 'week', 'month']);
export type SchedView = z.infer<typeof SchedViewSchema>;
/** 레거시 뷰명 → 현행 매핑. 저장본·딥링크·구 fixture 호환(무마이그레이션).
    overview/cards = 옛 주 뷰 이름 · alloc = 옛 '배분' 뷰(재개편 v4에서 독립 세그먼트로 승격돼
    캘린더의 뷰가 아니게 됐다 → 주 뷰로 착지시킨다. 배분을 보려면 /alloc 세그먼트로). */
export function migrateSchedView(v: unknown): SchedView | undefined {
  if (v === 'overview' || v === 'cards' || v === 'alloc') return 'week';
  return v === 'day' || v === 'week' || v === 'month' ? v : undefined;
}

/** 네온 액센트 노브 — tokens.css의 [data-accent] 프리셋과 1:1. 기본 violet(브랜드). */
export const AccentSchema = z.enum(['violet', 'lime', 'cyan', 'amber']);
export type Accent = z.infer<typeof AccentSchema>;

/** 나브 표면(P9 Phase 6 Wave⑥) — 학습(핵심·숙련) vs 자료(수집·발견) 두 표면 스위처.
    라우트가 1차 원천(현재 탭의 surface)이고, 전역 탭(설정)에선 이 영속값으로 폴백. 기본 학습. */
export const NavSurfaceSchema = z.enum(['study', 'materials']);
export type NavSurface = z.infer<typeof NavSurfaceSchema>;
// enum이 선언순 tuple을 보존 → 목록 재기입 없이 스키마에서 파생(SSOT). 소비처 타입 유지 위해 spread.
export const ACCENTS: Accent[] = [...AccentSchema.options];

export const RECENT_MAX = 6; // 팔레트 최근 명령 LRU 길이

export const UIStateSchema = z.object({
  // preprocess로 구 값을 흡수하고, 그래도 못 맞추면 .catch로 폴백 — schedView 하나가
  // 전체 UIState parse를 깨 accent·최근명령까지 기본값으로 되돌리던 것을 방지(부분 손상 격리).
  // 기본=week(캘린더 주 뷰). 재개편 v4에서 배분이 독립 세그먼트로 빠지며 캘린더가 계획의 첫 착지가 됐다.
  schedView: z.preprocess((v) => migrateSchedView(v) ?? v, SchedViewSchema).catch('week'),
  accent: AccentSchema.default('lime'),
  recentCommands: z.array(z.string()).default([]),
  // 발광 효과 줄이기 — 풀스크린 오로라 셰이더 정지 + 발광 오라 무한 애니 정지(상시 GPU/페인트 절감).
  // 기본 false(현 외형 그대로). 옛 저장본엔 없으니 .default로 호환. data-fx="lite"로 cascade.
  fxLite: z.boolean().default(false),
  // 사이드바 접힘 — false=라벨+그룹 펼침(기본), true=60px 아이콘 레일. 옛 저장본 호환 위해 .default.
  navCollapsed: z.boolean().default(false),
  // 나브 표면(Wave⑥) — 스위처 클릭·전역 탭 폴백용 영속값. 라우트가 우선. 옛 저장본은 .default로 학습.
  navSurface: NavSurfaceSchema.default('study'),
  // Anki 실시간 due 자동 새로고침(2단계-A4) — 원래 AnkiPanel이 'lh:anki-autorefresh' 평문 키를
  // localStorage에 **직접** 쓰던 유일한 kv SSOT 우회였다. 계층 밖이라 백업에도 안 들어갔다
  // (0단계-E가 고친 결함과 같은 부류인데 그때 누락됨) → UI 설정으로 흡수해 _local 사이드카에 편입.
  ankiAutoRefresh: z.boolean().default(false),
});
export type UIState = z.infer<typeof UIStateSchema>;

export const UI_KEY = 'lh_ui_v1'; // 단일 저장 키
// 단일화 이전 산재 키 — 부팅 시 1회 흡수 후 제거.
const LEGACY_VIEW = 'sched_view';
const LEGACY_RECENT = 'lh_recent_cmds';
/** AnkiPanel이 직접 쓰던 평문 키('1'/'0') — 2단계-A4에서 흡수. */
const LEGACY_ANKI_AUTO = 'lh:anki-autorefresh';

// 전 필드가 .default()를 가지므로 빈 객체 parse가 완전한 기본 UIState를 만든다 —
// 기본값을 손으로 재나열하지 않고 스키마를 단일 원천으로.
export function defaultUI(): UIState {
  return UIStateSchema.parse({});
}

/** 저장된 UI 설정을 읽는다. 신규 키가 없으면 구 산재 키를 1회 흡수하고, 손상 시 기본값. */
export function bootUI(storage: KV): UIState {
  try {
    const raw = storage.getItem(UI_KEY);
    if (raw) {
      const obj: unknown = JSON.parse(raw);
      const parsed = UIStateSchema.safeParse(obj);
      if (!parsed.success) return defaultUI();
      // ⚠ anki 흡수는 UI_KEY가 **있어도** 해야 한다 — 기존 사용자는 UI_KEY와 구 anki 키를 둘 다
      // 가지고 있고, 여기서 안 읽으면 .default(false)가 사용자의 '1' 설정을 조용히 지운다.
      // 이미 신규 필드가 저장돼 있으면(=흡수 완료) 그 값이 이긴다.
      if (!hasOwn(obj, 'ankiAutoRefresh')) {
        const legacy = readLegacyAnki(storage);
        if (legacy !== undefined) parsed.data.ankiAutoRefresh = legacy;
      }
      return parsed.data;
    }
    return absorbLegacy(storage);
  } catch {
    return defaultUI();
  }
}

/** 신뢰 불가 파싱 결과에서 자기 소유 속성만 확인(프로토타입 오염 차단 — sidecars.ts와 동형). */
function hasOwn(o: unknown, k: string): boolean {
  return !!o && typeof o === 'object' && Object.hasOwn(o, k);
}

/** 구 anki 자동새로고침 키를 boolean으로. 저장된 적 없으면 undefined(= 흡수할 게 없음). */
function readLegacyAnki(storage: KV): boolean | undefined {
  try {
    const raw = storage.getItem(LEGACY_ANKI_AUTO);
    return raw == null ? undefined : raw === '1';
  } catch {
    return undefined;
  }
}

/** 구 키(sched_view·lh_recent_cmds·lh:anki-autorefresh)를 단일 UIState로 흡수(있을 때만). */
function absorbLegacy(storage: KV): UIState {
  const ui = defaultUI();
  const anki = readLegacyAnki(storage);
  if (anki !== undefined) ui.ankiAutoRefresh = anki;
  try {
    const mapped = migrateSchedView(storage.getItem(LEGACY_VIEW));
    if (mapped) ui.schedView = mapped;
  } catch {
    /* noop */
  }
  try {
    const raw = storage.getItem(LEGACY_RECENT);
    const arr = raw ? JSON.parse(raw) : null;
    if (Array.isArray(arr)) ui.recentCommands = arr.filter((x) => typeof x === 'string').slice(0, RECENT_MAX);
  } catch {
    /* noop */
  }
  return ui;
}

/** UI 설정을 단일 키로 직렬화·저장하고 JSON을 반환(호출부가 IDB 미러에 전달). */
export function persistUI(storage: KV, ui: UIState): string {
  const json = JSON.stringify(ui);
  try {
    storage.setItem(UI_KEY, json);
    // 흡수 완료된 구 키 정리 — 다음 부팅부턴 단일 출처만 본다.
    storage.removeItem(LEGACY_VIEW);
    storage.removeItem(LEGACY_RECENT);
    storage.removeItem(LEGACY_ANKI_AUTO);
  } catch {
    /* private mode 등 — 메모리 상태는 계속 동작 */
  }
  return json;
}

/** 최근 명령 LRU 갱신(최신 앞·중복 제거·최대 RECENT_MAX). */
export function pushRecent(list: string[], id: string): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, RECENT_MAX);
}
