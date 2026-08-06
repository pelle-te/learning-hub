#!/usr/bin/env node
/* ============================================================
   compiler-ratchet.mjs — **React Compiler 가 실제로 몇 곳에서 꺼져 있는가**의 래칫(H-6).

   ## 왜 필요한가 (전제가 무효화된 것)

   `docs/아키텍처.md` 는 _"Rules of React 위반 시 조용히 bail → `eslint-plugin-react-hooks` 가
   위반을 빌드 전에 잡아 **최적화 적용률 보장**"_ 이라 적어 왔다. 2026-08-06 감사가 재 보니
   **그 보장이 성립하지 않는다**: 컴파일러를 `src` 전량에 돌리면 바일아웃이 실재하고, 기전은
   그 문장의 정확히 반대다 — **`eslint-disable react-hooks` 가 곧 그 집행자를 끄는 것**이라
   억제한 자리가 그대로 바일아웃이 된다. 그리고 **어느 게이트 축도 컴파일 성공률을 안 봤다**
   (`max-lines`·`cognitive-complexity` 는 크기·복잡도를 보고, 린트는 *소스*를 본다).

   ## 형태: 값이 아니라 **방향**을 잠근다

   `report-debt.mjs` 의 두 래칫과 같은 계약이다 — "더 나빠지지 않는다"만 보장한다. 절대 수를
   0 으로 만드는 것은 이 스크립트의 일이 아니다(바일아웃 하나하나는 각자 이유가 있고, 그중
   일부는 정당하다). 잡으려는 것은 **아무도 모르는 사이에 늘어나는 것**이다.

   ⚠ 기준선은 `compiler-baseline.json` 이고, 줄었으면 **자동으로 조이지 않는다** — 대신 시끄럽게
     알린다(사람이 커밋에 담아야 그 개선이 기록으로 남는다 · 조용한 자동 조임은 "왜 줄었나"를
     지운다).
   ⚠ 파일별 목록을 함께 낸다 — 총합만 보면 하나가 고쳐지고 하나가 새로 생긴 상태가 통과한다.
============================================================ */
import { transformAsync } from '@babel/core';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');
const BASELINE = join(ROOT, 'compiler-baseline.json');

/** `src` 아래 컴파일러가 실제로 도는 파일 — vite 설정의 babel 통로와 같은 확장자. */
function sources(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...sources(p));
    else if (/\.(t|j)sx?$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** 한 파일의 바일아웃 수. 컴파일러는 실패를 **로거로** 알린다(throw 하지 않는다 — 그게 설계다). */
async function bailoutsOf(file) {
  const events = [];
  try {
    await transformAsync(readFileSync(file, 'utf8'), {
      filename: file,
      babelrc: false,
      configFile: false,
      parserOpts: { plugins: ['typescript', 'jsx'] },
      plugins: [
        [
          'babel-plugin-react-compiler',
          {
            logger: {
              logEvent(_filename, event) {
                if (event.kind === 'CompileError' || event.kind === 'CompileSkip') events.push(event);
              },
            },
          },
        ],
      ],
    });
  } catch {
    /* 파싱 자체가 실패하는 파일(문법이 아닌 것)은 컴파일러의 관심사가 아니다 — 세지 않는다.
       ⚠ 조용히 넘기지만 위험하지 않다: 파싱 실패는 `typecheck`·`lint` 가 먼저 잡는다. */
  }
  return events.length;
}

const files = sources(SRC);
const perFile = {};
let total = 0;
for (const f of files) {
  const n = await bailoutsOf(f);
  if (n > 0) {
    perFile[relative(ROOT, f).replace(/\\/g, '/')] = n;
    total += n;
  }
}

const write = process.argv.includes('--write');
const prev = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : null;

console.log(`=== REACT COMPILER 바일아웃 ===`);
console.log(`  파일 ${files.length} 중 ${Object.keys(perFile).length}개 · 총 ${total}건`);

if (write || !prev) {
  writeFileSync(BASELINE, `${JSON.stringify({ total, files: perFile }, null, 2)}\n`);
  console.log(`  기준선 기록: ${relative(ROOT, BASELINE)} (총 ${total})`);
  process.exit(0);
}

const 새로생김 = Object.keys(perFile).filter((f) => (perFile[f] ?? 0) > (prev.files[f] ?? 0));
const 줄었음 = Object.keys(prev.files).filter((f) => (perFile[f] ?? 0) < prev.files[f]);

if (줄었음.length) {
  console.log(`\n  ✅ 줄어든 파일 ${줄었음.length}개 — 기준선을 조이려면 \`npm run compiler:ratchet -- --write\``);
  for (const f of 줄었음) console.log(`     ${prev.files[f]} → ${perFile[f] ?? 0}  ${f}`);
}

if (total > prev.total || 새로생김.length) {
  console.error(`\n❌ 바일아웃이 늘었다 — 기준선 ${prev.total} → ${total}`);
  for (const f of 새로생김) console.error(`   ${prev.files[f] ?? 0} → ${perFile[f]}  ${f}`);
  console.error(
    '\n대개 원인은 `eslint-disable react-hooks` 다 — 그 억제가 곧 컴파일러 바일아웃이다.\n' +
      '고칠 수 없으면(정당한 이유가 있으면) `--write` 로 기준선을 올리되 **커밋 메시지에 이유를 적을 것**.',
  );
  process.exit(1);
}

console.log(`\n✅ 기준선 이하 (${prev.total} 이하 유지 · 현재 ${total})`);
