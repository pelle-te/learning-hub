/* ============================================================
   useKeymap — 화면 단축키의 **선언 하나**에서 리스너와 치트시트가 함께 파생한다(N-16).

   문제: keydown 이 27파일 85건에 흩어져 어느 화면에 어떤 키가 사는지 앱 자신도 몰랐다.
   그 결과가 두 방향의 거짓말이다 —
   ① `FlowRail` 의 `j/k/Enter/s` 는 **어디에도 문서화되지 않았다**(있는데 아무도 모른다).
   ② 치트시트는 `,`/`.` 를 전역이라 적었지만 실제론 2화면뿐이라 **12개 탭에서 거짓말**을 했다.

   둘 다 "등록"과 "설명"이 서로 다른 곳에 손으로 적혀 있어서 생긴다. 여기선 한 배열이 둘 다 한다:
   리스너를 걸고, 같은 배열을 활성 레지스트리에 올려 치트시트가 **지금 이 화면의 키**를 그린다.

   ⚠ 키캡 바(화면 하단 상시 표시)는 **일부러 안 만들었다** — 스냅샷 전량과 `HudFrame` 높이 계약을
   건드리고 fill 탭에서 22px 을 뺏으며 5원칙(절제)과 충돌한다. 가치의 절반을 비용 1/5 로 가져가는
   쪽(레지스트리 + 치트시트 문맥화)이 더 정직한 첫 안이다(로드맵 N-16).

   ⚠ 리스너는 **버블 단계**다(전역 `g`/`[ ]` 는 캡처 단계라 먼저 본다). 화면 키가 전역을 가로채면
   "어떤 탭에선 `[` 가 안 먹는" 부류가 생기는데, 그건 사용자가 원인을 절대 못 찾는 종류다.
   ⚠ 입력 중(`isTyping`)엔 전부 무시한다 — 단일 문자 키맵의 기본 계약이다.
============================================================ */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { isTyping } from './interactions';

export interface KeyBinding {
  /** 실제 `KeyboardEvent.key` 값들(대소문자 구분 없이 비교). 여러 키가 같은 동작이면 함께 적는다. */
  keys: string[];
  /** 치트시트 표기(`J / K` 처럼 사람이 읽는 형태). 없으면 `keys` 에서 만든다. */
  display?: string;
  /** 무엇을 하는가 — 치트시트 문구. */
  label: string;
  run: () => void;
}

/** 지금 화면에 살아 있는 키맵(스코프 이름 → 바인딩). 치트시트가 이걸 읽는다. */
export interface ActiveKeymap {
  scope: string;
  bindings: { display: string; label: string }[];
}

let active: ActiveKeymap[] = [];
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((l) => l());

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
const snapshot = (): ActiveKeymap[] => active;

/** 치트시트용 — 지금 마운트된 화면 키맵 전부(등록 순). */
export function useActiveKeymaps(): ActiveKeymap[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * **선언만** 한다(리스너 없음) — 이미 자기 핸들러를 가진 화면이 치트시트에 등재되는 경로.
 *
 * 왜 필요한가: `FlowRail` 의 Enter 는 "DOM 포커스가 버튼에 있으면 네이티브 활성에 맡긴다"는
 * 이벤트 타깃 조건을 갖는다 — `useKeymap` 의 `keys→run` 모델로는 표현할 수 없고, 억지로
 * 옮기면 그 가드가 조용히 사라져 **Enter 가 완료 토글 대신 집중 세션을 연다**. 그래서 등록은
 * 그대로 두고 *설명*만 레지스트리로 올린다. N-16 이 고치려던 결함은 "앱이 자기 키를 모른다"
 * 였지, "모든 키를 한 훅으로 재작성한다"가 아니었다.
 *
 * ⚠ 대가는 명시한다: 이 경로는 **선언과 구현이 여전히 두 곳**이라 표류할 수 있다. 그래서
 * 새 키맵은 `useKeymap` 을 쓰고, 여기는 옮길 수 없는 것만 남긴다.
 */
export function useKeymapDoc(scope: string, rows: { display: string; label: string }[], enabled = true): void {
  const shown = JSON.stringify(rows);
  useEffect(() => {
    if (!enabled) return;
    const entry: ActiveKeymap = { scope, bindings: JSON.parse(shown) as { display: string; label: string }[] };
    active = [...active, entry];
    emit();
    return () => {
      active = active.filter((e) => e !== entry);
      emit();
    };
  }, [scope, shown, enabled]);
}

const displayOf = (b: KeyBinding): string =>
  b.display ?? b.keys.map((k) => (k === ' ' ? 'Space' : k.length === 1 ? k.toUpperCase() : k)).join(' / ');

/**
 * 화면 스코프 키맵을 등록한다. `scope` 는 치트시트 섹션 제목("오늘 · 흐름 레일").
 *
 * ⚠ `bindings` 는 렌더마다 새 배열이어도 된다 — 최신 값을 ref 로 동기화하고 리스너는 마운트당
 * 1회만 건다(`useWeekNavKeys` 가 쓰던 관용구). 호출부가 useMemo 를 안 써도 리스너가 떼였다
 * 붙지 않는다는 뜻이고, 그게 이 훅이 27곳으로 퍼질 수 있는 조건이다.
 */
export function useKeymap(scope: string, bindings: KeyBinding[], enabled = true): void {
  const cur = useRef(bindings);
  useEffect(() => {
    cur.current = bindings;
  });

  /* 레지스트리 등록 — 표시 문자열만 올린다(치트시트는 콜백을 볼 이유가 없다).
     ⚠ deps 를 **직렬화된 값**으로 잡는다. 배열 참조로 잡으면 렌더마다 등록/해제가 반복되고,
     그러면 치트시트가 열려 있는 동안 목록이 깜빡인다(그리고 그건 조용한 누수다). */
  const shown = JSON.stringify(bindings.map((b) => [displayOf(b), b.label]));
  useEffect(() => {
    if (!enabled) return;
    const rows = JSON.parse(shown) as [string, string][];
    const entry: ActiveKeymap = { scope, bindings: rows.map(([display, label]) => ({ display, label })) };
    active = [...active, entry];
    emit();
    return () => {
      active = active.filter((e) => e !== entry);
      emit();
    };
  }, [scope, shown, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping()) return;
      const hit = cur.current.find((b) => b.keys.some((k) => k.toLowerCase() === e.key.toLowerCase()));
      if (!hit) return;
      e.preventDefault();
      hit.run();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [enabled]);
}
