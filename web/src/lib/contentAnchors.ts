/* ============================================================
   contentAnchors.ts — **⌘K 내용 검색 히트의 목적지 한 곳**(C048 · 2026-08-22 코드 축 1회차).

   ## 무엇이 틀렸었나

   `contentSearch.ts` 안에서 목적지가 **다섯 자리 · 네 관용구**로 조립되고 있었다:
   지역 화살표 헬퍼(`itemAnchor` — 함수 안이라 밖에서 재사용도 안 됐다) · 헬퍼+템플릿 ·
   생 리터럴(`'/day'`) · `+` 연결(`'/mistakes?sid=' + …`). 그리고 그중 셋은 로스터
   (`shell/tabs.ts`)와 **연결이 0**이었다.

   이 저장소는 실제로 탭 키를 갈아 왔다(`journal`→`day` · `graph` 은퇴 · `guide` 삭제 후 부활).
   `'/day'`·`'/review'`·`'/mistakes'` 가 개명되면 셋은 **컴파일도 린트도 불변식도 통과한 채**
   남고, `App.tsx` 의 `<Route path="*" element={<Navigate to="/today"/>}/>` 가 ⌘K 히트를 전부
   오늘 화면으로 착지시킨다 — 사용자에겐 *"⌘K 가 엉뚱한 데로 간다"* 이고, 불변식 ⑱은 `?view=`
   만 보므로 사각이다.

   ## ⚠ 왜 로스터를 직접 import 하지 않나 — 레이어가 그것을 막는다

   리포트의 처방은 *"탭 경로를 로스터에서 읽는다(`TabKey` 유니온이면 개명이 타입 에러가 된다)"*
   였는데, `lib → lib` 만 허용이라(`eslint.config.js` boundaries) `lib` 에서 `shell/tabs` 를
   부를 수 없다. **그 경계는 옳다** — 순수 규칙이 셸을 끌면 폰 번들과 테스트가 함께 무거워진다.

   그래서 같은 보장을 두 조각으로 나눴다:
   ① 여기 — 목적지가 **한 관용구 · 한 자리**다. 고칠 곳이 하나다.
   ② 짝 — `test/invariants.test.ts` 불변식 ㉒ 가 이 표의 경로를 **로스터와 대조**한다.
      테스트는 레이어 밖이라 둘 다 볼 수 있다. 개명은 거기서 빨간불이 된다.
============================================================ */

const enc = encodeURIComponent;

/**
 * ⌘K 내용 검색이 만드는 목적지 전량. **여기 없는 경로를 히트가 직접 짓지 않는다.**
 *
 * ⚠ 탭 경로(`/day`·`/review`·`/mistakes`)는 로스터의 키에서 온 것이고 불변식 ㉒ 가 그 대응을
 * 잰다 — 이 문자열들을 손으로 고치면 거기서 잡힌다.
 */
export const CONTENT_ANCHORS = {
  /** 과목 카드. ⚠ 객체가 자기 URL 을 갖는다(W12) — 목록+하이라이트 우회로가 아니다. */
  subject: (id: string): string => `/subject/${enc(id)}`,
  /** 챕터 — 과목 안에서 **자기 자리에** 선다(W12). */
  chapter: (id: string, chapterId: string): string => `/subject/${enc(id)}#ch-${enc(chapterId)}`,
  /** 열린 보충 — 하루 화면. 행 앵커가 아직 없다(있으면 여기에 붙인다). */
  backlog: (): string => '/day',
  /** 반복 약점 — **행 앵커**로 간다(U027). `?sid=` 가 아닌 이유는 `contentSearch` 의 그 자리 ⚠ 참조. */
  weak: (key: string): string => `/review#weak-${enc(key)}`,
  /** 오답 메모 — 과목까지 좁혀 보낸다(조인 키가 과목 id 라 실패가 원리적으로 없다). */
  mistake: (sid: string): string => `/mistakes?sid=${enc(sid)}`,
} as const;

/** 불변식 ㉒ 가 로스터와 대조하는 **탭 키 → 이 표가 쓰는 경로**. 손 목록인 것이 이 표의 유지 비용 전부다. */
export const ANCHOR_TAB_ROUTES: Readonly<Record<string, string>> = {
  day: '/day',
  review: '/review',
  mistakes: '/mistakes',
  subject: '/subject/:id',
};
