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
import { navGroups } from '@/shell/tabs';

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

  /* ── ⭐ **레일 마크 ↔ 화면 안 마크가 갈리지 않는다** (U054 · 2026-08-31) ────────────────

     위 검사들은 «이름이 실재하는가» 를 본다. 이건 그 한 겹 아래다: **실재하는 두 이름이 같은
     화면을 가리키며 서로 다른가.** 실측 불일치 넷이 있었고(`questions`·`mistakes`·`ledger` ·
     그중 하나는 2026-08-29 트리가 **맞던 짝을 새로 깼다**), 접힘 레일은 라벨이 없어 자리를
     마크로 외우는 것이 설계 전제라 화면 안이 다른 마크를 보이면 그 전제가 되돌려진다.

     처방은 값 검사가 아니라 **문법 금지**다(오버레이 §1-D 의 형태): feature 본문에서
     `glyph="리터럴"` 을 쓰지 못하게 하고 `glyphOf(key)` 로 로스터에서 파생시킨다. 그러면
     갈릴 자리가 없어진다. */
  /* ── ⭐ **레일 마크 ↔ 화면 안 마크** (U054 · 2026-08-31) ─────────────────────────────────

     실측 불일치 넷: `questions`(레일 `archive` ↔ 화면 `notebook`) · `mistakes`(`bandage` ↔
     `alert`) · `ledger`(레일 `grid` ↔ 히어로 `notebook` ↔ 빈 상태 `file` — **한 화면에 셋**) ·
     그중 하나는 2026-08-29 트리가 **맞던 짝을 새로 깼다**. 접힘 레일은 라벨이 없어 자리를
     마크로 외우는 것이 설계 전제라(`RailSidebar`), 화면 안이 다른 마크를 보이면 그 전제가
     되돌려진다. 셋 다 `glyphOf(<탭키>)` 로 로스터에서 파생하게 고쳤다.

     ⛔⛔ **소스 스캔으로 이 방향을 잠그려다 접었다 — 두 번 다 검사가 규약과 어긋났다.**
     ① 「feature 안의 모든 `glyph=` 리터럴 금지」 → 안쪽 카드·페이저의 마크(`chevronLeft`·
        `sleep`·`flame`)까지 신고한다. 그건 화면의 정체성이 아니라 그 요소의 뜻이다.
     ② 「로스터의 마크를 쓰는데 자기 탭의 것이 아니면 위반」 → **35건**이 나왔고 대부분
        정당했다(`refresh`·`inbox`·`check` 같은 **일반 동사**가 어쩌다 어떤 탭의 마크이기도 한
        것뿐이다). 여기서 필요한 판정은 «이 마크가 **화면 전체를 대표**하는가» 인데, 그건
        구조가 아니라 의미라 `State` 호출 하나만 봐서는 못 가른다.
     → **거짓 양성 35건짜리 게이트는 도입 2주 안에 무력화된다**(오버레이 §0-B 가 못박은 형태).
       그래서 이 방향은 잠그지 않고, 아래 **단사성**만 잠근다 — 그쪽은 로스터 안에서 닫히므로
       판정이 구조적이다. 남은 방향은 원장 항목으로 열어 둔다(`U089`).
     ⚠ 「단사성 0건」을 «마크가 안 갈린다» 로 읽지 마라 — 재는 것은 레일 안이다. */
  it('같은 레일 섹션 안에서 두 화면이 같은 마크를 쓰지 않는다 — 접힘 레일은 마크가 유일 단서다', () => {
    const 충돌: string[] = [];
    for (const g of navGroups()) {
      const 표 = new Map<string, string[]>();
      for (const t of g.tabs) 표.set(t.icon, [...(표.get(t.icon) ?? []), t.key]);
      for (const [icon, keys] of 표) if (keys.length > 1) 충돌.push(`${g.key}: ${icon} ← ${keys.join(', ')}`);
    }
    /* ⚠ `scaffold-tab.mjs` 의 기본 아이콘이 `file`(= `subject` 의 것)이라 `/새탭` 을 `--icon`
       없이 돌리면 **중복이 자동 생산된다** — 그래서 이 검사가 그 기본값의 짝이다. */
    expect(충돌.sort(), '접힘 레일(라벨 없음)에서 두 줄이 구분되지 않는다').toEqual([]);
  });

  it('경로는 전부 SVG 요소로 시작한다(빈 문자열·본문 누락 방지)', () => {
    const bad = Object.entries(ICON_PATHS).filter(([, p]) => !/^<(path|circle|rect|polyline|polygon)\b/.test(p));
    expect(bad.map(([n]) => n)).toEqual([]);
  });
});
