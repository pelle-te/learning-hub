// @vitest-environment jsdom
/* ============================================================
   bootRecovery.test.tsx — 부팅 복구 안내(BootRecovery) 회귀.
   부팅이 기본값으로 떨어졌고 IDB 미러가 유효할 때만 '복구하기' 토스트가 뜨고,
   정상 부팅·미러 없음에선 절대 뜨지 않는다.
============================================================ */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

vi.mock('@/shell/toast', () => ({ toast: vi.fn(), toastUndo: vi.fn(), ToastHost: () => null }));
vi.mock('@/lib/idb', () => ({ idbMirror: vi.fn(), idbLoad: vi.fn() }));

import { toast } from '@/shell/toast';
import { idbLoad } from '@/lib/idb';
import { memKV } from '@/lib/kv';
import { boot, defaults, persist } from '@/lib/persistence';
import BootRecovery from '@/app/BootRecovery';

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.mocked(toast).mockClear();
  vi.mocked(idbLoad).mockReset();
});

describe('BootRecovery — IDB 미러 복구 안내', () => {
  it('폴백 부팅 + 유효한 IDB 미러 → 복구하기 액션 토스트(warn·long)', async () => {
    boot(memKV()); // 저장본 없음 → 폴백 마커 세팅
    vi.mocked(idbLoad).mockResolvedValue(JSON.stringify(defaults()));
    render(<BootRecovery />);
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    const [msg, type, ms, action] = vi.mocked(toast).mock.calls[0]!;
    expect(String(msg)).toContain('복구할까요');
    expect(type).toBe('warn');
    expect(Number(ms)).toBeGreaterThanOrEqual(10000);
    expect((action as { label: string }).label).toBe('복구하기');
  });

  it('정상 부팅(유효 저장본)에선 절대 안 뜸 — IDB 미러가 있어도', async () => {
    const kv = memKV();
    persist(kv, defaults());
    boot(kv); // 정상 부팅 → 마커 없음
    vi.mocked(idbLoad).mockResolvedValue(JSON.stringify(defaults()));
    render(<BootRecovery />);
    await tick();
    expect(toast).not.toHaveBeenCalled();
    expect(idbLoad).not.toHaveBeenCalled(); // 마커 없으면 IDB 조회도 안 함
  });

  it('폴백 부팅이어도 IDB 미러가 없으면(첫 방문) 안 뜸', async () => {
    boot(memKV());
    vi.mocked(idbLoad).mockResolvedValue(null);
    render(<BootRecovery />);
    await tick();
    expect(toast).not.toHaveBeenCalled();
  });

  it('폴백 부팅 + 손상된 IDB 미러 → 안 뜸(복구 불가 안내는 소음)', async () => {
    boot(memKV());
    vi.mocked(idbLoad).mockResolvedValue('{깨진 JSON');
    render(<BootRecovery />);
    await tick();
    expect(toast).not.toHaveBeenCalled();
  });
});
