#!/usr/bin/env node
/* ============================================================
   gate.mjs — **저장소 전체** 품질 게이트 러너(web + server + Rust 셸). 압축 요약만 출력해
   서브에이전트/슬래시 명령이 전체 로그 대신 짧은 통과/실패 보고를 받게 한다.
   사용: cd web && node scripts/gate.mjs [quick]   (quick=verify만 — 그 뒤 전부 생략)
   반환: 전부 통과 exit 0, 실패 exit 1. 첫 실패 단계에서 멈춘다.

   ⚠ **단계 목록을 여기 적지 않는다** — 정본은 아래 `ALL` 배열이고, 손으로 베낀 목록은 표류한다
   (그게 H-23 이 잡은 결함 자체다: 생략 안내 두 줄이 각자 낡아 있었다). 순서만 말하면 `verify` 로
   시작해 싼 신호부터 소진하고, cargo 가 없으면 Rust 단계 전부가 빠진다.

   ⚠ 순서에 계약이 셋 있다: budget·server verify 는 `dist` 를 재므로 **build 뒤**, `e2e:shell` 은
   빌드된 exe 를 검사하므로 **tauri:build 뒤**, 나머지는 **싼 신호부터** 소진한다.

   ⚠⚠ **이 목록이 "완료"의 정의다.** 여기 없는 검사는 사람이 기억해야 하는 검사가 되고, 이 저장소는
   그걸로 세 번 물렸다 — `cargo test`(F6 · 2026-07-31) · `server verify`·`tauri:fmt/clippy`
   (패리티 사고 · 2026-08-01). 셋 다 "CI 엔 있는데 로컬엔 없다"는 같은 형태였다.
============================================================ */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const quick = process.argv.includes('quick');

/* Tauri 셸(1단계~) — Rust 쪽도 게이트에 든다(불변식 I4).
   ⚠ **없으면 건너뛴다**: web 만 만지는 작업까지 Rust 툴체인을 요구하면 게이트가 진입장벽이 된다.
   cargo 가 있는 환경에서는 반드시 돈다(그래야 셸 회귀가 조용히 지나가지 않는다). */
const hasCargo = spawnSync('cargo', ['--version'], { encoding: 'utf8', shell: true }).status === 0;

/* ⚠⚠ **원장이 하나다 — 실행 목록도 생략 안내도 전부 여기서 파생된다**(H-23 · 2026-08-06 감사).

   종전엔 생략 안내가 **손베낌 문자열 두 줄**이었고, 그래서 둘 다 낡아 있었다: quick 안내는
   *"build·budget·e2e 생략"* 이라 적었지만 실제로 빠지는 것은 **여섯**이었고(`audit`·`server verify`
   누락), cargo 안내는 `tauri:fmt`·`tauri:clippy`·`cargo test` 셋이 붙은 뒤로도 옛 3개만 읊었다.
   즉 게이트가 **자기가 안 돈 것을 축소 보고**하고 있었다 — 이 저장소가 문서에서 반복해 물린
   "손으로 베낀 목록은 표류한다"가 게이트 자신에게서 일어난 형태다. → 목록을 데이터로 만든다. */
