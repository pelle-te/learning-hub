import { test, expect } from './_test';
import AxeBuilder from '@axe-core/playwright';
import { 원장판정, 원장메시지 } from '../scripts/ledger-rules.mjs';
import { A11Y_EXTRA, A11Y_OVERLAY, PHONE_VIEWS, SEED, TABS, THEMES, boot, bootPhone, settle } from './_fixtures';

/* ============================================================
   a11y.spec.ts — 접근성 자동검증(axe-core) · 트랙 A.

   ## 왜 생겼나 (2026-07-25 감사)

   종전 a11y 방어는 **`eslint-plugin-jsx-a11y` 하나**였다. 그건 속성 오타·role 대비 필수
   속성 누락 같은 *소스에서 보이는* 것만 본다. 정작 최근에 발견된 결함들은 그 층을 통과했다:

   · **폰 `:focus-visible` 링 전면 부재** — 폰이 `global/components.css` 를 import 하지
     않아 모든 버튼·탭·입력에서 포커스 표시가 없었다. 소스에는 아무 오류가 없다.
   · **`role="tablist"` 반쪽 구현** — tabpanel 연결도 화살표 이동도 없이 롤만 선언.

   둘 다 **사람이 손으로** 찾았다. 린트는 소스를 보고 axe 는 **결과물**을 본다 — 대체재가
   아니라 다른 층이다.

   ## ⚠⚠ 그런데 axe 는 저 둘 중 **첫째를 원리적으로 못 잡는다**(U015 · 2026-08-21 ux 축)

   종전 이 자리는 _"둘 다 axe 가 렌더된 DOM 에서 초 단위로 잡는 부류다"_ 라 적었는데, axe-core
   4.x 의 규칙 목록에 **포커스 표시(`:focus-visible` 링)를 보는 규칙이 없다**(실측). 즉 이
   파일이 자기 존재 이유로 든 첫 예를 이 파일은 못 본다 — 포커스 링을 전 저장소에서 지워도
   여기 128 케이스가 전량 녹색이다.

   그래서 그 층의 집행자는 **시각 회귀 쪽**에 있다(`visual.spec.ts` 의 `focus-ring` 케이스 ·
   Tab 을 한 번 눌러 찍는다). 이 문단을 남기는 이유는, 검사기가 «무엇을 못 보는가»를 안 적으면
   그 사각이 **검사기가 있다는 사실 자체로 덮이기** 때문이다(리포트 §R1 의 형태).

   ## 왜 트랙 A 인가

   axe 는 실제 렌더 트리·계산된 스타일(대비·포커스)을 요구한다. 정적 검사로는 원리적으로
   불가능하고, 트랙 B(실 exe)까지 갈 이유는 없다 — a11y 는 WebView2 고유가 아니다.
   그리고 시각 회귀가 이미 같은 화면들을 같은 시드로 순회한다(`_fixtures.ts`).

   ## ⚠ 임계를 `serious`+`critical` 로 잡은 이유

   axe 의 `minor`/`moderate` 에는 "권고" 성격이 섞여 있어 그대로 게이트에 걸면 노이즈가
   신호를 묻는다 — **sonarjs 를 recommended 없이 규칙 2개만 켠 것과 같은 판단**이고,
   그 결정의 근거는 `eslint.config.js` 가 이미 적어 뒀다("노이즈:신호 비율을 근거로").
   ⚠ 이 임계를 낮추려면 먼저 실측하고 그 비율을 근거로 남길 것.

   ## ⚠ 규칙을 끄지 않는다 — 예외는 원장으로

   axe 는 `disableRules()` 로 규칙을 통째로 끌 수 있지만 그러면 **그 규칙이 잡을 새 결함까지**
   영원히 안 보인다. 여기서는 SCA 게이트(`scripts/audit-gate.mjs`)와 같은 형태를 쓴다 —
   **알려진 위반만 화면·규칙 단위로 원장에 적고, 원장에 없는 것이 하나라도 나오면 실패**.
   원장 항목이 사라지면 그것도 실패한다(역래칫 — 고쳐 놓고 원장을 안 지우면 다음 사람이
   "원래 있던 것"으로 읽는다).
============================================================ */

/** 게이트 대상 심각도. 이 둘만 실패시킨다(위 머리주석). */
const 임계 = ['serious', 'critical'];

/**
 * 알려진 위반 원장 — `"<화면> :: <규칙id>"` → { 사유, 재검토, 노드? }.
 *
 * ⚠ 여기 적는 것은 면제가 아니라 **기한부 기록**이다(SCA 원장과 같은 형태 ·
 * `scripts/audit-gate.mjs` 머리주석). `재검토` 가 지나면 게이트가 깨진다 — 판단에
 * 유효기간이 없으면 그건 판단이 아니라 방치다. 비어 있는 것이 목표 상태다.
 *
 * ⚠ **넣기 전에 물어야 할 것**: 이게 "고칠 수 없는가"인가 "고치면 안 되는가"인가,
 * 아니면 "지금 내가 결정할 일이 아닌가"인가. 마지막 항목(액센트 대비)은 셋째였고
 * **2026-07-31 에 사용자 결정으로 닫혔다** — 아래 `## 원장이 비었다` 참조.
 *
 * ## ⚠ `노드` — 원장이 **규칙 단위에서 노드 단위로** 내려왔다(H5 · 2026-07-30)
 *
 * 라이트 대비 검사를 1화면 → 전 화면으로 넓히면서 필요해졌다. 문제의 위반은 *화면*이 아니라
 * **레일(모든 화면에 있는 컴포넌트)** 의 것이라, 화면 단위로 적으면 `"대비-light 의
 * color-contrast 전부"` 를 덮는다 — 즉 커버리지를 23배로 넓히면서 **그 23화면의 새 대비 결함을
 * 통째로 눈감는** 자기모순이 된다. `노드` 가 있으면 그 패턴에 맞는 노드만 빼고 **나머지는 그대로
 * 실패**한다. 원장이 넓어질수록 좁게 적는 장치가 함께 필요하다. (지금 소비처가 0이지만 타입은
 * 남긴다 — 다음 기한부 기록이 다시 노드 단위로 들어올 것이고, 규칙 단위로 되돌아가면 위 자기모순이
 * 재발한다.)
 *
 * ## 원장이 비었다 — 마지막 항목이 어떻게 닫혔는가(2026-07-31)
 *
 * `대비-light :: color-contrast` 의 액센트 계열이 유일한 잔여였다. 닫은 방법은 원장이 스스로
 * 적어 둔 **②(`--acc-on-soft` 토큰 신설)** 이고, 사용자가 그 안을 골랐다. 요지 둘:
 *
 * - `--acc` 는 **한 글자도 안 바꿨다**(절대규칙 #4). 바뀐 것은 *액센트 틴트 위에 얹히는 글자*뿐.
 * - ⚠ **원장의 수치(lime 4.35)는 결함의 크기가 아니라 이 검사기가 도달한 범위였다.** axe 는
 *   기본 액센트 하나만 렌더하는데, 값으로 재 보니 라이트 **네 액센트 전부** 4.04 이하였다.
 *   그래서 집행자를 여기 두지 않고 `test/accentContrast.test.ts`(계산)에 뒀다 — 렌더로는
 *   4×2 조합을 다 돌 수 없고, 그 한계가 곧 이 원장이 오래 반쪽 사실을 들고 있던 이유다.
 */
