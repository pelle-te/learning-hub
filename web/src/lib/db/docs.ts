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
import { isTauri } from '../isTauri'; // ⚠ 부팅 경로 — 초소형 모듈에서(H7 · `lib/isTauri.ts` 머리주석)
import { execDb, isSqlitePrimary, selectDb } from './sqlite';
import { runExclusive } from './write';
import { nextStamp } from './stamp';
import { pushUndo, type PreImageRow } from './undoStack'; // H3 — 저작물 쓰기도 ⌘Z 스택에 든다
import { markDbFallback, setSaveFallback } from './fallback'; // C2 — 저작물 쓰기 실패의 표면화

/* ── ⚠⚠ **세입자가 0이다**(P10 W4 · 2026-08-07) ────────────────────────────────
   이 표에는 다섯이 있었다: `lh:reads`(내 요약·독후감) · `atlas.notes`·`atlas.stars`(진로 지도
   메모·관심) · `artifact:reads`·`artifact:markets`(PC→폰 산출물 미러). **다섯 다 그 화면이
   `survey/` 필러로 가면서 사라졌다.**

   왜 배관은 남기나: `docs` 는 P10 이 만든 발판이 아니라 **앱 인프라**다(SQLite 표 · 클라우드
   `DOCS_SPEC.sync` · 아웃박스 · ⌘Z 프리이미지 · pull 뒤 `reloadDocs`). 세입자가 없다고 그것을
   걷으면 스키마 마이그레이션 + 서버 계약 + 왕복 테스트가 한 벌 더 필요한데, 그건 W4 의 범위
   (화면·아티팩트·Rust)가 아니고 되돌리기도 비싸다. 그래서 **빈 채로 두되 빈 것을 명시**한다.
   존치 근거·재검토일은 `docs/유예_원장.md` — 다음 저작물 키가 생기면 여기 한 줄이면 된다.

   ⚠ 빈 배열의 대가: `DocKey` 가 `never` 라 `docGet`/`docSet` 은 **전량 localStorage 로 흐른다**.
   즉 지금 이 파일은 *동작상* 얇은 KV 래퍼이고, SQLite 경로는 세입자가 돌아오는 순간 다시 산다.
   그 사실을 숨기지 않는 것이 요점이다(조용히 죽은 배관이 이 저장소가 반복해 만든 형태다). */
export const DOC_KEYS = [] as const;
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

/**
 * 병합으로 `docs` 행이 바뀐 뒤 메모리 사본을 다시 읽는다(H1).
 *
 * ⚠ `_cache` 는 **부팅에만** 채워진다(`initDocs`). pull 이 받아온 독후감·진로 메모·미러
 * 산출물을 SQLite `docs` 에 병합해도 이 사본은 낡은 채라, 폰 `ReadsView`(`readMirrored`→`docGet`)가
 * 받아온 것을 **다음 앱 재시작까지 못 본다** — C-6 의 "폰에서 읽을거리를 읽는다"를 직접 깎는다.
 * `applyPull` 이 `docs` 행을 병합했으면 이 함수로 사본을 되맞춘다. `initDocs` 와 달리 1회 이관
 * 분기는 없다(이관은 부팅의 관심사이고, 여기는 "받아온 것 반영"만 한다).
 */
export async function reloadDocs(): Promise<void> {
  if (!isSqlitePrimary()) return;
  const rows = await selectDb<{ key: string; value: string }>('SELECT key, value FROM docs');
  if (!rows) return; // DB 미가용 — 기존 사본 유지(빈 사본으로 덮어 화면을 비우지 않는다)
  _cache = new Map(rows.map((r) => [r.key, r.value]));
}

/** 저작물 읽기(**동기**) — 셸이면 메모리, 아니면 localStorage. */
export function docGet(key: string): string | null {
  if (_cache && isDocKey(key)) return _cache.get(key) ?? null;
  return storage.getItem(key);
}

