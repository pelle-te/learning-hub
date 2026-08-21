/* ============================================================
   shell/railLayout.ts — **사용자가 조립한 레일**(N-17 · W5 · 발산 6회차).

   ## 왜 필요해졌나

   N-14 가 레일을 평탄화하면서 화면 열넷이 한 목록에 섰다(종전엔 레일 7 + 세그먼트 두 층).
   얻은 것은 크다 — "어느 호스트 밑인가"라는 암기와 2클릭이 함께 사라졌다. 대신 **안 쓰는
   화면이 매일 눈에 들어온다**가 실재하는 비용이 된다.

   이 앱의 종전 답은 **강등**이었다: 개발자가 방문 원장을 보고 자리를 옮긴다. 그 답이 다섯 번
   반복됐고 근거가 매번 같았다(P10 §1-3 — *"학습 상태 소비 0"*). 다섯 번 같은 처방을 냈다는
   것은 그 층에서 푸는 문제가 아니라는 신호다. 여기서는 **사용자가 접는다** — 판단이 필요 없는
   결정을 판단으로 만들지 않는다.

   ## ⚠ 숨김은 도달성 손실이 **아니다**

   ⌘K·`g` 키·딥링크는 그대로다. 레일에서만 접힌다. 그 구분이 `role:'view'`(옛 `retired`) 와 이것을 가른다:
   저긴 **앱의 판정**(이 화면은 다른 곳에 흡수됐다)이고 여긴 **그날의 취향**이다. 그래서 숨김은
   `TABS` 를 건드리지 않고 UI 설정에만 산다 — 로스터는 여전히 앱이 소유한다.

   ## ⚠ 순서는 섹션 **안에서만** 바뀐다

   섹션을 넘나드는 재배치를 허용하면 질문 축(N-16)이 사용자마다 다른 뜻을 갖게 되고, 그러면
   그 축은 아무것도 안 묶는다("무엇을 아는가?" 밑에 설정이 있는 레일은 질문이 아니라 목록이다).
   순서 목록은 **전역 키 배열**이고, 각 섹션이 자기 멤버만 그 순서로 정렬한다.

   ⚠ **빈 섹션은 통째로 사라진다** — 헤더만 남은 질문은 답이 없는 질문이라 노이즈다.
   ⚠ 알 수 없는 키(옛 저장본에 남은 삭제된 탭)는 조용히 무시한다. 설정이 코드보다 오래 산다.
============================================================ */
import type { NavGroup } from './tabs';

export interface RailPrefs {
  /** 레일에서 접을 탭 key. */
  hidden: readonly string[];
  /** 선호 순서(전역 키 배열) — 여기 없는 탭은 선언 순서대로 **뒤에** 붙는다. */
  order: readonly string[];
}

/**
 * 선언된 레일 그룹 + 사용자 취향 → 실제로 그릴 그룹.
 *
 * ⚠ **순수 함수다.** 스토어를 읽지 않는 이유는 이 규칙이 유닛으로 잠기기 때문이다 — 나브가
 * 통째로 비는 사고(전부 숨김)는 화면으로는 "아무 일도 안 일어남"이라 조용하다.
 */
export function railLayout(groups: readonly NavGroup[], prefs: RailPrefs): NavGroup[] {
  const hidden = new Set(prefs.hidden);
  const rank = new Map(prefs.order.map((k, i) => [k, i]));
  const out: NavGroup[] = [];
  for (const g of groups) {
    const tabs = g.tabs
      .filter((t) => !hidden.has(t.key))
      /* ⚠ 선호 순서에 없는 탭은 **뒤로** 간다(`Infinity`) — 앞으로 보내면 새로 추가된 화면이
         사용자가 정한 순서 맨 위에 끼어든다(설정이 코드에 밀리는 형태). */
      .map((t, i) => ({ t, i, r: rank.get(t.key) ?? Number.POSITIVE_INFINITY }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map((x) => x.t);
    if (tabs.length) out.push({ ...g, tabs });
  }
  return out;
}

/**
 * 숨김 토글 — **마지막 하나는 못 숨긴다.**
 *
 * ⚠⚠ 전부 숨기면 레일이 통째로 비고, 그 상태에서 설정으로 돌아갈 길은 ⌘K 뿐이다. 그건
 * "되돌릴 방법이 화면에 없는 상태"이고 이 앱이 미니 모드에서 이미 한 번 물린 부류다(H9).
 * 그래서 마지막 하나는 거절한다 — 조용히 무시하지 않고 **거절했다는 사실을 돌려준다**.
 */
export function toggleRailHidden(
  hidden: readonly string[],
  key: string,
  railKeys: readonly string[],
): { hidden: string[]; ok: boolean } {
  const set = new Set(hidden);
  if (set.has(key)) {
    set.delete(key);
    return { hidden: [...set], ok: true };
  }
  const visible = railKeys.filter((k) => !set.has(k));
  if (visible.length <= 1) return { hidden: [...set], ok: false };
  set.add(key);
  return { hidden: [...set], ok: true };
}

/**
 * 한 칸 위/아래로 — **자기 섹션 안에서만** 움직인다(머리주석 §순서).
 *
 * @param members 그 섹션의 현재 표시 순서(키). 이 목록 밖으로는 못 나간다.
 * @returns 갱신된 **전역** 선호 순서. 바뀐 것이 없으면 입력을 그대로 돌려준다.
 */
export function moveRailTab(order: readonly string[], members: readonly string[], key: string, dir: -1 | 1): string[] {
  const i = members.indexOf(key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= members.length) return [...order];
  const next = [...members];
  next[i] = members[j]!;
  next[j] = key;
  /* 전역 순서에서 이 섹션 멤버들의 자리를 **그 자리 그대로** 새 순서로 갈아 끼운다.
     ⚠ 멤버를 통째로 뒤로 몰면 다른 섹션의 상대 순서가 함께 흔들린다(전역 배열이므로). */
  const rest = order.filter((k) => !members.includes(k));
  return [...rest, ...next];
}
