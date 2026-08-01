// @vitest-environment jsdom
/* ============================================================
   bootRecovery.test.tsx — 부팅 복구 안내(BootRecovery) 회귀.
   부팅이 기본값으로 떨어졌고 IDB 미러가 유효할 때만 '복구하기' 토스트가 뜨고,
   정상 부팅·미러 없음에선 절대 뜨지 않는다.
============================================================ */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

vi.mock('@/shell/toast', () => ({ toast: vi.fn(), toastUndo: vi.fn(), toastUndoable: vi.fn(), ToastHost: () => null }));
vi.mock('@/lib/idb', () => ({
  idbMirror: vi.fn(),
  idbLoad: vi.fn(),
  idbGet: vi.fn(async () => null),
  idbPut: vi.fn(async () => {}),
  idbDel: vi.fn(async () => {}),
  idbPreserveBackup: vi.fn(async () => {}),
  IDB_BACKUP_KEY: 'state_backup',
  IDB_BACKUP2_KEY: 'state_backup2',
}));

import { toast } from '@/shell/toast';
import { idbGet, idbLoad, idbPreserveBackup } from '@/lib/idb';
import { memKV } from '@/lib/kv';
import { boot, defaults, persist } from '@/lib/persistence';
import type { AppState } from '@/lib/types';
import BootRecovery from '@/app/BootRecovery';

const tick = () => new Promise((r) => setTimeout(r, 0));

/** 활동 흔적이 있는 상태 — defaults-동형(pristine) 가드(재검증 ⑩#1·#2)에 걸리지 않는 미러. */
const active = (): AppState => {
  const s = defaults() as AppState & { completions: Record<string, Record<string, { done: boolean }>> };
  s.completions['2026-07-01'] = { 'sub|study': { done: true } };
  return s;
};

beforeEach(() => {
  vi.mocked(toast).mockClear();
  vi.mocked(idbLoad).mockReset();
  vi.mocked(idbGet).mockReset();
  vi.mocked(idbGet).mockResolvedValue(null);
  vi.mocked(idbPreserveBackup).mockClear();
});

describe('BootRecovery — IDB 미러 복구 안내', () => {
  it('폴백 부팅 + 유효한 IDB 미러(활동 있음) → 복구하기 액션 토스트(warn·long)', async () => {
    boot(memKV()); // 저장본 없음 → 폴백 마커 세팅
    vi.mocked(idbLoad).mockResolvedValue(JSON.stringify(active()));
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

  it('폴백 부팅 시 미러를 세대 백업으로 보존한다 — 첫 flush의 미러 파괴 대비(감사 #21)', async () => {
    boot(memKV());
    const json = JSON.stringify(active());
    vi.mocked(idbLoad).mockResolvedValue(json);
    render(<BootRecovery />);
    await waitFor(() => expect(idbPreserveBackup).toHaveBeenCalledWith(json));
  });

  it('defaults-동형(무활동) 미러는 백업 링에 밀어넣지 않는다 — 연쇄 fallback의 실데이터 축출 방지(재검증 ⑩#2)', async () => {
    boot(memKV());
    vi.mocked(idbLoad).mockResolvedValue(JSON.stringify(defaults()));
    render(<BootRecovery />);
    await tick();
    await tick();
    expect(idbPreserveBackup).not.toHaveBeenCalled();
  });

  it('defaults-동형 미러 + 실데이터 세대 백업 존재 → 토스트는 뜬다(복구 액션이 백업을 자동 우선 · 재검증 ⑩#1)', async () => {
    boot(memKV());
    vi.mocked(idbLoad).mockResolvedValue(JSON.stringify(defaults()));
    vi.mocked(idbGet).mockResolvedValue(JSON.stringify(active()));
    render(<BootRecovery />);
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(String(vi.mocked(toast).mock.calls[0]![0])).toContain('복구할까요');
  });

  it('defaults-동형 미러 + 백업도 없음 → 안 뜸(복구 가치 0 — 안내는 소음)', async () => {
    boot(memKV());
    vi.mocked(idbLoad).mockResolvedValue(JSON.stringify(defaults()));
    render(<BootRecovery />);
    await tick();
    await tick();
    expect(toast).not.toHaveBeenCalled();
  });

  it('손상 미러도 보존은 한다(수동 복구 여지) — 토스트만 안 뜸', async () => {
    boot(memKV());
    vi.mocked(idbLoad).mockResolvedValue('{깨진 JSON');
    render(<BootRecovery />);
    await waitFor(() => expect(idbPreserveBackup).toHaveBeenCalledWith('{깨진 JSON'));
    expect(toast).not.toHaveBeenCalled();
  });

  it('정상 부팅에선 백업 보존도 안 한다(미러 조회 자체가 없음)', async () => {
    const kv = memKV();
    persist(kv, defaults());
    boot(kv);
    render(<BootRecovery />);
    await tick();
    expect(idbPreserveBackup).not.toHaveBeenCalled();
  });
});
