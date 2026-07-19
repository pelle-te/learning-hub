import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Vitest 전용 설정(플러그인 없음 → vite.config.ts의 react/pwa 플러그인 타입과 분리).
// 순수 lib 로직은 node 환경(기본). 컴포넌트 테스트(RTL·.test.tsx)는 파일 상단
// `// @vitest-environment jsdom` 프라그마로 jsdom에서 돈다.
//
// JSX 변환: 옛 `esbuild: { jsx: 'automatic' }` 를 제거했다(vite 6→8). Vite 8 은 트랜스포머가
// esbuild→oxc 로 바뀌어 그 키 자체가 없어졌고, automatic 이 기본이라 명시가 불필요하다.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  /* ⚠ `db/migrations.ts` 가 `../../src-tauri/migrations/*.sql` 를 `?raw` 로 든다 — 루트(web/)
     **밖**이라 기본 fs 허용목록에 안 걸린다. 마이그레이션 SQL 을 web/ 으로 복사하는 대신
     허용목록을 넓히는 이유는 단순하다: 복사본이 곧 이 저장소가 두 번 물린 divergence 다. */
  server: { fs: { allow: [path.resolve(import.meta.dirname, '..')] } },
  test: {
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      // 앱 소스만 계측(엔트리·타입선언·CSS모듈 제외 → 분모 왜곡 방지).
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/**/*.d.ts', 'src/vite-env.d.ts', 'src/lib/artifacts.gen.ts'],
      reporter: ['text-summary', 'html'],
      /* 게이트: 현재값 바로 아래로 고정 — 통과는 보장하되 하락은 막는 래칫.

         ⚠ 2026-07-19 vitest 2→4 재기준선. **테스트가 줄어서가 아니라 계측 방식이 바뀌었다** —
         같은 752개 테스트에서 분모가 크게 이동했다(statements 21443→9405, branches 5042→7230,
         functions 1329→2809). 즉 옛 임계값(69/69/72/51)은 더 이상 같은 양을 가리키지 않는다.
         새 실측(2회 관측): st 68.66~68.78 · br 55.68~56.29 · fn 59.91~60.87 · ln 69.89~69.91.
         branches 가 72→55 로 내려간 건 커버리지 후퇴가 아니라 분모가 43% 늘어난 결과이고,
         functions 는 오히려 51→59 로 **올렸다**(같은 이유로 분자 비율이 개선됨).
         착시 주의: 두 러너의 %는 서로 비교하면 안 된다 — 비교는 이 기준선 이후로만.

         ⚠ 임계는 관측 *최저치* 아래로 잡는다(평균·최고치가 아니라). 같은 커밋을 두 번 돌렸는데
         fn 60.87→59.91, br 56.29→55.68 로 흔들렸다 — 타이머·인터벌처럼 실행 타이밍에 따라
         타는 경로가 갈리는 코드가 있다는 뜻이다. 최고치에 붙여 고정하면 코드 변경 없이도
         CI 가 빨간불이 되는 flaky 게이트가 된다. */
      /* ⚠ 2단계(SQLite) 후 재확인 — **재기준선이 필요 없었다.** 설계 §5는 "1·2단계에서 Tauri
         래퍼가 분모를 늘리니 임계를 다시 잡아야 한다"고 예상했지만, 실측은 반대로 **올랐다**:
         st 68.98~69.39 · br 56.81~56.91 · fn 60.92~61.24 · ln 70.25~70.50.
         이유는 새로 들어온 코드(`lib/db/`)가 순수 매퍼라 오히려 잘 덮였기 때문이다 —
         Tauri에 닿는 얇은 IO만 미검증으로 남았다(그게 매퍼와 IO를 가른 이유이기도 하다).
         임계는 그대로 둔다. 관측 변동폭이 ±0.3 이라 최저치에 붙여 올리면 flaky 게이트가 된다. */
      thresholds: { lines: 69, statements: 68, branches: 55, functions: 59 },
    },
  },
});
