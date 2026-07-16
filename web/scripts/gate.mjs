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
if (!quick) steps.push(['build', ['run', 'build']], ['budget', ['run', 'budget']], ['e2e', ['run', 'e2e']]);

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
console.log(allOk ? 'RESULT: ✅ all green' : 'RESULT: ❌ 위 실패 참조');
process.exit(allOk ? 0 : 1);
