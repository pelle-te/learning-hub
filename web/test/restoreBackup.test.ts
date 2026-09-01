// @vitest-environment jsdom
/* ============================================================
   restoreBackup.test.ts — restoreFromIDB 세대 백업 우선순위(감사 재검증 ⑩#1).
   fallback 부팅 후 첫 flush가 미러를 defaults로 덮으면(유효 JSON) 종전 로직은
   '파싱 성공 = 복구 가능'으로 defaults를 복구했다 — 실데이터 세대 백업이 IDB에
   살아 있는데도. 이제 defaults-동형(무활동) 미러면 백업을 자동 우선한다.
============================================================ */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/shell/toast', () => ({ toast: vi.fn(), toastUndo: vi.fn(), toastUndoable: vi.fn(), ToastHost: () => null }));
vi.mock('@/lib/idb', () => ({
  idbMirror: vi.fn(),
  idbLoad: vi.fn(async () => null),
  idbGet: vi.fn(async () => null),
  idbPut: vi.fn(async () => {}),
  idbDel: vi.fn(async () => {}),
  idbPreserveBackup: vi.fn(async () => {}),
  IDB_BACKUP_KEY: 'state_backup',
  IDB_BACKUP2_KEY: 'state_backup2',
}));

import { toast } from '@/shell/toast';
import { idbGet, idbLoad } from '@/lib/idb';
import { defaults, isPristineState } from '@/lib/persistence';
import { useApp } from '@/store/useApp';
import { restoreFromIDB } from '@/shell/actions';
import type { AppState } from '@/lib/schema';

/** 활동 흔적(완료 기록)이 있는 상태 — marker로 어느 스냅샷이 채택됐는지 판별. */
const active = (marker: string): AppState => {
  const s = defaults() as AppState;
  // ⚠ 부분 픽스처 — 이 케이스는 «그 마커가 남았나»만 본다(V068).
  s.completions[marker] = { 'sub|study': { done: true } as never };
  return s;
};
const adoptedMarker = (m: string): boolean =>
  !!(useApp.getState().state as unknown as { completions: Record<string, unknown> }).completions[m];

beforeEach(() => {
  vi.mocked(toast).mockClear();
  vi.mocked(idbLoad).mockReset();
  vi.mocked(idbLoad).mockResolvedValue(null);
  vi.mocked(idbGet).mockReset();
  vi.mocked(idbGet).mockResolvedValue(null);
  useApp.getState().loadState(defaults());
});

describe('isPristineState — defaults-동형(무활동) 판정', () => {
  it('defaults()는 pristine, 완료 기록 하나만 있어도 아님', () => {
    expect(isPristineState(defaults())).toBe(true);
    expect(isPristineState(active('2026-07-01'))).toBe(false);
  });
});

describe('restoreFromIDB — 세대 백업 우선(⑩#1)', () => {
  it('미러가 defaults-동형이고 실데이터 백업이 있으면 백업을 복구한다', async () => {
    vi.mocked(idbLoad).mockResolvedValue(JSON.stringify(defaults())); // 덮인 미러(유효 JSON)
    vi.mocked(idbGet).mockImplementation(async (k: string) =>
      k === 'state_backup' ? JSON.stringify(active('2026-07-02')) : null,
    );
    await restoreFromIDB();
    expect(adoptedMarker('2026-07-02')).toBe(true);
    expect(String(vi.mocked(toast).mock.calls.at(-1)![0])).toContain('세대 백업');
  });

  it('미러에 활동이 있으면 미러를 그대로 복구한다(백업 조회 불필요)', async () => {
    vi.mocked(idbLoad).mockResolvedValue(JSON.stringify(active('2026-07-03')));
    vi.mocked(idbGet).mockResolvedValue(JSON.stringify(active('2026-07-04')));
    await restoreFromIDB();
    expect(adoptedMarker('2026-07-03')).toBe(true);
    expect(adoptedMarker('2026-07-04')).toBe(false);
  });

  it('1세대가 무활동이면 2세대의 실데이터를 채택한다(링 순회)', async () => {
    vi.mocked(idbLoad).mockResolvedValue(JSON.stringify(defaults()));
    vi.mocked(idbGet).mockImplementation(async (k: string) =>
      k === 'state_backup' ? JSON.stringify(defaults()) : JSON.stringify(active('2026-07-05')),
    );
    await restoreFromIDB();
    expect(adoptedMarker('2026-07-05')).toBe(true);
  });

  it('미러 부재 + 백업이 무활동뿐이어도 복구는 된다(종전 의미론 무회귀)', async () => {
    vi.mocked(idbGet).mockImplementation(async (k: string) =>
      k === 'state_backup' ? JSON.stringify(defaults()) : null,
    );
    await restoreFromIDB();
    expect(String(vi.mocked(toast).mock.calls.at(-1)![0])).toContain('세대 백업');
  });
});
