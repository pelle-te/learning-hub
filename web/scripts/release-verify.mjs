#!/usr/bin/env node
/* ============================================================
   release-verify.mjs — **배포된 것이 실제로 내려오는가**를 잰다(2026-08-06).

   ## 왜 생겼나

   `stage-release-assets.mjs` 는 매니페스트가 가리키는 파일이 `dist/updates/` 에 **있는지**를
   배포 *전에* 검사한다. 그건 옳지만 거기까지다 — `dist` 와 **Cloudflare 가 실제로 내주는 것**
   사이는 그동안 아무도 안 봤다. 그 구간에서 두 번 물렸다:

   · 2026-08-01(C1) — `predeploy` 를 건너뛴 배포가 `/updates/…exe` 로 **1433B SPA 폴백 HTML**
     을 내줬다. 매니페스트는 살아 있고 서명도 유효한데 가리키는 파일이 없어, 사용자는 업데이트를
     제안받고 minisign 검증에 실패했다.
   · 2026-08-06 — 같은 증상을 배포 직후에 다시 봤다. 이번엔 **전파 지연**이었고 몇 분 뒤 정상이
     됐는데, **그 둘을 구분할 방법이 없어서** 사람이 "깨진 건가 기다리면 되나"를 손으로 재현했다.

   즉 필요한 것은 검사 하나가 아니라 **판정**이다: 폴백이면 실패, 아직이면 기다린다.

   ## 무엇을 보는가 (셋 다 봐야 판정이 된다)

   ① 매니페스트가 서빙되고 **버전이 로컬과 같다** — 아니면 배포가 안 나갔거나 옛 것이다.
   ② 매니페스트의 `signature` 가 **로컬 `.sig` 와 같다** — 다르면 모든 클라이언트가 거부한다.
   ③ `url` 이 가리키는 바이너리가 **로컬 파일과 바이트 수까지 같다** — 여기서 SPA 폴백(1433B
      `text/html`)이 잡힌다. 크기만 보면 "200 OK 니까 됐다"는 거짓 통과가 남는다(그 실측이 C1).

   ⚠ 전파는 기다린다(기본 5회 · 6초 간격). **폴백 HTML 은 안 기다린다** — 그건 시간이 고쳐 주는
     상태가 아니다(자산이 아예 등록되지 않은 것). 둘을 가르는 것이 이 스크립트의 존재 이유다.
============================================================ */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const cwd = process.cwd();
const MANIFEST = join(cwd, 'public', 'updates', 'latest.json');
const ASSETS = join(cwd, 'release-assets');
const TRIES = Number(process.env.RELEASE_VERIFY_TRIES ?? 5);
const GAP_MS = 6000;

if (!existsSync(MANIFEST)) {
  console.error('❌ public/updates/latest.json 이 없다.');
  process.exit(1);
}
const local = JSON.parse(readFileSync(MANIFEST, 'utf8'));

/* ⚠⚠ **소스 버전 ↔ 매니페스트 버전 — 이 축을 아무도 안 보고 있었다**(2026-08-06 감사 H-13).

   2026-08-01~06 동안 `tauri.conf.json` 은 **0.4.0** 인데 배포 매니페스트는 **0.3.0** 이었다.
   그 상태의 증상은 오류가 아니라 **침묵**이다: 업데이터는 *현재 버전 < 매니페스트 버전* 일 때만
   업데이트를 제안하므로, 매니페스트가 뒤처지면 아무 일도 안 일어난다. 그래서 나흘치 수정이
   사용자에게 도달하지 않은 사실을 **아무도 몰랐고**, 로드맵의 「관측 대기」 일곱 행은 시간이
   아니라 **닿지 않은 빌드**를 기다리고 있었다.

   ⚠ 배포 *시점*에 거는 것이 맞는 자리다 — 개발 중에 소스 버전을 먼저 올리는 것은 정상이라
   게이트에 넣으면 상시 거짓 경보가 된다. "릴리스한다"고 선언한 순간에만 둘이 같아야 한다. */
const CONF = new URL('../../src-tauri/tauri.conf.json', import.meta.url);
if (existsSync(CONF)) {
  const src = JSON.parse(readFileSync(CONF, 'utf8')).version;
  if (src !== local.version) {
    console.error(`❌ 소스 버전 ${src} ≠ 매니페스트 ${local.version}`);
    console.error('   → 매니페스트가 뒤처지면 업데이터는 **조용히 아무것도 제안하지 않는다**(H-13 이 그 상태였다).');
    console.error('   → `docs/릴리스.md` §2-3 대로 매니페스트를 이번 버전으로 갱신하고 다시 배포할 것.');
    process.exit(1);
  }
  console.log(`  ok 소스 ↔ 매니페스트 버전 ${src}`);
}

