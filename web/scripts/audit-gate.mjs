#!/usr/bin/env node
/* ============================================================
   audit-gate.mjs — 알려진 취약점(SCA) 게이트.
   사용: node scripts/audit-gate.mjs [--allowlist <경로>] [--level high|critical]
   반환: 미허용 취약점이 하나라도 있으면 exit 1.

   ## 왜 이 파일이 생겼나 (2026-07-25 감사)

   이 저장소의 공급망 방어는 두 축이 이미 있었다 — **gitleaks**(시크릿이 새는가)와
   **의존성 갱신 봇**(의존성이 낡는가 · 2026-08-22 에 Renovate → Dependabot). 그런데 그 사이에
   축이 하나 비어 있었다: **알려진 CVE 가
   들어와도 CI 가 통과시킨다.** 실측 시점에 web 14건·server 4건이 전부 high 였고, 그중
   `react-router` 는 **사용자에게 실제로 배포되는** 의존성이다. 아무 게이트도 그걸 안 봤다.

   ## ⚠ `npm audit fix --force` 를 쓰지 않는다 — **다운그레이드**이기 때문

   실측(2026-07-25): 남은 14건 전부 `fixAvailable` 이 **현재보다 낮은 버전**을 가리킨다
   (`react-router-dom@7.11.0` ← 현재 7.18.1 · `vite-plugin-pwa@1.2.0` ← 현재 1.3.0).
   즉 **상향 픽스가 존재하지 않는다.** `--force` 를 돌리면 취약점 대신 기능 회귀를 산다.
   그래서 이 게이트의 출력은 "고쳐라"가 아니라 **"판단하고 기록하라"** 다.

   ## 왜 그냥 무시하지 않는가 — 원장에 **만료일**이 있다

   `--audit-level=high` 한 줄이면 CI 는 오늘 당장 빨간불이고, 사람은 그걸 끄려고 `|| true`
   를 붙인다(그게 이 부류 게이트의 표준 실패 모드다). 그렇다고 그냥 빼면 원래 상태로 돌아간다.
   여기선 셋째 길을 쓴다 — **허용은 하되 `재검토` 날짜를 달고, 그날이 지나면 게이트가 깨진다.**
   판단이 영구 면제가 되지 않는 유일한 방법이다. stylelint·번들 예산·커버리지 임계를 도입한
   근거("규약을 관습에 두면 흘러내린다")와 정확히 같은 논리다.

   ## 세 가지 실패 조건 — 전부 "조용히 흘러내리는 길"을 막는다

   ① **미등록 취약점** — 새 CVE 가 들어오면 즉시 실패. 이게 게이트의 본체다.
   ② **만료된 허용** — `재검토` 가 지났는데 아직 있으면 실패. 판단의 유효기간을 강제한다.
   ③ **죽은 허용 항목** — 취약점이 사라졌는데 원장에 남아 있으면 실패. 원장이 실제 상태와
      갈라지면 읽는 사람이 오도되고, 다음 사람이 "이건 원래 있던 거겠지" 하고 넘긴다.
      knip 이 미사용 export 에서 깨지는 것과 같은 이유다(**역래칫**).

   ## ⚠ `verify` 에 넣지 않았다 — 자리는 `gate.mjs`(full) 와 CI 다

   `verify` 는 오프라인에서도 도는 **내부 루프**다. 여기에 레지스트리 네트워크를 섞으면
   비행기 모드·망 장애에서 verify 가 통째로 죽고, 그러면 사람이 verify 를 건너뛰기 시작한다 —
   게이트를 잃는 가장 흔한 경로다. 대신 `npm run gate`(full)와 CI 두 곳에 둔다.
   ⚠ 그래서 `npm run verify` 가 녹색이어도 SCA 는 안 본 것이다. 완료 판정은 `gate` 로 한다.

   ## ⚠ 이 스크립트는 `server/` 도 쓴다 — 사본을 만들지 말 것

   `server/package.json` 의 `audit` 스크립트가 `../web/scripts/audit-gate.mjs` 를 부른다.
   이 저장소는 `rows.ts` ↔ `rows.rs` 로 **두 번** divergence 에 물렸고, `server/src/index.ts`
   가 `web/src/lib/cloud/schema.ts` 를 직접 import 하는 것도 같은 이유다. 원장(JSON)만 패키지
   별로 갖고 로직은 하나를 공유한다.
============================================================ */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
/* ⚠ `lastIndexOf` 다 — **뒤에 온 것이 이긴다**. `npm run audit -- --allowlist X` 는 package.json
   에 박힌 인자 *뒤에* 사용자 인자를 붙이므로, 앞을 집으면 덮어쓰기가 조용히 무시된다
   (음성 테스트가 통과해 버려 게이트가 실패하는 걸 확인할 방법이 없어진다 — 실제로 물렸다). */
