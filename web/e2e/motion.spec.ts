import { test, expect, type Page } from '@playwright/test';
import { SEED, boot, settle } from './_fixtures';

/* ============================================================
   motion.spec.ts — **중간 프레임** 시각 회귀(E24 하네스 · 2026-07-29).

   ## 왜 이 파일이 먼저인가

   `visual.spec.ts` 는 **정지 프레임**을 찍는다(`boot` 가 `reducedMotion: 'reduce'` 를 명시하고,
   `settle` 이 rAF 두 번 뒤에 캡처한다). 그래서 duration·keyframe·이징을 어떻게 바꾸든
   **스냅샷 117장이 전부 통과한다** — 즉 모션 층은 시각 게이트가 원리적으로 못 보는 자리다.

   로드맵이 E24(모션 어휘 수렴: duration 15종→토큰 사다리 · 키프레임 32→20)를 Later 에 둔 이유가
   정확히 이것이었다: _"스냅샷이 못 보는 변경이라 '됐다'를 말할 근거가 눈뿐이다. 착수한다면 중간 프레임
   스냅샷을 먼저 만들고 나서 손대야 하고, 그 하네스가 없으면 착수하지 않는 편이 낫다."_

   ## 어떻게 결정적으로 얼리나 — 시각(time)을 직접 세운다

   "몇 ms 기다렸다 찍기"는 결정적이지 않다(스케줄러·GPU·CI 부하에 흔들린다). 대신:

   1. `reducedMotion: 'no-preference'` — 모션을 **켠다**(정지 프레임 게이트와 정반대 전제).
   2. 문서 시작에 `animation-play-state: paused !important` 를 심는다 → 모든 CSS 애니가
      **0ms 에서 멈춘 채** 태어난다. 늦게 붙는 요소도 자동으로 걸린다.
   3. `document.getAnimations()` 의 `currentTime` 을 원하는 ms 로 **직접 세운다**.
   벽시계에 의존하지 않으므로 같은 입력에 같은 픽셀이 나온다.

   ⚠ `AmbientCanvas` 는 CSS 애니가 아니라 RAF 라 위 정지가 안 먹는다 — 모션을 켜는 순간 오로라가
   매 프레임 달라져 이 파일 전체가 flaky 가 된다. **`fxLite` 로 재우지 않는다**(그 노브는 애니
   duration 까지 눌러 버린다) — `bootFrozen` 이 캔버스를 **숨겨서** 재운다. 상세는 그 함수 주석.
   ⚠ 클립을 좁게 잡는다(`#main`, 또는 대상 크기). 전체 페이지를 찍으면 이 하네스가 레이아웃
   회귀까지 떠안게 되고, 그건 `visual.spec.ts` 의 일이다. **여기서 재는 것은 '지금 어떤 모션이
   어디까지 갔나'** 하나다.
   ⚠ 시점은 **어휘마다 하나**다. 프레임을 여럿 찍으면 베이스라인이 늘어난 만큼 재생성 비용이
   붙는데, 어휘가 바뀌었는지는 한 시점이면 드러난다. 예외는 `live` 뿐이고 **면적 때문**이다
   (아래 맥동 클립 주석 — 어휘가 프레임을 지배하지 못하면 관측이 아니다).

   ⚠⚠ **감도(threshold)를 이 파일에서만 조인다 — 실측으로 필요했다.** 기본 임계
   (`maxDiffPixelRatio: 0.005` + Playwright 기본 per-pixel `threshold: 0.2`)로는 E24 의 실제 변경
   (**등장 500ms → 340ms · 1.47배**)이 `motion-enter.png` 를 **통과했다**. 하네스가 죽은 것은
   아니다 — 도입 커밋의 반증(0.5s→2s · **4배**)은 지금도 잡는다. 즉 이 층에는 **감도 바닥**이
   있고, 다크 테마의 페이드는 opacity 0.77→0.92 여도 픽셀 색차가 기본 임계 아래로 떨어진다.
   정지 프레임 게이트는 임계가 헐거워도 되지만(레이아웃·색은 큰 면적으로 움직인다) **모션은
   같은 픽셀의 미세한 값 차이가 전부**라서, 같은 임계를 쓰면 "결정적이지만 아무것도 안 재는"
   상태로 돌아간다. 그래서 여기서만 `threshold`·`maxDiffPixelRatio` 를 조인다.

   ## ⚠⚠ 이 하네스가 **실제로** 보는 것과 못 보는 것 (E24 실측 · 추측 0)

   조인 임계로 반증을 다섯 번 돌린 결과다. **주장이 아니라 측정치**이므로, 감도를 논하기 전에
   이 표를 갱신할 것(값 없이 "충분하다"고 적으면 그게 곧 다음 침묵이다):

   | 바꾼 것                          | 프레임              | 결과      |
   | -------------------------------- | ------------------- | --------- |
   | `--dur-slow` 500→340 (1.47배)    | enter(`#main`)      | **잡는다** |
   | `--dur-slow` 340→300 (1.13배)    | commit(`#main`)     | **잡는다** |
   | `--dur-slow` 340→300 (1.13배)    | enter(`#main`)      | 통과      |
   | `--tempo` 1.8s→1.5s (20%)        | live(`#main`)       | 통과 — 100px(0.015%) |
   | `--tempo` 1.8s→1.5s (20%)        | live(맥동 클립)     | 통과      |
   | `--pulse-r` 10px→6px (링 기하)   | live(맥동 클립)     | **잡는다** — 382px(**19%**) |

   읽는 법: **길이**는 `commit`(선명한 2px 링)이 가장 예민하고 `enter`(넓은 다크 페이드)는
   1.2배쯤이 바닥이다. **무한 주기는 픽셀로 관측되지 않는다** — `live-pulse` 의 70% 구간이
   거의 선형이라 위상 20%가 링 반경 ~1px 차이로 나타난다. 대신 클립을 대상 크기에 맞추면
   **키프레임 기하**(반경·레이어·색)는 19% 비율로 잡힌다. 즉 이 파일이 지키는 것은 *템포*가
   아니라 **어휘의 모양과 길이**이고, 그게 E24 가 수렴시킨 대상과 정확히 일치한다.

   ⚠⚠ **`animations: 'allow'` 가 이 파일의 생사다.** `toHaveScreenshot` 의 기본값은
   `animations: 'disabled'` 이고, 그건 캡처 직전에 **모든 CSS 애니를 끝 상태로 밀어 버린다**.
   즉 기본값으로는 아무리 정교하게 시각을 세워도 찍히는 것은 언제나 **완료 프레임**이다 —
   결정적이지만 **아무것도 안 재는** 상태이고, 그게 이 파일이 막으려던 바로 그 형태다.
   실제로 첫 판이 그랬다: 하네스가 효과를 정확히 적용하고 있었는데(seek 후 계산 스타일로
   `today-hero-in` opacity 0.165 @200ms 를 확인) 스냅샷은 duration 을 네 배 늘려도 통과했다.
   아래 반증 케이스가 이 설정이 살아 있는지를 계속 지킨다.
============================================================ */

