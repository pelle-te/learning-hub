// Flat config (ESLint 9). FSD식 단방향 의존을 강제한다:
//   app → features → components → {hooks, store} → lib   (역방향 import 금지)
//   hooks = React 훅 레이어(lib만 import). app/features/components가 소비.
// eslint-plugin-boundaries가 src/ 하위 폴더를 '레이어'로 보고 위반을 error로 잡는다.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
import reactHooks from 'eslint-plugin-react-hooks';

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
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            { from: 'app', allow: ['features', 'components', 'hooks', 'store', 'lib'] },
            { from: 'features', allow: ['components', 'hooks', 'store', 'lib'] },
            { from: 'components', allow: ['hooks', 'lib'] },
            { from: 'hooks', allow: ['lib'] },
            { from: 'store', allow: ['lib'] },
            { from: 'lib', allow: ['lib'] },
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
);
