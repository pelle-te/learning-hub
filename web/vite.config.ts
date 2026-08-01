import { defineConfig } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import { VitePWA } from 'vite-plugin-pwa';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { readFileSync } from 'node:fs';

/* ── D-9 폰 precache 는 **폰 그래프**여야 한다 (결함 수정) ────────────────────
   종전 `globPatterns: ['phone.html','icon.svg']` 는 껍데기의 **절반만** 구웠다: 폰 엔트리가
   참조하는 JS·CSS·워커·wasm 은 전부 precache 밖이고 런타임 CacheFirst 에만 의존했다.
   그래서 **배포 직후 오프라인 첫 로드가 흰 화면**이 된다 — 새 `phone.html` 은 precache 에서
   나오는데 그것이 참조하는 **새 해시 청크**는 캐시에 없기 때문이다(데이터는 OPFS 에 멀쩡한데).
   설정 주석이 "지하철에서 열면 껍데기가 없으면 아무것도 안 뜬다"고 그 시나리오를 정확히
   적어 두고 있었다.

   해법은 파일명 추측이 아니라 **관측**이다: `dist/.vite/manifest.json`(예산 게이트가 이미
   쓰는 그 그래프)에서 `phone.html` 의 전이 폐포를 뽑는다. 데스크톱 청크를 폰에 굽지 않는
   판단은 그대로다 — 폐포에 안 들어오면 자동으로 빠진다.

   ⚠ 동적 import 도 따라간다. 폰의 첫 화면(`PhoneApp`)·DB(`browserDb`)가 전부 lazy 라
     정적 imports 만 따라가면 "셸은 뜨는데 화면이 안 뜨는" 반쪽을 또 만든다.
   ⚠ SQLite 워커·wasm 은 매니페스트 그래프 **밖**에서 방출된다(별도 엔트리) → 이름으로 잡는다.
     844KB(gz 393)라 첫 설치는 비싸지만, 해시 파일명이라 **바뀔 때만** 다시 받는다. 그리고
     폰은 SQLite 가 정본이라 그것 없이는 오프라인에서 화면만 뜨고 데이터가 0이다.
   ⚠ 폰트는 여전히 제외(2MB · `font-display: swap` 이라 없어도 즉시 뜬다).
   ⚠ 매니페스트를 못 읽으면 **precache 를 넓히지 않고** 옛 최소 집합으로 되돌아간다 —
     실패 모드가 "데스크톱 청크까지 폰에 굽기"가 되면 안 된다. */
const PHONE_EXTRA = /^assets\/sqlite.*\.(?:js|wasm)$/; // 워커·wasm(그래프 밖에서 방출 · 이름으로 잡는다)
/* ⚠ **precache 에서 빼는 것**(위 패턴이 이름으로 쓸어 담은 것 중 실제로는 안 도는 것).
   `sqlite3-worker1-*.js`(206KB · **gz 61KB**)는 `sqlite3Worker1Promiser.defaultConfig.worker`
   팩토리 안에서만 참조된다 — 그리고 우리는 그 promiser 를 **한 번도 부르지 않는다**(전 소스에
   `promiser`·`worker1` 참조 0 · 우리 워커는 `installOpfsSAHPoolVfs` 를 직접 쓴다). 즉 폰 첫
   설치 데이터의 10.5% 가 실행되지 않는 파일이었다.
   ⚠ `sqlite3-opfs-async-proxy` 는 **일부러 남긴다.** 그건 COOP/COEP 가 있을 때 쓰는 `opfs`
   VFS 의 짝이라 "안 쓴다"를 배포 헤더까지 확인하지 않고는 단정할 수 없고, 틀리면 증상이
   **오프라인에서만** 나타난다(가장 늦게 발견되는 자리). 61KB 를 확실히 얻고 10KB 는 남긴다. */
const PHONE_PRECACHE_SKIP = /^assets\/sqlite3-worker1-/;
const PHONE_SHELL = new Set(['phone.html', 'icon.svg', 'manifest.webmanifest']);

function phoneGraphFiles(): Set<string> | null {
  try {
    const m = JSON.parse(readFileSync(path.resolve(import.meta.dirname, 'dist/.vite/manifest.json'), 'utf8')) as Record<
      string,
      { file?: string; css?: string[]; assets?: string[]; imports?: string[]; dynamicImports?: string[] }
    >;
    const seen = new Set<string>();
    const out = new Set<string>();
    const walk = (key: string): void => {
      const c = m[key];
      if (!c || seen.has(key)) return;
      seen.add(key);
      if (c.file) out.add(c.file);
      for (const f of c.css ?? []) out.add(f);
      for (const f of c.assets ?? []) out.add(f);
      for (const dep of [...(c.imports ?? []), ...(c.dynamicImports ?? [])]) walk(dep);
    };
    walk('phone.html');
    return out.size ? out : null;
  } catch {
    return null;
  }
}