const 알려진위반: Record<string, { 사유: string; 재검토: string; 노드?: RegExp }> = {};

const 오늘 = new Date().toISOString().slice(0, 10);

/**
 * axe 전용 안정화 — `settle()`(폰트+2rAF) **위에** 네트워크 유휴를 더한다.
 *
 * ⚠ 왜 필요한가(2026-07-25 실측) — **결론이 처음 가설과 반대였으니 그대로 적어 둔다.**
 *
 * `control`(P10 W4 에서 제거)이 실행마다 통과/실패를 오갔다. 첫 가설은 "부하에서 스타일이 늦게 붙는다"였는데
 * 실측은 정반대였다: 단독(`--workers=1`)으로 6회 돌리면 **6회 다 통과**하고 병렬에서만 실패했다.
 * 통과가 정상이라 읽으면 안 됐다 — 단독 실행에서는 탭이 lazy 라 **검사 대상이 아직 렌더되지도
 * 않은 채** axe 가 "위반 0"을 돌려준 것이다. 병렬에서는 워커가 큐에 밀려 시간이 더 흐르고,
 * 그제야 실제 화면이 떠서 진짜 결함(입력 글자색 미지정 · 대비 1.09:1)이 드러났다.
 *
 * 즉 **빠른 통과가 곧 거짓 통과**였다. 이 저장소가 스냅샷에서 이미 겪은 실패 모드와 같은
 * 형태다(§15-7 "녹색이 '회귀 없음'이 아니라 '안 쟀음'을 뜻하게 된다").
 * `networkidle` 은 그래서 성능이 아니라 **정확성 장치**다 — 검사 전에 화면이 실재함을 보장한다.
 */
async function a11ySettle(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await settle(page);
}

/* 검사 화면 — 시각 회귀와 **같은 로스터**(`TABS`)를 쓰고, 거기 못 들어가는 화면은
   `A11Y_EXTRA` 가 **같은 조건으로** 잇는다(H22 · 근거는 `_fixtures.ts` 의 그 상수 주석).
   목록이 갈리면 "시각은 보는데 a11y 는 안 보는 화면"이 조용히 생긴다 — 실제로 생겨 있었다.
   다크만 도는 이유: 대비 위반은 테마마다 다르지만 구조 위반(라벨·롤·이름)은 같고, 대비는
   아래 별도 테스트가 두 테마를 다 본다. */

type 결과노드 = { target: unknown[]; html: string; failureSummary?: string };
type 위반항목 = { id: string; impact?: string | null; help: string; helpUrl: string; nodes: 결과노드[] };

/** 원장 키가 이번 회차에 **실제로 위반이었는가** — ③ 역래칫의 입력(V078 · 2026-09-01).
 *  ⚠ 관측하지 않은 키는 여기 안 들어온다. 「모른다」를 「해소됐다」로 읽으면 원장이 조용히
 *  비워지고, 그게 이 저장소가 반복해 물린 «0건인데 아무것도 안 쟀다» 다. */
const 원장관측: Record<string, boolean> = {};

/** 원장을 적용해 **남은 노드가 있는 위반만** 돌려준다(위 `노드` 주석). */
function 원장적용(화면: string, 위반들: 위반항목[]): 위반항목[] {
  /* ③ 의 관측 — 이 화면에 걸린 원장 키를 «봤다(위반 아님)» 로 열어 두고, 아래에서 실제
     위반을 만나면 true 로 덮는다. 이 줄이 없으면 역래칫은 분모가 0이라 영원히 침묵한다. */
  for (const 키 of Object.keys(알려진위반)) if (키.startsWith(`${화면} :: `)) 원장관측[키] ??= false;
  const 남은: 위반항목[] = [];
  for (const v of 위반들) {
    const 기록 = 알려진위반[`${화면} :: ${v.id}`];
    if (기록) 원장관측[`${화면} :: ${v.id}`] = true;
    if (!기록) {
      남은.push(v);
      continue;
    }
    if (!기록.노드) continue; // 규칙 단위 기록 — 이 화면의 이 규칙 전부
    const 미기록 = v.nodes.filter((n) => !기록.노드!.test(`${n.target.join(' ')} ${n.html}`));
    if (미기록.length) 남은.push({ ...v, nodes: 미기록 });
  }
  return 남은;
}

/** 실패 메시지가 곧 수정 지시가 되게 — 규칙 id·설명·문제 노드의 셀렉터까지 싣는다.
    "a11y 위반 3건" 만 뜨면 사람이 다시 재현해야 한다. */
function 보고문(위반들: 위반항목[], 노드수 = 5): string {
  return 위반들
    .map(
      (v) =>
        `\n  [${v.impact}] ${v.id} — ${v.help}\n    ${v.helpUrl}\n` +
        v.nodes
          .slice(0, 노드수)
          /* ⚠ `n.html` 을 반드시 싣는다 — 셀렉터만으로는 못 찾는 노드가 있다(실측: `.px-1` 이
             소스 grep 으로 안 잡혔다). 실패 메시지가 재현 없이 수정 지점을 주는 것이 목적이다. */
          .map(
            (n) =>
              `    · ${n.target.join(' ')}\n      ${n.html.slice(0, 200)}\n      ${n.failureSummary?.replace(/\n/g, '\n      ')}`,
          )
          .join('\n'),
    )
    .join('');
}