/**
 * 어휘별 관측 시점(ms). 어휘가 바뀌면 이 픽셀이 바뀐다 — 그게 이 파일의 존재 이유다.
 *
 * ⚠⚠ **시점 선택이 곧 관측력이다.** 첫 판은 `enter: 60` 이었는데, 이 화면의 등장 애니는 지연을
 * 갖는다(당시 옛 `today-hero-in` 의 0.08s · 지금은 `--stagger` 60ms) → 60ms 는 아직 지연 구간이라
 * `both` 필이 적용된 시작 상태이고, 길이를 0.5s → 2s 로 **네 배 늘려도 같은 프레임**이었다(반증
 * 시도에서 잡았다). 하네스가 아니라 상수가 틀린 것이었지만, 증상은 똑같다: **아무것도 안 재면서
 * 녹색.**
 * → 지연을 넘겨 **활성 구간 안**에 떨어지는 시점으로 옮겼다. 새 애니를 들일 때 지연이 이 값을
 *   넘기면 같은 함정에 다시 빠지므로, 아래 반증 케이스가 그 조건을 상시로 지킨다.
 */
/**
 * 스냅샷 옵션 — **한 곳**에서만 정한다(세 샷이 갈리면 감도가 샷마다 달라진다).
 *
 * `animations: 'allow'` = 이 파일의 생사(위 머리주석). `threshold`·`maxDiffPixelRatio` = 감도.
 * ⚠ 감도의 실측 표는 머리주석에 있다. 요지: 이 값으로 `commit` 은 **1.13배**를 잡고 `enter` 는
 *   **1.47배**를 잡는다(기본값에서는 1.47배조차 통과했다 — 조이지 않으면 어휘 수렴 자체를 못 본다).
 * ⚠ 더 조이면 웹폰트 스와프·서브픽셀 렌더가 flaky 로 들어온다(그래서 `--workers=1` 이 짝이다).
 *   `maxDiffPixelRatio` 를 100픽셀 아래로 내려 무한 주기를 잡으려는 시도는 **하지 말 것** — 그
 *   영역은 노이즈와 구별되지 않고, 게이트가 결함과 노이즈를 못 가르면 그건 게이트가 아니다.
 */
const SHOT = { animations: 'allow', threshold: 0.05, maxDiffPixelRatio: 0.0005 } as const;

