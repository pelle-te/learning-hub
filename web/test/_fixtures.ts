/* ============================================================
   test/_fixtures.ts — **유닛/컴포넌트 테스트의 상태 픽스처 한 벌**(2026-08-20 리뷰 M-13).

   (e2e 픽스처는 `e2e/_fixtures.ts` 가 따로 소유한다 — 그쪽은 localStorage 시드라 형태가 다르다.)

   ## 왜 생겼나

   `baseState` 가 4벌(그중 3벌은 **바이트 동일**), `nid`/`weeklyItem`/`mkChapters` 가 3벌이었다.
   그리고 그 복제가 실해를 냈다 — `today.test.tsx` 가 결정성을 포기하고 **벽시계를 받아들였고**,
   그 대가가 파일 안에 두 번 기록됐다(토요일에 깨졌고, 저녁에 깨졌다).

   ## ⚠⚠ 그 파일이 남긴 결론은 **틀렸다** — 실측이 뒤집는다

   > *"`_today` 를 못박는 우회로는 안 통한다(시도했다): `schedule()` 의 날짜 범위는 실시계에서
   >  오고 `todayISO(state)` 만 시드를 따르므로, 둘이 갈려 오늘이 계획 범위 밖으로 나간다."*

   `lib/scheduler/engine.ts` 에 `new Date()`·`Date.now()` 는 **0건**이고, 날짜 범위는
   `state.startDate` 에서 온다. 갈린 진짜 이유는 `defaults()` 가 `startDate: iso(new Date())` 로
   **실시계를 굽기** 때문이고, 시드가 `_today` 만 못박고 `startDate` 는 안 못박아서였다.
   같은 트리의 두 파일이 이미 그걸 제대로 하고 있었다(`allocBoard.test.tsx` · `dayPlans.test.ts`).

   → **둘을 함께 못박는다.** 그러면 요일·주차·시각 축이 한꺼번에 결정적이 된다.

   ## ⚠ 픽스처는 **실제 스키마로 파싱해서** 만든다

   `allocBoard.test.tsx` 가 그 규율을 적어 뒀고 그 파일 하나에만 있었다 — 지어낸 모양은
   `sanitizeImported`·스케줄러가 조용히 걸러서 "통과하는데 아무것도 안 재는" 테스트가 된다.
============================================================ */
import { ItemSchema } from '@/lib/schema';
import { defaults } from '@/lib/persistence';
import type { AppState, Item } from '@/lib/types';

let _n = 0;
/** 결정적 id — 케이스 사이에 겹치지 않게 단조 증가. */
export const nid = (): string => 'fx' + ++_n;

export interface ChapterSpec {
  name: string;
  hours?: number;
  done?: boolean;
}

/** 챕터 목록 — `[이름, 시간, 완료?]` 튜플도 받는다(옛 `mkChapters` 호출 형태 승계). */
export function chapters(spec: (ChapterSpec | [string, number, boolean?])[]): Item['chapters'] {
  return spec.map((c) => {
    const o = Array.isArray(c) ? { name: c[0], hours: c[1], done: c[2] } : c;
    return { id: nid(), name: o.name, hours: o.hours ?? 3, done: !!o.done };
  });
}

/** 주간 과목. ⚠ `ItemSchema.parse` 를 통과한 모양만 나온다. */
export function weeklyItem(over: Partial<Item> = {}): Item {
  return ItemSchema.parse({
    id: nid(),
    name: '테스트 과목',
    source: '직접',
    mode: 'weekly',
    weeklyHours: 5,
    dailyMin: 30,
    deadline: '',
    chapters: chapters([
      ['1장', 3],
      ['2장', 3],
    ]),
    ...over,
  }) as Item;
}

/** 매일 과목 — 요일·주차와 무관하게 오늘 블록을 보장한다(주간 과목은 주 예산이라 주말에 0일 수 있다). */
export function dailyItem(over: Partial<Item> = {}): Item {
  return ItemSchema.parse({
    id: nid(),
    name: '매일 과목',
    source: '직접',
    mode: 'daily',
    weeklyHours: 0,
    dailyMin: 30,
    deadline: '',
    chapters: [],
    ...over,
  }) as Item;
}

/** 고정 날짜(2026-06-22 월 시작 · 2026-06-23 화가 '오늘'). 요일·주차·시각이 전부 결정적이다. */
export const FIXED_START = '2026-06-22';
export const FIXED_TODAY = '2026-06-23';

/**
 * 앱 상태 픽스처.
 *
 * ⚠⚠ **`startDate` 와 `_today` 를 함께 못박는다** — 하나만 시드하면 계획 창이 실시계로 열려
 * 결정성이 깨진다(위 ⚠⚠). 빈 `routine` 은 하루 종일(1440분) 공부 가능을 뜻해 배치가 단순해진다.
 */
export function appState(over: Partial<AppState> = {}): AppState {
  return {
    ...defaults(),
    startDate: FIXED_START,
    _today: FIXED_TODAY,
    routine: [],
    dayOverrides: {},
    items: [],
    ...over,
  } as AppState;
}

/* ── 스케줄러 계열 픽스처 ─────────────────────────────────────────────────────
   ⚠ 위 `appState()` 와 **다른 물건이다**: 이쪽은 `defaults()` 를 안 편다. 스케줄러 테스트는
   "이 입력만으로 이 배치가 나온다"를 재는데, 기본값 전량을 깔면 그 최소성이 사라지고 어느
   필드가 결과를 만들었는지 읽을 수 없게 된다. 그래서 **최소 상태**를 캐스팅해 준다.

   ⚠⚠ 종전엔 이 함수가 `scheduler`·`weekAlloc`·`ics` 세 파일에 **바이트 동일**로 복제돼 있었다
   (2026-08-20 리뷰 M-13). 세 곳이 같은 날짜 상수를 각자 들고 있었고, 그중 하나만 바뀌면 두
   파일이 다른 주(週)를 재게 된다 — 그 차이는 어느 실패 메시지에도 안 나타난다. */

/** 스케줄러 기준일. 화요일 → 그 주 월요일 = `2026-06-22`(= `schedule()` 의 `firstMon`). */
export const SCHED_START = '2026-06-23';

/** 스케줄러/ICS/배분 테스트의 최소 상태. 빈 `routine` = 하루 종일(1440분) 가용 → 배치가 결정적. */
export function schedulerState(items: unknown[], over?: Record<string, unknown>): AppState {
  return {
    startDate: SCHED_START,
    moduleLen: 120,
    reviewRatio: 20,
    routine: [],
    dayOverrides: {},
    items: items || [],
    ...(over || {}),
  } as unknown as AppState;
}
