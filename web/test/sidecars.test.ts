// @vitest-environment jsdom
/* ============================================================
   sidecars.test.ts — 백업 범위 정정(0단계-E ③).
   회귀 대상: 앱 상태 **밖**의 로컬 키가 어떤 백업에도 안 들어가던 결함. Tauri 이행(1단계)은
   오리진이 갈려 수동 export→import 가 유일한 경로라, 이 왕복이 깨지면 그 값은 영구 유실된다.
   ⚠ **화이트리스트가 넷에서 하나로 줄었다**(P10 W4 · 2026-08-07 · `atlas.*`·리서치 이력이
   `survey/` 로 갔다). 남은 것은 UI 설정뿐이고, 이 파일이 잠그는 것은 *어느 키냐*가 아니라
   **화이트리스트 계약**(밖의 키는 못 덮는다 · 프로토타입 오염 방지 · 손상 격리)이다.
============================================================ */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { exportLocalExtras, importLocalExtras, LOCAL_EXTRA_KEYS } from '@/lib/sidecars';
import { UI_KEY } from '@/lib/uiState';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('exportLocalExtras', () => {
  it('화이트리스트 키를 값째로 담는다', () => {
    localStorage.setItem(UI_KEY, JSON.stringify({ accent: 'cyan' }));
    const out = exportLocalExtras();
    expect(Object.keys(out).sort()).toEqual([...LOCAL_EXTRA_KEYS].sort());
    expect(out[UI_KEY]).toEqual({ accent: 'cyan' });
  });

  it('미저장 키는 생략(빈 앱은 빈 객체)', () => {
    expect(exportLocalExtras()).toEqual({});
  });

  it('손상된 키는 백업에서 빠지되 예외로 번지지 않는다', () => {
    localStorage.setItem(UI_KEY, '{깨진');
    expect(() => exportLocalExtras()).not.toThrow();
    expect(exportLocalExtras()).not.toHaveProperty(UI_KEY);
  });
});

describe('importLocalExtras', () => {
  it('내보내기→가져오기 왕복으로 값이 보존된다', () => {
    localStorage.setItem(UI_KEY, JSON.stringify({ accent: 'cyan' }));
    const backup = exportLocalExtras();
    localStorage.clear(); // 새 오리진(Tauri WebView2) 시뮬레이션
    expect(importLocalExtras(backup)).toEqual([UI_KEY]);
    expect(JSON.parse(localStorage.getItem(UI_KEY)!)).toEqual({ accent: 'cyan' });
  });

  it('화이트리스트 밖 키는 무시(신뢰 불가 파일이 앱 상태 키를 덮지 못한다)', () => {
    localStorage.setItem('study_planner_v3', 'REAL');
    importLocalExtras({ study_planner_v3: 'HIJACK', evil: 1, [UI_KEY]: { accent: 'ok' } });
    expect(localStorage.getItem('study_planner_v3')).toBe('REAL');
    expect(localStorage.getItem('evil')).toBeNull();
    expect(JSON.parse(localStorage.getItem(UI_KEY)!)).toEqual({ accent: 'ok' });
  });

  it('프로토타입 상속 속성은 복원하지 않는다', () => {
    const proto = { [UI_KEY]: { evil: 'x' } };
    importLocalExtras(Object.create(proto) as object);
    expect(localStorage.getItem(UI_KEY)).toBeNull();
  });

  it('구 백업(_local 없음)·비객체는 조용히 no-op', () => {
    expect(importLocalExtras(undefined)).toEqual([]);
    expect(importLocalExtras(null)).toEqual([]);
    expect(importLocalExtras('nope')).toEqual([]);
    expect(importLocalExtras([1, 2])).toEqual([]);
  });

  it('저장 실패(쿼터)는 throw하지 않고 그 키만 빠진다', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => importLocalExtras({ [UI_KEY]: { accent: 'x' } })).not.toThrow();
    expect(importLocalExtras({ [UI_KEY]: { accent: 'x' } })).toEqual([]);
  });
});
