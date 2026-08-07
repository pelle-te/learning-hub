/* ============================================================
   icsFeed.ts — **N-7 살아 있는 ics 구독 피드**. 값의 형태와 판정은 여기, IO 는 `db/docs`.

   ## 왜 1회 내보내기로는 안 되나

   이 앱엔 이미 `.ics` 내보내기가 있다. 그런데 **아무도 두 번 안 한다** — 계획은 매일 바뀌고,
   파일은 안 바뀐다. 그래서 캘린더에 들어간 순간부터 그 파일은 *과거의 계획*이고, 며칠이면
   거짓말이 된다(그 사실을 앱은 `planSignature` 로 이미 알고 있었다 — 알면서 재내보내기를
   사람에게 시켰다). 구독은 **캘린더 앱이 주기적으로 다시 가져간다** — 사람의 동작이 0이 된다.

   ## ⚠ 서버가 계획을 계산하지 않는다 — **앱이 만든 결과를 서버가 나른다**

   Worker 에서 `.ics` 를 만들려면 스케줄러를 통째로 서버에 이식해야 하고, 그 순간 계획 규칙이
   **두 벌**이 된다(이 저장소가 `rows.ts` ↔ `rows.rs` 로 두 번 물린 그 형태). 그래서 앱이
   `buildICS()` 로 만든 **문자열을 그대로 싣는다** — 서버는 그 안을 한 번도 안 본다.

   ## ⚠ 새 테이블을 만들지 않는다 — `docs` 한 행이다

   `docs` 는 **D1 까지 이미 동기화되는 유일한 자유 KV** 다(`cloud/contract.DOCS_SPEC`). 그래서
   마이그레이션 0 · 서버 zod 0 · 새 인증 경로 0 이고, Worker 가 는 것은 **공개 GET 하나**다.
   그 대가로 지켜야 하는 계약: 이 값은 **토큰과 본문을 한 행에** 담는다(서버가 한 번 읽어
   토큰을 대조하고 본문을 돌려줄 수 있게).

   ## ⚠ 토큰은 URL 이 곧 열쇠다

   구독 URL 은 캘린더 앱이 **인증 없이** 주기적으로 가져간다(iCalendar 구독의 표준 형태다).
   그래서 열쇠는 경로 안에 있어야 하고, 유일한 방어는 **추측 불가능성**이다 → 128비트 난수.
   ⚠ 그래서 **폐기가 1급 동작**이다: 토큰을 새로 뽑으면 옛 URL 은 그 자리에서 죽는다.
   ⚠ 그리고 담기는 것은 **학습 블록의 제목·시각**뿐이다(성적·오답·메모는 `buildICS` 에 없다).
============================================================ */
import { buildICS, planSignature } from './ics';
import { docGet, docSet } from './db/docs';
import type { AppState } from './types';

/** `docs` 표의 키. ⚠ `DOC_KEYS` 에 **같은 문자열**이 있어야 SQLite·동기화 경로를 탄다. */
export const ICS_DOC_KEY = 'ics:feed';

export interface IcsFeed {
  /** 구독 URL 의 열쇠(hex 32자 = 128비트). */
  token: string;
  /** `buildICS()` 결과 그대로. */
  body: string;
  /** 발행 시각(epoch ms). */
  at: number;
  /** 발행 시점의 `planSignature` — 지금 계획과 다르면 **낡았다**. */
  sig: string;
}

/** 128비트 난수 hex. ⚠ `Math.random` 을 쓰지 않는다 — 이 값이 곧 접근 권한이다. */
export function newToken(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 저장된 피드(없거나 깨졌으면 null). ⚠ 깨진 JSON 을 던지지 않는다 — 설정 화면이 죽는다. */
export function loadIcsFeed(): IcsFeed | null {
  const raw = docGet(ICS_DOC_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<IcsFeed>;
    if (typeof v?.token !== 'string' || typeof v?.body !== 'string' || !v.token) return null;
    return { token: v.token, body: v.body, at: Number(v.at) || 0, sig: String(v.sig ?? '') };
  } catch {
    return null;
  }
}

/**
 * 지금 계획을 발행한다. 토큰은 **있으면 유지**(구독 URL 이 살아 있어야 한다), 없으면 새로 뽑는다.
 *
 * ⚠ `undo: false` — 이건 사용자의 *저작물*이 아니라 기계가 만든 산출물이다. ⌘Z 스택에 넣으면
 * 되돌리기 한 번이 "발행 취소"가 되고, 사용자가 방금 한 편집 대신 그것이 취소된다(`docs.ts`
 * 의 `undo` 기본값이 거짓인 이유가 정확히 이 부류다).
 */
export function publishIcsFeed(state: AppState, opts: { rotate?: boolean } = {}): IcsFeed {
  const prev = loadIcsFeed();
  const feed: IcsFeed = {
    token: !opts.rotate && prev?.token ? prev.token : newToken(),
    body: buildICS(state),
    at: Date.now(),
    sig: planSignature(state),
  };
  docSet(ICS_DOC_KEY, JSON.stringify(feed));
  return feed;
}

/** 구독을 폐기한다 — 빈 값을 써서 서버가 404 를 주게 한다.
 *  ⚠ 키를 **지우지 않는다**: `docs` 엔 툼스톤이 없어(`cloud/contract` 의 ⚠) 삭제가 다른 기기로
 *  전파되지 않는다. 빈 본문·빈 토큰은 그 자체로 전파되는 "없음"이다. */
export function revokeIcsFeed(): void {
  docSet(ICS_DOC_KEY, JSON.stringify({ token: '', body: '', at: Date.now(), sig: '' } satisfies IcsFeed));
}

/** 발행한 뒤 계획이 바뀌었나 — 바뀌었으면 캘린더가 보는 것은 **과거의 계획**이다. */
export function icsFeedStale(feed: IcsFeed | null, state: AppState): boolean {
  return !!feed?.token && feed.sig !== planSignature(state);
}

/**
 * 구독 URL. `origin` 은 클라우드 백엔드 오리진(설정에 저장된 값).
 *
 * ⚠ `webcal://` 을 쓰지 않는다 — 그 스킴은 OS 마다 처리기가 다르고, 실패하면 **아무 일도
 * 안 일어난다**(사용자는 앱이 고장 났다고 읽는다). `https:` URL 은 어디에 붙여 넣어도 동작한다.
 */
export function icsFeedUrl(origin: string, token: string): string {
  /* ⚠ `/\/+$/` 를 쓰지 않는다 — 끝의 반복 수량자는 역추적이 초선형이라 린트가 막는다
     (`syllabusIntake` 의 날짜 정규식과 같은 규칙). 루프가 그 일을 선형으로 한다. */
  let base = origin;
  while (base.endsWith('/')) base = base.slice(0, -1);
  return `${base}/api/ics/${token}.ics`;
}
