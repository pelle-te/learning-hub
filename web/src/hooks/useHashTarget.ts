/* ============================================================
   useHashTarget — `#ch-<id>` 같은 **프래그먼트 착지**를 실제로 일어나게 한다(U011 · 2026-08-21).

   ## 왜 생겼나

   `lib/contentSearch.ts` 는 챕터 히트의 목적지를 `/subject/:id#ch-<cid>` 로 만들고,
   `ChapterEditor` 는 그 행에 `id={`ch-${c.id}`}` 를 붙였고, `Subject.tsx` 머리주석은
   *"⌘K 의 챕터 히트가 처음으로 **자기 자리**에 착지한다"* 라고 적었다. 그런데 실측하면
   **저장소 전체에서 `.hash` 를 읽는 코드가 0** 이었다 — 즉 세 조각이 다 있는데 그것을
   **잇는 코드가 없어서** 약속된 착지는 한 번도 일어난 적이 없다(리포트 §R3 의 형태:
   주석이 의도를 적고, 그 주석이 그 사실의 유일한 기록이 된다).

   ⚠ **브라우저의 기본 앵커 스크롤에 기댈 수 없다.** ① SPA 안의 `navigate()` 는 문서 로드가
   아니라 history 조작이라 브라우저가 프래그먼트를 처리하지 않는다. ② 챕터 표는
   `<details open={chs.length === 0}>` 안이라 챕터가 있으면 **접혀 있다** — 접힌 채로는
   스크롤도 포커스도 대상에게 닿지 않는다. 그래서 조상 `<details>` 를 먼저 연다.

   ⚠ 포커스까지 옮기는 것이 요점이다. 스크롤만 하면 키보드 사용자는 여전히 문서 맨 위에
   서 있고, 그건 "데려다준다"의 반쪽이다(D-4 가 콜드 게이트에서 세운 원칙과 같은 논거).
   대상이 포커스를 못 받는 요소일 수 있으므로 `tabIndex` 가 없으면 잠시 `-1` 을 준다.
============================================================ */
import { useEffect } from 'react';

/**
 * 현재 URL 프래그먼트가 가리키는 요소로 데려간다.
 *
 * @param hash `useLocation().hash`(`#` 포함). 빈 문자열이면 아무것도 하지 않는다.
 * @param 렌더키 대상이 렌더된 뒤여야 하므로, 그 렌더를 좌우하는 값을 **한 문자열로 접어** 넘긴다
 *   (예: `` `${과목id}:${챕터수}` ``). 값이 바뀌면 다시 시도한다.
 *
 * ⚠ 배열(`deps`)이 아니라 문자열인 이유: 가변 길이 의존성 배열은 `exhaustive-deps` 를 끄게
 *   만들고, **그 억제가 곧 React Compiler 바일아웃**이다(`scripts/compiler-ratchet.mjs` 가 잡는다).
 *   호출부가 키를 접으면 의존성이 정적이라 억제가 필요 없다.
 */
export function useHashTarget(hash: string, 렌더키: string = ''): void {
  useEffect(() => {
    const raw = hash.replace(/^#/, '');
    if (!raw) return;
    /* ⚠ 주소의 프래그먼트는 **퍼센트 인코딩**돼 있다(`#weak-m%7C%EA%B7%B9%ED%95%9C`). 그대로
         `getElementById` 에 넣으면 못 찾는다 — 디코드한 것을 먼저 보고, 실패하면 원문으로 한 번 더
         본다(디코드가 못 하는 문자열도 유효한 id 일 수 있다). */
    let id = raw;
    try {
      id = decodeURIComponent(raw);
    } catch {
      /* 잘못된 인코딩 — 원문 그대로 쓴다 */
    }
    const el = document.getElementById(id) ?? document.getElementById(raw);
    if (!el) return;

    // 접힌 조상을 전부 편다 — 접힌 `<details>` 안의 요소는 스크롤·포커스가 닿지 않는다.
    for (let p = el.parentElement; p; p = p.parentElement)
      if (p instanceof HTMLDetailsElement && !p.open) p.open = true;

    el.scrollIntoView({ block: 'center', behavior: 'auto' });
    /* 임시 `tabIndex` 는 **되돌린다** — 남기면 그 행이 영구 탭 스톱이 되어
         `useListCursor` 가 세운 "행 하나가 탭 스톱 하나" 계약과 어긋난다. */
    const 임시 = !el.hasAttribute('tabindex');
    if (임시) el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
    if (임시) el.removeAttribute('tabindex');
  }, [hash, 렌더키]);
}
