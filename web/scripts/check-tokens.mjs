#!/usr/bin/env node
/* ============================================================
   check-tokens.mjs — **정의되지 않은 CSS 변수 참조**를 잡는다(H20 · 2026-07-26 감사).
   사용: node scripts/check-tokens.mjs
   반환: 미정의 `var(--x)` 참조가 하나라도 있으면 exit 1.

   ## 왜 생겼나 — 사람 눈이 두 번 놓친 부류다

   `lib/ledger.ts` 가 `var(--sky,#5aa9e6)` 와 `var(--panel-2,#2a2d35)` 를 쓰고 있었는데
   **두 이름 다 정의된 적이 없다**(실제 이름은 `--signal`·`--panel2`). 폴백 hex 가 있어
   화면은 "그려지긴" 했고, 그래서:

   · 절대규칙 #3(색은 파생물 · 생 hex 금지)이 **사실상 무력화**됐다 — 테마·액센트를 바꿔도
     그 색만 고정이다.
   · `#2a2d35` 는 딥블랙용 회색이라 **라이트 테마에서 흰 패널 위 짙은 덩어리**가 되고,
     하필 그게 '미착수(planned)' 색이었다 → **미착수가 완료보다 진해 보이는 의미 역전**.
     그 상태가 `ledger-light` 스냅샷에 정답으로 굳어 있었다(§15-4 의 재발).

   ## 왜 stylelint 로는 못 잡나

   stylelint 는 **CSS 파일**을 본다. 위 두 참조는 **TS 문자열** 안에 있다(`STAGE_META` 의
   `color` 필드 → 인라인 style 로 주입). 즉 검사기가 없는 것이 아니라 **검사 범위 밖**이었다.
   그래서 이 스크립트는 `.css` 와 `.ts/.tsx` 를 **함께** 훑는다.

   ## 판정 규칙

   · **선언**: 어디서든 `--name:` 으로 값이 붙는 것(css 선언 · TSX 인라인 `'--seg': …` ·
     `setProperty('--x', …)`). 런타임 주입 변수(§14-3 예외 ②)가 여기 걸린다.
   · **참조**: `var(--name` 전부.
   · 참조 - 선언 = 미정의. 폴백(`var(--x, #hex)`)이 있어도 **미정의는 미정의다** — 폴백은
     오류를 감추는 장치이지 정의가 아니다(이 결함이 정확히 그렇게 살아남았다).
============================================================ */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';
const 확장자 = /\.(css|ts|tsx)$/;

/* 선언 3형태 — CSS 선언 · **인라인 style 객체 키** · `setProperty`.
   ⚠ 객체 키는 따옴표가 끼거나(`'--c': …`) 계산 키(`['--sub' as string]: …`)라 콜론이 바로
   붙지 않는다. 두 형태를 다 잡지 않으면 §14-3 예외 ②(런타임 CSS 변수 주입)가 통째로
   "미정의"로 잘못 걸려, 이 검사기가 첫날에 무력화되는 길로 간다. */
const 선언패턴 = [
  /(--[a-zA-Z0-9-]+)\s*:/g,
  /(--[a-zA-Z0-9-]+)['"`\]\s]*(?:as\s+\w+\s*\])?\s*:/g,
  /setProperty\(\s*['"`](--[a-zA-Z0-9-]+)['"`]/g,
];
/** 참조: `var(--name`. */
const 참조패턴 = /var\(\s*(--[a-zA-Z0-9-]+)/g;

function 파일들(dir) {
  const out = [];
  for (const 이름 of readdirSync(dir)) {
    const p = join(dir, 이름);
    if (statSync(p).isDirectory()) out.push(...파일들(p));
    else if (확장자.test(이름)) out.push(p);
  }
  return out;
}

const 선언 = new Set();
const 참조 = new Map(); // name → [파일:줄]

for (const 파일 of 파일들(ROOT)) {
  const 본문 = readFileSync(파일, 'utf8');
  for (const 패턴 of 선언패턴) for (const m of 본문.matchAll(패턴)) 선언.add(m[1]);
  const 줄들 = 본문.split('\n');
  줄들.forEach((줄, i) => {
    for (const m of 줄.matchAll(참조패턴)) {
      const 이름 = m[1];
      if (!참조.has(이름)) 참조.set(이름, []);
      참조.get(이름).push(`${파일}:${i + 1}`);
    }
  });
}

const 미정의 = [...참조.entries()].filter(([이름]) => !선언.has(이름));

if (미정의.length) {
  console.error('✗ 정의되지 않은 CSS 변수 참조:\n');
  for (const [이름, 위치들] of 미정의) {
    console.error(`  ${이름}`);
    for (const 위치 of 위치들.slice(0, 5)) console.error(`    · ${위치}`);
    if (위치들.length > 5) console.error(`    · …외 ${위치들.length - 5}곳`);
  }
  console.error('\n폴백(var(--x, #hex))이 있어도 실패다 — 그 폴백이 절대규칙 #3 을 조용히 무력화한다.');
  process.exit(1);
}

console.log(`✓ CSS 변수 참조 ${참조.size}종 전부 정의됨(선언 ${선언.size}종).`);
