/* ============================================================
   auth.ts — 기기 단위 인증(C-4 · P0-2 토큰 수명·회전 + P1-4 주체).

   ## ⚠ CPU 10ms 벽이 이 파일의 설계를 강제했다

   무료 Workers 는 요청당 CPU 10ms 다. 그래서 **의도적으로 느린 KDF(bcrypt·scrypt·Argon2)를
   쓸 수 없다** — 비밀번호 로그인이 원천 배제된다. 대신:

   · **액세스 토큰** = HMAC-SHA256 서명된 **자기기술** 토큰. 어디에도 저장하지 않는다.
     서버가 상태를 안 들므로 검증이 마이크로초 단위로 끝난다.
   · **리프레시 토큰** = 긴 난수. D1 에 **해시만** 저장한다.
   · **등록 코드** = PC 가 발급하는 1회용 난수. 역시 **해시만** 저장한다.

   ## ⚠ 비밀을 원문으로 저장하지 않는 이유

   DB 유출이 곧 사칭이 되지 않게 하기 위해서다. 리프레시 토큰·등록 코드는 **우리가 만든
   고엔트로피 난수**(192비트)라, 비밀번호와 달리 사전공격 대상이 아니어서 **SHA-256 한 번으로
   충분하다.** 느린 KDF 가 필요한 이유는 원본이 추측 가능할 때인데 여기는 아니다 —
   즉 CPU 예산 제약과 보안 요구가 여기서 충돌하지 않는다.

   ## ⚠ 토큰을 URL 에 싣지 않는다

   설계서 P0-2 가 지목한 현행 LAN 모델(`server.rs`, URL 에 PSK)의 재현을 막는 것이 이 파일의
   목적 중 하나다. `Authorization: Bearer` 헤더만 받는다 — URL 에 없으면 프록시 로그·Referer·
   브라우저 히스토리 어디로도 새지 않는다.
============================================================ */

/** 액세스 토큰 수명. 짧게 두는 것이 폐기(revoke)의 실효성을 만든다 — 폐기는 리프레시를
 *  즉시 막고, 이미 발급된 액세스 토큰은 이 시간 안에 자연 소멸한다. */
export const ACCESS_TTL_SEC = 15 * 60;

/** 등록 코드 수명. 사람이 PC 에서 폰으로 옮겨 치는 시간이면 충분하다. */
export const ENROLL_TTL_SEC = 10 * 60;

const enc = new TextEncoder();

/* ── 인코딩 헬퍼 ─────────────────────────────────────────────── */

function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  const p = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(p + '='.repeat((4 - (p.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** 암호학적 난수 문자열(기본 192비트). 리프레시 토큰·등록 코드·기기 ID 가 쓴다. */
export function randomToken(bytes = 24): string {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** SHA-256 hex. 저장용 해시 — 원문은 어디에도 남기지 않는다. */
export async function sha256Hex(input: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * ⚠ **상수시간 비교.** 문자열 `===` 는 첫 불일치에서 즉시 빠져나가 **비교 시간이 정답과의
 * 공통 접두 길이를 흘린다.** 토큰 해시를 그렇게 비교하면 원리적으로 한 글자씩 맞춰 나갈 수
 * 있다. `server.rs:101` 의 `ct_eq` 가 같은 이유로 존재하고, 여기서도 같은 규율을 지킨다.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ── 액세스 토큰(HMAC 서명 · 무상태) ─────────────────────────── */

interface TokenPayload {
  /** 기기 id. 이게 곧 주체(principal)다. */
  d: string;
  /** 만료(epoch 초). */
  exp: number;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

/** 액세스 토큰 발급. 형식은 `<payload>.<sig>` (둘 다 base64url). */
export async function issueAccessToken(secret: string, deviceId: string, nowSec: number): Promise<string> {
  const payload: TokenPayload = { d: deviceId, exp: nowSec + ACCESS_TTL_SEC };
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body));
  return `${body}.${b64urlEncode(new Uint8Array(sig))}`;
}

/**
 * 액세스 토큰 검증 → 기기 id. 실패는 **null**(이유를 구분해 돌려주지 않는다 —
 * "서명이 틀렸다"와 "만료됐다"를 구분해 알려 주면 공격자에게 정보를 준다).
 *
 * ⚠ **서명을 먼저 검사하고 그 다음 만료를 본다.** 순서가 반대면 서명되지 않은 payload 를
 * 신뢰해 파싱하게 된다.
 */
export async function verifyAccessToken(secret: string, token: string, nowSec: number): Promise<string | null> {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let ok: boolean;
  try {
    ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), b64urlDecode(sig), enc.encode(body));
  } catch {
    return null; // base64 가 깨진 경우 등 — 형식 오류도 인증 실패로 접는다
  }
  if (!ok) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as TokenPayload;
    if (typeof p.d !== 'string' || typeof p.exp !== 'number') return null;
    if (p.exp <= nowSec) return null;
    return p.d;
  } catch {
    return null;
  }
}

/** `Authorization: Bearer <token>` 에서 토큰만. 없으면 null. ⚠ 쿼리스트링은 **보지 않는다.** */
export function bearerFrom(req: Request): string | null {
  const h = req.headers.get('Authorization');
  if (!h) return null;
  const m = /^Bearer (.+)$/.exec(h.trim());
  return m ? m[1]! : null;
}
