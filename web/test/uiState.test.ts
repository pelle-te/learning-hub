/* ============================================================
   uiState.test.ts — UI 환경설정 단일 store의 순수 로직 회귀(Vitest).
   부팅/영속/구키 흡수/LRU를 KV 주입으로 검증(브라우저 없이).
============================================================ */
import { describe, expect, it } from 'vitest';
import { bootUI, defaultUI, persistUI, pushRecent, resolveTheme, UI_KEY } from '@/lib/uiState';
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
      focusLock: null,
      ankiAutoRefresh: false,
      themeAuto: false,
      autoTheme: null,
      seenDs: {},
      pins: [],
      inspectDs: null,
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
      focusLock: null,
      ankiAutoRefresh: false,
      themeAuto: false,
      autoTheme: null,
      seenDs: {},
      pins: [],
      inspectDs: null,
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
      focusLock: null,
      ankiAutoRefresh: false,
      themeAuto: false,
      autoTheme: null,
      seenDs: {},
      pins: [],
      inspectDs: null,
    });
  });
});

/* 2단계-A4 — AnkiPanel이 localStorage를 직접 만지던 유일한 kv SSOT 우회를 흡수했다.
   그 키는 어떤 백업에도 안 들어가서 Tauri 이관 때 조용히 사라지는 값이었다.
   ⚠ 여기서 가장 위험한 케이스는 "UI_KEY가 이미 있는 기존 사용자"다 — 흡수를 UI_KEY 부재
   경로에만 걸면 .default(false)가 사용자의 '1' 설정을 조용히 지운다. */
describe('bootUI — anki 자동새로고침 흡수(2단계-A4)', () => {
  it('UI_KEY가 없으면 구 anki 키를 흡수한다', () => {
    const kv = memKV();
    kv.setItem('lh:anki-autorefresh', '1');
    expect(bootUI(kv).ankiAutoRefresh).toBe(true);
  });

  it('⚠ UI_KEY가 이미 있어도 흡수한다(기존 사용자의 설정이 조용히 지워지지 않는다)', () => {
    const kv = memKV();
    // 진짜 구 저장본 — 신규 필드가 **없는** UI_KEY. (defaultUI()로 만들면 필드가 이미 들어 있어
    // 레거시 상황이 아니게 된다.)
    const legacyShape: Record<string, unknown> = { ...defaultUI() };
    delete legacyShape.ankiAutoRefresh;
    kv.setItem(UI_KEY, JSON.stringify(legacyShape));
    kv.setItem('lh:anki-autorefresh', '1');
    expect(bootUI(kv).ankiAutoRefresh).toBe(true);
  });

  it('신규 필드가 이미 저장돼 있으면 그 값이 이긴다(흡수 완료 후 구 키가 되살아나지 않는다)', () => {
    const kv = memKV();
    kv.setItem(UI_KEY, JSON.stringify({ ...defaultUI(), ankiAutoRefresh: false }));
    kv.setItem('lh:anki-autorefresh', '1');
    expect(bootUI(kv).ankiAutoRefresh).toBe(false);
  });

  it("'0'·미저장은 false", () => {
    const kv = memKV();
    kv.setItem('lh:anki-autorefresh', '0');
    expect(bootUI(kv).ankiAutoRefresh).toBe(false);
    expect(bootUI(memKV()).ankiAutoRefresh).toBe(false);
  });

  it('흡수 후 persist하면 구 anki 키도 정리된다', () => {
    const kv = memKV();
    kv.setItem('lh:anki-autorefresh', '1');
    persistUI(kv, bootUI(kv));
    expect(kv.getItem('lh:anki-autorefresh')).toBeNull();
    expect(bootUI(kv).ankiAutoRefresh).toBe(true); // 정리해도 값은 신규 키에 살아 있다
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

/* ⚠⚠ H9(2026-07-30 `/감사 근본`) — **시스템 테마 감지는 기기-로컬이어야 한다.**

   옛 구현은 `ThemeProvider` 가 감지 결과를 `state.theme` 에 써넣었다. 그런데 `state.theme` 은
   D1 로 동기화되는 앱 데이터라, PC 에서 해질녘에 OS 가 다크로 바뀌면 그 값이 클라우드를 타고
   **폰 테마까지 뒤집었다.** `uiState` 는 "따라갈까 말까는 기기별 취향"이라고 적어 놓고 그
   취향의 *결과*를 전 기기에 뿌리고 있었다(`accent`·`fxLite` 는 올바르게 로컬이었다).

   → 감지값은 `ui.autoTheme`(로컬)에 담고, 화면이 입는 값은 `resolveTheme` 이 해소한다.
   아래 세 케이스가 그 계약 전부다 — 특히 마지막이 **사용자가 못박은 계약**(수동 선택은 다음 OS
   변경까지 유지 · 절대규칙 #4)을 잠근다. */
describe('resolveTheme — 동기화 정본과 기기-로컬 감지값의 해소(H9)', () => {
  it('따라가기가 꺼져 있으면 감지값이 있어도 정본이 이긴다', () => {
    expect(resolveTheme('dark', { themeAuto: false, autoTheme: 'light' })).toBe('dark');
  });
  it('따라가기가 켜져 있으면 감지값이 정본을 덮는다 — 덮을 뿐 **쓰지는 않는다**', () => {
    expect(resolveTheme('dark', { themeAuto: true, autoTheme: 'light' })).toBe('light');
  });
  it('감지값이 아직 없으면 정본으로 — 정본도 없으면 다크(첫 페인트 FOUC 방지 기본)', () => {
    expect(resolveTheme('light', { themeAuto: true, autoTheme: null })).toBe('light');
    expect(resolveTheme(undefined, { themeAuto: true, autoTheme: null })).toBe('dark');
  });
  it('기본 UI 는 감지값이 비어 있다 — 켜기 전엔 아무것도 덮지 않는다', () => {
    expect(defaultUI().autoTheme).toBeNull();
    expect(defaultUI().themeAuto).toBe(false);
  });
});
