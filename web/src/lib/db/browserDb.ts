/* ============================================================
   db/browserDb.ts — 폰용 SQLite 백엔드(C-6a). 워커의 메인 스레드 쪽 절반.

   ## 이 파일이 존재하는 이유 — 두 번째 구현을 만들지 않기 위해

   `cloud/outbox.ts` · `merge.ts` · `run.ts` · `client.ts` 는 전부 **SQL 문자열**을
   `selectDb`/`execDb` 로 흘려보낸다. 폰을 붙이는 방법은 둘이었다:

   | 방법 | 대가 |
   | --- | --- |
   | 동기화 층을 인터페이스로 추상화 → IndexedDB 로 재구현 | LWW 비교·툼스톤 순서·fence 의미론을 **두 번째로** 손코딩 |
   | **`Db` 인터페이스에 브라우저 구현을 하나 더 끼운다** | wasm 의존 + OPFS 가용성 |

   후자를 골랐다. 이 저장소는 쌍둥이 구현으로 **두 번** 물렸고(`rows.ts`↔`rows.rs`,
   경계 파서 2종), 둘 다 "각 구현은 자기 테스트를 통과하는데 둘이 갈라져 있었다"는 형태였다.
   여기서 갈리면 그 결과는 **동기화 유실**이라 대가가 훨씬 크다. 이 방식이면 검증된 SQL 이
   폰에서 **문자 그대로** 돈다 — `roundtrip` 과 `restoreDrill` 이 검사하는 그 경로다.

   ⚠ **`sqlite.ts` 의 `Db` 인터페이스와 모양이 같아야 한다**(`execute`/`select`). 그게 이
   교체가 성립하는 유일한 근거다.
============================================================ */
import type { DbRequest, DbResponse } from './sqlite.worker';

interface Db {
  execute(query: string, values?: unknown[]): Promise<unknown>;
  select<T>(query: string, values?: unknown[]): Promise<T>;
  /** 여러 문장을 한 왕복으로(H-1). 워커에선 트랜잭션으로 감싸 **원자적**이다. */
  batch(stmts: { sql: string; args: unknown[] }[]): Promise<void>;
}

/** OPFS 를 못 잡아 인메모리로 내려갔는가. 화면이 이 사실을 말해야 한다(워커 머리주석). */
let _durable = false;
export function isDurable(): boolean {
  return _durable;
}

let _seq = 0;
const _waiting = new Map<number, { resolve: (r: DbResponse) => void; reject: (e: Error) => void }>();

/**
 * 한 왕복의 응답 시간 상한(H5). 워커가 open 성공 뒤 죽으면 이후 요청은 응답도 `onerror`(1회성)도
 * 못 받아 **영원히 대기**한다(폰 무음 정지).
 *
 * ⭐ **근거가 `[추측]` 이었고 이제 `[측정]` 이다**(P026 · 2026-08-23). 종전 주석은 *"wasm SQLite
 * 연산은 밀리초대라 넉넉히 잡아도 안전"* 이라 단언했는데 **잰 적이 없었다** — 잴 수 없었던 이유는
 * 폰 엔트리에 부팅 마크가 없어서다(데스크톱엔 있었다 · R3 짝).
 * 이제 `phone/main.tsx` 가 `hub:entry`·`hub:app` 을 찍고 `e2e/phone.spec.ts` 가 그 구간을 읽는다.
 * 그 구간은 «워커 기동 + wasm 로드 + OPFS 핸들 + 전량 읽기» 전부이므로 **한 왕복은 그보다 한참
 * 작다.** 즉 이 상수는 부팅 전체의 **수십~수백 배**이고, 「밀리초대」는 참이다.
 *
 * ⚠⚠ **여기 「실측 148.6ms」라 단정돼 있었다 — 단발 측정이 산포 없이 사실로 굳은 것이다**
 * (P039 · 2026-08-27). 같은 구간을 세 회차가 재니 **148.6 / p50 444(296~777, n=6) /
 * p50 238(223~326, n=6)** 로 **3배 범위**에서 흔들렸다. 머신 부하·OPFS 콜드 여부가 그만큼을
 * 가른다. 결론(자릿수)은 세 번 다 같지만, **절대값을 여기 적으면 반드시 낡는다.**
 * → 회차별 실측은 `docs/성능/기준선.json` 이 보존한다(P033 · `e2e/_perfBaseline.ts`).
 *   이 주석은 **자릿수 논거**만 진다.
 *
 * ⚠ 그래도 **줄이지 않는다.** 이 값은 성능 노브가 아니라 **행 감지기**다(워커가 멎으면 영원히
 * 대기하는 것을 끊는 것이 목적) — 크다고 해로운 자리가 아니고, 작으면 느린 기기·콜드 캐시에서
 * 멀쩡한 왕복을 죽인다. 위험은 「너무 길다」가 아니라 「근거 없이 적혀 있다」였고 그쪽을 고쳤다.
 */
