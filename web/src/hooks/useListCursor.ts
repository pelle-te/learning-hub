/* ============================================================
   useListCursor — **커서 = DOM 포커스 + j/k + 동사키**(W13 · 2026-07-31).

   ## 왜 훅인가
   `FlowRail`(E5)이 이 상태기계를 이미 검증했는데 **23화면 중 2곳**에만 있었다. 나머지는 Tab
   순회다 — 실측: 배치 트레이 3번째 행의 ⤵ 까지 **Tab 14회**(행당 최대 5스톱), 4번째면 19회.
   마우스는 1클릭이다. 그리고 `useKeymap`(리스너 포함) 실사용은 **1곳**뿐이라, N-16 이 목표한
   "선언 하나에서 리스너와 치트시트가 함께 파생"은 사실상 미도달이었다.

   ## ⚠⚠ 어휘를 **7개로 닫는다** — 이 훅의 본체
   `x` 완료 · `e` 편집 · `d` 삭제 · `p` 배치 · `f` 집중 · `v` 볼트 · `u` 되돌리기.
   닫지 않으면 화면마다 자기 키를 만들고, 그러면 "이 화면에서 d 가 뭐였지"가 매번 생긴다 —
   E24(모션 어휘 5마디)가 같은 이유로 같은 처방을 썼다. 새 동작은 **어휘를 늘리는 게 아니라
   기존 동사에 매핑**하거나, 축이 정말 다르면 그때 여기 한 줄을 더한다(그리고 전 화면이 안다).

   ⚠ 어휘를 닫으면 화면마다 "여기 없는 동사"가 생기고, 없는 키를 눌렀을 때의 **침묵**이 Tab
   14회보다 나쁘게 느껴질 수 있다 → 탈출구는 ⌘K 팔레트다(그쪽이 객체에 동사를 붙인다).

   ⚠ `Enter`/`Space` 는 **다루지 않는다.** 포커스한 행이 버튼이면 네이티브 활성이 곧 기본 동작이고,
   가로채면 한 키가 두 뜻을 갖는다(E5 이전의 결함이 정확히 그 형태였다).
   ⚠ 입력 중(INPUT·TEXTAREA·contentEditable)과 수정자 조합에서는 전부 무시한다.
============================================================ */
import { useEffect, useRef, useState } from 'react';
import { reveal } from '@/lib/motion';
import { useKeymapDoc } from './useKeymap';

/** 닫힌 동사 어휘 — **여기가 SSOT**. 키를 늘리려면 이 표를 고치고, 그러면 치트시트가 따라온다. */
export const CURSOR_VERBS = {
  x: '완료',
  e: '편집',
  d: '삭제',
  p: '배치',
  f: '집중',
  v: '볼트',
  u: '되돌리기',
} as const;
export type CursorVerb = keyof typeof CURSOR_VERBS;

export interface ListCursorOptions<T> {
  /** 커서가 도는 항목들 — `key` 가 곧 DOM id 이자 커서 값이다. */
  items: readonly { key: string; item: T }[];
  /** 이 화면이 실제로 구현한 동사만. 없는 키는 조용히 무시된다(있는 척하지 않는다). */
  verbs: Partial<Record<CursorVerb, (item: T) => void>>;
  /** 치트시트 섹션 제목(`?`). 없으면 등재하지 않는다. */
  docTitle?: string;
  /** 훅을 끈다(다른 오버레이가 떠 있을 때 등). */
  enabled?: boolean;
}

export interface ListCursor {
  /** 지금 커서가 선 key(없으면 null). */
  cursor: string | null;
  /** roving tabindex 의 탭 스톱 — 목록 전체가 탭 스톱 **하나**다. */
  tabStop: string | null;
  /** 각 행 요소를 등록하는 ref 콜백 팩토리. */
  register: (key: string) => (el: HTMLElement | null) => void;
  /** 행이 포커스를 받으면 커서를 그리로(포커스가 곧 커서 — 두 벌이 아니다). */
  onItemFocus: (key: string) => void;
}

export function useListCursor<T>({ items, verbs, docTitle, enabled = true }: ListCursorOptions<T>): ListCursor {
  const [cursor, setCursor] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLElement>());

  /* 치트시트 — 이 화면이 **실제로 구현한** 동사만 등재한다. 어휘가 닫혀 있어도 화면마다
     구현 여부가 다르므로, 표를 그대로 베끼면 `?` 가 거짓말을 한다(N-16 이 `,`/`.` 로 물린 부류). */
  useKeymapDoc(
    docTitle || '',
    [
      { display: 'J / K', label: '다음 / 이전' },
      ...(Object.keys(verbs) as CursorVerb[])
        .filter((k) => verbs[k])
        .map((k) => ({ display: k.toUpperCase(), label: CURSOR_VERBS[k] })),
    ],
    !!docTitle && enabled,
  );

  // 핸들러가 읽는 최신 값 — 리스너를 재등록하지 않고 최신 상태·콜백을 보게 하는 통로
  // (`items` 는 매 렌더 새 배열이라 deps 에 넣으면 window keydown 이 매 렌더 제거→재등록된다).
  const ctx = useRef({ items, verbs, cursor, enabled });
  useEffect(() => {
    ctx.current = { items, verbs, cursor, enabled };
  });

  useEffect(() => {
    const move = (key: string): void => {
      setCursor(key);
      const el = refs.current.get(key);
      reveal(el, 'nearest'); // 모션 자제 판정은 `lib/motion` 이 소유한다(H16)
      el?.focus({ preventScroll: true });
    };
    const onKey = (e: KeyboardEvent): void => {
      const { items, verbs, cursor, enabled } = ctx.current;
      if (!enabled || !items.length) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const keys = items.map((n) => n.key);
      const idx = cursor ? keys.indexOf(cursor) : -1;
      if (e.key === 'j') {
        e.preventDefault();
        move(keys[Math.min(keys.length - 1, idx + 1)] ?? keys[0]!);
        return;
      }
      if (e.key === 'k') {
        e.preventDefault();
        move(idx <= 0 ? keys[0]! : keys[idx - 1]!);
        return;
      }
      const low = e.key.toLowerCase();
      if (!(low in CURSOR_VERBS)) return;
      const run = verbs[low as CursorVerb];
      if (!run) return; // 이 화면에 없는 동사 — 조용히 무시(어휘는 닫혀 있고 구현은 화면별이다)
      const hit = items.find((n) => n.key === cursor);
      if (!hit) return;
      e.preventDefault();
      run(hit.item);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // deps 빈 배열이 정직하다 — 핸들러가 참조하는 값은 전부 ctx.current 에서 읽는다(마운트당 1회 등록).
  }, []);

  return {
    cursor,
    /* 커서가 없으면 첫 항목이 탭 스톱을 맡는다 — 들어올 문이 없으면 키 계약이 죽는다(E5). */
    tabStop: cursor ?? items[0]?.key ?? null,
    register: (key: string) => (el: HTMLElement | null) => {
      if (el) refs.current.set(key, el);
      else refs.current.delete(key);
    },
    onItemFocus: setCursor,
  };
}
