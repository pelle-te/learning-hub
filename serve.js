/* ============================================================
   serve.js — 러닝허브 로컬 정적 서버 (의존성 0 · Node 내장만)

   실행:  node serve.js            (러닝허브 폴더에서 · 기본 포트 8000)
          node serve.js 5500       (포트 지정)

   왜 필요한가: file:// 더블클릭은 ES모듈·fetch·PWA(서비스워커)가 막힌다.
   http://localhost 로 띄우면 그 제약이 풀려 manifest·sw.js가 자동 활성화된다
   (index.html이 location.protocol==='http*'일 때만 주입하도록 이미 분기됨).

   - 127.0.0.1(로컬호스트)에만 바인딩 — 외부 노출 안 함.
   - 경로 역참조(../) 차단 — 러닝허브 폴더 밖 파일은 못 읽음.
   - 캐시 끔(no-store) — 고친 JS/CSS가 새로고침에 바로 반영(개발 편의).
============================================================ */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;                          // 러닝허브 폴더를 웹 루트로
const PORT = Number(process.argv[2]) || 8000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico':  'image/x-icon',
  '.txt':  'text/plain; charset=utf-8',
  '.md':   'text/plain; charset=utf-8',
  '.woff2':'font/woff2',
};

const server = http.createServer((req, res) => {
  try {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath === '/' || urlPath.endsWith('/')) urlPath += 'index.html';
    // 루트 밖 접근 차단(경로 역참조 방어)
    const filePath = path.normalize(path.join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('403 Forbidden'); return; }
    fs.stat(filePath, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 Not Found: ' + urlPath); return; }
      const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      fs.createReadStream(filePath).pipe(res);
    });
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('500: ' + (e && e.message || e));
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`포트 ${PORT}이 이미 사용 중입니다. 다른 포트로: node serve.js 5500`);
  else console.error(e.message || e);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`러닝허브 로컬 서버 실행 중 → http://localhost:${PORT}/`);
  console.log('종료: Ctrl+C');
});