/** 오리진은 매니페스트의 `url` 에서 뽑는다 — 값을 두 벌로 두지 않는다. */
const first = Object.values(local.platforms ?? {})[0];
const origin = first?.url ? new URL(first.url).origin : null;
if (!origin) {
  console.error('❌ 매니페스트에 같은 오리진 url 이 없다 — 검증 대상 밖이다.');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = false;

console.log(`=== RELEASE VERIFY (${origin}) ===`);

/** 서빙되는 매니페스트. 전파 대기만 재시도한다(버전 불일치는 곧 "아직 안 올라왔다"). */
let served = null;
for (let i = 1; i <= TRIES; i++) {
  try {
    const r = await fetch(`${origin}/updates/latest.json`, { cache: 'no-store' });
    const j = await r.json();
    if (j.version === local.version) {
      served = j;
      break;
    }
    console.log(`  … 매니페스트 ${j.version} (기대 ${local.version}) — 전파 대기 ${i}/${TRIES}`);
  } catch (e) {
    console.log(`  … 매니페스트 응답 없음(${e instanceof Error ? e.message : e}) — 대기 ${i}/${TRIES}`);
  }
  if (i < TRIES) await sleep(GAP_MS);
}
if (!served) {
  console.error(`❌ 매니페스트가 ${local.version} 로 안 올라왔다 — 배포가 안 나갔거나 옛 것이 서빙 중이다.`);
  process.exit(1);
}
console.log(`  ok 매니페스트 ${served.version}`);

for (const [platform, p] of Object.entries(served.platforms ?? {})) {
  const name = decodeURIComponent(/\/updates\/([^/?#]+)$/.exec(p.url ?? '')?.[1] ?? '');
  if (!name) continue; // 외부 URL — 판정 대상 밖

  const sigPath = join(ASSETS, `${name}.sig`);
  if (existsSync(sigPath)) {
    const same = readFileSync(sigPath, 'utf8').trim() === p.signature;
    console.log(`  ${same ? 'ok' : '❌'} ${platform} 서명 ↔ 로컬 .sig`);
    if (!same) fail = true;
  } else {
    /* `.sig` 를 release-assets 에 안 두는 운용도 있다(빌드 산출물에서 바로 붙이는 경우) —
       그때는 이 축을 조용히 건너뛰되 **건너뛴다는 사실을 말한다**(침묵한 통과를 만들지 않는다). */
    console.log(`  – ${platform} 서명 대조 생략(release-assets 에 ${name}.sig 없음)`);
  }

  const localFile = join(ASSETS, name);
  const want = existsSync(localFile) ? readFileSync(localFile).byteLength : null;

  let got = null;
  for (let i = 1; i <= TRIES; i++) {
    const r = await fetch(p.url, { cache: 'no-store' });
    const type = r.headers.get('content-type') ?? '';
    const buf = new Uint8Array(await r.arrayBuffer());
    got = { status: r.status, size: buf.byteLength, type };
    /* ⚠ **폴백 HTML 은 기다리지 않는다.** 자산이 등록되지 않은 상태라 시간이 고쳐 주지 않는다.
       반대로 404·5xx 는 전파 중일 수 있으므로 재시도한다. */
    if (type.includes('text/html')) break;
    if (r.ok && (want == null || buf.byteLength === want)) break;
    console.log(`  … ${name} ${r.status}/${buf.byteLength}B — 전파 대기 ${i}/${TRIES}`);
    if (i < TRIES) await sleep(GAP_MS);
  }

  if (got.type.includes('text/html')) {
    console.error(`❌ ${platform}: ${name} 가 **SPA 폴백 HTML**(${got.size}B)로 내려온다 — 자산이 등록되지 않았다.`);
    console.error('   → `npm run release:stage` 를 건너뛴 배포이거나 자산 업로드가 빠졌다(C1 과 같은 상태).');
    fail = true;
  } else if (want != null && got.size !== want) {
    console.error(`❌ ${platform}: ${name} 크기 불일치 — 서빙 ${got.size}B ≠ 로컬 ${want}B`);
    fail = true;
  } else if (!(got.status >= 200 && got.status < 300)) {
    console.error(`❌ ${platform}: ${name} HTTP ${got.status}`);
    fail = true;
  } else {
    console.log(`  ok ${platform} 바이너리 ${got.size}B (${got.type})`);
  }
}

console.log(`\nRESULT: ${fail ? '❌ 배포가 사용자에게 닿지 않는다' : '✅ 배포 도달 확인'}`);
process.exit(fail ? 1 : 0);
