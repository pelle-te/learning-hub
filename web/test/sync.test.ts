/* ============================================================
   sync.test.ts — 멀티탭 동기화 pub/sub(BroadcastChannel 없는 환경에서도 로컬 경로는 동작).
   정책(미저장 편집 우선 채택)은 useApp이 소유 — 여기선 전송 계약만 검증한다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { announce, onSync, type SyncMsg } from '@/lib/sync';

const tick = () => new Promise<void>((r) => queueMicrotask(r));

describe('sync — announce/onSync', () => {
  it('alsoLocal=true면 같은 탭 구독자에게 비동기로 전달된다', async () => {
    const got: SyncMsg[] = [];
    const off = onSync((m) => got.push(m));
    announce({ kind: 'local' }, true);
    expect(got).toEqual([]); // 동기 재진입 setState 방지 — 마이크로태스크 이후 전달
    await tick();
    expect(got).toEqual([{ kind: 'local' }]);
    off();
  });
  it('alsoLocal 기본(false)이면 같은 탭에는 전달되지 않는다(BC는 발신 탭 미배달)', async () => {
    const got: SyncMsg[] = [];
    const off = onSync((m) => got.push(m));
    announce({ kind: 'app' });
    await tick();
    expect(got).toEqual([]);
    off();
  });
  it('구독 해지 후에는 받지 않는다', async () => {
    const got: SyncMsg[] = [];
    const off = onSync((m) => got.push(m));
    off();
    announce({ kind: 'app' }, true);
    await tick();
    expect(got).toEqual([]);
  });
  it('구독자 하나가 던져도 다른 구독자는 받는다', async () => {
    const got: SyncMsg[] = [];
    const off1 = onSync(() => {
      throw new Error('boom');
    });
    const off2 = onSync((m) => got.push(m));
    announce({ kind: 'local' }, true);
    await tick();
    expect(got).toEqual([{ kind: 'local' }]);
    off1();
    off2();
  });
});
