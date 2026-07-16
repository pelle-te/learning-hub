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

/* ── 세대 백업(감사 #21) — fallback 부팅 직후 '마지막 미러'를 별도 키로 보존.
   미러('state')는 단일 키 덮어쓰기라, defaults로 부팅한 탭의 첫 flush가 마지막 백업을
   영구 파괴했다(복구 창=12초 토스트뿐). 부팅 복구 안내(BootRecovery)가 미러를 읽은 즉시
   여기로 넘겨 2세대(직전·그 전)로 보존 → 토스트를 놓쳐도 설정/⌘K '복구'가 살릴 수 있다. */
export const IDB_BACKUP_KEY = 'state_backup';
export const IDB_BACKUP2_KEY = 'state_backup2';
export async function idbPreserveBackup(json: string): Promise<void> {
  const prev = await idbGet<string>(IDB_BACKUP_KEY);
  if (prev != null && prev !== json) await idbPut(IDB_BACKUP2_KEY, prev); // 기존 백업은 한 세대 밀어 보존
  await idbPut(IDB_BACKUP_KEY, json);
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

/* ── 임의 값 저장(구조화 복제) — FileSystemDirectoryHandle 같은 non-JSON 값을 영속.
   JSON 미러(idbMirror)와 같은 'kv' 스토어를 키로 구분해 공유한다. 미지원(노드/테스트)에선
   put/del은 no-op, get은 null — 실패해도 앱 영향 0(비차단). */
export function idbPut(key: string, value: unknown): Promise<void> {
  if (typeof indexedDB === 'undefined') return Promise.resolve();
  return open()
    .then(
      (db) =>
        new Promise<void>((res) => {
          try {
            const tx = db.transaction(IDB_STORE, 'readwrite');
            tx.objectStore(IDB_STORE).put(value, key);
            tx.oncomplete = () => res();
            tx.onerror = () => res();
          } catch {
            _conn = null;
            res();
          }
        }),
    )
    .catch(() => {});
}
export function idbGet<T = unknown>(key: string): Promise<T | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return open()
    .then(
      (db) =>
        new Promise<T | null>((res) => {
          try {
            const g = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
            g.onsuccess = () => res((g.result as T) ?? null);
            g.onerror = () => res(null);
          } catch {
            res(null);
          }
        }),
    )
    .catch(() => null);
}
export function idbDel(key: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return Promise.resolve();
  return open()
    .then(
      (db) =>
        new Promise<void>((res) => {
          try {
            const tx = db.transaction(IDB_STORE, 'readwrite');
            tx.objectStore(IDB_STORE).delete(key);
            tx.oncomplete = () => res();
            tx.onerror = () => res();
          } catch {
            _conn = null;
            res();
          }
        }),
    )
    .catch(() => {});
}
