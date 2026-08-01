/* ============================================================
   icons.test.ts — **아이콘 이름이 실제로 존재하는가**(이모지→아이콘 이식의 짝 · 2026-08-01).

   ## 왜 이 검사가 필요한가

   `<Icon name="…" />` 는 없는 이름을 받으면 **null 을 반환한다** — 즉 오타 하나에 픽토그램이
   조용히 사라지고 **타입·린트·스냅샷이 전부 녹색**이다(스냅샷은 임계 아래로 통과한다). 정적
   검사가 원리적으로 못 보는 자리이고, 이 저장소가 `--sky`·`--panel-2` 로 두 번 물린 형태와
   **같은 부류**다(존재하지 않는 이름이 조용히 기본값으로 렌더). 처방도 같다: 이름을 정본과 대조.

   ⚠ 소스를 텍스트로 훑는다 — `tokens.css` 를 파싱하는 `accentContrast.test.ts` 와 같은 관용구다.
   컴포넌트를 렌더해서는 **쓰이지 않는 분기의 이름**을 볼 수 없다(그게 정확히 위험한 자리다).
============================================================ */
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ICON_PATHS } from '@/lib/iconPaths';
import { STAGE_META } from '@/lib/ledger';

const SRC = globSync('src/**/*.{ts,tsx}');

/** `<Icon name="x" …>` 와 `glyph="x"` 의 **문자열 리터럴**만 걷는다(동적 이름은 아래 표 검사가 덮는다). */
function literalNames(): { name: string; file: string }[] {
  const out: { name: string; file: string }[] = [];
  for (const f of SRC) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/<Icon\s[^>]*?name="([^"]+)"/g)) out.push({ name: m[1]!, file: f });
    for (const m of s.matchAll(/\bglyph="([^"]+)"/g)) out.push({ name: m[1]!, file: f });
  }
  return out;
}

describe('아이콘 이름은 실재해야 한다', () => {
  it('JSX 의 모든 리터럴 이름이 ICON_PATHS 에 있다', () => {
    const bad = literalNames().filter((x) => !(x.name in ICON_PATHS));
    expect(bad, `없는 이름은 **아무것도 안 그린다** — ${JSON.stringify(bad)}`).toEqual([]);
  });

  it('⚠ 데이터 표의 이름도 실재한다(동적이라 위 검사가 못 본다)', () => {
    /* 이 표들은 `<Icon name={map[k]} />` 로 쓰여서 소스 스캔에 안 걸린다 — 값이 곧 이름이므로
       여기서 직접 대조한다. 새 표가 생기면 이 목록에 한 줄을 더한다(그게 이 검사의 유지 비용 전부). */
    const dynamic = Object.values(STAGE_META).map((m) => m.glyph);
    const bad = dynamic.filter((n) => !(n in ICON_PATHS));
    expect(bad).toEqual([]);
  });

  it('⚠ 죽은 아이콘이 없다 — 안 쓰이는 경로는 유지되지 않고 다음 사람을 오도한다', () => {
    const src = SRC.map((f) => readFileSync(f, 'utf8')).join('\n');
    const unused = Object.keys(ICON_PATHS).filter((n) => !new RegExp(`["']${n}["']`).test(src));
    expect(unused, `쓰이지 않는 아이콘 — 지우거나 쓰세요: ${unused.join(', ')}`).toEqual([]);
  });

  it('경로는 전부 SVG 요소로 시작한다(빈 문자열·본문 누락 방지)', () => {
    const bad = Object.entries(ICON_PATHS).filter(([, p]) => !/^<(path|circle|rect|polyline|polygon)\b/.test(p));
    expect(bad.map(([n]) => n)).toEqual([]);
  });
});
