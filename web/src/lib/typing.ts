/* ============================================================
   lib/typing.ts — "지금 포커스가 텍스트 입력 안인가"의 한 줄.

   ## 왜 `hooks/` 에서 내려왔나 — **`src/` 유일의 진짜 순환이었다**(2026-08-20 리뷰 m-15)

       hooks/useKeymap.ts  → (isTyping)     → hooks/interactions.ts
       hooks/interactions.ts → (useKeymap)  → hooks/useKeymap.ts

   번들러는 이 모양을 살려 두지만 **모듈 평가 순서에 의존**이 생긴다: 어느 쪽을 먼저 import
   하느냐에 따라 한쪽의 top-level 상수가 TDZ 를 만난다. 지금은 둘 다 함수만 export 해서 안
   터지지만, `interactions.ts` 에 모듈 평가 시점 계산이 하나 생기는 순간 부팅이
   `Cannot access '…' before initialization` 으로 죽는다 — `main.tsx` 의 SD-7 계약이 정확히 그
   부류의 사고였고, 그건 **부팅에서만** 나타나므로 가장 늦게 발견된다.

   ⚠ 고칠 자리가 여기인 이유: `isTyping` 은 두 훅 어디에도 속하지 않는 **순수 DOM 술어**다.
   React 를 모르고 상태도 없다 — 그러면 `lib` 이 그 집이고, 경계상 `hooks → lib` 은 허용이라
   순환이 소멸한다(우회가 아니라 분류 교정이다).

   ⚠ `hooks/interactions.ts` 는 이 이름을 **재수출**한다 — 기존 소비처를 한 줄도 안 건드리기
   위해서다. 새 코드는 `@/lib/typing` 을 직접 물어라.
============================================================ */

/** 포커스가 입력 요소(텍스트 편집)에 있으면 전역 단일키 단축키를 무시 — App·탭 로컬 키가 공유. */
export function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}
