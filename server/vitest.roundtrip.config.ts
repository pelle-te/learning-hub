/* ============================================================
   vitest.roundtrip.config.ts — **진짜 workerd + 진짜 D1** 위에서 도는 왕복 테스트.

   ## 왜 별도 설정인가

   기본 `vitest.config` 는 노드에서 순수 로직·SQL 의미론만 본다(`contract.test.ts`). 그건
   빠르지만 **원리적으로 못 잡는 부류**가 있다 — 라우팅·미들웨어 순서·인증 왕복·D1 바인딩·
   실제 HTTP 상태코드. 이 저장소는 그 부류에 **세 번** 물렸다:

   · 2단계  "빌드 녹색인데 아무것도 저장 안 됨"
   · C-4    삭제 부활(SQL 의미론) — 로컬 wrangler 로 쏴 보고서야 드러남
   · C-5    CSP 가 웹뷰 fetch 를 차단 — 트랙 B 프로브로 드러남

   그때마다 문서는 _"띄워보지 않으면 모른다"_ 고 적었지만 **그 층을 만들지는 않았다.**
   2026-07-20 감사가 잡은 pull 페이지네이션 결함이 정확히 네 번째였다(유닛은 목이고,
   트랙 A 는 Chromium, 트랙 B 는 클라우드 경로를 안 탄다 → 전량 녹색). 여기가 그 층이다.

   ⚠ `wrangler dev` 를 spawn 하지 않는다 — 부팅이 느리고 포트 경합으로 흔들린다. 대신
   `@cloudflare/vitest-pool-workers` 가 **같은 workerd 런타임**을 인프로세스로 띄우고
   `wrangler.jsonc` 의 D1 바인딩을 그대로 쓴다. 마이그레이션은 공유 폴더에서 읽어 적용한다.
============================================================ */
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

/* ⚠ 마이그레이션을 **공유 폴더에서 읽는다**(`src-tauri/migrations/`). 테스트가 DDL 을 따로
   들면 그 사본이 진짜 스키마와 갈리고, 그게 이 저장소가 두 번 물린 divergence 다.
   `wrangler.jsonc` 의 `migrations_dir` 와 **같은 경로**를 가리키는 것이 요점이다. */
const migrations = await readD1Migrations('../src-tauri/migrations');

export default defineConfig({
  plugins: [
    cloudflareTest({
      singleWorker: true,
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        // 실제 배포에서는 `wrangler secret` 이 넣는 값. 테스트에서는 고정값을 준다.
        bindings: {
          HUB_SIGNING_KEY: 'test-signing-key-do-not-use-in-production',
          HUB_ADMIN_KEY: 'test-admin-key-do-not-use-in-production',
          HUB_ALLOWED_ORIGINS: 'https://phone.example',
          TEST_MIGRATIONS: migrations,
        },
      },
    }),
  ],
  test: { include: ['test/roundtrip.test.ts'] },
});
