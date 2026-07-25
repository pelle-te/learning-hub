#!/usr/bin/env node
/* ============================================================
   gate.mjs — web 품질 게이트 러너. verify(+build·budget·e2e)를 돌려 압축 요약만 출력.
   서브에이전트/슬래시 명령이 전체 로그 대신 짧은 통과/실패 보고를 받게 한다.
   사용: cd web && node scripts/gate.mjs [quick]   (quick=verify만, build·budget·e2e 생략)
   반환: 전부 통과 exit 0, 실패 exit 1. 첫 실패 단계에서 멈춘다.
   full 모드는 번들 예산(bundle-budget)도 검증한다(감사 #25: CI에만 있던 예산 게이트를
   로컬 완료 판정에 배선 — budget은 dist를 재므로 build가 선행).
============================================================ */
import { spawnSync } from 'node:child_process';

const quick = process.argv.includes('quick');
const steps = [['verify', ['run', 'verify']]];
/* SCA 게이트(2026-07-25) — **full 모드에만** 든다. `verify` 안에 넣지 않은 이유는
   레지스트리 네트워크를 타기 때문이다: verify 는 오프라인에서도 돌아야 하는 내부 루프이고,
   거기에 네트워크를 섞으면 비행기 모드에서 게이트가 통째로 죽는다(그러면 사람이 verify 를
   건너뛰기 시작한다 — 게이트를 잃는 가장 흔한 경로). 자리는 여기와 CI 다. */
if (!quick)
  steps.push(
    ['audit', ['run', 'audit']],
    ['build', ['run', 'build']],
    ['budget', ['run', 'budget']],
    ['e2e', ['run', 'e2e']],
  );

/* Tauri 셸(1단계~) — Rust 쪽도 게이트에 든다(불변식 I4).
   ⚠ **없으면 건너뛴다**: web 만 만지는 작업까지 Rust 툴체인을 요구하면 게이트가 진입장벽이 된다.
   cargo 가 있는 환경에서는 반드시 돈다(그래야 셸 회귀가 조용히 지나가지 않는다).

   `tauri:check` 만으로는 **부족하다**(설계 §6): 컴파일만 보므로 번들·설정 오류를 못 잡는다.
   실제로 1단계에서 `cargo check` 가 녹색인데 `tauri build` 가 WiX 코드페이지로 죽었고,
   그건 **번들 단계에서만** 나타났다. 그래서 `tauri:build` 까지 돌린다.
   그리고 트랙 B(`e2e:shell`)는 **빌드된 exe 를 검사 대상으로 삼으므로 반드시 그 뒤**다 —
   순서가 뒤집히면 옛 exe 를 검사해 "통과"가 거짓이 된다. */
const hasCargo = spawnSync('cargo', ['--version'], { encoding: 'utf8', shell: true }).status === 0;
if (!quick && hasCargo) {
  steps.push(
    ['tauri:check', ['run', 'tauri:check', '--prefix', '..']],
    ['tauri:build', ['run', 'tauri:build', '--prefix', '..']],
    ['e2e:shell', ['run', 'e2e:shell']],
  );
}

const results = [];
for (const [name, args] of steps) {
  const r = spawnSync('npm', args, { cwd: process.cwd(), encoding: 'utf8', shell: true });
  const ok = r.status === 0;
  let firstErr = '';
  if (!ok) {
    const out = `${r.stdout || ''}\n${r.stderr || ''}`;
    const line = out.split('\n').find((l) => /\b(error|fail(ed)?|✗|✘)\b/i.test(l));
    firstErr = (line || '').trim().replace(/\s+/g, ' ').slice(0, 200);
  }
  results.push({ name, ok, firstErr });
  if (!ok) break; // 첫 실패에서 중단
}

const allOk = results.every((r) => r.ok);
console.log('=== GATE ===');
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.firstErr ? '  — ' + r.firstErr : ''}`);
}
if (quick) console.log('(quick 모드 — build·budget·e2e 생략)');
else if (!hasCargo)
  console.log('(cargo 없음 — tauri:check·tauri:build·e2e:shell 생략. 셸을 만졌다면 Rust 툴체인 환경에서 재실행할 것)');
console.log(allOk ? 'RESULT: ✅ all green' : 'RESULT: ❌ 위 실패 참조');
process.exit(allOk ? 0 : 1);
