/* ============================================================
   focusState.ts — 집중 세션(포모도로)의 단일 원천(영속·순수).
   세션은 벽시계 endsAt(ms)로 기록되므로 새로고침·탭 이동에도 이어진다.
   uiState와 동일한 KV 주입 패턴 — 노드/테스트에서 그대로 동작.
   '오늘의 포커스 블록' 선택 로직(todayEntries·pickFocus)도 여기 두어
   오늘 탭 히어로·상단 바·팔레트가 같은 규칙을 공유한다(드리프트 방지).
============================================================ */
import { completionKey } from './domainKeys';
import { z } from 'zod';
import type { AppState, ItemStat, KV, ScheduleItem, ScheduleResult, SessionType } from './types';
import { layoutDay, sessionTimeMap } from './scheduler';
import { isDone } from './persistence';
import { todayISO, dayDiff, ddayInfo, toHM } from './utils';

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
    const tm = timeBy[completionKey(it.sid, it.type)] || { start: null, end: null };
    return { it, start: tm.start, end: tm.end, done: isDone(state, ds, it.sid, it.type) };
  });
}

export interface FocusPick {
  current: FocusEntry | null;
  next: FocusEntry | null;
  earliest: FocusEntry | null;
  /** 히어로/집중 시작이 가리키는 대상 — 지금 진행 중 > 다음 예정 > 가장 이른 미완료 */
  focus: FocusEntry | null;
  /** **왜 이것인가** 한 줄(D-5). 고른 이유를 고른 자리에서 말한다 — 없으면 ''. */
  reason: string;
}

/* ── D-5: 초점은 한 함수가 고르고, 고른 이유를 함께 말한다 ─────────────────
   같은 질문("지금 뭘 하지")에 답이 **둘**이었다: 데스크톱은 시간대(`pickFocus`), 폰은
   마감·진도 가중(`lib/todayFocus.pickTodayFocus`). 그리고 **폰만 이유를 표시했다** —
   작은 화면이 큰 화면보다 나은 답을 주고 있었다. 두 규칙을 여기 하나로 합친다.

   합치는 방식이 요점이다. 시간이 박힌 블록에는 **시간이 이긴다**(9시 블록을 12시에 하라고
   말하면 계획을 배신한다). 시간이 없는 블록끼리는 **급한 것이 이긴다**(옛 폰 규칙 —
   마감 > 진도 밀림 > 크기). 즉 폰 규칙은 폐기가 아니라 *배치되지 않은 블록의 정렬 기준*으로
   흡수된다. 폰은 시간 배치를 안 하므로 그쪽에선 옛 동작이 그대로 남는다.

   ⚠ 계수를 새로 만들지 않았다 — 점수식은 `todayFocus.ts` 의 것을 그대로 옮겼다. */
const URGENT_DEADLINE_DAYS = 7; // 이유 문구를 '마감'으로 바꾸는 임계(옛 todayFocus 와 동일)

/** 급함 점수 — 마감 임박(지배적) > 진도 밀림 > 블록 크기. `stat` 이 없으면 크기만 본다. */
function urgency(e: FocusEntry, statBySid: Map<string, ItemStat>, today: string): number {
  const st = statBySid.get(e.it.sid);
  const dd = st?.deadline && !st.finished ? dayDiff(today, st.deadline) : null;
  const deadlineScore = dd != null && dd >= 0 ? 10000 - dd * 100 : 0;
  return deadlineScore + (st?.late || 0) * 10 + (e.it.min || 0) / 60;
}

/** 고른 이유 한 줄 — 시간 위치가 있으면 그것이, 없으면 급함의 근거가 답이다. */
function reasonFor(
  e: FocusEntry | null,
  where: 'current' | 'next' | 'earliest' | null,
  statBySid: Map<string, ItemStat>,
  today: string,
): string {
  if (!e || !where) return '';
  if (where === 'current') return '지금 시간대';
  const st = statBySid.get(e.it.sid);
  const dd = st?.deadline && !st.finished ? dayDiff(today, st.deadline) : null;
  if (dd != null && dd >= 0 && dd <= URGENT_DEADLINE_DAYS) return `마감 ${ddayInfo(dd).lab}`;
  if ((st?.late || 0) > 0) return '진도 밀림';
  /* ⚠ 시각이 있을 때만 시각을 말한다 — 시각 없는 블록에 '다음 예정'이라 하면 없는 약속을
     지어낸다. 시각이 있는데 이미 지났으면 그 사실 자체가 가장 정확한 이유다. */
  if (e.start != null) return where === 'next' ? `다음 예정 ${toHM(e.start)}` : `${toHM(e.start)} 예정 · 아직 안 함`;
  return '오늘 가장 큰 학습';
}

/**
 * 미완료 블록 중 '지금 할 일'과 그 이유를 고른다.
 * 순서: 지금 진행 중 → 다음 예정 → (시간 없는 것 중) 가장 급한 것.
 * `stat`·`today` 를 주면 급함(마감·진도)이 반영된다 — 없으면 옛 동작(가장 이른 것).
 */
export function pickFocus(entries: FocusEntry[], nowMin: number, stat: ItemStat[] = [], today = ''): FocusPick {
  const startKey = (e: FocusEntry) => e.start ?? 9999;
  const statBySid = new Map(stat.map((s) => [s.id, s]));
  const pending = entries.filter((e) => !e.done);
  const current = pending.find((e) => e.start != null && e.end != null && nowMin >= e.start && nowMin < e.end) || null;
  /* 정렬 = 이른 시각 먼저, **동률(특히 시각 없음)이면 급한 것 먼저**. 배치된 날은 시각이 전부
     다르므로 옛 동작과 한 글자도 다르지 않고, 시각이 없는 날(폰·미배치)에만 급함이 갈린다. */
  const byOrder = (a: FocusEntry, b: FocusEntry) =>
    startKey(a) - startKey(b) || urgency(b, statBySid, today) - urgency(a, statBySid, today);
  const next = pending.filter((e) => startKey(e) >= nowMin).sort(byOrder)[0] || null;
  const earliest = pending.slice().sort(byOrder)[0] || null;
  const focus = current || next || earliest || null;
  const where = current ? 'current' : next ? 'next' : earliest ? 'earliest' : null;
  return { current, next, earliest, focus, reason: reasonFor(focus, where, statBySid, today) };
}

/** 집중 세션 길이(분) — 블록 분량을 따르되 50분 상한, 없으면 25분(포모도로). */
export function focusMinutes(e: FocusEntry | null): number {
  return e?.it.min && e.it.min > 0 ? Math.min(e.it.min, 50) : 25;
}
