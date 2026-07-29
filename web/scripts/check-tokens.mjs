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

/* ── 역방향 — **선언됐는데 아무 데서도 안 쓰이는 토큰**(2026-07-29) ──────────────
   앞의 검사는 "쓰는데 없는 것"을 잡는다. 반대 방향은 조용히 쌓인다: 화면이 사라져도 그 화면의
   토큰은 남고, 주석은 **존재하지 않는 UI 를 현재형으로** 설명한다. 그러면 다음 사람이 죽은
   이름을 살아 있는 어휘로 읽고 재사용한다(이 저장소가 `--fs-spine` 을 손으로 발견한 것이 이미
   그 신호였다).

   실사례: 132px 워터마크가 D-5 에서 제거되며 `--ghost-*` 5종과 `--fs-ghost-*` 체인이 통째로
   고아가 됐는데, `tokens.css` 주석은 그대로 그 워터마크를 설명하고 있었다.

   ⚠ **범위는 `tokens.css` 뿐이다.** `tokenBridge.css` 의 `@theme` 항목(`--color-*`·`--text-*`)은
   Tailwind 가 유틸을 생성해 소비하지 `var()` 로 참조하지 않는다 → 전량 오탐이 된다.
   ⚠ 예외는 **사유+만료일 원장**이다(SCA·a11y 원장과 같은 규율). 유효기간 없는 예외는 판단이
   아니라 방치다. */
const 미사용_원장 = [
  {
    이름: '--fs-spine',
    사유: '타이포 사다리의 최상단 단(72px). 소비처는 0이지만 이건 죽은 UI 잔재가 아니라 **스케일의 한 칸**이고, 지우면 사다리가 자기 범위에 대해 거짓말을 한다(원칙 2 의 "제일 큰 픽셀"이 문서에만 남는다). N-15 가 `primary` 44px 을 들이며 남겨 둔 자리.',
    만료: '2027-01-31',
  },
];

const tokensCss = readFileSync(join(ROOT, 'styles/tokens.css'), 'utf8');
const 토큰선언 = new Set([...tokensCss.matchAll(/^\s*(--[a-zA-Z0-9-]+)\s*:/gm)].map((m) => m[1]));
const 원장이름 = new Set(미사용_원장.map((r) => r.이름));
const 만료된 = 미사용_원장.filter((r) => new Date(r.만료) < new Date());
const 미사용 = [...토큰선언].filter((n) => !참조.has(n) && !원장이름.has(n));
// 사문화한 원장 항목(이미 쓰이게 된 것)도 실패다 — 남아 있으면 그게 방치다.
const 사문화 = 미사용_원장.filter((r) => 참조.has(r.이름) || !토큰선언.has(r.이름));

if (미사용.length || 만료된.length || 사문화.length) {
  if (미사용.length) {
    console.error('✗ 선언됐는데 아무 데서도 참조되지 않는 토큰:\n');
    for (const 이름 of 미사용) console.error(`  ${이름}`);
    console.error('\n지우거나(주인 UI 가 사라졌다면) 쓰거나, 사유+만료일과 함께 원장에 올리세요.');
  }
  for (const r of 만료된) console.error(`✗ 미사용 원장 만료: ${r.이름}(만료 ${r.만료}) — 다시 판단할 때다.`);
  for (const r of 사문화) console.error(`✗ 미사용 원장 사문화: ${r.이름} — 이제 쓰이거나 선언이 없다. 원장에서 빼세요.`);
  process.exit(1);
}

/* ── `*.module.css` 0개 단언(2026-07-29) ─────────────────────────────────────
   C-7 이 끝나며 "`*.module.css` 는 0개"가 규약이 됐는데, **그걸 강제하는 게이트가 없었다**
   (`package.json` 스크립트 전량 확인). 선언만 있고 집행이 없으면 흘러내린다는 것이 이 저장소가
   stylelint 를 들일 때 내린 결론 그대로다.

   ⚠ 왜 중요한가: CSS Module 은 **언레이어드**라 Tailwind 유틸을 이긴다(`ShortcutsHelp.tsx:20`
   이 그 함정을 기록한다). 그리고 생기는 순간 `better-tailwindcss` 의 검사 범위 **밖**으로
   나간다 — 즉 한 파일이 규약 둘을 동시에 우회한다. */
const 모듈css = 파일들(ROOT).filter((p) => /\.module\.css$/.test(p));
if (모듈css.length) {
  console.error('✗ `*.module.css` 가 생겼다 — C-7 이후 이 저장소에 CSS Module 은 0개가 규약이다:\n');
  for (const p of 모듈css) console.error(`  ${p}`);
  console.error('\n언레이어드라 Tailwind 유틸을 이기고, better-tailwindcss 검사 범위 밖으로 나간다.');
  console.error('스타일은 ① JSX 유틸리티 ② 공유 `ds-*`(styles/ds.css) ③ 앱 크롬(styles/global/) 셋 중 하나여야 한다.');
  process.exit(1);
}