/**
 * 저작물 쓰기 — 셸이면 메모리 즉시 + DB 비동기, 아니면 localStorage(동기).
 * 반환은 **동기 성공 여부**다: 셸에선 메모리 반영이 곧 화면 반영이라 항상 true 이고,
 * 브라우저에선 쿼터 초과가 여기서 드러난다(호출부가 그걸로 안내한다).
 *
 * ## ⚠⚠ `undo` — 전역 ⌘Z 캡처(H3 · 2026-08-01 `/감사 근본` · 사용자 승인)
 *
 * 이 경로는 `writeRows` 가 아니라 별도 `runExclusive(execDb)` 라 **pre-image 가 안 잡혔다.**
 * 결과는 침묵이 아니라 **거짓말**이었다: 독후감을 쓰고 ⌘Z 를 누르면 되돌아가는 것은 *10분 전
 * 챕터 편집*인데 토스트는 "직전 편집을 되돌렸어요"라고 말했다. 사용자는 방금 한 일이 취소된 줄
 * 알고, 실제로는 아무 관련 없는 옛 편집이 사라진다.
 *
 * 기계는 이미 준비돼 있었다 — `docs` 는 `cloud/contract.OUTBOX_TABLES` 에 `DOCS_SPEC` 으로 들어
 * 있고 `merge.applyPull` 이 `docs` 행을 쓰면 `reloadDocs()` 로 사본까지 되맞춘다. **빠진 것은
 * 캡처 하나뿐**이었다.
 *
 * ⚠ **기본값이 `write.ts`(기본 캡처)와 반대인 것이 의도다.** 거기선 `runWrite` 에 닿는 경로가
 * 사용자 flush 하나뿐이라 기본 참이 안전하다. 여기 호출부는 다섯인데 **사용자 편집은 하나**다
 * (`reads.saveReads`) — 나머지 넷은 IDB 복구·`_local` 가져오기·산출물 미러링, 전부 *내 편집이
 * 아니다*. 기본을 참으로 두면 새 호출부가 깜빡하는 순간 기계가 낸 쓰기가 ⌘Z 를 오염시키고,
 * 그게 정확히 이 항목이 고치는 형태다. 틀렸을 때의 결말이 **"되돌릴 수 없다" < "엉뚱한 것을
 * 되돌린다"** 이므로 안전한 쪽으로 기본을 잡는다.
 */
