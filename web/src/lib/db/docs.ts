/* ============================================================
   db/docs.ts — **AppState 에 속하지 않는 사용자 저작물**의 저장소(4단계-J).

   대상: 내 요약·독후감(`lh:reads`) · 진로 메모(`atlas.notes`) · 즐겨찾기(`atlas.stars`).
   2단계가 "사용자 저작물이라 정본과 같은 곳에 있는 게 맞다"고 적고 4단계로 미뤄 둔 항목이고,
   **5단계가 그 빚을 청구한다** — 모바일 뷰는 폰이 PC 의 SQLite 를 직접 읽는 모델이라
   localStorage 에 남은 저작물은 폰에서 **원리적으로 안 보인다**.

   ## ⚠ 동기 시그니처를 지켜야 한다 — 이게 이 파일의 설계 제약 전부다

   `loadReads()` 는 **동기**이고 팔레트·Reads 탭이 **렌더 경로에서** 부른다. SQLite 는 비동기라
   정면 충돌한다. 2단계-A 가 `AppState` 에서 같은 충돌을 만났을 때 고른 답을 그대로 쓴다:
   **부팅에 한 번 읽어 메모리에 올리고, 이후 읽기는 메모리에서 동기로 준다**(`preloadedState`
   와 같은 관용구). 쓰기만 비동기로 흘려보낸다.

   게이트 컴포넌트(로딩 플래그) 방식을 쓰지 않는 이유도 2단계-A 와 같다 — "하이드레이션 전에
   쓰기가 일어나면 기본값이 실데이터를 덮는" 새 실패 모드를 만들고, 그건 0단계-E 에서 이미 한 번
   물린 부류다(*낡은 메모리가 복원본을 덮는다*).

   ## 브라우저에선 그대로 localStorage 다

   `npm run dev` 와 트랙 A 는 Chromium 이라 SQLite 가 없다. `docGet`/`docSet` 이 그 분기를
   흡수하므로 **소비처(`reads.ts`·`sidecars.ts`)는 어디에 저장되는지 모른다.**
============================================================ */
import { storage } from '../kv';
import { isTauri } from '../tauri';
import { execDb, isSqlitePrimary, selectDb } from './sqlite';
import { nextStamp } from './stamp';

/** SQLite 로 옮긴 키. 여기 없는 키는 `docGet`/`docSet` 이 localStorage 로 그대로 흘린다 —
 *  `lh_ui_v1`(테마·액센트)은 **기기별 설정**이라 일부러 안 옮겼다(폰은 폰의 설정을 쓴다).
 *  `lh:research-history` 도 남겼다: 탐구 *결과*는 볼트에 파일로 남고 이건 화면용 목록이다. */
/** PC → 폰 단방향 산출물 미러(`lib/artifactMirror.ts`). 키 공간의 주인이 여기라 여기서 선언한다
 *  — 반대로 두면 `artifactMirror ↔ docs` 순환 import 가 되고, 로드 순서에 따라 `DOC_KEYS` 가
 *  TDZ 로 터진다(둘 중 어느 모듈이 먼저 평가되느냐에 달린 조용한 폭탄). */
export const MIRROR_DOC_KEYS = ['artifact:reads', 'artifact:markets'] as const;

export const DOC_KEYS = ['lh:reads', 'atlas.notes', 'atlas.stars', ...MIRROR_DOC_KEYS] as const;
export type DocKey = (typeof DOC_KEYS)[number];

const isDocKey = (k: string): k is DocKey => (DOC_KEYS as readonly string[]).includes(k);

/** 부팅에 채우는 메모리 사본. `null` = 아직 안 읽음(브라우저이거나 초기화 전). */
let _cache: Map<string, string> | null = null;

/* ⚠ `updated_at` 을 **반드시 함께 쓴다**(5단계-D 결함 정정).
   `INSERT OR REPLACE` 는 행을 지우고 다시 넣으므로, 이 열을 빼면 매 저장마다
   `DEFAULT 0` 으로 되돌아간다. `db.rs` v3 이 **0 = "아주 오래된 것 = 상대가 이긴다"** 로
   규정했으니, 그대로 두면 LWW 병합에서 **PC 가 쓴 저작물이 폰 사본에게 항상 진다.**
   내 요약·독후감·진로 메모는 정본이 따로 없는 사용자 저작물이라 유실이 곧 소실이다.

   ⚠ 남은 갭 — `docs` 는 `rows.ts` 의 `TABLES` 에 없어 `diffRows` 가 손대지 않는다.
   즉 **툼스톤이 없다**(키를 지워도 삭제 사실이 안 남는다). 저작물 삭제는 드물고 지금은
   병합 엔진 자체가 없어 실害가 없지만, 5-F 전에 `TableSpec` 편입 또는 전용 동기화 경로를
   명시해야 한다. 이 파일이 `AppState` 매퍼와 분리된 이유는 `db.rs:76-78` 참조. */
