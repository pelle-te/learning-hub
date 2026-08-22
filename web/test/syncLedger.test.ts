/* ============================================================
   syncLedger.test.ts — 원장의 **판정**(E12 · 2026-07-29).

   판정이 lib 에 있는 이유가 곧 이 테스트의 이유다: 폰 헤더와 데스크톱 레일이 같은 조건에서
   말하고 같은 조건에서 침묵해야 한다. 화면이 각자 정하면 두 기기가 다르게 침묵하고,
   그 차이는 아무 데도 안 적힌다.
============================================================ */
import { describe, expect, it } from 'vitest';
import {
  attemptFailed,
  blockedReason,
  ledgerLine,
  okAt,
  STALE_DAYS,
  staleDaysOf,
  type Ledger,
  type SyncAttempt,
} from '@/lib/syncLedger';

const NOW = 1_700_000_000_000;
const led = (p: Partial<Ledger>): Ledger => ({
  online: true,
  pending: null,
  at: null,
  failed: false,
  blocked: null,
  staleDays: null, // O008 — 「모른다」가 기본. 「0일」이 아니다
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

/* ============================================================
   ⭐ **«성공했는가»의 판정** (O009 · 2026-08-22 운영 축)

   이 세 함수가 lib 으로 올라온 이유가 곧 이 블록의 이유다. `syncController._lastSync` 는
   **«시도» 기록**이라 `disconnected` 가 아닌 모든 결과에 세워지는데, `CloudCard` 가 그것을
   그대로 «마지막 동기화» 로 그려서 **몇 주째 아무것도 못 받는 기기가 「방금 · 최신」**이라
   말했다. `useSyncLedger` 는 같은 질문에 옳게 답하고 있었다 — 즉 판정이 store 안에 갇혀
   있어서 두 번째 소비자가 자기 판정을 다시 지은 것이다(R3).

   ⚠ 아래 «blocked 인데 status 는 ok» 케이스가 핵심이다. `runSyncOnce` 는 push 가 막혀도
   pull 이 되면 `'ok'` 를 돌려주므로, 바깥 status 만 보면 중단이 통째로 안 보인다.
============================================================ */
const 시도 = (result: SyncAttempt['result']): SyncAttempt => ({ at: NOW, result });

describe('okAt / blockedReason — 시도를 성공으로 읽지 않는다(O009)', () => {
  it('완전히 성공했을 때만 시각을 준다', () => {
    expect(okAt(시도({ status: 'ok' } as SyncAttempt['result']))).toBe(NOW);
    expect(blockedReason(시도({ status: 'ok' } as SyncAttempt['result']))).toBeNull();
  });

  it('⚠⚠ push 가 막혔으면 바깥 status 가 ok 여도 성공이 아니다 — CloudCard 가 틀렸던 자리', () => {
    const ls = 시도({ status: 'ok', push: { status: 'blocked', error: '기기가 폐기됨' } } as SyncAttempt['result']);
    expect(okAt(ls), '시도 시각을 성공 시각으로 그리면 「방금 · 최신」이 나온다').toBeNull();
    expect(blockedReason(ls)).toBe('기기가 폐기됨');
  });

  it('⚠ pull 축의 중단은 **바깥** status 로 온다(H5) — 아웃박스가 비어 있을 때의 형태다', () => {
    const ls = 시도({ status: 'blocked', error: 'D1 일일 한도' } as SyncAttempt['result']);
    expect(okAt(ls)).toBeNull();
    expect(blockedReason(ls)).toBe('D1 일일 한도');
  });

  it('사유를 안 주면 「알 수 없는 이유」 — 중단을 침묵으로 만들지 않는다', () => {
    expect(blockedReason(시도({ status: 'blocked' } as SyncAttempt['result']))).toBe('알 수 없는 이유');
  });

  it('실패는 중단과 다르다 — 실패는 다음 시도에 스스로 낫는다', () => {
    const ls = 시도({ status: 'failed', error: '네트워크' } as SyncAttempt['result']);
    expect(attemptFailed(ls)).toBe(true);
    expect(blockedReason(ls), '실패를 중단으로 읽으면 「사람이 손대야 한다」는 거짓말이 된다').toBeNull();
    expect(okAt(ls)).toBeNull();
  });

  it('시도가 아예 없으면 전부 null/false — 「모른다」와 「없다」를 가른다', () => {
    expect(okAt(null)).toBeNull();
    expect(blockedReason(null)).toBeNull();
    expect(attemptFailed(null)).toBe(false);
  });
});

/* ============================================================
   ⭐ **「언제부터」** (O008 · 2026-08-22 운영 축)

   `syncController._lastSync` 는 모듈 지역 상태라 재시작하면 0 이다. 그래서 3주째 실패 중인
   기기가 앱을 껐다 켜면 첫 시도 실패 → «동기화 실패 — 다음 시도에 다시 올려요» 이고, 그
   문장은 **첫 실패와 글자 하나 다르지 않았다.** 며칠 만에 아는가: **영원히 모른다.**
   처방은 새 발명이 아니라 **볼트 백업(`_lastBackupAt` + 7일 임계 + 「무엇을 잃나」)을
   동기화에 베낀 것**이다(R3 · 짝).
============================================================ */
describe('staleDaysOf / 경과 문구 — 「방금 한 번」과 「3주 연속」을 가른다(O008)', () => {
  const 하루 = 86_400_000;

  it('성공 기록이 없으면 null — 「모른다」를 「0일」로 꾸미지 않는다', () => {
    expect(staleDaysOf(null, NOW)).toBeNull();
  });

  it('경과를 일 단위로 내림한다 — 미래 시각도 음수가 되지 않는다', () => {
    expect(staleDaysOf(NOW - 3.9 * 하루, NOW)).toBe(3);
    expect(staleDaysOf(NOW, NOW)).toBe(0);
    expect(staleDaysOf(NOW + 하루, NOW), '시계가 뒤로 튀어도 음수 일수를 그리지 않는다').toBe(0);
  });

  it('⚠⚠ 임계를 넘으면 「다음 시도에 다시 올려요」를 말하지 않는다 — 그건 자기치유의 함의다', () => {
    const line = ledgerLine(led({ failed: true, staleDays: STALE_DAYS }), NOW);
    expect(line?.text).toContain(`${STALE_DAYS}일째`);
    expect(line?.text).not.toContain('다음 시도');
    expect(line?.warn).toBe(true);
  });

  it('임계 아래면 기존 문구 그대로 — 하루 이틀 실패는 실제로 스스로 낫는다', () => {
    expect(ledgerLine(led({ failed: true, staleDays: STALE_DAYS - 1 }), NOW)?.text).toBe(
      '동기화 실패 — 다음 시도에 다시 올려요',
    );
  });

  it('경과를 모르면 기존 문구 그대로 — 없는 사실을 지어내지 않는다', () => {
    expect(ledgerLine(led({ failed: true, staleDays: null }), NOW)?.text).toBe('동기화 실패 — 다음 시도에 다시 올려요');
  });

  it('⚠ 중단이 경과를 이긴다 — 중단은 사유를 알고 경과는 사유를 모른다', () => {
    expect(ledgerLine(led({ failed: true, staleDays: 30, blocked: '기기 폐기됨' }), NOW)?.text).toContain(
      '동기화 중단',
    );
  });

  it('⚠ 오래됐어도 **실패하지 않았으면** 말하지 않는다 — 오래 안 켠 앱은 고장이 아니다', () => {
    // 성공 기록이 오래됐지만 이번 시도가 실패하지 않았다면(예: 아직 안 돌았다) 이 문구는 안 나온다.
    expect(ledgerLine(led({ failed: false, staleDays: 30, pending: 0 }), NOW)).toBeNull();
  });
});
