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
import { aliasOf, strip, tsxFiles } from './_sources';

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

/* ============================================================
   **틴트 위 글자 짝을 소스에서 역산한다** (U080 · 2026-08-31)

   ## 왜 이 절이 생겼나

   위 블록은 `--acc` 하나를 손으로 지목해 잰다. 그래서 «어느 색이 자기 틴트 위에 글자로
   쓰이는가»를 **사람이 기억**해야 했고, 그 사이로 `--warn`·`--bad` 가 빠졌다(U050 · 라이트에서
   3.41 / 3.23). `tokens.css` 의 H5 표는 `--good`·`--acc2`·`--learning`·`--signal` 만 자기 틴트
   위에서 4.5 를 맞췄는데, **코드는 그 넷 말고도 두 색을 틴트 위에 썼다.**

   ⚠ 「라이트 대비 전 화면」 e2e 게이트가 왜 못 잡았나: **로스터는 화면 단위인데 결함은 상태
   단위다**(방치 배지는 7일 조건이 시드에서 안 서고, 동기화 충돌 행은 충돌이 있어야 뜬다).
   렌더로는 원리적으로 못 닿는 층이라 여기가 자리다.

   ## 무엇을 하나 — 토큰 정의가 아니라 **소스의 짝**을 본다

   `.tsx` 에서 **같은 className 문자열 안에 `bg-tint-X…` 와 `text-Y`** 가 함께 있는 자리를 뽑아
   그 짝을 4면 × 알파 전부에서 계산한다. 목록을 손으로 적지 않는 것이 요점이다 — 적으면 그것이
   곧 다음 표류이고, 이 결함이 바로 그렇게 태어났다.
============================================================ */
describe('틴트 위 글자 — 소스에서 역산한 짝이 전부 AA(4.5:1)', () => {
  /* ⚠⚠ **알파를 이름에서 추측하지 않는다 — 정의에서 읽는다.** 처음엔 접미사 표
     (`-faint`≈9% · `-soft`=12% · 맨이름=20%)를 손으로 적었는데, 실물은 `--tint-acc2` 14% ·
     `--tint-acc-faint` 7% · `--tint-acc-8` 8% 로 **셋 다 달랐다.** 손으로 적은 표가 곧 다음
     표류라는 것이 이 회차의 근본 원인이고, 그 표를 이 검사 안에서 저지를 뻔했다. */
  /* ⚠⚠ 위 `토큰()` 을 쓰지 않는다 — 그건 **셀렉터 뒤 첫 `}` 까지만** 본다. 틴트 선언은
     그보다 아래에 있어 `undefined` 가 돌아왔고, 그래서 이 검사가 **U050 의 실결함을 되심어도
     초록이었다**(공허한 통과 — 이 저장소가 반복해 물린 부류를 검사 자신이 저지른 형태다).
     틴트는 테마와 무관하다(테마 변수의 `color-mix` 라 값이 한 벌뿐) → 파일 전역에서 찾는다. */
  const 알파_틴트 = (틴트: string): { 원색: string; 알파: number } | undefined => {
    const m = new RegExp(`--${틴트}:\\s*color-mix\\(in srgb,\\s*var\\((--[a-z0-9-]+)\\)\\s*([\\d.]+)%`).exec(CSS);
    return m ? { 원색: m[1]!, 알파: Number(m[2]) / 100 } : undefined;
  };

  /** 소스에서 `bg-tint-<X>` + `text-<Y>` 가 **같은 클래스 문자열 안**에 있는 짝. */
  function 짝들(): { 파일: string; 틴트: string; 글자: string }[] {
    const 결과: { 파일: string; 틴트: string; 글자: string }[] = [];
    for (const f of tsxFiles()) {
      const code = strip(readFileSync(f, 'utf8'));
      /* 한 문자열 리터럴(또는 템플릿 조각) 단위로 자른다 — 파일 전체에서 짝을 지으면
         서로 다른 요소의 클래스가 엮여 있지도 않은 조합을 신고한다. */
      for (const m of code.matchAll(/['"`]([^'"`\n]{0,400})['"`]/g)) {
        const chunk = m[1]!;
        const 틴트 = /(?:^|[\s:])bg-(tint-[a-z0-9-]+)/.exec(chunk)?.[1];
        if (!틴트) continue;
        /* ⚠⚠ **`text-*` 를 전부 모은다 — 처음 하나가 아니다.** 이 검사를 세울 때 실제로
           물렸다: `bg-tint-warn … text-2xs … text-warn` 에서 첫 매치는 **크기 유틸**
           (`text-2xs`)이라 토큰을 못 찾고 `continue` 로 빠졌고, 그래서 U050 의 실결함을
           되심었는데도 **초록이었다**(공허한 통과). 크기·정렬 유틸은 아래 `색of` 가
           값을 못 읽어 자연히 건너뛰어진다. */
        for (const t of chunk.matchAll(/(?:^|[\s:])text-([a-z0-9-]+)/g))
          결과.push({ 파일: aliasOf(f), 틴트, 글자: t[1]! });
      }
    }
    return 결과;
  }

  /** 토큰 이름 → 색. 값이 hex 가 아니면(파생·color-mix) undefined — 호출부가 건너뛴다. */
  const 색of = (셀렉터: string, 이름: string): RGB | undefined => {
    const v = 토큰(셀렉터, 이름.startsWith('--') ? 이름 : `--${이름}`);
    return v && /^#[0-9a-f]{6}$/i.test(v) ? hex(v) : undefined;
  };

  const 관측 = 짝들();

  it('스캐너가 실제로 짝을 찾는다 — 「0건 통과」를 막는 바닥', () => {
    /* ⚠ 래칫이 아니다. 짝을 정당하게 줄였으면 내려도 된다 — 지키는 것은 「살아 있다」 하나다. */
    expect(관측.length).toBeGreaterThanOrEqual(5);
  });

  it('라이트에서 각 짝이 4면 전부 4.5:1 이상이다', () => {
    const 위반: string[] = [];
    for (const { 파일, 틴트, 글자 } of 관측) {
      const 정의 = 알파_틴트(틴트);
      const 원색 = 정의 && 색of(라이트(null), 정의.원색);
      const 글자색 = 색of(라이트(null), 글자);
      // 값을 못 읽는 것(크기·정렬 유틸 · 파생 색)은 **조용히 건너뛴다** — 위 바닥이 공허를 막는다.
      if (!정의 || !원색 || !글자색) continue;
      for (const 면 of 라이트면) {
        const r = 대비(글자색, 합성(원색, 정의.알파, 면));
        if (r < 4.5) 위반.push(`${파일}: bg-${틴트}(${정의.알파 * 100}%) + text-${글자} → ${r.toFixed(2)}`);
      }
    }
    expect(
      [...new Set(위반)].sort(),
      '틴트 위 글자가 AA 미만이다 — `--<색>-on-soft` 를 만들어 라이트에서만 가르는 것이 이 저장소의 관용구다',
    ).toEqual([]);
  });
});
