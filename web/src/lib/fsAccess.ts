/* ============================================================
   fsAccess.ts — File System Access API의 단일 타입 경계.

   lib.dom에 아직 없는(또는 비표준인) FS Access 표면 — showDirectoryPicker ·
   FileSystemDirectoryHandle.entries() · query/requestPermission — 을 여기 한 곳에서만
   좁힌다. 예전엔 이 캐스트가 lib/anki · lib/vault · features/mastery · shell/actions
   네 곳에 복붙돼 있었다(같은 캐스트 8개). 브라우저 타입이 갱신되면 이 파일만 지운다.

   레이어: 최하위 lib(위를 모름). React 무관.
============================================================ */

/** FS Access 미지원 브라우저(Safari·Firefox)에서 폴더 선택을 시도했을 때. */
export class FsUnsupportedError extends Error {
  constructor(message = '이 브라우저는 폴더 연결을 지원하지 않아요(Chrome/Edge에서 열어주세요).') {
    super(message);
    this.name = 'FsUnsupportedError';
  }
}

interface DirPickerWindow {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
}

function picker(): (() => Promise<FileSystemDirectoryHandle>) | undefined {
  return (window as unknown as DirPickerWindow).showDirectoryPicker;
}

/** 폴더 선택 지원 여부 — 미지원이면 안내 토스트로 갈라지려는 호출부가 먼저 묻는다. */
export function isFsAccessSupported(): boolean {
  return typeof picker() === 'function';
}

/** 폴더 선택 다이얼로그. 사용자가 취소하면 null, 미지원이면 FsUnsupportedError. */
export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  const p = picker();
  if (!p) throw new FsUnsupportedError();
  try {
    return await p();
  } catch {
    return null; // 사용자 취소(AbortError)
  }
}

/** 디렉터리 자식 순회 — entries()는 lib.dom 타입에 없는 비표준 async iterator라 여기서 좁힌다. */
export function dirEntries(h: FileSystemDirectoryHandle): AsyncIterable<[string, FileSystemHandle]> {
  return (h as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries();
}

type PermCapable = {
  queryPermission?: (o: { mode: string }) => Promise<PermissionState>;
  requestPermission?: (o: { mode: string }) => Promise<PermissionState>;
};

/** 저장된 핸들의 권한 상태 — 'granted'면 사용자 제스처 없이 접근 가능. 미지원/실패는 'prompt'. */
export async function queryPermission(
  handle: FileSystemDirectoryHandle,
  mode: 'read' | 'readwrite' = 'read',
): Promise<PermissionState> {
  const h = handle as unknown as PermCapable;
  if (!h.queryPermission) return 'prompt';
  try {
    return await h.queryPermission({ mode });
  } catch {
    return 'prompt';
  }
}

/** 핸들에 권한 요청(반드시 사용자 제스처 안에서). 미지원은 'prompt', 실패는 'denied'. */
export async function requestPermission(
  handle: FileSystemDirectoryHandle,
  mode: 'read' | 'readwrite' = 'read',
): Promise<PermissionState> {
  const h = handle as unknown as PermCapable;
  if (!h.requestPermission) return 'prompt';
  try {
    return await h.requestPermission({ mode });
  } catch {
    return 'denied';
  }
}
