/* ============================================================
   serve.js — 러닝허브 로컬 서버 + 시스템 제어판 백엔드 (의존성 0 · Node 내장만)

   실행:  node serve.js            (러닝허브 폴더에서 · 기본 포트 8000)
          node serve.js 5500       (포트 지정)

   왜 필요한가:
   ① file:// 더블클릭은 ES모듈·fetch·PWA(서비스워커)가 막힌다. http://localhost 로 띄우면 풀림.
   ② 러닝허브는 브라우저 정적 앱이라 Python 도구(지식엔진·벌트DB·지시문평가·탐구수집)를 직접 못 돈다.
      그래서 이 서버가 *제어판 백엔드*가 되어, 화이트리스트 도구를 실행하고 산출 JSON을 서빙한다 →
      러닝허브에서 버튼 하나로 돌리고 결과를 바로 본다(옛 홈/app.py·탐구_제어판.py를 러닝허브로 흡수).

   배포(Phase 6 컷오버): 옛 바닐라 앱은 삭제됐고, 이 서버가 **React 빌드물(web/dist)**을 서빙한다.
   (a) /api (제어판) (b) 정적 dist (c) SPA history 폴백(미매칭 GET → index.html) → 단일 출처·딥링크 새로고침 OK.
   먼저 `cd web && npm run build`로 web/dist를 만들어야 한다(없으면 안내 표시). 개발은 `npm run dev`(:5173)가 별도.

   안전:
   - 127.0.0.1(로컬호스트)에만 바인딩 — 외부 노출 안 함.
   - 정적 경로 역참조(../) 차단(러닝허브 폴더 밖 파일 직접 서빙 금지).
   - /api/run/:tool 은 *화이트리스트(TOOLS)에 정의된 명령만* spawn(shell 안 씀 → 셸 인젝션 0). 인자도 화이트리스트.
   - 각 실행 타임아웃. 산출물 읽기는 정해진 파일만(/api/artifact/:name).
============================================================ */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');

const ROOT = __dirname;                          // 러닝허브 폴더
const WORK = path.dirname(ROOT);                 // 작업 폴더(시스템·전공·anki의 부모)
const DIST = path.join(ROOT, 'web', 'dist');     // React 빌드물(정적 서빙 루트)
const PORT = Number(process.argv[2]) || 8000;
const PY = process.env.PYTHON || 'python';
// 읽을거리 코치·어휘가 부르는 로컬 Ollama(요약은 시키지 않는다 — 내 요약 채점·단어 뜻만).
const OLLAMA_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.READS_OLLAMA_MODEL || 'qwen3:8b';
// 증시 브리핑도 같은 로컬 모델(다르게 쓰고 싶으면 MARKETS_OLLAMA_MODEL).
const MARKETS_MODEL = process.env.MARKETS_OLLAMA_MODEL || OLLAMA_MODEL;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
};

/* ── 화이트리스트 도구 (러닝허브 제어판이 호출) ──────────────────
   key → { cmd:[python, 스크립트, ...고정인자], label, timeout, parse? }
   parse: stdout을 구조화 JSON으로(있으면 응답에 .stats로). 없으면 텍스트만. */
const TOOLS = {
  'knowledge-build': { cmd: ['시스템/_도구/지식엔진.py', 'build'], label: '지식상태 재빌드', timeout: 120000, parse: parseKnowledgeBuild },
  'vault-health':    { cmd: ['시스템/_도구/벌트DB.py', 'health'],   label: '볼트 건강검진', timeout: 60000,  parse: parseVaultHealth },
  'vault-stats':     { cmd: ['시스템/_도구/벌트DB.py', 'stats'],    label: '볼트 통계',     timeout: 60000 },
  'index-build':     { cmd: ['시스템/_도구/벌트DB.py', 'build'],    label: '인덱스/DB 재생성', timeout: 120000 },
  'eval':            { cmd: ['시스템/_도구/지시문평가.py', 'eval'], label: '지시문 품질 회귀검사', timeout: 120000, parse: parseEval },
  'anki-signal':     { cmd: ['시스템/_도구/학습신호.py'],          label: 'Anki 학습신호 갱신', timeout: 60000,  parse: parseAnkiSignal },
  'reads-collect':   { cmd: ['시스템/_도구/읽을거리_수집.py'],      label: '읽을거리 수집', timeout: 180000, parse: parseReadsCollect },
  'markets-collect': { cmd: ['시스템/_도구/증시_수집.py'],          label: '증시 동향 수집', timeout: 180000, parse: parseMarketsCollect },
};

