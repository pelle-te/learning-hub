/* ============================================================
   masteryRamp.test.ts — 숙달도 히트맵의 **색맹 안전성**(U016 · 2026-08-21 ux 축).

   ## 왜 이 파일이 생겼나

   `lib/utils.ts` 의 `masteryColor(p)` 는 색상만 0°(빨강)→120°(초록)로 돌린다. 그 축은
   **적록색각이상에서 통째로 무너지는 축**이고(인구의 약 8%), 그때 남는 유일한 단서는 **명도**다.
   그런데 명도 양 끝(`--mastery-l0`·`--mastery-l1`)이 다크에서 58%→62% 로 **4%p 차이**였다 —
   즉 색을 뺀 히트맵은 사실상 한 가지 회색이었다. 라이트도 44%→32% 로 나은 편이었지만
   D형 시뮬레이션에서 양 끝의 ΔE 가 1.99(육안 식별 한계 ~2.3 미만)였다.

   이 화면의 값이 **색 하나에만 실려 있다**는 것이 요점이다. 과목 색(`colorForId`)은 §7 에서
   «유지» 판정을 받았는데 그 근거가 *"전 소비처가 과목명을 병기하므로 색은 보조 채널"* 이었다 —
   여기는 정반대다. 셀은 `<i>` 하나이고 이름도 수치도 없다(툴팁뿐이다). 보조 채널이 없으면
   색 자체가 읽혀야 한다.

   ## 무엇을 재는가 (`accentContrast.test.ts` 와 같은 형태 — 렌더가 아니라 계산)

   ① **양 끝 휘도비** — p=0 과 p=1 이 최소 `휘도비_최소` 배 차이(색을 못 봐도 갈린다).
   ② **색각이상 ΔE** — 1형·2형 시뮬레이션에서 양 끝이 확실히 다른 색이다.
   ③ **면 대비** — 모든 단계가 자기 배경 위에서 4.5:1 이상. 이 램프는 셀 색이면서 **글자 색**
      이기도 하다(`NextActions.tsx` 의 유효숙달 칩) — 셀 기준(3:1)만 지키면 그 칩이 안 읽힌다.

   ⚠ **「명도 단조성」은 요구하지 않는다 — 원리적으로 불가능하다.** sRGB 에서 휘도는 색상에 따라
   빨강(낮음) → 노랑(최고) → 초록(중간)으로 움직이므로, 0°→120° 를 도는 램프는 명도가 p 에 대해
   단조일 수 없다(중간 노랑이 항상 봉우리다). 그래서 계약은 **양 끝**에 건다 — 이 화면이 답하는
   질문은 «이 개념이 저 개념보다 익었나»가 아니라 «어디가 약한가»이고, 정확한 값은 툴팁이 진다.

   ⚠ 렌더(axe)로는 원리적으로 못 잡는다: axe 에 색각이상 규칙이 없고, 히트맵 셀은
   `aria-label` 을 가지므로 대비 규칙의 대상도 아니다(비텍스트 콘텐츠 1.4.11 은 **UI 컴포넌트와
   그래픽 오브젝트**를 3:1 로 요구하는데, 그 판정 역시 자동 검사기가 못 한다).
============================================================ */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CSS = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8');

type RGB = [number, number, number];

/** 블록 안의 토큰 값 하나.
 *  ⚠ 형제(`accentContrast.test.ts`)는 블록 끝을 `indexOf('}')` 로 찾는데 **여기서는 못 쓴다**:
 *  `:root` 블록이 길고 그 안에 주석·`@font-face` 의 중괄호가 먼저 나온다. 줄 맨 앞의 `}` 가 끝이다. */
function 토큰(셀렉터: string, 이름: string): string {
  const i = CSS.indexOf(셀렉터);
  const 끝 = CSS.indexOf('\n}', i);
  const 본문 = CSS.slice(i, 끝 < 0 ? undefined : 끝);
  const v = new RegExp(`${이름}:\\s*([^;]+);`).exec(본문)?.[1].trim();
  if (!v) throw new Error(`${셀렉터} 안에 ${이름} 이 없다`);
  return v;
}

/* ── 색 계산 ─────────────────────────────────────────────── */
const 선형 = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const 감마 = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const 휘도 = ([r, g, b]: RGB) => 0.2126 * 선형(r) + 0.7152 * 선형(g) + 0.0722 * 선형(b);

/** `#rrggbb` → sRGB 0..1(면 대비 계산용). */
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB;

/** `hsl(h s% l%)` → sRGB 0..1. `masteryColor` 가 만드는 형태 그대로 재현한다. */
function hsl(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [r + m, g + m, b + m];
}

/* Viénot·Brettel·Mollon(1999) 이색형 시뮬레이션 — 선형 RGB 위 3×3.
   ⚠ 근사다. 여기서 필요한 것은 «절대 색» 이 아니라 **«두 색이 서로 뭉치는가»** 라 이 정도면 된다. */
const 이색형 = {
  protan: [
    [0.11238, 0.88762, 0],
    [0.11238, 0.88762, 0],
    [0.004184, -0.004184, 1],
  ],
  deutan: [
    [0.29275, 0.70725, 0],
    [0.29275, 0.70725, 0],
    [-0.02234, 0.02234, 1],
  ],
} as const;

