#!/usr/bin/env node
/* ============================================================
   report-debt.mjs — 코드 부채 현황 리포트(0단계-F · **강제 없음, 출력만**).
   왜 강제하지 않나: 인지복잡도·파일 크기·features:lib 비율은 임계를 넘겼다고 곧바로 결함이
   아니다(TodaySignature가 큰 건 today 재설계 사상이 한 화면에 모든 걸 담기 때문). 게이트로
   조이면 "숫자를 맞추는 리팩터"를 유도해 설계를 망친다. 대신 **추세를 보이게** 해서 사람이
   판단하게 한다. 하드 게이트는 eslint의 래칫 2개(cognitive-complexity · max-lines)뿐이고,
   그건 '더 나빠지지 않는다'만 보장한다. **임계값은 여기 안 적는다** — eslint.config.js 에서
   읽는다(베껴 두었다가 C-7 재기준선 때 갈라졌다. 아래 `readRatchet` 주석 참조).
   실행: npm run report:debt
============================================================ */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = 'src';

function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

/** eslint max-lines(skipComments·skipBlankLines) 근사 — 주석/빈 줄 제외 코드 줄 수. */
function codeLines(src) {
  let n = 0;
  let block = false;
  for (const raw of src.split('\n')) {
    const l = raw.trim();
    if (block) {
      if (l.includes('*/')) block = false;
      continue;
    }
    if (!l || l.startsWith('//')) continue;
    if (l.startsWith('/*')) {
      if (!l.includes('*/')) block = true;
      continue;
    }
    n++;
  }
  return n;
}

const files = walk(SRC).map((p) => {
  const rel = relative(SRC, p).replace(/\\/g, '/');
  return { rel, lines: codeLines(readFileSync(p, 'utf8')) };
});

const layer = (rel) => rel.split('/')[0];
const sum = (arr) => arr.reduce((a, b) => a + b, 0);
const byLayer = {};
for (const f of files) {
  const L = layer(f.rel);
  (byLayer[L] ??= []).push(f);
}

console.log('=== 코드 부채 리포트 (강제 없음 · 추세 관찰용) ===\n');

console.log('레이어별 규모');
const order = ['app', 'features', 'components', 'hooks', 'store', 'lib', 'shell', 'styles'];
const keys = [...new Set([...order, ...Object.keys(byLayer)])].filter((k) => byLayer[k]);
for (const k of keys) {
  const fs_ = byLayer[k];
  console.log(`  ${k.padEnd(12)} ${String(fs_.length).padStart(4)}개  ${String(sum(fs_.map((f) => f.lines))).padStart(6)}줄`);
}

/* features:lib 비율 — 로직이 feature에 눌어붙는지(재사용·테스트 가능성 저하) 보는 지표.
   낮을수록 순수 로직이 lib에 모여 있다는 뜻. 목표값을 정하지 않는다 — 탭이 늘면 자연히 오른다. */
const featLines = sum((byLayer.features ?? []).map((f) => f.lines));
const libLines = sum((byLayer.lib ?? []).map((f) => f.lines));
console.log(`\nfeatures:lib = ${(featLines / (libLines || 1)).toFixed(2)} : 1  (${featLines} / ${libLines}줄)`);

/* ⚠ **임계는 게이트에서 읽는다** — 손으로 베껴 두었더니 C-7 이 래칫을 730→844 로 올린 뒤
   이 파일만 730 에 남아, 게이트가 **허용하는** 파일 셋을 ⚠ 로 표시하고 있었다. 추세를 보라고
   만든 도구가 잘못된 기준선을 보여 주면 사람이 없는 부채를 쫓는다. eslint.config.js 가 SSOT. */
const MAX_LINES_RATCHET = readRatchet();

function readRatchet() {
  try {
    const cfg = readFileSync('eslint.config.js', 'utf8');
    const m = cfg.match(/'max-lines':\s*\['error',\s*\{\s*max:\s*(\d+)/);
    if (m) return Number(m[1]);
  } catch {
    /* 못 읽으면 아래 폴백 — 리포트가 안 도는 것보다 낫다 */
  }
  console.warn('⚠ eslint.config.js 에서 max-lines 임계를 못 읽었습니다 — 표시값이 실제 게이트와 다를 수 있습니다.');
  return 844;
}
console.log(`\n큰 파일 top 10 (max-lines 래칫 ${MAX_LINES_RATCHET})`);
for (const f of [...files].sort((a, b) => b.lines - a.lines).slice(0, 10)) {
  const flag = f.lines > MAX_LINES_RATCHET ? ' ⚠' : '';
  console.log(`  ${String(f.lines).padStart(5)}  ${f.rel}${flag}`);
}

console.log('\n인지복잡도: npx eslint src --rule \'{"sonarjs/cognitive-complexity":["error",15]}\' 로 상세 확인');
/* C-7(=6단계 Tailwind) 종료 후 재측정(2026-07-24): 최댓값이 **정확히 77** 이다
   (ArticlePractice · TodaySignature 둘 다). 즉 래칫은 이미 현재 최댓값에 붙어 있어
   **리팩터 없이는 내릴 수 없다.** max-lines 도 같다(843 vs 임계 844). 재기준선은
   "숫자를 내리는 일"이 아니라 그 둘을 실제로 쪼개는 일이고, 그건 설계 결정이 앞선다. */
console.log('(게이트 임계는 77 래칫 — 내려가기만 한다. C-7 후 실측: 현재 최댓값도 77 이라 여유 0.)');
