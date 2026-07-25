import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { SEED, TABS, boot, settle } from './_fixtures';

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
 * 알려진 위반 원장 — `"<화면> :: <규칙id>"` → { 사유, 재검토 }.
 *
 * ⚠ 여기 적는 것은 면제가 아니라 **기한부 기록**이다(SCA 원장과 같은 형태 ·
 * `scripts/audit-gate.mjs` 머리주석). `재검토` 가 지나면 게이트가 깨진다 — 판단에
 * 유효기간이 없으면 그건 판단이 아니라 방치다. 비어 있는 것이 목표 상태다.
 *
 * ⚠ **넣기 전에 물어야 할 것**: 이게 "고칠 수 없는가"인가 "고치면 안 되는가"인가,
 * 아니면 "지금 내가 결정할 일이 아닌가"인가. 아래 둘은 셋째다 — 라이트 테마 전 화면의
 * 픽셀을 바꾸는 **디자인 결정**이라 사용자 몫이다(절대규칙 #4).
 */
const 알려진위반: Record<string, { 사유: string; 재검토: string }> = {
  'schedule :: color-contrast': {
    사유:
      '원인은 토큰이 아니라 `opacity-50` 이다 — WeekCalendar 가 **완료·지난 일정 조각**을 ' +
      '50% 로 흐린다(WeekCalendar.tsx:373·399·422). axe 는 그 합성 결과를 재므로 10px 굵은 ' +
      '조각 이름이 3.77:1 로 떨어진다(기준 4.5). "지난 것은 흐리게"는 이 앱이 의도한 시각 ' +
      '신호이고, 그걸 걷어내는 것은 접근성 수정이 아니라 **캘린더 디자인 변경**이다. ' +
      '대안은 opacity 대신 채도만 낮추거나(색은 유지·명도 보존) 완료 표시를 아이콘으로 ' +
      '옮기는 것 — 둘 다 사용자 결정 사안이라 여기서 단독 착수하지 않는다.',
    재검토: '2026-10-01',
  },
  '대비-light :: color-contrast': {
    사유:
      '레일의 **활성 내비 항목**(`ITEM_ON = bg-acc-soft! text-acc!` · RailSidebar.tsx:74)이 ' +
      '라이트+lime 에서 4.35:1(기준 4.5). ⚠ 예외 경로가 아니다 — `uiState.ts:40` 이 기본 ' +
      'accent 를 **lime** 으로 두므로(주석은 "기본 violet"이라 적혀 코드와 어긋난다) ' +
      '라이트 사용자 전원이 이 색을 본다. 수치는 `#4d7c0f` on `#ecf1e9`. ' +
      '고치는 방법은 둘이고 **둘 다 라이트 전 화면의 픽셀을 바꾼다**(레일은 모든 화면에 있다): ' +
      '① lime+light `--acc` 를 `#456b0d`(5.45:1) 로 어둡게 — 라이트 액센트 전체가 바뀐다. ' +
      '② `--acc-on-soft` 토큰 신설 후 ITEM_ON/SURFACE_ON_COL 만 교체 — 파급은 레일로 한정되나 ' +
      '   여전히 전 화면 스냅샷이 흔들린다. ' +
      '②가 더 나은 공학이지만(관계에 이름을 준다 · 절대규칙 #3 과 정합) 색은 사용자가 못박은 ' +
      '디자인이라 단독 변경하지 않는다. 결정만 나면 적용은 30분이다.',
    재검토: '2026-10-01',
  },
};

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

/* 검사 화면 — 시각 회귀와 **같은 로스터**(`TABS`)를 쓴다. 목록이 갈리면 "시각은 보는데
   a11y 는 안 보는 화면"이 조용히 생긴다. 다크만 도는 이유: 대비 위반은 테마마다 다르지만
   구조 위반(라벨·롤·이름)은 같고, 대비는 아래 별도 테스트가 두 테마를 다 본다. */
for (const tab of TABS) {
  test(`a11y · ${tab}`, async ({ page }) => {
    await boot(page, 'dark', SEED);
    await page.goto('/' + tab);
    await a11ySettle(page);

    const 결과 = await new AxeBuilder({ page })
      /* 캔버스 기반 화면(graph·AmbientCanvas)은 픽셀이라 axe 가 볼 것이 없다.
         제외가 아니라 **분석 대상 축소**다 — 주변 컨트롤은 그대로 검사한다. */
      .exclude('canvas')
      .analyze();

    const 위반 = 결과.violations
      .filter((v) => 임계.includes(v.impact ?? ''))
      .filter((v) => !(`${tab} :: ${v.id}` in 알려진위반));

    /* 실패 메시지가 곧 수정 지시가 되게 — 규칙 id·설명·문제 노드의 셀렉터까지 싣는다.
       "a11y 위반 3건" 만 뜨면 사람이 다시 재현해야 한다. */
    const 보고 = 위반.map(
      (v) =>
        `\n  [${v.impact}] ${v.id} — ${v.help}\n    ${v.helpUrl}\n` +
        v.nodes
          .slice(0, 5)
          /* ⚠ `n.html` 을 반드시 싣는다 — 셀렉터만으로는 못 찾는 노드가 있다(실측: `.px-1` 이
             소스 grep 으로 안 잡혔다). 실패 메시지가 재현 없이 수정 지점을 주는 것이 목적이다. */
          .map(
            (n) =>
              `    · ${n.target.join(' ')}\n      ${n.html.slice(0, 200)}\n      ${n.failureSummary?.replace(/\n/g, '\n      ')}`,
          )
          .join('\n'),
    );

    expect(위반.length, `${tab} 화면 a11y 위반 ${위반.length}건:${보고.join('')}\n`).toBe(0);
  });
}

/* 대비(contrast)는 테마 파생물이라 **라이트도 본다** — 토큰이 다크에서만 검증되면
   라이트에서 대비가 깨져도 아무도 모른다(색은 파생물이라는 절대규칙 #3 의 검증면). */
for (const theme of ['dark', 'light'] as const) {
  test(`a11y · 대비 · ${theme}`, async ({ page }) => {
    await boot(page, theme, SEED);
    await page.goto('/today');
    await a11ySettle(page);

    const 결과 = await new AxeBuilder({ page }).exclude('canvas').withRules(['color-contrast']).analyze();
    const 위반 = 결과.violations.filter((v) => !(`대비-${theme} :: ${v.id}` in 알려진위반));

    const 보고 = 위반.map(
      (v) =>
        `\n  [${v.impact}] ${v.id} — ${v.help}\n` +
        v.nodes
          .slice(0, 8)
          /* ⚠ `n.html` 을 반드시 싣는다 — 셀렉터만으로는 못 찾는 노드가 있다(실측: `.px-1` 이
             소스 grep 으로 안 잡혔다). 실패 메시지가 재현 없이 수정 지점을 주는 것이 목적이다. */
          .map(
            (n) =>
              `    · ${n.target.join(' ')}\n      ${n.html.slice(0, 200)}\n      ${n.failureSummary?.replace(/\n/g, '\n      ')}`,
          )
          .join('\n'),
    );
    expect(위반.length, `${theme} 테마 대비 위반:${보고.join('')}\n`).toBe(0);
  });
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
