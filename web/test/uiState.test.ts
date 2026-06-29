/* ============================================================
   uiState.test.ts — UI 환경설정 단일 store의 순수 로직 회귀(Vitest).
   부팅/영속/구키 흡수/LRU를 KV 주입으로 검증(브라우저 없이).
============================================================ */
import { describe, expect, it } from 'vitest';
import { bootUI, defaultUI, persistUI, pushRecent, UI_KEY } from '@/lib/uiState';
import { memKV } from '@/lib/kv';

describe('bootUI — 부팅/복원', () => {
  it('저장된 게 없으면 기본값(overview·빈 최근)', () => {
    expect(bootUI(memKV())).toEqual(defaultUI());
  });
  it('저장된 UIState를 그대로 읽는다', () => {
    const kv = memKV();
    persistUI(kv, { schedView: 'cards', recentCommands: ['a', 'b'] });
    expect(bootUI(kv)).toEqual({ schedView: 'cards', recentCommands: ['a', 'b'] });
  });
  it('손상된 JSON은 기본값으로 폴백(throw 없음)', () => {
    const kv = memKV();
    kv.setItem(UI_KEY, '{not json');
    expect(bootUI(kv)).toEqual(defaultUI());
  });
  it('스키마에 안 맞는 값(잘못된 뷰)은 기본값으로 폴백', () => {
    const kv = memKV();
    kv.setItem(UI_KEY, JSON.stringify({ schedView: 'grid', recentCommands: [] }));
    expect(bootUI(kv)).toEqual(defaultUI());
  });
});

describe('bootUI — 구 산재 키 흡수(1회 마이그레이션)', () => {
  it('신규 키가 없으면 sched_view·lh_recent_cmds를 흡수한다', () => {
    const kv = memKV();
    kv.setItem('sched_view', 'cards');
    kv.setItem('lh_recent_cmds', JSON.stringify(['x', 'y']));
    expect(bootUI(kv)).toEqual({ schedView: 'cards', recentCommands: ['x', 'y'] });
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
    const json = persistUI(kv, { schedView: 'overview', recentCommands: ['cmd'] });
    expect(JSON.parse(json)).toEqual({ schedView: 'overview', recentCommands: ['cmd'] });
    expect(bootUI(kv)).toEqual({ schedView: 'overview', recentCommands: ['cmd'] });
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
