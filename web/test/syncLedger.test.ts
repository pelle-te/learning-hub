/* ============================================================
   syncLedger.test.ts — 원장의 **판정**(E12 · 2026-07-29).

   판정이 lib 에 있는 이유가 곧 이 테스트의 이유다: 폰 헤더와 데스크톱 레일이 같은 조건에서
   말하고 같은 조건에서 침묵해야 한다. 화면이 각자 정하면 두 기기가 다르게 침묵하고,
   그 차이는 아무 데도 안 적힌다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { ledgerLine, type Ledger } from '@/lib/syncLedger';

const NOW = 1_700_000_000_000;
const led = (p: Partial<Ledger>): Ledger => ({
  online: true,
  pending: null,
  at: null,
  failed: false,
  blocked: null,
  checking: false, // Q-23 — 기본은 "확인 중 아님"(클라우드 미연결이 이 앱의 완결된 상태다)
  ...p,
});

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

/* ⚠⚠ **H3 — 원장이 "올리는 중"을 무한히 말하고 있었다**(2026-07-30 `/감사 근본`).

   `runSyncOnce` 는 push 가 `blocked` 여도 pull 이 되면 `SyncResult.status:'ok'` 를 돌려준다.
   그런데 blocked 는 워터마크를 전진시키지 않으므로 대기 건수가 영원히 안 줄고, 원장은
   `waiting` 분기에 걸려 _"올리는 중 — N건 대기"_ 를 계속 말했다. "올리는 중"은 곧 끝난다는
   뜻인데 실제로는 사람이 손대기 전까지 아무 일도 안 일어난다 — 관측이 오히려 오해를 만든 자리다. */
describe('ledgerLine — 중단(blocked)은 스스로 낫지 않는다', () => {
  it('⚠ "올리는 중"이 아니라 **중단**이라고 말한다 — 대기 건수만으로는 구분이 안 된다', () => {
    const r = ledgerLine(led({ at: NOW, pending: 3, blocked: 'D1 한도 초과' }), NOW);
    expect(r?.text).toContain('중단');
    expect(r?.text).toContain('D1 한도 초과');
    expect(r?.text, '"올리는 중"으로 읽히면 사용자는 기다리기만 한다').not.toContain('올리는 중');
    expect(r?.warn).toBe(true);
  });

  it('편집이 **어디 있는지**를 함께 말한다 — 중단이 곧 유실이라고 읽히지 않게', () => {
    const r = ledgerLine(led({ pending: 7, blocked: '기기가 폐기됨' }), NOW);
    expect(r?.text).toContain('7건');
    expect(r?.text).toContain('이 기기에 남아');
  });

  it('⚠ 오프라인보다 **먼저**다 — 오프라인은 스스로 낫고 중단은 안 낫는다', () => {
    const r = ledgerLine(led({ online: false, pending: 2, blocked: '인증 만료' }), NOW);
    expect(r?.text, '오프라인으로 덮으면 사용자는 네트워크 복귀만 기다린다').toContain('인증 만료');
    expect(r?.text).not.toContain('오프라인');
  });

  it('⚠ 실패인데 대기가 0이면 **건수를 말하지 않는다** — 0건 대기는 사실이 아니라 잡음이다', () => {
    const r = ledgerLine(led({ failed: true, pending: 0 }), NOW);
    expect(r?.text).toContain('동기화 실패');
    expect(r?.text).not.toContain('0건');
    // 대기가 있으면 여전히 건수를 말한다(그때는 사실이다).
    expect(ledgerLine(led({ failed: true, pending: 4 }), NOW)?.text).toContain('4건');
  });

  it('중단이 아니면 종전 판정을 한 글자도 안 바꾼다', () => {
    expect(ledgerLine(led({ at: NOW, pending: 3 }), NOW)?.text).toContain('올리는 중');
    expect(ledgerLine(led({}), NOW)).toBeNull();
  });
});

/* ── Q-23 첫 확인 ────────────────────────────────────────────────────────────
   ⚠ 우선순위가 이 케이스들의 내용이다. `checking` 은 blocked **아래**(중단은 스스로 안 낫는다)
   이고 오프라인 **아래**(확인이 시작조차 못 한다)다. 그 순서를 틀리면 원장이 스스로 낫지 않는
   상태를 "곧 끝난다"로 덮는데, 그건 H3 이 잡은 거짓 위로와 정확히 같은 형태다. */
describe('Q-23 첫 확인 표식', () => {
  it('확인 중은 말할 것이 있다 — 종전엔 이 상태가 통째로 침묵했다', () => {
    expect(ledgerLine(led({ checking: true }), NOW)?.text).toContain('확인 중');
    expect(ledgerLine(led({ checking: true }), NOW)?.warn).toBe(false);
    // 짝: 클라우드를 안 붙였으면 같은 입력에서 여전히 침묵한다.
    expect(ledgerLine(led({ checking: false }), NOW)).toBeNull();
  });

  it('중단·오프라인이 확인 중을 이긴다', () => {
    expect(ledgerLine(led({ checking: true, blocked: 'D1 한도 초과' }), NOW)?.text).toContain('동기화 중단');
    expect(ledgerLine(led({ checking: true, online: false, pending: 2 }), NOW)?.text).toContain('오프라인');
  });
});
