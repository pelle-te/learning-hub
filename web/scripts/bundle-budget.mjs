#!/usr/bin/env node
/* ============================================================
   bundle-budget.mjs — 빌드 산출물 크기 예산 게이트(**엔트리별**).
   사용: cd web && npm run build && node scripts/bundle-budget.mjs
   반환: 초과 없으면 exit 0, 하나라도 초과면 exit 1.

   CSS 도 재는 이유(2026-07-19 플랫폼 감사 ⑥): 원래 이 게이트는 `.js` 만 필터링해
   CSS 361KB(raw)가 통째로 게이트 밖에 있었다. CSS Module 54개가 feature 별로 쪼개져
   있어 대부분은 지연 로드되지만, **ds.module + tokens 가 들어가는 index.css 는 모든
   진입에 무조건 실린다** — 여기가 커지면 전 탭의 첫 페인트가 느려지는데 아무도 안 봤다.

   ## ⚠ C-6 재작성 — "폴더 총합"은 아무도 받지 않는 수치가 됐다

   엔트리가 둘이 되면서(데스크톱 `index.html` · 폰 `phone.html`) `dist/assets` 총합은
   **어느 사용자도 실제로 다운로드하지 않는 양**이 됐다. 폰은 데스크톱 탭 20개를 안 받고,
   데스크톱은 sqlite wasm 글루를 안 받는다. 그대로 뒀다면 폰 자산이 데스크톱 예산을 먹어
   "예산 초과"가 뜨는데 **데스크톱은 1바이트도 안 커진** 상태가 된다 — 게이트가 거짓말을 한다.

   그래서 `dist/.vite/manifest.json` 을 따라 **엔트리별 초기 로드 그래프**(엔트리 청크 +
   전이 `imports` + 그 CSS)를 계산한다. 파일명 prefix 매칭(옛 방식)은 추측이었고, 그래프는
   관측이다. 지연 청크(`dynamicImports`)는 초기 로드가 아니므로 **제외한다** — 그게 이 앱이
   탭을 lazy 로 쪼갠 이유이고, 합산하면 그 투자가 수치에 안 나타난다.

   ## 축이 넷이다 (H12·H14 · 2026-07-30 감사에서 둘이 붙었다)

   ① **엔트리별 초기 로드** — 매니페스트의 정적 그래프.
   ② **데스크톱 부팅 웨이브**(엔트리 + `App`) — ①이 원리적으로 못 보는 자리. `main.tsx` 가
      `App` 을 *동적으로* 부르는 것은 최적화가 아니라 부팅 순서 계약(SD-7)이라, 항상 즉시
      로드되는데도 ①의 순회에서 빠진다. 실제로 그 사각에서 14.7 KB gz 이 새고 있었다(H14).
   ③ **전체 산출물 총합** — 지연 청크·워커·wasm 까지. 폴더를 직접 훑는다.
   ④ **번들 오염** — 크기가 아니라 *무엇이 섞였는가*. ①②③은 전부 `dist/assets` 나 그래프만
      보므로 `dist/updates/*.exe` 를 못 본다. 그런데 `dist` 는 wrangler 자산 폴더이자 tauri
      `frontendDist` 라 거기 있는 모든 것이 데스크톱 번들에 실린다(H12 · 실측 7.16MB).

   ⚠ 넷의 공통점: **앞의 축이 녹색이어도 뒤의 축이 잡는 것이 따로 있다.** 축을 하나로 합치려
      할 때마다 이 목록을 먼저 읽을 것 — 셋 다 "기존 축이 못 보는 것"으로 생겼다.
============================================================ */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, relative } from 'node:path';

/* 엔트리별 예산(gzip KB). 값은 실측 대비 여유를 둔다.
   ⚠ 폰 예산이 작은 것이 의도다 — 폰은 셀룰러에서 처음 열릴 수 있고, 이 앱의 폰 화면은
   일/주 캘린더 + 할일 편집 하나다. 여기가 커지기 시작하면 그건 "폰에 데스크톱을 다시
   집어넣고 있다"는 신호다(설계서 §9-4 가 별도 번들을 고른 이유). */
