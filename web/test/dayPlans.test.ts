import { describe, expect, it } from 'vitest';
import { schedule, applyDayPlans, layoutDay } from '@/lib/scheduler';
import { defaults } from '@/lib/persistence';
import {
  snapshotAutoDraft,
  blocksForDay,
  isManual,
  untimedBlocks,
  timedBlocks,
  ensureManual,
  placeBlock,
  unplaceBlock,
  resizeBlock,
  togglePin,
  addBlock,
  addOrMergeBlock,
  setBlockDone,
  removeBlock,
  removeSidFromDayPlans,
  resetDay,
  resolveSlot,
  snap,
} from '@/lib/dayPlans';
import type { AppState, Day } from '@/lib/types';

// 챕터를 가진 주간 과목 하나 — 스케줄러가 실제로 도는 최소 시드(결정론: startDate·_today 고정).
const seed = (): AppState =>
  ({
    ...defaults(),
    startDate: '2026-06-23',
    _today: '2026-06-23',
    items: [
      {
        id: 's1',
        name: '테스트 과목',
        color: '#9be83f',
        mode: 'weekly',
        weeklyHours: 6,
        chapters: [
          { id: 'c1', name: '1장', hours: 2, done: false },
          { id: 'c2', name: '2장', hours: 2, done: false },
          { id: 'c3', name: '3장', hours: 2, done: false },
        ],
      },
    ],
  }) as unknown as AppState;

const strip = (r: ReturnType<typeof schedule>) => r.days.map((d) => ({ ds: d.ds, used: d.used, items: d.items }));

describe('일일 배치 오버라이드(§4-2) + layoutDay start 존중', () => {
  it('불변식: dayPlans 없으면 자동 산출 100% 불변(무동작)', () => {
    const a = schedule(seed());
    const b = schedule({ ...seed(), dayPlans: {} } as AppState); // 빈 record도 매칭 ds 없어 무동작
    expect(strip(b)).toEqual(strip(a));
  });

  it('applyDayPlans(직접): mode auto인 날은 건드리지 않는다', () => {
    const days: Day[] = [
      {
        ds: '2026-06-23',
        date: new Date('2026-06-23'),
        wd: 2,
        studyMin: 300,
        used: 100,
        modLeft: 0,
        revLeft: 0,
        items: [{ type: 'new', sid: 's1', name: 'auto', min: 100 }],
      },
    ];
    const s = { ...defaults(), dayPlans: { '2026-06-23': { mode: 'auto', blocks: [] } } } as AppState;
    applyDayPlans(s, days);
    expect(days[0]!.items[0]!.name).toBe('auto'); // auto 모드 → 무변경
    expect(days[0]!.used).toBe(100);
  });

  it('manual인 날: items를 사용자 배치로 치환하고 used를 블록 합으로 갱신', () => {
    const s = seed();
    s.dayPlans = {
      '2026-06-23': {
        mode: 'manual',
        blocks: [{ id: 'b1', type: 'new', sid: 's1', name: '수동 물리', min: 90, start: 540 }],
      },
    };
    const r = schedule(s);
    const d = r.days.find((x) => x.ds === '2026-06-23')!;
    expect(d.items).toHaveLength(1);
    expect(d.items[0]!.name).toBe('수동 물리');
    expect(d.items[0]!.min).toBe(90);
    expect(d.items[0]!.start).toBe(540); // 명시 배치 시각이 실려온다
    expect(d.used).toBe(90);
  });

  it('layoutDay: 명시 start는 그 시각에 고정, start 없는 항목만 빈 창에 자동 배치', () => {
    const s = seed();
    const day: Day = {
      ds: '2026-06-28',
      date: new Date('2026-06-28'),
      wd: 0, // 일요일 — defaults 루틴에 수업 없음(가용창 넉넉)
      studyMin: 600,
      used: 0,
      modLeft: 0,
      revLeft: 0,
      items: [
        { type: 'new', sid: 's1', name: '고정', min: 60, start: 600 }, // 10:00 고정
        { type: 'rev', sid: 's1', name: '자동', min: 30 }, // start 없음 → auto 패킹
      ],
    };
    const r = layoutDay(s, day);
    const fixed = r.sessions.find((x) => x.name === '고정')!;
    expect(fixed.start).toBe(600);
    expect(fixed.end).toBe(660);
    const autoSes = r.sessions.find((x) => x.name === '자동')!;
    expect(autoSes.start).not.toBeNull(); // 남은 빈 창에 배치됨
    expect(autoSes.start).not.toBe(600); // 고정 블록 자리와 겹치지 않음
  });
});

