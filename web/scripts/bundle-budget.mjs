#!/usr/bin/env node
/* ============================================================
   bundle-budget.mjs — 빌드 산출물 청크 크기 예산 게이트.
   dist/assets 의 *.js·*.css 를 gzip 크기로 재어 예산 초과를 잡는다(성능 회귀 방지).
   사용: cd web && npm run build && node scripts/bundle-budget.mjs
   반환: 초과 없으면 exit 0, 하나라도 초과면 exit 1.
   ⚠ 예산은 관측 후 조정하라(첫 실행 값을 보고 여유 있게 잡는 게 정석).

   CSS 도 재는 이유(2026-07-19 플랫폼 감사 ⑥): 원래 이 게이트는 `.js` 만 필터링해
   CSS 361KB(raw)가 통째로 게이트 밖에 있었다. CSS Module 54개가 feature 별로 쪼개져
   있어 대부분은 지연 로드되지만, **ds.module + tokens 가 들어가는 index.css 는 모든
   진입에 무조건 실린다** — 여기가 커지면 전 탭의 첫 페인트가 느려지는데 아무도 안 봤다.
============================================================ */
import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

// 자산 종류별 예산. 청크 이름 prefix → gzip KB 상한.
// js: vite manualChunks(react·vendor·앱 코드). css: index(항상 로드)만 개별 상한.
// 값은 실측(2026-07-19) 대비 ~20~30% 여유: js 393.9/500, css 82.8/110, index.css 9.7/14.
const KINDS = {
  js: { ext: '.js', chunks: { react: 70, vendor: 220, index: 120 }, total: 500 },
  css: { ext: '.css', chunks: { index: 14 }, total: 110 },
};

const dir = join(process.cwd(), 'dist', 'assets');
let entries;
try {
  entries = readdirSync(dir);
} catch {
  console.error('❌ dist/assets 없음 — 먼저 `npm run build`.');
  process.exit(1);
}

console.log('=== BUNDLE BUDGET (gzip KB) ===');
let failed = false;

for (const [kind, spec] of Object.entries(KINDS)) {
  const files = entries.filter((f) => f.endsWith(spec.ext));
  const rows = [];
  let total = 0;
  for (const f of files) {
    const gz = gzipSync(readFileSync(join(dir, f))).length / 1024;
    total += gz;
    const key = Object.keys(spec.chunks).find((k) => f.startsWith(k));
    const budget = key ? spec.chunks[key] : null;
    rows.push({ f, gz, budget, over: budget != null && gz > budget });
  }

  rows.sort((a, b) => b.gz - a.gz);
  console.log(`\n--- ${kind.toUpperCase()} (${files.length} files) ---`);
  for (const r of rows) {
    const b = r.budget != null ? ` / ${r.budget}` : '';
    console.log(`${r.over ? 'OVER' : '  ok'}  ${r.gz.toFixed(1)}${b}  ${r.f}`);
  }
  const totalOver = total > spec.total;
  console.log(`${totalOver ? 'OVER' : '  ok'}  ${kind} total ${total.toFixed(1)} / ${spec.total}`);
  if (rows.some((r) => r.over) || totalOver) failed = true;
}

console.log(failed ? '\nRESULT: ❌ 예산 초과' : '\nRESULT: ✅ 예산 내');
process.exit(failed ? 1 : 0);