// serve.js(:8000)가 백엔드 /api. Vite는 :5173에서 React 셸을 띄우고 /api는 프록시(동일출처처럼).
// Phase 6: vite-plugin-pwa 정식화 — 셸 precache + 자동 업데이트(stale 캐시 해소). /api는 캐시 제외(NetworkOnly).
// dev에선 SW 비활성(HMR 간섭 회피) — 프로덕션 빌드에서만 SW 생성/등록.
export default defineConfig({
  plugins: [
    react(),
    // React Compiler(React 19) — 컴포넌트를 빌드타임에 자동 메모이제이션.
    // 수동 memo/useMemo/useCallback 없이도 불필요한 리렌더를 제거(프레임워크 최대 활용).
    //
    // ⚠ vite 6→8 배선 변경(2026-07-19): plugin-react 6 은 `babel` 옵션을 없앴다. Vite 8 이
    //   esbuild→Rolldown 으로 갈아타면서 babel 통로가 별도 플러그인(@rolldown/plugin-babel)으로
    //   분리됐고, 컴파일러는 plugin-react 가 내보내는 `reactCompilerPreset` 로 얹는다.
    //   옛 `target: '19'` 는 뺐다 — 그 옵션은 17/18(구버전 React) 지정용이고 19 가 기본이다.
    babel({ presets: [reactCompilerPreset()] }),
    /* Tailwind v4 — **폰 웹앱 전용 파일럿**(설계서 §5-3). 플러그인은 전역이지만 실제로는
       `@import 'tailwindcss'` 를 쓰는 CSS 파일에서만 산출물이 생기고, 그건 지금
       `src/phone/phone.css` 하나다. 즉 기존 CSS Modules 59장 베이스라인은 안 건드린다.
       규약(테마를 tokens.css 에서 파생 · 임의값 금지 · 브레이크포인트 미사용)은
       `phone.css` 머리주석이 소유한다 — C-7 본편이 그걸 승계한다. */
    tailwindcss(),
    VitePWA({
      // ⚠ 서비스워커 은퇴(selfDestroying) — 이 앱은 localhost + serve.js /api 백엔드가 떠 있어야만 동작하는
      //    도구라 오프라인 PWA의 이득이 사실상 0인데, SW precache가 빌드 후에도 옛 번들을 물어 "안 바뀐다"
      //    마찰만 매일 줬다(수동 unregister 강요). selfDestroying SW를 배포하면 다음 로드 때 기존 등록을
      //    스스로 해제+캐시 청소하고 사라진다 → 그 뒤론 일반 새로고침만으로 즉시 반영. PWA 복구는 이 한 줄 제거.
      /* ⚠ C-6 — `selfDestroying` 을 껐다. 이유는 **오리진이 갈렸기 때문**이다.
         옛 판단("오프라인 이득 0")은 앱이 `localhost:8000` + serve.js 로 뜨던 시절 것이고,
         그 오리진은 4단계-G 에서 죽었다. 지금 SW 가 살 수 있는 오리진은 **폰이 도는
         Workers 오리진 하나**뿐이다 — 데스크톱 셸은 `tauri://` 로컬 파일을 물고, 트랙 A 는
         `serviceWorkers: 'block'` 이다. 즉 이 SW 는 정의상 폰에만 붙는다.
         폰에는 오프라인 이득이 실재한다: 지하철에서 열면 앱 껍데기가 없으면 아무것도 안 뜬다
         (데이터는 OPFS SQLite 에 이미 있는데도). */
      selfDestroying: false,
      registerType: 'autoUpdate',
      /* ⚠ 자동 주입을 끈다 — 켜 두면 **데스크톱 `index.html` 에도** 등록 코드가 박힌다.
         등록은 `phone/main.tsx` 가 명시적으로 한다(§5-2 "셸 빌드에선 제거"). */
      injectRegister: null,
      workbox: {
        /* ⚠ 모든 js 를 precache 하지 않는다 — dist 에는 데스크톱 청크 20여 개가 함께 있고,
           폰이 그걸 전부 미리 받으면 셀룰러에서 수백 KB 를 낭비한다(예산 게이트가 엔트리를
           나눈 것과 같은 이유). 그 경계를 **파일명이 아니라 그래프**로 긋는 것이 D-9 다. */
        /* ⚠ 폰트(2MB 가변 Pretendard)는 precache 에서 뺐다 — 첫 방문이 셀룰러일 수 있는데
           껍데기 하나 받자고 2MB 를 선불하는 것은 값이 안 맞는다. `font-display: swap` 이라
           없으면 시스템 폰트로 즉시 뜨고, 아래 런타임 캐시가 한 번 받은 뒤로 오프라인을 덮는다. */
        /* 넓게 모아서 **그래프로 좁힌다**(D-9). 좁히는 일은 아래 manifestTransforms 가 한다 —
           glob 만으로는 "폰이 실제로 참조하는 것"을 표현할 방법이 없다(파일명은 추측이다). */
        globPatterns: ['phone.html', 'icon.svg', 'manifest.webmanifest', 'assets/**/*.{js,css,wasm}'],
        manifestTransforms: [
          (entries) => {
            const graph = phoneGraphFiles();
            const keep = entries.filter((e) => {
              const url = e.url.replace(/^\//, '');
              if (PHONE_SHELL.has(url)) return true;
              if (!graph) return false; // 매니페스트 실패 → 옛 최소 집합으로 안전하게 축소
              if (PHONE_PRECACHE_SKIP.test(url)) return false;
              return graph.has(url) || PHONE_EXTRA.test(url);
            });
            const warnings = graph ? [] : ['[pwa] dist/.vite/manifest.json 을 못 읽어 폰 셸만 precache 했습니다.'];
            return { manifest: keep, warnings };
          },
        ],
        /* ⚠⚠ **폴백을 `/phone` 으로 좁힌다 — 안 좁히면 SW 가 오리진 전체를 먹는다**
           (2026-08-01 · 라이브 배포 첫날 사용자 보고 → 재현으로 확인).

           ## 무슨 일이 났나

           `navigateFallback` 은 **모든 내비게이션 요청**에 대해 그 문서를 돌려준다. 데스크톱 셸이
           `tauri://` 로컬 파일이던 동안에는 이 SW 가 폰 오리진에만 살아서 해가 없었다. 그런데
           C-6 이후 **같은 Workers 오리진에서 `index.html`(웹) 과 `phone.html`(폰) 이 함께 나간다.**
           그래서 사용자가 `/phone` 을 **한 번이라도** 열면 SW 가 등록되고, 그 뒤로는 같은 오리진의
           `/`·`/items`·`/today` 전부가 **폰의 등록 코드 화면**으로 바뀐다. 웹 진입점이 통째로
           도달 불가가 된다(캐시를 지우기 전까지 · `registerType:'autoUpdate'` 라 되돌아오지도 않는다).

           ## 왜 어느 게이트도 못 잡았나 — 이게 이 주석의 요점이다

           · 트랙 A(`visual`·`a11y`): `serviceWorkers: 'block'` 이다. **정의상 SW 를 안 본다.**
           · `phone.spec.ts`: 폰이 뜨는지와 OPFS 가 생기는지만 본다 — *다른 엔트리에 미치는 영향*은
             그 스펙의 관심사가 아니다.
           · 트랙 B: `tauri://` 라 SW 가 없다.
           · 로컬 `npm run dev`: SW 를 안 만든다(빌드 산출물이다).
           즉 **"두 엔트리가 한 오리진을 공유한다"는 사실 자체가 어느 하네스에도 표현돼 있지 않았다.**
           프로브를 새 컨텍스트로 돌리면 매번 초록이라(SW 미등록) 나도 첫 확인에서 놓쳤다.

           ## 규칙

           폰은 **라우터가 없다** — 탭이 상태이고 경로는 `/phone` 하나다(`PhoneApp.tsx` 의 `goTab`).
           그러니 폴백이 필요한 URL 도 그 하나뿐이다. 허용 목록으로 못박아 두면 폰에 라우터가
           생기더라도 여기를 먼저 고치게 된다(조용히 번지지 않는다).
           ⚠ 웹 루트(`index.html`)는 precache 대상이 아니므로 **오프라인 지원이 원래 없다** —
             네트워크로 가는 것이 정직한 동작이지 손실이 아니다. */
        navigateFallback: 'phone.html',
        navigateFallbackAllowlist: [/^\/phone(?:\.html)?$/],
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
          { urlPattern: /\/api\//, handler: 'NetworkOnly' }, // 서버/외부 데이터는 캐시 안 함(설계도 §6)
          {
            /* 해시 파일명이라 내용이 바뀌면 URL 이 바뀐다 → 캐시 우선이 안전하다.
               wasm 도 여기 걸린다(sqlite 864KB — 매번 받으면 폰에서 아프다). */
            urlPattern: /\/assets\/.*\.(?:js|css|wasm)$/,
            handler: 'CacheFirst',
            options: { cacheName: 'phone-assets', expiration: { maxEntries: 60 } },
          },
          {
            urlPattern: /\/fonts\/.*\.woff2$/,
            handler: 'CacheFirst',
            options: { cacheName: 'phone-fonts', expiration: { maxEntries: 4 } },
          },
        ],
      },
      manifest: {
        name: '러닝 허브',
        short_name: '러닝허브',
        description: '졸업까지 한눈에 · 볼트/Anki 현황을 스케줄로 · 일과 빈 시간 자동 계산',
        theme_color: '#050506',
        background_color: '#050506',
        display: 'standalone',
        start_url: '/',
        lang: 'ko',
        categories: ['education', 'productivity'],
        // SVG 단일 아이콘(any+maskable) — 벡터라 모든 사이즈 대응(설치형 앱 아이콘).
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      devOptions: { enabled: false }, // dev 서버에선 SW 등록 안 함
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  build: {
    /* ⚠ 매니페스트를 낸다 — `scripts/bundle-budget.mjs` 가 **엔트리별** 다운로드량을 재는
       근거다. 엔트리가 둘이 된 뒤로 "assets 폴더 총합"은 아무도 받지 않는 수치가 됐다
       (데스크톱 사용자는 폰 청크를 안 받고, 그 반대도 마찬가지). 파일명 prefix 추측 대신
       그래프를 따라가야 정확하다. */
    manifest: true,
    // vendor 청크 분할 — 자주 안 바뀌는 의존성을 별도 파일로 빼 브라우저 캐시 적중률↑.
    // 옛 단일 365KB index.js → react 코어(안정)·라우팅/상태/스키마(vendor)·앱 코드로 3분할.
    /* ⚠ 엔트리가 둘이다(C-6). `index.html` = 데스크톱 셸, `phone.html` = 폰 웹앱.
       폰이 데스크톱 셸을 재사용하지 않는 이유는 설계서 §9-4 절충안 + C-6 착수 실측:
       `features/schedule` 하위 컴포넌트가 `useApp` 을 직접 불러 "선별 재사용"이 성립하지
       않는다. 그래서 화면만 새로 짜고 `lib/`(scheduler·tasks·events·cloud)는 공유한다. */
    rollupOptions: {
      input: {
        main: path.resolve(import.meta.dirname, 'index.html'),
        phone: path.resolve(import.meta.dirname, 'phone.html'),
      },
      output: {
        /* ⚠ C-6 — 옛 규칙은 `node_modules` 를 **전부** `vendor` 한 덩어리로 묶었다. 엔트리가
           하나일 땐 캐시 적중률에 좋은 선택이었지만, 폰 엔트리가 생기자 **폰이 안 쓰는
           react-router·tanstack-query·cmdk 를 63.9KB 통째로 받는** 결과가 됐다(실측).
           덩어리 하나는 "누가 뭘 쓰는지"를 표현할 수 없다.

           그래서 react 코어만 고정 분리하고(둘 다 쓰고 거의 안 바뀐다) 나머지는 번들러가
           엔트리 그래프를 보고 쪼개게 둔다 — 공유분은 공유 청크로, 전용분은 그 엔트리에만. */
        manualChunks(id) {
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
          return undefined;
        },
      },
    },
  },
  /* ⚠ `/api` 프록시를 제거했다(4단계-G) — 프록시할 대상(`serve.js`)이 없어졌다.
     그래서 **브라우저 `npm run dev` 에는 백엔드가 없다**: 산출물·도구·AI·볼트가 전부 셸 전용이다.
     개발 중 그 기능을 만지려면 `npm run tauri:dev` 로 띄운다(같은 Vite dev 서버를 셸 안에서
     로드하므로 HMR 은 그대로다). 이 문장이 없으면 다음 세션이 "dev 에서 아티팩트가 안 뜬다"를
     결함으로 오진한다. */
  /* ⚠ `fs.allow` — `db/migrations.ts`(C-6a)가 루트 밖 `../src-tauri/migrations/*.sql` 를
     `?raw` 로 든다. SQL 을 web/ 으로 복사하면 허용목록은 안 건드려도 되지만, 그 복사본이
     정확히 이 저장소가 두 번 물린 divergence 다(`rows.ts`↔`rows.rs`). 원본을 공유한다. */
  server: { port: 5173, fs: { allow: [path.resolve(import.meta.dirname, '..')] } },
});