/* ── 둥근 글래스 카드 래칫(E11 · 2026-07-29) ─────────────────────────────────
   `ds-card` 은퇴는 **소비처 0**을 달성했지만 형태는 남았다 — 25파일이 각자
   `rounded-md border border-line bg-panel shadow-card` 를 철자한다. 디자인시스템 §0 원칙 ④가
   _"둥근 글래스 카드 폐기"_ 라 선언한 그 형태이고, 더 나쁜 것은 이제 **SSOT 조차 없다**는 것이다
   (`ds-card` 시절엔 한 곳을 고치면 됐다 → 드리프트 조건이 오히려 악화됐다).

   ⚠ **래칫이지 금지가 아니다.** 한 번에 쓸면 스냅샷 60~78장을 태우면서 "더 나아졌나"를 아무도
   확인 못 한 채 굳는다(`ds-card` 파일럿이 그래서 단계로 갔다). 여기서 보장하는 것은
   **"더 나빠지지 않는다"** 하나다 — `max-lines`·`cognitive-complexity` 래칫과 같은 규율.

   ⚠ **판정을 좁힌 이유(실측)**: `border`+`rounded` 아무거나로 세면 **108 선언/41 파일**인데
   그 대부분이 알약·칩(`rounded-full`+테두리)이라 원칙 ④와 무관하다. 좁힌 기준
   (테두리 + `rounded-md` 이상 + 배경/그림자)이 곧 "카드 표면"이다.
   느슨한 기준으로 래칫을 걸면 알약을 고칠 때마다 게이트가 우는 소음 장치가 된다.

   ⚠⚠ **컨트롤은 표면이 아니다.** 첫 판(46)은 `<input>`·`<button>` 까지 셌고, 그래서 도입 직후
   폰 캡처 바의 입력 하나에 즉시 울었다 — 그런데 그 입력은 `phone/DayView` 의 할일 입력과 **글자
   그대로 같은 관용구**다(`rounded-md border border-line bg-panel px-3`). 즉 검출기가 "카드 면"과
   "폼 컨트롤"을 뭉뚱그린 것이지 코드가 규약을 어긴 것이 아니었다. 여기서 래칫을 올렸다면
   `max-lines` 가 102줄 헐거워져 있던 것(A16)과 같은 종류의 무신호가 된다 → **검출기를 고쳤다.** */
const 카드래칫 = 39;
/** 표면이 아니라 *컨트롤*인 태그 — 여기 붙은 클래스는 원칙 ④의 대상이 아니다. */
const 컨트롤태그 = /^(input|button|select|textarea|a|label|option)\b/i;
const 카드표면 = [];
const 클래스문자열 = /(?:className\s*=\s*["'`]([^"'`]*)["'`])|(?:^\s*(?:const|let)\s+[A-Z_0-9]+\s*=\s*["'`]([^"'`]*)["'`])/gm;
for (const p of 파일들(ROOT).filter((f) => /\.tsx?$/.test(f))) {
  const src = readFileSync(p, 'utf8');
  for (const m of src.matchAll(클래스문자열)) {
    const c = m[1] ?? m[2];
    if (!c) continue;
    const 테두리 = /(^|\s)border(\s|-|$)/.test(c);
    const 큰반경 = /(^|\s)rounded-(md|lg|xl|2xl)(\s|$)/.test(c);
    const 면 = /(^|\s)(bg-|shadow-)/.test(c);
    if (!(테두리 && 큰반경 && 면)) continue;
    /* 이 className 을 문 여는 태그를 뒤로 훑어 찾는다(JSX 속성은 여는 태그 안에 있다).
       ⚠ **`className=` 형태일 때만** 본다 — 모듈 상단 `const CARD = '…'` 상수는 태그 밖이라
       뒤로 훑으면 무관한 `<` 를 집어 조용히 건너뛰게 된다(거짓 음성). 상수는 항상 센다. */
    if (m[1] !== undefined) {
      const 여는태그 = src.lastIndexOf('<', m.index);
      if (여는태그 >= 0 && 컨트롤태그.test(src.slice(여는태그 + 1, 여는태그 + 12))) continue;
    }
    카드표면.push(p);
  }
}
if (카드표면.length > 카드래칫) {
  console.error(`✗ 둥근 글래스 카드 표면이 늘었다: ${카드표면.length} > 래칫 ${카드래칫}`);
  console.error('  디자인시스템 §0 원칙 ④가 폐기한 형태다. 표면은 `ds-canvas`·`ds-rule`·`ds-well` 중 하나여야 한다.');
  console.error(`  파일: ${[...new Set(카드표면)].join(', ')}`);
  process.exit(1);
}

console.log(
  `✓ CSS 변수 참조 ${참조.size}종 전부 정의됨(선언 ${선언.size}종) · tokens.css 미사용 0(원장 ${미사용_원장.length}건) · *.module.css 0개 · 카드 표면 ${카드표면.length}/${카드래칫}.`,
);