const DOC_UPSERT = 'INSERT OR REPLACE INTO docs (key, value, updated_at) VALUES (?1, ?2, ?3)';

/** 부팅 시 1회 — DB 의 저작물을 메모리로 끌어올린다. 실패는 조용히 넘긴다(호출부가 localStorage 로 폴백).
 *
 *  ⚠ 조건이 **`isTauri()` 가 아니라 `isSqlitePrimary()`** 다(C-6 이 만든 구분 · CLAUDE.md 가
 *  경고한 그 부류). 폰은 Tauri 가 아닌데 SQLite 가 정본이라, `isTauri()` 로 막으면 동기화로
 *  내려온 `docs` 행을 **읽지도 쓰지도 못한다** — 읽기는 빈 화면이 되고 쓰기는 폰 localStorage 로
 *  새어 아웃박스에 안 걸린다(= 영원히 동기화되지 않는 편집). C-6 이 `AppState` 경로에서만
 *  이 조건을 바꾸고 `docs` 를 놓쳤다. */
export async function initDocs(): Promise<void> {
  if (!isSqlitePrimary()) return;
  const rows = await selectDb<{ key: string; value: string }>('SELECT key, value FROM docs');
  if (!rows) return; // DB 미가용 — _cache 를 null 로 두어 localStorage 경로가 살아 있게 한다
  const map = new Map(rows.map((r) => [r.key, r.value]));

  /* 1회 이관 — 빈 docs 를 "새 사용자"가 아니라 "아직 안 옮겨졌다"로 읽는다.
     `initAppStore` 가 `AppState` 에 대해 하는 것과 같은 판단이고, 안 하면 셸로 넘어온 사용자의
     **요약·독후감이 조용히 사라진 것처럼 보인다**(localStorage 엔 그대로 있는데 화면이 빈다).
     ⚠ 여기만은 **셸 전용**이다 — 폰의 빈 docs 는 "아직 클라우드에서 안 받았다"이지 이관 대상이
     아니고, 폰 오리진의 localStorage 에 뭔가 있다면 그건 **남의 데이터**다
     (`initPhoneStore` 가 `AppState` 에 대해 같은 이유로 이관을 안 하는 것과 짝). */
  if (map.size === 0 && isTauri()) {
    for (const k of DOC_KEYS) {
      const v = storage.getItem(k);
      if (v != null) {
        map.set(k, v);
        void execDb(DOC_UPSERT, [k, v, nextStamp()]);
      }
    }
  }
  _cache = map;
}

/** 저작물 읽기(**동기**) — 셸이면 메모리, 아니면 localStorage. */
export function docGet(key: string): string | null {
  if (_cache && isDocKey(key)) return _cache.get(key) ?? null;
  return storage.getItem(key);
}

/** 저작물 쓰기 — 셸이면 메모리 즉시 + DB 비동기, 아니면 localStorage(동기).
 *  반환은 **동기 성공 여부**다: 셸에선 메모리 반영이 곧 화면 반영이라 항상 true 이고,
 *  브라우저에선 쿼터 초과가 여기서 드러난다(호출부가 그걸로 안내한다). */
export function docSet(key: string, value: string): boolean {
  if (_cache && isDocKey(key)) {
    _cache.set(key, value);
    /* ⚠ DB 쓰기 실패를 삼키지 않는다 — 정본을 쥔 층의 침묵이 2단계-E 에서 원인 추적을 막았다.
       사용자 토스트까지 띄우진 않는다: 메모리엔 있어 화면은 정상이고, 다음 저장이 다시 시도한다. */
    void execDb(DOC_UPSERT, [key, value, nextStamp()]).then((ok) => {
      if (!ok) console.error('[docs] 저장 실패:', key);
    });
    return true;
  }
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false; // 저장공간 가득 — 호출부가 안내
  }
}

/** 테스트 전용 — 메모리 사본을 비워 브라우저 경로로 되돌린다. */
export function _resetDocs(): void {
  _cache = null;
}
