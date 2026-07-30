#!/usr/bin/env node
/* ============================================================
   stage-release-assets.mjs — 릴리스 바이너리를 **배포 직전에만** `dist/updates/` 에 넣는다.
   사용: cd web && npm run build && npm run release:stage   (그 다음 wrangler deploy)

   ## 왜 이 스크립트가 생겼나 (H12 · 2026-07-30 감사)

   `web/dist` 는 **두 소비자**가 같이 쓴다:

     · `server/wrangler.jsonc`  assets.directory  = "../web/dist"   ← 폰·업데이트 자산을 서빙
     · `src-tauri/tauri.conf.json` frontendDist   = "../web/dist"   ← 데스크톱 번들에 통째로 들어감

   그런데 인스톨러가 `public/updates/` 에 있었다. Vite 는 `public/` 을 dist 로 복사하므로
   `러닝허브_0.2.0_x64-setup.exe`(7.16MB)가 **다음 데스크톱 인스톨러 안에** 실렸다 — 그리고
   그 인스톨러를 다시 `public/updates/` 에 두면 **매 릴리스마다 크기가 배로 불어난다.**
   두 예산 축은 `dist/assets` 만 훑으므로 이 오염을 **원리적으로 못 본다**(그래서 `bundle-budget.mjs`
   에 세 번째 축을 같이 넣었다 — 검출기 없는 규약은 흘러내린다).

   ## 고친 방식 — 결합을 끊는 자리는 `public/` 이다

   인스톨러는 `web/release-assets/`(gitignore · 빌드 입력이 아님)에 두고, **`npm run build` 뒤에**
   이 스크립트가 `dist/updates/` 로 복사한다. 그러면:

     · `npm run tauri:build` 는 `beforeBuildCommand` 로 `npm run build` 를 먼저 돌리고, 그 빌드가
       `dist` 를 비우므로(emptyOutDir) 데스크톱 번들은 **정의상** 인스톨러를 못 담는다.
     · 배포 경로만 스테이징을 한 줄 더 친다 — 그 한 줄이 "누가 이 바이너리를 원했나"의 답이다.

   ## 그리고 매니페스트가 가리키는 파일이 실제로 있는지 **여기서** 검사한다

   종전 절차서는 배포 *후* `curl -I` 로 200 을 확인하라고 적었는데, 그건 이미 나간 뒤다(그리고
   그 확인은 캐시 때문에 한 번 거짓 통과한 이력이 있다 — `docs/릴리스.md` §2-4 의 ⚠). `latest.json`
   의 `url` 이 `/updates/<파일>` 을 가리키면 그 파일이 `dist/updates/` 에 있어야 한다는 것은
   **배포 전에 로컬에서 판정 가능한 사실**이다. 여기서 실패하는 편이 사용자가 404 를 받는 것보다 낫다.
============================================================ */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const cwd = process.cwd();
const SRC = join(cwd, 'release-assets');
const DEST = join(cwd, 'dist', 'updates');

if (!existsSync(join(cwd, 'dist'))) {
  console.error('❌ dist 가 없다 — 먼저 `npm run build`.');
  process.exit(1);
}

/* ⚠ 폴더가 없거나 비어도 **조용히 통과시키지 않는다.** 이 스크립트가 아무것도 안 했는데 녹색이면
   배포는 매니페스트만 나가고 다운로드 URL 은 404 가 된다(그게 C3 이 고친 바로 그 상태다). */
const staged = existsSync(SRC) ? readdirSync(SRC).filter((f) => statSync(join(SRC, f)).isFile()) : [];
mkdirSync(DEST, { recursive: true });
for (const f of staged) {
  copyFileSync(join(SRC, f), join(DEST, f));
  console.log(`  + updates/${f}  (${(statSync(join(SRC, f)).size / 1024 / 1024).toFixed(2)} MB)`);
}

/* 매니페스트가 같은 오리진(`/updates/…`)으로 가리키는 파일이 실제로 스테이징됐는가.
   외부 URL(GitHub 등)은 우리가 판정할 수 없으므로 건드리지 않는다. */
const manifestPath = join(DEST, 'latest.json');
if (!existsSync(manifestPath)) {
  console.error('❌ dist/updates/latest.json 이 없다 — public/updates/latest.json 이 빌드에 안 실렸다.');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
let failed = false;
for (const [platform, p] of Object.entries(manifest.platforms ?? {})) {
  const m = /\/updates\/([^/?#]+)$/.exec(p.url ?? '');
  if (!m) continue; // 같은 오리진이 아니면 판정 대상 밖
  const name = decodeURIComponent(m[1]);
  if (existsSync(join(DEST, name))) {
    console.log(`  ok ${platform} → ${name}`);
  } else {
    console.error(`❌ ${platform}: latest.json 이 가리키는 ${name} 이(가) dist/updates 에 없다.`);
    console.error(`   → web/release-assets/ 에 두고 다시 실행. (배포하면 사용자가 404 를 받는다)`);
    failed = true;
  }
  if (!p.signature) {
    console.error(`❌ ${platform}: signature 가 비어 있다 — 모든 클라이언트가 업데이트를 거부한다.`);
    failed = true;
  }
}

console.log(`\nRESULT: ${failed ? '❌ 스테이징 불완전' : `✅ 스테이징 완료 (${staged.length}개)`}`);
process.exit(failed ? 1 : 0);
