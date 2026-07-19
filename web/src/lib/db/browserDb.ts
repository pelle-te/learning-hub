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
}

/** OPFS 를 못 잡아 인메모리로 내려갔는가. 화면이 이 사실을 말해야 한다(워커 머리주석). */
let _durable = false;
export function isDurable(): boolean {
  return _durable;
}

let _seq = 0;
const _waiting = new Map<number, { resolve: (r: DbResponse) => void; reject: (e: Error) => void }>();

/* ⚠ `Omit<DbRequest,'id'>` 는 여기서 틀린다 — 유니온에 그냥 걸면 **공통 속성만 남아**
   `sql`·`bind` 가 사라진다. 조건부 타입으로 감싸야 각 갈래에 개별 적용된다(분배 법칙). */
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

function call(worker: Worker, req: WithoutId<DbRequest>): Promise<DbResponse> {
  const id = ++_seq;
  return new Promise((resolve, reject) => {
    _waiting.set(id, { resolve, reject });
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
    const worker = new Worker(new URL('./sqlite.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<DbResponse>): void => {
      const w = _waiting.get(ev.data.id);
      if (!w) return;
      _waiting.delete(ev.data.id);
      if (ev.data.ok) w.resolve(ev.data);
      else w.reject(new Error(ev.data.error));
    };
    /* 워커가 통째로 죽으면(스크립트 로드 실패·wasm 미지원) 대기 중인 약속이 **영원히 안
       풀린다** — 그러면 부팅이 멈춘 채 화면이 아무 말도 안 한다. 전부 깨워서 실패시킨다. */
    worker.onerror = (): void => {
      for (const [, w] of _waiting) w.reject(new Error('SQLite 워커가 죽었습니다.'));
      _waiting.clear();
    };

    const opened = await call(worker, { kind: 'open' });
    if (!opened.ok || opened.kind !== 'open') throw new Error('SQLite 를 열지 못했습니다.');
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
    };
  })();

  try {
    return await _handle;
  } catch (e) {
    // `sqlite.ts` 와 같은 규약: 조용히 삼키지 않고, 한 번 실패가 영구 불능이 되지 않게 한다.
    console.error('[db] 폰 SQLite 초기화 실패 — 로컬 캐시 없이 돕니다.', e);
    _handle = null;
    return null;
  }
}
