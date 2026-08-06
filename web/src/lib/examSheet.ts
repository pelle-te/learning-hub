/* ============================================================
   examSheet.ts — **T-18 시험 전날 한 장**. 볼트 노트를 접어 내린다(순수 · React 무관).

   ## 무엇이 없었나

   앱은 노트가 **있다**는 것만 알았다(`vault_scan` 은 프론트매터만 읽는다). 그래서 시험 전날에
   필요한 것 — 정의·정리(공식)·함정 — 을 보려면 Obsidian 을 열어 챕터를 하나씩 뒤졌고, 실제로는
   **종이에 손으로 옮겨 적고** 있었다(로드맵 T-18 의 `지금 앱 밖에서` 열).

   ## ⚠ 전제를 먼저 쟀다 — 참이다

   이 항목의 전제는 _"노트의 '공식/정의/조건'이 **형식적으로** 식별 가능하다"_ 였고, 로드맵이
   처방한 가장 싼 검증은 _"3챕터 노트를 눈으로"_ 였다. 실측(2026-08-06 · 볼트 3과목 전량):

     정리 395 · 예제 371 · 이 모듈에서 285 · ⚡ 함정 247 · 증명 212 · 정의 212 · 한눈에 133

   파이프라인이 굽는 Obsidian 콜아웃(`> [!info] 정리 — …`)이 **과목을 가로질러 일관**한다.
   전제가 거짓이었으면 이 파일은 안 만들었다.

   ## 규율

   1. **파싱만 하고 렌더링은 안 한다.** 화면은 `features/items/ExamSheet.tsx` 가 그린다.
   2. **못 찾으면 0 이 아니라 "못 찾았다"** — 노트는 읽혔는데 항목이 0인 것과 노트 자체가 0인 것은
      다른 사실이다(전자는 *마크업이 우리 규약과 다르다*는 뜻이고, 그때 화면이 "정리 0개"라고
      말하면 사용자는 자기 노트가 비었다고 오해한다). `SheetNote.parsed` 가 그 둘을 가른다.
   3. **수식은 부분 변환이다 — 그리고 그렇게 적는다.** KaTeX 를 들이면 의존성·번들 예산이 붙고
      그건 이 항목의 범위가 아니다. 여기서 하는 것은 *읽을 수 있게 다듬기*지 조판이 아니다.
============================================================ */

/** 시트에 담는 항목의 종류. **이 넷이 전부다** — 예제·증명은 한 장에 안 들어간다(길이가 다르다). */
export type SheetKind = '요약' | '정의' | '정리' | '함정';

/** 렌더 순서 = 시험 전날에 읽는 순서(무엇인가 → 무엇이 성립하나 → 어디서 틀리나). */
export const SHEET_KINDS: SheetKind[] = ['요약', '정의', '정리', '함정'];

export interface SheetItem {
  kind: SheetKind;
  /** 콜아웃 헤더의 ` — ` 뒷부분(없으면 빈 문자열). */
  title: string;
  /** 본문 첫 문장 — 수식이 아닌 줄. */
  gist: string;
  /** 본문의 디스플레이 수식(`$$…$$`), 읽을 수 있게 다듬은 형태. */
  formulas: string[];
}

export interface SheetNote {
  folder: string;
  title: string;
  items: SheetItem[];
  /** 이 노트에서 **콜아웃을 하나라도 봤나**. false = 마크업이 우리 규약과 다르다(위 규율 2). */
  parsed: boolean;
}

/** 노트 본문(Rust `vault_notes_text` 의 응답 모양). */
export interface RawNote {
  folder: string;
  title: string;
  text: string;
}

/** 콜아웃 첫 줄. `> [!info]- 정리 — 전력은 전압 × 전류`
 *  ⚠ 헤더 앞 공백을 `\s*` 로 먹지 않는다 — 뒤의 `(.*)` 와 겹쳐 역추적이 초선형이 된다(린트가 잡는다).
 *  공백 제거는 호출부의 `trim()` 몫이다. */
const CALLOUT = /^>\s*\[!(\w+)\][+-]?(.*)$/;

/** 헤더 앞머리의 이모지·기호(`⚡`·`💡`·`📊`)를 떼고 종류만 남긴다. */
function headKind(head: string): SheetKind | null {
  const t = head.replace(/^[^\p{L}\p{N}]+/u, '').trim();
  if (t.startsWith('정의')) return '정의';
  if (t.startsWith('정리')) return '정리';
  if (t.startsWith('함정')) return '함정';
  // 노트 머리의 한 줄 요약. 파이프라인이 굽는 이름이 둘이라 둘 다 받는다.
  if (t.startsWith('이 모듈에서') || t.startsWith('한눈에')) return '요약';
  return null;
}

/** 헤더의 ` — ` 뒷부분(제목). 구분자가 없으면 제목이 없는 콜아웃이다. */
function headTitle(head: string): string {
  const i = head.indexOf(' — ');
  return i >= 0 ? head.slice(i + 3).trim() : '';
}

