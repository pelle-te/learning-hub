/* ============================================================
   docsFacts.test.ts — **살아 있는 안내가 하는 사실 주장을 기계가 대조한다**(V092·V093 · 2026-09-01).

   ## 왜 생겼나 — 규약 축 1회차의 근본 원인 R1

   규약 축을 처음 판 회차가 잰 것: 살아 있는 안내의 사실 주장 **858건**(경로 329 · 수 424 ·
   `npm run` 105) 중 **기계가 검사하는 것이 0건**이었다. `.md` 를 읽는 테스트·스크립트·CI 스텝이
   저장소에 **하나도 없었다.** 그 회차가 닫은 36건 중 **아홉이 「그 줄 자신이 그러지 말라고
   경고하는 자리」**에서 났다:

   · `CLAUDE.md:53` 은 _"목록을 손으로 베끼면 이렇게 드리프트한다 — 정본은 `package.json` 이다"_
     를 달아 둔 채 **두 번째로** 낡았다(`compiler:ratchet` 25일 · `test:tz` 9일 누락).
   · `아키텍처.md:45` 는 _"없는 훅은 다시 만들어진다"_ 를 달아 둔 채 훅 다섯을 빠뜨렸다.
   · `아키텍처.md:82` 는 _"새 스토어를 만들면 여기 한 줄을 함께 넣는다"_ 를 달아 둔 채 셋을 빠뜨렸다.
   · `knip.jsonc:44` 는 _"사문화된 예외가 남는 경로가 정확히 이것이다"_ 를 적어 둔 채 **자기 세
     번째 항목이 사문**이었다.

   ⭐ **결론 한 줄: 경고문은 집행자가 아니다.** 규율을 산문으로 적는 것과 기계에 거는 것 사이의
   간극이 그 축의 전부였고, 이 파일이 그 간극의 첫 조각이다.

   ## ⛔ 무엇을 하지 않는가 — 전량 생성 금지

   원장 `V092` 가 못박은 제약: **문서 전체를 코드에서 생성하지 않는다.** 그러면 산문이 밀려나고,
   이 저장소의 문서가 값을 내는 이유(«왜 이렇게 했나»의 서술)가 통째로 사라진다. 여기서 잠그는
   것은 **문서가 코드를 가리켜 놓고 그 코드가 없는 경우** 뿐이다 — 즉 «틀렸다»가 기계적으로
   판정되는 부류만. 「그 설명이 옳은가」는 사람의 일로 남는다.

   ## 어느 문서를 보는가 — 「살아 있는 안내」

   ⚠ **아카이브·회차 산출물은 제외한다**(`제외` 참조). 그것들은 **그 시점의 스냅샷**이라
   낡는 것이 정상이다 — `리뷰/2026-08-20-코드/대장.md` 는 그날 실재한 파일 목록이고, 그 뒤
   은퇴한 `graph/`·`mastery/` 가 거기 남아 있는 것은 결함이 아니라 기록이다. 실측하면 그 부류가
   **미실재 경로의 90%**(62 중 56)이고, 안 걷어내면 이 검사는 태어나는 순간 빨간불이라
   `.skip` 이 붙는다(= 게이트를 잃는 가장 흔한 경로).

   ## 왜 유닛인가

   `workspacePaths.test.ts`(V040)와 같은 자리·같은 근거다. 문서가 **틀리는 순간**이 「사람이
   `.md` 를 고칠 때」이고, 그때 그 사람이 도는 것이 `npm run verify` 다. 그리고 이건 부모
   워크스페이스도 네트워크도 안 타므로 **CI 에서도 그대로 돈다**(V040 과 달리 skip 이 없다).
   ⚠ 다만 훅은 종전에 `^web/` 만 봤다 — 문서 수정이 게이트를 한 번도 안 지나갔다(`V094`).
============================================================ */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const HUB = join(import.meta.dirname, '..', '..');
const WEB = join(HUB, 'web');

/* ⚠ 아카이브·회차 산출물 — **그 시점의 스냅샷이라 낡는 것이 정상이다**(머리주석 참조).
   ⛔ 여기에 「고치기 귀찮은 문서」를 넣지 마라. 기준은 하나다: **그 문서가 「지금」을 주장하는가.** */
