/* ============================================================
   adherence.test.ts — 적응형 용량 한 줄(P-5).

   잠그는 것은 수가 아니라 **문장의 순서**다. 이 줄의 위험은 틀리는 것이 아니라 *같은 사실을
   반대로 읽히게* 하는 것이다 — 하락을 앞세우면 죄책감 계기판이 되고, 그건 이 줄이 하려는
   일의 정반대다(방향 §2 (d)).
============================================================ */
import { describe, expect, it } from 'vitest';
import { adherenceLine } from '@/lib/adherence';
import { ADAPT_WINDOW } from '@/lib/scheduler/priority';

describe('적응형 용량 한 줄', () => {
  it('안 깎였으면 말할 것이 없다(0·평온은 아무것도 안 그린다)', () => {
    expect(adherenceLine(1, false)).toBeNull();
    expect(adherenceLine(0.7, false)).toBeNull(); // applied 가 정본이다
    expect(adherenceLine(1, true)).toBeNull(); // 계수가 1이면 깎인 것이 없다
    expect(adherenceLine(undefined, true)).toBeNull();
  });

  it('계수를 사람 말로 읽는다 — 지어낸 수가 없다', () => {
    const a = adherenceLine(0.7, true)!;
    expect(a.cutPct).toBe(30);
    expect(a.ratePct).toBe(70); // 계수 자체가 (실제 ÷ 계획)이다
    expect(a.line).toContain(`최근 ${ADAPT_WINDOW}일`);
  });

  /* ⚠⚠ 이 케이스가 이 모듈의 존재 이유다. 문장은 **앱이 이미 조정했다**로 시작해야 하고
     "당신이 70%밖에 못 했다"로 시작하면 안 된다. */
  it('⚠ 순서: 조정 사실 → 근거 → 회복 조건', () => {
    const a = adherenceLine(0.5, true)!;
    const iCut = a.line.indexOf('줄여 뒀어요');
    const iWhy = a.line.indexOf('했기 때문');
    const iRecover = a.line.indexOf(a.recover);
    expect(iCut).toBeGreaterThanOrEqual(0);
    expect(iWhy).toBeGreaterThan(iCut);
    expect(iRecover).toBeGreaterThan(iWhy);
  });

  it('회복 조건이 반드시 들어간다 — 되돌릴 길 없는 하락 통보는 만들지 않는다', () => {
    expect(adherenceLine(0.6, true)!.line).toContain('자동으로 풀려요');
  });

  it('바닥(0.5)에서도 문장이 성립한다', () => {
    const a = adherenceLine(0.5, true)!;
    expect(a.cutPct).toBe(50);
    expect(a.ratePct).toBe(50);
  });
});
