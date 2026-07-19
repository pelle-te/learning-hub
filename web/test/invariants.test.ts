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
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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

/* ============================================================
   불변식 ④ — **JS 가 읽는 CSS 토큰은 실제로 정의돼 있다** (6단계/C-7 선행조건)

   왜 이게 불변식이 되어야 하는가: `플랫폼개편-설계.md` §4-6단계가 "조용히 깨지는 것 3종"
   으로 지목한 항목이다. Tailwind 의 `@theme` 는 **미사용으로 보이는 토큰을 트리셰이킹**
   하는데, 아래 파일들은 토큰을 **JS 에서만** 읽으므로 Tailwind 눈에는 안 쓰이는 것으로 보인다.

   그리고 그 셋은 **전부 폴백값을 갖고 있다**(`Graph.tsx` 의 `|| fb` · `AmbientCanvas` 의
   `|| [0.02,…]`). 즉 토큰이 사라져도 **에러가 안 나고 틀린 색으로 렌더된다.**

   더 나쁜 것은 시각 게이트가 이걸 못 잡는다는 점이다 — 0단계-G 에서 실증됐다:
   `maxDiffPixelRatio: 0.02` + 단일 계열 팔레트라 **과목 색 전량 교체가 스냅샷 59장을
   통과했다.** 6단계는 정의상 스냅샷을 대량 재생성하므로 그때 이 축은 완전히 무방비가 된다.

   ⚠ 파일 목록을 손으로 적지 않는다 — `getComputedStyle` 을 쓰는 파일을 **찾아서** 판다.
   네 번째 파일이 생겨도 자동으로 걸린다(손 목록은 반드시 드리프트한다).

   ## ⚠ 이 테스트가 못 잡는 것 (과대평가 금지)

   여기서 보는 것은 **원천(`tokens.css`)에 선언돼 있는가**이지 **빌드된 CSS 에 살아남았는가**가
   아니다. 후자는 실제 번들을 봐야 하고 그건 e2e 의 몫이다. 그래도 이 테스트가 값이 있는 이유:
   C-7 이 토큰을 `@theme` 로 **옮기면** 여기가 즉시 빨간불이 된다 — "토큰의 집이 바뀌었으니
   JS 로 읽는 3곳을 손보라"는 신호가 정확히 그 시점에 온다. 조용히 지나가지 않는 것이 목적이다.
============================================================ */
describe('불변식 ④ JS 에서 읽는 CSS 토큰이 tokens.css 에 정의돼 있다', () => {
  /* ⚠ `import.meta.url` 을 안 쓴다 — 이 파일은 jsdom 환경이라 그 값이 `http:` 스킴이고
     `fileURLToPath` 가 던진다(실제로 물렸다). vitest 는 `web/` 에서 도므로 cwd 가 안전하다. */
  const SRC = join(process.cwd(), 'src') + '/';

  /** `src/` 전체에서 `getComputedStyle` 을 쓰는 파일 경로. */
  function readersOfCssVars(): string[] {
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && readFileSync(p, 'utf8').includes('getComputedStyle')) out.push(p);
      }
    };
    walk(SRC);
    return out;
  }

  const tokensCss = readFileSync(join(SRC, 'styles', 'tokens.css'), 'utf8');
  const readers = readersOfCssVars();

  it('토큰을 JS 에서 읽는 파일이 존재한다(0개면 이 불변식이 아무것도 안 잰다)', () => {
    // ⚠ 조용한 통과 방지 — 정규식이 망가지거나 경로가 바뀌면 0개가 되고, 그건 녹색이 아니라 고장이다.
    expect(readers.length).toBeGreaterThanOrEqual(3);
  });

  it('그 파일들이 참조하는 --토큰이 전부 tokens.css 에 정의돼 있다', () => {
    const missing: string[] = [];
    for (const file of readers) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/'(--[a-z][\w-]*)'/g)) {
        const name = m[1]!;
        // 정규식을 안 쓴다 — 토큰명에 `-` 가 많아 이스케이프 실수가 나기 쉽고, 실제로 한 번
        // 물렸다(전부 '없음'으로 나왔다). `--acc:` 는 `--acc2:` 에 안 걸리므로 문자열이면 충분하다.
        if (!tokensCss.includes(`${name}:`)) missing.push(`${file.replace(SRC, '')} → ${name}`);
      }
    }
    expect(missing, `tokens.css 에 없는 토큰:\n${missing.join('\n')}`).toEqual([]);
  });
});
