/* ============================================================
   schema.test.ts — 경계 데이터 계약(zod) 회귀. 백업 JSON 로드/저장의 무결성을 지킨다.
   정상 입력은 통과하고, 손상/누락 입력은 거부하며, 구버전 호환(passthrough·default)을 보존하는지 검증.
============================================================ */
import { describe, expect, it } from 'vitest';
import {
  AppStateSchema,
  ChapterSchema,
  CompletionsSchema,
  ItemSchema,
  RoutineBlockSchema,
  ThemeSchema,
} from '@/lib/schema';

describe('ItemSchema', () => {
  it('유효한 weekly 항목을 파싱한다', () => {
    const r = ItemSchema.safeParse({ id: 'a', name: '수학', mode: 'weekly', weeklyHours: 5 });
    expect(r.success).toBe(true);
  });
  it('chapters 누락 시 빈 배열로 기본값을 채운다', () => {
    const r = ItemSchema.parse({ id: 'a', name: '수학', mode: 'weekly' });
    expect(r.chapters).toEqual([]);
  });
  it('알 수 없는 mode는 거부한다', () => {
    const r = ItemSchema.safeParse({ id: 'a', name: '수학', mode: 'yearly' });
    expect(r.success).toBe(false);
  });
  it('구버전 호환: 모르는 키도 passthrough로 보존한다', () => {
    const r = ItemSchema.parse({ id: 'a', name: '수학', mode: 'daily', dailyMin: 30, legacyFlag: 1 });
    expect((r as Record<string, unknown>).legacyFlag).toBe(1);
  });
  it('필수 필드(name) 누락은 거부한다', () => {
    expect(ItemSchema.safeParse({ id: 'a', mode: 'weekly' }).success).toBe(false);
  });
});

describe('ChapterSchema / RoutineBlockSchema', () => {
  it('Chapter는 id·name·hours·done을 요구한다', () => {
    expect(ChapterSchema.safeParse({ id: 'c1', name: '1장', hours: 4, done: false }).success).toBe(true);
    expect(ChapterSchema.safeParse({ id: 'c1', name: '1장', hours: '네시간', done: false }).success).toBe(false);
  });
  it('RoutineBlock의 days는 숫자 배열', () => {
    expect(
      RoutineBlockSchema.safeParse({ id: 'b', name: '수면', type: '수면', start: '23:00', end: '07:00', days: [0, 1] })
        .success,
    ).toBe(true);
    expect(
      RoutineBlockSchema.safeParse({ id: 'b', name: '수면', type: '수면', start: '23:00', end: '07:00', days: ['월'] })
        .success,
    ).toBe(false);
  });
});

describe('ThemeSchema / CompletionsSchema', () => {
  it('테마는 두 값(light·dark)만 허용 — 세피아 폐기', () => {
    expect(ThemeSchema.safeParse('dark').success).toBe(true);
    expect(ThemeSchema.safeParse('light').success).toBe(true);
    expect(ThemeSchema.safeParse('sepia').success).toBe(false);
    expect(ThemeSchema.safeParse('neon').success).toBe(false);
  });
  it('completions는 ds→(sid|type)→{done,min} 중첩 레코드', () => {
    const ok = CompletionsSchema.safeParse({ '2026-06-29': { 'a|new': { done: true, min: 120 } } });
    expect(ok.success).toBe(true);
    const bad = CompletionsSchema.safeParse({ '2026-06-29': { 'a|new': { done: true } } }); // min 누락
    expect(bad.success).toBe(false);
  });
});

describe('AppStateSchema — 전체 상태 계약', () => {
  // 모델 v3 최소 유효 상태(백업 JSON 1건과 동치).
  const valid = {
    schemaVersion: 3,
    theme: 'dark',
    completions: {},
    startDate: '2026-06-23',
    moduleLen: 120,
    reviewRatio: 20,
    routine: [],
    dayOverrides: {},
    items: [],
    summaries: {},
    cbms: [],
    backlog: [],
    blankResults: [],
    retentionLog: [],
    weekly: {},
    rituals: {},
    blankReviewWeekly: false,
    mockEveryWeeks: 4,
    adaptiveCapacity: true,
    peakStart: '09:00',
    peakEnd: '12:00',
    reviewViaAnki: false,
    graphPriority: false,
    degree: { targetTotal: 130, reqMajorReq: 60, reqMajorSel: 30, reqLiberal: 40, semesters: [] },
    anki: { source: '' },
  };

  it('완전한 유효 상태를 파싱한다', () => {
    expect(AppStateSchema.safeParse(valid).success).toBe(true);
  });
  it('필수 필드(theme) 누락은 거부한다', () => {
    const broken: Record<string, unknown> = { ...valid };
    delete broken.theme;
    expect(AppStateSchema.safeParse(broken).success).toBe(false);
  });
  it('런타임 캐시/시드(_today)는 선택 — 있어도 통과', () => {
    expect(AppStateSchema.safeParse({ ...valid, _today: '2026-06-29' }).success).toBe(true);
  });
  it('미래 확장 키는 passthrough로 보존한다', () => {
    const r = AppStateSchema.parse({ ...valid, futureField: 42 });
    expect((r as Record<string, unknown>).futureField).toBe(42);
  });
});
