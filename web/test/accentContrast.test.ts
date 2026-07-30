/* ============================================================
   accentContrast.test.ts — `--acc-on-soft` 가 **네 액센트 전부**에서 WCAG AA 를 지키는가.

   ## 왜 axe 가 아니라 계산인가

   `e2e/a11y.spec.ts` 는 렌더된 DOM 을 보므로 **그 순간 켜져 있는 액센트 하나**만 잰다
   (기본 = lime · `lib/uiState.ts`). 그래서 a11y 원장은 몇 달 동안 lime 의 4.35:1 **하나**를
   들고 있었는데, 실제로 재 보니 라이트 **네 액센트 전부** 최악 4.04 이하였다 — 원장의 수치는
   결함의 크기가 아니라 **검사기가 도달한 범위**였다. 액센트를 바꾸는 것은 사용자의 노브라
   "기본값만 통과"는 계약이 될 수 없다.

   렌더로는 원리적으로 4×2 조합을 다 돌 수 없다(스냅샷·검사 시간이 8배가 된다). 값 자체가
   계약이므로 **원천(tokens.css)을 파싱해 계산으로 잠근다** — 이 저장소가 `check:tokens` 에서
   이미 쓰는 형태다(정적 검사가 렌더보다 나은 자리).

   ## 무엇을 재는가

   `text-acc-on-soft` 가 얹히는 **액센트 틴트 알파 3종**(8·16·20%)을 **라이트 배경 4종 중 가장
   어두운 면** 위에 놓고 잰다. 틴트 자체는 언제나 **원래 `--acc`** 로 계산한다 — 틴트는 액센트
   자신의 색이고 이 변경이 건드리는 것은 *글자*뿐이다(절대규칙 #4: 사용자가 못박은 `--acc` 는
   안 바꾼다).

   ⚠ 이 테스트가 잡는 진짜 회귀는 "누가 `--acc` 를 바꾸고 `--acc-on-soft` 를 안 따라 바꾸는 것"이다.
      두 값은 기계적 파생이 아니라 손으로 맞춘 짝이라, 집행자가 없으면 조용히 갈린다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CSS = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8');

/* ── 색 계산(WCAG 2.x 상대휘도) ───────────────────────────── */
type RGB = [number, number, number];
const 선형 = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const 휘도 = ([r, g, b]: RGB) => 0.2126 * 선형(r / 255) + 0.7152 * 선형(g / 255) + 0.0722 * 선형(b / 255);
const 대비 = (a: RGB, b: RGB) => {
  const [x, y] = [휘도(a), 휘도(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
/** 알파 합성 — 틴트는 전부 `color-mix(… N%, transparent)` 라 배경 위에 그대로 얹힌다. */
const 합성 = (fg: RGB, alpha: number, bg: RGB): RGB => fg.map((c, i) => alpha * c + (1 - alpha) * bg[i]) as RGB;

/** 셀렉터 블록 안의 토큰 값 하나. 블록이 없거나 토큰이 없으면 undefined. */
function 토큰(셀렉터: string, 이름: string): string | undefined {
  const i = CSS.indexOf(셀렉터);
  if (i < 0) return undefined;
  const 본문 = CSS.slice(i, CSS.indexOf('}', i));
  return new RegExp(`${이름}:\\s*([^;]+);`).exec(본문)?.[1].trim();
}

const 라이트 = (accent: string | null) =>
  accent ? `:root[data-theme='light'][data-accent='${accent}']` : `:root[data-theme='light']`;

/* 밑면은 **라이트 배경 4종 중 가장 어두운 것**으로 고정한다(값은 tokens.css 에서 읽는다).
   ⚠ 처음엔 `--panel`(#fff) 을 기준으로 잡았는데 axe 가 `review-run` 배지에서 배경을 `#d9e2d4`
   라고 보고해 틀렸음이 드러났다 — 역산하면 밑면이 `--panel2` 였다. **어느 면 위에 얹히는지는
   컴포넌트가 정하지 토큰이 정하지 않는다.** 그래서 가장 어두운 면으로 못박는다: 컴포넌트가
   재부모화돼도 계약이 안 깨지고, 검사가 "지금 우연히 그런 배치"에 기대지 않는다. */
const 라이트면 = ['--bg', '--bg2', '--panel', '--panel2'].map((n) => hex(토큰(라이트(null), n)!));
const 최암면 = 라이트면.reduce((a, b) => (휘도(a) <= 휘도(b) ? a : b));

/** 액센트 틴트 알파 3종 — 8%(`--acc-soft`) · 16%(`--tint-acc`) · 20%(`--tint-acc-panel-20`). */
const 배경들 = (acc: RGB): [string, RGB][] =>
  ([0.08, 0.16, 0.2] as const).map((a) => [`acc ${a * 100}% over 최암면`, 합성(acc, a, 최암면)]);

/* 기본(violet)은 data-accent 가 없다 → 라이트 상위 블록이 소유한다. */
const 라이트액센트: [string, string | null][] = [
  ['violet(기본)', null],
  ['lime', 'lime'],
  ['cyan', 'cyan'],
  ['amber', 'amber'],
];

describe('--acc-on-soft — 액센트 틴트 위 글자가 라이트 4종 전부 AA(4.5:1)', () => {
  it.each(라이트액센트)('%s', (_, accent) => {
    const acc = 토큰(라이트(accent), '--acc');
    const on = 토큰(라이트(accent), '--acc-on-soft');
    expect(acc, `${라이트(accent)} 에 --acc 가 없다`).toBeDefined();
    // ⚠ 상속이 아니라 **명시**를 요구한다 — 프리셋이 빠지면 violet 값을 물려받아
    //    "다른 색조의 글자"가 되고, 그건 통과해도 디자인이 틀린 상태다.
    expect(on, `${라이트(accent)} 에 --acc-on-soft 가 없다(프리셋마다 명시해야 한다)`).toBeDefined();

    for (const [이름, bg] of 배경들(hex(acc!))) {
      expect(대비(hex(on!), bg), `${이름} 위에서 부족`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('다크는 --acc 자신을 쓴다(전 액센트가 5:1 이상이라 값을 가를 이유가 없다)', () => {
    expect(토큰(':root,', '--acc-on-soft')).toBe('var(--acc)');

    const DARK_BG = hex(토큰(':root,', '--bg')!);
    const DARK_PANEL = hex(토큰(':root,', '--panel')!);
    const 다크액센트: [string, string][] = [
      ['violet(기본)', 토큰(':root,', '--acc')!],
      ['lime', 토큰(`:root[data-accent='lime']`, '--acc')!],
      ['cyan', 토큰(`:root[data-accent='cyan']`, '--acc')!],
      ['amber', 토큰(`:root[data-accent='amber']`, '--acc')!],
    ];
    for (const [이름, h] of 다크액센트) {
      const acc = hex(h);
      // 다크 --acc-soft 는 14%(라이트 8%와 다르다 · tokens.css).
      const 최악 = Math.min(
        대비(acc, 합성(acc, 0.14, DARK_BG)),
        대비(acc, 합성(acc, 0.16, DARK_PANEL)),
        대비(acc, 합성(acc, 0.2, DARK_PANEL)),
      );
      expect(최악, `다크 ${이름} 이 4.5 미만 — 라이트처럼 값을 갈라야 한다`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