const 제외 = [
  '원장-아카이브', // 닫힌 항목 — 닫힐 당시의 사실
  '로드맵.md', // 2026-08-20 아카이브(672 KiB)
  '평가기록', // 채점 회차 기록
  '리뷰', // `docs/리뷰/**` — 회차 산출물(대장·리포트·스캔)
  '_아카이브',
  'node_modules',
  '.git',
  'target',
  'dist',
];

function 문서들(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (제외.some((x) => e.name.includes(x))) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) 문서들(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

const 문서 = 문서들(HUB).map((p) => ({ path: p.slice(HUB.length + 1), text: readFileSync(p, 'utf8') }));

/* ── ① 명령 실재 (V093) ───────────────────────────────────────────────────────
   ⚠ **실행하지 않는다 — 존재만 본다.** 실행은 게이트의 일이고, 여기서 막으려는 것은
   «안내가 가리키는 명령이 아예 없는» 부류다. 도입 시점 실측은 **36종 36 통과**였다.
   그 100%는 «보장»이 아니라 **우연**이었다 — 이 케이스가 그것을 보장으로 바꾼다. */
/** 산문의 **자리표시자** — 실재를 주장하는 이름이 아니다. 사유 없는 면제는 방치다. */
const 명령면제: Record<string, string> = {
  X: '`판례.md:111` — `npm run X 2>&1 | tail -6` 처럼 **아무 단계나**를 뜻하는 자리표시자다(대문자 한 글자).',
};

function 스크립트전량(): Set<string> {
  const s = new Set<string>();
  for (const p of ['package.json', 'web/package.json', 'server/package.json']) {
    const j = JSON.parse(readFileSync(join(HUB, p), 'utf8')) as { scripts?: Record<string, string> };
    for (const k of Object.keys(j.scripts ?? {})) s.add(k);
  }
  return s;
}

/* ── ② 경로 실재 ─────────────────────────────────────────────────────────────
   ⚠ **저장소 루트 기준 경로만 본다.** `src/db.rs`·`test/roundtrip.test.ts` 같은 상대 경로는
   «어느 폴더 기준인가»가 문서마다 달라 판정이 안 선다 — 도입 회차에 그 셋을 전부 루트 기준으로
   고쳤다(그게 이 제약의 처방이다). 새 문서도 루트 기준으로 적어라. */
const 루트접두 = ['web/', 'src-tauri/', 'server/', '.github/', '.husky/'];

/* ⚠⚠ **정규식은 유니코드다(`/u` + `\p{L}`).** 처음엔 `\w` 로 썼는데 그건 `[A-Za-z0-9_]` 뿐이라
   **이 저장소 경로의 상당수를 원리적으로 못 봤다** — `web/docs/원장.md`·`web/docs/판례.md`·
   `web/scripts/…` 의 한글 파일명이 전부 그물 밖이었다. 되심기에서 잡혔다(한글 표본을 심었더니
   **초록**이었다). ⭐ 그 자체가 이 저장소의 규율을 한 번 더 증명한다: **되심기가 초록이면
   「관대하다」가 아니라 「표본이 틀렸다」거나 「검사기의 단위가 좁다」를 먼저 의심하라.** */

/** 없는 것을 **일부러** 가리키는 자리 — 사유 없는 면제는 방치다. */
const 경로면제: Record<string, string> = {
  'src-tauri/src/rows.rs':
    '`cloudflare-런북.md:379` — 5단계-C 가 이식했다가 서버가 TS 가 되며 근거가 사라진 파일. **과거형 서술**이고, 그 문단의 요점이 「없어졌다」이다.',
  'server/src/syncHub.ts':
    '`cloudflare-런북.md:739` — 그 줄이 **「가 없고」라고 말하는 자리**다(I051 은퇴). 없다는 것을 적은 문장을 「경로가 없다」로 잡으면 부재를 기록할 수 없게 된다.',
  'web/src/lib/artifactMirror.ts':
    '`클라우드전환-설계.md:799` — **2026-09-01 에 이 검사가 처음 잡은 것**이다(P10 W4 `9b3edd7` 삭제). 문단은 판단의 선례로 남기고 「지금 없다」를 명시했으므로, 이름이 남는 것이 정상이다.',
  'src-tauri/src/server.rs':
    '`클라우드전환-설계.md:396` — 그 줄이 **「지운 것」 목록**이다(5단계-A LAN 뷰 서버 은퇴 · 845줄). 삭제 기록에서 삭제된 이름이 나오는 것은 정상이다.',
};

/* ── ③ `ds-*` 실재 ───────────────────────────────────────────────────────────
   ⚠⚠ **이 검사가 `V056` 의 부류다.** 디자인시스템 §4-1 **철칙**이 _"그 컴포넌트가
   `className="ds-card"` 를 두른다"_ 라 지시했는데 **그 클래스는 존재하지 않았다**(선언 0 ·
   소스 참조 0 · `ds.css:159` 가 «은퇴했다»라 적는다). 철칙을 문자 그대로 따르면 **아무 스타일도
   안 붙고 게이트는 전량 녹색**이다 — 그냥 문자열이라 stylelint 에도 `check:tokens` 에도 안 걸린다.
   그 사각을 메우는 자리가 여기다. */
const DS면제: Record<string, string> = {
  'ds-card':
    '`디자인시스템.md:118~161` — V056 이 남긴 **부고**다. 「존재하지 않는다」를 적은 문장이라 이름이 나오는 것이 정상이고, 지우면 다음 회차가 같은 오지시를 되살린다.',
  'ds-canvas': '`디자인시스템.md:130` — D6 이 삭제한 넷째 레지스터의 부고(정의만 있고 소비처 0이었다).',
  'ds-fadeUp':
    '`클라우드전환-설계.md:1495` — C-7 이행 서술의 **과거형**이다(옛 `ds.module` 의 키프레임을 Tailwind 유틸에서 못 불러 키프레임을 옮긴 경위). 지금의 모션 어휘는 `lib/motion.ts` 가 진다.',
  'ds-muted':
    '`디자인시스템.md:19~21` — 2026-08-02 **디밍 실측의 인용**이고, 그 줄 자신이 「이 수는 낡았다(실측 2)」를 함께 적는다. P-16 이 `text-mut` 로 통합하며 걷었다.',
};

describe('문서의 사실 주장 — 기계 대조 (V092·V093)', () => {
  it('살아 있는 안내 문서를 실제로 찾았다 (공허한 초록 방지)', () => {
    /* ⚠ 분모가 0 이면 아래 셋이 전부 «위반 0» 으로 초록이 된다. 2026-09-01 실측 26. */
    expect(문서.length).toBeGreaterThanOrEqual(15);
    expect(문서.map((d) => d.path)).toContain('CLAUDE.md');
    expect(문서.map((d) => d.path)).toContain('README.md');
  });

  it('① 안내가 가리키는 `npm run <스크립트>` 가 전부 실재한다', () => {
    const 있음 = 스크립트전량();
    const 위반: string[] = [];
    for (const { path, text } of 문서) {
      for (const m of text.matchAll(/npm run ([\p{L}\p{N}][\p{L}\p{N}:_-]*)/gu)) {
        if (!있음.has(m[1]) && !명령면제[m[1]]) 위반.push(`${path} → npm run ${m[1]}`);
      }
    }
    // 실패하면: 스크립트 이름이 바뀌었거나 지워졌다. 문서를 고치거나 스크립트를 되살리세요.
    expect(위반).toEqual([]);
  });

  it('② 안내가 가리키는 저장소 경로가 전부 실재한다 (또는 사유 있는 면제다)', () => {
    const 위반: string[] = [];
    for (const { path, text } of 문서) {
      for (const m of text.matchAll(/`([\p{L}\p{N}_./-]+)`/gu)) {
        const 경로 = m[1].replace(/[.,;]+$/, '');
        if (!루트접두.some((a) => 경로.startsWith(a))) continue;
        if (경로.includes('*') || !/\.\w+$/.test(경로)) continue; // 글롭·디렉터리는 이 축이 아니다
        if (경로면제[경로]) continue;
        if (!existsSync(join(HUB, 경로))) 위반.push(`${path} → ${경로}`);
      }
    }
    // 실패하면: 파일이 옮겨졌거나 지워졌다. 문서를 고치거나, 일부러 부재를 적은 것이면 `경로면제` 에 **사유와 함께** 올리세요.
    expect(위반).toEqual([]);
  });

  it('③ 안내가 지시하는 `ds-*` 클래스가 전부 선언돼 있다 (또는 사유 있는 면제다)', () => {
    const css = readFileSync(join(WEB, 'src/styles/ds.css'), 'utf8');
    const 선언 = new Set([...css.matchAll(/^\s*\.(ds-[\w-]+)/gm)].map((m) => m[1]));
    expect(선언.size).toBeGreaterThan(20); // 공허한 초록 방지
    const 위반: string[] = [];
    for (const { path, text } of 문서) {
      for (const m of text.matchAll(/\b(ds-[a-z][\w-]*)/g)) {
        if (선언.has(m[1]) || DS면제[m[1]]) continue;
        위반.push(`${path} → ${m[1]}`);
      }
    }
    // 실패하면: 그 클래스는 `ds.css` 에 없다. 문서를 고치거나, 부고(«은퇴했다»)라면 `DS면제` 에 사유와 함께 올리세요.
    expect([...new Set(위반)]).toEqual([]);
  });

  it('④ `CLAUDE.md` 의 `verify` 목록이 실제 `verify` 와 일치한다', () => {
    /* ⚠⚠ **이 케이스가 `V042` 의 집행자다.** 그 줄은 «목록을 손으로 베끼면 드리프트한다»는
       경고를 스스로 달아 둔 채 **두 번째로** 낡았다. 경고문은 집행자가 아니다. */
    const verify = (JSON.parse(readFileSync(join(WEB, 'package.json'), 'utf8')) as { scripts: Record<string, string> })
      .scripts.verify;
    const 단계 = [...verify.matchAll(/npm run ([a-z][a-z0-9:_-]*)/g)].map((m) => m[1]);
    expect(단계.length).toBeGreaterThan(5); // 공허한 초록 방지
    const claude = readFileSync(join(HUB, 'CLAUDE.md'), 'utf8');
    /* ⚠⚠ **열거 줄만 본다 — 산문까지 포함하면 「공허한 초록」이 된다.** 처음엔 `npm run verify`
       부터 `npm run audit` 까지를 통째로 슬라이스했는데, 그 사이에 있는 **경고 산문이 같은 단계
       이름을 인용**한다(«`compiler:ratchet`·`test:tz` 가 빠져 있었다»). 그래서 열거에서 지워도
       검사가 통과했다 — 되심기에서 잡혔다(2026-09-01). 열거 줄은 ` + ` 로 항목을 잇는 줄뿐이다. */
    const 줄 = claude.split('\n');
    const i = 줄.findIndex((l) => l.startsWith('npm run verify'));
    expect(i).toBeGreaterThanOrEqual(0);
    const 열거: string[] = [];
    for (let j = i; j < 줄.length && 줄[j].includes(' + '); j++) 열거.push(줄[j]);
    expect(열거.length).toBeGreaterThanOrEqual(1); // 공허한 초록 방지
    const 블록 = 열거.join(' ');
    expect(블록).not.toContain('⚠'); // 산문이 섞이면 이 검사는 무의미해진다
    // 실패하면: `package.json` 의 verify 에 단계가 늘었는데 CLAUDE.md 의 **열거 줄**이 안 따라왔다.
    expect(단계.filter((s) => !블록.includes(s))).toEqual([]);
  });

  it('면제 표가 사문화하지 않았다 — 해소됐는데 남아 있으면 실패 (역래칫)', () => {
    /* ⚠ 이 저장소의 규율: 「판단에 유효기간이 없으면 그건 판단이 아니라 방치다」.
       면제가 해소됐는데 남으면, 그만큼이 다음 결함의 침묵 여유가 된다. */
    for (const 경로 of Object.keys(경로면제)) {
      expect(existsSync(join(HUB, 경로)), `${경로} 는 이제 실재한다 — 경로면제에서 빼라`).toBe(false);
    }
    for (const c of Object.keys(명령면제)) {
      expect(스크립트전량().has(c), `${c} 는 이제 실재하는 스크립트다 — 명령면제에서 빼라`).toBe(false);
    }
    const css = readFileSync(join(WEB, 'src/styles/ds.css'), 'utf8');
    const 선언 = new Set([...css.matchAll(/^\s*\.(ds-[\w-]+)/gm)].map((m) => m[1]));
    for (const c of Object.keys(DS면제)) {
      expect(선언.has(c), `${c} 는 이제 선언돼 있다 — DS면제에서 빼라`).toBe(false);
    }
  });
});