const AT = {
  /** enter — 지연(0.08s)을 넘긴 활성 구간 안. */
  enter: 200,
  /** commit — 반영 신호의 피크 부근(`COMMIT_MS` = `--dur-slow` 340 의 중반). */
  commit: 170,
  /** live — 무한 애니(맥동)의 한 주기 안 특정 위상. */
  live: 600,
} as const;

/**
 * 모션을 켜고 **0ms 에 얼린 채로** 부팅한다.
 *
 * ⚠ `boot` 가 내부에서 `reducedMotion: 'reduce'` 를 걸므로 **그 뒤에** 되돌린다(순서가 계약이다).
 */
async function bootFrozen(page: Page): Promise<void> {
  /* ⚠⚠ **`fxLite` 를 쓰지 않는다 — 첫 판이 그걸로 실패했다.** 캔버스(RAF)를 재우려고 `fxLite`
     를 켰는데, 그 노브는 오라만 끄는 게 아니라 **애니 duration 을 0.01s 로 눌러 버린다**. 결과:
     `getAnimations()` 는 4개를 돌려주는데 전부 duration 0.01 이라 `seekTo(60)` 이 무의미했고,
     enter 길이를 0.4s → 1.6s 로 **네 배 늘려도 픽셀이 그대로**였다(반증 시도에서 잡았다).
     즉 하네스가 "관측한다"고 주장만 하고 아무것도 안 재고 있었다 — 이 파일이 막으려던 바로 그
     형태를, 이 파일이 스스로 하고 있었다.
     → 캔버스는 **숨겨서** 재운다(아래 freeze CSS). RAF 는 계속 돌지만 그 픽셀이 화면에 없으므로
     결정성에 영향이 없고, 우리가 재려는 CSS 애니는 손상되지 않는다. */
  /* 문서 시작에 심는다 — 나중에 마운트되는 요소의 등장 애니까지 0ms 에 잡아 둔다.
     ⚠ **주입 시점이 계약이다.** 첫 판은 `documentElement` 에 바로 붙였는데, init script 가 도는
     시점의 문서는 아직 비어 있을 수 있어 스타일이 안 붙었다 → 등장 애니가 자유롭게 돌아 **끝나
     버렸고**, 끝난 애니는 `getAnimations()` 에서 사라지므로 `seekTo` 가 **0개**를 봤다.
     가드 케이스가 그걸 첫 실행에서 잡았다(그 케이스가 없었다면 스냅샷 3장이 조용히 정지
     프레임으로 구워졌을 것이다 — 이 파일이 있으나 마나가 되는 정확한 형태). */
  await page.addInitScript(() => {
    const css = `*, *::before, *::after { animation-play-state: paused !important; }
      canvas[aria-hidden='true'] { visibility: hidden !important; }`;
    const put = (): void => {
      if (document.getElementById('e2e-freeze')) return;
      const host = document.head ?? document.documentElement;
      if (!host) return;
      const st = document.createElement('style');
      st.id = 'e2e-freeze';
      st.textContent = css;
      host.appendChild(st);
    };
    put();
    document.addEventListener('readystatechange', put);
    document.addEventListener('DOMContentLoaded', put);
  });
  await boot(page, 'dark', SEED);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
}

/** 살아 있는 모든 애니메이션을 `ms` 지점으로 옮긴다(벽시계 무관). */
async function seekTo(page: Page, ms: number): Promise<number> {
  return page.evaluate((t) => {
    const list = document.getAnimations();
    for (const a of list) {
      a.pause();
      try {
        a.currentTime = t;
      } catch {
        /* 일부 애니는 시간축이 없다(스크롤 기반 등) — 건너뛴다. */
      }
    }
    return list.length;
  }, ms);
}

test('모션 하네스가 실제로 애니메이션을 잡는다(개수 + **길이**까지)', async ({ page }) => {
  await bootFrozen(page);
  await page.goto('/today');
  // ⚠ 실화면까지 기다린다 — `#main` 만 보고 재면 Suspense **스켈레톤**의 shimmer 를 세게 된다
  //    (첫 판이 그랬다: 잡힌 4개가 전부 `sk-shimmer` 였다).
  await expect(page.locator('#main h2, #main section[aria-label]').first()).toBeVisible();
  await settle(page);
  const live = await page.evaluate(() =>
    document.getAnimations().map((a) => {
      const e = a as unknown as { effect?: { getTiming?: () => { duration?: number | string } } };
      const d = e.effect?.getTiming?.().duration;
      return typeof d === 'number' ? d : 0;
    }),
  );
  /* ⚠ 조용한 통과 방지 두 겹. 개수만 세면 **duration 이 0.01 로 눌린 상태**도 통과한다 —
     실제로 첫 판이 그렇게 통과했고, 그래서 enter 길이를 네 배 늘려도 스냅샷이 안 움직였다.
     "잴 것이 있다"는 개수가 아니라 **의미 있는 길이**로 단정한다. */
  expect(live.length, '얼릴 애니메이션이 0개다 — 하네스가 고장났거나 모션이 통째로 꺼져 있다').toBeGreaterThan(0);
  expect(
    Math.max(...live),
    '가장 긴 애니가 0.05초 미만이다 — 어딘가가 duration 을 눌렀다(모션 자제·fxLite 등)',
  ).toBeGreaterThan(0.05);
});

