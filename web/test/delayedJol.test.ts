/* ============================================================
   delayedJol.test.ts — T-9 지연 JOL.

   ⚠ 여기서 특히 잠그는 것 다섯:
   - **지연이 없으면 안 묻는다**(`MIN_DELAY_DAYS`). 0 이면 즉시 JOL 이고 그건 이미 있다.
   - **하루 한 문항** · **미해소가 있으면 새로 안 묻는다**. 대답 없는 질문을 늘리는 것이
     이 항목이 피하려던 소음이다.
   - **해소는 예측일 *이후* 첫 인출**이다. 같은 날을 세면 "풀기 직전에 예측"과 구분되지 않는다.
   - **표본 미달이면 정확도가 `null`** — 3개로 "과신 경향"을 말하면 거짓이다.
   - **해소를 저장하지 않는다** → 인출 기록이 사라지면 예측은 자동으로 미해소로 돌아간다.
============================================================ */
import { describe, expect, it } from 'vitest';
import {
  MIN_DELAY_DAYS,
  MIN_SAMPLES,
  askToday,
  jolAccuracy,
  pendingAsks,
  recordAsk,
  resolveAsk,
} from '@/lib/delayedJol';
import type { JolAsk } from '@/lib/types';
import type { AppState } from '@/lib/schema';

const br = (sid: string, chapter: string, ds: string, passed: boolean) =>
  ({ id: `${sid}-${chapter}-${ds}`, ds, sid, name: sid, passed, note: '', chapter }) as never;
const ask = (over: Partial<JolAsk> = {}): JolAsk =>
  ({ id: 'a', ds: '2026-08-01', sid: 's', chapter: 'c1', predicted: true, ...over }) as JolAsk;

const st = (o: Partial<AppState>): AppState =>
  ({ items: [], blankResults: [], jolAsks: [], reviewTouches: {}, ...o }) as never;

describe('askToday', () => {
  it('마지막 인출이 가장 오래된 챕터를 고른다', () => {
    const s = st({
      reviewTouches: { 's|c1': '2026-07-30', 's|c2': '2026-07-20' },
    });
    expect(askToday(s, '2026-08-02')).toMatchObject({ chapter: 'c2' });
  });
  it('지연이 모자라면 안 묻는다 — 그러면 즉시 JOL 이다', () => {
    const near = `2026-08-0${2 - MIN_DELAY_DAYS + 1}`;
    expect(askToday(st({ reviewTouches: { 's|c1': near } }), '2026-08-02')).toBeNull();
  });
  it('오늘 이미 물었으면 안 묻는다(하루 한 문항)', () => {
    const s = st({
      reviewTouches: { 's|c1': '2026-07-20' },
      jolAsks: [ask({ ds: '2026-08-02' })],
      blankResults: [br('s', 'c1', '2026-08-03', true)], // 해소돼 있어도 오늘 몫은 썼다
    });
    expect(askToday(s, '2026-08-02')).toBeNull();
  });
  it('미해소 예측이 남아 있으면 새로 안 묻는다', () => {
    const s = st({ reviewTouches: { 's|c2': '2026-07-20' }, jolAsks: [ask()] });
    expect(askToday(s, '2026-08-02')).toBeNull();
  });
  it('인출 이력이 없으면 물을 것이 없다', () => {
    expect(askToday(st({}), '2026-08-02')).toBeNull();
  });
});

describe('resolveAsk', () => {
  it('예측일 이후 첫 인출로 해소한다', () => {
    const s = st({ blankResults: [br('s', 'c1', '2026-08-05', false), br('s', 'c1', '2026-08-03', true)] });
    expect(resolveAsk(s, ask())).toMatchObject({ recalled: true, resolvedDs: '2026-08-03' });
  });
  it('같은 날 인출은 안 센다 — 그건 "풀기 직전 예측"이다', () => {
    const s = st({ blankResults: [br('s', 'c1', '2026-08-01', true)] });
    expect(resolveAsk(s, ask())).toBeNull();
  });
  it('다른 챕터의 인출로는 해소되지 않는다', () => {
    const s = st({ blankResults: [br('s', 'c2', '2026-08-03', true)] });
    expect(resolveAsk(s, ask())).toBeNull();
  });
  it('인출 기록이 사라지면 다시 미해소가 된다 — 해소를 저장하지 않는 값', () => {
    const withRec = st({ jolAsks: [ask()], blankResults: [br('s', 'c1', '2026-08-03', true)] });
    expect(pendingAsks(withRec)).toEqual([]);
    const without = st({ jolAsks: [ask()], blankResults: [] });
    expect(pendingAsks(without)).toHaveLength(1);
  });
});

describe('jolAccuracy', () => {
  const many = (n: number, predicted: boolean, passed: boolean) =>
    st({
      jolAsks: Array.from({ length: n }, (_, i) => ask({ id: `a${i}`, chapter: `c${i}`, predicted })),
      blankResults: Array.from({ length: n }, (_, i) => br('s', `c${i}`, '2026-08-03', passed)),
    });

  it('표본이 모자라면 null — 3개로 "과신 경향"을 말하면 거짓이다', () => {
    expect(jolAccuracy(many(MIN_SAMPLES - 1, true, true))).toBeNull();
  });
  it('표본이 차면 적중·과신·과소를 가른다', () => {
    expect(jolAccuracy(many(MIN_SAMPLES, true, false))).toMatchObject({ n: MIN_SAMPLES, hit: 0, over: MIN_SAMPLES });
    expect(jolAccuracy(many(MIN_SAMPLES, false, true))).toMatchObject({ hit: 0, under: MIN_SAMPLES });
    expect(jolAccuracy(many(MIN_SAMPLES, true, true))).toMatchObject({ hit: MIN_SAMPLES, over: 0 });
  });
});

describe('recordAsk', () => {
  it('같은 날 두 번째는 안 들어간다', () => {
    const s = st({});
    expect(recordAsk(s, ask({ ds: '2026-08-02' }))).toBe(true);
    expect(recordAsk(s, ask({ id: 'b', ds: '2026-08-02' }))).toBe(false);
    expect(s.jolAsks).toHaveLength(1);
  });
});