/** 렌더된 화면 하나를 검사한다 — 로스터 둘이 **같은 판정**을 쓰게 하는 자리. */
async function 검사(page: import('@playwright/test').Page, 화면: string): Promise<void> {
  const 결과 = await new AxeBuilder({ page })
    /* ⚠ 종전 이 자리는 «캔버스 기반 화면(graph·AmbientCanvas)» 을 가리켰다 — **둘 다
       삭제됐다**(I044·I045 · 2026-08-22). 규칙 자체는 남긴다: 캔버스는 픽셀이라 axe 가 볼 것이 없다.
       제외가 아니라 **분석 대상 축소**다 — 주변 컨트롤은 그대로 검사한다. */
    .exclude('canvas')
    .analyze();

  const 위반 = 원장적용(
    화면,
    결과.violations.filter((v) => 임계.includes(v.impact ?? '')),
  );
  expect(위반.length, `${화면} 화면 a11y 위반 ${위반.length}건:${보고문(위반)}\n`).toBe(0);
}

/* 로스터를 **하나로 합친다**(H5 · 2026-07-30). 종전엔 구조 검사가 두 루프로 갈려 있었고,
   대비 검사는 그 어느 쪽도 안 쓰고 `/today` 를 하드코딩했다 — 그래서 라이트 대비 커버리지가
   **23화면 중 1화면**이었다. 바로 위 주석이 _"라이트에서 대비가 깨져도 아무도 모른다"_ 고
   선언한 그 검사가 1/23 만 이행 중이었던 것이다. 로스터가 하나면 갈릴 자리가 없다. */
type 검사화면 = {
  key: string;
  path: string;
  prep?: (page: import('@playwright/test').Page) => Promise<void>;
  ready?: (page: import('@playwright/test').Page) => Promise<unknown>;
};
/* ⚠⚠ **`TABS` 13화면에 `ready` 계약이 없었다**(U051 · 2026-08-31). 바로 아래 `띄우기` 가
   _"빈 화면은 axe 가 통과해도 아무것도 증명하지 못한다"_ 고 적어 두고, 로스터의 **절반 이상**이
   그 계약 밖이었다. 실증: `/ledger` 가 계약 불일치로 탭째 죽은 상태에서 `a11y · ledger` 가
   **통과**했다 — 에러 경계 화면(제목 + 버튼)은 접근성으로 흠잡을 데가 없기 때문이다.
   즉 이 로스터의 단위가 「경로가 뜬다」였지 **「그 화면이다」가 아니었다.**

   ⚠ 가장 싼 형태는 **탭 본문이 실제로 그려졌다**를 재는 것이다(`visual.spec` 이 쓰는 것과 같은
   관용구). 화면마다 문구를 손으로 적으면 그 목록이 곧 다음 표류이므로, 구조 노드를 본다.
   ⛔ **`h1`·`#main`·랜드마크를 `ready` 로 쓰지 마라** — `TopBar`·`RailSidebar` 가 모든 화면에
   그리므로 **어느 화면에서나 잡힌다**(그게 `ledger-mastery` 가 초록으로 남의 화면을 검사한
   기전이다 · U049). 아래 `A11Y_EXTRA` 의 `find-guide`·`review-run-forecast` 도 같은 형태라
   함께 좁혔다. */
const 탭_본문_떴나 = (page: import('@playwright/test').Page) =>
  page.locator('#main h2, #main section[aria-label], #main [role="table"]').first().waitFor();

const 화면들: 검사화면[] = [...TABS.map((t) => ({ key: t, path: '/' + t, ready: 탭_본문_떴나 })), ...A11Y_EXTRA];

/** 화면을 띄우고 axe 가 볼 수 있는 상태까지 데려간다.
    ⚠ `ready` 가 있는 화면은 **실제 콘텐츠가 떴음**을 먼저 단정한다 — 빈 화면은 컨트롤도
    랜드마크도 거의 없어 axe 가 통과해도 아무것도 증명하지 못한다(머리주석의 '빠른 통과가
    곧 거짓 통과'). */
async function 띄우기(page: import('@playwright/test').Page, 화면: 검사화면, theme: string): Promise<void> {
  await boot(page, theme, SEED);
  await 화면.prep?.(page);
  await page.goto(화면.path);
  await 화면.ready?.(page);
  await a11ySettle(page);
}

/* 구조 검사(라벨·롤·이름·대비)는 다크 전 화면. 구조 위반은 테마와 무관하고, 다크 대비는
   여기 포함된다(`color-contrast` 는 serious 라 임계 안이다). */
for (const 화면 of 화면들) {
  test(`a11y · ${화면.key}`, async ({ page }) => {
    await 띄우기(page, 화면, 'dark');
    await 검사(page, 화면.key);
  });
}

/* 대비는 테마 파생물이라 **라이트를 따로, 그리고 전 화면** 본다 — 토큰이 다크에서만 검증되면
   라이트에서 대비가 깨져도 아무도 모른다(색은 파생물이라는 절대규칙 #3 의 검증면).
   ⚠ 화면 키를 `대비-light` 하나로 쓰는 것이 의도다: 알려진 위반은 **레일**(모든 화면에 있는
   컴포넌트)의 것이라 화면마다 원장을 복제할 이유가 없다. 대신 그 기록은 `노드` 로 좁혀져
   있어 같은 화면의 *다른* 대비 결함은 그대로 실패한다. */
for (const 화면 of 화면들) {
  test(`a11y · 대비 · light · ${화면.key}`, async ({ page }) => {
    await 띄우기(page, 화면, 'light');
    const 결과 = await new AxeBuilder({ page }).exclude('canvas').withRules(['color-contrast']).analyze();
    const 위반 = 원장적용('대비-light', 결과.violations);
    expect(위반.length, `${화면.key} · light 대비 위반:${보고문(위반, 8)}\n`).toBe(0);
  });
}

/* ── 오버레이(H6 · 2026-07-30) — **어느 로스터에도 없던 형상** ───────────────────────
   위 두 루프는 *경로로 도달하는* 화면만 본다. `role="dialog"` 를 선언하는 자리는 키·클릭으로만
   열려서 axe 가 한 번도 못 봤다 — 하필 a11y 위험이 가장 높은 형상인데도(트랩·`aria-modal`·
   배경 `inert`·복원이 전부 여기서 요구된다). 여는 절차는 `_fixtures.ts` 의 `A11Y_OVERLAY` 가
   소유한다(그 상수 주석이 근거의 SSOT).
   ⚠ 검사 범위를 오버레이로 좁히지 않고 **문서 전체**를 본다 — 오버레이의 진짜 결함은 대개
   *오버레이 안*이 아니라 **오버레이와 배경의 관계**(배경이 여전히 읽히는가)에 있다. */
for (const 화면 of A11Y_OVERLAY) {
  test(`a11y · ${화면.key}`, async ({ page }) => {
    await boot(page, 'dark', SEED);
    await page.goto(화면.path);
    await a11ySettle(page);
    await 화면.열기(page);
    await 화면.ready(page);
    await settle(page);
    await 검사(page, 화면.key);
  });
}

