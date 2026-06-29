/* ============================================================
   idb.ts — IndexedDB write-through 미러(레거시 state.js의 IDB 경로 이식).
   localStorage가 동기 1차 저장, IDB엔 같은 스냅샷을 비동기 미러 →
   '사이트 데이터 삭제'로 localStorage가 전소해도 IDB로 복구 가능.
   indexedDB 미지원(노드/테스트)에선 전부 no-op라 동기 경로 불변.
============================================================ */
const IDB_NAME = 'learning_hub';
const IDB_STORE = 'kv';
const IDB_VER = 1;
let _conn: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('no-idb'));
  if (_conn) return _conn;
  _conn = new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open(IDB_NAME, IDB_VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => {
      _conn = null;
      rej(r.error);
    };
  });
  return _conn;
}

/** persist마다 호출 — 실패해도 앱 영향 0(비차단). key로 앱상태('state')·UI설정('ui')을 분리 미러. */
export function idbMirror(json: string, key: string = 'state'): void {
  if (typeof indexedDB === 'undefined') return;
  open()
    .then((db) => {
      try {
        db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).put(json, key);
      } catch {
        _conn = null;
      }
    })
    .catch(() => {});
}

/** 최신 미러 1건(JSON 문자열|null). key 기본 'state'(앱상태). */
export function idbLoad(key: string = 'state'): Promise<string | null> {
  return open().then(
    (db) =>
      new Promise<string | null>((res, rej) => {
        const g = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
        g.onsuccess = () => res((g.result as string) || null);
        g.onerror = () => rej(g.error);
      }),
  );
}
