/* ============================================================
   prereq.ts — **T-27 선수 관계**(과목 → 선행 과목). 순수 · React 무관.

   ## 왜 생겼나 (2026-08-02 · 발산 5회차 T-27)

   결손은 **시험 때** 발견된다. 그때는 늦다 — 선형대수를 못 하는 채로 회로이론 중간을 보는 일이
   실제로 벌어지고, 앱은 두 과목이 관계있다는 사실 자체를 몰랐다(`Item` 끼리 아무 링크도 없다).
   링크가 하나 생기면 앱은 **개강 전에** 말할 수 있다: "이 과목을 열기 전에 저 과목의 이 챕터가
   비어 있다."

   ## 규율

   1. **한 방향**(후행 → 선행)만 저장한다. 양방향은 갈릴 수 있고, 갈리면 어느 쪽이 정본인지
      말할 수 없다(`Course.itemId` 와 같은 판단). 역방향은 여기서 순회로 답한다 — 과목 수가
      한 자릿수라 비용이 0 이다.
   2. **순환을 저장 시점에 막지 않는다.** 스키마가 거부하면 사용자는 *왜* 거부됐는지 알 방법이
      없다. 대신 읽기가 방문집합으로 끊고, 화면이 순환을 **보여 준다**(`prereqChain.cycle`).
   3. **결손 판정은 챕터 단위다.** 과목 단위("선수 과목을 안 들었다")는 이 사용자에게 이미
      답이 정해져 있어(들었다) 정보가 0 이다. 값은 *들었는데 그 챕터가 비어 있다*에서 나온다.
      ⚠ 그래서 `deferred`(이번 회차에서 뺀 챕터)는 **결손으로 세지 않는다** — 스케줄러에서
      뺐다는 것과 모른다는 것은 다른 사실이다.
============================================================ */
import type { AppState, Chapter, Item } from './types';

/** 이 과목의 선행 과목들(존재하는 것만 · 저장 순서 유지). */
export function prereqsOf(state: Pick<AppState, 'items'>, item: Pick<Item, 'prereqIds'>): Item[] {
  const byId = new Map((state.items || []).map((i) => [i.id, i]));
  return (item.prereqIds || []).map((id) => byId.get(id)).filter((i): i is Item => !!i);
}

/** 이 과목을 선행으로 삼는 과목들(역방향 · 순회). */
export function dependentsOf(state: Pick<AppState, 'items'>, itemId: string): Item[] {
  return (state.items || []).filter((i) => (i.prereqIds || []).includes(itemId));
}

/** 선행 사슬 — 너비 우선. `order` 는 자기 자신을 **뺀** 선행들이고, `cycle` 이면 되돌아온 것이 있다. */
export interface PrereqChain {
  order: Item[];
  cycle: boolean;
}

/**
 * 이 과목의 **모든** 선행(간접 포함). 방문집합으로 순환을 끊는다.
 *
 * ⚠ 순환을 만나면 조용히 멈추지 않고 `cycle: true` 로 **말한다** — 조용히 멈추면 사용자는
 * 선행 하나가 목록에서 빠진 이유를 영원히 모른다(이 저장소가 반복해 물린 "조용한 실패").
 */
export function prereqChain(state: Pick<AppState, 'items'>, itemId: string): PrereqChain {
  const byId = new Map((state.items || []).map((i) => [i.id, i]));
  const seen = new Set<string>([itemId]);
  const order: Item[] = [];
  let cycle = false;
  const queue = [...(byId.get(itemId)?.prereqIds || [])];
  while (queue.length) {
    const id = queue.shift();
    if (!id) continue;
    if (seen.has(id)) {
      cycle = true;
      continue;
    }
    seen.add(id);
    const it = byId.get(id);
    if (!it) continue; // 지워진 과목 — 링크만 남은 상태는 결손이 아니라 잔재다
    order.push(it);
    queue.push(...(it.prereqIds || []));
  }
  return { order, cycle };
}

/** 선행 과목 하나의 결손. `missing` 은 **안 끝났고 미루지도 않은** 챕터들. */
export interface PrereqGap {
  item: Item;
  missing: Chapter[];
  /** 그 과목의 전체 챕터 수 — 화면이 "3/12 비었음"처럼 분모를 말할 수 있게. */
  total: number;
}

/**
 * 선행 결손 — 직접 선행만 본다(간접까지 펴면 신입 과목 하나가 화면 하나를 채운다).
 *
 * ⚠ 챕터가 **0 개인 선행은 결과에서 뺀다.** 챕터를 안 넣은 과목은 "전부 결손"이 아니라
 * *아직 안 적은 것*이고, 그걸 결손으로 부르면 첫 학기 사용자에게 앱이 온통 빨갛게 보인다.
 */
export function prereqGaps(state: Pick<AppState, 'items'>, item: Pick<Item, 'prereqIds'>): PrereqGap[] {
  return prereqsOf(state, item)
    .map((it) => {
      const chapters = it.chapters || [];
      return { item: it, total: chapters.length, missing: chapters.filter((c) => !c.done && !c.deferred) };
    })
    .filter((g) => g.total > 0 && g.missing.length > 0);
}

/** 링크를 세운다(중복·자기참조는 무시). ⚠ 뮤테이터 — immer 초안 위에서 부른다. */
export function addPrereq(item: Item, prereqId: string): void {
  if (prereqId === item.id) return; // 자기 자신은 선행이 아니다 — 여기서 막는 것이 가장 싸다
  const list = (item.prereqIds = item.prereqIds || []);
  if (!list.includes(prereqId)) list.push(prereqId);
}

/** 링크를 지운다. ⚠ 뮤테이터. */
export function removePrereq(item: Item, prereqId: string): void {
  if (!item.prereqIds) return;
  item.prereqIds = item.prereqIds.filter((id) => id !== prereqId);
  if (!item.prereqIds.length) delete item.prereqIds;
}