/* ── 미니 HUD(`/mini`) — 창 모드 전용 라우트라 `TABS` 에 없다 ───────────────────────
   H11 이 여기서 **배경으로 포커스가 새는 것**을 잡았는데, 그때도 axe 는 이 경로를 안 보고
   있었다(사람이 손으로 찾았다). 라우트 하나짜리 화면이라 비용이 거의 0 이다. */
test('a11y · mini', async ({ page }) => {
  await boot(page, 'dark', SEED);
  await page.goto('/mini');
  await a11ySettle(page);
  await 검사(page, 'mini');
});

/* ── 폰 웹앱(H6) — **axe 가 폰을 한 번도 안 봤다** ──────────────────────────────────
   `phone.spec.ts` 는 axe 를 0건 쓰고, 폰은 데스크톱과 **화면이 따로**다(설계서 §13-0). 즉
   데스크톱 23화면이 전부 녹색이어도 폰에 대해서는 아무것도 말하지 않는다. 그리고 폰은
   `global/components.css` 를 안 물어 **포커스 링이 전면 부재**했던 이력이 있다 — 이 파일
   머리주석이 "axe 가 초 단위로 잡는 부류"의 예로 든 바로 그 결함이다.
   ⚠ 다크·라이트 둘 다 돈다. 폰은 대비 위험이 더 크다(작은 글자 + 야외 화면). */
for (const theme of ['dark', 'light'] as const) {
  for (const view of PHONE_VIEWS) {
    test(`a11y · phone · ${view} · ${theme}`, async ({ page }) => {
      await bootPhone(page, theme);
      await page.getByRole('group', { name: '화면 전환' }).getByRole('button', { name: view }).click();
      await a11ySettle(page);
      /* ⚠ 원장 키에 **뷰 이름을 싣는다**(V074 · 2026-09-01). 종전엔 `phone-${theme}` 하나여서
         **한 뷰의 면제가 같은 테마의 폰 뷰 전체를 덮었다** — 다른 화면은 전부 화면 단위 키인데
         여기만 화면**군** 단위였고, 이 파일 머리주석이 «원장은 **노드 단위**다» 로 못박은 규율의
         정반대다. 원장이 비어 있어 오늘의 실효는 0 이지만, 채우는 순간 조용히 넓게 덮는다. */
      await 검사(page, `phone-${view}-${theme}`);
    });
  }
}

/* ── 리플로우 320px(WCAG 1.4.10) — **한 번도 안 돌던 대역**(U023 · 2026-08-21 ux 축) ──────
   1.4.10 은 320 CSS px 폭에서 **두 방향 스크롤을 요구하지 않을 것**을 말한다(= 1280px 화면의
   400% 확대와 같은 대역). 이 저장소의 검증망은 데스크톱 1280×720 과 폰 390 두 점만 봤고
   그 사이도 아래도 본 적이 없었다 — 실측하면 8경로 중 셋이 가로 스크롤을 만들었고, 더 나쁜 것은
   **하단 탭바가 탭 9개를 화면 밖에 두고 스크롤도 안 되던 것**이었다(390px 에서도 7개).

   ⚠ 스냅샷을 안 찍는다. 이 장이 묻는 것은 *"어떻게 보이는가"* 가 아니라 **"넘치는가"** 라
   숫자 하나로 끝나고, 그림으로 굳히면 그 순간의 조판이 정답이 되어 버린다(§1-C).
   ⚠ 화면 하나에 케이스 하나씩이다 — 한 테스트에서 16화면을 돌면 어느 화면이 깼는지를
   실패 메시지에서 잃는다. */
