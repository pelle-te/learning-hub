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
import { TABS, GROUP_LABELS, navGroups, destinations, SUBTAB_GROUPS, tabByKey, subTabGroupOf } from '@/shell/tabs';
import { NAV_SHORTCUTS } from '@/shell/shortcuts';
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
describe('불변식 ③ 나브 그룹 정합', () => {
  it('모든 탭 group은 GROUP_LABELS에 라벨이 있다(고아 헤더 방지)', () => {
    for (const t of TABS) expect(GROUP_LABELS[t.group], `group '${t.group}' (${t.key})`).toBeTruthy();
  });
  /* ⚠ 옛 '표면 정합' 3케이스는 N-6 과 함께 사라졌다 — 표면이 없으니 "다른 표면으로 누출"이라는
     사건 자체가 표현 불가능해졌다(테스트를 지운 게 아니라 지킬 대상이 없어진 것이다).
     그 케이스들이 실제로 지키던 것 — **전역 진입점은 어디서든 도달 가능** — 만 남긴다. */
  /* ⚠ **2026-07-29(E13/IA 재편)에 다시 쓰였다.** 옛 문구는 _"설정 그룹 진입점(control·settings)은
     항상 레일에 선다"_ 였는데, 그건 지키려던 것("전역 진입점은 어디서든 도달 가능")보다 **좁은
     명제**였다 — 레일에 서는 것은 도달 가능성의 여러 수단 중 하나일 뿐이다. `control` 은 콜드
     게이트라(워크스페이스 없으면 본문이 안내문) 상시 목적지 자리를 회수했고, 대신 시스템 호스트의
     세그먼트로 내려왔다. 도달 경로는 그대로 넷이다: 세그먼트 · ⌘K · `g` · 딥링크.
     지킬 대상을 정확히 적는다 — **레일이 아니라 도달성**이다. */
  it('전역 진입점(settings·control)은 도달 가능하다 — 레일이든 세그먼트든', () => {
    const rail = navGroups().flatMap((g) => g.tabs.map((t) => t.key));
    expect(rail).toContain('settings'); // 설정은 하단 앵커라 레일에 남는다
    // control 은 렌즈다 → 어느 호스트 밑에서든 세그먼트로 닿아야 한다(③-b 가 그 존재를 이미 강제한다).
    expect(subTabGroupOf('control')?.map((t) => t.key)).toContain('control');
  });
});

/* ============================================================
   불변식 ③-b — **"갈 수 있는 곳"의 열거는 하나에서 파생된다** (D-4)

   레일 / `[ ]` 링 / `g` 키 / 세그먼트가 각자 자기 목록을 갖던 시절, 멤버십이 조용히 갈렸다:
   `g o` 는 은퇴한 탭으로 갔다 튕겼고, 링은 표면 경계를 넘어 레일에 없는 곳으로 샜다.
   목적지가 사라지는 사건은 **아무 에러도 안 내므로** 손으로는 못 지킨다 — 기계로 잠근다.
============================================================ */
describe('불변식 ③-b 도달 경로(D-4) — 모든 열거가 TABS.role 에서 파생된다', () => {
  it('레일에 서는 것은 정확히 destination 이다(lens 누출 0)', () => {
    for (const t of navGroups().flatMap((g) => g.tabs)) expect(t.role, t.key).toBe('destination');
  });
  it('`[ ]` 링은 레일과 같은 목록을 돈다(같은 함수에서 파생 — 두 벌이 될 수 없다)', () => {
    expect(destinations().map((t) => t.key)).toEqual(navGroups().flatMap((g) => g.tabs.map((t) => t.key)));
  });
  it('모든 `g` 시퀀스가 실존하는 탭을 가리킨다(죽은 목적지 금지)', () => {
    for (const sc of NAV_SHORTCUTS) expect(tabByKey(sc.tab), `g ${sc.seq}`).toBeTruthy();
  });
  it('모든 세그먼트 키가 실존하고, 호스트(첫 항목)는 destination 이다', () => {
    for (const g of SUBTAB_GROUPS) {
      for (const k of g) expect(tabByKey(k), k).toBeTruthy();
      expect(tabByKey(g[0]!)?.role, `host ${g[0]}`).toBe('destination');
      for (const k of g.slice(1)) expect(tabByKey(k)?.role, `seg ${k}`).toBe('lens');
    }
  });
  it('lens 는 반드시 어느 세그먼트 그룹에 속한다(도달 경로 없는 탭 금지)', () => {
    const inGroup = new Set(SUBTAB_GROUPS.flat());
    for (const t of TABS) if (t.role === 'lens') expect(inGroup.has(t.key), `${t.key} 는 어디로도 못 간다`).toBe(true);
  });
});

