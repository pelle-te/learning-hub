/* ============================================================
   annoContrast.test.ts — **세 번째 값 평면(`--anno`)이 읽히는가**(U017 · 2026-08-21 ux 축).

   ## 왜 계산인가 (`accentContrast.test.ts` 와 같은 논거)

   `--anno` 는 `--mut` 을 배경 쪽으로 섞은 색이라, 실제 대비는 **어느 면 위에 얹히는가**에 따라
   갈린다(`--bg`·`--bg2`·`--panel`·`--panel2`). 렌더 검사는 «그 순간 그 화면에 있는 조합» 하나만
   보고, 그나마 이 층의 상당수는 axe 가 `incomplete` 로 버린다(의사요소 배경 · U003). 그래서
   조합 4×2 를 전부 도는 유일한 길이 값 계산이다.

   ## 무엇이 계약인가

   `--anno` 가 나르는 것은 **텍스트**다 — 오늘 스트립의 마지막 한 줄, 오늘 버퍼의 안내, 설정의
   축 눈금, 배분 보드 열 머리. 그래서 WCAG **1.4.3(4.5:1)** 이지 1.4.11(3:1)이 아니다.
   토큰 주석이 오래 «3:1 이면 된다»고 적고 있었고, 그 문장이 그 사실의 유일한 기록이었다.

   ⚠ 이 테스트가 잡는 진짜 회귀는 *"누가 `--mut` 이나 배경을 조정하고 `--anno` 믹스를 안
   따라 바꾸는 것"* 이다. 세 값이 손으로 맞춘 삼각형이라 집행자가 없으면 조용히 갈린다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CSS = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8');

type RGB = [number, number, number];
const 선형 = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const 휘도 = ([r, g, b]: RGB) => 0.2126 * 선형(r) + 0.7152 * 선형(g) + 0.0722 * 선형(b);
const 대비 = (a: RGB, b: RGB) => {
  const [x, y] = [휘도(a), 휘도(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB;
const 섞기 = (a: RGB, b: RGB, p: number): RGB => a.map((v, i) => v * p + b[i]! * (1 - p)) as RGB;

/** 블록 안의 토큰 값 하나. ⚠ 블록 끝은 **줄 맨 앞의 `}`** 다(본문에 중괄호가 섞여 있다). */
function 토큰(셀렉터: string, 이름: string): string {
  const i = CSS.indexOf(셀렉터);
  const 끝 = CSS.indexOf('\n}', i);
  const v = new RegExp(`${이름}:\\s*([^;]+);`).exec(CSS.slice(i, 끝 < 0 ? undefined : 끝))?.[1].trim();
  if (!v) throw new Error(`${셀렉터} 안에 ${이름} 이 없다`);
  return v;
}

/** WCAG 1.4.3 — 본문 텍스트. `--anno` 가 나르는 것이 텍스트이므로 이 값이다(1.4.11 이 아니다). */
const 최소 = 4.5;
const 면들 = ['--bg', '--bg2', '--panel', '--panel2'] as const;

const 테마 = [
  { 이름: '다크', 셀렉터: ":root[data-theme='dark'] {" },
  { 이름: '라이트', 셀렉터: ":root[data-theme='light']" },
] as const;

for (const t of 테마) {
  describe(`값 평면 대비 · ${t.이름}`, () => {
    const mut = hex(토큰(t.셀렉터, '--mut'));
    const bg = hex(토큰(t.셀렉터, '--bg'));
    /** `color-mix(in srgb, var(--mut) N%, var(--bg))` 의 N 을 읽어 같은 계산을 재현한다. */
    const 비율 = Number(/var\(--mut\)\s*(\d+)%/.exec(토큰(t.셀렉터, '--anno'))![1]) / 100;
    const anno = 섞기(mut, bg, 비율);

    for (const 면 of 면들) {
      it(`--anno 가 ${면} 위에서 ${최소}:1 이상이다`, () => {
        const c = 대비(anno, hex(토큰(t.셀렉터, 면)));
        expect(c, `${면} 위 ${c.toFixed(2)}:1 — 이 층은 문장을 나른다(1.4.3)`).toBeGreaterThanOrEqual(최소);
      });
    }

    it('--anno 와 --mut 이 여전히 다른 평면이다(A-15 가 만든 위계가 살아 있다)', () => {
      /* ⚠ 대비를 올리다 보면 두 값이 붙어 **평면이 둘로 되돌아간다**. 그러면 U017 을 고치면서
         A-15 를 지운 셈이라, 그 사실을 여기서 시끄럽게 만든다. 0.15:1 은 «같은 색이 아니다»의
         최소선이다(더 벌리는 것은 디자인 결정이지 접근성 요구가 아니다). */
      const 차 = Math.abs(휘도(anno) - 휘도(mut));
      expect(차, `--anno 와 --mut 의 휘도차 ${차.toFixed(4)} — 세 번째 평면이 사라졌다`).toBeGreaterThan(0.004);
    });
  });
}
