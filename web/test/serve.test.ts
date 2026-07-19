/* ============================================================
   serve.test.ts — serve.js 회귀 테스트 (0단계-A).

   **이 파일이 4단계(serve.js 해체 → Rust) 의 동등성 명세다.**
   지금까지 이 서버의 방어는 전부 *주석*으로만 존재했다(프로토타입 가드·1MB 413 선전송·
   형제 폴더 탈출 차단·stdout 캡·UTF-8 청크 경계…). 주석은 포팅 때 따라오지 않는다.
   여기 잠근 동작이 Rust 구현이 통과해야 할 계약이다 — 항목을 지우려면 계약을 바꾸는 것이므로
   설계문서(플랫폼개편-설계 §4단계)와 함께 고칠 것.

   serve.js 는 CJS + 저장소 루트(web/ 밖)라 vite 변환을 태우지 않고 createRequire 로 직접 읽는다.
   `require.main !== module` 이므로 import 만으로는 리슨하지 않는다(0단계-A 에서 분리).
============================================================ */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const require_ = createRequire(import.meta.url);
const SERVE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'serve.js');
const srv = require_(SERVE_PATH);

/* ── 테스트용 req/res 더블 ────────────────────────────────────────── */
class FakeReq extends EventEmitter {
  destroyed = false;
  destroy() {
    this.destroyed = true;
  }
}
function fakeRes() {
  return {
    headersSent: false,
    code: 0 as number,
    body: '' as string,
    writeHead(code: number) {
      this.headersSent = true;
      this.code = code;
    },
    end(b?: string) {
      this.body = b ?? '';
    },
  };
}

describe('readBody — 본문 수집', () => {
  it('멀티바이트 문자가 청크 경계에 걸려도 깨지지 않는다 (U+FFFD 0개)', async () => {
    // 회귀: 청크마다 toString('utf8')을 걸면 한글 3바이트가 청크 경계에서 쪼개져 U+FFFD가 된다
    // (64KB 넘는 한국어 원문을 reads/coach에 POST하면 프롬프트가 오염돼 채점이 틀어졌다).
    const text = '전파공학 안테나 임피던스 정합'.repeat(400);
    const json = JSON.stringify({ topic: text });
    const buf = Buffer.from(json, 'utf8');
    const req = new FakeReq();
    const res = fakeRes();
    const got = new Promise<Record<string, unknown>>((r) => srv.readBody(req, res, r));
    // 1바이트씩 흘려보내면 거의 모든 한글이 경계에 걸린다(최악의 경우 재현).
    for (const byte of buf) req.emit('data', Buffer.from([byte]));
    req.emit('end');
    const parsed = await got;
    expect(parsed.topic).toBe(text);
    expect(String(parsed.topic)).not.toContain('�');
  });

  it('1MB 초과는 413을 **선전송**하고 콜백을 부르지 않는다 (L-13)', async () => {
    // 회귀: 소켓을 그냥 destroy하면 'end'가 안 와 콜백이 영영 안 불리고 클라가 무한 대기한다.
    const req = new FakeReq();
    const res = fakeRes();
    const cb = vi.fn();
    srv.readBody(req, res, cb);
    req.emit('data', Buffer.alloc(1e6 + 1));
    expect(res.code).toBe(413);
    expect(JSON.parse(res.body).ok).toBe(false);
    expect(req.destroyed).toBe(true);
    // 초과 후 늦게 도착한 end로도 콜백이 살아나면 안 된다(이중 소비 방지).
    req.emit('end');
    expect(cb).not.toHaveBeenCalled();
  });

  it('상한은 UTF-16 길이가 아니라 **바이트** 기준이다', async () => {
    // 한글 1자=3바이트 → 40만 자(=120만 바이트)는 .length 기준이면 통과해버린다.
    const req = new FakeReq();
    const res = fakeRes();
    const cb = vi.fn();
    srv.readBody(req, res, cb);
    req.emit('data', Buffer.from('가'.repeat(400000), 'utf8'));
    expect(res.code).toBe(413);
  });

  it('깨진 JSON·빈 본문은 throw 없이 {}', async () => {
    for (const raw of ['{깨진', '']) {
      const req = new FakeReq();
      const got = new Promise((r) => srv.readBody(req, fakeRes(), r));
      if (raw) req.emit('data', Buffer.from(raw));
      req.emit('end');
      expect(await got).toEqual({});
    }
  });
});

