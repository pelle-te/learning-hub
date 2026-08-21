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

/**
 * ⚠ `screen` 은 **Q-27 이 더한 네 번째 종류**(2026-08-02) — "무엇을 하던 중"이 아니라 "어디에
 * 있었나"다. 앞의 셋은 전부 *진행 중인 작업*이라, 아무 작업도 안 하고 화면만 보다 닫으면
 * 커서가 **아예 안 생겼다**(쓰기 트리거가 셋뿐이었다). 다른 기기에서 여는 사람에게는 그게
 * "직전에 뭘 보고 있었는지 모른다"와 같다.
 */
export type ResumeKind = 'review' | 'focus' | 'journal' | 'screen';

export interface ResumeCursor {
  kind: ResumeKind;
  /** 사람이 읽는 대상 이름(과목·블록·챕터). 화면 문구에 그대로 쓴다. */
  label: string;
  /** 기록 시각(epoch ms · 벽시계). TTL 판정의 기준. */
  at: number;
  /** 진행 상황 한 줄("3/12") — 있으면 표시한다. */
  progress?: string;
  /** `kind:'screen'` 전용 착지 경로. 다른 종류는 `RESUME_ROUTE` 가 정한다(Q-27). */
  route?: string;
  /** 집중 세션 종료 시각(epoch ms) — `kind:'focus'` 에만. E26.
   *  ⚠ 이 값이 **다른 기기에서 읽힐 때만** 값이 있다(내 기기는 `useFocus` 가 이미 안다).
   *  폰이 "PC 에서 집중 중 · N분 남음"을 말하는 근거이고, 그 이상은 하지 않는다 — 조작을 주면
   *  종료 감시자가 둘이 되고 `FocusChip` 이 경고한 "알림·완료 토스트가 두 번"이 재현된다. */
  endsAt?: number;
}

/** 기기 id → 커서. 자기 것도 남의 것도 여기 함께 있다(행은 기기별로 갈린다). */
export type ResumeMap = Record<string, ResumeCursor>;

