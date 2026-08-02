/* ============================================================
   syllabus.ts — **T-17 주차 싱크**(교수 진도 ↔ 교재 챕터). 순수 · React 무관.

   ## 왜 생겼나 (2026-08-02 · 발산 5회차 T-17)

   앱은 챕터를 **내 진도**로만 알았다. 그래서 "지금 수업이 어디인가"와 "내가 어디까지 했나"를
   원리적으로 비교할 수 없었고, 그 어긋남은 **시험 범위 확정의 유일한 입력**인데도 머릿속에만
   있었다. 교수는 교재 순서대로 안 나간다 — 3주차에 5장을 먼저 하고 2장을 나중에 하는 일이
   흔하고, 그럴 때 "1~7장"이라는 시험 범위는 *교재의* 1~7장이 아니다.

   ## 이 파일이 지키는 규율 셋

   1. **주차당 한 점만 찍는다**(누적 끝점). 구간으로 두면 빈 주·중복 주를 사용자가 관리해야
      하고, 그 관리 비용이 정확히 T-1 이 거절한 금도금이다. 한 점이면 입력이 `주차 → 챕터`
      한 쌍이고, 구간은 **연속된 두 점의 차**로 언제든 복원된다.
   2. **주차의 정의를 새로 만들지 않는다.** 1-based 이고 `semesterPhase().week` 와 같은 축이다
      (`lib/semester.ts`). 두 원천이 갈리면 "이번 주"가 화면마다 달라진다.
   3. **판정만 하고 처방하지 않는다.** 이 파일은 `gap` 을 숫자로 돌려줄 뿐, 그것을 경고로 부를지
      기회로 부를지는 화면이 정한다 — 앞서 있는 것도 어긋남이고 그건 나쁜 상태가 아니다.

   ⚠ **빈 주차는 "진도 없음"이 아니라 "기록 없음"이다.** 둘을 합치면 입력을 걸렀을 때 앱이
   "교수가 한 주 쉬었다"고 단정한다 → `taughtThruIdx` 는 **직전에 기록된 주**로 내려가 답한다
   (마지막으로 아는 사실을 유지 · 없으면 `-1` = 모른다).
============================================================ */
import type { Chapter, Item } from './types';

/** 주차 한 점: `week` 주차 끝에 교수가 나간 **마지막 챕터 id**. */
export interface SyllabusMark {
  week: number;
  thru: string;
}

/** 기록된 주차들 — **주차 오름차순 · 중복 주차는 뒤엣것이 이긴다**(마지막 편집이 정본). */
export function syllabusOf(item: Pick<Item, 'syllabus'>): SyllabusMark[] {
  const byWeek = new Map<number, string>();
  for (const m of item.syllabus || []) byWeek.set(m.week, m.thru);
  return [...byWeek.entries()].map(([week, thru]) => ({ week, thru })).sort((a, b) => a.week - b.week);
}

/**
 * `week` 주차 시점에 교수가 나간 마지막 챕터의 **인덱스**. 모르면 -1.
 *
 * ⚠ 그 주에 기록이 없으면 **직전에 기록된 주**로 내려간다(머리주석의 "기록 없음 ≠ 진도 없음").
 * ⚠ 기록된 id 가 챕터 목록에 없으면(챕터를 지운 뒤) 그 점은 **없는 것으로 친다** — 옛 id 하나가
 *   전체 판정을 멈추는 것보다 낫다(`examScopes` 의 폴백과 같은 판단).
 */
export function taughtThruIdx(item: Pick<Item, 'syllabus' | 'chapters'>, week: number): number {
  const all: Chapter[] = item.chapters || [];
  let out = -1;
  for (const m of syllabusOf(item)) {
    if (m.week > week) break;
    const idx = all.findIndex((c) => c.id === m.thru);
    if (idx >= 0) out = idx;
  }
  return out;
}

/** 내 진도의 끝 — **끝난 챕터 중 가장 뒤**의 인덱스(하나도 없으면 -1).
 *
 *  ⚠ "끝난 개수 - 1" 이 아니다. 중간을 건너뛰고 뒤를 먼저 한 경우 개수는 진도의 *위치*를
 *  말하지 못한다(그리고 이 앱은 `deferred` 로 건너뛰기를 1급으로 지원한다). */
export function myThruIdx(item: Pick<Item, 'chapters'>): number {
  const all: Chapter[] = item.chapters || [];
  for (let i = all.length - 1; i >= 0; i -= 1) if (all[i]?.done) return i;
  return -1;
}

/** 어긋남 한 건. `gap > 0` = 수업이 앞선다(내가 뒤처졌다) · `gap < 0` = 내가 앞선다. */
export interface SyncGap {
  /** 교수 진도 끝 인덱스(-1 = 기록 없음). */
  taughtIdx: number;
  /** 내 진도 끝 인덱스(-1 = 시작 안 함). */
  myIdx: number;
  /** `taughtIdx - myIdx`. **양쪽 다 -1 이면 0**(모르는 것을 어긋남이라 부르지 않는다). */
  gap: number;
  /** 판정을 할 수 있는 상태인가 — 교수 진도 기록이 하나라도 있어야 한다. */
  known: boolean;
}

/** 이번 주(또는 지정 주차) 기준 어긋남. `week` 는 `semesterPhase().week`. */
export function syncGap(item: Pick<Item, 'syllabus' | 'chapters'>, week: number): SyncGap {
  const taughtIdx = taughtThruIdx(item, week);
  const myIdx = myThruIdx(item);
  return { taughtIdx, myIdx, gap: taughtIdx < 0 ? 0 : taughtIdx - myIdx, known: taughtIdx >= 0 };
}

/**
 * 시험 범위 제안 — 그 시험 **직전 주차까지** 교수가 나간 마지막 챕터 id. 모르면 null.
 *
 * 이게 T-17 의 값이 실제로 나오는 지점이다: 주차를 적어 두면 시험 범위(`Exam.thru`)를 사람이
 * 기억에서 재구성하지 않아도 된다. ⚠ **제안일 뿐 자동 반영이 아니다** — 범위는 교수가 말하는
 * 것이고 앱은 그 자리에 없었다. 화면은 "이걸로 채울까요?" 를 묻고, 사용자가 누른다.
 */
export function suggestExamThru(item: Pick<Item, 'syllabus' | 'chapters'>, examWeek: number): string | null {
  const idx = taughtThruIdx(item, examWeek);
  return idx >= 0 ? ((item.chapters || [])[idx]?.id ?? null) : null;
}

/** 주차 한 점을 세운다(같은 주차가 있으면 덮어쓴다). ⚠ 뮤테이터 — immer 초안 위에서 부른다. */
export function setSyllabusMark(item: Item, week: number, thru: string): void {
  const list = (item.syllabus = item.syllabus || []);
  const at = list.findIndex((m) => m.week === week);
  if (at >= 0) list[at] = { week, thru };
  else list.push({ week, thru });
  list.sort((a, b) => a.week - b.week);
}

/** 주차 한 점을 지운다. ⚠ 뮤테이터. */
export function clearSyllabusMark(item: Item, week: number): void {
  if (!item.syllabus) return;
  item.syllabus = item.syllabus.filter((m) => m.week !== week);
  if (!item.syllabus.length) delete item.syllabus;
}
