/* ============================================================
   visits.test.ts — 방문 원장의 **분류 규칙**(N-11).

   SQL 자체(기본키·인덱스·동기화 배제)는 `dbMigrations.test.ts` 가 실제 SQLite 로 잠근다.
   여기서 잠그는 것은 그 위의 유일한 로직 — **힌트를 언제 믿는가**다. 이게 틀리면 표는
   가득 차는데 값이 거짓이 되고, 거짓 관측은 관측 없음보다 나쁘다(데이터가 있다는 이유로
   더 자신 있게 틀린 결정을 내린다).
============================================================ */
import { describe, expect, it, beforeEach } from 'vitest';
import { markVia, takeVia, resetVia } from '../src/lib/visits';

beforeEach(() => resetVia());

describe('진입 경로 힌트', () => {
  it('힌트가 없으면 폴백이다 — 누락은 오분류이지 유실이 아니다', () => {
    expect(takeVia('link')).toBe('link');
  });

  it('힌트는 1회용이다 — 한 번 누른 것이 두 번 세어지면 안 된다', () => {
    markVia('rail');
    expect(takeVia('link')).toBe('rail');
    expect(takeVia('link')).toBe('link');
  });

  /* ⚠ 이 케이스가 실제 오염을 막는다. 같은 경로를 다시 클릭하면 라우터가 리렌더를 안 하고,
     그 자리에 남은 `rail` 힌트가 **다음** 내비게이션(본문 링크일 수 있다)에 붙는다. */
  it('낡은 힌트는 버린다 — 내비게이션 없이 남은 값이 다음 이동을 오염시킨다', () => {
    const t0 = 1_000_000;
    markVia('rail', t0);
    expect(takeVia('link', t0 + 5_000)).toBe('link');
  });

  it('유효 시간 안이면 그대로 쓴다', () => {
    const t0 = 1_000_000;
    markVia('palette', t0);
    expect(takeVia('link', t0 + 500)).toBe('palette');
  });

  it('나중 힌트가 앞선 힌트를 덮는다(마지막 의도가 이긴다)', () => {
    markVia('rail');
    markVia('key');
    expect(takeVia('link')).toBe('key');
  });
});
