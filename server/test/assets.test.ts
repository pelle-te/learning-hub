/* ============================================================
   assets.test.ts — **정적 자산 라우팅**(C-6 동일 오리진 서빙)을 진짜 workerd 로 잠근다.

   ## 이 파일이 책임지는 명제 둘

   ① **`/api/*` 는 사용자 워커에 간다** — 자산 워커가 가로채지 않는다.
   ② **그 밖의 경로는 index.html 로 폴백한다** — 폰에서 `/plan` 을 새로고침해도 404 가 아니다.

   ⚠ ①과 ②는 `run_worker_first: ["/api/*"]` **한 줄에 함께 걸려 있다.** 실측(근거는
   `wrangler.jsonc` 주석의 표)에 따르면 그 줄을 빼도 `/api/*` 는 여전히 워커에 닿는데,
   그건 "자산이 없어서 흘러온" 것이라 **`web/dist` 에 `/api/…` 이름의 파일이 생기는 순간
   깨진다**. 동시에 ②는 그 줄이 없으면 **즉시** 깨진다(`/plan` → Hono 404).

   그래서 이 파일은 ①을 "지금 통과하는가"로 재지 않고 **의도된 경로로 통과하는가**로 잰다 —
   ②가 함께 녹색이어야만 ①이 우연이 아니라는 뜻이 된다. 설계서 §6 P1-6 의 요구가 그것이다.

   그 실패 모드는 **정적 검사·타입체크·`contract.test.ts`·`roundtrip.test.ts` 가 전량 녹색인
   상태에서** 터진다(설정 파일 한 줄이고, 코드가 아니다). 이 저장소가 네 번 물린 부류다.

   ## ⚠ 왜 `roundtrip.test.ts` 가 아니라 여기인가 — 실측 근거

   처음엔 roundtrip 에 넣으려 했다. **안 된다.** `@cloudflare/vitest-pool-workers` 0.18.6 의
   `SELF` 는 `miniflare.assets` 를 줘도 **자산 라우터를 거치지 않고** 사용자 워커로 곧장
   들어간다(실측: `SELF.fetch('/')` → Hono 의 404 text/plain). 풀 내부를 계측해
   `hasAssetsAndIsVitest=true` · `runnerWorker.assets=true` 까지 확인했는데도 그랬다 —
   즉 **그 층에서는 원리적으로 못 재는 것**이지 설정을 덜 준 게 아니다.

   그래서 Miniflare 를 **직접** 띄운다. 같은 workerd 이고, 자산 라우터가 실제로 앞에 선다
   (위 판정을 이 파일이 통과하는 것 자체가 증거다). 트랙 A/B 를 나눈 사상과 같다:
   **무효화되는 도구로 무효화되지 않았음을 증명하지 않는다.**

   ## ⚠ 설정을 손으로 베끼지 않는다

   라우팅 설정은 `wrangler.jsonc` 를 wrangler 자신에게 번역시켜 받는다
   (`unstable_getMiniflareWorkerOptions`). 여기서 옵션을 손으로 적으면 **테스트가 배포와 다른
   것을 검사**하게 되고, 그건 이 저장소가 `rows.ts` ↔ `rows.rs` 로 두 번 물린 divergence 다.
   `run_worker_first` → `routerConfig.static_routing.user_worker` 변환도 wrangler 가 한다.

   ⚠ **`../web/dist` 가 필요하다**(`cd web && npm run build`). 없으면 조용히 건너뛰지 않고
   **시끄럽게 실패**한다 — "녹색인데 아무것도 안 쟀다"를 만들지 않는다(CLAUDE.md 규율).
============================================================ */
import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';

const DIST = '../web/dist';
const BASE = 'https://hub.example';

let mf: Miniflare;

beforeAll(async () => {
  /* 환경 가정을 단언한다(testkit.rs 의 `환경_가정_…` 과 같은 규율). */
  expect(existsSync(DIST), `${DIST} 가 없다 — 정적 자산 라우팅을 잴 수 없다. 먼저 \`cd web && npm run build\`.`).toBe(
    true,
  );

  /* 배포와 **같은** 라우팅 설정을 wrangler 에게서 받는다. */
  const wrangler = await import('wrangler');
  const config = wrangler.unstable_readConfig({ config: './wrangler.jsonc' });
  const assets = wrangler.unstable_getMiniflareWorkerOptions(config).workerOptions.assets;
  expect(assets, 'wrangler.jsonc 에 assets 가 없다 — C-6 동일 오리진 서빙이 꺼진 것이다.').toBeTruthy();

  /* ⚠ 사용자 워커는 **스텁**이다. 진짜 Hono 앱을 넣지 않는 이유: 여기서 재는 명제는
     "라우터가 어느 쪽으로 보내는가" 하나이고, 스텁이면 워커에 도달했는지가 **418 하나로
     모호함 없이** 드러난다. Hono 를 넣으면 "404 가 자산 404 인지 Hono 404 인지"를
     본문으로 추론해야 한다. 앱 자체의 동작은 `roundtrip.test.ts` 가 이미 전담한다. */
  mf = new Miniflare({
    modules: true,
    script: `export default { fetch(req) {
      return new Response('USER_WORKER ' + new URL(req.url).pathname, { status: 418 });
    } }`,
    compatibilityDate: config.compatibility_date,
    assets,
  });
});

