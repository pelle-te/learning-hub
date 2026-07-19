/* ============================================================
   vitest.config.ts — **노드에서 도는** 빠른 층(계약·SQL 의미론).

   ## 두 층을 나눈 이유

   · 여기(`npm test`)      — `node:sqlite` 로 SQL 의미론과 순수 로직만 본다. 밀리초 단위다.
   · `npm run test:roundtrip` — **진짜 workerd + 진짜 D1**. 라우팅·미들웨어 순서·인증 왕복처럼
     런타임이 있어야만 존재하는 것들을 본다(`vitest.roundtrip.config.ts` 머리주석).

   ⚠ `roundtrip.test.ts` 를 여기서 **제외**한다 — `cloudflare:test` 모듈은 workers 풀에서만
   존재해서, 노드 설정이 집어 들면 import 단계에서 죽는다. 원리적으로 다른 런타임이라
   같은 설정에 담을 수 없다(트랙 A/B 를 나눈 것과 같은 사상: 무효화되는 도구로 무효화되지
   않았음을 증명하지 않는다).
============================================================ */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.ts'], exclude: ['test/roundtrip.test.ts'] },
});
