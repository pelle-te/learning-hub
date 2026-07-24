/* ============================================================
   focusState.ts — 집중 세션(포모도로)의 단일 원천(영속·순수).
   세션은 벽시계 endsAt(ms)로 기록되므로 새로고침·탭 이동에도 이어진다.
   uiState와 동일한 KV 주입 패턴 — 노드/테스트에서 그대로 동작.
   '오늘의 포커스 블록' 선택 로직(todayEntries·pickFocus)도 여기 두어
   오늘 탭 히어로·상단 바·팔레트가 같은 규칙을 공유한다(드리프트 방지).
============================================================ */
import { z } from 'zod';
import type { AppState, KV, ScheduleItem, ScheduleResult, SessionType } from './types';
import { layoutDay, sessionTimeMap } from './scheduler';
import { isDone } from './persistence';
import { todayISO } from './utils';

export const FocusSessionSchema = z.object({
  /** 세션 종료 시각(ms epoch) — 벽시계라 리로드 후에도 이어짐 */
  endsAt: z.number(),
  /** 세션 길이(초) — 진행률 계산용 */
  total: z.number(),
  startedAt: z.number(),
  /** 대상 블록 식별(완료 토글용) */
  ds: z.string(),
  sid: z.string(),
  type: z.enum(['anki', 'new', 'rev', 'blank', 'mock']) satisfies z.ZodType<SessionType>,
  name: z.string(),
  /** 블록의 원래 분량(분) — toggleDone에 넘길 값(세션 분과 다를 수 있음) */
  blockMin: z.number(),
  /** 복습이 겨냥한 챕터(ReviewRun 전용) — 완료 시 챕터 터치 로그(위험모델 lastDs 갱신 · 감사 #22). 생략 = 챕터 무관 블록. */
  chapter: z.string().optional(),
  /** 세션 종류 — 'break'는 완료 알림 후 자동 시작되는 휴식(완료 토글 없음). 'free'는 예약 블록
   *  없는 즉석 집중(ID-3) — 대상 블록이 없어 **완료 토글 경로에서 빠진다**(유령 완료 방지),
   *  단 집중처럼 축하·자동 휴식은 준다. 생략 = 예약 블록 집중(하위호환). */
  kind: z.enum(['focus', 'break', 'free']).optional(),
});
export type FocusSession = z.infer<typeof FocusSessionSchema>;

export const FOCUS_KEY = 'lh_focus_v1';
/** 앱이 꺼진 사이 끝난 세션도 이 그레이스 안이면 복원 — 부팅 직후 완료 알림으로 이어줌. */
export const FOCUS_GRACE_MS = 90 * 60_000;

/** 저장된 세션을 읽는다 — 진행 중이거나 그레이스 내에 끝난 것만, 손상 시 null. */
export function bootFocus(storage: KV, now: number): FocusSession | null {
  try {
    const raw = storage.getItem(FOCUS_KEY);
    if (!raw) return null;
    const parsed = FocusSessionSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    return parsed.data.endsAt > now - FOCUS_GRACE_MS ? parsed.data : null;
  } catch {
    return null;
  }
}

/** 세션을 영속(null이면 제거). private mode 등 실패는 무시 — 메모리로 계속. */
export function persistFocus(storage: KV, s: FocusSession | null): void {
  try {
    if (s) storage.setItem(FOCUS_KEY, JSON.stringify(s));
    else storage.removeItem(FOCUS_KEY);
  } catch {
    /* noop */
  }
}

/** 오늘 학습 블록 + 배치 시각 + 완료 여부(오늘 탭 히어로와 동일 파생). */
export interface FocusEntry {
  it: ScheduleItem;
  start: number | null;
  end: number | null;
  done: boolean;
}

/** 오늘 날짜의 학습 항목을 배치 시각·완료 여부로 보강해 반환. */
export function todayEntries(state: AppState, res: ScheduleResult): FocusEntry[] {
  const ds = todayISO(state);
  const todayDay = (res.days || []).find((d) => d.ds === ds);
  const items = todayDay?.items || [];
  if (!items.length) return [];
  const L = layoutDay(state, todayDay!);
  const timeBy = sessionTimeMap(L.sessions);
  return items.map((it) => {
    const tm = timeBy[it.sid + '|' + it.type] || { start: null, end: null };
    return { it, start: tm.start, end: tm.end, done: isDone(state, ds, it.sid, it.type) };
  });
}

export interface FocusPick {
  current: FocusEntry | null;
  next: FocusEntry | null;
  earliest: FocusEntry | null;
  /** 히어로/집중 시작이 가리키는 대상 — 지금 진행 중 > 다음 예정 > 가장 이른 미완료 */
  focus: FocusEntry | null;
}

/** 미완료 블록 중 '지금 할 일'을 고른다(현재 시간대 → 다음 → 가장 이른 순). */
export function pickFocus(entries: FocusEntry[], nowMin: number): FocusPick {
  const startKey = (e: FocusEntry) => e.start ?? 9999;
  const pending = entries.filter((e) => !e.done);
  const current = pending.find((e) => e.start != null && e.end != null && nowMin >= e.start && nowMin < e.end) || null;
  const next = pending.filter((e) => startKey(e) >= nowMin).sort((a, b) => startKey(a) - startKey(b))[0] || null;
  const earliest = pending.slice().sort((a, b) => startKey(a) - startKey(b))[0] || null;
  return { current, next, earliest, focus: current || next || earliest || null };
}

/** 집중 세션 길이(분) — 블록 분량을 따르되 50분 상한, 없으면 25분(포모도로). */
export function focusMinutes(e: FocusEntry | null): number {
  return e?.it.min && e.it.min > 0 ? Math.min(e.it.min, 50) : 25;
}
