/* ============================================================
   api.ts — 백엔드 호출 래퍼(프레임워크 무관). **셸의 Rust 커맨드가 백엔드다**(4단계).
   서버/외부 상태라 TanStack Query가 캐시/무효화를 소유한다(Phase 5에서 훅 추가).
   여기선 순수 호출만 — 앱 상태에 복제하지 않는다(설계도 §1-B).

   4단계에서 serve.js(Node HTTP · 라우트 12종)를 Rust 커맨드로 옮기고 삭제했다. **소비처 무변경**이
   판정 기준이었고 충족했다 — 전송 분기는 전부 이 파일 안에 있다(`isTauri()` · 에러 분류 번역).
   ⚠ `isTauri()` 가 거짓인 경로(브라우저 `npm run dev`·트랙 A)엔 **백엔드가 없다.** 남아 있는
   `/api` fetch 는 트랙 A 가 invoke 스텁으로 대체하며, 실사용에서 이 가지는 도달하지 않는다.
============================================================ */
import {
  ARTIFACT_NOT_FOUND,
  artifactRead,
  isTauri,
  shellCapabilities,
  shellOllamaEmbed,
  shellOllamaRun,
  shellRunTool,
} from './tauri';

export interface PingResponse {
  ok: boolean;
  server: string;
  tools: string[];
  work: string;
  /** 전역 캡처 단축키 등록 여부(E20 · 셸 전용). 브라우저에선 undefined. */
  hotkey?: boolean;
  /** 등록 실패 사유 — **이 값이 있을 때만 실패다.** `hotkey === false` 만 보고 경고를 띄우면
   *  브라우저·dev 에서 상시 경고가 되고, 상시 경고는 곧 무시된다(Rust `hotkey.rs` 와 같은 계약). */
  hotkeyError?: string | null;
  /** 볼트 **감시** 실패 사유(H7 · 셸 전용). `hotkeyError` 와 같은 계약 — **값이 있을 때만 실패**다.
   *  감시가 죽으면 볼트를 고쳐도 화면이 안 바뀌는데, 종전엔 그 사실이 Rust 로그에만 있었다. */
  vaultWatchError?: string | null;
}

export interface RunResult {
  ok: boolean;
  out: string;
  code: number;
  label?: string;
}
/* ⚠ **`stats` 를 뺐다(4단계-C).** serve.js 는 도구 stdout 을 정규식 6종으로 파싱해 `stats` 를
   실어 보냈는데, **프런트에서 이 필드를 읽는 곳이 하나도 없다** — 소비처 3곳(`useCollectTool`
   `Discovery`·`Ledger`)이 전부 `ok`·`code`·`out` 만 쓴다. 실제 도구 출력에 대보니 파서 2개가
   이미 틀린 값을 내고 있었고(볼트 건강검진의 `deadlinks` 는 문구가 "죽은 위키링크"로 바뀌어 늘
   null · `healthy` 는 개별 항목의 ✅ 하나만 걸려도 true 라 점검 439건인 볼트를 '양호'로 본다),
   **아무도 안 읽었기 때문에 그 오류가 드러난 적이 없다.** 읽히지 않는 값을 언어를 바꿔 옮기면
   같은 결함을 새 코드에 심는 것이라 이식하지 않는다. 필요해지면 `out` 에서 언제든 다시 뽑을 수
   있고, 그때는 실제 출력을 보고 쓰게 된다. */

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

/** 능력 탐지 — 백엔드를 쓸 수 있는지와 도구 목록.
 *  셸(4단계-F)에선 `capabilities` 커맨드가 답한다. **이름을 `getPing` 으로 둔 것은 의도적이다** —
 *  소비 8곳이 이 값을 "백엔드를 지금 쓸 수 있는가"로 읽고 있고 그 의미는 안 바뀌었다. 바뀐 건
 *  *무엇이 그 답을 결정하는가*(서버 프로세스 → 워크스페이스 유효성)이고, 그건 `tauri.ts` 에 적었다. */
export function getPing(): Promise<PingResponse> {
  if (isTauri()) return shellCapabilities<PingResponse>();
  return getJSON<PingResponse>('/api/ping');
}

/** 산출물(읽기 전용) — knowledge | anki | ledger | curriculum | goals | index.
 *  ⚠ 종전 이 줄은 `discovery`·`reads`·`markets` 도 세었다 — 셋 다 P10 W4 에서 `survey/` 로 갔다
 *  (아티팩트 9종 → 6종 · 불변식 I-4 가 "교양 도메인이 늘어도 이 수는 안 는다"를 잠근다).
 *
 *  4단계-B 부터 **셸에선 Rust 커맨드**(`artifact_read`)가 읽고, 브라우저에선 기존 `/api` 를 탄다.
 *  전송이 갈렸어도 **반환 계약과 에러 분류는 하나로 유지**한다 — 미생성·알 수 없는 이름은
 *  양쪽 모두 `HTTP 404` 로 수렴시켜 `artifactState.ts:31` `isNotYetError` 가 그대로 '미생성'으로
 *  분류하게 한다. 이 번역을 여기서 하는 이유: 소비처 7개 lib 래퍼와 10개 탭이 분류 규칙을
 *  각자 알면 전송을 바꿀 때마다 그 수만큼 갈라진다. */
