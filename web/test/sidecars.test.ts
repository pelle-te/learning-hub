// @vitest-environment jsdom
/* ============================================================
   sidecars.test.ts — 백업 범위 정정(0단계-E ③).
   회귀 대상: 아틀라스 메모·관심·리서치 이력·UI 설정이 **어떤 백업에도 안 들어가던** 결함.
   Tauri 이행(1단계)은 오리진이 갈려 수동 export→import가 유일한 경로라, 이 왕복이
   깨지면 사용자가 직접 쓴 진로 메모가 영구 유실된다.
============================================================ */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  exportLocalExtras,
  importLocalExtras,
  ATLAS_NOTES_KEY,
  ATLAS_STARS_KEY,
  RESEARCH_HISTORY_KEY,
  LOCAL_EXTRA_KEYS,
} from '@/lib/sidecars';
import { UI_KEY } from '@/lib/uiState';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('exportLocalExtras', () => {
  it('저장된 4개 키를 값째로 담는다', () => {
    localStorage.setItem(ATLAS_STARS_KEY, JSON.stringify(['rf', 'sat']));
    localStorage.setItem(ATLAS_NOTES_KEY, JSON.stringify({ rf: '증폭기 공부' }));
    localStorage.setItem(RESEARCH_HISTORY_KEY, JSON.stringify([{ topic: 'LNA', ok: true }]));
    localStorage.setItem(UI_KEY, JSON.stringify({ accent: 'cyan' }));
    const out = exportLocalExtras();
    expect(Object.keys(out).sort()).toEqual([...LOCAL_EXTRA_KEYS].sort());
    expect(out[ATLAS_NOTES_KEY]).toEqual({ rf: '증폭기 공부' });
    expect(out[ATLAS_STARS_KEY]).toEqual(['rf', 'sat']);
  });

  it('미저장 키는 생략(빈 앱은 빈 객체)', () => {
    expect(exportLocalExtras()).toEqual({});
  });

  it('손상된 키 하나가 나머지 백업을 막지 않는다', () => {
    localStorage.setItem(ATLAS_NOTES_KEY, '{깨진');
    localStorage.setItem(ATLAS_STARS_KEY, JSON.stringify(['rf']));
    const out = exportLocalExtras();
    expect(out).not.toHaveProperty(ATLAS_NOTES_KEY);
    expect(out[ATLAS_STARS_KEY]).toEqual(['rf']);
  });
});

describe('importLocalExtras', () => {
  it('내보내기→가져오기 왕복으로 값이 보존된다', () => {
    localStorage.setItem(ATLAS_NOTES_KEY, JSON.stringify({ rf: '내가 쓴 메모' }));
    const backup = exportLocalExtras();
    localStorage.clear(); // 새 오리진(Tauri WebView2) 시뮬레이션
    expect(importLocalExtras(backup)).toEqual([ATLAS_NOTES_KEY]);
    expect(JSON.parse(localStorage.getItem(ATLAS_NOTES_KEY)!)).toEqual({ rf: '내가 쓴 메모' });
  });

  it('화이트리스트 밖 키는 무시(신뢰 불가 파일이 앱 상태 키를 덮지 못한다)', () => {
    localStorage.setItem('study_planner_v3', 'REAL');
    importLocalExtras({ study_planner_v3: 'HIJACK', evil: 1, [ATLAS_STARS_KEY]: ['ok'] });
    expect(localStorage.getItem('study_planner_v3')).toBe('REAL');
    expect(localStorage.getItem('evil')).toBeNull();
    expect(JSON.parse(localStorage.getItem(ATLAS_STARS_KEY)!)).toEqual(['ok']);
  });

  it('프로토타입 상속 속성은 복원하지 않는다', () => {
    const proto = { [ATLAS_NOTES_KEY]: { evil: 'x' } };
    importLocalExtras(Object.create(proto) as object);
    expect(localStorage.getItem(ATLAS_NOTES_KEY)).toBeNull();
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
    expect(() => importLocalExtras({ [ATLAS_STARS_KEY]: ['x'] })).not.toThrow();
    expect(importLocalExtras({ [ATLAS_STARS_KEY]: ['x'] })).toEqual([]);
  });
});