afterAll(async () => {
  await mf?.dispose();
});

/* ⚠ `redirect: 'manual'` 을 줄 수 있어야 한다 — 루트가 302 를 내는지 보려면 따라가면 안 된다(C047). */
const get = (path: string, init?: RequestInit) => mf.dispatchFetch(`${BASE}${path}`, init);

describe('⚠⚠ /api/* 가 SPA 폴백에 삼켜지지 않는다(run_worker_first)', () => {
  it.each([
    '/api/health',
    '/api/token',
    '/api/sync/pull?since=0',
    '/api/sync/push',
    '/api/enroll/claim',
    '/api/devices',
    '/api/이런건없다',
    /* ⚠⚠ **루트가 여기 있는 이유**(C047 · 2026-08-22). 종전엔 SPA 폴백이 `/` 에 **데스크톱
       엔트리**(`index.html`)를 줬다. 그 엔트리는 `enableBrowserDb()` 를 안 부르므로 브라우저에서
       `isSqlitePrimary()` 가 거짓이고 저장이 localStorage 로 흐른다 — 아웃박스는 SQLite 만 훑으니
       **그 편집은 영원히 올라가지 않는다.** 화면엔 아무 표시도 없다. 북마크·주소 자동완성·공유
       링크로 실제로 도달하는 문이었다. 이제 `run_worker_first` 가 루트를 워커로 보내고 워커가
       `/phone` 으로 302 한다. ⚠ **여기서 재는 것은 라우팅뿐이다**(사용자 워커는 스텁이다) —
       302 와 `Location` 자체는 진짜 Hono 를 태우는 `roundtrip.test.ts` 가 잰다. */
    '/',
  ])('%s → 사용자 워커', async (path) => {
    const r = await get(path);
    /* 418 은 스텁 워커만 낼 수 있는 값이다. 200/text-html 이 오면 자산 워커가 API 를
       가로챈 것이고, 그게 이 파일이 존재하는 이유다. */
    expect(r.status, `${path} 가 사용자 워커에 닿지 않았다 — 자산 워커가 API 를 가로챘다`).toBe(418);
    expect(r.headers.get('content-type') ?? '').not.toContain('text/html');
  });
});