describe('runTool — 화이트리스트 + 프로토타입 가드', () => {
  const run = (tool: string, extra: string[] = []) =>
    new Promise<{ ok: boolean; out: string; code: number }>((r) => srv.runTool(tool, extra, r));

  it('화이트리스트 밖 도구는 spawn 없이 거부', async () => {
    const r = await run('rm-rf-everything');
    expect(r.ok).toBe(false);
    expect(r.out).toContain('알 수 없는 도구');
    expect(r.code).toBe(-1);
  });

  it('프로토타입 키는 truthy로 통과하지 못한다 (Object.hasOwn 가드)', async () => {
    // 회귀: TOOLS['constructor']가 truthy로 통과하면 t.cmd.concat이 readBody 소비 콜백 안에서
    // throw → 콜백 재실행 → RUNNING 이중 증가로 /api/run 전체가 429로 영구 마비됐다.
    for (const key of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
      const r = await run(key);
      expect(r.ok, `${key}가 통과했다`).toBe(false);
      expect(r.out).toContain('알 수 없는 도구');
    }
  });

  it('TOOLS 목록 자체가 계약 — 11종 고정(늘리려면 의도적으로)', () => {
    expect(Object.keys(srv.TOOLS).sort()).toEqual(
      [
        'anki-signal',
        'discovery-dismiss',
        'discovery-promote',
        'eval',
        'index-build',
        'knowledge-build',
        'ledger-build',
        'markets-collect',
        'reads-collect',
        'vault-health',
        'vault-stats',
      ].sort(),
    );
    // 전 도구가 python 스크립트 경로 + 고정 인자 배열이어야 한다(shell 미사용의 전제).
    for (const [k, t] of Object.entries(srv.TOOLS) as [string, { cmd: string[]; timeout: number }][]) {
      expect(Array.isArray(t.cmd), k).toBe(true);
      expect(t.cmd[0], k).toMatch(/^pipeline\/_도구\/.+\.py$/);
      expect(t.timeout, k).toBeGreaterThan(0);
    }
  });
});

describe('toolExtraArgs — 위치인자 방어', () => {
  it('dash 접두 값은 거부한다 (파이썬 argparse가 플래그로 오해석)', () => {
    for (const bad of ['-rf', '--force', '-', '--']) {
      expect(srv.toolExtraArgs({ subject: bad }), bad).toEqual([]);
    }
  });

  it('정상 과목명·발견 후보 id는 그대로 단일 인자로', () => {
    expect(srv.toolExtraArgs({ subject: '전자기학' })).toEqual(['전자기학']);
    expect(srv.toolExtraArgs({ subject: 'concept::안테나 임피던스 정합' })).toEqual(['concept::안테나 임피던스 정합']);
  });

  it('200자로 자른다', () => {
    expect(srv.toolExtraArgs({ subject: 'ㄱ'.repeat(500) })[0]).toHaveLength(200);
  });

  it('없음/비문자열/프로토타입 키는 인자 0개', () => {
    expect(srv.toolExtraArgs({})).toEqual([]);
    expect(srv.toolExtraArgs({ subject: 123 })).toEqual([]);
    expect(srv.toolExtraArgs({ subject: '' })).toEqual([]);
    expect(srv.toolExtraArgs(null)).toEqual([]);
    // subject를 프로토타입으로만 가진 객체 — hasOwn 가드가 막는다.
    expect(srv.toolExtraArgs(Object.create({ subject: 'inherited' }))).toEqual([]);
  });
});