const CALL_TIMEOUT_MS = 30_000;

/* ⚠ `Omit<DbRequest,'id'>` 는 여기서 틀린다 — 유니온에 그냥 걸면 **공통 속성만 남아**
   `sql`·`bind` 가 사라진다. 조건부 타입으로 감싸야 각 갈래에 개별 적용된다(분배 법칙). */
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

/* ============================================================
   워커 수명 — **죽었으면 확실히 죽인다**(H13 · 2026-07-30 `/감사 근본`)

   종전엔 이 파일에 `terminate()` 가 **한 번도 없었다**(전 저장소 0건). 결과가 둘이다:

   ① **좀비가 OPFS 락을 쥔다.** 워커가 멎어도(무한 루프·wasm 트랩) 컨텍스트는 살아 있어
      `FileSystemSyncAccessHandle` 을 놓지 않는다. 그 상태로 새 워커를 세우면 SAH 풀을 못 잡아
      **조용히 `:memory:` 로 내려앉는다** — 앱은 정상으로 보이고 저장만 사라진다.
      `terminate()` 는 컨텍스트를 파괴해 그 핸들을 브라우저가 회수하게 하는 유일한 수단이다.
   ② **모든 연산이 30초씩 매달린다.** 타임아웃은 *그 한 호출*만 거절했고 `_handle` 은 멀쩡한
      채였다 → 다음 호출이 같은 죽은 워커에 또 붙어 또 30초를 기다린다. `onerror` 는 핸들을
      무효화하지만 그건 **로드 실패에만** 오고, 열린 뒤 멎는 경우는 그 이벤트가 아예 안 온다.

   그래서 죽이는 자리를 하나로 모은다. 타임아웃은 "느린 연산"이 아니라 **죽음의 증거**로 다룬다 —
   wasm SQLite 연산은 밀리초대라 30초는 정상 범위가 아니고, 오판해도 대가는 워커 재기동뿐이다
   (같은 DB 를 다시 연다). 반대로 안 죽이면 대가가 무음 `:memory:` 다 — 비대칭이 명확하다. */
let _worker: Worker | null = null;

function killWorker(reason: string): void {
  const w = _worker;
  _worker = null;
  _handle = null;
  _durable = false; // 새 워커가 OPFS 를 다시 잡기 전까지 "내구성 있다"고 말하면 안 된다
  for (const [, p] of _waiting) p.reject(new Error(reason));
  _waiting.clear();
  /* ⚠ 마지막에 죽인다 — 먼저 죽이면 대기자들이 이유 없이 매달린 채 남는다. */
  w?.terminate();
}

function call(worker: Worker, req: WithoutId<DbRequest>): Promise<DbResponse> {
  const id = ++_seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      /* ⚠ 이 호출만 거절하지 않는다(H13) — 응답이 없다는 것은 워커가 멎었다는 뜻이고, 그대로
         두면 이후 모든 연산이 30초씩 매달리며 좀비가 OPFS 락을 계속 쥔다. */
      if (_waiting.has(id)) killWorker('SQLite 워커 응답 시간 초과 — 워커를 재기동합니다.');
      else reject(new Error('SQLite 워커 응답 시간 초과 — 워커가 죽었을 수 있습니다.'));
    }, CALL_TIMEOUT_MS);
    _waiting.set(id, {
      resolve: (r) => {
        clearTimeout(timer);
        resolve(r);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    worker.postMessage({ ...req, id } as DbRequest);
  });
}

