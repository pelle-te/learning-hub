/* ============================================================
   trackedImports — **추적된 검증망 파일의 상대 import 는 추적 파일을 가리킨다**(C073 · 2026-09-02).

   왜: 2026-09-01 커밋 `2905fb3` 이 `test/ledgerRules.test.ts`·`e2e/a11y.spec.ts` 를 실었는데, 둘이
   import 하는 `scripts/ledger-rules.mjs` 는 **미추적**으로 남았다. 로컬은 작업트리에 파일이 있어
   전량 초록이었고, HEAD 를 그대로 클론하면 vitest 가 «모듈 없음»으로 죽는다 — 하루 동안 아무도
   몰랐다(그 사이 master 푸시가 없어 CI 도 그 상태를 못 봤다). 이 저장소가 반복해 물린
   «CI 엔 있는데 로컬엔 없다»의 **역형태**다: 로컬엔 있는데 저장소엔 없다.
   pre-commit 은 **스테이징된 것만** 보므로 스테이징 밖의 짝은 아무 검사도 못 본다. 여기가 그 자리다.

   ⚠ 작업트리가 아니라 **인덱스**(`git ls-files`)가 진실이다 — 파일이 디스크에 있는지는 묻지 않는다.
   ⚠ 별칭(`@/…`)은 안 본다: `src/**` 는 이 검사의 대상이 아니고, 별칭 해석은 tsc 가 진다.
============================================================ */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB = process.cwd();
const 후보확장 = ['', '.ts', '.tsx', '.mjs', '.js', '.d.ts', '.d.mts', '/index.ts', '/index.tsx'];
const IMPORT_RE = /\b(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g;

function 추적파일(): Set<string> {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: WEB, encoding: 'utf8' });
  return new Set(
    out
      .split('\0')
      .filter(Boolean)
      .map((p) => p.replace(/\\/g, '/')),
  );
}

describe('trackedImports — 검증망이 가리키는 짝이 저장소에 있다', () => {
  const 추적 = 추적파일();
  const 대상 = [...추적].filter((p) => /^(test|e2e|e2e-shell)\/.*\.(ts|tsx|mjs)$/.test(p));

  it('분모 — 검증망 파일이 실제로 잡혔다(공허한 초록 방지)', () => {
    expect(추적.size, 'git ls-files 가 비었다 — git 밖에서 돌고 있다').toBeGreaterThan(100);
    expect(대상.length).toBeGreaterThan(50);
  });

  /** 추적 집합 `있음` 기준으로 «가리키는데 없는» import 를 센다 — `{ 본, 없음 }`. */
  function 대조(있음: Set<string>) {
    const 없음: string[] = [];
    let 본 = 0;
    for (const file of 대상) {
      const src = readFileSync(posix.join(WEB.replace(/\\/g, '/'), file), 'utf8');
      for (const m of src.matchAll(IMPORT_RE)) {
        const spec = m[1]!;
        본++;
        const base = posix.normalize(posix.join(posix.dirname(file), spec));
        const 후보 = 후보확장.map((e) => base + e);
        // `./x.js` 로 적고 실물이 `.ts` 인 ESM 관용구도 허용한다.
        if (base.endsWith('.js')) 후보.push(base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx'));
        if (!후보.some((c) => 있음.has(c))) 없음.push(`${file} → ${spec}`);
      }
    }
    return { 본, 없음 };
  }

  it('상대 import 의 대상이 전부 추적 파일이다', () => {
    const { 본, 없음 } = 대조(추적);
    expect(본, '상대 import 가 하나도 안 잡혔다 — 정규식이 죽었다').toBeGreaterThan(50);
    // 실패하면: 그 파일을 **같은 커밋에** 담아라(`git add <경로>`). 지운 것이면 import 를 걷어라.
    expect(없음).toEqual([]);
  });

  it('검출력 자기증명 — 2026-09-01 의 실사고를 되심으면 잡힌다', () => {
    /* `scripts/ledger-rules.mjs` 가 인덱스에 없던 그 상태. 이게 안 걸리면 이 파일은 «검사하는 척»이다. */
    const 그날 = new Set([...추적].filter((p) => p !== 'scripts/ledger-rules.mjs'));
    const { 없음 } = 대조(그날);
    expect(없음).toContain('test/ledgerRules.test.ts → ../scripts/ledger-rules.mjs');
    expect(없음).toContain('e2e/a11y.spec.ts → ../scripts/ledger-rules.mjs');
  });
});
