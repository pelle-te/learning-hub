/* ============================================================
   simulate.test.ts — **바꾸기 전에 결과를 본다**(I018 · 2026-08-22 발상 축).

   `CutCard` 의 «이만큼 빼면 닫혀요»는 **산술 근사**(`고른 시간 합 ≥ 부족분`)였다. 배치는 합이
   아니므로 그 답은 자주 틀린다. 여기서 잠그는 것 넷:

   ① **입력이 변하지 않는다** — 미리보기가 진짜 데이터를 바꾸면 그건 미리보기가 아니다.
      이 케이스가 이 파일에서 가장 중요하다(복제 범위가 SimPatch 를 늘릴 때마다 낡는다).
   ② **결정적이다** — 같은 입력 두 번이 같은 결과(엔진이 부작용 없이 반복 호출된다 = 이 항목의 전제).
   ③ **실제로 닫는다** — 제안대로 빼면 그 부족분이 사라진다.
   ④ **부수 피해를 잡는다** — 한쪽을 닫으면 다른 쪽이 열릴 수 있고, 산술 근사는 그걸 **원리적으로**
      못 본다.

   ⚠ 예산(⑤)은 상한을 크게 잡는다. 이 케이스가 재려는 것은 «사용자 입력마다 돌려도 되는 규모인가»
   이지 특정 밀리초가 아니다 — 기계 편차를 회귀로 읽으면 그 게이트는 곧 꺼진다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { schedulerState } from './_fixtures';
import { schedule, simulate, shortfallDelta } from '@/lib/scheduler';
import type { AppState, ScheduleItem } from '@/lib/types';

let _id = 0;
const nid = (): string => 'sim' + ++_id;
const chapters = (n: number, hours = 2): { id: string; name: string; hours: number; done: boolean }[] =>
  Array.from({ length: n }, (_, i) => ({ id: nid(), name: 'c' + i, hours, done: false }));

/** 이 파일의 픽스처는 `chapters` 를 **객체 배열**로 든다(`ScheduleItem` 의 선언은 `string[]`).
 *  ⚠ 캐스트를 호출부마다 흩지 말고 여기 한 번만 적는다 — V068 이 타입 검사를 켜자 같은 캐스트가
 *  **세 곳에서 각각 틀린 채로** 드러났다(`as { id }[]` 는 `string[] | undefined` 에서 못 간다). */
type 픽스처과목 = Omit<ScheduleItem, 'chapters'> & { id: string; chapters: { id: string }[] };

function tight(): 픽스처과목 {
  return {
    id: nid(),
    name: '빡센과목',
    mode: 'weekly',
    weeklyHours: 4,
    chapters: chapters(20),
    deadline: '2026-06-30',
  } as unknown as 픽스처과목;
}

const stateOf = (...items: unknown[]): AppState => schedulerState(items as never[]);

describe('simulate — 미리보기가 상태를 건드리지 않는다', () => {
  it('⚠⚠ 입력 state 가 변하지 않는다(챕터의 deferred 가 진짜로 안 찍힌다)', () => {
    const it = tight();
    const st = stateOf(it);
    const ids = new Set([it.chapters[0]!.id]);
    const snapshot = JSON.stringify(st);
    simulate(st, { defer: { sid: it.id, chapterIds: ids } });
    expect(JSON.stringify(st)).toBe(snapshot);
  });

  it('빈 패치는 원본 그대로를 돌린다(불필요한 복제 없음)', () => {
    const st = stateOf(tight());
    expect(simulate(st, {}).shortfalls.length).toBe(schedule(st).shortfalls.length);
    expect(simulate(st, { defer: { sid: 'x', chapterIds: new Set() } }).shortfalls.length).toBe(
      schedule(st).shortfalls.length,
    );
  });

  it('결정적이다 — 엔진이 부작용 없이 반복 호출된다(이 항목의 전제)', () => {
    const it = tight();
    const st = stateOf(it);
    const ids = new Set(it.chapters.slice(0, 5).map((c) => c.id));
    const a = simulate(st, { defer: { sid: it.id, chapterIds: ids } });
    const b = simulate(st, { defer: { sid: it.id, chapterIds: ids } });
    expect(JSON.stringify(a.shortfalls)).toBe(JSON.stringify(b.shortfalls));
  });
});

describe('shortfallDelta — 엔진이 답한다', () => {
  it('⭐ 엔진이 고른 제안대로 빼면 그 부족분이 실제로 닫힌다', () => {
    const it = tight();
    const st = stateOf(it);
    const before = schedule(st).shortfalls;
    const sf = before.find((s) => s.name === '빡센과목')!;
    expect(sf.suggest.length).toBeGreaterThan(0);
    const after = simulate(st, { defer: { sid: sf.sid, chapterIds: new Set(sf.suggest) } }).shortfalls;
    expect(shortfallDelta(before, after, sf).closed).toBe(true);
  });

  it('아무것도 안 빼면 안 닫히고, 남은 부족분을 **엔진이 낸 수**로 돌려준다', () => {
    const it = tight();
    const st = stateOf(it);
    const before = schedule(st).shortfalls;
    const sf = before.find((s) => s.name === '빡센과목')!;
    const d = shortfallDelta(before, before, sf);
    expect(d.closed).toBe(false);
    expect(d.gapH).toBe(sf.gapH);
  });

  it('⚠ 부수 피해 — 전에 없던(또는 더 커진) 부족분만 센다', () => {
    const it = tight();
    const st = stateOf(it);
    const before = schedule(st).shortfalls;
    const sf = before.find((s) => s.name === '빡센과목')!;
    // 같은 목록을 before/after 로 주면 «커진 것»이 하나도 없어야 한다(부동소수 잔차 포함).
    expect(shortfallDelta(before, before, sf).collateral).toEqual([]);
    // 인위적으로 커진 다른 과목 하나를 넣으면 잡힌다.
    const other = { ...sf, sid: 'other', name: '다른과목', examId: 'e2', gapH: sf.gapH + 3 };
    expect(shortfallDelta(before, [...before, other], sf).collateral).toEqual([
      { sid: 'other', name: '다른과목', examLabel: sf.examLabel, addedH: sf.gapH + 3 },
    ]);
  });
});

describe('simulate — 예산', () => {
  it('20회 반복이 사용자 입력마다 돌려도 되는 규모다(상한은 넉넉히)', () => {
    const it = tight();
    const st = stateOf(it);
    const ids = new Set(it.chapters.slice(0, 5).map((c) => c.id));
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) simulate(st, { defer: { sid: it.id, chapterIds: ids } });
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(2000); // 실측은 이보다 두 자릿수 작다 — 여기는 «규모»만 본다
  });
});
