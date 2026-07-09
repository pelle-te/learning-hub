// Flat config (ESLint 9). FSD식 단방향 의존을 강제한다:
//   app → features → components → store → lib   (역방향 import 금지)
// eslint-plugin-boundaries가 src/ 하위 폴더를 '레이어'로 보고 위반을 error로 잡는다.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  // e2e(Playwright)는 별도 러너·tsconfig 밖 → 앱 lint에서 제외(Playwright가 자체 처리).
  { ignores: ['dist', 'dev-dist', 'node_modules', 'e2e/**', 'playwright.config.ts', 'test-results/**', 'playwright-report/**'] },
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
        { type: 'features', pattern: '**/src/features/**' },
        { type: 'components', pattern: '**/src/components/**' },
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
            { from: 'app', allow: ['features', 'components', 'store', 'lib'] },
            { from: 'features', allow: ['components', 'store', 'lib'] },
            { from: 'components', allow: ['lib'] },
            { from: 'store', allow: ['lib'] },
            { from: 'lib', allow: ['lib'] },
          ],
        },
      ],
    },
  },
  // web/scripts/*.mjs — Node 도구(gate·scaffold-tab·bundle-budget). Node 전역 허용.
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
);