export async function getArtifact<T = unknown>(
  name: string,
): Promise<{ ok: boolean; data?: T; raw?: string; error?: string }> {
  if (isTauri()) {
    try {
      const r = await artifactRead<T>(name);
      if (r) return r;
    } catch (e) {
      // invoke 는 문자열로 reject 한다(Error 가 아니다) → 접두 검사 전에 문자열로 정규화.
      const msg = e instanceof Error ? e.message : String(e ?? '');
      throw new Error(msg.startsWith(ARTIFACT_NOT_FOUND) ? 'HTTP 404' : msg);
    }
  }
  return getJSON(`/api/artifact/${encodeURIComponent(name)}`);
}

/** 화이트리스트 도구 실행(지식상태 재빌드·볼트 건강검진 등).
 *
 *  **타임아웃은 백엔드가 소유한다** — Rust `tools.rs` 의 도구별 상한(60~180s)이 프로세스를
 *  트리째 죽이므로 "영원히 도는 스피너"가 원리적으로 없다. 클라이언트 쪽 벽시계는 두지 않는다:
 *  그건 *기다리기를 그만두는* 것일 뿐 프로세스를 멈추지 못해, 실제로는 "화면만 포기하고 CPU 는
 *  계속 도는" 상태를 만든다(옛 185s `AbortSignal` 이 그랬다 — 서버 캡 180s 를 뒤따르는 값이라
 *  백엔드가 사라진 지금은 근거 자체가 없어졌다).
 *
 *  ⚠ **`opts.signal` 은 도구 실행을 중단시키지 않는다.** `invoke` 가 `AbortSignal` 을 안 받는다.
 *  받아 두는 이유는 호출부(`useCollectTool`)가 이미 넘기고 있어서이고, 진짜 중단이 필요해지면
 *  `ollama_cancel`(4단계-E) 과 같은 관용구로 취소 커맨드를 붙인다. */
export async function runTool(
  tool: string,
  body?: Record<string, unknown>,
  opts?: { signal?: AbortSignal },
): Promise<RunResult> {
  if (isTauri()) {
    const subject = typeof body?.subject === 'string' ? body.subject : undefined;
    return shellRunTool(tool, subject);
  }

  // 브라우저 폴백 — 4단계 이후 이 경로엔 백엔드가 없다(트랙 A 는 invoke 스텁을 쓴다).
  const r = await fetch(`/api/run/${encodeURIComponent(tool)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
    signal: opts?.signal,
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as RunResult;
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
   셸에선 Rust 가 Channel 로 토큰 델타를 밀어 넣고 최종 결과는 커맨드 반환값으로 온다(4단계-E).
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

/* ── Ollama 라우트 5종의 전송 분기(4단계-E) ────────────────────────
   셸이면 Rust 커맨드, 브라우저면 기존 /api. **분기를 이 한 함수에 가둔다** — 아래 네 개의
   공개 함수와 소비처(`Review` 의 회고 코치)는 전송을 모른다.
   ⚠ 종전 소비는 셋이었다(읽을거리 코치·어휘 · 증시 브리핑) — P10 W4 에서 그 화면들이 갔다.
   `kind` 가 곧 경로 조각이라 브라우저 경로는 `/api/${kind}` 로 그대로 재구성된다. */
async function aiCall<T>(kind: string, body: Record<string, unknown>, opts?: StreamOpts, streaming = true): Promise<T> {
  if (isTauri()) return shellOllamaRun<T>(kind, body, opts);
  return streaming ? postStream<T>(`/api/${kind}`, body, opts) : postJSON<T>(`/api/${kind}`, body);
}

/* ── 주간 회고 코치 (로컬 Ollama · 셸 커맨드) ─────────────────
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
  return aiCall('review/coach', { facts, weakSpots }, opts);
}

/* ── 임베딩 (로컬 Ollama · 셸 커맨드) ─────────────────────
   의미 검색·지식맵 자동 연결용. 모델·대상은 서버가 고정한다(`ollama pull bge-m3` 필요). */
export function embedTexts(
  texts: string[],
): Promise<{ ok: boolean; error?: string; model?: string; vectors?: number[][] }> {
  if (isTauri()) return shellOllamaEmbed(texts);
  return postJSON('/api/embed', { texts });
}
