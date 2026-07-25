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
============================================================ */
import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

/* 엔트리별 예산(gzip KB). 값은 실측 대비 여유를 둔다.
   ⚠ 폰 예산이 작은 것이 의도다 — 폰은 셀룰러에서 처음 열릴 수 있고, 이 앱의 폰 화면은
   일/주 캘린더 + 할일 편집 하나다. 여기가 커지기 시작하면 그건 "폰에 데스크톱을 다시
   집어넣고 있다"는 신호다(설계서 §9-4 가 별도 번들을 고른 이유). */
const BUDGETS = {
  'index.html': { js: 160, css: 32, label: '데스크톱 셸' },
  'phone.html': { js: 120, css: 15, label: '폰 웹앱' },
};
/* ⚠ 데스크톱 css 20→32 재기준선(C-7 · 2026-07-23). 회귀가 아니라 **정당한 실비**다:
   C-7 이 feature 를 Tailwind 로 옮기면서 index 엔트리에 eager 유틸 시트가 붙었다(실측 27.8).
   폰은 같은 부채를 `@source` 스코핑으로 실제로 없앴지만(20.2→5.0), 데스크톱은 그 유틸을
   *실제로 쓰므로* 줄일 게 아니라 이름을 붙일 값이다 — js 500→620·max-lines 730→844 와 동형.
   27.8 에 여유 ~15% 를 둬 무관한 변경에도 빨간불이 뜨는 flaky 게이트를 피한다(TOTAL js 주석과
   같은 이유). 근거·측정은 설계서 §15 예산 부채 항목. */

/* ⚠ 두 번째 축 — **전체 산출물 총합**. 엔트리별 초기 로드만 재면 지연 로드되는 탭 20개가
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

/** 엔트리의 **초기 로드** 파일 집합. 정적 `imports` 만 따라간다(동적은 지연 로드다). */
function initialFiles(entryKey) {
  const js = new Set();
  const css = new Set();
  const walk = (key) => {
    const c = manifest[key];
    if (!c || js.has(c.file)) return;
    js.add(c.file);
    for (const s of c.css ?? []) css.add(s);
    for (const dep of c.imports ?? []) walk(dep);
  };
  walk(entryKey);
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

console.log(`\nRESULT: ${failed ? '❌ 예산 초과' : '✅ 예산 내'}`);
process.exit(failed ? 1 : 0);
