/* ============================================================
   useCommitOnChange — **값이 바뀐 자리에서 번쩍인다**(E15 · 2026-07-30).

   ## 로드맵이 남긴 설계 판단을 여기서 닫는다

   E15 는 열린 질문을 하나 달고 Later 에 있었다:

   > `commit()` 을 뮤테이션 훅에 기본 내장하면 훅이 DOM 참조를 모른다 → 대안은 값 표시 컴포넌트가
   > 자기 값 변화를 감지해 스스로 번쩍이는 것(`useCommitOnChange(value)`). **설계 판단 선행.**

   **후자를 택했다.** 근거는 셋이다:

   1. **소유권이 맞다.** "무엇이 바뀌었나"를 아는 것은 뮤테이션이지만, "그 값이 화면의 *어디*
      있나"를 아는 것은 표시 컴포넌트뿐이다. 뮤테이션에 DOM 을 알리면 store 가 화면 배치를 알게
      되고, 그건 이 저장소의 레이어 규율(`store` 는 `components` 를 모른다)을 정면으로 깬다.
   2. **경로가 하나로 모인다.** 같은 값을 바꾸는 입구가 여럿이다(⌘K · 키보드 · 클릭 · 폰 ·
      **클라우드 pull**). 뮤테이션마다 붙이면 입구 수만큼 붙여야 하고 하나 빠지면 조용히 안 번쩍인다.
      값을 보는 쪽에 붙이면 **입구가 몇 개든 한 번** 붙는다 — 심지어 다른 기기의 편집이 pull 로
      들어와도 번쩍인다(그건 사용자에게 특히 알 값이 있는 사건이다).
   3. **되돌리기가 쉽다.** 훅을 지우면 원상복구다(뮤테이션 내장은 호출부 전량을 되짚어야 한다).

   ⚠ **첫 렌더에는 번쩍이지 않는다.** 마운트는 "바뀐 것"이 아니라 "처음 존재하게 된 것"이고,
     그건 `enter` 어휘의 일이다(`lib/motion.ts` 머리주석). 이걸 구분하지 않으면 탭을 열 때마다
     화면의 모든 숫자가 번쩍여서 `commit` 이 아무 뜻도 없어진다.
   ⚠ 모션 자제·`animate` 부재 환경의 가드는 `commit()` 안에 이미 있다(WAAPI 는 CSS 백스톱이
     안 닿아서 그 파일 하나에 판정을 모아 둔 것) — 여기서 다시 판정하지 않는다.
============================================================ */
import { useEffect, useRef } from 'react';
import { commit } from '@/lib/motion';

/**
 * `value` 가 바뀌면 반환된 ref 의 요소에서 `commit` 을 1회 번쩍인다.
 *
 * @param value 감시할 값. **원시값이거나 안정된 문자열**이어야 한다 — 객체·배열을 넘기면 참조가
 *   매 렌더 달라져 매 렌더 번쩍인다(그건 `live` 가 되고, 무한 애니는 `live` 어휘만 허용된다).
 *   여러 값을 보려면 `` `${a}/${b}` `` 처럼 **직렬화해서** 넘긴다.
 * @param color 계산된 액센트색. 생략하면 그 요소에서 `--acc` 를 푼다(과목색 자리는 그 색을 준다).
 *
 * @example
 * const ref = useCommitOnChange(doneCount);
 * return <span ref={ref}>{doneCount}</span>;
 */
export function useCommitOnChange<T extends string | number | boolean | null | undefined>(
  value: T,
  color?: string,
): React.RefObject<HTMLElement | null> {
  const ref = useRef<HTMLElement | null>(null);
  const prev = useRef<T | typeof FIRST>(FIRST);
  useEffect(() => {
    const was = prev.current;
    prev.current = value;
    if (was === FIRST || was === value) return; // 마운트는 enter 의 일 · 무변화는 아무 일도 아니다
    commit(ref.current, color);
  }, [value, color]);
  return ref;
}

/** "아직 아무 값도 못 봤다" 를 `undefined`·`null` 과 구별하는 센티널 —
 *  둘 다 정당한 값이라 그것으로 마운트를 표현하면 `null → undefined` 전이를 놓친다. */
const FIRST = Symbol('first-render');