export function docSet(key: string, value: string, opts?: { undo?: boolean }): boolean {
  if (_cache && isDocKey(key)) {
    const prev = _cache.get(key);
    /* ⚠ 무변경 쓰기는 안 쌓는다 — `rows.ts:222` 가 AppState 쪽에서 지키는 규율과 같다. 쌓으면
       ⌘Z 한 번이 "아무 일도 안 일어남"이 되고, 그건 사용자에게 고장으로 보인다
       (`undoStack.pushUndo` 머리주석). */
    const capture: PreImageRow[] =
      opts?.undo && prev !== value
        ? // DOCS_SPEC.cols = ['key','value'] · keyLen 1 → vals 는 키 포함 전량(`undo.ts` 가 slice 한다).
          [{ table: 'docs', key: [key], vals: prev === undefined ? null : [key, prev] }]
        : [];
    _cache.set(key, value);
    /* ⚠ DB 쓰기 실패를 삼키지 않는다 — 정본을 쥔 층의 침묵이 2단계-E 에서 원인 추적을 막았다.
       사용자 토스트까지 띄우진 않는다: 메모리엔 있어 화면은 정상이고, 다음 저장이 다시 시도한다.
       ⚠ **`runExclusive` 체인에 얹는다**(M1 · 2026-07-24). 종전엔 생 `execDb` 라 `whenSettled()`
       (창 닫기 가드)가 이 쓰기를 **안 기다렸다** — 요약·독후감을 입력한 직후 앱을 닫으면 IPC/워커
       왕복이 절단될 수 있었고, docs 는 정본이 따로 없어 유실이 곧 소실이다. 체인에 얹으면 AppState
       flush 와 같은 배리어를 공유해 닫기 가드가 함께 기다린다(스탬프는 실행 시점에 발급해 쓰기
       순서와 일치). 로컬 쓰기라 §5-2 "로컬만 기다린다"를 어기지 않는다(원격 push 는 이 체인 밖). */
    let stamp = 0;
    void runExclusive(() => {
      stamp = nextStamp();
      return execDb(DOC_UPSERT, [key, value, stamp]);
    }).then((ok) => {
      if (!ok) {
        console.error('[docs] 저장 실패:', key);
        /* ⚠⚠ **여기가 침묵이었다(C2 · 2026-07-31 `/감사 근본`).** 위 주석이 든 근거
           _"메모리엔 있어 화면은 정상이고, **다음 저장이 다시 시도한다**"_ 는 *다음 저장이 있을
           때만* 참이다. 그런데 이 파일이 스스로 적듯(`:51`) docs 는 정본이 따로 없는 사용자
           저작물이고, **독후감을 다 쓰고 앱을 닫는 것이 정상 사용**이다 — 그 경우 마지막 편집은
           메모리에만 있다가 사라지고 앱은 한마디도 안 한다.

           `AppState` 는 같은 사건을 3중으로 덮는다(임시 사본 → 마커 → 지속 배너). docs 에는
           그중 아무것도 없었다. 새 표면을 만들지 않고 **그 셋을 그대로 재사용**한다:
           ① 임시 사본 — 브라우저 경로와 **같은 키**라 회수 경로가 이미 아는 자리다
           ② 마커 — 다음 부팅에 배너 ②("임시 저장본이 있어요" + 내려받기)가 뜬다
           ③ 지속 배너 — 지금 화면에 "내보내기로 백업하세요"가 선다(내보내기는 `_reads`·`_local`
              로 docs 내용을 담으므로 그 CTA 가 실제로 이 저작물을 구한다)
           ⚠ 실패해도 던지지 않는다 — 저장 실패를 알리다 또 실패하면 그게 최악이다. */
        try {
          storage.setItem(key, value);
        } catch {
          /* 임시 사본조차 못 남기면 남은 것은 배너뿐이다(아래 두 줄은 계속 돈다). */
        }
        markDbFallback();
        setSaveFallback(true);
        return;
      }
      /* ⚠ **쓰기가 끝난 뒤 메모리 사본을 다시 못박는다(H1 · 2026-07-24 감사).** 병합이 `runExclusive`
         체인에서 도는 중 이 `docSet` 이 겹치면, 병합의 `reloadDocs()` 가 (이 쓰기 W1 반영 전) DB 를
         읽어 `_cache` 를 통째 재할당하면서 방금 친 값을 떨어뜨린다 — `docs` 는 `pending` rebase 가 없어
         재시작 전까지 화면에서 사라졌다. 이 쓰기는 항상 `reloadDocs` 뒤(같은 체인 순서)에 완결되므로,
         완결 시 값을 되박으면 클로버가 복원된다. DB·서버는 이미 이 값이라 되박음이 정본과 어긋나지 않는다. */
      if (_cache && isDocKey(key)) _cache.set(key, value);
      /* ⚠ **성공한 뒤에만 쌓는다** — `write.ts:260` 과 같은 규율이다. 쓰기가 실패했으면 DB 는
         pre-image 그대로이거나 부분 적용이라 "직전"이 무엇인지 모르고, 그 상태를 되돌릴 수
         있다고 말하는 것이 침묵보다 나쁘다(위 실패 분기는 임시 사본·배너로 이미 응답한다).
         ⚠ 스탬프는 **실행 시점의 그것**이어야 한다 — `undo.ts` 의 툼스톤 가드가 "이 쓰기 뒤에
         생긴 삭제"를 이 값으로 가려낸다. 그래서 `nextStamp()` 를 위 클로저 안으로 옮겼다. */
      if (capture.length) pushUndo(capture, stamp);
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