describe('dayPlans CRUD(§6) — 자동초안 스냅샷·시간박기·핀·리셋', () => {
  const DS = '2026-06-23';

  it('snap: 15분 격자로 반올림', () => {
    expect(snap(547)).toBe(540);
    expect(snap(548)).toBe(555);
  });

  it('resolveSlot: 안 겹치면 그대로, 겹치면 다음 빈칸으로 밀기, 안 들어가면 null', () => {
    // 빈 날 → 요청 그대로(스냅).
    expect(resolveSlot([], 547, 60)).toBe(540);
    // 09:00–12:00 수업 점유, 09:30에 60분 드롭 → 12:00로 밀림.
    expect(resolveSlot([[540, 720]], 570, 60)).toBe(720);
    // 두 점유 사이를 연쇄로 밀기: 09–10, 10–11 점유, 09:00에 60분 → 11:00.
    expect(
      resolveSlot(
        [
          [540, 600],
          [600, 660],
        ],
        540,
        60,
      ),
    ).toBe(660);
    // 하루 끝(23:30)에 60분 → 마지막 가능 슬롯(23:00)으로 클램프(fit).
    expect(resolveSlot([], 1410, 60)).toBe(1380);
    // 23:00–24:00 점유 상태에서 60분 → 밀면 자정 넘겨 거부(null).
    expect(resolveSlot([[1380, 1440]], 1380, 60)).toBeNull();
  });

  it('snapshotAutoDraft: 그날 자동 items를 결정론 id의 블록으로 굳힌다(start 미부여)', () => {
    const res = schedule(seed());
    const blocks = snapshotAutoDraft(res, DS);
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.every((b) => b.start == null)).toBe(true); // 미지정=트레이
    expect(blocks[0]!.id).toContain(DS); // 결정론 id(ds·sid·type·i)
    // 같은 res·ds면 두 번 호출해도 동일 id(드래그 연속성)
    expect(snapshotAutoDraft(res, DS).map((b) => b.id)).toEqual(blocks.map((b) => b.id));
  });

  it('blocksForDay/isManual: 미승격이면 자동 프리뷰, 승격 후엔 저장 블록', () => {
    const s = seed();
    const res = schedule(s);
    expect(isManual(s, DS)).toBe(false);
    const preview = blocksForDay(s, res, DS);
    expect(preview.length).toBeGreaterThan(0);
    ensureManual(s, res, DS);
    expect(isManual(s, DS)).toBe(true);
    expect(blocksForDay(s, res, DS)).toBe(s.dayPlans![DS]!.blocks); // 저장 블록 참조
  });

  it('ensureManual: 첫 호출만 스냅샷 생성, 재호출은 기존 유지(멱등)', () => {
    const s = seed();
    const res = schedule(s);
    const dp1 = ensureManual(s, res, DS);
    dp1.blocks.push({ id: 'extra', type: 'blank', sid: 's1', name: '추가', min: 30 });
    const dp2 = ensureManual(s, res, DS);
    expect(dp2).toBe(dp1); // 재스냅샷 안 함
    expect(dp2.blocks.some((b) => b.id === 'extra')).toBe(true);
  });

  it('placeBlock/unplaceBlock: 시각 부여(스냅)→트레이에서 캘린더, 복귀', () => {
    const s = seed();
    const res = schedule(s);
    const id = snapshotAutoDraft(res, DS)[0]!.id;
    placeBlock(s, res, DS, id, 547); // 미승격 → 자동 승격 후 배치
    expect(isManual(s, DS)).toBe(true);
    const blocks = s.dayPlans![DS]!.blocks;
    const b = blocks.find((x) => x.id === id)!;
    expect(b.start).toBe(540); // 15 스냅
    expect(timedBlocks(blocks)).toContainEqual(b);
    unplaceBlock(s, res, DS, id);
    expect(b.start).toBeUndefined();
    expect(untimedBlocks(s.dayPlans![DS]!.blocks)).toContainEqual(b);
  });

  it('resizeBlock: 최소 15분·15 스냅', () => {
    const s = seed();
    const res = schedule(s);
    const id = snapshotAutoDraft(res, DS)[0]!.id;
    resizeBlock(s, res, DS, id, 7); // 15 미만 → 15
    expect(s.dayPlans![DS]!.blocks.find((x) => x.id === id)!.min).toBe(15);
    resizeBlock(s, res, DS, id, 92);
    expect(s.dayPlans![DS]!.blocks.find((x) => x.id === id)!.min).toBe(90);
  });

  it('addBlock/removeBlock: 블록 추가·삭제', () => {
    const s = seed();
    const res = schedule(s);
    const b = addBlock(s, res, DS, { type: 'blank', sid: 's1', name: '백지', min: 30 });
    expect(s.dayPlans![DS]!.blocks.some((x) => x.id === b.id)).toBe(true);
    removeBlock(s, DS, b.id);
    expect(s.dayPlans![DS]!.blocks.some((x) => x.id === b.id)).toBe(false);
  });

  it('togglePin + resetDay: 핀 없으면 제거, 핀 있으면 핀만 남기고 재초안', () => {
    const s = seed();
    const res = schedule(s);
    const id = snapshotAutoDraft(res, DS)[0]!.id;
    placeBlock(s, res, DS, id, 600);
    // 핀 없음 → resetDay가 dayPlans[ds] 통째 제거
    resetDay(s, DS);
    expect(s.dayPlans![DS]).toBeUndefined();
    // 핀 있음 → 핀 블록만 남긴다
    placeBlock(s, res, DS, id, 600);
    togglePin(s, res, DS, id);
    addBlock(s, res, DS, { type: 'blank', sid: 's1', name: '안핀', min: 30 });
    resetDay(s, DS);
    expect(s.dayPlans![DS]!.blocks).toHaveLength(1);
    expect(s.dayPlans![DS]!.blocks[0]!.pinned).toBe(true);
  });

  it('addOrMergeBlock: 같은 sid|type 없으면 추가, 있으면 min·챕터 병합(§6-3)', () => {
    const s = seed();
    const res = schedule(s);
    // 자동초안에 없는 유형(백지)으로 — 첫 add는 신규, 둘째는 병합.
    const r1 = addOrMergeBlock(s, res, DS, { type: 'blank', sid: 's1', name: '물리', min: 60, chapters: ['1장'] });
    expect(r1.merged).toBe(false);
    const r2 = addOrMergeBlock(s, res, DS, { type: 'blank', sid: 's1', name: '물리', min: 30, chapters: ['2장'] });
    expect(r2.merged).toBe(true);
    expect(r2.block.id).toBe(r1.block.id); // 같은 블록에 병합
    expect(r2.block.min).toBe(90); // 60+30
    expect(r2.block.chapters).toEqual(['1장', '2장']);
    // 다른 type은 별도 블록
    const r3 = addOrMergeBlock(s, res, DS, { type: 'mock', sid: 'mock', name: '모의', min: 20 });
    expect(r3.merged).toBe(false);
    // 자동초안이 이미 배치한 유형(집중/new)에 add하면 그 블록에 병합된다(완료 충돌 방지).
    const r4 = addOrMergeBlock(s, res, DS, { type: 'new', sid: 's1', name: '물리', min: 30 });
    expect(r4.merged).toBe(true);
  });

  it('addBlock: 같은 sid|type 여러 번 추가하면 병합 없이 별도 블록', () => {
    const s = seed();
    const res = schedule(s);
    const base = snapshotAutoDraft(res, DS).filter((x) => x.sid === 's1' && x.type === 'new').length;
    const b1 = addBlock(s, res, DS, { type: 'new', sid: 's1', name: '테스트 과목', min: 120 });
    const b2 = addBlock(s, res, DS, { type: 'new', sid: 's1', name: '테스트 과목', min: 120 });
    expect(b1.id).not.toBe(b2.id);
    const same = s.dayPlans![DS]!.blocks.filter((x) => x.sid === 's1' && x.type === 'new');
    expect(same.length).toBe(base + 2); // 별도 2블록 추가(병합이면 base 그대로·min만 누적)
    expect(same.filter((x) => x.min === 120).length).toBeGreaterThanOrEqual(2); // 내 2블록은 120 유지(240으로 안 뭉침)
  });

  it('setBlockDone: 같은 sid|type 여러 블록 독립 체크 + completions 집계(OR/합) 미러링', () => {
    const s = seed();
    const res = schedule(s);
    const b1 = addBlock(s, res, DS, { type: 'blank', sid: 's1', name: '백지', min: 60 });
    const b2 = addBlock(s, res, DS, { type: 'blank', sid: 's1', name: '백지', min: 30 });
    // b1만 완료 → 그 블록만 done, 집계 min=60
    setBlockDone(s, DS, b1.id, true, DS);
    expect(s.dayPlans![DS]!.blocks.find((x) => x.id === b1.id)!.done).toBe(true);
    expect(s.dayPlans![DS]!.blocks.find((x) => x.id === b2.id)!.done).toBeUndefined();
    expect(s.completions![DS]!['s1|blank']).toEqual({ done: true, min: 60, doneDs: DS });
    // b2도 완료 → 집계 합 90
    setBlockDone(s, DS, b2.id, true, DS);
    expect(s.completions![DS]!['s1|blank']!.min).toBe(90);
    // 둘 다 해제 → 집계 키 제거(하류가 '미완'으로 읽음)
    setBlockDone(s, DS, b1.id, false, DS);
    setBlockDone(s, DS, b2.id, false, DS);
    expect(s.completions![DS]?.['s1|blank']).toBeUndefined();
  });

  it('ensureManual: 승격 시 기존 sid|type 완료를 블록 done으로 시딩(체크 유실 방지)', () => {
    const s = seed();
    const res = schedule(s);
    const draft = snapshotAutoDraft(res, DS)[0]!;
    s.completions = { [DS]: { [draft.sid + '|' + draft.type]: { done: true, min: 120, doneDs: DS } } };
    const dp = ensureManual(s, res, DS);
    const seeded = dp.blocks.find((b) => b.sid === draft.sid && b.type === draft.type)!;
    expect(seeded.done).toBe(true);
  });

  it('removeBlock: auto 모드 날엔 무동작(수동만 삭제)', () => {
    const s = seed();
    s.dayPlans = { [DS]: { mode: 'auto', blocks: [{ id: 'x', type: 'new', sid: 's1', name: 'a', min: 30 }] } };
    removeBlock(s, DS, 'x');
    expect(s.dayPlans[DS]!.blocks).toHaveLength(1); // auto → 안 지움
  });
});

