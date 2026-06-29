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
const { spawn } = require('child_process');

const ROOT = __dirname;                          // 러닝허브 폴더
const WORK = path.dirname(ROOT);                 // 작업 폴더(시스템·전공·anki의 부모)
const DIST = path.join(ROOT, 'web', 'dist');     // React 빌드물(정적 서빙 루트)
const PORT = Number(process.argv[2]) || 8000;
const PY = process.env.PYTHON || 'python';

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
};

/* 산출물 파일(읽기 전용 서빙) */
const ARTIFACTS = {
  knowledge: path.join(WORK, '전공', '_meta', '감사', '_지식상태.json'),
  anki:      path.join(WORK, '전공', '_meta', '감사', '_anki신호.json'),
};

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
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

const server = http.createServer((req, res) => {
  try {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);

    /* ── API ─────────────────────────────────────────── */
    if (url.startsWith('/api/')) {
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
      // 도구 실행
      if (url.startsWith('/api/run/') && req.method === 'POST') {
        const tool = url.slice('/api/run/'.length);
        return readBody(req, body => {
          if (tool === 'research') return runResearch(body.topic, body.scope, r => sendJSON(res, 200, r));
          const extra = [];
          if (body.subject && typeof body.subject === 'string') extra.push(body.subject.slice(0, 60)); // frontier/gaps 과목 필터 등
          runTool(tool, extra, r => sendJSON(res, r.ok ? 200 : 200, r));
        });
      }
      return sendJSON(res, 404, { ok: false, error: 'API 경로 없음' });
    }

    /* ── 정적 파일(web/dist) + SPA history 폴백 ─────────── */
    let urlPath = url;
    if (urlPath === '/' || urlPath.endsWith('/')) urlPath += 'index.html';
    const filePath = path.normalize(path.join(DIST, urlPath));
    if (!filePath.startsWith(DIST)) { res.writeHead(403); res.end('403 Forbidden'); return; }
    fs.stat(filePath, (err, st) => {
      if (!err && st.isFile()) {
        const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
        fs.createReadStream(filePath).pipe(res);
        return;
      }
      // 미매칭 GET(딥링크 /stats 등) → index.html 반환(클라이언트 라우팅). 확장자 있는 자원은 404.
      if (req.method === 'GET' && !path.extname(path.basename(urlPath))) {
        return fs.readFile(path.join(DIST, 'index.html'), (e2, data) => {
          if (e2) {
            res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('빌드물이 없습니다. `cd web && npm run build` 후 다시 시도하세요. (개발은 `cd web && npm run dev` :5173)');
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end(data);
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
