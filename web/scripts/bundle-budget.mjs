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
  /* ⚠⚠ **P10 W4 재기준선(2026-08-07).** 화면 5·아티팩트 3·Rust 3 이 `survey/` 로 나가면서
     실측이 크게 내려왔다: 데스크톱 js 107.1 · 폰 js 85.3. 한도를 그대로 두면 33% 여유가 되어
     **게이트가 아무것도 안 지킨다** — 이 파일의 규율("측정치를 적고, 이름을 대고, 여유 ~15%")을
     감소 방향에도 똑같이 적용한다. 한도를 올릴 때만 근거를 요구하고 내릴 때는 안 내리면,
     큰 삭제 한 번마다 게이트가 조용히 헐거워진다. */
  'index.html': { js: 124, css: 37, label: '데스크톱 셸' },
  'phone.html': { js: 98, css: 15, label: '폰 웹앱' },
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
const WAVE = { entry: 'index.html', then: 'src/app/App.tsx', js: 250, label: '데스크톱 부팅 웨이브(엔트리 + App)' };
/* ⚠ 250 의 근거: 실측 **216.1**(2026-08-07 · P10 W4 후) + 여유 ~15%.
   ⚠⚠ **이 축은 W4 에서 오히려 늘었다**(211.4 → 216.1). 다른 축이 전부 줄었는데 여기만 는 것이
   이상해 보이지만 원인은 단순하다: 이 축은 *엔트리 + App* 이고, 사라진 것은 **탭 청크**(지연
   로드)라 애초에 이 웨이브 밖이었다. 즉 축 ②는 삭제로 안 줄고, 줄어든 것처럼 보이게 한도를
   내리면 무관한 변경에 빨간불이 뜬다. 옛 근거: 실측 208.3(2026-07-30 · atlas 이탈 후) → **211.4**(2026-08-02 재측정).
   +3.1 의 이름: 부팅 260ms 제거(`registry.warmTab` + `lib/perf` 의 마크 뺄셈 + `main.tsx` 배선).
   한도는 그대로 둔다 — 여유가 아직 ~12% 다. 여유 ~15% 는 축 ①의 css 32 와 같은
   규율이다 — 측정치에 붙여 두면 무관한 변경마다 빨간불이 뜨는 flaky 게이트가 된다.
   올릴 때는 **측정치를 적고, 무엇이 그만큼을 썼는지 이름을 대고, 여유를 남긴다.** */
/* ⚠ 데스크톱 css 20→32 재기준선(C-7 · 2026-07-23). 회귀가 아니라 **정당한 실비**다:
   C-7 이 feature 를 Tailwind 로 옮기면서 index 엔트리에 eager 유틸 시트가 붙었다(실측 27.8).
   폰은 같은 부채를 `@source` 스코핑으로 실제로 없앴지만(20.2→5.0), 데스크톱은 그 유틸을
   *실제로 쓰므로* 줄일 게 아니라 이름을 붙일 값이다 — js 500→620·max-lines 730→844 와 동형.
   27.8 에 여유 ~15% 를 둬 무관한 변경에도 빨간불이 뜨는 flaky 게이트를 피한다(TOTAL js 주석과
   같은 이유). 근거·측정은 설계서 §15 예산 부채 항목. */
