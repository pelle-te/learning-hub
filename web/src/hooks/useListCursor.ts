/* ============================================================
   useListCursor — **커서 = DOM 포커스 + j/k + 동사키**(W13 · 2026-07-31).

   ## 왜 훅인가
   `FlowRail`(E5)이 이 상태기계를 이미 검증했는데 **23화면 중 2곳**에만 있었다. 나머지는 Tab
   순회다 — 실측: 배치 트레이 3번째 행의 ⤵ 까지 **Tab 14회**(행당 최대 5스톱), 4번째면 19회.
   마우스는 1클릭이다. 그리고 `useKeymap`(리스너 포함) 실사용은 **1곳**뿐이라, N-16 이 목표한
   "선언 하나에서 리스너와 치트시트가 함께 파생"은 사실상 미도달이었다.

   ## ⚠⚠ 어휘를 **여덟 개로 닫는다** — 이 훅의 본체
   `x` 완료 · `e` 편집 · `d` 삭제 · `p` 배치 · `f` 집중 · `v` 볼트 · `u` 되돌리기 · **`m` 표시**.
   닫지 않으면 화면마다 자기 키를 만들고, 그러면 "이 화면에서 d 가 뭐였지"가 매번 생긴다 —
   E24(모션 어휘 5마디)가 같은 이유로 같은 처방을 썼다. 새 동작은 **어휘를 늘리는 게 아니라
   기존 동사에 매핑**하거나, 축이 정말 다르면 그때 여기 한 줄을 더한다(그리고 전 화면이 안다).

   ⚠ 어휘를 닫으면 화면마다 "여기 없는 동사"가 생기고, 없는 키를 눌렀을 때의 **침묵**이 Tab
   14회보다 나쁘게 느껴질 수 있다 → 탈출구는 ⌘K 팔레트다(그쪽이 객체에 동사를 붙인다).

   ⚠ `Enter`/`Space` 는 **다루지 않는다.** 포커스한 행이 버튼이면 네이티브 활성이 곧 기본 동작이고,
   가로채면 한 키가 두 뜻을 갖는다(E5 이전의 결함이 정확히 그 형태였다).
   ⚠ 입력 중(INPUT·TEXTAREA·contentEditable)과 수정자 조합에서는 전부 무시한다.

   ## ⚠⚠ 소유권 — 한 화면에 목록이 둘이면 누가 키를 갖나 (H12 · 2026-08-01)

   리스너가 `window` 라 **마운트된 모든 목록이 같은 키를 동시에 받았다.** `/journal` 은 목록이
   둘(`BacklogCard`·`JournalStream`)이라 `j` 한 번에 **하이라이트가 두 줄**에 뜨고, 이어서 `d` 를
   누르면 **보이는 포커스와 다른 목록**의 행이 지워졌다 — 파괴적 동사가 오조준된다.
   같은 뿌리에서 더 나쁜 것: 확인창·치트시트가 떠 있어도(포커스는 그 안에 갇혀 있는데) 뒤의
   목록이 `d` 를 받았다.

   규칙은 **포커스가 정한다** — 세 줄로 닫힌다:
     ① 등록된 내 행 중 하나가 `document.activeElement` 를 품고 있으면 **내 것이다.**
     ② 아니고 포커스가 *어딘가에는* 있으면(다이얼로그·다른 목록·버튼) **내 것이 아니다.**
     ③ 포커스가 아무 데도 없고(`body`) **화면에 목록이 나 하나뿐이면** 내 것이다.
        (여기서 "첫 마운트 우선" 같은 임의 규칙을 두지 않는 이유: 둘 중 누구를 골라도 사용자가
         보는 근거가 없다. 모르면 아무도 안 받고, Tab·클릭 한 번이 소유자를 정한다.)
   ③ 이 필요한 이유는 단일 목록 화면의 **들어오는 문**이다 — 포커스 없이 `j` 를 눌러 시작하는
   동작을 잃으면 이 훅의 값 대부분이 사라진다(E5 가 세운 계약).

   ⚠ 포커스가 내 행을 떠나면 **커서를 지운다.** 안 그러면 다른 목록으로 옮겨간 뒤에도 옛
   하이라이트가 남아 "지금 무엇이 선택돼 있나"를 화면이 두 군데로 답한다.
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

/* ── A-12 **여덟째 키 `m`(표시) — 동사가 전체에 걸린다**(W9 · 2026-08-07) ────────────
   이 저장소에 **다중 선택 코드가 0건**이었다. 그래서 챕터 일곱 개를 끝내려면 `j x` 를 일곱 번
   (25 키스트로크) 치고, 그 대가로 **토스트 일곱 장과 ⌘Z 일곱 번**이 남는다 — 한 번의 결정이
   일곱 개의 되돌림으로 쪼개지는 것이 이 결함의 실제 형태다(사용자는 "그 일곱 개"를 한 덩어리로
   기억하는데 앱은 그렇게 저장하지 않는다).

   ⚠ **`m` 은 동사가 아니라 범위다.** 위 일곱은 *무엇을 하나*이고 이건 *무엇에게 하나*다. 그래서
   `CURSOR_VERBS` 에 안 넣는다 — 넣으면 화면마다 "`m` 을 구현했나"를 정해야 하는데, 표시는 어느
   목록에서나 같은 뜻이라 화면의 선택지가 아니다(치트시트에는 `bulk` 를 준 화면에만 뜬다).
   ⚠ **표시가 있으면 동사는 표시 전체에**, 없으면 커서 하나에. 두 모드를 화면이 고르지 않는다.
   ⚠ 실행 뒤 표시는 **지운다** — 남겨 두면 다음 동사가 방금 처리한 것들에 또 걸린다. */