test('enter · 200ms — 등장 어휘', async ({ page }) => {
  await bootFrozen(page);
  await page.goto('/today');
  await expect(page.locator('#main h2, #main section[aria-label]').first()).toBeVisible();
  await settle(page);
  await seekTo(page, AT.enter);
  await expect(page.locator('#main')).toHaveScreenshot('motion-enter.png', SHOT);
});

test('live · 600ms — 무한 어휘(맥동·호흡)', async ({ page }) => {
  await bootFrozen(page);
  await page.goto('/today');
  await expect(page.locator('#main h2, #main section[aria-label]').first()).toBeVisible();
  await settle(page);
  await seekTo(page, AT.live);
  await expect(page.locator('#main')).toHaveScreenshot('motion-live.png', SHOT);
});

/* ⚠⚠ **`#main` 클립은 맥동을 못 본다 — 실측이다.** 위 `live` 샷은 프레임 면적을 **9초짜리
   오라가 지배**하므로, 실제로 재고 있던 것은 오라 하나였다. E24 가 수렴시킨 대상(옛
   `tc-pulse`·`sr-pulse`·`today-dot-ping` → `live-pulse` 하나)은 **관측 밖**이었다: 맥동하는 점은
   10px 인데 프레임은 1064×632 라, 링 기하를 10px→6px 로 바꿔도 `#main` 에서는 **382픽셀(0.01)**
   밖에 안 움직인다.
   → **클립을 대상 크기에 맞춘다.** 같은 변경이 이 클립에서는 **0.19 비율**로 나타난다(19배).
   ⚠ 이것이 이 파일의 규칙이 됐다: **어휘 하나를 관측하려면 그 어휘가 프레임 면적을 지배해야 한다.**
     새 어휘를 들일 때 `#main` 에 얹을지 자기 클립을 줄지는 그 기준으로 정한다.
   ⚠ **이 샷도 *주기*는 못 잡는다**(`--tempo` 20% 변경이 통과한다) — `live-pulse` 의 0→70% 구간이
     거의 선형이라 위상 차이가 링 반경 ~1px 로만 나타난다. 이 샷이 지키는 것은 **기하**(반경·
     레이어 수·색)이고, 주기는 토큰(`--tempo-*`)과 불변식 ⑥(리터럴 금지)이 지킨다. 픽셀로 못
     보는 것을 픽셀로 보겠다고 임계를 더 내리지 말 것. */
test('live · 맥동 — 링 확산(자기 클립 · #main 은 이걸 못 본다)', async ({ page }) => {
  await bootFrozen(page);
  await page.goto('/today');
  await expect(page.locator('#main h2, #main section[aria-label]').first()).toBeVisible();
  await settle(page);
  await seekTo(page, AT.live);
  /* '지금' 노드의 점 — `pulse-now` 노브를 입은 유일한 요소이고, 링이 점 밖으로 퍼지므로
     클립을 넉넉히 잡는다(`size-2.5` 점 + 최대 10px 스프레드 + 글로우). */
  const dot = page.locator('#main .pulse-now').first();
  await expect(dot).toBeVisible();
  const b = (await dot.boundingBox())!;
  const pad = 16;
  await expect(page).toHaveScreenshot('motion-live-pulse.png', {
    ...SHOT,
    clip: { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 },
  });
});

test('commit · 170ms — 내 행동이 반영됐다는 신호', async ({ page }) => {
  await bootFrozen(page);
  await page.goto('/today');
  await expect(page.locator('#main h2, #main section[aria-label]').first()).toBeVisible();
  await settle(page);
  /* `commit` 은 사용자 행동에서만 태어난다 — 흐름 레일의 완료 토글이 이 앱에서 가장 잦은 쓰기이고
     D-7 이 그 자리에 `commit()` 을 붙였다. 눌러서 만들고, 얼려서 본다. */
  const node = page.locator('#main button[aria-label$="완료 토글"]').first();
  await node.click();
  await seekTo(page, AT.commit);
  await expect(page.locator('#main')).toHaveScreenshot('motion-commit.png', SHOT);
});
