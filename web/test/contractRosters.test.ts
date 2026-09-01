/* ============================================================
   contractRosters.test.ts — **두 벌로 손유지되는 로스터가 갈리는 것을 잡는다**
   (`V075`·`V076`·`V077` · 2026-09-01 규약 축).

   ## 왜 셋을 한 파일에 두나 — 형태가 같다

   규약 축 1회차의 근본 원인 **R2**: _"「이 검사가 있다」를 안전의 근거로 쓰기 전에 그 검사기의
   `include`/`ignores` 를 열어라"_. 아래 셋은 그 변주다 — **검사는 있는데 방향이 한쪽뿐**이라
   반대쪽으로 갈리면 아무도 모른다.

   ⭐⭐ **셋 다 「오늘은 일치한다」** 이다(도입 시점 실측). 그래서 이 파일은 결함을 고친 것이
   아니라 **갈릴 수 있는 자리를 잠근 것**이고, 그 말은 곧 **되심기 없이는 세웠는지조차 알 수
   없다**는 뜻이다(원장이 `V075`·`V076`·`V077` 에 대해 정확히 그렇게 경고했다). 셋 다
   되심기로 빨간불을 확인했다 — 기록은 `원장-아카이브.md` 2026-09-01.

   ## ⚠ 왜 「생성」이 아니라 「대조」인가

   셋 다 «한쪽에서 다른 쪽을 생성하면 되지 않나»가 떠오르는 자리다. 안 하는 이유가 각각 있다:
   Rust↔codegen 은 **언어가 다르고**(빌드 순서 결합이 생긴다), DDL↔아웃박스는 **DDL 이
   append-only 마이그레이션**이라 현재 형상이 파일 하나에 없으며, 화면 로스터는 **의도적으로
   다른 것**을 담는다(`shell/tabs.ts` 는 도달성 · `e2e/` 는 커버리지). 대조는 그 차이를
   **사유와 함께** 남기게 하고, 생성은 그 차이를 지운다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { OUTBOX_TABLES } from '@/lib/cloud/contract';

const HUB = join(import.meta.dirname, '..', '..');
const WEB = join(HUB, 'web');
const 읽기 = (p: string) => readFileSync(join(HUB, p), 'utf8');

/* ══════════════════════════════════════════════════════════════
   V075 — 산출물 로스터: Rust `ARTIFACTS` ↔ codegen `ARTIFACTS`
   ══════════════════════════════════════════════════════════════
   ⚠⚠ **갈리면 「오지 않을 것을 기다리게 하는 문구」가 뜬다.** codegen 에 이름을 한 줄 넣고
   화면에서 부르면 typecheck·verify·cargo test·트랙 A/B 가 **전량 통과**한다 — 트랙 A 는
   invoke 를 스텁하고 Rust 테스트는 자기 상수만 세기 때문이다. 그리고 런타임에 셸이
   `NOT_FOUND` 를 주면 `artifactState` 가 그것을 **「미생성」**으로 번역하므로, 화면은
   «아직 안 왔다»를 **영원히** 보여 준다. 이 저장소가 반복해 물린 형태다. */