export const MARK_KEY = 'm';

export interface ListCursorOptions<T> {
  /** 커서가 도는 항목들 — `key` 가 곧 DOM id 이자 커서 값이다. */
  items: readonly { key: string; item: T }[];
  /** 이 화면이 실제로 구현한 동사만. 없는 키는 조용히 무시된다(있는 척하지 않는다). */
  verbs: Partial<Record<CursorVerb, (item: T) => void>>;
  /**
   * **A-12** — 표시된 여럿에 한 번에 거는 판. 준 동사만 일괄이 된다.
   *
   * ⚠ 개별 동사를 반복 호출하지 **않는다**: 그러면 토스트 N장·⌘Z N번이라는 이 항목의 결함이
   * 그대로 남는다. 일괄은 **한 번의 `mutate`** 여야 하고, 그건 호출부만 할 수 있다.
   * ⚠ 안 준 동사는 표시가 있어도 **커서 하나**에만 걸린다(있는 척하지 않는다 · 위 규율).
   */
  bulk?: Partial<Record<CursorVerb, (items: T[]) => void>>;
  /** 치트시트 섹션 제목(`?`). 없으면 등재하지 않는다. */
  docTitle?: string;
  /** 훅을 끈다(다른 오버레이가 떠 있을 때 등). */
  enabled?: boolean;
}

export interface ListCursor {
  /** 지금 커서가 선 key(없으면 null). */
  cursor: string | null;
  /** **A-12** — 표시된 key 들. 화면이 행에 표식을 그린다(빈 집합이면 단일 모드). */
  marked: ReadonlySet<string>;
  /** roving tabindex 의 탭 스톱 — 목록 전체가 탭 스톱 **하나**다. */
  tabStop: string | null;
  /** 각 행 요소를 등록하는 ref 콜백 팩토리. */
  register: (key: string) => (el: HTMLElement | null) => void;
  /** 행이 포커스를 받으면 커서를 그리로(포커스가 곧 커서 — 두 벌이 아니다). */
  onItemFocus: (key: string) => void;
}

/** 지금 화면에 살아 있는(그리고 켜져 있는) 커서 목록 — 위 규칙 ③의 "나 하나뿐인가"를 센다. */
const MOUNTED = new Set<object>();