/* 산출물 파일(읽기 전용 서빙) */
const ARTIFACTS = {
  knowledge: path.join(WORK, '전공', '_meta', '감사', '_지식상태.json'),
  anki:      path.join(WORK, '전공', '_meta', '감사', '_anki신호.json'),
  reads:     path.join(ROOT, '_읽을거리', 'latest.json'),   // 읽을거리 지문(수집 원문) — 러닝허브 로컬
  markets:   path.join(ROOT, '_증시', 'latest.json'),       // 증시 동향(지수 등락 + 금융 뉴스) — 러닝허브 로컬
};

function sendJSON(res, code, obj) {
  if (res.headersSent) return; // 이중 콜백 회귀 안전망 — 닫힌 응답 재기록(ERR_HTTP_HEADERS_SENT) 시 프로세스가 죽는다
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

/* ── 정적 파일 전송 헬퍼(캐시 정책 + gzip 협상) ──────────────────
   캐시: Vite가 /assets/ 밑에 콘텐츠 해시 파일명(index-Ab3xYz.js)으로 내놓으므로 1년 immutable.
         index.html·manifest·sw.js 등 해시 없는 파일은 no-cache(매번 재검증 → 새 빌드 즉시 반영).
   gzip: 텍스트류(html/js/css/json/svg)만, 클라이언트가 Accept-Encoding: gzip일 때 스트림 압축.
         압축 시 Content-Length는 생략(chunked). API 응답(sendJSON)은 기존 no-store 유지. */
function isCompressible(type) {
  return /^text\/|^application\/(json|javascript|manifest\+json)|^image\/svg\+xml/.test(type);
}
function sendFile(req, res, filePath, type, cache) {
  const headers = { 'Content-Type': type, 'Cache-Control': cache };
  const gzipOk = isCompressible(type);
  if (gzipOk) headers['Vary'] = 'Accept-Encoding'; // 압축 여부로 응답이 갈리는 자원만 표시
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    try { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); } catch (e) {}
    res.end('500: 파일 읽기 실패');
  });
  if (gzipOk && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
    headers['Content-Encoding'] = 'gzip';
    res.writeHead(200, headers);
    stream.pipe(zlib.createGzip()).pipe(res);
  } else {
    res.writeHead(200, headers);
    stream.pipe(res);
  }
}

/* 도구 실행(spawn · shell 안 씀) → {ok,out,code,stats?} */
function runTool(toolKey, extraArgs, cb) {
  const t = TOOLS[toolKey];
  if (!t) { cb({ ok: false, out: '알 수 없는 도구: ' + toolKey, code: -1 }); return; }
  const args = t.cmd.concat(extraArgs || []);
  let out = '', done = false;
  const finish = (ok, code) => {
    if (done) return; done = true;
    let stats = null;
    if (ok && t.parse) { try { stats = t.parse(out); } catch (e) {} }
    cb({ ok, out: out.slice(-20000), code, stats, label: t.label });
  };
  let proc;
  try { proc = spawn(PY, args, { cwd: WORK, env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }) }); }
  catch (e) { cb({ ok: false, out: 'spawn 실패: ' + (e.message || e), code: -1 }); return; }
  const killer = setTimeout(() => { try { proc.kill(); } catch (e) {} finish(false, -2); }, t.timeout || 60000);
  proc.stdout.on('data', d => out += d.toString('utf8'));
  proc.stderr.on('data', d => out += d.toString('utf8'));
  proc.on('error', e => { clearTimeout(killer); out += '\n실행 오류: ' + (e.message || e); finish(false, -1); });
  proc.on('close', code => { clearTimeout(killer); finish(code === 0, code); });
}