let _handle: Promise<Db> | null = null;

/**
 * 폰용 SQLite 핸들(지연 로드·1회). 실패하면 **null** — 호출부는 `getDb()` 계약대로
 * "DB 미가용"으로 다룬다(`selectDb` 가 null 을 "모름"으로 취급하는 그 규약).
 */
export async function getBrowserDb(): Promise<Db | null> {
  _handle ??= (async (): Promise<Db> => {
    /* ⚠ 새 워커를 세우기 전에 **직전 것을 반드시 죽인다**(H13). `_handle` 만 null 로 두면
       옛 워커가 살아남아 OPFS 핸들을 쥔 채 새 워커와 경합한다 — 그 결과가 무음 `:memory:` 다. */
    if (_worker) killWorker('SQLite 워커를 재기동합니다.');
    const worker = new Worker(new URL('./sqlite.worker.ts', import.meta.url), { type: 'module' });
    _worker = worker;
    worker.onmessage = (ev: MessageEvent<DbResponse>): void => {
      const w = _waiting.get(ev.data.id);
      if (!w) return;
      _waiting.delete(ev.data.id);
      if (ev.data.ok) w.resolve(ev.data);
      else w.reject(new Error(ev.data.error));
    };
    /* 워커가 통째로 죽으면(스크립트 로드 실패·wasm 미지원) 대기 중인 약속이 **영원히 안
       풀린다** — 그러면 부팅이 멈춘 채 화면이 아무 말도 안 한다. 전부 깨워서 실패시킨다.
       ⚠ `_handle` 도 무효화한다(H5) — 안 하면 다음 `getBrowserDb()` 가 **죽은 워커를 쥔 핸들**을
       그대로 돌려줘 이후 모든 요청이 타임아웃까지 매달린다. null 로 두면 다음 호출이 새 워커를
       세운다(`getBrowserDb` 의 `_handle ??=`). */
    worker.onerror = (): void => killWorker('SQLite 워커가 죽었습니다.');

    const opened = await call(worker, { kind: 'open' });
    if (!opened.ok || opened.kind !== 'open') {
      // 못 열었으면 이 워커는 쓸모가 없다 — 남겨 두면 그대로 좀비다.
      killWorker('SQLite 를 열지 못했습니다.');
      throw new Error('SQLite 를 열지 못했습니다.');
    }
    _durable = opened.durable;

    return {
      async execute(query: string, values: unknown[] = []): Promise<unknown> {
        await call(worker, { kind: 'exec', sql: query, bind: values });
        return undefined;
      },
      async select<T>(query: string, values: unknown[] = []): Promise<T> {
        const r = await call(worker, { kind: 'select', sql: query, bind: values });
        if (!r.ok || r.kind !== 'select') throw new Error('select 응답이 계약과 다릅니다.');
        return r.rows as T;
      },
      async batch(stmts: { sql: string; args: unknown[] }[]): Promise<void> {
        // 워커 프로토콜은 `bind` 를 쓴다(`Db` 계약은 `args`) — 경계에서 맞춘다.
        await call(worker, { kind: 'batch', stmts: stmts.map((s) => ({ sql: s.sql, bind: s.args })) });
      },
    };
  })();

  try {
    return await _handle;
  } catch (e) {
    // `sqlite.ts` 와 같은 규약: 조용히 삼키지 않고, 한 번 실패가 영구 불능이 되지 않게 한다.
    console.error('[db] 폰 SQLite 초기화 실패 — 로컬 캐시 없이 돕니다.', e);
    /* ⚠ `_handle = null` 만으로는 부족하다(H13) — 실패한 워커가 살아남아 OPFS 핸들을 쥔다.
       `open` 이 **거절**로 끝나는 경로는 위 `if (!opened.ok)` 를 지나지 않으므로 여기가
       그 갈래의 유일한 정리 지점이다. */
    killWorker('폰 SQLite 초기화 실패');
    return null;
  }
}