const BUDGETS = {
  'index.html': { js: 160, css: 32, label: '데스크톱 셸' },
  'phone.html': { js: 120, css: 15, label: '폰 웹앱' },
};

/* ⚠⚠ **엔트리 그래프에 안 잡히는 "두 번째 웨이브"**(H14 · 2026-07-30 감사).

   `main.tsx` 는 `App` 을 **동적으로** import 한다 — 그건 최적화가 아니라 부팅 순서 계약이다
   (SD-7: `useApp` 모듈이 `initAppStore()` 보다 먼저 평가되면 셸이 낡은 localStorage 로 뜬다).
   그래서 축 ①의 정적 그래프 순회가 App 을 **원리적으로 못 본다.** 그런데 App 은 다운그레이드
   화면을 빼면 **항상, 즉시** 로드된다 — 사용자 입장에서 초기 로드다.

   실제로 그 사각에서 새고 있었다: 팔레트의 `import { FIELDS } from '@/lib/atlas'` 한 줄이
   811줄 시드(14.7 KB gz)를 이 웨이브로 끌어왔는데 **축 ①은 녹색이었다**(축 ②의 총합에만
   섞여 있어 원인을 지목하지 못한다). 정적 import 금지는 eslint(H14 블록)가 파일 단위로 막고,
   여기서는 **웨이브 전체가 불어나는 것**을 본다 — 둘은 다른 것을 잡는다.

   ⚠ 이 축은 데스크톱에만 있다. 폰은 `phone.html` 엔트리가 자기 앱을 직접 물어(SD-7 은
   데스크톱 셸의 계약이다) 축 ①이 이미 전부를 본다. */
const WAVE = { entry: 'index.html', then: 'src/app/App.tsx', js: 240, label: '데스크톱 부팅 웨이브(엔트리 + App)' };
/* ⚠ 240 의 근거: 실측 208.3(2026-07-30 · atlas 이탈 후). 여유 ~15% 는 축 ①의 css 32 와 같은
   규율이다 — 측정치에 붙여 두면 무관한 변경마다 빨간불이 뜨는 flaky 게이트가 된다.
   올릴 때는 **측정치를 적고, 무엇이 그만큼을 썼는지 이름을 대고, 여유를 남긴다.** */
/* ⚠ 데스크톱 css 20→32 재기준선(C-7 · 2026-07-23). 회귀가 아니라 **정당한 실비**다:
   C-7 이 feature 를 Tailwind 로 옮기면서 index 엔트리에 eager 유틸 시트가 붙었다(실측 27.8).
   폰은 같은 부채를 `@source` 스코핑으로 실제로 없앴지만(20.2→5.0), 데스크톱은 그 유틸을
   *실제로 쓰므로* 줄일 게 아니라 이름을 붙일 값이다 — js 500→620·max-lines 730→844 와 동형.
   27.8 에 여유 ~15% 를 둬 무관한 변경에도 빨간불이 뜨는 flaky 게이트를 피한다(TOTAL js 주석과
   같은 이유). 근거·측정은 설계서 §15 예산 부채 항목. */

/* ⚠ 축 ③ — **전체 산출물 총합**. 엔트리별 초기 로드만 재면 지연 로드되는 탭 20개가
   통째로 게이트 밖으로 나간다(옛 "폴더 총합"이 잡던 바로 그 축이다). 초기 로드가 사용자
   체감이라면 총합은 앱이 얼마나 불어났는가이고, 둘은 서로를 대체하지 못한다.
   지연 청크에 200KB 를 흘려도 초기 로드는 1바이트도 안 움직인다.

   ⚠ js 총합을 500→620 으로 올렸다(C-6). 회귀가 아니라 **새 기능의 실비**다: 폰의 SQLite
   워커·wasm 글루가 gzip 약 165KB. 실측 559.5 라 560 에 붙여 두면 무관한 변경에도 빨간불이
   뜨는 flaky 게이트가 된다(커버리지 임계를 최저치 아래로 잡는 것과 같은 이유).

   ⚠ js 총합 620→660(2026-07-26 · Next 티어 9건). 실측 613.6→**621.8**(+8.2)이고 그 증가는 전부
   새 기능의 실비다(미니 HUD 창 모드 · 이어하기 커서 · 키맵 레지스트리 · 유지 큐 · 예보 가용선 ·
   챕터 서랍 · 반사실 완주일). **여유가 1% 밖에 안 남아 있던 것이 더 문제였다** — 이 파일이 스스로
   경고한 flaky 조건(측정치에 붙여 둔 천장)에 이미 들어와 있었다. 실측 대비 ~6% 여유로 다시 앉힌다.
   ⚠ 올릴 때의 규율: **측정치를 적고, 무엇이 그만큼을 썼는지 이름을 대고, 여유를 남긴다.**
   셋 중 하나라도 빠지면 그건 예산이 아니라 그때그때의 변명이 된다. */