for (const 화면 of 화면들) {
  test(`reflow · 320px · ${화면.key}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await 띄우기(page, 화면, 'dark');
    const 넘침 = await page.evaluate(() => {
      const de = document.documentElement;
      return { doc: de.scrollWidth, view: de.clientWidth };
    });
    expect(
      넘침.doc,
      `${화면.key}: 320px 에서 문서가 ${넘침.doc}px 로 넘친다 — 가로 스크롤 없이 읽혀야 한다(1.4.10)`,
    ).toBeLessThanOrEqual(넘침.view);
  });
}

/* 탭바 도달성 — 넘치는 것 자체는 죄가 아니고 **못 닿는 것**이 죄다(U023). 좁은 창에서 레일은
   하단 탭바가 되고 16칸(704px)은 어차피 안 들어간다 → 그때 스크롤 컨테이너여야 하고,
   현재 탭이 그 안에서 보여야 한다("지금 어디인가"는 나브의 첫 번째 일이다). */
test('reflow · 320px 에서 하단 탭바의 모든 탭에 닿을 수 있다', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await boot(page, 'dark', SEED);
  await page.goto('/settings');
  await expect(page.locator('#main')).toBeVisible();
  await a11ySettle(page);
  const r = await page.evaluate(() => {
    const nav = document.querySelector('nav')!;
    const 활성 = document.querySelector('[aria-current="page"]')!;
    const b = 활성.getBoundingClientRect();
    return {
      스크롤가능: nav.scrollWidth > nav.clientWidth ? getComputedStyle(nav).overflowX : 'fits',
      활성보임: b.left >= -1 && b.right <= document.documentElement.clientWidth + 1,
    };
  });
  expect(['auto', 'scroll', 'fits'], '탭이 넘치는데 스크롤이 안 된다 — 넘친 탭에 닿을 방법이 없다').toContain(
    r.스크롤가능,
  );
  expect(r.활성보임, '현재 탭(설정)이 탭바 밖에 있다 — 「지금 어디인가」가 안 보인다').toBe(true);
});

/* ── ⭐ **SC 2.4.11 Focus Not Obscured (Minimum)** — AA (U079 · 2026-08-31) ────────────────

   좁은 창에서는 하단 탭바가 `position:fixed` 로 떠 있고 본문은 `max-mobile:pb-16`(64px)으로
   자리를 비운다. 그런데 **키보드 포커스가 그 아래로 들어가는 것은 여백이 막지 못한다** —
   여백은 «문서 끝» 을 밀 뿐이고, 포커스 이동은 브라우저가 요소를 **뷰포트 안**으로만 스크롤하지
   «고정 요소에 안 가리게» 스크롤하지 않기 때문이다. 그 순간 사용자는 자기가 어디에 있는지
   모르는 채 타이핑하게 된다.

   ⚠ 저장소 전체에 **`scroll-padding` 이 0건**이다(실측) — 그게 이 SC 의 표준 처방이다.
   ⚠ 이 검사는 스냅샷이 원리적으로 못 본다: 정지 프레임엔 포커스가 없고, 있어도 «가려졌는가»는
     좌표 비교이지 픽셀 비교가 아니다. axe 에도 이 규칙이 없다(4.x 실측 · `focus-ring` 케이스가
     같은 이유로 시각 축에 산다).
   ⚠ **판정은 `elementFromPoint` 로 자기확인한다** — 요소 사각형이 탭바와 겹치는지만 보면
     `pointer-events:none` 인 장식까지 «가림» 으로 세고, 그러면 검사가 규약보다 넓어진다. */
test('SC 2.4.11 — 320px 에서 포커스가 고정 탭바에 가려지지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await boot(page, 'dark', SEED);
  await page.goto('/settings');
  await expect(page.locator('#main')).toBeVisible();
  await a11ySettle(page);
  const 가려진: string[] = [];
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    const r = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) return null;
      /* 요소의 **중심점**에서 실제로 무엇이 잡히는가. 자기 자신(또는 자손)이면 안 가려진 것이다. */
      const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      if (!top || el === top || el.contains(top) || top.contains(el)) return null;
      return `${el.tagName}${el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : ''} ← ${top.tagName}`;
    });
    if (r) 가려진.push(r);
  }
  expect(
    [...new Set(가려진)].sort(),
    '포커스 받은 요소가 다른 것에 가려진다 — `scroll-padding-bottom` 으로 고정 탭바만큼 비켜야 한다(SC 2.4.11)',
  ).toEqual([]);
});

/* ── ⭐ **입력은 「치는 동안」 읽혀야 한다** (2026-08-31 · 사용자 신고) ────────────────────

   `global/components.css` 의 텍스트 스킨은 **타입 열거**로 걸리는데(그 파일 머리주석 · 불변식 ⑬),
   포커스 규칙은 타입을 안 가리고 `background` 를 칠하고 있었다. 그래서 스킨을 못 받은
   **타입 없는 `<input>`** 은 포커스되는 순간 배경만 `--panel`(#0e0f13)이 되고 `color` 는 UA
   기본(검정)으로 남아 **글자를 치는 동안에만 검정 위 검정**이 됐다 — 실측 **1.10:1**.
   계획 › 일 뷰의 「할 일」·「일정」 칸 둘이 그 상태였고 사용자가 신고했다.

   ## 왜 기존 세 겹이 전부 초록이었나 — 이 케이스가 메우는 사각

   · **시각 스냅샷**: 정지 프레임엔 **포커스가 없다**(오버레이 §1-C). 누르기 전엔 UA 기본 상자라
     멀쩡해 보였고, 실제로 이 수정 뒤에도 `visual -g schedule` 7/7 이 **그대로 통과**했다
     (변화가 0.5% 임계 아래다 — 「통과」가 「안 바뀌었다」가 아닌 그 부류).
   · **axe**: 무스킨 입력은 흰 배경 + 검은 글자라 대비를 **더 잘** 통과한다(불변식 ⑬ 머리주석이
     이미 적어 둔 함정). 그리고 axe 는 `:focus` 상태를 만들지 않는다.
   · **불변식 ⑬**: 단위가 «`<input type>` 이 스킨에 등재됐나»라 **타입 없는 입력은 그물 밖**이다.

   → 그래서 판정을 **실렌더 + 포커스 + 계산된 색**으로 내린다. 로스터는 위 `화면들` 을 그대로
     쓴다(두 벌로 베끼면 그 목록이 곧 표류한다).
   ⚠⚠ **계산된 색 문자열을 정규식으로 파싱하지 마라.** 첫 구현이 그랬다가 거짓 양성 **23건**이
     나왔다 — 이 저장소는 `oklab(0 0 0 / 0)`(투명)과 `color(srgb 0.30 0.49 0.06 / 0.14)`(반투명
     틴트)를 실제로 쓰는데, `\d+` 로 뽑으면 전자는 «검정», 후자는 «0.3/0.49/0.06 = 거의 검정»이
     된다. 그래서 **캔버스에 실제로 칠해 rgba 를 되읽고**, 조상 배경을 **알파 합성**한다.
     (배경이 투명인 입력이 이 앱엔 흔하다 — 배분 보드의 시간 칸 21개가 전부 그렇다.)
   ⚠ 이 케이스는 **되심어 빨간지를 확인했다**: `text-txt`/`bg-panel2` 를 떼면 1.10:1 로 즉시 빨개진다.
     (판례 2026-08-31 — 집행자를 세우면 그 자리에서 빨간지를 대조하라.) */
const 휘도 = (rgb: number[]): number => {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const 색대비 = (a: number[], b: number[]): number => {
  const [hi, lo] = [휘도(a), 휘도(b)].sort((p, q) => q - p) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

/* ⚠⚠ **이 두 케이스만 재시도를 끈다.** `playwright.config.ts` 는 `retries: 1` 이고 그 파일
   스스로 _"`retries: 1` 이 그 비결정성을 **flaky-녹색으로 가린다**"_ 고 적어 뒀다. 시각 회귀엔
   그 완충이 값하지만 **이건 정확성 검사**다 — 되심기 검증에서 실측: 결함을 심으면 1회차는
   빨갛고 재시도는 초록이라 런 전체가 `flaky`(exit 0)로 끝났다. 즉 재시도를 켠 채로는 이
   집행자가 **결함을 게이트에 통과시킨다**. 못 재면 못 잰 대로 시끄럽게 실패해야 한다. */
test.describe('입력 포커스 대비', () => {
  test.describe.configure({ retries: 0 }); // ⚠ 이 블록만 — 파일 최상위에 두면 a11y 전량의 완충이 사라진다

  for (const theme of THEMES) {
    test(`입력이 포커스된 상태에서도 글자가 읽힌다 · ${theme}`, async ({ page }) => {
      const 낮은대비: string[] = [];
      /* ⚠ 포커스를 못 준 칸 — «못 쟀다» 를 «괜찮다» 로 접지 않는다(freshness.mjs 의 규율). */
      const 못잰것: string[] = [];
      const 화면별: Record<string, number> = {};
      for (const 화면 of 화면들) {
        await 띄우기(page, 화면, theme);
        /* ⚠⚠ **화면 하나를 한 번의 `evaluate` 로 통째로 잰다.** 처음엔 요소마다
         `isVisible()`→`focus()`→`evaluate()` 로 왕복했는데, 그 사이에 목록·포커스가 흔들려
         되심기 검증이 **flaky** 로 떴다(1회차 빨강 · 재시도 초록 = 게이트가 못 믿을 상태).
         한 태스크 안에서 포커스와 측정을 끝내면 그 경합이 원리적으로 사라진다. */
        화면별[화면.key] = await page.evaluate(() => {
          /** CSS 색 문자열 → [r,g,b,a] (0~255, a 는 0~1). 캔버스가 파서다 — 어떤 표기든 받는다. */
          const cv = document.createElement('canvas');
          cv.width = cv.height = 1;
          const g2 = cv.getContext('2d', { willReadFrequently: true })!;
          const rgba = (v: string): [number, number, number, number] => {
            g2.clearRect(0, 0, 1, 1);
            g2.fillStyle = '#000';
            g2.fillStyle = v; // 무효면 직전 값(#000, 불투명)이 남는다
            g2.fillRect(0, 0, 1, 1);
            const d = g2.getImageData(0, 0, 1, 1).data;
            return [d[0]!, d[1]!, d[2]!, d[3]! / 255];
          };
          /** top 을 bottom 위에 얹는다(source-over). */
          const over = (
            t: [number, number, number, number],
            b: [number, number, number, number],
          ): [number, number, number, number] => {
            const a = t[3] + b[3] * (1 - t[3]);
            if (a === 0) return [0, 0, 0, 0];
            const c = (i: 0 | 1 | 2): number => (t[i] * t[3] + b[i] * b[3] * (1 - t[3])) / a;
            return [c(0), c(1), c(2), a];
          };
          const 바탕0 = rgba(getComputedStyle(document.body).backgroundColor);
          /* 텍스트를 치는 칸만 본다 — 체크박스·라디오·파일·색은 글자가 없다. */
          const sel =
            '#main input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=color]):not([type=range]):not([type=hidden]), #main textarea';
          const out: { id: string; fg: number[]; bg: number[]; 포커스됨: boolean }[] = [];
          for (const node of document.querySelectorAll(sel)) {
            const el2 = node as HTMLElement;
            /* ⚠ `offsetWidth` 만으로는 부족했다 — **닫힌 `<details>` 안의 입력**(트레이의 「언젠가」
             인박스는 비면 접힌다)이 그 검사를 통과하고 `focus()` 는 안 걸려, 시드 상태에 따라
             회차마다 결과가 갈렸다(되심기 검증에서 flaky 로 드러난 진짜 원인). `checkVisibility`
             는 `content-visibility`·닫힌 details·`visibility` 를 함께 본다. */
            if (
              !el2.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) ||
              (el2 as HTMLInputElement).disabled
            )
              continue;
            el2.focus(); // 같은 태스크 — 아래 getComputedStyle 이 곧바로 `:focus` 를 본다
            /* ⚠ 포커스가 실제로 걸렸는지 자기확인한다 — 안 걸렸으면 «포커스 안 된 상태»를 재고
             조용히 통과한다(그게 이 검사가 잡으려는 것과 정확히 반대다). */
            const 포커스됨 = document.activeElement === el2 && el2.matches(':focus');
            let acc: [number, number, number, number] = [0, 0, 0, 0];
            let p: HTMLElement | null = el2;
            while (p && acc[3] < 0.999) {
              acc = over(acc, rgba(getComputedStyle(p).backgroundColor));
              p = p.parentElement;
            }
            const bg = over(acc, [바탕0[0], 바탕0[1], 바탕0[2], 1]);
            /* 글자색도 반투명일 수 있다 — 해결된 배경 위에 얹어 실제로 보이는 색을 만든다. */
            const fg = over(rgba(getComputedStyle(el2).color), bg);
            out.push({
              id: el2.getAttribute('aria-label') ?? el2.getAttribute('placeholder') ?? el2.tagName,
              fg: [fg[0], fg[1], fg[2]],
              bg: [bg[0], bg[1], bg[2]],
              포커스됨,
            });
          }
          (window as unknown as { __잰것: typeof out }).__잰것 = out;
          return out.length;
        });
        const 잰것 = await page.evaluate(
          () =>
            (window as unknown as { __잰것: { id: string; fg: number[]; bg: number[]; 포커스됨: boolean }[] }).__잰것,
        );
        const 짧게 = (c: number[]): string => `rgb(${c.map((v) => Math.round(v)).join(',')})`;
        for (const m of 잰것) {
          if (!m.포커스됨) {
            못잰것.push(`${화면.key} › "${m.id}"`);
            continue;
          }
          const r = 색대비(m.fg, m.bg);
          if (r < 4.5) 낮은대비.push(`${화면.key} › "${m.id}" ${r.toFixed(2)}:1 (${짧게(m.fg)} on ${짧게(m.bg)})`);
        }
      }
      /* ⚠⚠ 분모를 **화면별로** 단언한다 — 총합만 보면 한 화면이 통째로 안 떠도 다른 화면의
       개수가 그것을 메워 «위반 0» 이 «그 화면을 못 봤다» 가 된다. 되심기 검증에서 실제로
       그 형태로 초록이 나왔다(계획 › 일 뷰가 로스터에 없었을 때). 오버레이 §1-B 의 「분모를 물어라」. */
      expect(못잰것.sort(), '포커스를 못 준 칸이 있다 — 이 상태로 통과하면 검사가 아무것도 증명하지 못한다').toEqual(
        [],
      );
      expect(
        화면별['schedule-day'],
        '계획 › 일 뷰의 인라인 입력을 못 쟀다 — 이 화면이 이 검사의 계기다',
      ).toBeGreaterThan(0);
      expect(
        Object.values(화면별).reduce((a, b) => a + b, 0),
        '입력을 하나도 못 찾았다 — 셀렉터가 죽었거나 시드가 화면을 안 채웠다',
      ).toBeGreaterThan(5);
      expect(
        [...new Set(낮은대비)].sort(),
        '포커스된 입력의 글자가 배경과 구분되지 않는다 — 치는 동안 안 보인다',
      ).toEqual([]);
    });
  }
});

/* ── ⭐ 대비 **미측정** 래칫(U003 · 2026-08-21 ux 축) ─────────────────────────────────
   ## 「위반 0」은 「전부 쟀다」가 아니다

   위 검사들은 `결과.violations` 만 세고 **`결과.incomplete` 를 버린다.** axe 에서 incomplete 는
   *"규칙을 적용해 봤는데 판정할 수 없었다"* 이고, 대비의 경우 사유가 셋이다 — 배경이 **의사요소**
   이거나, **배경 이미지**이거나, 다른 요소에 **가려져** 있다. 셋 다 이 저장소의 주력 관용구다
   (`::before` 로 면·띠를 그리는 자리가 100곳 넘는다).

   실측(2026-08-21 · 다크 13탭): incomplete **620노드**, 그중 `color-contrast` 가 619. 즉 게이트가
   「대비 위반 0」이라 말하는 동안 **수백 노드는 재지도 못했다**. 이것이 리포트 §R1 이 말한 형태다:
   0을 보고하는 지표는 **분모를 함께 말해야** 한다.

   ## 왜 「실패」가 아니라 「래칫」인가

   incomplete 를 전부 없애려면 의사요소 관용구를 통째로 갈아야 하고, 그건 이 축의 결정이 아니다
   (그리고 그 관용구는 §7 에서 «유지» 판정을 받았다). 여기서 막는 것은 **늘어나는 것**이다 —
   새 화면이 같은 사각을 더 만들면 시끄럽게 깨진다. 값을 줄이면 이 상수도 함께 줄인다(역래칫).
   ⚠ 이 수를 손으로 어림하지 마라. 실패 메시지가 **실측치를 그대로 준다**. */
/* ⚠⚠ **624 → 901 은 회귀가 아니라 「분모가 자란 것」이다**(U052 · 2026-08-31). 종전 이 루프는
   `TABS`(13화면)만 돌았고 — 「위반 0」의 분모를 세라고 세운 장치가 **자기 분모를 로스터의 절반으로
   축소**하고 있었다 — 이제 `화면들` 전량을 돈다. 빠져 있던 것이 하필 의사요소 밀도가 가장 높은
   화면들이었다(`alloc` 의 `::before` 채움 셀 · `review-run` · `subject` · 오버레이 · `/mini` · 폰).
   ⛔ **다음 회차가 이 증가를 「나빠졌다」로 읽지 마라** — 같은 코드에 대해 **처음으로 다 센 것**이다.
   내역도 그때 갈렸다: 종전엔 `color-contrast` 뿐이었는데 이제 `form-field-multiple-labels` 가 1건
   보인다(넓힌 화면에서 온 것 · 위반이 아니라 미측정이다).
   ⚠ 이 수를 손으로 어림하지 마라. 실패 메시지가 **실측치를 그대로 준다**. */
/* ⚠⚠ **901 → 961 도 회귀가 아니라 또 「분모가 자란 것」이다**(2026-08-31 · 같은 날 오후).
   `A11Y_EXTRA` 에 **`schedule-day`(계획 › 일 뷰)** 가 들어왔다 — 그 화면은 `TABS` 의
   `'schedule'`(주 뷰)에 가려 **어느 a11y 케이스도 한 번도 연 적이 없었다**(그 상수의 주석 참조).
   ⭐ **귀속을 가정하지 않고 쟀다**: 그 한 화면만 로스터에서 빼고 돌리면 **901 이하로 통과**하고,
   되돌리면 961 이다. 즉 +60 은 전부 새로 보이기 시작한 화면 몫이고 기존 화면은 한 건도 안 늘었다.
   ⛔ 다음 회차가 이 증가를 「나빠졌다」로 읽지 마라 — 같은 코드에 대해 **처음으로 그 화면을 센 것**이다. */
/* ⚠ **961 → 964 는 UI 가 는 것이다**(2026-08-31 · 학기 단위 상태 개편). 졸업 화면의 학기 카드가
   시드에서 **하나 → 둘**이 됐고(상태가 학기의 것이 되며 한 학기 안 혼재가 불가능해졌다) 카드마다
   **상태 셀렉트 + 설명 한 줄**이 붙었다. 귀속: 이 두 회차 사이에 **로스터는 그대로**이고 바뀐
   코드가 졸업 모델·시드뿐이라 +3 은 그 화면 몫이다. ⚠ 다음에 이 수를 올릴 땐 **무엇이 늘었는지
   한 줄로 대라** — 근거 없이 올리는 래칫은 래칫이 아니다. */
const 미측정_래칫 = 964;
/* ⚠⚠ **역래칫의 여유**(V073 · 2026-09-01). 종전엔 «늘면 실패» **한 방향뿐**이었다 — 줄어도
   아무도 안 알렸다. 그런데 이 장치의 존재 이유가 정확히 «「위반 0」의 분모가 조용히 줄어드는
   것을 막는 것» 이라, 실측이 700 으로 떨어져도 래칫이 964 로 남으면 **새 미측정 264개가 침묵으로
   흡수된다.** 한 방향만 잠근 래칫은 절반이 열려 있다.
   ⛔ 그렇다고 `합 === 래칫` 으로 못박지 않는다 — 이 수는 화면 로스터가 자랄 때마다 움직이고
   렌더 타이밍에 따라 몇 노드가 흔들린다. **여유 밖으로 벗어나면** 실패시킨다.
   ⚠ 「통과 옆에 경고를 띄운다」(`compiler-ratchet.mjs` 의 형태)를 안 쓴 이유: 이 저장소가
   `knip.jsonc` 에 그 함정을 두 번 적어 뒀다 — **힌트는 통과 옆에 떠서 게이트가 안 잡는다**
   (`V083` 이 그렇게 사문화된 예외였다). 조이는 것이 한 줄이므로 실패가 옳다. */
const 미측정_여유 = 40;

/* ⚠⚠ **화면당 예산 — 이 케이스가 CI 를 이틀간 빨간불로 만들었다**(U041 · 2026-08-22 운영 축).

   이 파일의 다른 검사는 전부 **화면당 `test()` 하나**인데 이 래칫만 «전 화면의 합»이라
   한 케이스 안에서 로스터를 통째로 돈다(합이 곧 이 지표의 정의다 — 쪼개면 래칫이 아니다).
   그래서 이 케이스만 Playwright 기본 **30초**에 걸렸고, 러너에서 `page.evaluate` 타임아웃으로
   죽었다. 로컬은 통과하고 CI 는 죽는 부류다.

   ⚠ **고정 숫자를 쓰지 않는다.** 30초가 틀린 값이 된 이유가 「로스터가 자랐다」이므로, 상수를
   더 큰 상수로 바꾸면 같은 실패를 뒤로 미룰 뿐이다(이 저장소가 손베낌으로 반복해 물린 형태).
   **로스터 길이에서 유도한다** — 화면이 늘면 예산도 함께 는다.
   ⚠ 값 근거: 화면당 boot + goto + settle + axe 분석. 러너(2코어)에서 화면당 최대 ~4초를
   봤으므로 8초는 두 배 여유다. `+20초` 는 브라우저 기동 등 화면 수와 무관한 고정비. */
const 화면당_예산_MS = 8_000;

/* ⚠⚠ **이 래칫만 `TABS`(13)를 돌았다 — 로스터는 그보다 훨씬 크다**(U052 · 2026-08-31).
   구조·라이트 대비·리플로우 세 루프는 `화면들` 을 도는데 「위반 0」의 **분모를 세라고 세운
   장치**가 자기 분모를 로스터의 절반으로 축소하고 있었다. 빠진 것이 하필 의사요소 밀도가
   가장 높은 화면들이다: `alloc`(`::before` 채움 셀) · `review-run` · `subject` · 오버레이 ·
   `/mini` · 폰. 이제 `화면들` 을 돌고 `띄우기()` 를 재사용한다(prep·ready 가 따라온다). */
test('대비 미측정(incomplete) 노드가 늘지 않았다', async ({ page }) => {
  test.setTimeout(화면들.length * 화면당_예산_MS + 20_000);
  const 사유: Record<string, number> = {};
  let 합 = 0;
  for (const 화면 of 화면들) {
    await 띄우기(page, 화면, 'dark');
    const 결과 = await new AxeBuilder({ page }).exclude('canvas').analyze();
    for (const i of 결과.incomplete) {
      사유[i.id] = (사유[i.id] ?? 0) + i.nodes.length;
      합 += i.nodes.length;
    }
  }
  const 내역 = Object.entries(사유)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(' · ');
  expect(
    합,
    `axe 가 **판정하지 못한** 노드가 ${합}건이다(래칫 ${미측정_래칫}) — ${내역}\n` +
      `  늘었으면: 새로 생긴 의사요소·배경이미지 위 글자가 대비 검사 밖으로 나갔다는 뜻이다.\n` +
      `  줄었으면: 좋은 일이다. 이 파일의 \`미측정_래칫\` 을 ${합} 으로 낮추세요(그래야 되돌아오면 잡힌다).\n`,
  ).toBeLessThanOrEqual(미측정_래칫);
  /* ③ 역래칫 — 줄었으면 래칫을 조여라. 안 조이면 그 차이가 새 미측정의 침묵 여유가 된다. */
  expect(
    합,
    `axe 미측정이 ${합} 으로 줄었다(래칫 ${미측정_래칫} · 여유 ${미측정_여유}). **좋은 일이지만 ` +
      `그대로 두면 그 차이만큼이 새 미측정의 침묵 여유가 된다** — 이 파일의 \`미측정_래칫\` 을 ` +
      `${합} 으로 낮추고, 무엇이 줄었는지 한 줄로 적으세요.
`,
  ).toBeGreaterThan(미측정_래칫 - 미측정_여유);
});