describe('research 잡 — 입력 검증 · 출력 캡', () => {
  it('빈/비문자열/200자 초과 topic은 spawn 전에 거부', () => {
    for (const bad of ['', null, undefined, 123, {}, 'ㄱ'.repeat(201)]) {
      expect(srv.startResearch(bad as string, '').error, String(bad).slice(0, 20)).toBeTruthy();
    }
  });

  it('없는 잡 취소는 에러(프로세스 조작 없음)', () => {
    expect(srv.cancelResearch('nope').error).toBeTruthy();
    expect(srv.cancelResearch('').error).toBeTruthy();
  });

  it('publicJob은 stdout을 20KB로 캡하고 내부 핸들(proc)을 노출하지 않는다 (L-12)', () => {
    const job = {
      id: 'r1',
      topic: 't',
      status: 'done',
      code: 0,
      startedAt: 1,
      endedAt: 2,
      out: 'x'.repeat(50000),
      proc: { pid: 999 },
      _canceled: false,
    };
    const pub = srv.publicJob(job);
    expect(pub.out.length).toBe(20000);
    expect(pub).not.toHaveProperty('proc');
    expect(pub).not.toHaveProperty('_canceled');
  });
});

describe('killTree — 트리 종료', () => {
  it('null/undefined에도 throw하지 않는다', () => {
    expect(() => srv.killTree(null)).not.toThrow();
    expect(() => srv.killTree(undefined)).not.toThrow();
  });

  it('자식이 띄운 **손자**까지 정리한다 (실제 프로세스)', async () => {
    // 회귀: proc.kill()은 직속 자식만 죽인다 — python이 띄운 크롤러(손자)는 살아남아 CPU·네트워크를
    // 계속 쓰는데 서버는 잡을 error로 정리해 그 존재조차 몰랐다. 그래서 Windows는 taskkill /T.
    // 목(mock)이 아니라 진짜 프로세스 트리로 검증한다 — serve.js가 로드 시 spawn을 구조분해로
    // 캡처하므로 모듈 스파이가 닿지 않기도 하고, 실제로 죽는지가 이 계약의 전부이기도 하다.
    const cp = require_('child_process') as typeof import('child_process');
    const parent = cp.spawn(
      process.execPath,
      [
        '-e',
        // 손자를 띄우고 그 pid를 stdout으로 알린 뒤, 부모도 계속 살아 있는다.
        "const{spawn}=require('child_process');" +
          "const g=spawn(process.execPath,['-e','setInterval(()=>{},1000)']);" +
          'console.log(g.pid);setInterval(()=>{},1000);',
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const grandPid = await new Promise<number>((resolve, reject) => {
      let buf = '';
      parent.stdout.on('data', (d) => {
        buf += String(d);
        const n = parseInt(buf.trim(), 10);
        if (n) resolve(n);
      });
      parent.on('error', reject);
      setTimeout(() => reject(new Error('손자 pid를 못 받음')), 10000);
    });

    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    expect(alive(grandPid)).toBe(true); // 전제: 손자가 실제로 떠 있다

    srv.killTree(parent);

    // taskkill은 비동기(별도 프로세스)라 폴링으로 수렴을 기다린다.
    const deadline = Date.now() + 15000;
    while (alive(grandPid) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    const grandAlive = alive(grandPid);
    if (grandAlive) {
      try {
        process.kill(grandPid, 'SIGKILL');
      } catch {
        /* 정리 실패는 무시 */
      }
    }
    expect(grandAlive, '손자 프로세스가 살아남았다 — killTree가 트리를 못 잡는다').toBe(false);
  }, 30000);
});

/* ── HTTP 라우터 (실제 서버를 임의 포트로) ────────────────────────── */
describe('HTTP 라우터', () => {
  let port = 0;
  beforeAll(async () => {
    await new Promise<void>((r) => srv.server.listen(0, '127.0.0.1', r));
    port = (srv.server.address() as { port: number }).port;
  });
  afterAll(async () => {
    await new Promise((r) => srv.server.close(r));
  });

  /** hostOK는 Host를 `127.0.0.1:${PORT}`(기본 8000)로 검사하므로 임의 포트로 붙되 헤더는 맞춘다. */
  function req(
    urlPath: string,
    opts: { method?: string; headers?: Record<string, string>; raw?: boolean } = {},
  ): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
      const r = http.request(
        {
          host: '127.0.0.1',
          port,
          path: urlPath,
          method: opts.method || 'GET',
          headers: { host: `127.0.0.1:${srv.PORT}`, ...(opts.headers || {}) },
          // 경로 정규화를 클라이언트가 하지 않도록(traversal 테스트) createConnection 기본 사용.
        },
        (res) => {
          let b = '';
          res.setEncoding('utf8');
          res.on('data', (c) => (b += c));
          res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body: b }));
        },
      );
      r.on('error', reject);
      r.end();
    });
  }

  it('/api/ping — 도구 목록과 워크스페이스 경로를 알린다', async () => {
    const r = await req('/api/ping');
    expect(r.status).toBe(200);
    const j = JSON.parse(r.body);
    expect(j.ok).toBe(true);
    expect(j.tools).toContain('knowledge-build');
    expect(typeof j.work).toBe('string');
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('Host 위조는 전 /api에서 403 (DNS 리바인딩 방어)', async () => {
    const r = await req('/api/ping', { headers: { host: 'evil.com:8000' } });
    expect(r.status).toBe(403);
    expect(JSON.parse(r.body).error).toContain('Host');
  });

  it('비-로컬 Origin은 쓰기 라우트에서 403', async () => {
    const r = await req('/api/run/vault-stats', {
      method: 'POST',
      headers: { origin: 'http://evil.com' },
    });
    expect(r.status).toBe(403);
  });

  it('산출물은 화이트리스트 밖·프로토타입 키를 404로 거부', async () => {
    for (const name of ['nope', '__proto__', 'constructor', 'toString']) {
      const r = await req('/api/artifact/' + name);
      expect(r.status, name).toBe(404);
      expect(JSON.parse(r.body).ok).toBe(false);
    }
  });

  it('알 수 없는 /api 경로는 404 JSON', async () => {
    const r = await req('/api/does-not-exist');
    expect(r.status).toBe(404);
    expect(JSON.parse(r.body).error).toContain('API');
  });

  it('경로 역참조는 403 — 형제 폴더 탈출 포함', async () => {
    // %2e%2e%2f 로 인코딩해 보내야 클라이언트/서버의 조기 정규화를 통과해 실제 가드에 닿는다.
    // dist의 형제(dist-backup 등)는 접두 검사만으론 통과하므로 구분자 포함 접두로 막는다.
    for (const p of [
      '/%2e%2e/serve.js',
      '/%2e%2e/%2e%2e/serve.js',
      '/%2e%2e/dist-backup/secret.txt',
      '/assets/%2e%2e/%2e%2e/package.json',
    ]) {
      const r = await req(p);
      expect(r.status, p).toBe(403);
    }
  });

  it('확장자 있는 미존재 자원은 404(SPA 폴백 아님)', async () => {
    const r = await req('/definitely-missing.js');
    expect(r.status).toBe(404);
  });

  it('확장자 없는 딥링크는 SPA 폴백(index.html · no-cache)', async () => {
    const r = await req('/stats');
    // dist가 아직 없는 상태(빌드 전 CI)에서는 503 + 빌드 안내가 계약이다.
    if (fs.existsSync(path.join(srv.DIST, 'index.html'))) {
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toContain('text/html');
      expect(r.headers['cache-control']).toBe('no-cache');
    } else {
      expect(r.status).toBe(503);
      expect(r.body).toContain('npm run build');
    }
  });

  it('해시 자원(/assets/)은 1년 immutable, index.html은 no-cache', async () => {
    const assetsDir = path.join(srv.DIST, 'assets');
    if (!fs.existsSync(assetsDir)) return; // 빌드 전이면 검증 대상 없음
    const asset = fs.readdirSync(assetsDir).find((f) => f.endsWith('.js') || f.endsWith('.css'));
    if (!asset) return;
    const r = await req('/assets/' + asset);
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('압축 가능한 자원은 gzip 협상 + Vary 표시', async () => {
    if (!fs.existsSync(path.join(srv.DIST, 'index.html'))) return;
    const r = await req('/index.html', { headers: { 'accept-encoding': 'gzip' } });
    expect(r.headers['vary']).toBe('Accept-Encoding');
    expect(r.headers['content-encoding']).toBe('gzip');
  });
});
