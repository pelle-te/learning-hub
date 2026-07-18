/* ============================================================
   uiState.test.ts — UI 환경설정 단일 store의 순수 로직 회귀(Vitest).
   부팅/영속/구키 흡수/LRU를 KV 주입으로 검증(브라우저 없이).
============================================================ */
import { describe, expect, it } from 'vitest';
import { bootUI, defaultUI, persistUI, pushRecent, UI_KEY } from '@/lib/uiState';
import { memKV } from '@/lib/kv';

describe('bootUI — 부팅/복원', () => {
  it('저장된 게 없으면 기본값(week·빈 최근)', () => {
    expect(bootUI(memKV())).toEqual(defaultUI());
    // 재개편 v4 — 배분이 독립 세그먼트로 빠지며 캘린더가 계획의 첫 착지가 됐다(기본 주 뷰).
    expect(defaultUI().schedView).toBe('week');
  });
  it('저장된 UIState를 그대로 읽는다', () => {
    const kv = memKV();
    persistUI(kv, { schedView: 'week', accent: 'lime', recentCommands: ['a', 'b'], fxLite: false });
    expect(bootUI(kv)).toEqual({
      schedView: 'week',
      accent: 'lime',
      recentCommands: ['a', 'b'],
      fxLite: false,
      navCollapsed: false,
      navSurface: 'study',
    });
  });
  it('손상된 JSON은 기본값으로 폴백(throw 없음)', () => {
    const kv = memKV();
    kv.setItem(UI_KEY, '{not json');
    expect(bootUI(kv)).toEqual(defaultUI());
  });
  it('구 뷰명(overview·cards·alloc)은 week로, 미지의 값도 week로 흡수(부분 손상 격리)', () => {
    const kv = memKV();
    // 레거시 값이 schedView 하나만 깨도 accent 등 나머지는 보존돼야 한다(.catch·preprocess).
    kv.setItem(UI_KEY, JSON.stringify({ schedView: 'overview', accent: 'cyan', recentCommands: ['a'] }));
    expect(bootUI(kv).schedView).toBe('week');
    expect(bootUI(kv).accent).toBe('cyan'); // schedView 폴백이 accent를 되돌리지 않음
    kv.setItem(UI_KEY, JSON.stringify({ schedView: 'cards', recentCommands: [] }));
    expect(bootUI(kv).schedView).toBe('week');
    // alloc은 이제 캘린더의 뷰가 아니라 별도 세그먼트(/alloc) → 주 뷰로 착지시킨다.
    kv.setItem(UI_KEY, JSON.stringify({ schedView: 'alloc', recentCommands: [] }));
    expect(bootUI(kv).schedView).toBe('week');
    kv.setItem(UI_KEY, JSON.stringify({ schedView: 'grid', accent: 'amber', recentCommands: [] }));
    expect(bootUI(kv).schedView).toBe('week'); // 미지의 값 → 기본 week
    expect(bootUI(kv).accent).toBe('amber');
  });
});

describe('bootUI — 구 산재 키 흡수(1회 마이그레이션)', () => {
  it('신규 키가 없으면 sched_view·lh_recent_cmds를 흡수한다', () => {
    const kv = memKV();
    kv.setItem('sched_view', 'cards'); // 구 뷰명 → week로 흡수
    kv.setItem('lh_recent_cmds', JSON.stringify(['x', 'y']));
    expect(bootUI(kv)).toEqual({
      schedView: 'week',
      accent: 'lime',
      recentCommands: ['x', 'y'],
      fxLite: false,
      navCollapsed: false,
      navSurface: 'study',
    });
  });
  it('흡수 후 persist하면 구 키는 정리되고 단일 키만 남는다', () => {
    const kv = memKV();
    kv.setItem('sched_view', 'cards');
    const ui = bootUI(kv);
    persistUI(kv, ui);
    expect(kv.getItem('sched_view')).toBeNull();
    expect(kv.getItem('lh_recent_cmds')).toBeNull();
    expect(kv.getItem(UI_KEY)).not.toBeNull();
  });
  it('구 최근명령이 배열이 아니면 무시(빈 배열)', () => {
    const kv = memKV();
    kv.setItem('lh_recent_cmds', JSON.stringify({ bad: 1 }));
    expect(bootUI(kv).recentCommands).toEqual([]);
  });
});

describe('persistUI — 왕복', () => {
  it('persist→boot 왕복이 동일 상태를 보존하고 JSON을 반환한다', () => {
    const kv = memKV();
    const json = persistUI(kv, { schedView: 'month', accent: 'cyan', recentCommands: ['cmd'], fxLite: true });
    expect(JSON.parse(json)).toEqual({ schedView: 'month', accent: 'cyan', recentCommands: ['cmd'], fxLite: true });
    expect(bootUI(kv)).toEqual({
      schedView: 'month',
      accent: 'cyan',
      recentCommands: ['cmd'],
      fxLite: true,
      navCollapsed: false,
      navSurface: 'study',
    });
  });
});

describe('accent — 액센트 노브 영속', () => {
  it('기본 액센트는 lime(데모 v6)', () => {
    expect(defaultUI().accent).toBe('lime');
  });
  it('저장된 액센트를 읽고, 잘못된 값은 기본 lime으로 폴백', () => {
    const kv = memKV();
    persistUI(kv, { schedView: 'week', accent: 'amber', recentCommands: [] });
    expect(bootUI(kv).accent).toBe('amber');
    kv.setItem(UI_KEY, JSON.stringify({ schedView: 'week', accent: 'turbo', recentCommands: [] }));
    expect(bootUI(kv).accent).toBe('lime'); // 스키마 미스 → 전체 기본값 폴백
  });
});

describe('pushRecent — LRU', () => {
  it('최신을 앞에 넣고 중복을 제거한다', () => {
    expect(pushRecent(['a', 'b'], 'c')).toEqual(['c', 'a', 'b']);
    expect(pushRecent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
  });
  it('최대 6개로 자른다', () => {
    const r = pushRecent(['a', 'b', 'c', 'd', 'e', 'f'], 'g');
    expect(r).toHaveLength(6);
    expect(r[0]).toBe('g');
    expect(r).not.toContain('f'); // 가장 오래된 게 밀려난다
  });
});