/* 레일 세로 도달성(U036) — 허용 최소 창 높이는 **600**(`src-tauri/tauri.conf.json`)인데 레일
   내용은 814px 다. 스크롤 컨테이너인 것만으로는 부족하다: 목록 끝의 `설정`·`연동 현황` 은
   그 상태에서 **처음부터 화면 밖**이라, 현재 탭이 자기 자리로 스크롤돼야 «지금 어디인가»가 산다.
   ⚠ 배포 기본 창(1440×900)에서는 결함이 아니었다 — 이 케이스가 좁게 겨누는 것은 그 아래 대역이다. */
test('reflow · 최소 창 높이(600)에서 현재 탭이 레일 안에 보인다', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await boot(page, 'dark', SEED);
  await page.goto('/settings');
  await expect(page.locator('#main')).toBeVisible();
  await a11ySettle(page);
  const 보임 = await page.evaluate(() => {
    const nav = document.querySelector('nav')!.getBoundingClientRect();
    const a = document.querySelector('[aria-current="page"]')!.getBoundingClientRect();
    return a.top >= nav.top - 1 && a.bottom <= nav.bottom + 1;
  });
  expect(보임, '레일이 넘치는데 현재 탭이 그 밖에 있다').toBe(true);
});

/* 원장의 세 규칙 — **판정은 `scripts/ledger-rules.mjs` 한 벌이 진다**(V078·V096 · 2026-09-01).
   ⚠⚠ 종전엔 여기 ②(만료)**만** 있었다. `freshness.mjs` 머리주석이 _"세 가지가 전부 실패
   조건이다(**그 파일들과 같다**)"_ 라 단언하는데 이 파일에 대해 **거짓**이었다 — ③(역래칫)이
   없었다. 실해가 구체적이다: `원장적용` 은 원장 항목이 있으면 그 화면·그 규칙의 위반을 **전부
   삼키므로**, 고친 뒤에도 항목이 남으면 **새 위반이 그 아래로 조용히 들어간다.**
   ⛔ 그래서 처방이 「여기 ③을 한 벌 더 짠다」가 아니었다 — 네 번째 사본을 만들면 다음 회차에
   또 하나가 모자란다. 판정을 **공유 모듈**로 올렸다(V096: 새 형식 금지).
   ⚠ 이 케이스는 **다른 케이스들이 돈 뒤에** 판정한다(`원장관측` 이 그때 채워진다) — 파일 끝에
   두는 것이 그 순서를 만든다. Playwright 는 선언 순서로 돌린다. */
