/* ============================================================
   api.ts — serve.js 백엔드(/api) 타입드 fetch 래퍼(프레임워크 무관).
   서버/외부 상태라 TanStack Query가 캐시/무효화를 소유한다(Phase 5에서 훅 추가).
   여기선 순수 호출만 — 앱 상태에 복제하지 않는다(설계도 §1-B).
============================================================ */
export interface PingResponse {
  ok: boolean;
  server: string;
  tools: string[];
  work: string;
}

export interface RunResult {
  ok: boolean;
  out: string;
  code: number;
  stats?: unknown;
  label?: string;
}

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

/** 능력 탐지 — 제어판(serve.js) 연결 여부·도구 목록. */
export function getPing(): Promise<PingResponse> {
  return getJSON<PingResponse>('/api/ping');
}

/** 산출물(읽기 전용) — knowledge | anki. */
export function getArtifact<T = unknown>(
  name: string,
): Promise<{ ok: boolean; data?: T; raw?: string; error?: string }> {
  return getJSON(`/api/artifact/${encodeURIComponent(name)}`);
}

/** 화이트리스트 도구 실행(지식상태 재빌드·볼트 건강검진 등). */
export async function runTool(tool: string, body?: Record<string, unknown>): Promise<RunResult> {
  const r = await fetch(`/api/run/${encodeURIComponent(tool)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as RunResult;
}