/* ⚠⚠ **데스크톱 css 32→37 재기준선(W 배치 · 2026-07-31).**

   ⚠ 먼저 적어 둘 사실: 이 배치 **직전 실측이 이미 32.0/32** 였다. 즉 C-7 이 남긴 여유 15%
   (27.8→32)가 그 사이에 전부 소진돼 있었고, 게이트는 "다음 한 줄이면 빨간불"인 상태였다 —
   위 주석이 스스로 피하려 한 flaky 조건이 이미 성립해 있었다. 재기준선의 첫 근거가 그것이다.

   실측 **32.1**(2026-07-31) → **32.7**(2026-08-02 재측정 · 감사 근본 실행분의 CSS 순증 +0.6).
   무엇이 썼는가(이름):
   · W14 — `.hud` 유리(테두리·2단 그라데이션·시트 하이라이트)를 걷고 **노치 브래킷**을 넣었다.
     빼기와 더하기가 함께 있어 순증은 작다(브래킷은 두 귀퉁이만 그린다).
   · W21 — `--emph-live`·`--emph-value`(+ 라이트 재정의). 라이트에 **처음 생긴 고유 규칙**이다.
   · W11 — 역할 타이포 8종(`--fs-micro`…`--fs-title-sm`). 값 무변경 · 이름만 접은 별칭 층.
   · W23 — `--bg-hero-settings`(빌려 쓰던 mastery 히어로의 반납분 · 1층으로 줄였다).
   함께 **사라진** 것: `--shadow-card`(10파일) · `.modal-in` · `--fs-spine` · `--text-shadow-wordmark`.

   37 = 32.1 + 여유 ~15%. 규율은 위 문단 그대로다 — **측정치를 적고, 이름을 대고, 여유를 남긴다.** */

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
   셋 중 하나라도 빠지면 그건 예산이 아니라 그때그때의 변명이 된다.

   ## ⚠⚠ 축 ③을 **플랫폼별로 갈랐다**(H23 · 2026-08-01 `/감사 근본`)

   갈라야 했던 이유는 잔여 3.9KB(656.1/660)가 아니라 **그 잔여가 누구 것이냐**였다: 총합의
   **20.3%(133.5 KB gz)가 폰 전용 SQLite 글루**(wasm + 워커 3종)다. 데스크톱은 그걸 1바이트도
   안 받는데, 한 통에 담아 두면 **데스크톱만 만지는 변경이 폰 wasm 때문에 막힌다.** 그건 축 ①이
   C-6 에서 이미 고친 거짓말(*"어느 사용자도 실제로 다운로드하지 않는 양"*)이 축 ③에 그대로
   남아 있던 것이다 — 그때 엔트리별로 가른 근거가 여기에도 똑같이 성립한다.

   ⚠ **한도만 올리는 것은 처방이 아니다.** 660→700 은 같은 거짓말을 40KB 뒤로 미룰 뿐이고,
   그때 다시 "누구 예산인지 모르는 초과"를 만난다. 축이 답해야 하는 질문은 "총합이 얼마인가"가
   아니라 **"이 플랫폼 사용자가 받는 양이 얼마인가"** 다.

   ⚠ 공유 청크는 **양쪽에 모두 센다**(중복 계상이 아니라 각 축의 정의 그대로다 — 데스크톱
   사용자도 폰 사용자도 그 바이트를 실제로 받는다).

   ⚠ **매니페스트 밖 파일**(워커·wasm)은 그래프로 귀속할 수 없다 → `OFF_MANIFEST` 가 패턴으로
   이름을 대고 귀속한다. 목록에 없는 새 파일이 나오면 **조용히 빠지지 않고 실패한다** — 그게
   옛 "폴더 총합"이 지키던 유일한 것이고, 여기서 잃으면 안 되는 성질이다. */
const TOTAL = {
  /* 데스크톱 = `index.html` 에서 도달 가능한 전부(지연 탭 20개 포함).
     실측 **js 501.1 · css 32.7**(2026-08-02 · 08-01 의 498.7 에서 +2.4 = 부팅 260ms 제거분) → 여유 ~13%.
     ⚠ 옛 단일 축의 656.1 중 이만큼이 데스크톱 몫이었다 — 나머지는 폰 전용이거나 공유분이다. */
  desktop: { js: 555, css: 38 }, // ⚠ P10 W4 재기준선(2026-08-07) — 실측 481.2 + 여유 ~15%
  /* 폰 = `phone.html` 에서 도달 가능한 전부 + SQLite 글루(아래 OFF_MANIFEST).
     실측 **js 296.0 · css 10.6 · wasm 392.5**(2026-08-02 · 08-01 의 294.2 에서 +1.8 = 같은 공유 청크 증가) → 여유 ~13%.
     ⚠ 폰 js 294 가 데스크톱 499 의 60% 인 것은 화면이 커서가 아니라 **공유 청크(React·lib)가
       양쪽에 세어지기** 때문이다 + sqlite 워커 3종(js 로 잡힌다 · wasm 축이 아니다).
       폰 *고유* 화면이 불어나는지는 축 ①의 `phone.html` 초기 로드(120)가 본다 — 두 축이 다른
       것을 잡는다는 이 파일의 전제 그대로다.
     ⚠ wasm 축은 폰에만 있다. 데스크톱 셸은 plugin-sql 을 쓰므로 `.wasm` 을 **한 바이트도 안 받는다**. */
  phone: { js: 348, css: 12.5, wasm: 450 }, // ⚠ P10 W4 재기준선 — 실측 301.8 + 여유 ~15%
};

