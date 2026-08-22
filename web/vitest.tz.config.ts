import { defineConfig } from 'vitest/config';
import path from 'node:path';

/* ============================================================
   vitest.tz.config.ts — **시간대 매트릭스**(C052 · 2026-08-22 코드 축 1회차).

   ## 왜 별도 설정인가

   `C043` 이 이 설정을 요구했다: `since.ts` 가 저널 델타를 **UTC 날짜**로 세는데 비교 대상은
   **로컬 날짜**여서, KST 오전에 쓴 요약이 배지에서 영구히 누락됐다. 그 결함은 몇 달 살아
   있었고 짝 테스트(`test/since.test.ts`)는 내내 초록이었다 — 픽스처가 `Date.parse('2026-08-03')`
   = **UTC 자정**이라 UTC 표현과 로컬 표현이 *우연히* 같았기 때문이다.

   ⚠⚠ 요점은 픽스처를 고치는 것으로 안 끝난다는 것이다: **`TZ=UTC` 에서는 어떤 픽스처를 써도
   두 표현이 같아 판별력이 0** 이다. 즉 이 부류는 «어느 시간대에서 도는가»가 검사의 일부다.
   개발 머신은 `Asia/Seoul` 이고 CI 는 `UTC` 라, 지금까지 두 환경이 **서로 다른 것을 재면서**
   둘 다 «전량 녹색»을 보고했다.

   ## 무엇을 두 번 도는가 — 그리고 왜 전량이 아닌가

   날짜·시각을 다루는 파일만 돈다(`INCLUDE`). 전량을 두 번 돌리면 12초가 24초가 되는데,
   시간대와 무관한 케이스가 그 비용의 대부분이다. ⚠ 목록이 손유지인 것이 이 설정의 유일한
   유지 비용이고, 그것을 감수하는 대신 **부류 자체**는 불변식 ⑳(`toISOString()` 으로 날짜를
   자르지 않는다)이 소스 전량에서 막는다 — 두 축이 짝이다(하나가 표본, 하나가 문법).

   ## 시간대 둘을 고른 이유

   · `Asia/Seoul`(UTC+9) — 로컬 **오전**이 UTC 로는 전날이 된다(동쪽 실패).
   · `America/Los_Angeles`(UTC−7/−8) — 로컬 **밤**이 UTC 로는 다음 날이 된다(서쪽 실패).
   둘은 대칭이라 한쪽만으로는 반대 부호의 실수를 못 잡는다. ⚠ 머신 기본 시간대에 기대지 마라 —
   그러면 검사 결과가 «누가 돌렸는가»에 의존한다(이 항목이 고치는 상태가 정확히 그것이다).
============================================================ */

/** 날짜·시각 의미를 다루는 테스트 — 시간대가 바뀌면 답이 달라질 수 있는 것만. */
const INCLUDE = [
  'test/since.test.ts',
  'test/icsParse.test.ts',
  'test/ics.test.ts',
  'test/utils.test.ts',
  'test/scheduler.test.ts',
  'test/dayPlans.test.ts',
  'test/semester.test.ts',
  'test/reviewQueue.test.ts',
  'test/quickCapture.test.ts',
];

const 공통 = {
  environment: 'node' as const,
  include: INCLUDE,
  setupFiles: ['./test/_setup.ts'],
  testTimeout: 15_000,
};

/* ⚠ `resolve.alias` 는 **프로젝트마다** 줘야 한다 — 루트에 두면 하위 프로젝트가 상속하지 않고
   `Cannot find package '@/lib/…'` 로 18파일이 통째로 죽는다(실측 · vitest 4.1). `server.fs.allow`
   도 같다: `db/migrations.ts` 가 `../../src-tauri/migrations/*.sql` 를 `?raw` 로 든다. */
const 해석 = {
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: { fs: { allow: [path.resolve(import.meta.dirname, '..')] } },
};

export default defineConfig({
  ...해석,
  test: {
    projects: [
      { ...해석, test: { ...공통, name: 'tz-east', env: { TZ: 'Asia/Seoul' } } },
      { ...해석, test: { ...공통, name: 'tz-west', env: { TZ: 'America/Los_Angeles' } } },
    ],
  },
});