const ALL = [
  { name: 'verify', args: ['run', 'verify'], mode: 'always' },
  /* SCA 게이트(2026-07-25) — **full 모드에만** 든다. `verify` 안에 넣지 않은 이유는
     레지스트리 네트워크를 타기 때문이다: verify 는 오프라인에서도 돌아야 하는 내부 루프이고,
     거기에 네트워크를 섞으면 비행기 모드에서 게이트가 통째로 죽는다(그러면 사람이 verify 를
     건너뛰기 시작한다 — 게이트를 잃는 가장 흔한 경로). 자리는 여기와 CI 다. */
  { name: 'audit', args: ['run', 'audit'], mode: 'full' },
  /* ⚠⚠ **`server audit` 이 빠져 있었고, 빠뜨린 근거가 성립하지 않았다**(2026-08-06 실측).

     종전 주석은 _"`audit` 과 같은 이유(네트워크)이고, 그쪽 원장은 비어 있는 상태를 유지하는 것이
     목표라 **CI 가 그 축을 쥔다**"_ 였다. 두 절 다 틀렸다:
     ① 네트워크는 **가르는 근거가 못 된다** — 바로 윗줄 `audit` 이 이미 네트워크를 타고 full 에 있다.
     ② "CI 가 쥔다"가 실제로 뜻한 것은 **아무도 안 본다**였다. 이 잡은 5일간(2026-08-01~06)
        한 번도 안 돌았고, 다시 돌린 첫 실행에서 `undici` high 5건으로 즉시 빨간불이었다 —
        그동안 로컬 게이트는 `RESULT: ✅ all green` 을 찍고 있었다.

     이 저장소는 같은 형태에 **세 번째** 물린 것이다(`cargo test` · `server verify`·`tauri:fmt/clippy`).
     매번 진단이 같다: **"CI 엔 있는데 로컬엔 없다"는 곧 "아무 데도 없다"가 된다.**
     ⚠ 자리가 `audit` 바로 뒤인 것은 규율 그대로다 — 같은 종류의 신호를 붙여 둔다. */
  { name: 'server audit', args: ['run', 'audit', '--prefix', '../server'], mode: 'full' },
  { name: 'build', args: ['run', 'build'], mode: 'full' },
  { name: 'budget', args: ['run', 'budget'], mode: 'full' },
  /* ⚠⚠ **`server verify` 가 어떤 로컬 게이트에도 없었다**(2026-08-01 `/감사 근본` · 패리티 사고).
     2026-07-20 감사가 *"server 게이트를 빼먹지 말 것 — 인터넷에 노출되고 인증·입력검증을 다루는
     유일한 층인데 CI 도 로컬도 안 돌고 있었다"* 를 발견해 **CI 에** 넣었는데, **로컬에는 끝내
     안 들어왔다.** 그리고 그 CI 잡은 2026-07-19 이후 상시 빨간불이었다(C2) — 즉 고쳤다고 적힌
     뒤로도 그 층은 **양쪽 어디에서도 검증되지 않았다.** 같은 진단이 두 번 반복된 것이 요점이다.
     ⚠ 자리가 `build` **뒤**인 것은 계약이다 — `server/test/assets.test.ts` 가 `../web/dist` 를
       진짜 miniflare 로 재므로(그 파일이 "없으면 시끄럽게 실패한다"고 적어 뒀다) 빌드가 선행이다.
     ⚠ `server audit` 은 위에 따로 있다(2026-08-06 에 편입 — 그 자리 주석이 근거를 갖는다). */
  { name: 'server verify', args: ['run', 'verify', '--prefix', '../server'], mode: 'full' },
  { name: 'e2e', args: ['run', 'e2e'], mode: 'full' },
  /* ⚠⚠ **Rust 린트가 사실상 무게이트였다**(2026-08-01 `/감사 근본` · 패리티 사고). `tauri:fmt`·
     `tauri:clippy` 는 **CI 에만** 있었고 그 CI 잡은 13일·8런 연속 빨간불이었다(C2) — 두 조건이
     겹쳐 clippy 경고가 몇 주째 아무 데서도 안 읽혔다. web 쪽은 `lint` 가 `verify` 안에 있는데
     Rust 만 그 대칭이 없던 것이고, 이유는 설계가 아니라 **누락**이다.
     ⚠ 자리가 `tauri:check` 앞인 것은 싼 신호부터 소진하는 이 블록의 규율 그대로다(fmt 는 초,
       clippy 는 check 와 같은 분석을 공유한다). */
  { name: 'tauri:fmt', args: ['run', 'tauri:fmt', '--prefix', '..'], mode: 'cargo' },
  { name: 'tauri:clippy', args: ['run', 'tauri:clippy', '--prefix', '..'], mode: 'cargo' },
  /* `tauri:check` 만으로는 **부족하다**(설계 §6): 컴파일만 보므로 번들·설정 오류를 못 잡는다.
     실제로 1단계에서 `cargo check` 가 녹색인데 `tauri build` 가 WiX 코드페이지로 죽었고,
     그건 **번들 단계에서만** 나타났다. 그래서 `tauri:build` 까지 돌린다. */
  { name: 'tauri:check', args: ['run', 'tauri:check', '--prefix', '..'], mode: 'cargo' },
  /* ⚠⚠ **`cargo test` 가 게이트 밖이었다(F6 · 2026-07-31 `/감사 근본`).**

     이 블록은 cargo 가 있으면 `tauri:build`(수 분 · 번들까지)와 트랙 B(앱 기동)를 돌리면서
     **실물 통합 83개를 3.6초에 도는 `cargo test` 는 안 돌렸다.** 가장 비싼 Rust 단계를 넣고
     가장 싼 단계를 뺀 역전이고, CI 는 이미 돌리고 있었다(로컬↔CI 비대칭). CLAUDE.md 는
     "완료 판정은 `npm run gate`" 라 적으면서 세 줄 뒤에 "gate 가 cargo test 를 안 돌려준다"고
     경고하는 상태였다 — 경고로 메우던 구멍을 게이트로 옮긴다.

     ⚠ 자리는 `tauri:check` **뒤, `tauri:build` 앞**이다: 컴파일이 깨졌으면 테스트도 못 돌고,
     테스트가 깨졌으면 수 분짜리 번들을 만들 이유가 없다(싼 신호부터 소진). */
  { name: 'cargo test', args: ['run', 'tauri:test', '--prefix', '..'], mode: 'cargo' },
  { name: 'tauri:build', args: ['run', 'tauri:build', '--prefix', '..'], mode: 'cargo' },
  /* 트랙 B(`e2e:shell`)는 **빌드된 exe 를 검사 대상으로 삼으므로 반드시 `tauri:build` 뒤**다 —
     순서가 뒤집히면 옛 exe 를 검사해 "통과"가 거짓이 된다. */
  { name: 'e2e:shell', args: ['run', 'e2e:shell'], mode: 'cargo' },
];