/* ⚠⚠ **재시도를 끈다 — 안 끄면 ③이 재시도에서 조용히 초록이 된다**(2026-09-01 되심기에서 잡혔다).
   `원장관측` 은 **다른 케이스들이 돌면서** 채우는 모듈 상태인데, Playwright 는 실패한 케이스만
   새 워커에서 다시 돌린다. 그러면 관측이 비어 판정이 **보류**로 떨어지고(= 「모른다」),
   원장이 실물과 갈렸는데도 통과한다. 실측: 첫 실행 ❌ → retry #1 ✅.
   ⭐ 「모른다 ≠ 괜찮다」 규율을 지키려고 넣은 보류 분기가, 재시도와 만나 정확히 그 반대를
   만들어 낸 자리다 — 규율 자체는 옳고 **격리가 빠져 있었다**. */
test.describe('원장 대조', () => {
  /* ⚠ **이 블록만** 재시도를 끈다 — 파일 최상위에 두면 a11y 전량의 완충이 사라진다
     (`:429` 가 같은 함정을 이미 적어 뒀고, 2026-09-01 에 그대로 밟았다). */
  test.describe.configure({ retries: 0 });

  test('a11y 원장이 실물과 갈리지 않았다 (② 만료 · ③ 역래칫)', () => {
    const 판정 = 원장판정({ 원장: 알려진위반, 상태: 원장관측, 오늘 });
    expect(판정.ok, 원장메시지('a11y', 판정, 알려진위반)).toBe(true);
  });
});