describe('§4-3 복습 재씨앗 — 수동 new 블록의 하류 복습', () => {
  const DS = '2026-06-23';

  it('수동 new 블록(자동초안에 없는 챕터)의 하류에 복습이 생긴다', () => {
    const s = seed();
    // 사용자가 새 챕터의 new 블록을 손수 얹음(자동초안엔 없는 '특별장').
    s.dayPlans = {
      [DS]: {
        mode: 'manual',
        blocks: [{ id: 'b1', type: 'new', sid: 's1', name: '테스트 과목', min: 120, chapters: ['특별장'], start: 540 }],
      },
    };
    const res = schedule(s);
    // DS 이후 auto 날에 s1 rev + '특별장'이 생겨야(하류 복습 재씨앗).
    const hasReview = res.days.some(
      (d) => d.ds > DS && d.items.some((it) => it.type === 'rev' && it.sid === 's1' && it.chapters?.includes('특별장')),
    );
    expect(hasReview).toBe(true);
  });

  it('불변식: manual 날 없으면 재씨앗 무동작(자동 복습 산출 불변)', () => {
    const a = schedule(seed());
    const b = schedule({ ...seed(), dayPlans: {} } as AppState);
    const revCount = (r: ReturnType<typeof schedule>) =>
      r.days.reduce((n, d) => n + d.items.filter((it) => it.type === 'rev').length, 0);
    expect(revCount(b)).toBe(revCount(a));
  });

  it('이중계상 방지: 대상 날에 이미 그 챕터 rev가 있으면 재추가 안 함', () => {
    const s = seed();
    // 수동 블록이 자동초안과 같은 챕터(1장)면 하류 rev가 이미 있어 실질 무보강.
    const auto = schedule(seed());
    const autoRev = auto.days.reduce((n, d) => n + d.items.filter((it) => it.type === 'rev').length, 0);
    s.dayPlans = {
      [DS]: {
        mode: 'manual',
        blocks: [{ id: 'b1', type: 'new', sid: 's1', name: '테스트 과목', min: 120, chapters: ['1장'], start: 540 }],
      },
    };
    const res = schedule(s);
    const rev = res.days.reduce((n, d) => n + d.items.filter((it) => it.type === 'rev').length, 0);
    // manual이 하루 치환하며 그날 auto rev가 사라질 순 있어도, 재씨앗이 '1장'을 중복 추가하진 않는다.
    expect(rev).toBeLessThanOrEqual(autoRev + 3); // 오프셋(1·3·7·16) 내 소폭, 폭증 없음
  });
});

