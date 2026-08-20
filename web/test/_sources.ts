/* ============================================================
   test/_sources.ts — **소스를 훑는 불변식들의 공용 스캐너**(2026-08-20 리뷰 m-16).

   ## 왜 생겼나 — 이 파일이 없던 동안 무슨 일이 있었나

   `invariants.test.ts` 는 13개 불변식이 각자 자기 파일 워커를 팠다(`files`·`readersOfCssVars`·
   `cssFiles`·`filesUnder`·`tsFiles`·`sources`·`tsxUnder`·`tsFilesOf`·`tsxFiles`·`sources11`·
   `inputTags` — **11벌**). 루트 상수도 `SRC`·`SRC7`·`SRC8`·`SRC11`·`SRC13` 으로 그림자 선언됐다.

   그건 취향 문제가 아니었다. **주석 제거기가 4벌·의미 3가지**로 갈렸고, 그 차이가 양방향으로
   틀렸다:

   · **오탐** — 가장 최근에 추가된 불변식(⑬)만 원문을 **가공 없이** 스캔했다. 그런데 이 파일은
     네 번이나 *"근거를 남길수록 게이트가 빨개지면 그건 역인센티브다"* 라고 못박고 처방까지
     적어 뒀다. 즉 새 케이스가 그 규율을 상속하지 못했고, 그 상태에선 주석에 옛 마크업을
     인용하는 순간 위반이 되며 **고치는 유일한 길이 프로덕션 CSS 를 바꾸는 것**이 된다.
   · **오검** — 일부 제거기가 `/\/\/.*$/gm` 이라 **문자열 속 `https://`** 뒤를 통째로 잘랐다.
     같은 줄에 온 선언은 스캔에서 조용히 사라진다. ⑦·⑧은 `(^|[^:])//` 로 이미 그 함정을
     피했는데 나머지가 못 받았다.

   → 워커와 제거기를 **한 벌**로 만든다. 요점은 코드 줄 수가 아니라 **다음 불변식이 규율을
     자동으로 상속한다**는 것이다.
============================================================ */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** 앱 소스 루트. ⚠ 여기 하나다 — `SRC7`·`SRC8` 같은 그림자 선언을 만들지 말 것. */
export const SRC = join(process.cwd(), 'src');

/** 조건에 맞는 파일 경로 전부(재귀). `root` 기본값은 `SRC`. */
export function filesUnder(pred: (name: string) => boolean, root: string = SRC): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (pred(e.name)) out.push(p);
    }
  };
  walk(root);
  return out;
}

/** TS/TSX 전부. */
export const tsFiles = (root: string = SRC): string[] => filesUnder((n) => /\.tsx?$/.test(n), root);
/** TSX 만. */
export const tsxFiles = (root: string = SRC): string[] => filesUnder((n) => n.endsWith('.tsx'), root);
/** CSS 만. */
export const cssFiles = (root: string = SRC): string[] => filesUnder((n) => n.endsWith('.css'), root);

/**
 * 주석을 걷어낸다 — **검사 대상은 선언이지 묘비명이 아니다.**
 *
 * ⚠ `[^:]` 가드가 핵심이다: 없으면 문자열 속 `https://` 를 `//` 주석으로 읽어 그 줄의 나머지를
 * 잘라내고, 같은 줄에 온 선언이 스캔에서 **조용히 사라진다**(오검). 캡처를 그대로 되돌려
 * 앞 글자를 잃지 않는다.
 * ⚠ 블록 주석을 먼저 지운다 — 줄 주석 규칙이 블록 안의 `//` 를 건드리지 않게.
 */
export const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** 파일 경로 → `{ path, code }`(주석 제거본). 대부분의 불변식이 원하는 형태다. */
export function sources(root: string = SRC): { path: string; code: string }[] {
  return tsFiles(root).map((p) => ({ path: p, code: strip(readFileSync(p, 'utf8')) }));
}

/** 원문 그대로가 필요할 때(주석 자체를 검사하는 불변식). */
export function rawSources(root: string = SRC): { path: string; code: string }[] {
  return tsFiles(root).map((p) => ({ path: p, code: readFileSync(p, 'utf8') }));
}

/* ── import 그래프 ────────────────────────────────────────────────────────────
   knip 이 **원리적으로 못 보는 축**을 여기서 본다: "테스트만 import 하는 프로덕션 모듈".
   knip 의 vitest 플러그인이 `test/**` 를 자동으로 entry 에 넣기 때문에 설정으로는 못 고친다
   (`knip.jsonc` 머리주석에 실측이 적혀 있다). 근거는 2026-08-20 리뷰 m-4. */

/** `@/lib/x`·`./x`·`../x/y` 형태의 import 지정자 전부(타입 전용·동적 포함). */
export function importSpecifiers(code: string): string[] {
  const out: string[] = [];
  const re = /(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) out.push(m[1]!);
  return out;
}

/** `src/` 안의 파일 경로 → `@/` 별칭 형태(확장자 없음). 예: `…/src/lib/since.ts` → `@/lib/since` */
export function aliasOf(absPath: string): string {
  const rel = absPath.slice(SRC.length + 1).replace(/\\/g, '/');
  return '@/' + rel.replace(/\.tsx?$/, '');
}
