/* ============================================================
   resume.ts — 기기 사이를 넘는 '이어하기 커서'(N-7). 순수 로직 + 얇은 쓰기 헬퍼.

   문제: 폰은 열면 무조건 오늘 뷰, 데스크톱은 무조건 `/today` 다. 진행 중이던 복습·집중은
   `storage`(로컬 KV)에만 있어 **기기를 넘지 않았고**, 그래서 폰에서 이어하려면 "어디까지
   했더라"를 기억으로 재구성해야 했다 — 틀리면 같은 걸 두 번 한다(중복 학습).

   설계:
   · 저장 위치는 `ds_map` 슬라이스 `resume`(키=기기 id) — **새 테이블 0 · 서버 DDL 0**.
     각 기기가 **자기 행만 쓰고 남의 행만 읽으므로 동기화 충돌이 원리적으로 없다**.
   · 커서는 라우트가 아니라 **의도**(`kind`)다. 그래서 폰 라우팅에 투자할 필요가 없다 —
     `kind`→뷰 매핑 표 하나면 두 화면 문법이 각자 자기 방식으로 착지한다(드롭된 F1 딥링크
     핸드오프의 사유가 이것으로 사라진다).
   · **6시간이 지나면 스스로 사라진다.** 안 그러면 "3일 전 하던 것"이 매일 아침 죄책감이 된다.
     커서는 *지금 이어서 하는 것*이지 할 일 목록이 아니다.

   ⚠ 쓰기 트리거는 **셋뿐**이다(집중 시작/종료 · 복습 진행 · 저널 초안). 탭 이동마다 쓰면
   매 내비게이션이 `syncedSliceChanged` 를 때려 아웃박스가 잡음으로 찬다.
============================================================ */
import type { AppState } from './types';

/* 이 기기의 id — 클라우드 등록 시 발급된 값(`cloud:deviceId`)을 부팅 때 한 번 받아 둔다.
   ⚠ **미연결이면 빈 문자열이고, 그러면 이 기능 전체가 무동작이다.** 그게 맞다: 기기가 하나면
   넘을 기기가 없고, 쓰기만 남기면 아웃박스에 아무도 안 읽는 행을 쌓게 된다. */
let selfDeviceId = '';
export function setResumeDevice(id: string | null | undefined): void {
  selfDeviceId = id ?? '';
}
export function resumeDevice(): string {
  return selfDeviceId;
}

/** 커서가 살아 있는 시간(분) — 6시간. */
export const RESUME_TTL_MIN = 360;

export type ResumeKind = 'review' | 'focus' | 'journal';

export interface ResumeCursor {
  kind: ResumeKind;
  /** 사람이 읽는 대상 이름(과목·블록·챕터). 화면 문구에 그대로 쓴다. */
  label: string;
  /** 기록 시각(epoch ms · 벽시계). TTL 판정의 기준. */
  at: number;
  /** 진행 상황 한 줄("3/12") — 있으면 표시한다. */
  progress?: string;
}

/** 기기 id → 커서. 자기 것도 남의 것도 여기 함께 있다(행은 기기별로 갈린다). */
export type ResumeMap = Record<string, ResumeCursor>;

const isCursor = (v: unknown): v is ResumeCursor => {
  if (!v || typeof v !== 'object') return false;
  const c = v as Partial<ResumeCursor>;
  return (
    (c.kind === 'review' || c.kind === 'focus' || c.kind === 'journal') &&
    typeof c.label === 'string' &&
    typeof c.at === 'number'
  );
};

/**
 * **다른 기기**의 살아 있는 커서 중 가장 최근 것. 없으면 null.
 *
 * ⚠ 자기 커서는 일부러 뺀다 — 지금 이 기기에서 하던 것은 화면이 이미 보여 주고 있고, 그것을
 * "이어하기"로 다시 권하면 방금 한 일을 되돌리라는 말처럼 읽힌다. 이 기능의 값은 **기기를
 * 넘는 것**에만 있다.
 * ⚠ 미래 시각(시계 어긋남·시드)은 무시한다 — 안 그러면 영원히 만료되지 않는 커서가 생긴다.
 */
export function latestResume(
  state: AppState,
  selfId: string,
  now: number,
): { deviceId: string; cur: ResumeCursor } | null {
  const map = (state as unknown as { resume?: ResumeMap }).resume;
  if (!map) return null;
  let best: { deviceId: string; cur: ResumeCursor } | null = null;
  for (const [deviceId, cur] of Object.entries(map)) {
    if (deviceId === selfId || !isCursor(cur)) continue;
    if (cur.at > now) continue;
    if (now - cur.at > RESUME_TTL_MIN * 60_000) continue;
    if (!best || cur.at > best.cur.at) best = { deviceId, cur };
  }
  return best;
}

/** 커서를 기록한다(자기 행만). `label` 이 비면 아무것도 안 한다 — 이름 없는 이어하기는 못 읽는다. */
export function putResume(state: AppState, selfId: string, cur: ResumeCursor): void {
  if (!selfId || !cur.label) return;
  const st = state as unknown as { resume?: ResumeMap };
  st.resume = { ...(st.resume || {}), [selfId]: cur };
}

/** 커서를 지운다(끝냈으니 이어할 것이 없다). */
export function clearResume(state: AppState, selfId: string): void {
  const st = state as unknown as { resume?: ResumeMap };
  if (!st.resume || !st.resume[selfId]) return;
  const next = { ...st.resume };
  delete next[selfId];
  st.resume = next;
}

/** 커서 → 착지 경로(데스크톱). 폰은 같은 `kind` 를 자기 뷰 이름으로 옮긴다. */
export const RESUME_ROUTE: Record<ResumeKind, string> = {
  review: '/review-run',
  focus: '/today',
  journal: '/journal',
};

/** 커서 → 사람이 읽는 행동 문구. */
export function resumeLabel(cur: ResumeCursor): string {
  const what = cur.kind === 'review' ? '복습' : cur.kind === 'focus' ? '집중' : '기록';
  return cur.progress ? `${what} 이어하기 — ${cur.label} (${cur.progress})` : `${what} 이어하기 — ${cur.label}`;
}