/* ============================================================
   불변식 ③-c — **키를 등록하는 화면은 그 키를 설명한다** (E19 · 2026-07-29)

   이 저장소는 키 계약을 **주석으로** 지켰고, `useKeymap` 자체가 그 표류에서 태어났다(N-16:
   "keydown 이 27파일 85건에 흩어져 어느 화면에 어떤 키가 사는지 앱 자신도 몰랐다"). 그런데
   레지스트리를 만든 뒤에도 표류는 계속됐다 — 복습 러너는 앱에서 키가 가장 많은데 치트시트에
   없었고, 일일 배치의 `Alt+↑↓` 는 **`aria-label` 문장 하나에만** 적혀 스크린리더 사용자에게만
   문서화돼 있었다. 셋 다 **정적 검사 전량 녹색**에서 살아 있었다.

   ⚠ 범위를 **전역 리스너로 좁힌 것이 의도**다. 요소 스코프 `onKeyDown`(입력칸의 Enter 처리 등)
   까지 요구하면 폼마다 치트시트 항목이 생겨 소음이 되고, 그러면 이 불변식이 첫 주에 무력화된다.
   `document`/`window` 에 거는 키는 **그 화면에 있는 동안 어디서나 먹는다** — 그건 정의상 화면 키다.
   ⚠ 예외 목록을 두지 않는다. 예외는 반드시 썩고, 썩은 예외는 게이트가 아니라 알리바이가 된다
   (`tabs.ts` 의 `role` 이 필수 필드인 것과 같은 규율).
============================================================ */
describe('불변식 ③-c 전역 키를 거는 feature 는 치트시트에 등재한다', () => {
  const FEATURES = join(process.cwd(), 'src', 'features');
  function files(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) files(p, out);
      else if (/\.tsx?$/.test(e.name)) out.push(p);
    }
    return out;
  }
  const REGISTERS = /(document|window)\.addEventListener\(\s*['"`]keydown/;
  const DECLARES = /useKeymap(Doc)?\s*\(/;

  it('전역 keydown 을 거는 파일은 useKeymap/useKeymapDoc 을 부른다', () => {
    const offenders = files(FEATURES).filter((p) => {
      const src = readFileSync(p, 'utf8');
      return REGISTERS.test(src) && !DECLARES.test(src);
    });
    // 실패하면: 그 화면의 키를 `useKeymapDoc(scope, rows, enabled?)` 로 등재하세요.
    // 조건부로 사는 키(패널 열림 등)는 `enabled` 로 그 조건을 그대로 옮깁니다.
    expect(offenders).toEqual([]);
  });

  it('전역 키를 거는 feature 가 하나 이상 존재한다(0이면 이 불변식이 아무것도 안 잰다)', () => {
    // ⚠ 조용한 통과 방지 — 정규식이 망가지거나 경로가 바뀌면 0개가 되고, 그건 녹색이 아니라 고장이다.
    const registrars = files(FEATURES).filter((p) => REGISTERS.test(readFileSync(p, 'utf8')));
    expect(registrars.length).toBeGreaterThanOrEqual(4);
  });
});

/* ============================================================
   불변식 ④ — **JS 가 읽는 CSS 토큰은 실제로 정의돼 있다** (6단계/C-7 선행조건)

   왜 이게 불변식이 되어야 하는가: C-7(Tailwind 전환)이 "조용히 깨지는 것 3종"
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

/* ============================================================
   불변식 ⑤ — **CSS 가 참조하는 --토큰은 실제로 정의돼 있다** (④의 거울상)

   ④가 "JS 가 읽는 토큰"을 잠갔는데, **CSS 쪽에는 같은 방어가 없었다.** 그래서 이 구멍이
   실제로 뚫려 있었다: `var(--tx)` 가 3곳에서 쓰이는데 그런 토큰은 **없다**(진짜 이름은
   `--txt`). C-7 첫 feature 이식(discovery) 중에 발견했다.

   ## 왜 아무도 못 봤나 — 이게 이 불변식의 존재 이유다

   CSS 커스텀 프로퍼티는 **없는 이름을 참조해도 에러가 아니다.** 값이 무효가 되고
   `color` 는 상속으로 떨어진다. 그래서:

   - 빌드 통과 · 린트 통과 · 타입 통과 (CSS 에는 이름 검사가 없다)
   - **시각 스냅샷도 통과** — 상속된 색이 그럴듯해 보이고, `maxDiffPixelRatio: 0.02` +
     단일 계열 팔레트라 애초에 색 회귀를 못 잡는다(0단계-G 실증)

   즉 "전량 녹색인데 틀린 색으로 렌더 중"이었다. `stylelint` 의 `color-no-hex` 는 색의
   **출처**를 강제했지만 그 출처가 **실재하는지**는 아무도 안 봤다.

   ⚠ 이게 C-7 에서 특히 위험한 이유: 전환은 토큰 참조를 대량으로 옮겨 적는 작업이고,
   오타 하나가 정확히 이 형태로 조용히 통과한다.
============================================================ */
describe('불변식 ⑤ CSS 가 참조하는 --토큰이 정의돼 있다', () => {
  const SRC = join(process.cwd(), 'src') + '/';

  /** 런타임에 JS 가 인라인으로 주입하는 변수 — CSS 에 정의가 없는 것이 **정상**이다.
   *  동적 색이라 정적 선언이 불가능하다(절대규칙 #3 의 구현 · 설계서 §4-6단계). */
  const RUNTIME_INJECTED = new Set(['--seg', '--sub', '--tint']);

  function cssFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.css')) out.push(p);
      }
    };
    walk(SRC);
    return out;
  }

  const files = cssFiles();
  const all = files.map((f) => readFileSync(f, 'utf8')).join('\n');
  // 정의된 것 전부(tokens.css 든 feature 모듈이든 — 지역 변수도 정당한 정의다).
  const defined = new Set([...all.matchAll(/(--[a-z][\w-]*)\s*:/gi)].map((m) => m[1]!));

  /* ⚠ 옛 단언은 `files.length > 10` 이었다. 주석은 "0개면 아무것도 안 잰다"인데 값은 10이라,
     **통합할수록 게이트가 조여지는** 역인센티브가 됐다 — C-7 이 CSS Module 54개를 0으로 만들며
     실제로 이 줄에서 걸렸다(파일이 정확히 10개가 됐다). 카나리아가 정말로 지켜야 하는 것은
     "글롭이 아무것도 못 찾는 상태"와 "정의의 원천이 스캔 범위 밖으로 나가는 것"이므로
     개수 대신 **원천 파일의 존재**를 단언한다. */
  it('CSS 파일을 찾았다 — 특히 토큰 원천이 스캔 범위 안에 있다', () => {
    expect(files.length).toBeGreaterThan(0);
    const names = files.map((f) => f.replace(/\\/g, '/'));
    expect(names.some((n) => n.endsWith('/styles/tokens.css'))).toBe(true);
    expect(names.some((n) => n.endsWith('/styles/tokenBridge.css'))).toBe(true);
    expect(names.some((n) => n.endsWith('/styles/ds.css'))).toBe(true);
  });

  it('폴백 없는 var(--x) 참조가 전부 정의를 갖는다', () => {
    const missing: string[] = [];
    for (const f of files) {
      for (const m of readFileSync(f, 'utf8').matchAll(/var\(\s*(--[a-z][\w-]*)\s*\)/gi)) {
        const name = m[1]!;
        if (defined.has(name) || RUNTIME_INJECTED.has(name)) continue;
        missing.push(`${f.replace(SRC, '')} → var(${name})`);
      }
    }
    /* ⚠ 폴백이 있는 참조(`var(--x, 1rem)`)는 검사하지 않는다 — 그건 "없을 수 있다"를
       작성자가 **명시한** 것이라 조용한 실패가 아니다. 폴백 없는 것만이 사고다. */
    expect([...new Set(missing)], `정의 없는 토큰:\n${[...new Set(missing)].join('\n')}`).toEqual([]);
  });
});