const 실행가능 = (s) => s.mode === 'always' || (!quick && (s.mode === 'full' || (s.mode === 'cargo' && hasCargo)));
const steps = ALL.filter(실행가능);
const 생략 = ALL.filter((s) => !실행가능(s)).map((s) => ({
  name: s.name,
  why: quick ? 'quick' : 'cargo 없음',
}));

/* ⚠⚠ **게이트가 비밀 하나를 말없이 요구하고 있었다**(2026-08-06 · W9 실측).

   `tauri.conf.json` 에 업데이터 공개키가 있으면 `tauri build` 는 **개인키를 환경변수로 요구**하고,
   없으면 _"A public key has been found, but no private key"_ 로 죽는다. 그런데 게이트는 그 변수를
   안 넘겼다 → `npm run gate` 는 **환경을 손으로 준비한 사람에게만** 통과했고, 그 준비 절차는
   `docs/릴리스.md` 안에 있어 게이트를 도는 사람이 볼 이유가 없는 자리였다.
   이 저장소가 반복해 물린 형태 그대로다: **"완료의 정의"가 문서 밖 지식에 의존한다.**

   → 이미 설정된 값이 있으면 존중하고, 없으면 **gitignore 된 로컬 키 파일**에서 읽는다. 키가 없는
     환경(CI·새 클론)은 종전과 똑같이 실패한다 — 없는 키를 만들어 내지는 않는다.
   ⚠ 값은 절대 출력하지 않는다(자식 프로세스 env 로만 넘긴다). 키의 성질은 릴리스 문서가 SSOT:
     **재생성 불가 · 유출되면 업데이트 사칭 · 잃으면 영구히 배포 불가.** */
const env = { ...process.env };
if (!env.TAURI_SIGNING_PRIVATE_KEY) {
  const keyPath = new URL('../../src-tauri/.updater-key', import.meta.url);
  if (existsSync(keyPath)) {
    env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(keyPath, 'utf8').trim();
    env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= '';
  }
}

