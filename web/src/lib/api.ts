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

/* ── 읽을거리 코치·어휘 (로컬 Ollama 프록시 · serve.js) ─────────────────
   ⚠ 원문 요약은 서버가 하지 않는다. 코치=내 요약 채점, 어휘=단어 뜻만. */
export interface CoachFeedback {
  score?: number;
  missing?: string[];
  redundant?: string[];
  accuracy?: string[];
  corrections?: string[];
  key_expressions?: { en: string; ko: string }[];
  model_summary?: string;
  comment?: string;
}
export interface VocabResult {
  word?: string;
  pos?: string;
  meaning?: string;
  synonyms?: string[];
  example?: string;
  example_ko?: string;
}

async function postJSON<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

/** 내가 쓴 요약을 원문과 대조해 채점·피드백(Ollama). serve.js/Ollama 꺼져 있으면 reject. */
export function coachSummary(
  source: string,
  summary: string,
  lang: 'en' | 'ko',
): Promise<{ ok: boolean; error?: string; feedback?: CoachFeedback }> {
  return postJSON('/api/reads/coach', { source, summary, lang });
}

/** 지문에서 선택한 단어 하나의 뜻·예문(Ollama). */
export function lookupVocab(
  word: string,
  context: string,
  lang: 'en' | 'ko',
): Promise<{ ok: boolean; error?: string; vocab?: VocabResult }> {
  return postJSON('/api/reads/vocab', { word, context, lang });
}

/* ── 증시 브리핑 (로컬 Ollama 프록시 · serve.js) ─────────────────
   그날 지수 등락 + 뉴스 헤드라인 → "왜 움직였나" 해설. 숫자를 새로 짓지 않는다. */
export interface MarketBriefResult {
  overview?: string;
  drivers?: { title: string; detail: string }[];
  watch?: string[];
  caveat?: string;
}

/** 온디맨드 증시 해설(Ollama). serve.js/Ollama 꺼져 있으면 reject/에러. */
export function marketsBrief(
  indices: { name: string; symbol: string; changePct: number; price: number }[],
  headlines: { title: string; source: string }[],
): Promise<{ ok: boolean; error?: string; brief?: MarketBriefResult }> {
  return postJSON('/api/markets/brief', { indices, headlines });
}

/* ── 주간 회고 코치 (로컬 Ollama 프록시 · serve.js) ─────────────────
   앱이 계산한 결정적 인사이트를 받아 '다음 주에 뭘 바꿀지'로 구체화한다. 숫자를 새로 짓지 않는다. */
export interface ReviewCoachResult {
  headline?: string;
  actions?: string[];
  focus?: string;
  encourage?: string;
}

/** 온디맨드 회고 코칭(Ollama). facts=이번 주 관찰 문장들, weakSpots=반복 약점 문장들. 꺼져 있으면 에러. */
export function reviewCoach(
  facts: string[],
  weakSpots: string[],
): Promise<{ ok: boolean; error?: string; coach?: ReviewCoachResult }> {
  return postJSON('/api/review/coach', { facts, weakSpots });
}
