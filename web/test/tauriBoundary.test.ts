// @vitest-environment jsdom
/* ============================================================
   tauriBoundary.test.ts — 로컬 IPC 경계의 파싱 정책(C-2).

   ## 여기서 잠그는 것은 **정책의 방향**이다

   이 저장소에는 이제 경계 파서가 둘이고 **정책이 정반대**다:

   · `lib/tauri.ts` — 반대편이 *우리가 배포한 Rust 바이너리*다. 목적은 방어가 아니라
     **드리프트 탐지** → 경고하고 원본을 통과시킨다(비차단).
   · `lib/cloud/schema.ts` — 반대편이 *네트워크*다. **거부가 목적 그 자체** → 차단한다.

   둘을 같은 정책으로 맞추려는 리팩터가 앞으로 반드시 나온다("일관성"은 늘 그럴듯하다).
   그때 이 파일이 **왜 달라야 하는지**를 실패로 말해 준다. 차단으로 바꾸면 아래 "필드가
   사라져도 기능은 산다" 케이스가 깨지고, 반대로 클라우드를 비차단으로 바꾸면
   `cloudSchema.test.ts` 가 깨진다.
============================================================ */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import { workspaceStatus, vaultScan } from '@/lib/tauri';

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  invoke.mockReset();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.restoreAllMocks();
});

describe('정합한 응답은 조용히 통과한다', () => {
  it('경고를 남기지 않는다 — 거짓 경보는 진짜 경보를 묻는다', async () => {
    invoke.mockResolvedValue({ path: 'D:/atelier', valid: true, inferred: false });
    const out = await workspaceStatus();
    expect(out).toEqual({ path: 'D:/atelier', valid: true, inferred: false });
    expect(warn).not.toHaveBeenCalled();
  });

  it('⚠ Rust 가 필드를 **추가**하는 것은 위반이 아니다(호환되는 확장)', async () => {
    invoke.mockResolvedValue({ path: null, valid: false, inferred: true, newField: 42 });
    await workspaceStatus();
    expect(warn, '필드 추가에 경고가 나면 매 릴리스마다 거짓 경보다').not.toHaveBeenCalled();
  });
});

describe('⚠ 어긋난 응답 — 경고하되 **차단하지 않는다**', () => {
  it('필드가 사라지면 경고한다', async () => {
    invoke.mockResolvedValue({ path: 'D:/x', valid: true }); // inferred 누락
    await workspaceStatus();
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]![0])).toContain('workspace_status');
  });

  it('타입이 바뀌면 경고한다 — 경고 문구에 필드 경로가 들어간다', async () => {
    invoke.mockResolvedValue({ path: 'D:/x', valid: 'yes', inferred: false });
    await workspaceStatus();
    expect(String(warn.mock.calls[0]![0])).toContain('valid');
  });

  it('⚠⚠ 어긋나도 **원본을 그대로 돌려준다** — 이게 클라우드 경계와 갈리는 지점이다', async () => {
    const drifted = { path: 'D:/x', valid: 'yes', inferred: false };
    invoke.mockResolvedValue(drifted);
    const out = await workspaceStatus();
    expect(out, '차단으로 바꾸면 필드 하나 때문에 기능이 통째로 죽는다').toEqual(drifted);
  });

  it('notes 가 배열이 아니면 경고한다(볼트 스캔)', async () => {
    invoke.mockResolvedValue({ notes: '배열아님', src: '정본', path: 'D:/v' });
    await vaultScan();
    expect(String(warn.mock.calls[0]![0])).toContain('notes');
  });

  it('볼트 노트의 필드 누락은 정상이다 — 사용자가 손으로 쓰는 파일이다', async () => {
    invoke.mockResolvedValue({ notes: [{}, { subject: '수학' }], src: '정본', path: 'D:/v' });
    await vaultScan();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('검증이 기존 실패 처리를 바꾸지 않는다', () => {
  it('invoke 가 던지면 여전히 null 로 접는다(파싱이 그 경로를 가로채지 않는다)', async () => {
    invoke.mockRejectedValue(new Error('워크스페이스 없음'));
    expect(await workspaceStatus()).toBeNull();
  });

  /* ⚠⚠ **이 케이스가 뒤집혔다**(U006 · 2026-08-21 ux 축). 종전 단언은 `vaultScan()` 도 `null` 로
     접는 것이었고, 그 정책은 *"사용자 표면은 감시 채널(`capabilities.vaultWatchError`)이 맡는다"* 는
     주석에 기대고 있었다 — 그런데 그 값을 세우는 곳은 **감시자뿐**이라 스캔 실패의 사용자 표면은
     존재한 적이 없었다. 지금은 던지고, `app/VaultSync` 가 받아 `VaultPanel` 이 그린다.
     ⚠ 「내 수정이 깼다」가 아니라 「옛 계약을 갱신한다」인 경우다(판례 2026-08-21 D002) — 뒤집힌
     이유를 여기 적는다. 안 적으면 다음 회차가 옛 근거를 읽고 되돌린다. */
  it('볼트 스캔 실패는 **던진다** — 호출부가 「비었다」와 「읽다 죽었다」를 갈라야 한다', async () => {
    invoke.mockRejectedValue(new Error('워크스페이스 없음'));
    await expect(vaultScan()).rejects.toThrow('워크스페이스 없음');
  });

  it('브라우저에선 invoke 자체를 부르지 않는다', async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    expect(await workspaceStatus()).toBeNull();
    expect(await vaultScan()).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
});