function 시뮬(rgb: RGB, 종류: keyof typeof 이색형): RGB {
  const lin = rgb.map(선형) as RGB;
  const M = 이색형[종류];
  const out = M.map((row) => row[0]! * lin[0] + row[1]! * lin[1] + row[2]! * lin[2]);
  return out.map((v) => 감마(Math.min(1, Math.max(0, v)))) as RGB;
}

/** sRGB → CIE Lab(D65). ΔE(CIE76)를 재기 위한 최소 구현. */
function lab([r, g, b]: RGB): [number, number, number] {
  const [R, G, B] = [선형(r), 선형(g), 선형(b)];
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
const ΔE = (a: RGB, b: RGB) => {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
};

/* ── 계약 ─────────────────────────────────────────────────
   ⚠ 숫자를 손으로 「적당히」 고르지 않았다:
   · 휘도비 2.5 — 회색조로 봤을 때 양 끝이 «다른 밝기»로 읽히는 선. 3.0(1.4.11)을 목표로 삼았지만
     세 계약을 동시에 만족하는 조합이 없었다(면 대비 4.5 를 함께 요구하면 다크의 상한이 2.52).
     **가장 약한 계약을 낮추는 대신 그 사실을 여기 적는다** — 실측 최적이 2.52 라 여유는 0.02 다.
   · ΔE 20 — CIE76 에서 «다른 색이다»가 명백한 대역(2.3 은 «겨우 다르다» · 10 은 «주의하면 다르다»).
     발견 당시 D형 실측이 **1.99** 였다.
   · 면 대비 4.5 — WCAG 1.4.3(본문 텍스트). 이 램프가 글자 색으로도 쓰이기 때문이다(위 ③). */
const 휘도비_최소 = 2.5;
const ΔE_최소 = 20;
const 면대비_최소 = 4.5;

/** `masteryColor` 의 재현 — ⚠ 그 함수는 CSS `calc()` 를 문자열로 만들므로 JS 로 계산할 수 없다.
 *  공식이 갈리지 않게 **한 줄로** 옮겨 둔다(그 함수를 바꾸면 이 줄도 함께 바꿔야 한다). */
const 램프 = (p: number, l0: number, l1: number): RGB => hsl(p * 120, 0.62, (l0 + (l1 - l0) * p) / 100);

const 테마 = [
  /* ⚠ `:root {` 가 아니다 — 이 파일에는 `:root {`(비테마 스케일)와
     `:root, :root[data-theme='dark'] {`(다크 색) **두 블록**이 있고 색은 뒤쪽에 산다. */
  { 이름: '다크', 셀렉터: ":root[data-theme='dark'] {" },
  { 이름: '라이트', 셀렉터: ":root[data-theme='light']" },
] as const;

for (const t of 테마) {
  describe(`숙달도 램프 · ${t.이름}`, () => {
    const l0 = parseFloat(토큰(t.셀렉터, '--mastery-l0'));
    const l1 = parseFloat(토큰(t.셀렉터, '--mastery-l1'));
    const 단계 = [0, 0.25, 0.5, 0.75, 1].map((p) => ({ p, rgb: 램프(p, l0, l1) }));

    it(`모든 단계가 자기 면에서 ${면대비_최소}:1 이상이다(셀이면서 글자다)`, () => {
      const 면 = t.이름 === '라이트' ? ([1, 1, 1] as RGB) : (hex(토큰(t.셀렉터, '--bg')) as RGB);
      const 최소 = Math.min(
        ...단계.map((s) => {
          const [a, b] = [휘도(s.rgb), 휘도(면)].sort((x, y) => y - x);
          return (a! + 0.05) / (b! + 0.05);
        }),
      );
      expect(최소, `가장 안 보이는 단계가 ${최소.toFixed(2)}:1 이다`).toBeGreaterThanOrEqual(면대비_최소);
    });

    it(`양 끝의 휘도비가 ${휘도비_최소}:1 이상이다`, () => {
      const [a, b] = [휘도(단계[0]!.rgb), 휘도(단계.at(-1)!.rgb)].sort((x, y) => y - x);
      const 비 = (a! + 0.05) / (b! + 0.05);
      expect(비, `p=0 과 p=1 의 휘도비 ${비.toFixed(2)}:1 — 색을 못 보면 같은 값으로 읽힌다`).toBeGreaterThanOrEqual(
        휘도비_최소,
      );
    });

    for (const 종류 of ['protan', 'deutan'] as const) {
      it(`${종류} 시뮬레이션에서 양 끝이 ΔE ${ΔE_최소} 이상 벌어진다`, () => {
        const d = ΔE(시뮬(단계[0]!.rgb, 종류), 시뮬(단계.at(-1)!.rgb, 종류));
        expect(d, `ΔE ${d.toFixed(2)} — 적록 축이 무너지면 남는 단서는 명도뿐이다`).toBeGreaterThanOrEqual(ΔE_최소);
      });
    }
  });
}
