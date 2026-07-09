#!/usr/bin/env node
/* ============================================================
   bundle-budget.mjs — 빌드 산출물 청크 크기 예산 게이트.
   dist/assets/*.js 를 gzip 크기로 재어 예산 초과를 잡는다(성능 회귀 방지).
   사용: cd web && npm run build && node scripts/bundle-budget.mjs
   반환: 초과 없으면 exit 0, 하나라도 초과면 exit 1.
   ⚠ 예산은 관측 후 조정하라(첫 실행 값을 보고 여유 있게 잡는 게 정석).
============================================================ */
import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

// 청크 이름 prefix → gzip KB 상한. vite manualChunks: react·vendor·앱 코드.
const BUDGETS_KB = { react: 70, vendor: 220, index: 120 };
const TOTAL_KB = 500; // 전체 JS gzip 합 상한

const dir = join(process.cwd(), 'dist', 'assets');
let files;
try {
  files = readdirSync(dir).filter((f) => f.endsWith('.js'));
} catch {
  console.error('❌ dist/assets 없음 — 먼저 `npm run build`.');
  process.exit(1);
}

const rows = [];
let total = 0;
for (const f of files) {
  const buf = readFileSync(join(dir, f));
  const gz = gzipSync(buf).length / 1024;
  total += gz;
  const key = Object.keys(BUDGETS_KB).find((k) => f.startsWith(k));
  const budget = key ? BUDGETS_KB[key] : null;
  rows.push({ f, gz, budget, over: budget != null && gz > budget });
}

rows.sort((a, b) => b.gz - a.gz);
console.log('=== BUNDLE BUDGET (gzip KB) ===');
for (const r of rows) {
  const b = r.budget != null ? ` / ${r.budget}` : '';
  console.log(`${r.over ? 'OVER' : '  ok'}  ${r.gz.toFixed(1)}${b}  ${r.f}`);
}
const totalOver = total > TOTAL_KB;
console.log(`${totalOver ? 'OVER' : '  ok'}  total ${total.toFixed(1)} / ${TOTAL_KB}`);

const failed = rows.some((r) => r.over) || totalOver;
console.log(failed ? 'RESULT: ❌ 예산 초과' : 'RESULT: ✅ 예산 내');
process.exit(failed ? 1 : 0);