const TOTAL = { js: 660, css: 110, wasm: 600 };

const dist = join(process.cwd(), 'dist');
let manifest;
try {
  manifest = JSON.parse(readFileSync(join(dist, '.vite', 'manifest.json'), 'utf8'));
} catch {
  console.error('❌ dist/.vite/manifest.json 없음 — 먼저 `npm run build`(build.manifest 필요).');
  process.exit(1);
}

const gz = (file) => gzipSync(readFileSync(join(dist, file))).length / 1024;

/** 주어진 키들의 **초기 로드** 파일 집합. 정적 `imports` 만 따라간다(동적은 지연 로드다). */
function initialFiles(...entryKeys) {
  const js = new Set();
  const css = new Set();
  const walk = (key) => {
    const c = manifest[key];
    if (!c || js.has(c.file)) return;
    js.add(c.file);
    for (const s of c.css ?? []) css.add(s);
    for (const dep of c.imports ?? []) walk(dep);
  };
  for (const k of entryKeys) walk(k);
  return { js: [...js], css: [...css] };
}

console.log('=== BUNDLE BUDGET (gzip KB · 엔트리별 초기 로드) ===');
let failed = false;

for (const [entry, budget] of Object.entries(BUDGETS)) {
  if (!manifest[entry]) {
    // ⚠ 조용히 건너뛰지 않는다 — 엔트리가 사라졌는데 녹색이면 게이트가 아무것도 안 잰 것이다.
    console.error(`❌ 매니페스트에 엔트리가 없다: ${entry}`);
    failed = true;
    continue;
  }
  const files = initialFiles(entry);
  console.log(`\n--- ${budget.label} (${entry}) ---`);
  for (const kind of ['js', 'css']) {
    const rows = files[kind].map((f) => ({ f, gz: gz(f) })).sort((a, b) => b.gz - a.gz);
    const total = rows.reduce((a, r) => a + r.gz, 0);
    for (const r of rows) console.log(`      ${r.gz.toFixed(1)}  ${r.f}`);
    const over = total > budget[kind];
    if (over) failed = true;
    console.log(`${over ? 'OVER' : '  ok'}  ${kind} total ${total.toFixed(1)} / ${budget[kind]}`);
  }
}

/* 축 ①의 사각 — 엔트리가 동적으로 부르지만 **항상 즉시** 로드되는 App 까지 합친 웨이브.
   (근거는 위 WAVE 선언의 머리주석) */
console.log(`\n--- ${WAVE.label} ---`);
if (!manifest[WAVE.then]) {
  // ⚠ 조용히 건너뛰지 않는다 — 대상이 사라졌는데 녹색이면 이 축은 아무것도 안 잰 것이다.
  console.error(`❌ 매니페스트에 ${WAVE.then} 가 없다 — 파일이 옮겨졌다면 이 축의 대상을 고칠 것.`);
  failed = true;
} else {
  const wave = initialFiles(WAVE.entry, WAVE.then);
  const only = initialFiles(WAVE.entry).js;
  const total = wave.js.reduce((a, f) => a + gz(f), 0);
  for (const f of wave.js.filter((f) => !only.includes(f)).sort((a, b) => gz(b) - gz(a)))
    console.log(`      ${gz(f).toFixed(1)}  ${f}  (App 웨이브에서 추가)`);
  const over = total > WAVE.js;
  if (over) failed = true;
  console.log(`${over ? 'OVER' : '  ok'}  js total ${total.toFixed(1)} / ${WAVE.js}`);
}

