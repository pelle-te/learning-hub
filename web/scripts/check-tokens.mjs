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
import { 생hex검사 } from './_hexcheck.mjs';

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
/* 참조 **두 문법** — `var(--name` 과 `getPropertyValue('--name')`.

   ⚠⚠ 두 번째가 이 게이트의 사각이었다(H24 · 2026-07-31 `/감사 근본`). 캔버스는 `var()` 를
   해석하지 못해서 JS 가 토큰을 **런타임에 읽어** 넣는데(`Graph.readPalette`·`AmbientCanvas`·
   `Settings.readAccentPreviews`·`lib/motion`), 그 11곳이 `var(` 문법을 안 쓴다는 이유로 검사
   범위 밖이었다. 그 자리들은 하필 전부 **다크 전용 hex 폴백**을 함께 들고 있어서, 이름을
   오타내면 조용히 그 hex 로 렌더되고 **라이트에서 의미가 뒤집힌다** — H20 이 이 검사기를 만든
   바로 그 실패 형태이고, `lib/ledger.ts:50` 이 _"폴백을 되살리지 말 것"_ 이라 못박은 부류다.

   즉 검사기가 "TS 문자열 속 토큰"을 본다고 말하면서 **한 문법만** 보고 있었다. */
const 참조패턴들 = [/var\(\s*(--[a-zA-Z0-9-]+)/g, /getPropertyValue\(\s*['"`](--[a-zA-Z0-9-]+)['"`]/g];

/* ⚠ **주석을 걷어낸 뒤 스캔한다**(E24 · 2026-07-30). 이 저장소의 주석은 옛 이름·틀린 이름을
   인용해 *왜 바뀌었는지*를 남기는 문화이고(그게 규약이다), 이 검사기의 탄생 사유 자체가
   `var(--tx)` 오타다 — 그래서 그 사유를 주석에 적는 순간 **인용이 위반으로 잡혔다**(실제로
   `tokenBridge.css` 에서 물렸다). 검사 대상은 **선언과 참조**이고 주석 안 CSS 는 실행되지
   않으므로 조용한 실패가 원리적으로 불가능하다.
   ⚠ 줄 번호를 보고하므로 **줄바꿈을 보존**하며 지운다(내용만 공백으로).
   ⚠ 같은 이유로 `test/invariants.test.ts` 의 불변식 ⑤·⑥도 같은 처리를 한다 — 검사기가 셋인데
     처리가 갈리면 "어느 검사기가 주석을 보는가"를 사람이 외워야 한다. */
/* ⚠⚠ **`/*` 앞 글자를 본다 — 안 보면 문자열 속 글롭이 주석을 연다**(I049 실행 중 발견 ·
   2026-08-22). `GuideView` 의 `<Cmd>exports/*.txt</Cmd>` 가 주석 시작으로 읽혀 그 뒤
   **파일의 절반이 공백으로 지워졌고**, 그 구간의 `text-learning` 소비가 안 보였다.
   증상은 «쓰고 있는 토큰이 고아로 잡힌다» 인데, 다른 소비처가 하나라도 있으면 조용하다 —
   실제로 그 화면이 삭제되기 전까지 몇 달을 조용히 지나갔다. 진짜 주석은 줄머리·공백·`{`
   뒤에 오고, 글롭은 단어문자 뒤에 온다. */
function 주석제거(본문) {
  return 본문
    .replace(/(^|[^A-Za-z0-9_])\/\*[\s\S]*?\*\//g, (m, p1) => p1 + m.slice(p1.length).replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

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
  const 본문 = 주석제거(readFileSync(파일, 'utf8'));
  for (const 패턴 of 선언패턴) for (const m of 본문.matchAll(패턴)) 선언.add(m[1]);
  const 줄들 = 본문.split('\n');
  줄들.forEach((줄, i) => {
    for (const 패턴 of 참조패턴들) {
      for (const m of 줄.matchAll(패턴)) {
        const 이름 = m[1];
        if (!참조.has(이름)) 참조.set(이름, []);
        참조.get(이름).push(`${파일}:${i + 1}`);
      }
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

   ⚠ **이 검사의 범위는 `tokens.css` 뿐이다** — `tokenBridge.css` 의 `@theme` 항목(`--color-*`·
   `--text-*`)은 Tailwind 가 유틸을 생성해 소비하지 `var()` 로 참조하지 않아 여기서는 전량 오탐이
   된다. ⚠⚠ 종전 이 줄은 거기서 멈춰 **브리지는 검사할 수 없다**로 읽혔는데, 그게 사각이었다:
   못 하는 것은 *이 문법으로* 였고 유틸 접미사로는 된다 → **아래 「브리지 고아」가 그 축을 맡는다**.
   ⚠ 예외는 **사유+만료일 원장**이다(SCA·a11y 원장과 같은 규율). 유효기간 없는 예외는 판단이
   아니라 방치다. */
/* ⚠ 지금은 **비어 있다** — `--fs-spine`(72px)이 유일한 항목이었고 W11(2026-07-31)에서 토큰째
   지웠다. 원장의 옛 사유는 _"지우면 사다리가 자기 범위에 대해 거짓말을 한다"_ 였는데, 실측이
   그 전제를 뒤집었다: `--fs-subj` 가 `clamp(40px, 5.4vw, 72px)` 라 **72px 은 이미 히어로 과목명이
   실제로 렌더하는 크기**다. 즉 사다리의 범위는 소비처가 있는 토큰이 이미 증언하고 있었고,
   `--fs-spine` 은 구현된 적 없는 '회전 스파인'의 잔재였다.
   ⚠ 배열이 비어도 **기계는 남긴다** — 다음 고아 토큰이 조용히 쌓이는 것을 막는 것이 이 검사의
   목적이고, 예외는 그때 사유+만료일과 함께 다시 들어온다. */
const 미사용_원장 = [];

/* ⚠⚠ **역방향 검사의 소비면에는 `test/` 도 든다(2026-08-20).**

   앞의 정방향 검사(미정의 참조)는 `src` 만 보는 것이 옳다 — 거기가 렌더되는 코드다. 그런데
   **역방향**(안 쓰이는 토큰)에 같은 범위를 쓰면 *테스트가 유일한 소비처인 토큰* 을 고아로 본다.

   실제로 그렇게 물렸다: `--bg2` 는 화면이 직접 안 쓰지만 `test/accentContrast.test.ts` 가
   **라이트 대비 계약의 밑면**(라이트 배경 4종 중 가장 어두운 면)을 고를 때 읽는다. 지우면 밑면이
   `--panel2`(더 밝다)로 바뀌어 **a11y 계약이 조용히 느슨해진다** — 게이트는 녹색인 채로. 이
   검사가 그것을 "지우세요"라고 권했고, 지웠고, 그 테스트가 잡았다.

   즉 *렌더되지 않지만 계약을 진다* 는 세 번째 소비 형태가 있다. 범위를 넓혀 그것을 인정한다.
   ⚠ 대가는 안다: 테스트만 붙들고 있는 죽은 토큰은 이제 안 잡힌다. 그 부류의 집행자는 **불변식
     ⑭**(테스트만 import 하는 프로덕션 모듈이 없다)이고, 여기서 또 잡으면 판정이 둘로 갈린다. */
const 테스트참조 = new Set();
for (const 파일 of 파일들('test')) {
  const 본문 = 주석제거(readFileSync(파일, 'utf8'));
  for (const 패턴 of 참조패턴들) for (const m of 본문.matchAll(패턴)) 테스트참조.add(m[1]);
  /* 테스트는 `토큰("...", '--bg2')` 처럼 **이름만 문자열로** 넘겨 CSS 를 파싱하기도 한다 —
     `var(` 도 `getPropertyValue(` 도 아니라 위 두 패턴에 안 걸린다. 따옴표 안의 토큰 이름을
     함께 걷는다(이 형태를 놓친 것이 `--bg2` 사고의 직접 원인이다). */
  for (const m of 본문.matchAll(/['"`](--[a-zA-Z0-9-]+)['"`]/g)) 테스트참조.add(m[1]);
}
const 쓰인다 = (n) => 참조.has(n) || 테스트참조.has(n);

const tokensCss = 주석제거(readFileSync(join(ROOT, 'styles/tokens.css'), 'utf8'));
const 토큰선언 = new Set([...tokensCss.matchAll(/^\s*(--[a-zA-Z0-9-]+)\s*:/gm)].map((m) => m[1]));
const 원장이름 = new Set(미사용_원장.map((r) => r.이름));
const 만료된 = 미사용_원장.filter((r) => new Date(r.만료) < new Date());
const 미사용 = [...토큰선언].filter((n) => !쓰인다(n) && !원장이름.has(n));
// 사문화한 원장 항목(이미 쓰이게 된 것)도 실패다 — 남아 있으면 그게 방치다.
const 사문화 = 미사용_원장.filter((r) => 쓰인다(r.이름) || !토큰선언.has(r.이름));

if (미사용.length || 만료된.length || 사문화.length) {
  if (미사용.length) {
    console.error('✗ 선언됐는데 아무 데서도 참조되지 않는 토큰:\n');
    for (const 이름 of 미사용) console.error(`  ${이름}`);
    console.error('\n지우거나(주인 UI 가 사라졌다면) 쓰거나, 사유+만료일과 함께 원장에 올리세요.');
  }
  for (const r of 만료된) console.error(`✗ 미사용 원장 만료: ${r.이름}(만료 ${r.만료}) — 다시 판단할 때다.`);
  for (const r of 사문화)
    console.error(`✗ 미사용 원장 사문화: ${r.이름} — 이제 쓰이거나 선언이 없다. 원장에서 빼세요.`);
  process.exit(1);
}

/* ── 반픽셀 `--fs-*` 래칫(U035 · 2026-08-21 ux 축) ────────────────────────────────────
   `tokens.css` 머리주석은 오래 «반픽셀 금지»라 선언했는데 68줄 아래에 **5칸이 실재했다**.
   지우는 것이 답이 아닌 이유는 `stylelint.config.js:17-22` 가 기록한 실사고다(정수로 일괄
   **상향** → 월 캘린더 셀에서 과목 칩이 잘림). 그래서 계약을 «금지»가 아니라 **«늘지 않는다»**
   로 바꾸고, 그 계약을 여기서 집행한다 — 선언만 있고 집행이 없으면 흘러내린다는 이 저장소의
   결론 그대로다.
   ⚠ 줄이는 방향은 **내림만** 안전하다(행 높이는 남으면 남았지 모자라지 않는다). 줄였으면
   이 상수를 함께 낮춘다 — 안 낮추면 되돌아와도 안 잡힌다. */
/* ⭐ **0 이 됐다**(U069 · 2026-08-31). W11 2단계(반올림)를 실제로 했고, 방향(올림)의 근거와
   그것을 어떻게 쟀는지는 `tokens.css` 의 `--fs-*` 사다리 주석이 소유한다. 요지: 「올림 금지」의
   근거였던 실사고의 **전제가 그 뒤 사라졌고**(칩 줄이 `MAX_CHIPS` 로 묶였다), `SEED_MONTH_CHIPS`
   로 네 폭에서 재니 넘침 0 이었다. 이제 한 칸이라도 반픽셀이 생기면 게이트가 깨진다. */
const 반픽셀_래칫 = 0;
const 반픽셀 = [...tokensCss.matchAll(/^\s*(--fs-[a-zA-Z0-9-]+):\s*[0-9]+\.5px;/gm)].map((m) => m[1]);
if (반픽셀.length > 반픽셀_래칫) {
  console.error(`✗ 반픽셀 --fs-* 칸이 늘었다: ${반픽셀.length} > ${반픽셀_래칫}\n`);
  for (const 이름 of 반픽셀) console.error(`  ${이름}`);
  console.error('\n  새 칸은 정수로 만드세요(확대·고DPI 에서 렌더가 흔들린다). 근거는 tokens.css 머리주석.');
  process.exit(1);
}
if (반픽셀.length < 반픽셀_래칫) {
  console.error(
    `✗ 반픽셀 --fs-* 칸이 ${반픽셀.length} 로 줄었다(래칫 ${반픽셀_래칫}) — 좋은 일이다. ` +
      `scripts/check-tokens.mjs 의 \`반픽셀_래칫\` 을 ${반픽셀.length} 로 낮추세요(그래야 되돌아오면 잡힌다).`,
  );
  process.exit(1);
}

/* ── 브리지 고아 — **`@theme` 항목의 주인 UI 가 사라졌다**(2026-08-20 리뷰) ────────────
   바로 위 역방향 검사는 범위를 `tokens.css` 로 좁히며 그 이유를 이렇게 적었다: *"`tokenBridge.css`
   의 `@theme` 항목은 Tailwind 가 유틸을 생성해 소비하지 `var()` 로 참조하지 않는다 → 전량
   오탐이 된다."* **앞 절반은 맞고 결론이 틀렸다.** 오탐이 되는 것은 `var()` **문법으로 찾을 때**
   뿐이고, 소비 흔적은 다른 문법으로 실재한다 — **유틸 접미사**(`--text-markets-title` 의 소비는
   JSX 의 `text-markets-title` 이다). 즉 검사가 불가능했던 게 아니라 기법이 없었다.

   그 사각에 실제로 쌓여 있었다: P10 W4(2026-08-07)가 화면 다섯(`control`·`discovery`·`atlas`·
   `markets`·`reads`)을 삭제했는데 **그 화면들의 브리지 토큰은 남았고**, 이 파일의 주석은 없는
   UI 를 현재형으로 설명하고 있었다. 위 역방향 검사가 막으려던 실패 형태(_"다음 사람이 죽은
   이름을 살아 있는 어휘로 읽고 재사용한다"_) 그대로다.

   판정: `var(--이름)` 직접 참조 **또는** 그 네임스페이스가 만드는 **유틸 클래스 이름**이 등장하면
   살아 있다(`--shadow-seg-on` → `shadow-seg-on` · `--container-runner` → `max-w-runner`).

   ⚠⚠ **접두사까지 봐야 한다 — 접미사만 보면 조용히 통과한다.** 첫 판은 "접미사가 클래스 경계에
     등장하면 산 것"이었는데, 접미사가 짧으면 아무 문맥에나 걸린다: `--shadow-bar`(접미사 `bar`)·
     `--container-hint`(`hint`)·`--grid-template-columns-reads`(`reads` ← `'lh:reads'` 문자열)·
     `--shadow-pop`(`pop` ← `enter-pop`)이 전부 **소비처 0인데 살아 있다고 판정**됐다. 접두사를
     요구하면 그 넷이 즉시 드러난다 — 그게 이 표가 있는 이유다.
   ⚠ 그래서 표가 낡으면 **오탐(거짓 실패)** 이 난다. 새 네임스페이스를 브리지에 들이면 여기도
     함께 늘린다(`--width-*`·`--blur-*` 가 실제로 그렇게 빠져 있었다).
   ⚠ 클래스 뒤에 단어문자가 오면 다른 이름이다 — `hero-y` 가 `hero-y-today` 안에서 매치하면
     죽은 토큰이 살아 있는 것으로 보인다(이 검사를 만들 때 그 형태로 한 번 속았다).
   ⚠ 앞은 안 본다. 변형(`hover:`·`max-mobile:`·`group-hover:`)과 `!`·`-` 접두가 자유롭게 붙는데
     그 목록을 다시 외우면 표가 둘이 된다 — 클래스 **본체**가 나타나는 것으로 충분하다. */
const 브리지_원장 = [];

/* 네임스페이스 → 그것이 만드는 유틸 접두사. 값이 `[]` 면 접두사 없이 이름 자체가 클래스다. */
const 유틸접두사 = {
  color: [
    'bg',
    'text',
    'border',
    'border-x',
    'border-y',
    'border-t',
    'border-r',
    'border-b',
    'border-l',
    'outline',
    'ring',
    'ring-offset',
    'divide',
    'from',
    'via',
    'to',
    'fill',
    'stroke',
    'decoration',
    'caret',
    'accent',
    'placeholder',
    'shadow',
    'inset-shadow',
    'inset-ring',
  ],
  text: ['text'],
  shadow: ['shadow', 'inset-shadow', 'drop-shadow', 'text-shadow'],
  spacing: [
    'p',
    'px',
    'py',
    'pt',
    'pr',
    'pb',
    'pl',
    'm',
    'mx',
    'my',
    'mt',
    'mr',
    'mb',
    'ml',
    'gap',
    'gap-x',
    'gap-y',
    'space-x',
    'space-y',
    'w',
    'h',
    'size',
    'min-w',
    'min-h',
    'max-w',
    'max-h',
    'inset',
    'inset-x',
    'inset-y',
    'top',
    'right',
    'bottom',
    'left',
    'basis',
    'indent',
    'translate-x',
    'translate-y',
    'scroll-m',
    'scroll-p',
  ],
  container: ['max-w', 'w', 'min-w'],
  'grid-template-columns': ['grid-cols'],
  tracking: ['tracking'],
  leading: ['leading'],
  // U020 — 중량 사다리(`--font-weight-heading` → `font-heading`).
  'font-weight': ['font'],
  radius: [
    'rounded',
    'rounded-t',
    'rounded-r',
    'rounded-b',
    'rounded-l',
    'rounded-tl',
    'rounded-tr',
    'rounded-br',
    'rounded-bl',
  ],
  width: ['w', 'max-w', 'min-w', 'basis'],
  blur: ['blur', 'backdrop-blur'],
  brightness: ['brightness', 'backdrop-brightness'],
  font: ['font'],
  'transition-duration': ['duration'],
  // P038 — 상단바 최소 높이(`--min-height-topbar` → `min-h-topbar`). ⚠ v4 의 `min-h-*` 는
  //   `--spacing-*` 이 아니라 **`--min-height-*`** 를 읽는다(이름을 틀리면 유틸이 안 생긴다).
  'min-height': ['min-h'],
  breakpoint: [], // 변형(`mobile:`)이라 접두사가 없다 — 아래에서 `이름:` 으로 찾는다
};
const 네임스페이스 = Object.keys(유틸접두사).sort((a, b) => b.length - a.length);
const 단어문자 = (c) => c !== undefined && /[A-Za-z0-9_-]/.test(c);

const 브리지 = 주석제거(readFileSync(join(ROOT, 'styles/tokenBridge.css'), 'utf8'));
const 테마본문 = 브리지.slice(브리지.indexOf('@theme static'));
const 테마선언 = [...테마본문.matchAll(/^\s*(--[a-zA-Z0-9-]+)\s*:/gm)].map((m) => m[1]);
const 소비면 = [...파일들(ROOT), ...파일들('test')]
  .filter((p) => !p.includes('tokenBridge'))
  .map((p) => 주석제거(readFileSync(p, 'utf8')))
  .join('\n');

/** 클래스 본체가 **자기 이름으로 끝나며** 등장하는가(뒤에 단어문자가 오면 다른 이름이다). */
function 클래스등장(클래스) {
  for (let i = 소비면.indexOf(클래스); i >= 0; i = 소비면.indexOf(클래스, i + 1)) {
    if (!단어문자(소비면[i + 클래스.length])) return true;
  }
  return false;
}

function 소비되나(이름) {
  if (소비면.includes(이름)) return true; // var(--이름) 직접 참조(임의값·JS 읽기)
  const 벗김 = 이름.slice(2);
  const ns = 네임스페이스.find((n) => 벗김.startsWith(n + '-'));
  if (!ns) return 클래스등장(벗김); // 네임스페이스 밖 — 이름 자체가 클래스일 수밖에 없다
  const 접미사 = 벗김.slice(ns.length + 1);
  /* 브레이크포인트는 **변형**이라 콜론 뒤에 클래스가 이어진다(`max-narrow:grid-cols-1`) —
     여기에 "뒤에 단어문자가 오면 다른 이름" 규칙을 적용하면 정상 사용이 통째로 고아로 잡힌다
     (실측: `--breakpoint-narrow` 가 13곳에서 쓰이는데 실패했다). 콜론 자체가 경계다. */
  if (ns === 'breakpoint') return 소비면.includes(접미사 + ':');
  return 유틸접두사[ns].some((p) => 클래스등장(p + '-' + 접미사));
}

const 브리지원장이름 = new Set(브리지_원장.map((r) => r.이름));
const 브리지고아 = 테마선언.filter((이름) => !브리지원장이름.has(이름) && !소비되나(이름));
const 브리지만료 = 브리지_원장.filter((r) => new Date(r.만료) < new Date());

if (브리지고아.length || 브리지만료.length) {
  if (브리지고아.length) {
    console.error('✗ `@theme` 에 있는데 소비하는 유틸·참조가 없는 브리지 토큰:\n');
    for (const 이름 of 브리지고아) console.error(`  ${이름}`);
    console.error('\n주인 UI 가 사라졌으면 지우세요 — 남으면 주석이 없는 화면을 현재형으로 설명합니다.');
  }
  for (const r of 브리지만료) console.error(`✗ 브리지 원장 만료: ${r.이름}(만료 ${r.만료}) — 다시 판단할 때다.`);
  process.exit(1);
}

/* ── ⭐ **선언 안 됐는데 쓰이는 사다리 칸**(U001 · 2026-08-21 ux 축) ────────────────────
   위 「브리지 고아」의 **거울상**이다. 저기는 *선언됐는데 안 쓰이는 것*을 잡는데, Tailwind v4
   에서 진짜 위험한 쪽은 반대다: `@theme` 에 **없는** 이름은 오류가 아니라 **Tailwind 기본값으로
   조용히 실린다.** 그래서 이 방향은 정의상 고아가 아니고 어느 검사에도 안 걸렸다.

   실측(2026-08-21): `text-base`(21곳)·`rounded-xs`(22)·`text-3xl`(3)·`text-4xl`·`text-5xl` 이
   그 상태였다. 전부 **rem 기본값**이라, 이 저장소가 px 로 세운 사다리와 단위가 갈려 루트 글꼴을
   키우면 사다리가 역전했다(U002 · 실측: 루트 20px 에서 `text-base` 20px = `text-xl` 20px).

   그리고 이것이 이 회차의 근본 원인 R1 의 집행자다: 린트는 `text-[16px]` 은 막지만
   `text-base` 는 통과시킨다 — **같은 16px 인데**. 값을 보는 검사는 여기 하나뿐이다.

   ⚠ 구조 키워드는 사다리가 아니다(`text-center`·`rounded-full`·`leading-none`…). 목록으로
   빼는 것 말고 방법이 없다 — 늘어나면 여기 적는다.
   ⚠ `text-<이름>` 은 **색이기도 하다**(`text-mut`). 색은 `--color-<이름>` 으로 선언되므로 둘 다 본다. */
const 구조키워드 = new Set([
  // 정렬·장식(text-)
  'center',
  'left',
  'right',
  'justify',
  'start',
  'end',
  'ellipsis',
  'clip',
  'wrap',
  'nowrap',
  'balance',
  'pretty',
  'transparent',
  'current',
  'inherit',
  // 모서리(rounded-) — 방향·극단값
  'full',
  'none',
  't',
  'b',
  'l',
  'r',
  'tl',
  'tr',
  'bl',
  'br',
  's',
  'e',
  'ss',
  'se',
  'es',
  'ee',
]);
/** 사다리 네임스페이스 → 그 접두사가 붙은 클래스가 참조할 수 있는 `@theme` 네임스페이스들.

    ⚠ **`leading`·`tracking` 은 일부러 뺐다.** 이 검사가 겨누는 것은 *«px 사다리에 rem 칸이
    섞이는 것»* 인데(U002), 줄높이는 무단위/배수이고 자간은 `em` 이라 루트 글꼴이 바뀌어도
    **같은 비율로 따라간다** — 단위 충돌이 원리적으로 없다. 넣으면 `tracking-tight` 류
    내장 이름이 전부 잡혀 노이즈가 신호를 묻는다(a11y 임계를 `serious`+ 로 잡은 것과 같은 판단).
    ⚠ 대상은 **TS/TSX 만**이다 — CSS 파일에는 `text-align` 같은 **속성 이름**이 있어 클래스로
    오인된다(실측 6종). 클래스는 JSX 에 산다. */
const 사다리 = { text: ['text', 'color'], rounded: ['radius'] };
/** `rounded-t-sm` 처럼 **방향 조각**이 사이에 낀다 — 벗겨 내고 사다리 칸만 본다. */
const 방향조각 = /^(t|b|l|r|s|e|tl|tr|bl|br|ss|se|es|ee)-/;

const 선언된테마 = new Set(테마선언);
const 클래스면 = 파일들(ROOT)
  .filter((p) => /\.tsx?$/.test(p) && !p.includes('tokenBridge'))
  .map((p) => 주석제거(readFileSync(p, 'utf8')))
  .join('\n');
const 미선언사다리 = [];
for (const [접두, ns들] of Object.entries(사다리)) {
  /* ⚠ 여는 대괄호는 **경계로 치지 않는다** — `[text-anchor:middle]`·`transition-[text-decoration-color]` 는
     클래스가 아니라 **임의 속성 문법 안의 CSS 속성 이름**이다(실측 3종). 뒤따르는 `:` 도 같은
     신호라 함께 막는다. 변형 접두(`hover:`)·`!` 는 경계로 남는다. */
  const re = new RegExp(`(?:^|[\\s"'\`:!])${접두}-([a-z0-9]+(?:[.-][a-z0-9]+)*)(?![\\w-:])`, 'g');
  const 본 = new Set();
  for (const m of 클래스면.matchAll(re)) {
    const 접미 = m[1].replace(방향조각, '');
    if (구조키워드.has(접미) || 본.has(접미)) continue;
    본.add(접미);
    if (!ns들.some((ns) => 선언된테마.has(`--${ns}-${접미}`))) 미선언사다리.push(`${접두}-${접미}`);
  }
}

if (미선언사다리.length) {
  console.error('✗ `@theme` 에 선언되지 않은 사다리 칸이 쓰이고 있다(= Tailwind 기본값 rem 으로 실린다):\n');
  for (const c of 미선언사다리) console.error(`  ${c}`);
  console.error('\n  임의값(`text-[16px]`)만 막고 이걸 통과시키면 집행자가 **값이 아니라 형식**을 막는 것이다(U001).');
  console.error('  `tokenBridge.css` 의 `@theme` 에 px 로 이름을 주거나, 이미 있는 칸을 쓰세요.');
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

/* ── `ds-*` 고아 — **정의됐는데 아무 화면도 안 쓰는 공유 클래스**(2026-08-20 리뷰) ──────────
   `ds.css` 는 이 부류를 **세 번** 기록하고 매번 지웠다: `.ds-card`(소비처 0 · 은퇴) ·
   `.ds-muted`(0 · 은퇴) · `.ds-canvas`(0 · D6 에서 삭제). 그 마지막 항목의 주석이 왜 위험한지도
   적어 뒀다 — _"문서가 코드에 없는 선택지를 광고하면 다음 화면이 그걸 고르려다 아무 효과도 못
   받는다(그 자체로 조용한 실패다)"_.

   그런데 **그 셋을 잡은 것은 사람이지 기계가 아니었다.** eslint 의 `no-unknown-classes` 는
   `^ds-` 를 통째로 면제하므로(전역이라 알 수 없다) 반대 방향은 아무도 안 본다. 그래서 넷째가
   조용히 생겼다: `.ds-sub`(Q-10 · 2026-08-02). 아래 원장이 그것이다.

   ⚠ 판정은 브리지 고아와 같은 규율이다 — 이름 뒤에 단어문자가 오면 다른 클래스다
     (`ds-caps` 가 `ds-caps-sm` 안에서 매치하면 안 된다). */
/* ⚠ 지금은 **비어 있다** — `ds-sub` 가 유일한 항목이었고 같은 날 지웠다(소비처 0 · 붙일 자리를
   찾아봤지만 0 이었다 · 근거 전문은 `ds.css` 의 그 자리 주석). 배열이 비어도 **기계는 남긴다**:
   `.ds-card`·`.ds-muted`·`.ds-canvas` 를 사람이 세 번 손으로 잡아낸 것이 이 검사가 생긴 이유이고,
   넷째가 조용히 생기는 것을 막는 것이 목적이다. 예외는 그때 사유+만료일과 함께 다시 들어온다. */
const ds_원장 = [];

const dsCss = 주석제거(readFileSync(join(ROOT, 'styles/ds.css'), 'utf8'));
const ds클래스 = [...new Set([...dsCss.matchAll(/\.(ds-[A-Za-z0-9-]+)/g)].map((m) => m[1]))];
const ds소비면 = [...파일들(ROOT), ...파일들('test')]
  .filter((p) => !p.endsWith('ds.css'))
  .map((p) => 주석제거(readFileSync(p, 'utf8')))
  .join('\n');
const ds원장이름 = new Set(ds_원장.map((r) => r.이름));

function ds쓰이나(이름) {
  for (let i = ds소비면.indexOf(이름); i >= 0; i = ds소비면.indexOf(이름, i + 1)) {
    if (!단어문자(ds소비면[i + 이름.length])) return true;
  }
  return false;
}

const ds고아 = ds클래스.filter((c) => !ds원장이름.has(c) && !ds쓰이나(c));
const ds만료 = ds_원장.filter((r) => new Date(r.만료) < new Date());
const ds사문화 = ds_원장.filter((r) => !ds클래스.includes(r.이름) || ds쓰이나(r.이름));

if (ds고아.length || ds만료.length || ds사문화.length) {
  if (ds고아.length) {
    console.error('✗ `ds.css` 에 정의됐는데 쓰는 화면이 없는 클래스:\n');
    for (const c of ds고아) console.error(`  .${c}`);
    console.error('\n지우거나 쓰거나, 사유+만료일과 함께 원장에 올리세요(ds.css 가 이미 셋을 그렇게 은퇴시켰다).');
  }
  for (const r of ds만료) console.error(`✗ ds 원장 만료: .${r.이름}(만료 ${r.만료}) — 쓸 자리를 정하거나 지울 때다.`);
  for (const r of ds사문화) console.error(`✗ ds 원장 사문화: .${r.이름} — 이제 쓰이거나 정의가 없다. 원장에서 빼세요.`);
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
   `max-lines` 가 102줄 헐거워져 있던 것(A16)과 같은 종류의 무신호가 된다 → **검출기를 고쳤다.**

   ── ⚠⚠ W14(2026-07-31) — **카운터를 파일 원장으로 바꿨다** ──────────────────────────
   목표가 0인 래칫은 카운터가 아니라 **린트**여야 한다. 숫자 하나로 재면 "한 곳에서 지우고 다른
   곳에 새로 만드는" 교환이 조용히 통과한다 — 총합은 그대로인데 규약 위반은 **새 파일로 번진다**.
   지금은 **파일 단위 원장**이다: 여기 없는 파일에 카드 표면이 생기면 즉시 실패하고, 원장에 있는
   파일이 깨끗해지면 원장에서 빼라고 시끄럽게 말한다(사문화도 실패 — SCA·a11y 원장과 같은 규율).
   ⚠ 총량 상한도 유지한다(원장 안에서 무한히 늘어나는 것을 막는다). */
/** 카드 표면이 아직 남아 있는 파일(원장). **여기 없는 파일에 새로 생기면 실패.** */
/* ⚠ 다섯이 P10 W4 에서 빠졌다(2026-08-07 · `atlas`·`control`·`discovery`·`reads` 둘) — 파일이
   사라졌고, 원장이 없는 파일을 가리키면 그 자체가 사문이다(이 검출기가 스스로 그렇게 말한다). */
const 카드원장 = new Set([
  /* ⚠ W4(발산 6회차 · 2026-08-07) — `goals`·`guide` 가 흡수한 호스트 폴더로 **이사**했다
     (로스터 행을 지우면 파일 배치도 따라간다). 원장은 *경로*로 재므로 같은 표면이 새 경로에서
     "새 위반"으로 잡히는데, 그건 이 검출기가 옳게 동작한 것이다 — 이름만 갈아 준다. */
  /* ⛔ `features/degree/PathView.tsx` 가 여기 있었다 — 그 화면이 삭제됐다(2026-08-29 · 부모
     pipeline 목적 정정으로 goals 계약이 생산자째 은퇴). 같은 회차에 `mastery/` 넷도 나갔다. */
  'features/find/GuideView.tsx',
  /* ⚠ `features/graph/Graph.tsx` 가 여기 있었다 — 그 화면이 삭제됐다(I044 · 2026-08-22). */
  'features/integrations/VaultPanel.tsx',
  'features/items/ItemCard.tsx',
  'features/ledger/Ledger.tsx',
  'features/mistakes/Mistakes.tsx',
  'features/review/Review.tsx',
  'features/review-run/ReviewRun.tsx',
  'features/settings/UpdateCard.tsx',
  'phone/DayView.tsx',
  'phone/ReviewView.tsx',
  'phone/TodayView.tsx',
]);
/* ⚠⚠ **38 → 25 로 내린다(2026-08-20).** 이 래칫의 계약은 바로 위 주석이 적은 대로 *"원장 안에서도
   무한 증식은 막는다"* 인데, 실측 **25** 에 상한 38 이면 여유가 **52%** 다 — 원장에 있는 열세 파일
   안에서 카드 표면을 열세 개 더 만들어도 조용히 통과한다. 그건 상한이 아니라 장식이다.

   왜 벌어졌나: **P10 W4(2026-08-07)가 화면 다섯을 지웠는데 이 수를 안 내렸다.** 같은 커밋이
   `bundle-budget.mjs` 의 js 한도는 내리며 그 이유를 _"한도를 그대로 두면 33% 여유가 되어 게이트가
   아무것도 안 지킨다"_ 라 적어 뒀다 — 그 판정이 여기까지 오지 않은 것이고, `phone.html` 의 css
   한도도 같은 커밋에서 같은 이유로 빠졌다(셋 다 2026-08-20 에 함께 갚는다).

   ⚠ 여유 **0** 이 의도다. 파일 단위 원장이 이미 *어디에* 있는지를 지키므로, 총량은 "더 늘지
   않는다"만 말하면 된다(인지복잡도 래칫이 같은 이유로 여유 0을 택했다). 리팩터로 표면 하나가
   진짜 늘어야 한다면 그때 근거와 함께 이 수를 올린다 — 올릴 때 근거를 요구하는 것이 이 장치의 값이다.

   ⚠⚠ **25 → 21 로 조인다**(V026 · 2026-08-22). 원장 항목은 *"여유 0이라 다음 리팩터가 즉시
   막힌다"* 였는데 실측은 **반대**였다: 코드 축 1회차의 삭제들(C059 §③ · C061 · C065 등)이 표면
   넷을 걷어 **21/25 = 여유 4** 가 돼 있었다. 즉 «막힌다»가 아니라 **래칫이 4만큼 헐거워졌다**.
   그 폭만큼 표면이 조용히 되돌아올 수 있고, 래칫의 유일한 일이 "더 나빠지지 않는다"인데 그
   보장이 4만큼 비어 있었다 — `eslint.config.js` 의 `max-lines` 가 H18 에서 **21줄 느슨**했던 것과
   글자 그대로 같은 형태다(그쪽도 실측에 붙이는 것으로 갚았다).
   ⚠ 그러니 이 수는 **삭제할 때마다 함께 내려야 한다.** 안 내리면 다음 리뷰가 같은 것을 다시 발견한다. */
const 카드래칫 = 21;
/** 표면이 아니라 *컨트롤*인 태그 — 여기 붙은 클래스는 원칙 ④의 대상이 아니다. */
const 컨트롤태그 = /^(input|button|select|textarea|a|label|option)\b/i;
const 카드표면 = [];
const 클래스문자열 =
  /(?:className\s*=\s*["'`]([^"'`]*)["'`])|(?:^\s*(?:const|let)\s+[A-Z_0-9]+\s*=\s*["'`]([^"'`]*)["'`])/gm;
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
/** `src\features\x.tsx` → `features/x.tsx`(원장 키와 같은 모양 · 윈도/POSIX 구분자 흡수). */
const 정규화 = (p) => p.split(/[\\/]/).slice(1).join('/');
const 카드파일 = new Set(카드표면.map(정규화));
const 새파일 = [...카드파일].filter((p) => !카드원장.has(p));
const 깨끗해진 = [...카드원장].filter((p) => !카드파일.has(p));
if (새파일.length || 깨끗해진.length || 카드표면.length > 카드래칫) {
  if (새파일.length) {
    console.error('✗ 둥근 글래스 카드 표면이 **새 파일**에 생겼다:\n');
    for (const p of 새파일) console.error(`  ${p}`);
    console.error('\n  원칙 ④가 폐기한 형태다. 표면은 `ds-canvas`·`ds-rule`·`ds-well`·`ds-frame` 중 하나여야 한다.');
  }
  for (const p of 깨끗해진)
    console.error(`✗ 카드 원장 사문화: ${p} — 카드 표면이 사라졌다. 원장에서 빼세요(그래야 되돌아오면 잡힌다).`);
  if (카드표면.length > 카드래칫)
    console.error(`✗ 카드 표면 총량이 늘었다: ${카드표면.length} > ${카드래칫}(원장 안에서도 무한 증식은 막는다)`);
  process.exit(1);
}

/* ── ⑨ **같은 접미사, 다른 값** — 두 사다리가 이름을 공유하면 레시피가 조용히 갈린다 (U053·U073) ──

   `tokens.css` 의 `--fs-*` 와 `tokenBridge.css` 의 `--text-*` 는 **둘 다 글자 크기 사다리**인데
   네임스페이스가 갈려 있다. 그래서 같은 접미사가 다른 값을 가질 수 있고, 실제로 둘이 그랬다:

     --fs-3xl  24px   ↔  --text-3xl  30px    (「리드아웃 숫자」 한 레시피가 25% 갈렸다)
     --fs-base 14px   ↔  --text-base 16px

   ⚠⚠ **이건 「죽은 토큰」 검사의 거울상이라 기존 검사가 원리적으로 못 본다** — 둘 다 선언돼
   있고 둘 다 쓰이므로 미정의도 미사용도 아니다. 시각 회귀도 못 잡는다(제목 하나가 6px 자라는
   것은 `maxDiffPixelRatio 0.005` 문턱 아래다). DS §4-1 이 _"값을 베끼지 말고 유틸로 옮겨
   적어라"_ 라고 시키므로, 그 지시를 따른 사람이 **틀린 값을 받는** 경로가 열려 있었다.

   처방은 임계가 아니라 **이름이다**: 접미사가 겹치면 실패시킨다. 그러면 새 칸을 만드는 사람이
   자리 이름(`3xl`) 대신 역할 이름(`ro`·`body`)을 고르게 되고, 이 부류가 못 태어난다. */
const 크기사다리 = (파일, 접두) => {
  const 표 = new Map();
  const src = 주석제거(readFileSync(파일, 'utf8'));
  for (const m of src.matchAll(new RegExp(`--${접두}-([a-z0-9-]+):\\s*(\\d+(?:\\.\\d+)?)px\\s*;`, 'g')))
    표.set(m[1], Number(m[2]));
  return 표;
};
const fs사다리 = 크기사다리('src/styles/tokens.css', 'fs');
const text사다리 = 크기사다리('src/styles/tokenBridge.css', 'text');
const 충돌 = [...fs사다리].filter(([k, v]) => text사다리.has(k) && text사다리.get(k) !== v);
if (충돌.length) {
  console.error('✗ 같은 접미사가 두 사다리에서 다른 값이다 — 한 레시피가 조용히 갈린다:\n');
  for (const [k, v] of 충돌) console.error(`  --fs-${k}: ${v}px  ↔  --text-${k}: ${text사다리.get(k)}px`);
  console.error(
    '\n  ⚠ 값을 맞추지 말고 **이름을 역할로** 바꿔라(`--fs-3xl` → `--fs-ro` · `--fs-base` → `--fs-body`).',
  );
  console.error('    값을 맞추면 픽셀이 바뀌고, 그건 이 검사가 요구하는 것이 아니다.');
  process.exit(1);
}
/* ⚠ 공허 방지 — 두 사다리 중 하나라도 안 읽히면 위 검사는 영원히 0건이다. */
if (fs사다리.size < 5 || text사다리.size < 3) {
  console.error(`✗ 크기 사다리 스캐너가 죽었다(fs ${fs사다리.size} · text ${text사다리.size}) — 정규식이 실물과 갈렸다.`);
  process.exit(1);
}

/* ── ⑩ **주석 뒤 선언이 0인 자리** — 토큰이 죽어도 설명은 안 죽는다 (U055) ──────────────

   토큰 삭제는 `--x: …;` 한 줄을 지우는 일인데, 이 저장소의 주석은 *왜 그 값인가*를 길게 남긴다
   (그게 규약이다). 그래서 은퇴 회차마다 **설명만 남는다.** 2026-08-29 회차가 토큰 19종을 지우고
   주석 8덩이를 고아로 남겼고, 그중 하나는 사다리 칸 수를 **거짓으로** 말했다("축소 3단" · 실물 1).

   ⚠⚠ 이게 위험한 이유는 Tailwind v4 가 **선언되지 않은 이름을 조용히 기본값으로 싣기** 때문이다.
   즉 고아 주석을 읽고 없는 칸을 쓰면 아무 게이트도 안 울린다 — 「죽은 토큰」 검사의 거울상이라
   그 검사가 정의상 못 보는 자리다.

   판정: 주석 블록이 끝난 **다음 비어 있지 않은 줄**이 선언(`--x:`)도 셀렉터도 아니고 또 다른
   주석이면, 앞 주석은 **아무것도 설명하지 않는다.** 블록 닫는 `}` 앞에 온 주석도 같다.
   ⚠ 파일 머리주석·절 구분선은 그 다음에 선언이 오므로 자연히 통과한다. */
const 고아주석 = [];
for (const 파일 of ['src/styles/tokens.css', 'src/styles/tokenBridge.css']) {
  const 줄 = readFileSync(파일, 'utf8').split(/\r?\n/);
  /* 주석 블록을 먼저 **접는다** — `{시작, 끝, 본문}`. 한 번에 판정하려 들면 «주석 다음이 또
     주석» 인 경우가 `continue` 로 빠져 영원히 안 잡힌다(이 검사를 세울 때 물린 셋째 형태이고,
     하필 그게 U055 의 **실제 형상**이다: 그룹의 선언이 통째로 지워지면 주석만 연달아 남는다). */
  const 블록 = [];
  for (let i = 0; i < 줄.length; i++) {
    if (!줄[i].trim().startsWith('/*')) continue;
    let 본문 = '';
    let j = i;
    for (; j < 줄.length; j++) {
      본문 += 줄[j].trim() + ' ';
      if (줄[j].includes('*/')) break;
    }
    블록.push({ 끝: j, 본문 });
    i = j;
  }
  for (const { 끝, 본문 } of 블록) {
    /* ⚠⚠ **주석 하나만 보지 않고 「닫힘까지」 본다.** 「다음 줄이 또 주석이면 고아」로 잡으면
       절 머리주석 아래 하위 절 머리주석이 오는 정상 형태를 전부 신고한다(실측 27건 · 이 검사를
       세울 때 물린 넷째 형태). 고아의 정의는 **그 주석과 블록 닫힘 `}` 사이에 선언이 하나도
       없다**는 것이다 — 그게 U055 의 실제 형상이다(그룹의 선언이 통째로 지워지면 주석이
       `}` 까지 이어진다).
       ⛔ 대가를 명시한다: **블록 한복판의 고아는 못 잡는다.** 지운 토큰의 주석 뒤에 다른
       그룹의 선언이 오면 구조상 구분이 안 된다(그건 내용의 거짓이지 구조의 결함이 아니다 —
       `tokens.css:160` 의 「축소 3단」이 그 부류였고 사람이 읽어서 잡았다). 「0건」을 «고아
       주석이 없다» 로 읽지 마라. */
    let 선언옴 = false;
    let 블록끝만남 = false;
    for (let k = 끝 + 1; k < 줄.length; k++) {
      const t = 줄[k].trim();
      if (t === '' || t.startsWith('/*') || t.startsWith('*')) continue;
      if (t === '}') {
        블록끝만남 = true;
        break;
      }
      선언옴 = true;
      break;
    }
    /* ⚠ 파일 꼬리 노트는 고아가 아니다 — 블록 안이 아니라 **파일 끝**에 있는 설명이고
       (예: stylelint 브레이크포인트 근거), 지워진 토큰의 주석은 정의상 블록 `}` 앞에 남는다.
       그래서 «`}` 를 만났는가» 를 함께 요구한다. */
    if (!블록끝만남) continue;
    /* ⚠ **묘비명은 통과시킨다.** 이 저장소의 규약은 _"지우지 말고 왜 지웠는지 남겨라"_ 이고,
       그 형태는 «X 가 여기 있었다 — 왜 · 복구 한 줄» 이다. 그건 **대상이 없는 것이 정상**인
       주석이라 잡으면 규약과 싸운다. 즉 이 검사가 요구하는 것은 «주석을 지워라»가 아니라
       **«대상이 없으면 없다고 말해라»** 다 — 그것이 U055 에서 실제로 갈린 지점이다
       (2026-08-20 은퇴는 적었고 2026-08-29 은퇴는 안 적었다). */
    const 묘비명 = /여기 있었다|사라졌다|지웠다|지웠고|은퇴했|삭제됐|빠졌다|적지 않는다/.test(본문);
    if (!선언옴 && !묘비명) 고아주석.push(`${파일}:${끝 + 1}`);
  }
}
if (고아주석.length) {
  console.error('✗ 설명할 대상이 없는 주석 — 토큰은 지웠는데 설명이 남았다:\n');
  for (const x of 고아주석) console.error(`  ${x}`);
  console.error(
    '\n  ⚠ 남길 이유가 있으면(묘비명) **왜 지웠는지 + 복구 한 줄**을 적어라 — 「… 가 여기 있었다」.',
  );
  console.error('    설명만 남으면 다음 사람이 없는 칸을 쓰고, Tailwind v4 는 그것을 조용히 기본값으로 싣는다.');
  process.exit(1);
}

/* ⑪ TS 문자열 속 생 hex — 근거·원장은 `scripts/_hexcheck.mjs` 머리주석이 소유한다(V032). */
const hex결과 = 생hex검사(파일들(ROOT), (f) => readFileSync(f, 'utf8'), 주석제거, 정규화);
if (!hex결과.ok) process.exit(1);

console.log(
  `✓ CSS 변수 참조 ${참조.size}종 전부 정의됨(선언 ${선언.size}종) · tokens.css 미사용 0(원장 ${미사용_원장.length}건) · @theme 고아 0(원장 ${브리지_원장.length}건) · ds-* 고아 0(원장 ${ds_원장.length}건) · 미선언 사다리 칸 0 · 사다리 접미사 충돌 0 · 고아 주석 0 · 반픽셀 ${반픽셀.length}/${반픽셀_래칫} · *.module.css 0개 · 카드 표면 ${카드표면.length}/${카드래칫}(원장 ${카드원장.size}파일) · TS 생 hex 0(원장 ${hex결과.원장}파일).`,
);
