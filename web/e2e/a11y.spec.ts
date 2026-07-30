import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { A11Y_EXTRA, A11Y_OVERLAY, PHONE_VIEWS, SEED, TABS, boot, bootPhone, settle } from './_fixtures';

/* ============================================================
   a11y.spec.ts — 접근성 자동검증(axe-core) · 트랙 A.

   ## 왜 생겼나 (2026-07-25 감사)

   종전 a11y 방어는 **`eslint-plugin-jsx-a11y` 하나**였다. 그건 속성 오타·role 대비 필수
   속성 누락 같은 *소스에서 보이는* 것만 본다. 정작 최근에 발견된 결함들은 그 층을 통과했다:

   · **폰 `:focus-visible` 링 전면 부재** — 폰이 `global/components.css` 를 import 하지
     않아 모든 버튼·탭·입력에서 포커스 표시가 없었다. 소스에는 아무 오류가 없다.
   · **`role="tablist"` 반쪽 구현** — tabpanel 연결도 화살표 이동도 없이 롤만 선언.

   둘 다 **사람이 손으로** 찾았고, 둘 다 axe 가 렌더된 DOM 에서 초 단위로 잡는 부류다.
   린트는 소스를 보고 axe 는 **결과물**을 본다 — 대체재가 아니라 다른 층이다.

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
 * `control` 이 실행마다 통과/실패를 오갔다. 첫 가설은 "부하에서 스타일이 늦게 붙는다"였는데
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

/** 원장을 적용해 **남은 노드가 있는 위반만** 돌려준다(위 `노드` 주석). */
function 원장적용(화면: string, 위반들: 위반항목[]): 위반항목[] {
  const 남은: 위반항목[] = [];
  for (const v of 위반들) {
    const 기록 = 알려진위반[`${화면} :: ${v.id}`];
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
    /* 캔버스 기반 화면(graph·AmbientCanvas)은 픽셀이라 axe 가 볼 것이 없다.
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
const 화면들: 검사화면[] = [...TABS.map((t) => ({ key: t, path: '/' + t })), ...A11Y_EXTRA];

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
      await 검사(page, `phone-${theme}`);
    });
  }
}

/* 원장 만료 — 판단에 유효기간을 강제한다(SCA 게이트와 같은 장치).
   ⚠ 이게 없으면 위의 두 항목은 "영원히 알려진 위반"이 되고, 그건 규칙을 끈 것과 같다. */
test('a11y 원장에 기한이 지난 항목이 없다', async () => {
  const 만료 = Object.entries(알려진위반)
    .filter(([, v]) => v.재검토 < 오늘)
    .map(([k, v]) => `\n  · ${k} — 기한 ${v.재검토} (오늘 ${오늘})\n    ${v.사유}`);
  expect(
    만료.length,
    `재검토 기한이 지난 a11y 원장 항목 ${만료.length}건 — 고치거나, 다시 판단하고 날짜를 갱신하세요:${만료.join('')}\n`,
  ).toBe(0);
});