describe('정적 자산·SPA 폴백', () => {
  /* ⚠⚠ **이 케이스는 «`/` 가 index.html 을 준다» 였다 — 뒤집었다**(C047 · 2026-08-22 코드 축).

     그 단언이 지키던 것은 «루트에서 **데스크톱 SPA** 가 뜬다» 였는데, 데스크톱 엔트리는
     `enableBrowserDb()` 를 안 부르므로 브라우저에서 `isSqlitePrimary()` 가 거짓이고 저장이
     localStorage 로 흐른다. 아웃박스는 SQLite 만 훑는다 → **그 편집은 영원히 동기화되지 않는다.**
     화면에는 아무 표시가 없다. 즉 **테스트가 옛 계약을 지키고 있었다는 것이 그 결함의 절반**이었다.
     지금 계약은 «루트는 폰으로 보낸다» 이고, 데스크톱 SPA 는 명시 경로에만 열린다. */
  it('폰 엔트리가 뜬다 — 루트 리다이렉트가 가리키는 곳이 실재해야 한다', async () => {
    const r = await get('/phone');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/html');
  });

  it('데스크톱 SPA 는 명시 경로에서 계속 열린다 — 문을 옮긴 것이지 닫은 것이 아니다(C047)', async () => {
    const r = await get('/today');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/html');
    expect(await r.text()).toContain('<!DOCTYPE html>');
  });

  it('⚠ 클라이언트 라우트가 index.html 로 폴백한다 — 폰에서 새로고침해도 404 가 아니다', async () => {
    /* SPA 폴백이 없으면 폰에서 `/plan` 을 새로고침하는 순간 404 다. `react-router` 를 쓰는 한
       이건 선택이 아니라 요구다(`not_found_handling: single-page-application`). */
    for (const path of ['/plan', '/today', '/settings/cloud']) {
      const r = await get(path);
      expect(r.status, `${path} 가 폴백하지 않았다`).toBe(200);
      expect(r.headers.get('content-type')).toContain('text/html');
    }
  });

  it('⚠ 존재하지 않는 자산 경로도 폴백한다 — 라우팅이 "우연"이 아님의 증거', async () => {
    /* 이 케이스가 녹색이어야 `/api/*` 통과가 **명시 라우팅** 덕분임이 확정된다.
       `run_worker_first` 가 없으면 여기가 사용자 워커(418)로 새고, 그때 `/api/*` 통과는
       그저 fallthrough 였다는 뜻이 된다(`wrangler.jsonc` 주석의 실측 표). */
    const r = await get('/이런자산은없다.js');
    expect(r.status, '자산 미스가 사용자 워커로 샜다 — 자산 라우팅이 명시적이지 않다').toBe(200);
    expect(r.headers.get('content-type')).toContain('text/html');
  });

  it('해시 붙은 번들이 그대로 나온다', async () => {
    /* ⚠⚠ **`/index.html` 로 읽지 마라**(C047 · 2026-08-22). 자산 워커는 `/index.html` 을
       **정규 URL `/` 로 307** 하는데, 이제 `/` 는 사용자 워커가 받아 `/phone` 으로 보낸다 —
       즉 이 오리진에서 `/index.html` 은 더 이상 데스크톱 HTML 을 읽는 길이 아니다.
       (그 307 을 `dispatchFetch` 가 조용히 따라가던 것이 종전 이 케이스가 통과하던 이유였고,
       그 사실은 아무 데도 안 적혀 있었다.) SPA 폴백 경로로 읽는다. */
    const r = await get('/today');
    const html = await r.text();
    /* index.html 이 참조하는 실제 번들을 뽑아 확인한다 — 파일명을 손으로 적으면
       다음 빌드에 깨진다(해시가 바뀐다). */
    const m = /src="(\/assets\/[^"]+\.js)"/.exec(html);
    expect(m, 'index.html 에서 번들 참조를 못 찾았다 — dist 가 깨졌거나 빌드 형식이 바뀌었다').toBeTruthy();
    const js = await get(m![1]!);
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type') ?? '').toMatch(/javascript/);
  });
});

describe('⚠ 자산 응답의 캐시 헤더 — "옛 번들 고착"을 막는다', () => {
  /* ## 관측 결과와 판단(추측 아님)

     `index.ts` 의 `no-store` 미들웨어는 `app.use('/api/*', …)` 로 **이미 API 에만** 걸려
     있다(그 미들웨어 머리주석 참조). 그리고 자산은 애초에 Hono 를 **거치지 않는다**(자산 워커 전담)
     — 두 겹으로 자산에는 안 붙는다.

     자산 워커가 HTML 에 붙이는 값은 실측으로 `public, max-age=0, must-revalidate` 였다.
     `no-store` 는 아니지만 **요구되는 성질은 같다**: `max-age=0` + `must-revalidate` 는
     캐시가 재검증 없이 못 쓰게 하므로 사용자가 옛 index.html 에 고착되지 않는다. 굳이
     `no-store` 로 바꾸려면 `_headers` 파일(= `web/` 빌드 산출물)이나 자산을 워커로 끌어와
     직접 서빙하는 코드가 필요한데, 얻는 것(304 대신 200)보다 대가가 크다 → **바꾸지 않고
     성질을 여기서 잠근다.** 값이 아니라 **성질**을 단언하는 이유가 이것이다. */
  it('HTML 은 재검증 없이 재사용되지 않는다', async () => {
    /* ⚠ `/` 가 아니라 `/today` 를 쓴다 — 루트는 이제 워커로 간다(C047). 재는 것은 **자산 워커가**
       HTML 에 붙이는 헤더다. */
    const cc = (await get('/today')).headers.get('cache-control') ?? '';
    expect(cc, `HTML 이 재검증 없이 캐시된다 — 옛 번들 고착 위험(관측값: "${cc}")`).toMatch(
      /no-store|no-cache|max-age=0|must-revalidate/,
    );
  });

  it('자산 응답에 API 용 no-store 가 새어 붙지 않는다', async () => {
    /* `no-store` 를 전 응답에 걸면 해시 붙은 번들까지 매번 다시 받는다(폰은 대개 셀룰러다). */
    const cc = (await get('/today')).headers.get('cache-control') ?? '';
    expect(cc).not.toContain('no-store');
  });
});