/** 매니페스트에 없는 산출물의 귀속(패턴 → 플랫폼). Vite 는 워커·wasm 을 매니페스트에 안 싣는다. */
const OFF_MANIFEST = [
  /* sqlite wasm + 워커 3종 = C-6 폰 저장 백엔드(`enableBrowserDb()`). 데스크톱 셸은 plugin-sql 을
     쓰므로 이 파일들을 **부르는 코드 자체가 없다**(`isSqlitePrimary()` 분기). */
  { re: /^assets\/sqlite/, platform: 'phone' },
];

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

/* 축 ③ — **플랫폼별 전체 산출물**(지연 청크·워커·wasm 포함). 위 엔트리별 수치가 못 보는 축.
   ⚠ **폴더도 함께 훑는다.** 워커 청크와 `.wasm` 은 매니페스트에 안 들어가는데 폰은 그걸 실제로
   받는다(sqlite wasm 만 gzip 수백 KB). 그래프만 보면 그 비용이 게이트에서 통째로 사라져
   "총합이 줄었다"는 착시가 생긴다 — 실제로 C-6 재작성 중에 한 번 그렇게 나왔다
   (557.7 → 422.0, 줄어든 게 아니라 135.7 이 안 보이게 된 것). */

/** 엔트리에서 도달 가능한 **전부**(정적 `imports` + 지연 `dynamicImports` + css + assets). */
function reachableFiles(entryKey) {
  const out = new Set();
  const seen = new Set();
  const walk = (key) => {
    if (seen.has(key)) return;
    seen.add(key);
    const c = manifest[key];
    if (!c) return;
    if (c.file) out.add(c.file);
    for (const f of c.css ?? []) out.add(f);
    for (const f of c.assets ?? []) out.add(f);
    for (const dep of [...(c.imports ?? []), ...(c.dynamicImports ?? [])]) walk(dep);
  };
  walk(entryKey);
  return out;
}

console.log('\n--- 플랫폼별 전체 산출물(지연 청크·워커·wasm 포함) ---');
{
  const onDisk = readdirSync(join(dist, 'assets')).map((f) => 'assets/' + f);
  const graph = { desktop: reachableFiles('index.html'), phone: reachableFiles('phone.html') };

  // 매니페스트 밖 파일 귀속 — 이름을 못 대는 것이 하나라도 있으면 실패한다(조용한 누락 금지).
  const known = new Set([...graph.desktop, ...graph.phone]);
  for (const f of onDisk) {
    if (known.has(f)) continue;
    const rule = OFF_MANIFEST.find((r) => r.re.test(f));
    if (!rule) {
      console.error(
        `❌ 어느 플랫폼에도 귀속되지 않는 산출물: ${f}\n` +
          `   매니페스트 그래프에 없고 OFF_MANIFEST 패턴에도 안 걸린다 — 새 워커·wasm 이라면 그 목록에\n` +
          `   **이름과 사유를 적어** 귀속시킬 것. 여기서 조용히 넘기면 그만큼이 예산 밖으로 사라진다.`,
      );
      failed = true;
      continue;
    }
    graph[rule.platform].add(f);
  }

  for (const [platform, budget] of Object.entries(TOTAL)) {
    console.log(`\n  [${platform === 'desktop' ? '데스크톱' : '폰'}]`);
    for (const [kind, ext] of [
      ['js', '.js'],
      ['css', '.css'],
      ['wasm', '.wasm'],
    ]) {
      if (budget[kind] === undefined) continue; // 데스크톱엔 wasm 축이 없다(받는 파일이 없다).
      const total = [...graph[platform]].filter((f) => f.endsWith(ext)).reduce((a, f) => a + gz(f), 0);
      const over = total > budget[kind];
      if (over) failed = true;
      console.log(`${over ? 'OVER' : '  ok'}  ${kind} total ${total.toFixed(1)} / ${budget[kind]}`);
    }
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