/* ⚠ **의도적으로 부분 변환이다**(머리주석 규율 3). 실측 노트에 실제로 자주 나오는 것만 다룬다 —
   표를 키우기 시작하면 그 끝은 LaTeX 파서를 손으로 쓰는 것이고, 그때는 KaTeX 가 더 싸다. */
const MATH_SUBS: [RegExp, string][] = [
  [/\\tag\{([^}]*)\}/g, ' ($1)'],
  [/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '$1/$2'],
  [/\\cdot/g, '·'],
  [/\\times/g, '×'],
  [/\\infty/g, '∞'],
  [/\\int/g, '∫'],
  [/\\ge(?![a-z])/g, '≥'],
  [/\\le(?![a-z])/g, '≤'],
  [/\\approx/g, '≈'],
  [/\\[,;!]/g, ' '],
  [/\\\\(\[[^\]]*\])?/g, ' '],
];

/** 디스플레이 수식 하나를 한 줄로 다듬는다. **원본 의미를 바꾸지 않는 치환만** 한다. */
export function readableMath(tex: string): string {
  let s = tex;
  for (const [re, to] of MATH_SUBS) s = s.replace(re, to);
  return s.replace(/\s+/g, ' ').trim();
}

/** 본문 줄에서 마크다운 강조·링크 껍데기를 벗긴다(문장은 안 자른다).
 *  ⚠ 인라인 수식(`$v = dw/dq$`)의 달러 기호도 벗긴다 — 실 볼트 프로브(2026-08-06)에서 요지 문장
 *  대부분이 인라인 수식을 품고 있었고, 조판하지 않을 것이면 구분자만 남는 것은 소음이다. */
function plain(line: string): string {
  return (
    line
      .replace(/\$([^$]+)\$/g, (_, tex: string) => readableMath(tex))
      // `[[대상|별칭]]` → 별칭이 있으면 별칭. 한 그룹으로 받고 갈라 읽는다(중첩 그룹은 역추적을 만든다).
      .replace(/\[\[([^[\]]*)\]\]/g, (_, inner: string) => inner.split('|').pop() ?? inner)
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .trim()
  );
}

/** 첫 문장 상한. 이걸 넘기면 그건 요지가 아니라 본문이고, 한 장에 안 들어간다. */
const GIST_MAX = 160;

/**
 * 노트 하나를 항목들로 접는다.
 *
 * ⚠ 콜아웃 본문은 **`>` 로 이어지는 줄 전부**다. Obsidian 은 빈 `>` 줄로 문단을 나누므로
 * 첫 비-`>` 줄에서 끊는 것이 그 문법과 일치한다.
 */
export function parseNote(text: string): { items: SheetItem[]; parsed: boolean } {
  const lines = text.split(/\r?\n/);
  const items: SheetItem[] = [];
  let parsed = false;

  for (let i = 0; i < lines.length; i++) {
    const m = CALLOUT.exec(lines[i]!);
    if (!m) continue;
    parsed = true;
    const kind = headKind(m[2] ?? '');
    // 본문은 종류와 무관하게 소비한다 — 안 그러면 예제 본문의 `> [!…]` 아닌 줄이 다음 콜아웃의
    // 시작으로 오해될 여지가 생긴다(실제로는 못 생기지만, 커서를 한 곳에서만 움직이는 편이 안전).
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length && lines[j]!.startsWith('>'); j++) body.push(lines[j]!.replace(/^>\s?/, ''));
    i = j - 1;
    if (!kind) continue;

    const joined = body.join('\n');
    const formulas = [...joined.matchAll(/\$\$([\s\S]*?)\$\$/g)].map((f) => readableMath(f[1] ?? '')).filter(Boolean);
    const gistLine = body.find((l) => l.trim() && !l.trim().startsWith('$$')) ?? '';
    const gist = plain(gistLine.replace(/\$\$[\s\S]*?\$\$/g, '')).slice(0, GIST_MAX);
    if (!gist && !formulas.length) continue; // 껍데기만 있는 콜아웃은 한 장을 늘리기만 한다
    items.push({ kind, title: headTitle(m[2] ?? ''), gist, formulas });
  }
  return { items, parsed };
}

/**
 * 노트 묶음 → 시트. **빈 노트도 남긴다** — 무엇이 접혔고 무엇이 안 접혔는지가 화면의 정보다
 * (머리주석 규율 2).
 */
export function buildSheet(notes: readonly RawNote[]): SheetNote[] {
  return notes.map((n) => ({ folder: n.folder, title: n.title, ...parseNote(n.text) }));
}

/** 시트 전체의 항목 수(종류별). 화면 상단 리드아웃이 쓴다. */
export function countByKind(sheet: readonly SheetNote[]): Record<SheetKind, number> {
  const out: Record<SheetKind, number> = { 요약: 0, 정의: 0, 정리: 0, 함정: 0 };
  for (const n of sheet) for (const it of n.items) out[it.kind]++;
  return out;
}