const results = [];
for (const { name, args } of steps) {
  const r = spawnSync('npm', args, { cwd: process.cwd(), encoding: 'utf8', shell: true, env });
  const ok = r.status === 0;
  /* ⚠ **증상 한 줄이 아니라 원인까지 담는다**(F6 · 2026-08-01 `/감사 근본`). 종전엔 `/error|fail/`
     **첫 매칭 줄**만 200자로 잘랐다 — 그건 거의 항상 *증상*(`test failed`)이고 진짜 원인(panic
     사유·`Cannot find module`·assertion 본문)은 그 아래 줄에 있어 통째로 버려졌다. 실제로 C2 의
     독립 원인 3개가 이 요약기를 통과하며 하나로 뭉개졌다.
     → 매칭 줄을 **최대 3개**까지, 중복을 접어서 싣는다.

     ⚠⚠ **통과 줄을 먼저 버린다.** 넓히자마자 물렸다(같은 날 실측): 이 저장소의 테스트 *제목*에
     `error` 가 들어간다(`ledger · error · dark` 등) → 러너의 **`ok` 줄**이 매칭돼 실패 보고가
     "통과한 테스트 이름 셋"이 됐다. 즉 넓히는 것만으로는 나빠질 수 있다 — 필터는 *어느 줄이
     원인인가*를 알아야 하고, 최소한 **통과 표시로 시작하는 줄은 원인이 아니다**.

     ⚠⚠⚠ **그리고 그 필터는 자기 저장소의 스크립트를 못 읽었다**(H-7 · 2026-08-06 감사). 어휘가
     `error|fail|panic|✗|✘` 인데 이 저장소의 자체 게이트들은 **다른 글자로 실패한다**:
     `bundle-budget.mjs` 는 `❌`·`OVER`, prettier(`format:check`)는 `[warn]`, knip 은 `Unused …`.
     → `FAIL budget` 이 **이유 0글자**로 나왔고, 실패할 때마다 사람이 손으로 재현해야 했다
     (= 요약기가 존재 이유를 잃는 지점). 어휘는 *실패를 만드는 쪽*에서 정해지므로 여기 원장이
     그것을 따라가야 한다 — 새 게이트 스크립트를 만들면 그 실패 마커를 이 목록에 추가할 것. */
  let firstErr = '';
  if (!ok) {
    const out = `${r.stdout || ''}\n${r.stderr || ''}`;
    const hits = [];
    for (const l of out.split('\n')) {
      /* 통과 줄 — 제목에 error 가 있어도 원인이 아니다.
         ⚠ **기호 뒤에 `\b` 를 쓰면 안 된다**(2026-08-06 실측): `✓`·`√`·`✗` 는 비단어 문자라
         뒤에 공백이 오면 단어 경계가 성립하지 않아 `/(ok|✓)\b/` 가 ` ✓ …` 를 **못 걸렀다**.
         즉 2026-08-01 에 "통과 줄을 먼저 버린다"로 적힌 이 가드는 vitest 의 `✓` 줄에 대해
         한 번도 작동한 적이 없다 — 낱말에만 `\b` 를 걸고 기호는 문자군으로 뺀다. */
      if (/^\s*(?:[✓√]|(?:ok|passed|PASS)\b)/i.test(l)) continue;
      if (!/\b(error|fail(ed)?|panic(ked)?|unused|assertionerror)\b|✗|✘|❌|^\s*×|\bOVER\b|\[warn\]/i.test(l)) continue;
      const t = l.trim().replace(/\s+/g, ' ').slice(0, 200);
      if (t && !hits.includes(t)) hits.push(t);
      if (hits.length === 3) break;
    }
    firstErr = hits.join(' ‖ ');
  }
  results.push({ name, ok, firstErr });
  if (!ok) break; // 첫 실패에서 중단
}

const allOk = results.every((r) => r.ok);
console.log('=== GATE ===');
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.firstErr ? '  — ' + r.firstErr : ''}`);
}
/* 생략 안내 — 위 `ALL` 원장에서 파생된다(손으로 적지 않는다 · H-23). */
if (생략.length) {
  console.log(`(생략 ${생략.length}/${ALL.length} [${생략[0].why}] — ${생략.map((s) => s.name).join(' · ')})`);
  if (!quick) console.log('  셸을 만졌다면 Rust 툴체인 환경에서 재실행할 것.');
}

/* ⚠⚠ **`✅ all green` 을 부분 실행에 찍지 않는다**(H-23 · 2026-08-06 감사).
   종전엔 `quick`(1/12 단계)에서도, cargo 없는 환경(6/12)에서도 같은 문구가 나왔다 — CLAUDE.md 가
   *"완료 판정은 `npm run gate`(full)"* 이라 못박는데 그 판정 문구가 **부분 실행과 구분되지 않았다.**
   호출자(슬래시 명령·서브에이전트)는 요약만 읽으므로, 이 한 줄이 곧 "됐다"의 전부다. */
console.log(
  !allOk
    ? 'RESULT: ❌ 위 실패 참조'
    : 생략.length
      ? `RESULT: ⚠ 통과(${results.length}/${ALL.length} 단계) — **완료 판정 아님**(위 생략 참조)`
      : 'RESULT: ✅ all green',
);
process.exit(allOk ? 0 : 1);
