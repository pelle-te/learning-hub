/* ============================================================
   reviewHold.ts — **복습 보류 선반**(P-11 · 2026-08-01). 데스크톱·폰 러너 공용 순수 로직.

   ## 왜 필요한가 — 앱에 "이건 안 볼게"라고 말할 문법이 없었다

   러너의 `건너뛰기`(`advance(false)`)는 **아무것도 쓰지 않는다.** 세션 안에서 한 번 더 만나게
   재큐할 뿐이고, 다음 날 그 챕터는 **완전히 동일하게 돌아온다.** `REVIEW_CHAPTER_CAP=12` 는 한
   세션의 크기만 줄일 뿐 집합을 안 줄이므로, 12장을 다 밀어도 내일 큐는 여전히 12장이다.
   즉 사용자가 할 수 있는 유일한 행동이 **매일 같은 것을 다시 미는 의식**이었고, overdue 카운트는
   영구히 빨갛다.

   ## P-9(컷 리스트)와 같은 동사 · 다른 시제

   ⚠ 로드맵이 착수 조건으로 못박은 것: 두 개의 다른 "버리기"가 생기면 안 된다. P-9 는 **아직 안
   배운 것의 사전 포기**이고 이쪽은 **이미 배운 것의 사후 정리**라 시제가 다르지만, 사용자에게
   보이는 문법은 하나여야 한다. 그래서 셋을 공유한다:
   · 동사 = **빼기**(`이번 범위에서 빼기` / `복습에서 빼기`)
   · 되돌리기 = **`되돌리기`** 하나 · **자동 만료 없음**(사용자가 되돌릴 때까지)
   · 시각 어휘 = `ds-shed`(채도 저하 + 취소선 · 투명도 금지)
   그리고 둘 다 **삭제가 아니다** — 챕터는 남고 큐에서만 빠진다. 삭제로 만들면 아무도 안 누른다.

   ## 저장

   `state.reviewHold[`${sid}|${chapter}`] = ds`(뺀 날). 값이 날짜인 것은 선반이 "언제 뺐나"를
   말할 수 있게 하기 위해서다 — **만료용이 아니다**(자동 만료는 위 규율을 깬다).
   ⚠ 새 테이블 0 · 서버 DDL 0: `ROW_SLICES` 에 없는 최상위 필드는 `settings` 한 행의 JSON 으로
   자동으로 간다(`lib/db/rows.ts` 머리주석).
============================================================ */
import type { AppState } from './types';

/** 앵커 키 — `reviewTouches` 와 **같은 형태**여야 한다(같은 대상을 가리키는 두 기록이므로). */
export function holdKey(sid: string, chapter: string): string {
  return `${sid}|${chapter}`;
}

export function isHeld(state: AppState, sid: string, chapter: string): boolean {
  return !!state.reviewHold?.[holdKey(sid, chapter)];
}

/** 뺀다. 이미 빼여 있으면 날짜를 덮지 않는다 — "언제 뺐나"가 첫 결정의 날짜여야 한다. */
export function holdReview(st: AppState, sid: string, chapter: string, ds: string): void {
  const k = holdKey(sid, chapter);
  if (!st.reviewHold) st.reviewHold = {};
  if (!st.reviewHold[k]) st.reviewHold[k] = ds;
}

/** 되돌린다. 다음 큐 조립에서 원래 위험 티어 그대로 돌아온다(별도 복원 상태가 없다). */
export function releaseReview(st: AppState, sid: string, chapter: string): void {
  if (st.reviewHold) delete st.reviewHold[holdKey(sid, chapter)];
}

export interface HeldEntry {
  sid: string;
  chapter: string;
  /** 과목 이름 — 없어진 과목이면 null(선반은 그래도 보여야 되돌릴 수 있다). */
  name: string | null;
  ds: string;
}

/** 선반 목록 — 최근에 뺀 것부터. 화면이 이걸 그대로 그린다. */
export function heldReviews(state: AppState): HeldEntry[] {
  const byId = new Map(state.items.map((it) => [it.id, it.name]));
  return Object.entries(state.reviewHold || {})
    .map(([k, ds]) => {
      const cut = k.indexOf('|');
      const sid = cut < 0 ? k : k.slice(0, cut);
      return { sid, chapter: cut < 0 ? '' : k.slice(cut + 1), name: byId.get(sid) ?? null, ds };
    })
    .sort((a, b) => (a.ds < b.ds ? 1 : a.ds > b.ds ? -1 : a.chapter.localeCompare(b.chapter)));
}