/* ── 회귀 고정: 과목 삭제 시 dayPlans 고아 청소 ────────────────────────────
   weekAlloc과 같은 구멍이 dayPlans에도 있었다 — 과목만 지우면 승격된 모든 날에 그 sid 블록이
   남아 배치·캘린더에 유령 블록으로 뜨고, setBlockDone이 미러링한 completions['sid|type'] 집계가
   완료 분을 계속 부풀린다. 그리고 그 청소가 빈 manual 날을 남기면 applyDayPlans가 그날을
   items=[]로 치환해 **자동 스케줄이 죽는다**(Wave 1이 weekAlloc 빈 주에서 잡은 것과 같은 종류). */
describe('dayPlans 고아 sid 청소(과목 삭제 경로)', () => {
  const DS = '2026-06-23';

  /** s1(seed) 옆에 두 번째 과목을 붙인 시드 — s1을 지워도 그날 자동 산출이 살아 있는지 볼 수 있게. */
  const seed2 = (): AppState => {
    const s = seed();
    s.items = [
      ...s.items,
      {
        id: 's2',
        name: '두번째 과목',
        color: '#4f8ff0',
        mode: 'weekly',
        weeklyHours: 6,
        chapters: [
          { id: 'd1', name: 'A장', hours: 2, done: false },
          { id: 'd2', name: 'B장', hours: 2, done: false },
        ],
      } as unknown as AppState['items'][number],
    ];
    return s;
  };

  it('그 sid의 블록이 전 dayPlans에서 사라진다(다른 과목 블록은 보존)', () => {
    const s = seed2();
    s.dayPlans = {
      [DS]: {
        mode: 'manual',
        blocks: [
          { id: 'b1', type: 'new', sid: 's1', name: '테스트 과목', min: 120 },
          { id: 'b2', type: 'new', sid: 's2', name: '두번째 과목', min: 60 },
        ],
      },
      '2026-06-24': {
        mode: 'manual',
        blocks: [{ id: 'b3', type: 'rev', sid: 's1', name: '테스트 과목', min: 30 }],
      },
    };
    s.items = s.items.filter((it) => it.id !== 's1'); // 삭제 경로가 하는 일(Items.removeItem과 같은 순서)
    expect(removeSidFromDayPlans(s, 's1')).toBe(2); // b1 + b3
    expect(s.dayPlans![DS]!.blocks.map((b) => b.id)).toEqual(['b2']);
    expect(blocksForDay(s, schedule(s), DS).some((b) => b.sid === 's1')).toBe(false);
  });

  it('미러링된 completions 고아 키도 함께 정리된다(완료 분이 어긋나지 않는다)', () => {
    const s = seed2();
    s.dayPlans = {
      [DS]: {
        mode: 'manual',
        blocks: [
          { id: 'b1', type: 'new', sid: 's1', name: '테스트 과목', min: 120 },
          { id: 'b2', type: 'new', sid: 's2', name: '두번째 과목', min: 60 },
        ],
      },
    };
    // setBlockDone의 미러링 규약 그대로 완료를 만든다(직접 리터럴이 아니라 실제 경로로).
    const res = schedule(s);
    setBlockDone(s, DS, 'b1', true, DS);
    setBlockDone(s, DS, 'b2', true, DS);
    expect(s.completions[DS]).toEqual({
      's1|new': { done: true, min: 120, doneDs: DS },
      's2|new': { done: true, min: 60, doneDs: DS },
    });
    const doneMin = (st: AppState) => Object.values(st.completions[DS] || {}).reduce((t, e) => t + (e.min || 0), 0);
    expect(doneMin(s)).toBe(180);

    s.items = s.items.filter((it) => it.id !== 's1');
    removeSidFromDayPlans(s, 's1');
    expect(s.completions[DS]).toEqual({ 's2|new': { done: true, min: 60, doneDs: DS } });
    expect(doneMin(s)).toBe(60); // 청소 없이는 180 — 고아 120분이 통계·연속일수를 부풀린다
    void res;
  });

  it('전 날짜의 고아 완료 키를 지운다(auto 날 포함) + 빈 날 객체는 키째 정리', () => {
    const s = seed2();
    s.completions = {
      [DS]: { 's1|new': { done: true, min: 120 }, 's2|new': { done: true, min: 60 } },
      '2026-06-30': { 's1|rev': { done: true, min: 30 } }, // 승격 안 된 auto 날의 완료
    };
    expect(removeSidFromDayPlans(s, 's1')).toBe(2); // 완료 키 2건(블록 0건)
    expect(s.completions[DS]).toEqual({ 's2|new': { done: true, min: 60 } });
    expect(s.completions['2026-06-30']).toBeUndefined(); // syncBlockCompletion과 같은 빈 날 정리 규칙
  });

  it('★ 블록이 전부 사라진 날이 자동 스케줄을 죽이지 않는다(빈 manual 날 금지)', () => {
    const s = seed2();
    s.dayPlans = {
      [DS]: { mode: 'manual', blocks: [{ id: 'b1', type: 'new', sid: 's1', name: '테스트 과목', min: 120 }] },
    };
    s.items = s.items.filter((it) => it.id !== 's1');
    removeSidFromDayPlans(s, 's1');

    // 빈 {mode:'manual',blocks:[]}를 남기면 applyDayPlans가 그날을 items=[]로 치환해 자동이 죽는다.
    expect(s.dayPlans![DS]).toBeUndefined();
    expect(isManual(s, DS)).toBe(false);

    // 불변식: 남은 산출이 'dayPlans가 애초에 없던' 상태와 100% 동일해야 한다.
    const bare = seed2();
    bare.items = bare.items.filter((it) => it.id !== 's1');
    expect(strip(schedule(s))).toEqual(strip(schedule(bare)));
    // 그리고 그날은 실제로 비어 있지 않다(자동 산출 생존).
    const day = schedule(s).days.find((d) => d.ds === DS);
    expect(day!.items.length).toBeGreaterThan(0);
  });

  it('원래부터 빈 manual 날(사용자가 비운 쉬는 날)은 건드리지 않는다', () => {
    const s = seed2();
    s.dayPlans = { [DS]: { mode: 'manual', blocks: [] } };
    expect(removeSidFromDayPlans(s, 's1')).toBe(0);
    expect(s.dayPlans![DS]).toEqual({ mode: 'manual', blocks: [] }); // 이 과목 삭제와 무관한 의사표시
  });

  it('멱등 — 두 번째 호출은 아무것도 지우지 않는다', () => {
    const s = seed2();
    s.dayPlans = {
      [DS]: { mode: 'manual', blocks: [{ id: 'b1', type: 'new', sid: 's1', name: '테스트 과목', min: 120 }] },
    };
    s.completions = { [DS]: { 's1|new': { done: true, min: 120 } } };
    expect(removeSidFromDayPlans(s, 's1')).toBe(2);
    expect(removeSidFromDayPlans(s, 's1')).toBe(0);
  });

  it('dayPlans·completions가 없어도 안전(무동작)', () => {
    const s = seed();
    delete (s as { dayPlans?: unknown }).dayPlans;
    s.completions = {};
    expect(removeSidFromDayPlans(s, 's1')).toBe(0);
  });
});

/* ── 회귀 고정: 절대규칙 3(색 = PALETTE 파생) ──────────────────────────────
   스케줄러가 모의 아이템에 '#b794f6'을 박아 넣던 게 오래 남아 있었다. 그 값이 산출물에 실리면
   WeekCalendar가 인라인 --seg로 깔아 .mock 토큰(var(--bad))을 덮는다 → 팔레트 밖 색이 화면에 산다. */
describe('모의시험 아이템 — 색 리터럴 금지(절대규칙 3)', () => {
  it('자동 산출 mock 아이템에 color가 없다(표시는 type 플래그 → CSS 토큰)', () => {
    const s = seed();
    s.mockEveryWeeks = 1;
    const res = schedule(s);
    const mocks = res.days.flatMap((d) => d.items.filter((it) => it.type === 'mock'));
    expect(mocks.length).toBeGreaterThan(0); // 시드가 실제로 모의를 만드는지 먼저 보장
    for (const m of mocks) expect(m.color).toBeUndefined();
  });
});
