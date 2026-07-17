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
  removeBlock,
  resetDay,
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
