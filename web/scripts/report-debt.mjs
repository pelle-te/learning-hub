#!/usr/bin/env node
/* ============================================================
   report-debt.mjs — 코드 부채 현황 리포트(0단계-F · **강제 없음, 출력만**).
   왜 강제하지 않나: 인지복잡도·파일 크기·features:lib 비율은 임계를 넘겼다고 곧바로 결함이
   아니다(TodaySignature가 큰 건 today 재설계 사상이 한 화면에 모든 걸 담기 때문). 게이트로
   조이면 "숫자를 맞추는 리팩터"를 유도해 설계를 망친다. 대신 **추세를 보이게** 해서 사람이
   판단하게 한다. 하드 게이트는 eslint의 래칫 2개(cognitive-complexity 77 · max-lines 730)뿐이고,
   그건 '더 나빠지지 않는다'만 보장한다.
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

const MAX_LINES_RATCHET = 730;
console.log(`\n큰 파일 top 10 (max-lines 래칫 ${MAX_LINES_RATCHET})`);
for (const f of [...files].sort((a, b) => b.lines - a.lines).slice(0, 10)) {
  const flag = f.lines > MAX_LINES_RATCHET ? ' ⚠' : '';
  console.log(`  ${String(f.lines).padStart(5)}  ${f.rel}${flag}`);
}

console.log('\n인지복잡도: npx eslint src --rule \'{"sonarjs/cognitive-complexity":["error",15]}\' 로 상세 확인');
console.log('(게이트 임계는 77 래칫 — 내려가기만 한다. 6단계 Tailwind 후 재기준선.)');