/* 탐구 수집 실행 — topic 필수, scope 선택. 인자는 값으로만 전달(shell 안 씀). */
function runResearch(topic, scope, cb) {
  if (!topic || typeof topic !== 'string' || topic.length > 200) { cb({ ok: false, out: 'topic(주제)이 필요합니다.' }); return; }
  const args = ['시스템/_도구/탐구_수집.py', '--topic', topic];
  if (scope && typeof scope === 'string') args.push('--scope', scope.slice(0, 200));
  let out = '', done = false;
  const fin = (ok, code) => { if (done) return; done = true; cb({ ok, out: out.slice(-20000), code }); };
  let proc;
  try { proc = spawn(PY, args, { cwd: WORK, env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8', RESEARCH_NOOPEN: '1' }) }); }
  catch (e) { cb({ ok: false, out: 'spawn 실패: ' + (e.message || e) }); return; }
  const killer = setTimeout(() => { try { proc.kill(); } catch (e) {} fin(false, -2); }, 1800000); // 30분
  proc.stdout.on('data', d => out += d.toString('utf8'));
  proc.stderr.on('data', d => out += d.toString('utf8'));
  proc.on('error', e => { clearTimeout(killer); out += '\n오류: ' + (e.message || e); fin(false, -1); });
  proc.on('close', code => { clearTimeout(killer); fin(code === 0, code); });
}

function readBody(req, cb) {
  let b = ''; req.on('data', d => { b += d; if (b.length > 1e6) req.destroy(); });
  req.on('end', () => { try { cb(b ? JSON.parse(b) : {}); } catch (e) { cb({}); } });
}

/* ── 읽을거리 코치·어휘 (로컬 Ollama HTTP) ────────────────────────────────
   ⚠ 이 서버는 원문을 요약/재작성하지 않는다. 코치=내가 쓴 요약을 원문과 대조해 채점, 어휘=단어 뜻만.
   동시 호출 캡(OLLAMA_RUNNING)으로 8B 생성이 쌓이는 것 방지. format:json으로 구조화 강제. */
let OLLAMA_RUNNING = 0;
const MAX_OLLAMA = 2;
function parseModelJSON(content) {
  const cleaned = String(content || '').replace(/<think>[\s\S]*?<\/think>/g, '');
  const m = cleaned.match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : { raw: cleaned.trim() }; } catch (e) { return null; }
}
function ollamaChat(prompt, cb, model) {
  // ⚠ 타임아웃→destroy→'error'(ECONNRESET) 순서로 콜백이 2번 불릴 수 있다. 두 번째 sendJSON이
  //   닫힌 응답에 writeHead를 시도하면 프로세스 전체가 죽으므로(실증) done 플래그로 1회 호출을 보장한다.
  let done = false;
  const fin = (err, obj) => { if (done) return; done = true; cb(err, obj); };
  const payload = JSON.stringify({
    model: model || OLLAMA_MODEL,
    messages: [{ role: 'user', content: prompt }],
    stream: false, format: 'json', think: false,   // 사고모드 OFF — 지연↓·JSON 혼동↓(qwen3)
    options: { temperature: 0.3, num_ctx: 8192 },
  });
  let u;
  try { u = new URL('/api/chat', OLLAMA_URL); } catch (e) { return fin(new Error('OLLAMA_URL 오류')); }
  const req = http.request(u, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, r => {
    let data = '';
    r.on('data', d => { data += d; });
    r.on('end', () => {
      let content = '';
      try { content = JSON.parse(data).message?.content || ''; } catch (e) { return fin(new Error('Ollama 응답 파싱 실패')); }
      const obj = parseModelJSON(content);
      if (obj) fin(null, obj); else fin(new Error('Ollama 응답 파싱 실패'));
    });
  });
  req.on('error', e => fin(new Error('Ollama 연결 실패 — 켜져 있나요? (' + (e.code || e.message) + ')')));
  req.setTimeout(120000, () => { req.destroy(); fin(new Error('Ollama 응답 시간 초과')); });
  req.end(payload);
}

/* 스트리밍 채팅 — Ollama NDJSON을 그대로 중계한다: 토큰 델타는 {d:"…"} 줄, 마지막에 {done:true, …wrap} 줄.
   총 시간 대신 '무소식 90초'를 타임아웃으로 삼는다(콜드 로드·긴 생성에도 안전 — 120초 벽시계 한도 제거).
   클라이언트가 끊으면(res close) 업스트림도 끊어 생성 자체를 중단시킨다(취소가 실제로 동작). */
function ollamaChatStream(spec, res, release) {
  let u;
  try { u = new URL('/api/chat', OLLAMA_URL); } catch (e) { release(); return sendJSON(res, 200, { ok: false, error: 'OLLAMA_URL 오류' }); }
  const payload = JSON.stringify({
    model: spec.model || OLLAMA_MODEL,
    messages: [{ role: 'user', content: spec.prompt }],
    stream: true, format: 'json', think: false,
    options: { temperature: 0.3, num_ctx: 8192 },
  });
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
  let full = '', buf = '', ended = false, idle = null;
  const finish = (obj) => {
    if (ended) return; ended = true;
    clearTimeout(idle); release();
    try { res.end(JSON.stringify(Object.assign({ done: true }, obj)) + '\n'); } catch (e) {}
  };
  const bump = (up) => {
    clearTimeout(idle);
    idle = setTimeout(() => { try { up.destroy(); } catch (e) {} finish({ ok: false, error: 'Ollama 응답 시간 초과(90초 무소식)' }); }, 90000);
  };
  const up = http.request(u, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, r => {
    bump(up);
    r.on('data', chunk => {
      bump(up);
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        try {
          const j = JSON.parse(line);
          const d = (j.message && j.message.content) || '';
          if (d) { full += d; if (!ended) res.write(JSON.stringify({ d }) + '\n'); }
        } catch (e) {}
      }
    });
    r.on('end', () => {
      const obj = parseModelJSON(full);
      finish(obj ? spec.wrap(obj) : { ok: false, error: 'Ollama 응답 파싱 실패' });
    });
  });
  bump(up);
  up.on('error', e => finish({ ok: false, error: 'Ollama 연결 실패 — 켜져 있나요? (' + (e.code || e.message) + ')' }));
  res.on('close', () => { if (!ended) { ended = true; clearTimeout(idle); try { up.destroy(); } catch (e) {} release(); } });
  up.end(payload);
}

/* 임베딩 프록시 — 의미 검색·지식맵 자동 연결용. 텍스트만 받아 벡터만 돌려준다(모델·대상 URL은 서버 고정 → SSRF 불가).
   임베딩 모델은 생성 모델과 별개: `ollama pull bge-m3`(다국어) 권장. */
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'bge-m3';
let EMBED_RUNNING = 0;
function ollamaEmbed(texts, cb) {
  let done = false;
  const fin = (err, vecs) => { if (done) return; done = true; cb(err, vecs); };
  let u;
  try { u = new URL('/api/embed', OLLAMA_URL); } catch (e) { return fin(new Error('OLLAMA_URL 오류')); }
  const req = http.request(u, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, r => {
    let data = '';
    r.on('data', d => { data += d; });
    r.on('end', () => {
      try {
        const j = JSON.parse(data);
        if (Array.isArray(j.embeddings)) return fin(null, j.embeddings);
        fin(new Error(j.error ? String(j.error).slice(0, 200) : '임베딩 응답 형식 오류'));
      } catch (e) { fin(new Error('임베딩 응답 파싱 실패')); }
    });
  });
  req.on('error', e => fin(new Error('Ollama 연결 실패 (' + (e.code || e.message) + ')')));
  req.setTimeout(60000, () => { req.destroy(); fin(new Error('임베딩 시간 초과')); });
  req.end(JSON.stringify({ model: EMBED_MODEL, input: texts }));
}

/* ── 프롬프트 빌더 4종 — 각 라우트의 입력 검증 + 프롬프트 조립 + 응답 포장을 한 곳에.
   반환: { error } 또는 { prompt, model, wrap }. 스트림/논스트림 두 경로가 같은 빌더를 쓴다. */

/* 내 요약 채점 — 원문과 대조. 원문은 참조만, 새 요약을 대신 쓰지 않는다(모범요약은 짧게 예시로만). */
function buildCoach(body) {
  const summary = String(body.summary || '').slice(0, 8000).trim();
  const source = String(body.source || '').slice(0, 6000).trim();
  const lang = body.lang === 'en' ? 'en' : 'ko';
  if (!summary) return { error: '내 요약이 비어 있어요.' };
  if (!source) return { error: '원문이 없어요.' };
  // 프롬프트: 스키마를 '값이 든 템플릿'으로 주면 8B가 그 예시 문자열을 그대로 베낀다 →
  // 키를 산문으로 설명(값 예시 없이)하고 실제 [원문]/[요약]만 뒤에 붙인다.
  const prompt = lang === 'ko'
    ? '너는 국어 선생님이다. 학생이 아래 [원문]을 읽고 [학생요약]을 썼다.\n'
      + '학생요약이 원문의 핵심을 잘 담았는지 채점해라. 원문을 대신 요약하지 말고 학생요약을 평가만 해라.\n'
      + '아래 키를 가진 JSON 하나만 한국어로 출력해라(각 항목은 원문과 학생요약의 실제 내용으로 채운다):\n'
      + '- score: 0~100 정수(핵심 반영도)\n'
      + '- missing: 원문의 핵심인데 학생요약에 빠진 내용들의 배열\n'
      + '- redundant: 학생요약에서 불필요하거나 늘어진 부분들의 배열(없으면 [])\n'
      + '- accuracy: 학생요약에서 사실과 다른 부분들의 배열(없으면 [])\n'
      + '- model_summary: 원문 내용을 한두 문장으로 요약한 모범답안(문자열)\n'
      + '- comment: 학생에게 주는 격려 한 문장\n\n'
      + '[원문]\n' + source + '\n\n[학생요약]\n' + summary
    : 'You are an English tutor. The student read the [SOURCE] and wrote [NOTES] (comprehension/translation notes).\n'
      + 'Do NOT summarize the source for them. Only evaluate their notes and help them learn.\n'
      + 'Output ONE JSON object with these keys (fill each from the actual SOURCE and NOTES):\n'
      + '- score: integer 0-100 (comprehension quality)\n'
      + '- missing: array of key points from the source the student missed\n'
      + '- corrections: array of misunderstandings/mistranslations to fix (empty [] if none)\n'
      + '- key_expressions: array of {"en": useful phrase from the source, "ko": its Korean meaning}\n'
      + '- model_summary: a 1-2 sentence model summary of the SOURCE, in English (string)\n'
      + '- comment: one encouraging remark in Korean\n\n'
      + '[SOURCE]\n' + source + '\n\n[NOTES]\n' + summary;
  return { prompt, model: OLLAMA_MODEL, wrap: obj => ({ ok: true, lang, feedback: obj }) };
}

/* 어휘 도우미 — 지문에서 클릭/선택한 단어 하나의 뜻·예문(원문 문맥 반영). */
function buildVocab(body) {
  const word = String(body.word || '').slice(0, 80).trim();
  const context = String(body.context || '').slice(0, 600).trim();
  const lang = body.lang === 'en' ? 'en' : 'ko';
  if (!word) return { error: '단어가 없어요.' };
  const prompt = lang === 'en'
    ? 'Explain the English word/phrase below to a Korean learner, using the sentence context.\n'
      + 'Output ONE JSON object with keys: word(the word), pos(품사 in Korean), '
      + 'meaning(문맥에 맞는 한국어 뜻), example(a natural English example sentence), example_ko(그 예문의 한국어 해석).\n\n'
      + 'WORD: ' + word + '\nCONTEXT: ' + context
    : '아래 [문맥]에서 단어 "' + word + '"가 쓰인 의미를 국어사전 뜻에 근거해 정확히 설명해라.\n'
      + 'JSON 하나만 출력: 키는 word(그 단어), meaning(문맥에 맞는 뜻), '
      + 'synonyms(그 의미의 유의어 배열), example(그 단어를 같은 의미로 쓴 새 예문 문자열).\n\n'
      + '단어: ' + word + '\n[문맥]\n' + context;
  return { prompt, model: OLLAMA_MODEL, wrap: obj => ({ ok: true, lang, vocab: obj }) };
}

/* 증시 브리핑 — 그날 지수 등락 + 뉴스 헤드라인을 묶어 "왜 이렇게 움직였나"를 해설.
   ⚠ 숫자를 새로 지어내지 않는다(주어진 등락만 사용). 뉴스와 등락을 잇는 서사만 만든다. */
function buildBrief(body) {
  const indices = Array.isArray(body.indices) ? body.indices.slice(0, 20) : [];
  const headlines = Array.isArray(body.headlines) ? body.headlines.slice(0, 25) : [];
  if (!indices.length && !headlines.length) return { error: '브리핑할 데이터가 없어요 — 먼저 수집하세요.' };
  const idxLines = indices
    .map((i) => `- ${String(i.name || i.symbol || '').slice(0, 30)}: ${Number(i.changePct).toFixed(2)}% (${i.price})`)
    .join('\n');
  const newsLines = headlines
    .map((h, n) => `${n + 1}. ${String(h.title || '').slice(0, 160)}${h.source ? ' [' + String(h.source).slice(0, 20) + ']' : ''}`)
    .join('\n');
  const prompt =
    '너는 금융시장 브리핑 애널리스트다. 아래 [지수]의 오늘 등락과 [뉴스] 헤드라인이 주어진다.\n'
    + '주어진 숫자만 사용하고 새 수치를 지어내지 마라. 뉴스와 지수 움직임을 연결해 "오늘 왜 이렇게 움직였나"를 한국어로 해설해라.\n'
    + '아래 키를 가진 JSON 하나만 출력해라(실제 [지수]/[뉴스] 내용으로 채운다):\n'
    + '- overview: 오늘 시장을 2~3문장으로 요약(문자열)\n'
    + '- drivers: 오늘 움직임의 동인 배열, 각 항목은 {"title": 짧은 제목, "detail": 한두 문장 설명}\n'
    + '- watch: 앞으로 지켜볼 포인트들의 배열(문자열 배열)\n'
    + '- caveat: 이 해설은 지연·요약 데이터 기반 참고용이라는 한 문장 경고\n\n'
    + '[지수]\n' + (idxLines || '(지수 데이터 없음)') + '\n\n[뉴스]\n' + (newsLines || '(뉴스 없음)');
  return { prompt, model: MARKETS_MODEL, wrap: obj => ({ ok: true, brief: obj }) };
}

/* 주간 회고 코치 — 앱이 이미 계산한 결정적 인사이트(오답 쏠림·반복 약점·백지 통과율 등)를 받아
   '다음 주에 무엇을 어떻게 바꿀지'를 한국어로 구체화한다. 숫자를 새로 지어내지 않는다(주어진 사실만). */
function buildReview(body) {
  const facts = Array.isArray(body.facts) ? body.facts.slice(0, 20).map((f) => String(f).slice(0, 300)) : [];
  const weak = Array.isArray(body.weakSpots) ? body.weakSpots.slice(0, 8).map((w) => String(w).slice(0, 120)) : [];
  if (!facts.length && !weak.length) return { error: '회고할 데이터가 없어요 — 이번 주 기록이 필요해요.' };
  const prompt =
    '너는 학습 코치다. 아래 [사실]은 이번 주 학습 데이터에서 이미 계산된 관찰이고, [반복약점]은 여러 번 막힌 지점이다.\n'
    + '주어진 사실만 사용하고 새 수치를 지어내지 마라. 다음 주에 무엇을 어떻게 바꿀지 구체적·실행 가능한 조언을 한국어로 준다.\n'
    + '아래 키를 가진 JSON 하나만 출력해라:\n'
    + '- headline: 이번 주를 한 문장으로 요약(문자열)\n'
    + '- actions: 다음 주 실행 항목 배열(각 항목은 짧고 구체적인 문자열, 2~4개)\n'
    + '- focus: 가장 먼저 손봐야 할 개념/습관 하나(문자열)\n'
    + '- encourage: 격려 한 문장(문자열)\n\n'
    + '[사실]\n' + (facts.join('\n') || '(없음)') + '\n\n[반복약점]\n' + (weak.join('\n') || '(없음)');
  return { prompt, model: OLLAMA_MODEL, wrap: obj => ({ ok: true, coach: obj }) };
}

/* Ollama 라우트 테이블 — 4개 엔드포인트가 같은 가드(Origin·동시캡)와 스트림/논스트림 분기를 공유. */
const OLLAMA_ROUTES = {
  '/api/reads/coach': buildCoach,
  '/api/reads/vocab': buildVocab,
  '/api/markets/brief': buildBrief,
  '/api/review/coach': buildReview,
};

/* 동시 도구 실행 캡 — 30분짜리 research 스폰이 무한히 쌓이는 것 방지(DoS 가드). */
let RUNNING = 0;
const MAX_RUNNING = 2;

/* 변조 요청 가드 — 다른 사이트가 localhost로 쏘는 단순 POST(CSRF성) 차단.
   Origin/Referer가 있으면 이 서버(또는 vite dev/preview 프록시)여야 한다.
   둘 다 없는 요청(curl·같은 창 스크립트)은 로컬 도구 특성상 허용(§감사 CSRF null-Origin 명문화와 동일 원칙). */
function originOK(req) {
  const raw = req.headers.origin || req.headers.referer || '';
  if (!raw) return true;
  try {
    const h = new URL(raw).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
  } catch (e) { return false; }
}

/* Host 허용목록 — DNS 리바인딩 방어. originOK는 Origin이 *없는* 동종출처 요청을 통과시키는데,
   evil.com이 DNS를 127.0.0.1로 리바인딩하면 그 페이지는 evil.com:PORT와 동종출처가 되어 Origin
   없이 /api를 때릴 수 있다(도구 원격 트리거·ping의 WORK 경로/산출물 열람). Host 헤더는 브라우저가
   localhost로 위조할 수 없으므로(리바인딩 시 Host=evil.com:PORT) 이 한 겹이 그 구멍을 닫는다. */
function hostOK(req) {
  const h = String(req.headers.host || '');
  return h === `127.0.0.1:${PORT}` || h === `localhost:${PORT}` || h === `[::1]:${PORT}`;
}

const server = http.createServer((req, res) => {
  try {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);

    /* ── API ─────────────────────────────────────────── */
    if (url.startsWith('/api/')) {
      // Host 위조 불가 → 리바인딩 페이지의 /api 접근(읽기 포함) 원천 차단. 모든 /api에 선적용.
      if (!hostOK(req)) return sendJSON(res, 403, { ok: false, error: '허용되지 않은 Host' });
      // 능력 탐지: 러닝허브가 제어판 사용 가능한지 확인
      if (url === '/api/ping') return sendJSON(res, 200, { ok: true, server: '러닝허브 제어판', tools: Object.keys(TOOLS), work: WORK });
      // 산출물 읽기
      if (url.startsWith('/api/artifact/')) {
        const name = url.slice('/api/artifact/'.length);
        const f = ARTIFACTS[name];
        if (!f) return sendJSON(res, 404, { ok: false, error: '알 수 없는 산출물' });
        return fs.readFile(f, 'utf8', (err, data) => {
          if (err) return sendJSON(res, 404, { ok: false, error: '아직 생성 안 됨(도구를 먼저 실행)' });
          try { sendJSON(res, 200, { ok: true, data: JSON.parse(data) }); }
          catch (e) { sendJSON(res, 200, { ok: true, raw: data }); }
        });
      }
      // 도구 실행 — 비-로컬 Origin 거부 + 동시 실행 캡.
      if (url.startsWith('/api/run/') && req.method === 'POST') {
        if (!originOK(req)) return sendJSON(res, 403, { ok: false, error: '허용되지 않은 출처' });
        if (RUNNING >= MAX_RUNNING) return sendJSON(res, 429, { ok: false, error: '이미 실행 중인 도구가 많아요 — 잠시 후 다시.' });
        const tool = url.slice('/api/run/'.length);
        return readBody(req, body => {
          RUNNING++;
          const done = r => { RUNNING = Math.max(0, RUNNING - 1); sendJSON(res, 200, r); };
          if (tool === 'research') return runResearch(body.topic, body.scope, done);
          const extra = [];
          // frontier/gaps 과목 필터 등. dash-접두 값은 파이썬 CLI에서 *플래그*로 오해석될 수 있어 거부
          // (정상 과목명은 '-'로 시작하지 않음 → 실사용 영향 0. '--' 리터럴 주입은 비-argparse 도구를 깨서 회피).
          if (body.subject && typeof body.subject === 'string') {
            const sub = body.subject.slice(0, 60);
            if (sub && !sub.startsWith('-')) extra.push(sub);
          }
          runTool(tool, extra, done);
        });
      }
      // Ollama 프록시 4종(코치·어휘·브리핑·회고) — 비-로컬 Origin 거부 + 동시 캡 공유.
      // body.stream === true면 NDJSON 스트림(토큰 델타 → 최종 JSON), 아니면 기존 단발 JSON.
      if (OLLAMA_ROUTES[url] && req.method === 'POST') {
        if (!originOK(req)) return sendJSON(res, 403, { ok: false, error: '허용되지 않은 출처' });
        if (OLLAMA_RUNNING >= MAX_OLLAMA) return sendJSON(res, 429, { ok: false, error: 'AI가 이미 처리 중이에요 — 잠시 후 다시.' });
        return readBody(req, body => {
          const spec = OLLAMA_ROUTES[url](body);
          if (spec.error) return sendJSON(res, 200, { ok: false, error: spec.error });
          OLLAMA_RUNNING++;
          let released = false;
          const release = () => { if (released) return; released = true; OLLAMA_RUNNING = Math.max(0, OLLAMA_RUNNING - 1); };
          if (body.stream === true) return ollamaChatStream(spec, res, release);
          ollamaChat(spec.prompt, (err, obj) => {
            release();
            if (err) return sendJSON(res, 200, { ok: false, error: err.message });
            sendJSON(res, 200, spec.wrap(obj));
          }, spec.model);
        });
      }
      // 임베딩 — 의미 검색·지식맵 자동 연결. 텍스트→벡터만(모델·대상은 서버 고정). 배치 32×3000자 캡.
      if (url === '/api/embed' && req.method === 'POST') {
        if (!originOK(req)) return sendJSON(res, 403, { ok: false, error: '허용되지 않은 출처' });
        if (EMBED_RUNNING >= 1) return sendJSON(res, 429, { ok: false, error: '임베딩이 이미 처리 중이에요 — 잠시 후 다시.' });
        return readBody(req, body => {
          const texts = Array.isArray(body.texts) ? body.texts.slice(0, 32).map(t => String(t).slice(0, 3000)) : [];
          if (!texts.length) return sendJSON(res, 200, { ok: false, error: '임베딩할 텍스트가 없어요.' });
          EMBED_RUNNING++;
          ollamaEmbed(texts, (err, vectors) => {
            EMBED_RUNNING = Math.max(0, EMBED_RUNNING - 1);
            if (err) return sendJSON(res, 200, { ok: false, error: err.message });
            sendJSON(res, 200, { ok: true, model: EMBED_MODEL, vectors });
          });
        });
      }
      return sendJSON(res, 404, { ok: false, error: 'API 경로 없음' });
    }

    /* ── 정적 파일(web/dist) + SPA history 폴백 ─────────── */
    let urlPath = url;
    if (urlPath === '/' || urlPath.endsWith('/')) urlPath += 'index.html';
    const filePath = path.normalize(path.join(DIST, urlPath));
    // 접두 검사만으론 형제 폴더(dist-backup 등) 탈출 가능 → 구분자 포함 접두로 봉쇄.
    if (filePath !== DIST && !filePath.startsWith(DIST + path.sep)) { res.writeHead(403); res.end('403 Forbidden'); return; }
    fs.stat(filePath, (err, st) => {
      if (!err && st.isFile()) {
        const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
        // /assets/(콘텐츠 해시 파일명)은 1년 immutable. /fonts/도 사실상 불변(교체 시 파일명 변경 관례)이라
        // 장기 캐시 — 없으면 2MB 폰트가 검증자 부재로 매 로드 전체 재전송된다. 그 외(index.html 등)는 no-cache.
        const cache = urlPath.startsWith('/assets/') || urlPath.startsWith('/fonts/')
          ? 'public, max-age=31536000, immutable' : 'no-cache';
        sendFile(req, res, filePath, type, cache);
        return;
      }
      // 미매칭 GET(딥링크 /stats 등) → index.html 반환(클라이언트 라우팅). 확장자 있는 자원은 404.
      if (req.method === 'GET' && !path.extname(path.basename(urlPath))) {
        const indexPath = path.join(DIST, 'index.html');
        return fs.stat(indexPath, (e2, st2) => {
          if (e2 || !st2.isFile()) {
            res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('빌드물이 없습니다. `cd web && npm run build` 후 다시 시도하세요. (개발은 `cd web && npm run dev` :5173)');
          } else {
            sendFile(req, res, indexPath, MIME['.html'], 'no-cache');
          }
        });
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found: ' + urlPath);
    });
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('500: ' + (e && e.message || e));
  }
});

/* ── stdout 파서: 도구 텍스트 → 러닝허브가 바로 그릴 수 있는 수치 ── */
function parseKnowledgeBuild(out) {
  const m = out.match(/노트 (\d+)개[\s\S]*?전체숙달 ([\d.]+)/);
  const s = out.match(/숙달 (\d+) · 학습중 (\d+) · 약점 (\d+) · 미관측 (\d+)[\s\S]*?프런티어[^\d]*(\d+)/);
  return { notes: m ? +m[1] : null, overall: m ? +m[2] : null,
    mastered: s ? +s[1] : null, learning: s ? +s[2] : null, weak: s ? +s[3] : null,
    unknown: s ? +s[4] : null, frontier: s ? +s[5] : null };
}
function parseVaultHealth(out) {
  const grab = (re) => { const m = out.match(re); return m ? +m[1] : null; };
  return { notes: grab(/노트[^\d]*(\d+)/), verified: grab(/verified[^\d]*(\d+)/i) || grab(/검증[^\d]*(\d+)/),
    flags: grab(/플래그[^\d]*(\d+)/), orphans: grab(/고립[^\d]*(\d+)/), deadlinks: grab(/(?:데드|끊긴)[^\d]*(\d+)/),
    healthy: /✅|양호/.test(out) };
}
function parseEval(out) {
  const m = out.match(/노트 (\d+)개 · 코퍼스 평균 ([\d.]+)/);
  return { notes: m ? +m[1] : null, corpus_mean: m ? +m[2] : null, regressed: /✗ (?:회귀|코퍼스|구조)/.test(out) };
}
function parseAnkiSignal(out) {
  const m = out.match(/orphan[_\s]*rate[^\d]*([\d.]+)/i) || out.match(/고아[^\d]*(\d+)/);
  return { raw: out.slice(-400) };
}
function parseReadsCollect(out) {
  const m = out.match(/수집 (\d+)편 \(영어 (\d+) · 한국어 (\d+)\)/);
  return { collected: m ? +m[1] : null, en: m ? +m[2] : null, ko: m ? +m[3] : null };
}
function parseMarketsCollect(out) {
  const m = out.match(/수집 지수 (\d+)종 · 뉴스 (\d+)편/);
  return { indices: m ? +m[1] : null, news: m ? +m[2] : null };
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`포트 ${PORT}이 이미 사용 중입니다. 다른 포트로: node serve.js 5500`);
  else console.error(e.message || e);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`러닝허브(React) + 제어판 실행 중 → http://localhost:${PORT}/`);
  if (!fs.existsSync(path.join(DIST, 'index.html'))) console.log('  ⚠ web/dist 없음 — `cd web && npm run build` 먼저 실행하세요.');
  console.log(`  제어판 도구: ${Object.keys(TOOLS).join(', ')}, research`);
  console.log('종료: Ctrl+C');
});