export function useListCursor<T>({ items, verbs, bulk, docTitle, enabled = true }: ListCursorOptions<T>): ListCursor {
  const [cursor, setCursor] = useState<string | null>(null);
  const [marked, setMarked] = useState<ReadonlySet<string>>(() => new Set());
  const refs = useRef(new Map<string, HTMLElement>());
  const id = useRef({});

  /* 등록/해제는 `enabled` 를 따른다 — 꺼진 목록이 정원을 차지하면 켜진 단일 목록이 규칙 ③을
     못 쓰게 된다(= 화면에 목록이 하나뿐인데 키가 안 먹는다). */
  useEffect(() => {
    if (!enabled) return;
    const key = id.current;
    MOUNTED.add(key);
    return () => {
      MOUNTED.delete(key);
    };
  }, [enabled]);

  /* 치트시트 — 이 화면이 **실제로 구현한** 동사만 등재한다. 어휘가 닫혀 있어도 화면마다
     구현 여부가 다르므로, 표를 그대로 베끼면 `?` 가 거짓말을 한다(N-16 이 `,`/`.` 로 물린 부류). */
  useKeymapDoc(
    docTitle || '',
    [
      { display: 'J / K', label: '다음 / 이전' },
      // A-12 — 일괄을 실제로 받는 화면에서만 `m` 을 광고한다(치트시트가 거짓말하지 않게).
      ...(bulk && Object.keys(bulk).length ? [{ display: 'M', label: '표시 — 동사가 표시 전체에' }] : []),
      ...(Object.keys(verbs) as CursorVerb[])
        .filter((k) => verbs[k])
        .map((k) => ({ display: k.toUpperCase(), label: CURSOR_VERBS[k] })),
    ],
    !!docTitle && enabled,
  );

  // 핸들러가 읽는 최신 값 — 리스너를 재등록하지 않고 최신 상태·콜백을 보게 하는 통로
  // (`items` 는 매 렌더 새 배열이라 deps 에 넣으면 window keydown 이 매 렌더 제거→재등록된다).
  const ctx = useRef({ items, verbs, bulk, cursor, enabled, marked });
  useEffect(() => {
    ctx.current = { items, verbs, bulk, cursor, enabled, marked };
  });

  useEffect(() => {
    const move = (key: string): void => {
      setCursor(key);
      const el = refs.current.get(key);
      reveal(el, 'nearest'); // 모션 자제 판정은 `lib/motion` 이 소유한다(H16)
      el?.focus({ preventScroll: true });
    };
    /** 등록된 행 중 하나가 지금 포커스를 품고 있나(= 규칙 ①). */
    const ownsFocus = (): boolean => {
      const ae = document.activeElement;
      if (!ae) return false;
      for (const el of refs.current.values()) if (el.contains(ae)) return true;
      return false;
    };
    /** 이 목록이 지금 키를 받아야 하나 — 머리주석의 규칙 ①②③. */
    const mine = (): boolean => {
      if (ownsFocus()) return true; // ①
      const ae = document.activeElement;
      if (ae && ae !== document.body) return false; // ② 포커스가 다른 곳(다이얼로그·다른 목록)에 있다
      return MOUNTED.size <= 1; // ③ 포커스가 없고 목록이 나 하나뿐일 때만
    };
    const onKey = (e: KeyboardEvent): void => {
      const { items, verbs, bulk, cursor, enabled, marked } = ctx.current;
      if (!enabled || !items.length) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!mine()) return;
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
      /* A-12 — 표시 토글. 커서가 없으면 표시할 대상도 없다(그때는 조용히 무시 — `j` 가 문이다). */
      if (low === MARK_KEY) {
        if (!bulk || !cursor) return;
        e.preventDefault();
        setMarked((prev) => {
          const next = new Set(prev);
          if (next.has(cursor)) next.delete(cursor);
          else next.add(cursor);
          return next;
        });
        return;
      }
      if (!(low in CURSOR_VERBS)) return;
      const verb = low as CursorVerb;
      /* 표시가 있으면 **표시 전체**에 건다 — 단, 그 동사의 일괄 판을 준 화면에서만.
         (안 준 동사는 커서 하나에 걸린다 · 위 ⚠) */
      const many = marked.size ? items.filter((n) => marked.has(n.key)) : [];
      const runMany = many.length ? bulk?.[verb] : undefined;
      if (runMany) {
        e.preventDefault();
        runMany(many.map((n) => n.item));
        setMarked(new Set()); // 실행하면 표시는 비운다(다음 동사가 또 걸리지 않게)
        return;
      }
      const run = verbs[verb];
      if (!run) return; // 이 화면에 없는 동사 — 조용히 무시(어휘는 닫혀 있고 구현은 화면별이다)
      const hit = items.find((n) => n.key === cursor);
      if (!hit) return;
      e.preventDefault();
      run(hit.item);
    };
    /* 포커스가 내 행을 떠나면 커서를 지운다 — 두 목록이 동시에 하이라이트되던 것의 절반이 이것이다.
       ⚠ `document.body` 로 빠지는 경우(행이 사라져 포커스가 풀림)는 **안 지운다**: 그건 사용자가
       다른 곳으로 간 것이 아니라 DOM 이 바뀐 것이고, 지우면 목록이 갱신될 때마다 커서를 잃는다. */
    const onFocusIn = (): void => {
      const ae = document.activeElement;
      if (!ae || ae === document.body) return;
      if (!ownsFocus()) setCursor(null);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocusIn);
    };
    // deps 빈 배열이 정직하다 — 핸들러가 참조하는 값은 전부 ctx.current 에서 읽는다(마운트당 1회 등록).
  }, []);

  return {
    cursor,
    marked,
    /* 커서가 없으면 첫 항목이 탭 스톱을 맡는다 — 들어올 문이 없으면 키 계약이 죽는다(E5). */
    tabStop: cursor ?? items[0]?.key ?? null,
    register: (key: string) => (el: HTMLElement | null) => {
      if (el) refs.current.set(key, el);
      else refs.current.delete(key);
    },
    onItemFocus: setCursor,
  };
}
