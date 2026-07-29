/* ============================================================
   syncLedger.test.ts — 원장의 **판정**(E12 · 2026-07-29).

   판정이 lib 에 있는 이유가 곧 이 테스트의 이유다: 폰 헤더와 데스크톱 레일이 같은 조건에서
   말하고 같은 조건에서 침묵해야 한다. 화면이 각자 정하면 두 기기가 다르게 침묵하고,
   그 차이는 아무 데도 안 적힌다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { ledgerLine, type Ledger } from '@/lib/syncLedger';

const NOW = 1_700_000_000_000;
const led = (p: Partial<Ledger>): Ledger => ({ online: true, pending: null, at: null, failed: false, ...p });

describe('ledgerLine — 언제 말하고 언제 침묵하나', () => {
  it('클라우드를 안 붙였으면 통째로 침묵한다 — 이 앱은 클라우드 없이도 완결된다', () => {
    expect(ledgerLine(led({}), NOW)).toBeNull();
  });

  it('⚠ 한 번도 성공한 적 없으면 "방금"이라 하지 않는다 — 원장이 스스로 거짓말하던 자리', () => {
    // at=null 은 "방금"이 아니라 "모른다/아직 없다". 대기도 0이면 말할 것이 없다.
    expect(ledgerLine(led({ pending: 0 }), NOW)).toBeNull();
  });

  it('성공했으면 상대시각으로 조용히 말한다', () => {
    const r = ledgerLine(led({ at: NOW - 3 * 60_000, pending: 0 }), NOW);
    expect(r?.text).toContain('동기화');
    expect(r?.warn).toBe(false); // 평온은 톤을 올리지 않는다
  });

  it('대기가 있으면 눈에 띈다', () => {
    const r = ledgerLine(led({ at: NOW, pending: 3 }), NOW);
    expect(r?.text).toContain('3건 대기');
    expect(r?.warn).toBe(true);
  });

  it('오프라인은 **어디에 저장돼 있는지**를 말한다 — 잃어버렸다고 읽히지 않게', () => {
    const r = ledgerLine(led({ online: false, pending: 5 }), NOW);
    expect(r?.text).toContain('이 기기에 저장');
    expect(r?.warn).toBe(true);
  });

  it('실패는 실패라고 말한다(성공 시각이 있어도 실패가 이긴다)', () => {
    const r = ledgerLine(led({ at: NOW, pending: 2, failed: true }), NOW);
    expect(r?.text).toContain('동기화 실패');
  });

  it('오프라인이어도 **클라우드 미연결이면** 침묵한다 — 붙인 적 없는 것을 실패라 하지 않는다', () => {
    // at·pending 이 다 없다 = 한 번도 붙은 적 없음. 오프라인이라는 사실만으로 말을 만들지 않는다.
    expect(ledgerLine(led({ online: false, pending: null }), NOW)).toBeNull();
  });

  it('대기 수를 모르는 채 오프라인이면 0으로 적되, 판정 입력은 null 을 보존한다(모름 ≠ 없음)', () => {
    const r = ledgerLine(led({ online: false, pending: null, at: NOW - 60_000 }), NOW);
    expect(r?.text).toContain('0건');
    expect(r?.warn).toBe(true);
  });
});
