// @vitest-environment jsdom
/* ============================================================
   invariants.test.ts — "두 원천이 손으로 동기화되던" 불변식을 기계적으로 잠근다.
   이전엔 주석으로만 지켜져 누락 시 조용히 오작동(무증상)했다.

   ① SCHEDULE_INPUT_KEYS ⊇ scheduler가 읽는 state 슬라이스
      누락 시 selectSchedule 캐시가 거짓 히트 → 그 슬라이스 변경에 stale 스케줄(전탭 오작동).
   ② LOADERS(features/registry) 키 === TABS(shell/tabs) 키
      한쪽만 추가 시 런타임 "알 수 없는 탭" 카드 or 죽은 로더.
============================================================ */
import { describe, expect, it } from 'vitest';
import { schedule } from '@/lib/scheduler';
import { defaults } from '@/lib/persistence';
import { SCHEDULE_INPUT_KEYS } from '@/store/selectors';
import { LOADERS } from '@/features/registry';
import { TABS, GROUP_LABELS, navGroups, surfaceOf, SURFACES } from '@/shell/tabs';
import type { AppState } from '@/lib/types';

/* Proxy 내부 접근·상속 프로퍼티 등 슬라이스가 아닌 잡음 키(캐시 입력이 아님). */
const NOISE = new Set([
  'then',
  'constructor',
  'hasOwnProperty',
  'toJSON',
  'valueOf',
  'nodeType',
  'schemaVersion', // 마이그레이션 마커 — schedule 결과에 영향 없음
]);

describe('불변식 ① SCHEDULE_INPUT_KEYS는 scheduler가 읽는 슬라이스를 전부 포함한다', () => {
  it('schedule()이 읽는 최상위 state 슬라이스 ⊆ SCHEDULE_INPUT_KEYS', () => {
    // scheduler가 실제로 도는 유효 상태(오늘·지식·항목 포함).
    const base: AppState = {
      ...defaults(),
      _today: '2026-06-23',
      _knowState: { subjects: [] },
      items: [
        {
          id: 'x1',
          sid: 's1',
          name: '테스트 과목',
          subject: '테스트',
          color: '#9be83f',
          mode: 'weekly',
          weeklyHours: 3,
          chapters: [{ name: '1장', deadline: '', mastery: 0 }],
        },
      ],
    } as unknown as AppState;

    const read = new Set<string>();
    const probe = new Proxy(base, {
      get(target, prop, recv) {
        if (typeof prop === 'string') read.add(prop);
        return Reflect.get(target, prop, recv);
      },
    });

    schedule(probe as AppState);

    const declared = new Set<string>(SCHEDULE_INPUT_KEYS);
    const missed = [...read].filter((k) => {
      if (NOISE.has(k)) return false;
      if (typeof (base as unknown as Record<string, unknown>)[k] === 'function') return false;
      return !declared.has(k);
    });

    // 실패 시 missed에 담긴 키를 SCHEDULE_INPUT_KEYS에 추가하면 된다(selectors.ts).
    expect(missed).toEqual([]);
  });
});

describe('불변식 ② LOADERS(registry) ↔ TABS(tabs) 키 패리티', () => {
  it('두 원천의 탭 키 집합이 정확히 일치한다', () => {
    const loaderKeys = Object.keys(LOADERS).sort();
    const tabKeys = TABS.map((t) => t.key).sort();
    expect(loaderKeys).toEqual(tabKeys);
  });
});

// ── 불변식 ③ 표면 스위처(Wave⑥) — 표면·그룹 정합 ──
describe('불변식 ③ 나브 표면(Wave⑥) 정합', () => {
  it('모든 탭 group은 GROUP_LABELS에 라벨이 있다(고아 헤더 방지)', () => {
    for (const t of TABS) expect(GROUP_LABELS[t.group], `group '${t.group}' (${t.key})`).toBeTruthy();
  });
  it('surface 미지정 탭(전역)은 설정 그룹뿐 — 표면 소속은 study|materials로만', () => {
    for (const t of TABS) {
      if (t.surface === undefined) expect(t.group, t.key).toBe('settings');
      else expect(['study', 'materials']).toContain(t.surface);
    }
  });
  it('navGroups(surface)는 그 표면 탭 + 전역(설정)만 — 다른 표면은 누출 없음', () => {
    for (const surface of ['study', 'materials'] as const) {
      const keys = navGroups(surface).flatMap((g) => g.tabs.map((t) => t.key));
      for (const key of keys) {
        const s = surfaceOf(key);
        expect(s === surface || s === undefined, `${key} in ${surface} nav`).toBe(true);
      }
      // 전역 진입점(control·settings)은 두 표면 모두에 있어야 한다(항상 도달).
      expect(keys).toContain('control');
      expect(keys).toContain('settings');
    }
  });
  it('surfaceHome은 그 표면 소속 탭을 가리킨다(스위처 착지점 정합)', () => {
    for (const sf of SURFACES) expect(surfaceOf(sf.home)).toBe(sf.key);
  });
});