/* 전체 총합 — 위 엔트리별 수치가 못 보는 축.
   ⚠ **매니페스트가 아니라 폴더를 훑는다.** 워커 청크와 `.wasm` 은 매니페스트에 안 들어가는데
   폰은 그걸 실제로 받는다(sqlite wasm 만 gzip 수백 KB). 매니페스트로 재면 그 비용이
   게이트에서 통째로 사라져 "총합이 줄었다"는 착시가 생긴다 — 실제로 이 재작성 중에 한 번
   그렇게 나왔다(557.7 → 422.0, 줄어든 게 아니라 135.7 이 안 보이게 된 것). */
console.log('\n--- 전체 산출물(지연 청크·워커·wasm 포함) ---');
{
  const files = readdirSync(join(dist, 'assets'));
  for (const [kind, ext] of [
    ['js', '.js'],
    ['css', '.css'],
    ['wasm', '.wasm'],
  ]) {
    const total = files.filter((f) => f.endsWith(ext)).reduce((a, f) => a + gz(join('assets', f)), 0);
    const over = total > TOTAL[kind];
    if (over) failed = true;
    console.log(`${over ? 'OVER' : '  ok'}  ${kind} total ${total.toFixed(1)} / ${TOTAL[kind]}`);
  }
}

/* ── 축 ④ — **번들 오염**(H12 · 2026-07-30 감사) ────────────────────────────────
   위 세 축은 전부 `dist/assets` 나 매니페스트 그래프만 본다. 그런데 `dist` 는 **두 소비자가 공유**한다:
   wrangler `assets.directory` 와 tauri `frontendDist` 가 같은 `web/dist` 다. 그래서 배포용
   바이너리를 `public/updates/` 에 두면 Vite 가 dist 로 복사하고 → **데스크톱 인스톨러 안에**
   그대로 들어간다. 실측: 7.16MB 짜리 `러닝허브_0.2.0_x64-setup.exe` 가 다음 번들에 실려 있었고
   dist 13MB 중 절반 이상이었다. 그리고 그 번들을 다시 릴리스 자산으로 두면 **매 릴리스마다 배로**
   불어난다. 크기 축 셋 다 `assets/` 나 그래프만 보므로 이 오염은 원리적으로 안 보였다.

   ⚠ 지금은 인스톨러가 `release-assets/`(빌드 입력 아님)에 있고 `npm run release:stage` 가
   **배포 직전에만** `dist/updates/` 로 넣는다. 이 축은 그 규율이 흘러내렸는지를 본다 —
   릴리스 절차상 스테이징은 게이트 **뒤**이므로 여기서 걸리면 잘못된 순서이거나 규율 위반이다. */
console.log('\n--- 번들 오염(배포용 바이너리가 dist 에 있는가) ---');
{
  const BINARY = ['.exe', '.msi', '.dmg', '.deb', '.appimage', '.zip', '.sig'];
  const found = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (BINARY.some((ext) => e.name.toLowerCase().endsWith(ext)))
        found.push({ p: relative(dist, p).replace(/\\/g, '/'), mb: statSync(p).size / 1024 / 1024 });
    }
  };
  walk(dist);
  for (const f of found) console.log(`      ${f.mb.toFixed(2)} MB  ${f.p}`);
  if (found.length) {
    failed = true;
    console.log(`OVER  릴리스 바이너리 ${found.length}개가 dist 에 있다 — 이대로 tauri:build 하면 번들에 실린다.`);
    console.log('      → release-assets/ 로 옮기고, 배포 직전에만 `npm run release:stage`.');
  } else {
    console.log('  ok  없음');
  }
}

console.log(`\nRESULT: ${failed ? '❌ 예산 초과' : '✅ 예산 내'}`);
process.exit(failed ? 1 : 0);
