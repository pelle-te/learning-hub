/* ============================================================
   uiState.ts — UI 환경설정의 단일 원천(영속). 앱 데이터(study_planner_v3)와 분리된
   '뷰 선택·최근 명령' 같은 가벼운 기기별 설정을 한 키로 모은다.
   목적: 산재하던 localStorage 키(sched_view·lh_recent_cmds)를 단일화 + 스키마 검증 + 테스트 가능.
   useApp과 동일한 KV 주입 패턴(순수)이라 노드/테스트에서도 그대로 동작.
============================================================ */
import { z } from 'zod';
import type { KV } from './types';

export const SchedViewSchema = z.enum(['overview', 'cards']);
export type SchedView = z.infer<typeof SchedViewSchema>;

/** 네온 액센트 노브 — tokens.css의 [data-accent] 프리셋과 1:1. 기본 violet(브랜드). */
export const AccentSchema = z.enum(['violet', 'lime', 'cyan', 'amber']);
export type Accent = z.infer<typeof AccentSchema>;
export const ACCENTS: Accent[] = ['violet', 'lime', 'cyan', 'amber'];

export const RECENT_MAX = 6; // 팔레트 최근 명령 LRU 길이

export const UIStateSchema = z.object({
  schedView: SchedViewSchema.default('overview'),
  accent: AccentSchema.default('lime'),
  recentCommands: z.array(z.string()).default([]),
  // 발광 효과 줄이기 — 풀스크린 오로라 셰이더 정지 + 발광 오라 무한 애니 정지(상시 GPU/페인트 절감).
  // 기본 false(현 외형 그대로). 옛 저장본엔 없으니 .default로 호환. data-fx="lite"로 cascade.
  fxLite: z.boolean().default(false),
});
export type UIState = z.infer<typeof UIStateSchema>;

export const UI_KEY = 'lh_ui_v1'; // 단일 저장 키
// 단일화 이전 산재 키 — 부팅 시 1회 흡수 후 제거.
const LEGACY_VIEW = 'sched_view';
const LEGACY_RECENT = 'lh_recent_cmds';

export function defaultUI(): UIState {
  return { schedView: 'overview', accent: 'lime', recentCommands: [], fxLite: false };
}

/** 저장된 UI 설정을 읽는다. 신규 키가 없으면 구 산재 키를 1회 흡수하고, 손상 시 기본값. */
export function bootUI(storage: KV): UIState {
  try {
    const raw = storage.getItem(UI_KEY);
    if (raw) {
      const parsed = UIStateSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : defaultUI();
    }
    return absorbLegacy(storage);
  } catch {
    return defaultUI();
  }
}

/** 구 키(sched_view·lh_recent_cmds)를 단일 UIState로 흡수(있을 때만). */
function absorbLegacy(storage: KV): UIState {
  const ui = defaultUI();
  try {
    const v = storage.getItem(LEGACY_VIEW);
    if (v === 'overview' || v === 'cards') ui.schedView = v;
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
  } catch {
    /* private mode 등 — 메모리 상태는 계속 동작 */
  }
  return json;
}

/** 최근 명령 LRU 갱신(최신 앞·중복 제거·최대 RECENT_MAX). */
export function pushRecent(list: string[], id: string): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, RECENT_MAX);
}
