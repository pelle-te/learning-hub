/* `cloudflare:test` 의 `env` 타입 선언. 왕복 테스트(`roundtrip.test.ts`)만 쓴다. */
import type { D1Migration } from '@cloudflare/vitest-pool-workers';

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    DB: D1Database;
    HUB_SIGNING_KEY: string;
    HUB_ADMIN_KEY: string;
    HUB_ALLOWED_ORIGINS: string;
    /** `vitest.roundtrip.config.ts` 가 공유 폴더에서 읽어 넣는다. */
    TEST_MIGRATIONS: D1Migration[];
  }
}
