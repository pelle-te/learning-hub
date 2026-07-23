// Flat config (ESLint 9). FSD식 단방향 의존을 강제한다:
//   app → features → components → {hooks, store} → lib   (역방향 import 금지)
//   hooks = React 훅 레이어(lib만 import). app/features/components가 소비.
// eslint-plugin-boundaries가 src/ 하위 폴더를 '레이어'로 보고 위반을 error로 잡는다.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import sonarjs from 'eslint-plugin-sonarjs';
import betterTailwind from 'eslint-plugin-better-tailwindcss';

export default tseslint.config(
  // e2e(Playwright)는 별도 러너·tsconfig 밖 → 앱 lint에서 제외(Playwright가 자체 처리).
  {
    ignores: [
      'dist',
      'dev-dist',
      'node_modules',
      'e2e/**',
      'playwright.config.ts',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // React Hooks 규칙(rules-of-hooks·exhaustive-deps) + react-compiler 규칙.
  // 컴파일러는 Rules of React를 지킨 컴포넌트만 메모이즈하므로(위반 시 조용히 bail),
  // 이 린트가 위반을 빌드 전에 잡아 자동최적화 적용률을 보장한다(Phase 7 컴파일러 채택 완성).
  reactHooks.configs.flat['recommended-latest'],
  /* 접근성 회귀 방어(2026-07-19 플랫폼 감사 ⑥) — aria-* 406회·role= 132회를 전부 수작업으로
     관리하면서 자동 검증이 0이었다. SPA 접근성의 어려운 부분(라우트 아나운서·문서 제목 동기화·
     포커스 복원)은 이미 손으로 제대로 해놨는데, 정작 값싼 린트가 빠져 있어 신규 코드의 퇴행을
     못 잡았다. jsx-a11y 는 aria 속성명 오타·role 대비 필수 속성 누락·상호작용 요소의 키보드
     핸들러 부재 같은 '기계가 잡을 수 있는 것'만 담당한다(나머지는 여전히 사람 몫). */
  { ...jsxA11y.flatConfigs.recommended, files: ['src/**/*.tsx'] },
  /* 코드 품질 게이트(0단계-F) — sonarjs를 **recommended 없이** 규칙 2개만 켠다.
     recommended는 217규칙이고 실측 위반 249건 중 181건이 스타일 취향
     (no-nested-conditional 130 · no-nested-assignment 20 · void-use 18 ·
     no-nested-template-literals 13)이다. 그 노이즈가 신호(cognitive-complexity 34 ·
     super-linear-regex 2)를 묻는 게 정적분석 도구 도입의 주 실패 모드라, 신호만 취한다.
     recommended가 jsx-a11y·react-hooks 규칙 사본까지 물고 오는 것도 피한다(위에서 이미 켬).
     ※ 이 목록을 늘리려면 먼저 실측하고 "노이즈:신호" 비율을 근거로 남길 것. */
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { sonarjs },
    rules: {
      /* 인지복잡도 **래칫** — 임계는 현재 최댓값(77 · TodaySignature)에 맞춰져 있고
         **내려가기만 한다**. 기본값 15로 조이면 즉시 34건이 터져 0-F가 리팩터 작업이 되는데,
         0단계는 "플랫폼 무관 선행"이지 리팩터 단계가 아니다. 지금 막는 건 *새로 생기는* 괴물뿐.
         ⚠ 6단계(Tailwind)는 CSS를 JSX로 옮겨 이 수치를 밀어올린다 → max-lines와 함께 재기준선.
         현황은 `npm run report:debt`. */
      'sonarjs/cognitive-complexity': ['error', 77],
      // ReDoS — 실측 2건을 0단계-F에서 제거했고(vault 프론트매터·quickCapture 챕터) 재발을 막는다.
      // 이건 취향이 아니라 입력이 커지면 멈추는 버그라 임계 없이 error.
      'sonarjs/super-linear-regex': 'error',
    },
  },
  /* 파일 크기 래칫 — 임계는 현재 최댓값(844 · TodaySignature)이고 내려가기만 한다.
     주석·빈 줄 제외: 이 저장소는 "왜"를 주석으로 남기는 걸 규약으로 삼는데(결정로그와 짝),
     주석을 줄 수에 세면 규약을 지킬수록 게이트가 조여지는 역인센티브가 된다.
     ⚠ 730 → 844 재기준선(C-7 today 이식): 위 인지복잡도 주석이 예고한 대로, CSS Module(988줄)이
     JSX 로 들어오며 TodaySignature.tsx 가 729→844 로 밀렸다. 클래스 문자열은 `const S={}` 로 모아
     JSX 줄 수를 눌렀지만 상태맵·유틸 문자열이 순증한다. 이식이 끝나면 다시 내려갈 여지를 본다. */
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: { 'max-lines': ['error', { max: 844, skipBlankLines: true, skipComments: true }] },
  },
  // atlasData.ts는 진로 아틀라스 시드 **데이터**(779줄)다 — 분할해도 복잡도가 줄지 않는 상수 테이블이라
  // 크기 래칫의 대상이 아니다(코드가 아니라 데이터라는 것이 예외 사유).
  {
    files: ['src/lib/atlasData.ts'],
    rules: { 'max-lines': 'off' },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      // boundaries는 eslint-module-utils/resolve로 import 경로를 실제 파일에 매핑한다.
      // TS 리졸버가 .ts/.tsx 확장자와 @/* 별칭(tsconfig paths)을 둘 다 해결한다.
      'import/resolver': {
        typescript: { project: './tsconfig.app.json' },
      },
      // 패턴은 '**/' 접두(절대경로 매칭) — boundaries가 Windows에서 rootPath(역슬래시)와
      // 정규화된 경로(슬래시) 불일치로 상대경로 변환에 실패해, 패턴이 절대경로와 대조되기 때문.
      'boundaries/elements': [
        { type: 'app', pattern: '**/src/app/**' },
        // ⚠ feature끼리의 결합은 이 규칙이 못 잡는다 — 모든 feature 폴더가 한 element라
        //   'features → features'로 통과한다. capture로 폴더명을 잡으려 했으나 위 '**/' 접두
        //   (Windows 절대경로 우회)와 함께 쓰면 캡처가 바인딩되지 않는다. 대신 아래
        //   no-restricted-imports가 '@/features/*' 별칭을 막아 같은 경계를 강제한다.
        { type: 'features', pattern: '**/src/features/**' },
        { type: 'components', pattern: '**/src/components/**' },
        { type: 'hooks', pattern: '**/src/hooks/**' },
        { type: 'store', pattern: '**/src/store/**' },
        { type: 'lib', pattern: '**/src/lib/**' },
      ],
    },
    rules: {
      // 진입점(main.tsx 등 레이어 미매칭 파일)·CSS import는 검사 제외
      'boundaries/no-unknown-files': 'off',
      'boundaries/no-unknown': 'off',
      /* v5→v7 마이그레이션(2026-07-19): `boundaries/element-types` → `boundaries/dependencies`,
         `rules` → `policies`, 그리고 from/allow 가 문자열이 아니라 **엔티티 셀렉터**
         (`{ element: { type } }`)를 받는다. 옛 표기도 아직 돌지만 deprecation 경고를 내고
         다음 메이저에서 제거된다 — 레이어 강제는 절대규칙(CLAUDE.md #2)이라 조용히 무력화될
         자리에 낡은 API를 두지 않는다. */
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            {
              from: { element: { type: 'app' } },
              allow: [
                { to: { element: { type: 'features' } } },
                { to: { element: { type: 'components' } } },
                { to: { element: { type: 'hooks' } } },
                { to: { element: { type: 'store' } } },
                { to: { element: { type: 'lib' } } },
              ],
            },
            {
              from: { element: { type: 'features' } },
              allow: [
                { to: { element: { type: 'components' } } },
                { to: { element: { type: 'hooks' } } },
                { to: { element: { type: 'store' } } },
                { to: { element: { type: 'lib' } } },
              ],
            },
            {
              from: { element: { type: 'components' } },
              allow: [{ to: { element: { type: 'hooks' } } }, { to: { element: { type: 'lib' } } }],
            },
            { from: { element: { type: 'hooks' } }, allow: [{ to: { element: { type: 'lib' } } }] },
            { from: { element: { type: 'store' } }, allow: [{ to: { element: { type: 'lib' } } }] },
            { from: { element: { type: 'lib' } }, allow: [{ to: { element: { type: 'lib' } } }] },
          ],
        },
      ],
    },
  },
  /* feature↔feature 결합 금지 — boundaries가 못 보는 경계를 여기서 막는다.
     cross-feature import는 전부 '@/features/...' 별칭을 쓰고 같은 feature 안은 './'를 쓰므로,
     features 폴더 안에서 그 별칭을 금지하면 정확히 교차 결합만 걸린다.
     공유가 필요하면 components/hooks/lib으로 승격할 것(그래야 재사용 계약이 명시된다). */
  {
    files: ['src/features/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features/*'],
              message:
                'feature끼리 직접 import 금지 — 같은 feature는 상대경로(./), 공유물은 components/hooks/lib으로 승격하세요.',
            },
          ],
        },
      ],
    },
  },
  // registry.tsx는 모든 feature를 lazy 로드하는 *레지스트리*라 이 금지의 유일한 정당한 예외.
  {
    files: ['src/features/registry.tsx'],
    rules: { 'no-restricted-imports': 'off' },
  },
  // web/scripts/*.mjs — Node 도구(gate·scaffold-tab·bundle-budget). Node 전역 허용.
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },

  /* ── Tailwind 규약 집행자(C-6 파일럿 → C-7 본편) ─────────────────────────────
     `stylelint` 이 CSS 에서 강제하던 2가지(브레이크포인트 허용목록 · 생 hex 금지)는
     클래스가 JSX 로 옮겨가면 **검사 대상 밖으로 나간다.** 결정로그가 그 사실을 짚어 뒀다:
     _"규율은 소멸이 아니라 `better-tailwindcss` 로 **집행자만 교체**된다."_ 여기가 그 교체다.

     ⚠ 지금은 `src/phone/**` 만 대상이다. C-7 이 feature 를 하나씩 옮길 때마다 이 목록을
     넓힌다 — 한 번에 전체를 켜면 아직 CSS Modules 인 파일에서 오탐만 쏟아진다.

     ⚠⚠ **설계서의 가정 하나가 틀렸다**: `플랫폼개편-설계.md` §4-6단계는 _"`[max-width:820px]`
     임의값은 better-tailwindcss 의 **임의값 룰**을 명시적으로 켜야 막힌다"_ 고 적었는데,
     v4.7.0 에 그런 룰은 **없다**(룰 15개 전량 확인). 대신 `no-restricted-classes` 의
     `restrict` 패턴으로 막는다 — 결과는 같고 수단이 다르다. */
  {
    files: [
      'src/phone/**/*.tsx',
      'src/features/alloc/**/*.tsx',
      'src/features/discovery/**/*.tsx',
      'src/features/review-run/**/*.tsx',
      'src/features/guide/**/*.tsx',
      'src/features/goals/**/*.tsx',
      'src/features/control/**/*.tsx',
      'src/features/atlas/**/*.tsx',
      'src/features/review/**/*.tsx',
      'src/features/mastery/**/*.tsx',
      'src/features/ledger/**/*.tsx',
      'src/features/integrations/**/*.tsx',
      'src/features/degree/**/*.tsx',
      'src/features/journal/**/*.tsx',
      'src/features/markets/**/*.tsx',
      'src/features/reads/**/*.tsx',
      'src/features/settings/**/*.tsx',
      'src/features/stats/**/*.tsx',
      'src/features/items/**/*.tsx',
      'src/features/today/**/*.tsx',
      'src/features/schedule/**/*.tsx',
    ],
    plugins: { 'better-tailwindcss': betterTailwind },
    settings: { 'better-tailwindcss': { entryPoint: 'src/styles/tw.css' } },
    rules: {
      'better-tailwindcss/no-unknown-classes': 'error',
      'better-tailwindcss/no-conflicting-classes': 'error',
      'better-tailwindcss/no-duplicate-classes': 'error',
      'better-tailwindcss/enforce-consistent-class-order': 'error',
      /* 임의값 금지 — 토큰 사다리를 우회하는 통로를 막는다(`phone.css` 규약 3).
         ⚠ **C-7 이 예외를 둘 갖게 된다. 지금 미리 적어 둔다 — 그때 발견하면 이미 늦다:**
         ① **반픽셀 font-size**(9.5/10.5/11.5px) — `stylelint.config.js:17-22` 가 왜 반픽셀
            금지를 일부러 안 넣었는지 기록한다: 월 캘린더 `.cell` 이 고정 행 높이 +
            `overflow:hidden` 이라 0.5px 상향이 **과목 칩을 통째로 잘라먹은** 실사고가 있다.
            Tailwind `text-*` 는 정수 사다리라 그 값들이 전부 임의값이 된다.
         ② **런타임 CSS 변수 인라인 주입** — `--seg` 4곳 · `--sub` · `--tint` 2곳. 동적 색은
            **정의상 정적 클래스로 표현 불가**다. 이건 절대규칙 #3(색은 파생물)의 구현이라
            없앨 수 없다. 예외로 파야 한다. */
      'better-tailwindcss/no-restricted-classes': [
        'error',
        {
          /* ⚠ 패턴을 셋으로 갈랐다(C-7 review-run 이식에서 발견). 처음엔 대괄호를 **전부**
             막았는데, 그러면 `data-[kind=confident]:bg-warn` 같은 **변형 셀렉터**까지 걸린다 —
             그건 임의값이 아니라 관계형 스타일을 표현하는 정공법이고, 이 저장소가 CSS 에서
             속성 셀렉터로 하던 것의 Tailwind 대응물이다. 막으면 `.badge[data-kind]` 류를
             옮길 방법이 사라진다. 막아야 할 것은 **값**이지 셀렉터가 아니다. */
          restrict: [
            {
              pattern: '.*[[].*?[0-9](?:px|rem|em|%|vw|vh|ch|deg).*',
              message:
                '임의 수치 금지 — 간격은 --sp-*, 타이포는 --fs-* 사다리에서 온다. 유동값(clamp 등)은 tokens.css 에 이름을 주고 브리지에 연결하세요.',
            },
            {
              pattern: '.*[[]#.*',
              message: '임의 색 금지 — 색은 tokens.css 의 의미론 토큰에서만 온다(절대규칙 #3).',
            },
            {
              pattern: '.*[[]&.*',
              message:
                '임의 변형(`[&_em]:`) 금지 — 자손 셀렉터를 되살리는 통로다. 자식에 직접 클래스를 주도록 JSX 를 고치세요(그게 6단계가 요구하는 구조 변경이다).',
            },
          ],
        },
      ],
    },
  },
);