describe('V075 — 산출물 로스터 (Rust ↔ codegen)', () => {
  /** Rust 가 **파일로 읽어 줄 수 있는** 것. `artifact.rs` 의 `ARTIFACTS` 첫 열. */
  function rust산출물(): string[] {
    const s = 읽기('src-tauri/src/artifact.rs');
    const 블록 = s.slice(s.indexOf('const ARTIFACTS'), s.indexOf('];', s.indexOf('const ARTIFACTS')));
    return [...블록.matchAll(/\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
  }
  /** 프런트 타입(`FetchableArtifact`)의 원천. `gen-artifacts.mjs` 의 `ARTIFACTS` 첫 열. */
  function codegen산출물(): string[] {
    const s = readFileSync(join(WEB, 'scripts/gen-artifacts.mjs'), 'utf8');
    const 블록 = s.slice(s.indexOf('const ARTIFACTS = ['), s.indexOf('];', s.indexOf('const ARTIFACTS = [')));
    return [...블록.matchAll(/\[\s*'([a-z_]+)'/g)].map((m) => m[1]);
  }

  /** codegen 에만 있어도 되는 이름 — **사유 없는 면제는 방치다.** */
  const codegen전용: Record<string, string> = {
    index:
      '`index` 는 **셸이 파일로 읽어 주는 것이 아니다** — 볼트 스캔이 이미 들고 온 `_index.json` 을 `lib/vault.ts` 가 `parseArtifact("index", …)` 로 **검증**할 때만 쓰는 스키마다(`lib/api.ts` 머리주석이 그 두 네임스페이스를 가른다). 그래서 Rust `ARTIFACTS` 에 없는 것이 정상이다.',
  };

  it('둘 다 실제로 읽혔다 (공허한 초록 방지)', () => {
    expect(rust산출물().length).toBeGreaterThan(0);
    expect(codegen산출물().length).toBeGreaterThan(0);
  });

  it('Rust 가 읽어 주는 산출물은 전부 codegen 로스터에도 있다', () => {
    const c = new Set(codegen산출물());
    // 실패하면: 셸은 줄 수 있는데 프런트 타입에 없다 → 화면이 그 이름을 부를 수 없다.
    expect(rust산출물().filter((n) => !c.has(n))).toEqual([]);
  });

  it('codegen 에만 있는 이름은 사유가 있다 (없으면 「영원히 미생성」 화면이 된다)', () => {
    const r = new Set(rust산출물());
    const 사유없음 = codegen산출물().filter((n) => !r.has(n) && !codegen전용[n]);
    // 실패하면: 그 이름을 `getArtifact` 로 부르면 런타임에 NOT_FOUND → 화면이 「아직 안 왔다」를 영원히 그린다.
    // 셸에도 넣거나, 정말 다른 네임스페이스면 `codegen전용` 에 **사유와 함께** 올리세요.
    expect(사유없음).toEqual([]);
  });

  it('면제 표가 사문화하지 않았다 (역래칫)', () => {
    const r = new Set(rust산출물());
    for (const n of Object.keys(codegen전용)) {
      expect(r.has(n), `${n} 은 이제 Rust 로스터에도 있다 — codegen전용 에서 빼라`).toBe(false);
    }
  });
});

/* ══════════════════════════════════════════════════════════════
   V076 — 동기화 대상: DDL(`updated_at`) → 아웃박스
   ══════════════════════════════════════════════════════════════
   ⚠⚠ **이 방향을 아무도 안 봤다.** 「이 표는 동기화 대상이다」가 세 곳에 있는데(DDL 의
   `updated_at` · `TABLES.sync`→`OUTBOX_TABLES` · 마이그레이션 테스트의 리터럴) 전부
   **아웃박스 → DDL** 방향만 검증한다. 반대로 새 표에 `updated_at` 을 넣고 `TABLES` 에 안
   넣으면 아웃박스가 그 표를 **한 번도 안 훑는데** 앱은 「동기화 완료」라고 말한다 —
   그 편집은 그 기기 밖으로 **영영** 못 나가고, 사용자는 그것을 알 방법이 없다.
   ⭐ 조용한 데이터 유실이라, 이 파일에서 가장 비싼 축이다. */
describe('V076 — 동기화 대상 (DDL → 아웃박스)', () => {
  /** 마이그레이션 전량을 순서대로 적용한 뒤 **`updated_at` 을 가진 표**. */
  function updatedAt표(): string[] {
    const dir = join(HUB, 'src-tauri', 'migrations');
    const 표 = new Map<string, boolean>();
    for (const f of readdirSync(dir)
      .filter((x) => x.endsWith('.sql'))
      .sort()) {
      const t = readFileSync(join(dir, f), 'utf8');
      for (const m of t.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?\s*\(([\s\S]*?)\);/gi)) {
        표.set(m[1], /updated_at/i.test(m[2]));
      }
      for (const m of t.matchAll(/ALTER\s+TABLE\s+["'`]?(\w+)["'`]?\s+ADD\s+COLUMN\s+updated_at/gi)) 표.set(m[1], true);
      for (const m of t.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?["'`]?(\w+)["'`]?/gi)) 표.delete(m[1]);
      /* ⚠⚠ **RENAME 을 따라가지 않으면 이 검사가 거짓 양성을 낸다**(2026-09-01 되심기에서 잡혔다).
         `009_summaries_identity.sql` 은 `summaries_v9` 를 만들어 데이터를 옮기고 **원본을 지운 뒤
         리네임**한다(C-3 가 키를 `(sid, ord)` → `(sid, id)` 로 옮긴 처방). 리네임을 안 보면
         «`summaries_v9` 라는 미동기화 표가 있다»고 말하는데 **그런 표는 최종 스키마에 없다.**
         ⭐ 여기서 「면제 표에 올린다」로 넘어갈 뻔했다 — 그건 **파서의 결함을 원장에 적어 영구화**
         하는 것이다. 면제는 «사실인데 예외인 것»에 쓰는 것이지 «검사기가 틀린 것»에 쓰는 게 아니다. */
      for (const m of t.matchAll(/ALTER\s+TABLE\s+["'`]?(\w+)["'`]?\s+RENAME\s+TO\s+["'`]?(\w+)["'`]?/gi)) {
        if (표.has(m[1])) {
          표.set(m[2], 표.get(m[1])!);
          표.delete(m[1]);
        }
      }
    }
    return [...표].filter(([, u]) => u).map(([n]) => n);
  }

  /** `updated_at` 이 있어도 아웃박스에 없어도 되는 표 — **사유 없는 면제는 방치다.**
   *  ⭐ 현재 **비어 있다**: 도입 시점 실측에서 `updated_at` 을 가진 표 7개가 `OUTBOX_TABLES` 7개와
   *  정확히 같았다. 비어 있는 것이 정상이고, 채우려면 **왜 이 표의 편집은 기기 밖으로 안 나가도
   *  되는지**를 적어야 한다. */
  const 비동기표: Record<string, string> = {};

  it('마이그레이션을 실제로 읽었다 (공허한 초록 방지)', () => {
    expect(updatedAt표().length).toBeGreaterThan(5);
    expect(OUTBOX_TABLES.length).toBeGreaterThan(5);
  });

  it('`updated_at` 을 가진 표는 전부 아웃박스가 훑는다 (또는 사유 있는 면제다)', () => {
    const 아웃 = new Set(OUTBOX_TABLES.map((t) => t.name));
    const 밖 = updatedAt표()
      .filter((n) => !아웃.has(n) && !비동기표[n])
      .sort();
    // 실패하면: 그 표의 편집은 **이 기기 밖으로 영영 안 나가는데 앱은 「동기화 완료」라고 말한다**.
    // `rows.ts` 의 `TABLES` 에 `sync: true` 로 넣거나, 정말 로컬 전용이면 `비동기표` 에 사유와 함께 올리세요.
    expect(밖).toEqual([]);
  });

  it('면제 표가 사문화하지 않았다 (역래칫)', () => {
    const 있음 = new Set(updatedAt표());
    for (const n of Object.keys(비동기표)) {
      expect(있음.has(n), `${n} 은 더 이상 updated_at 을 가진 표가 아니다 — 비동기표 에서 빼라`).toBe(false);
    }
  });
});

/* ══════════════════════════════════════════════════════════════
   V079 — 도구 로스터: `tools.rs` 의 `TOOLS` → **누를 자리**
   ══════════════════════════════════════════════════════════════
   ⚠⚠ **이 저장소가 이번 달에 두 번 청구한 형태의 짝이다.** `U087`·`U091` 은 *생산자가 사라진
   표면*을 지웠다(숙달도 지도 · 내 길 지도). `V079` 는 **정반대**였다 — 생산자(부모의
   `벌트DB.py`·`지시문평가.py`)도 커맨드도 살아 있는데 **소비처가 없었다**: `TOOLS` 다섯 중
   프런트 호출부가 있는 것은 `ledger-build` 하나였다.

   ⭐ 그래서 처방이 「지운다」가 아니라 「누를 자리를 만든다」였고(사용자 판정 · `ToolsCard`),
   이 검사는 **그 상태가 다시 갈리는 것**을 막는다. 어느 방향으로 갈려도 사람이 모른다:
   커맨드만 늘면 못 누르는 기능이 되고, 화면만 남으면 `NOT_FOUND` 로 죽는다. */
describe('V079 — 도구 로스터 (커맨드 ↔ 누를 자리)', () => {
  function rust도구(): string[] {
    const s = 읽기('src-tauri/src/tools.rs');
    const 블록 = s.slice(s.indexOf('pub const TOOLS'), s.indexOf('];', s.indexOf('pub const TOOLS')));
    return [...블록.matchAll(/^\s{8}"([a-z-]+)",$/gm)].map((m) => m[1]);
  }
  /** 프런트가 실제로 부르는 이름 — `runTool('x')` 리터럴 + `ToolsCard` 의 로스터.
   *  ⚠ `key:`/`label:` 형태는 **`ToolsCard` 안에서만** 센다. 저장소 전체로 넓혔더니
   *  `shell/tabs.ts` 의 탭 로스터(`key: 'ledger', label: '원장'`)가 걸려 **거짓 양성**이 났다
   *  (2026-09-01 도입 중 실측) — 같은 모양의 리터럴이 여러 로스터에 산다. */
  function 호출부(): Set<string> {
    const out = new Set<string>();
    const walk = (dir: string): void => {
      for (const e of readdirSync(join(WEB, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(rel);
        else if (/\.tsx?$/.test(e.name)) {
          for (const m of readFileSync(join(WEB, rel), 'utf8').matchAll(/runTool\(\s*'([a-z-]+)'/g)) out.add(m[1]);
        }
      }
    };
    walk('src');
    const card = readFileSync(join(WEB, 'src/features/settings/ToolsCard.tsx'), 'utf8');
    for (const m of card.matchAll(/\{\s*key:\s*'([a-z-]+)',\s*label:/g)) out.add(m[1]);
    return out;
  }

  it('둘 다 실제로 읽혔다 (공허한 초록 방지)', () => {
    expect(rust도구().length).toBeGreaterThan(0);
    expect(호출부().size).toBeGreaterThan(0);
  });

  it('모든 도구에 누를 자리가 있다', () => {
    const c = 호출부();
    const 밖 = rust도구()
      .filter((t) => !c.has(t))
      .sort();
    // 실패하면: 커맨드는 있는데 **아무도 못 누른다**. `features/settings/ToolsCard.tsx` 의
    // 로스터에 한 줄 넣거나, 정말 필요 없으면 `tools.rs` 의 `TOOLS` 에서 빼세요.
    expect(밖).toEqual([]);
  });

  it('화면이 부르는 도구는 전부 셸에 등록돼 있다 (반대 방향)', () => {
    const r = new Set(rust도구());
    const 없음 = [...호출부()].filter((t) => !r.has(t) && /^(vault|index|ledger|eval)/.test(t));
    // 실패하면: 그 버튼은 런타임에 `NOT_FOUND` 로 죽는다(타입도 게이트도 안 잡는다).
    expect(없음).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════
   V077 — 화면 로스터: `shell/tabs.ts` → 검증망
   ══════════════════════════════════════════════════════════════
   ⚠ 기존 집행자(`invariants.test.ts` 의 「로스터의 모든 뷰가 …」)는 **`role:'view'` 부분집합
   에만** 있었다 — `destination`·`lens`·`object` 는 아무도 안 봤다. 갈리면 `/새탭` 이 배선
   두 곳만 등록하고, `새탭추가.md` 는 _"스냅샷이 **있으면**"_ 이라는 **조건부 산문**이라 신규
   탭에 아무것도 요구하지 않는다 → **새 destination 이 시각 0장 · axe 0회로 게이트를 통과한다.** */
describe('V077 — 화면 로스터 (도달성 → 커버리지)', () => {
  function 탭들(): { key: string; role: string }[] {
    const s = readFileSync(join(WEB, 'src/shell/tabs.ts'), 'utf8');
    return [...s.matchAll(/key:\s*'([a-z-]+)'[\s\S]{0,400}?role:\s*'(\w+)'/g)].map((m) => ({
      key: m[1],
      role: m[2],
    }));
  }
  /** 검증망이 실제로 여는 경로·키 — `_fixtures.TABS` · 모든 `path:` · a11y 의 직접 `goto`. */
  function 커버(): Set<string> {
    const fx = readFileSync(join(WEB, 'e2e/_fixtures.ts'), 'utf8');
    const vs = readFileSync(join(WEB, 'e2e/visual.spec.ts'), 'utf8');
    const ax = readFileSync(join(WEB, 'e2e/a11y.spec.ts'), 'utf8');
    const out = new Set<string>();
    const tb = fx.slice(fx.indexOf('export const TABS'), fx.indexOf('export const A11Y_EXTRA'));
    for (const m of tb.matchAll(/^\s*'([a-z-]+)',/gm)) out.add(m[1]);
    for (const m of (fx + vs + ax).matchAll(/path:\s*['"`]\/([a-z-]+)/g)) out.add(m[1]);
    for (const m of ax.matchAll(/goto\(\s*['"`]\/([a-z-]+)/g)) out.add(m[1]);
    return out;
  }

  it('두 로스터를 실제로 읽었다 (공허한 초록 방지)', () => {
    expect(탭들().length).toBeGreaterThan(10);
    expect(커버().size).toBeGreaterThan(10);
  });

  it('도달 가능한 모든 탭(destination·lens·object)을 검증망이 한 번은 연다', () => {
    const c = 커버();
    const 밖 = 탭들()
      .filter((t) => t.role === 'destination' || t.role === 'lens' || t.role === 'object')
      .filter((t) => !c.has(t.key))
      .map((t) => `${t.key}(${t.role})`)
      .sort();
    // 실패하면: 그 화면은 **시각 0장 · axe 0회**로 게이트를 통과한다.
    // `e2e/_fixtures.ts` 의 `TABS`(또는 `A11Y_EXTRA`)에 넣어라 — `/새탭` 이 그 줄을 안 만든다.
    expect(밖).toEqual([]);
  });
});