const isCursor = (v: unknown): v is ResumeCursor => {
  if (!v || typeof v !== 'object') return false;
  const c = v as Partial<ResumeCursor>;
  return (
    (c.kind === 'review' || c.kind === 'focus' || c.kind === 'journal' || c.kind === 'screen') &&
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

/**
 * **다른 기기가 지금 집중 중인가** — 남은 밀리초(아니거나 이미 끝났으면 null). E26.
 *
 * 집중 세션은 `lib/focusState` 의 로컬 KV 에만 살아 기기를 넘지 않았다. 그래서 PC 에서 25분을
 * 걸어 두고 자리를 뜨면 폰은 그 사실을 모르고, 그 블록을 폰에서 완료 체크하면 PC 종료 토스트의
 * 완료 제안과 **이중**이 된다. 커서에 종료 시각 한 필드를 더해 그 공백을 닫는다.
 *
 * ⚠ **읽기 전용이다.** 폰에 중지·연장을 주면 종료 감시자가 둘이 되고, `FocusChip` 머리주석이
 * 경고한 "알림·완료 토스트가 두 번"이 그대로 재현된다. 아는 것과 조작하는 것은 다른 일이다.
 * ⚠ 시계 어긋남에 대한 방어는 **음수를 null 로** 접는 것뿐이다 — 남은 시간을 우기지 않는다.
 */
export function focusRemainingMs(cur: ResumeCursor, now: number): number | null {
  if (cur.kind !== 'focus' || typeof cur.endsAt !== 'number') return null;
  const left = cur.endsAt - now;
  return left > 0 ? left : null;
}

/** 커서를 기록한다(자기 행만). `label` 이 비면 아무것도 안 한다 — 이름 없는 이어하기는 못 읽는다. */
/**
 * **이 기기 자신의** 커서(없거나 만료면 null) — Q-27 이 "덮어쓸까"를 판정하는 데 쓴다.
 *
 * ⚠ `latestResume` 과 정반대다: 저쪽은 자기 것을 **일부러 뺀다**(기기를 넘는 것에만 값이 있다).
 * 여기서 자기 것을 봐야 하는 이유는 표시가 아니라 **쓰기 판정** 때문이다 — 진행 중 복습 커서를
 * "직전 화면"으로 덮으면 그건 커서를 지우는 것과 같다.
 */
export function ownResume(state: AppState, selfId: string, now: number): ResumeCursor | null {
  const cur = (state as unknown as { resume?: ResumeMap }).resume?.[selfId];
  if (!cur || !isCursor(cur) || cur.at > now) return null;
  if (now - cur.at > RESUME_TTL_MIN * 60_000) return null;
  return cur;
}

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
  journal: '/day',
  /** ⚠ `screen` 만 **경로를 커서가 들고 있다**(`label` 이 아니라 `route`). 여기 값은 그 필드가
   *  비었을 때의 폴백일 뿐이다 — 종류가 화면을 정하는 다른 셋과 성질이 다르다. */
  screen: '/today',
};

/** 커서 → 사람이 읽는 행동 문구. */
export function resumeLabel(cur: ResumeCursor): string {
  // `screen` 은 "이어하기"가 아니다 — 하던 일이 없으므로 **되돌아가기**라고 말한다.
  if (cur.kind === 'screen') return `직전 화면 — ${cur.label}`;
  const what = cur.kind === 'review' ? '복습' : cur.kind === 'focus' ? '집중' : '기록';
  return cur.progress ? `${what} 이어하기 — ${cur.label} (${cur.progress})` : `${what} 이어하기 — ${cur.label}`;
}

/**
 * 진행 표기(`"7/12"`)에서 **0-based 착지 인덱스**를 뽑는다. 형태가 아니면 null.
 *
 * ⚠ 이 함수가 없던 동안 화면은 `(7/12)` 를 **약속만 하고** 착지점은 언제나 0 이었다 — 즉 이
 * 모듈 머리주석이 존재 이유로 든 바로 그 중복 학습("폰에서 7장 했는데 PC 에서 또 본다")을
 * 기능이 **보장**하고 있었다. 약속과 착지를 잇는 것이 이 파서다.
 * ⚠ 쓰는 쪽(`ReviewRun.advance`)이 넣는 값은 **다음 카드의 1-based 번호**다(`idx+2`) →
 * 0-based 는 그것에서 1 을 뺀 값이다. 이 규약이 갈리면 카드 하나가 조용히 건너뛰어진다.
 * ⚠ 큐 길이는 여기서 안 본다 — 기기마다 상태가 달라 길이가 다를 수 있고, 클램프는 실제
 * 큐를 쥔 호출부의 몫이다(여기서 하면 파서가 큐를 알아야 한다).
 */
/**
 * 착지 화면에 "이어하기로 왔다"를 전하는 내비게이션 state.
 *
 * ⚠ **커서를 착지 화면이 직접 읽으면 안 된다.** 다른 기기의 커서가 살아 있는 동안 사용자가
 * 그냥 복습을 열면(레일·⌘K·`g` 단축키) 묻지도 않고 7번째 카드에서 시작하게 된다 — 이어하기는
 * *누른 사람의 의도*이지 화면의 기본값이 아니다. 그래서 의도는 **진입 경로가 실어 나른다**.
 */
export interface ResumeNav {
  /** 0-based 착지 인덱스. `resumeIndex()` 산출값. */
  resumeAt: number;
}

/**
 * 임시 학습 세트로 러너를 여는 의도(I043 · 2026-08-22). `ResumeNav` 와 **같은 통로**를 쓴다 —
 * 위 머리주석의 논거가 그대로 적용된다: 이건 *누른 사람의 의도*이지 화면의 기본값이 아니다.
 * 진입 경로가 안 실어 나르면 러너는 언제나 정규 큐다.
 *
 * ⚠ `preview` 를 **필수**로 둔다(기본값 없음). 옵셔널로 두면 «안 적으면 앵커를 옮긴다» 가
 * 기본이 되는데, 이 기능의 위험이 정확히 그것이다(정규 스케줄 오염 · `buildAdhocQueue` 머리주석).
 */
export interface AdhocNav {
  /** `sid|chapter` 키 목록. */
  adhoc: string[];
  /** 참이면 앵커를 **안 옮긴다**(망각곡선 무변경). */
  preview: boolean;
}

export function resumeIndex(cur: ResumeCursor): number | null {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(cur.progress ?? '');
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1) return null;
  return n - 1;
}
