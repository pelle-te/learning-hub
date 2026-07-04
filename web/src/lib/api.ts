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

/* ── Ollama 스트리밍 ────────────────────────────────────────────
   serve.js가 body.stream=true면 NDJSON을 중계한다: 토큰 델타 {d:"…"} 줄들 → 최종 {done:true, …결과} 줄.
   첫 토큰이 2~3초면 도착하므로 "수십 초 침묵"이 사라지고, AbortSignal로 생성 자체를 중단할 수 있다. */
export interface StreamOpts {
  /** 누적 원문이 갱신될 때마다 호출(미리보기용). */
  onDelta?: (accumulated: string) => void;
  signal?: AbortSignal;
}

async function postStream<T>(url: string, body: Record<string, unknown>, opts?: StreamOpts): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, stream: true }),
    signal: opts?.signal,
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const ct = r.headers?.get?.('content-type') ?? ''; // 테스트 스텁 Response(headers 없음)도 수용
  // 스트림이 아닌 단발 JSON(가드 403/429 폴백 등)도 같은 자리로 수렴.
  if (!r.body || !ct.includes('ndjson')) return (await r.json()) as T;
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let acc = '';
  let final: T | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line) as { done?: boolean; d?: string };
        if (j.done) final = j as T;
        else if (typeof j.d === 'string') {
          acc += j.d;
          opts?.onDelta?.(acc);
        }
      } catch {
        /* 불완전한 줄은 무시(다음 청크에서 완성) */
      }
    }
  }
  if (!final) throw new Error('스트림이 결과 없이 끝났어요');
  return final;
}

/** 스트리밍 원문(format:json 생성 중간체)에서 사람이 읽을 미리보기를 뽑는다 —
    완성된 문자열 *값*만(키 이름 제외) 이어붙여 "타이핑되는" 느낌을 준다. 순수 함수. */
export function previewFromJsonStream(text: string): string {
  const out: string[] = [];
  const re = /"(?:[^"\\]|\\.)*"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (/^\s*:/.test(text.slice(re.lastIndex))) continue; // 뒤에 콜론이 오면 키
    try {
      const v = JSON.parse(m[0]) as string;
      if (v.trim()) out.push(v.trim());
    } catch {
      /* 미완성 리터럴 */
    }
  }
  return out.join(' · ');
}

/** 내가 쓴 요약을 원문과 대조해 채점·피드백(Ollama 스트리밍). serve.js/Ollama 꺼져 있으면 reject. */
export function coachSummary(
  source: string,
  summary: string,
  lang: 'en' | 'ko',
  opts?: StreamOpts,
): Promise<{ ok: boolean; error?: string; feedback?: CoachFeedback }> {
  return postStream('/api/reads/coach', { source, summary, lang }, opts);
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

/** 온디맨드 증시 해설(Ollama 스트리밍). serve.js/Ollama 꺼져 있으면 reject/에러. */
export function marketsBrief(
  indices: { name: string; symbol: string; changePct: number; price: number }[],
  headlines: { title: string; source: string }[],
  opts?: StreamOpts,
): Promise<{ ok: boolean; error?: string; brief?: MarketBriefResult }> {
  return postStream('/api/markets/brief', { indices, headlines }, opts);
}

/* ── 주간 회고 코치 (로컬 Ollama 프록시 · serve.js) ─────────────────
   앱이 계산한 결정적 인사이트를 받아 '다음 주에 뭘 바꿀지'로 구체화한다. 숫자를 새로 짓지 않는다. */
export interface ReviewCoachResult {
  headline?: string;
  actions?: string[];
  focus?: string;
  encourage?: string;
}

/** 온디맨드 회고 코칭(Ollama 스트리밍). facts=이번 주 관찰 문장들, weakSpots=반복 약점 문장들. 꺼져 있으면 에러. */
export function reviewCoach(
  facts: string[],
  weakSpots: string[],
  opts?: StreamOpts,
): Promise<{ ok: boolean; error?: string; coach?: ReviewCoachResult }> {
  return postStream('/api/review/coach', { facts, weakSpots }, opts);
}

/* ── 임베딩 (로컬 Ollama 프록시 · serve.js) ─────────────────────
   의미 검색·지식맵 자동 연결용. 모델·대상은 서버가 고정한다(`ollama pull bge-m3` 필요). */
export function embedTexts(
  texts: string[],
): Promise<{ ok: boolean; error?: string; model?: string; vectors?: number[][] }> {
  return postJSON('/api/embed', { texts });
}