const argOf = (name, fallback) => {
  const i = argv.lastIndexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const ALLOWLIST = resolve(process.cwd(), argOf('--allowlist', 'audit-allowlist.json'));
const LEVEL = argOf('--level', 'high');
/* 심각도 사다리 — 임계 이상만 게이트 대상. moderate 이하를 넣지 않는 이유는
   신호 대 노이즈다(sonarjs 를 recommended 없이 규칙 2개만 켠 것과 같은 판단). */
const RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const MIN = RANK[LEVEL] ?? RANK.high;

/* `npm audit` 은 취약점이 있으면 **exit 1** 이다 — 그건 오류가 아니라 결과다.
   그래서 실패를 삼키고 stdout 만 읽는다. 진짜 오류(네트워크·레지스트리)는 stdout 이
   JSON 이 아닌 것으로 드러나므로 아래 파싱에서 걸린다. */
function runAudit() {
  try {
    /* ⚠ Windows 에서 npm 을 부르는 방법이 지뢰밭이라 근거를 적어 둔다(셋 다 실측했다):
       · `execFileSync('npm', …)` → ENOENT. `npm` 은 실행파일이 아니라 `npm.cmd` 배치다.
       · `execFileSync('npm.cmd', …)` → **EINVAL**. Node 20+ 가 CVE-2024-27980 대응으로
         shell 없는 `.cmd` 실행을 막았다.
       · `shell: true` → 돌긴 하지만 DEP0190 경고를 뿜는다. 게이트가 경고를 뿜으면 진짜
         신호가 묻히므로 최후 수단으로만 둔다.

       정답은 넷째다: **npm 이 스크립트에 넘겨주는 `npm_execpath`**(= npm-cli.js 의 경로)를
       현재 Node 로 직접 실행한다. 배치파일을 거치지 않으니 셸도 경고도 없다. 이 게이트의
       실사용 경로(`npm run audit`)에서는 항상 이 분기를 탄다. */
    const viaNpm = process.env.npm_execpath;
    const opts = { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 };
    if (viaNpm && viaNpm.endsWith('.js')) {
      return execFileSync(process.execPath, [viaNpm, 'audit', '--json'], opts);
    }
    // 직접 `node scripts/audit-gate.mjs` 로 부른 경우의 폴백.
    return execFileSync('npm', ['audit', '--json'], { ...opts, shell: process.platform === 'win32' });
  } catch (e) {
    if (typeof e.stdout === 'string' && e.stdout.trim().startsWith('{')) return e.stdout;
    console.error('❌ npm audit 실행 실패 — 네트워크·레지스트리 접근을 확인하세요.');
    console.error(e.stderr || e.message);
    process.exit(2);
  }
}

let report;
try {
  report = JSON.parse(runAudit());
} catch {
  console.error('❌ npm audit 출력이 JSON 이 아닙니다(레지스트리 오류일 가능성).');
  process.exit(2);
}

const vulns = report.vulnerabilities ?? {};

/* 원장이 없으면 **빈 원장**으로 본다 — 파일이 없다는 이유로 통과시키면 게이트가
   "설정을 지우면 꺼지는" 물건이 된다. */
let allow = [];
try {
  const parsed = JSON.parse(readFileSync(ALLOWLIST, 'utf8'));
  allow = Array.isArray(parsed.허용) ? parsed.허용 : [];
} catch {
  console.log(`ℹ 허용목록 없음(${ALLOWLIST}) — 전건을 미등록으로 본다.`);
}

const today = new Date().toISOString().slice(0, 10);
const byPkg = new Map(allow.map((a) => [a.패키지, a]));

/** 텍스트에서 GHSA id 를 뽑는다(대문자 정규화). 원장의 `권고` 는 "GHSA-… — 제목" 형태다. */
const ghsaIn = (text) =>
  new Set((String(text ?? '').match(/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/gi) ?? []).map((s) => s.toUpperCase()));
/** npm audit 항목이 실제로 걸고 있는 GHSA 집합(`via` 의 권고 객체 url 에서). */
const ghsaOf = (v) =>
  new Set(
    (v.via ?? [])
      .filter((x) => typeof x !== 'string')
      .flatMap((x) => [...ghsaIn(x.url)])
      .map((s) => s.toUpperCase()),
  );

const 미등록 = [];
const 만료 = [];
const 허용중 = [];

for (const [name, v] of Object.entries(vulns)) {
  if ((RANK[v.severity] ?? 0) < MIN) continue;
  const entry = byPkg.get(name);
  if (!entry) {
    미등록.push({ name, sev: v.severity, via: (v.via ?? []).filter((x) => typeof x !== 'string') });
    continue;
  }
  entry.__seen = true;
  /* 필수 필드 검사 — 사유 없는 허용은 허용이 아니라 방치다. */
  if (!entry.사유 || !entry.재검토) {
    미등록.push({ name, sev: v.severity, via: [], note: '원장 항목에 사유/재검토 누락' });
    continue;
  }
  /* ⚠⚠ **권고 id 대조**(2026-08-01 `/감사 근본`). 위까지의 매칭은 **패키지명 하나**였다 — 즉
     같은 패키지에 **새 CVE** 가 뜨면 옛 항목의 사유·재검토일 아래로 **조용히 흡수**된다. 사유는
     특정 취약점의 도달 가능성을 논증한 것이지 그 패키지에 대한 영구 면죄부가 아닌데, 기계는
     그 둘을 구분하지 못했다. 사문화·사유노후를 사람이 눈으로 잡아야 했던 한 계열이 여기서
     기계 검출로 내려온다.
     ⚠ 실제 권고에 GHSA 가 없으면(전이 재노출은 `via` 가 패키지명 문자열뿐이다) 대조할 것이
     없으므로 자연히 통과한다 — 그 경우는 뿌리 항목이 자기 GHSA 로 이미 검사받는다. */
  const 새권고 = [...ghsaOf(v)].filter((g) => !ghsaIn(entry.권고).has(g));
  if (새권고.length) {
    미등록.push({
      name,
      sev: v.severity,
      via: [],
      note: `원장에 없는 **새 권고** ${새권고.join(', ')} — 기존 사유(${entry.권고 ?? '권고 미기재'})는 이 취약점을 논증하지 않는다. 새로 판단해 항목을 갱신할 것.`,
    });
    continue;
  }
  if (entry.재검토 < today) 만료.push({ name, sev: v.severity, due: entry.재검토 });
  else 허용중.push({ name, sev: v.severity, due: entry.재검토, scope: entry.범위 ?? '?' });
}

/* ③ 죽은 항목 — 취약점이 사라졌는데 원장에 남은 것(역래칫). */
const 사문 = allow.filter((a) => !a.__seen).map((a) => a.패키지);

console.log(`\n▸ SCA 게이트 (임계 ${LEVEL}+ · ${process.cwd()})`);
const m = report.metadata?.vulnerabilities ?? {};
console.log(`  감사 결과: critical ${m.critical ?? 0} · high ${m.high ?? 0} · moderate ${m.moderate ?? 0}`);

if (허용중.length) {
  console.log(`\n  허용중(${허용중.length}) — 재검토일까지 통과:`);
  for (const a of 허용중) console.log(`    · ${a.name} [${a.sev}/${a.scope}] → 재검토 ${a.due}`);
}

let fail = false;

if (미등록.length) {
  fail = true;
  console.error(`\n  ❌ 미등록 취약점 ${미등록.length}건 — 원장(${ALLOWLIST})에 판단을 기록하세요:`);
  for (const u of 미등록) {
    const urls = u.via
      .map((x) => x.url)
      .filter(Boolean)
      .join(' ');
    console.error(`    · ${u.name} [${u.sev}] ${u.note ?? ''} ${urls}`);
  }
  console.error(
    `\n     기록 형식: { "패키지": "<이름>", "심각도": "high", "범위": "prod|dev",\n` +
      `                  "사유": "왜 지금 이 위험을 수용하는가(도달 가능성 근거)",\n` +
      `                  "재검토": "YYYY-MM-DD" }\n` +
      `     ⚠ 상향 픽스가 있으면 원장에 적지 말고 **올리세요**. 원장은 픽스가 없을 때만 쓰는 도구입니다.`,
  );
}

if (만료.length) {
  fail = true;
  console.error(`\n  ❌ 재검토 기한 경과 ${만료.length}건 — 다시 판단하고 날짜를 갱신하거나 해소하세요:`);
  for (const e of 만료) console.error(`    · ${e.name} [${e.sev}] 기한 ${e.due} (오늘 ${today})`);
}

if (사문.length) {
  fail = true;
  console.error(`\n  ❌ 사문화된 허용 항목 ${사문.length}건 — 취약점이 사라졌습니다. 원장에서 지우세요:`);
  for (const n of 사문) console.error(`    · ${n}`);
}

if (fail) process.exit(1);
console.log('\n  ✅ 통과 — 미등록·만료·사문 항목 없음.\n');
