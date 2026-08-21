/* ============================================================
   db/boot.ts — 부팅 읽기 경로 + localStorage → SQLite 1회 이관(플랫폼 개편 2단계-E).

   왜 React 마운트 **앞**인가(설계 A-3): 하이드레이션 게이트(초기값 `defaults()` + `hydrated`
   플래그)를 쓰면 "하이드레이션 전에 쓰기가 일어나면 기본값이 실데이터를 덮는" 실패 모드가
   새로 생긴다. 그건 0단계-E 에서 이미 한 번 물린 부류다(*낡은 메모리가 복원본을 덮는다*).
   마운트 전에 await 하면 그 창 자체가 없다. 대가는 로컬 SQLite 읽는 동안의 빈 창인데 짧다.

   ⚠ **이 파일의 가장 중요한 책임은 성능이 아니라 데이터 보존이다.** DB 가 비어 있는데 그냥
   기본값으로 부팅하면 기존 셸 사용자의 데이터가 통째로 사라진다 — 그 사용자의 정본은 아직
   localStorage 에 있다. 그래서 빈 DB 는 "새 사용자"가 아니라 **"아직 이관 안 됨"**으로 읽는다.
============================================================ */
import { boot, isPristineState } from '../persistence';
import { storage } from '../kv';
// ⚠ 부팅 경로 — `isTauri` 는 초소형 모듈에서(H7). `dbVersionGuard` 는 셸 분기 안에서 동적으로.
import { isTauri } from '../isTauri';
import type { DbGuard } from '../tauri';
import { initDocs } from './docs';
import { dbLastOpenedAt, markDbOpened, setDbStale } from './fallback';
import type { AppState } from '../types';
import { rowsToState, stateToRows } from './rows';
import { execDb, isDbAvailable, readMaxStamp, readRows, selectDb, setDiffBaseline, writeRows } from './sqlite';
import { chunkedStamp, seedStamp } from './stamp';

/** 최초 이관의 청크 크기 — `MAX_BATCH_ITEMS`(500) 아래로 여유를 두어 단일 스탬프 그룹이
 *  아웃박스 배치 상한을 넘지 않게 한다(C1 · `stamp.ts`·`cloud/contract.ts` 참조). */
const MIGRATION_STAMP_CHUNK = 400;

/* ⚠⚠ **이관 완료 마커**(D003 · 2026-08-21 데이터 축).

   종전에 「이관됐는가」의 유일한 판정은 `readRows()` 가 non-null 인가였고, 그 함수는
   **`settings` 또는 `meta` 에 한 행이라도 있으면** non-null 을 준다. 즉 **부분 이관과 완료
   이관을 구분할 수 없었다.**

   그게 왜 데이터 소실인가: 데스크톱 `writeRows` 는 `db.batch` 가 없어 **순차 `execute`
   폴백**이고(sqlx 풀에서 `BEGIN` 은 다른 커넥션의 쓰기를 막아 `database is locked` 로 죽는다 —
   그래서 트랜잭션이 **금지**돼 있다) 문장 순서는 `TABLES` 순이다. `meta`·`settings` 를 쓴
   직후 프로세스가 죽으면 예외가 없으므로 `ok:false` 경로도 안 탄다. **다음 부팅**은 `settings`
   행을 보고 non-null → DB 가 정본으로 확정 → 나머지 슬라이스가 화면에서 사라진다.
   원본은 localStorage 에 그대로 있지만 **그것을 읽는 코드 경로가 더 이상 없다.**

   ⚠ 자리가 `sync_state` 인 것이 처방의 절반이다. `meta` 는 `rows.ts` 매퍼의 소유라 다음
   flush 의 `diffRemovals` 가 모르는 키를 지운다 — `sync_state` 가 별도 표인 이유가 그것이고
   (`db.rs` v4), 그래서 내보내기·동기화 대상도 아니다.
   ⚠ 마커를 **쓰기 전에** 세우고 성공 후 지운다. 재개 시 부분 DB 를 기준선으로 세우면 diff 가
   나머지만 채우므로 멱등이다. 기존 설치는 마커가 없어 **거동 변화 0**이다. */
const MIGRATION_MARK = 'migration:localStorage';

/** 이관을 시작해 놓고 끝내지 못한 흔적이 남아 있는가. */
async function migrationInterrupted(): Promise<boolean> {
  const r = await selectDb<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', [MIGRATION_MARK]);
  return !!r?.length;
}

/* ⚠⚠ **아직 아무것도 안 한 기기의 기본값에 찍는 스탬프 = 0**(C-1 · 2026-07-30 `/감사 근본`).

   `updated_at = 0` 은 이 저장소에 이미 있는 규약이다("아주 오래된 것" · `db.rs` v3). 그 한 값이
   세 경로를 **동시에** 닫는다:

   · 아웃박스 수집(`collectOutbox`)이 `updated_at > watermark(0)` 이라 **애초에 안 걸린다.**
   · 서버 LWW(`WHERE excluded.updated_at > …`)에서 0 은 **무엇에도 못 이긴다.**
   · 로컬 병합(`merge.ts`)에서 받아온 행이 항상 이겨 **진짜 데이터가 들어온다.**

   막는 결함: 새 PC(빈 localStorage + 빈 DB)에서 `boot()` 는 `defaults()` 를 주고, 그것을
   *지금* 스탬프로 쓰면 → 설정 탭에서 클라우드에 연결하는 순간 `runSyncOnce` 가 **push 를 먼저**
   하므로(`run.ts`) 워터마크 0 에서 전량이 올라가고, 서버 LWW 가 **어제 쓴 진짜 데이터를 오늘
   스탬프의 시드 기본값에 진다**. 과목·졸업계획·일과·주간배분이 초기화되고 폰·구 PC 가 그것을
   pull 한다. 사용자 실수도 경합도 필요 없다 — **온보딩 설계 경로 그대로 재현된다.**

   ⚠ 이 규칙은 `initPhoneStore` 가 이미 지키던 것이다(_"빈 DB 에 `defaults()` 를 쓰지 않는다 —
     첫 부팅이 사용자의 전 데이터를 지우는 경로다"_). 규칙은 적혀 있었고 **집행이 한쪽에만
     있었다.** 여기가 그 짝이다.
   ⚠ **`isPristineState` 일 때만** 0 이다. 실제로 쓴 데이터(로컬 정본)를 이관하는 경우는
     종전 그대로 청크 스탬프로 올라가야 한다 — 그 사용자의 편집은 정말로 최신이다.
   ⚠ 편집 한 번이 이 상태를 벗어나게 한다: `diffRowsDetailed` 는 **데이터가 바뀐 행에만** 새
     스탬프를 찍으므로, 손댄 행은 즉시 정상 스탬프를 받고 나머지는 0 으로 남는다. 증분 diff 가
     폭발 반경을 스스로 가둔다 — 그래서 별도 플래그·별도 경로가 필요 없다.
   ⚠⚠ **이 0 들을 backfill 하지 말 것.** v6(`006_backfill_stamps.sql`)이 `updated_at=0` 행을
     실제 스탬프로 올린 것은 `updated_at` 열이 생기기 *전에* 만들어진 레거시 행을 동기화에
     복귀시키려는 1회성 조치였다. 여기 0 은 **의도된 값**이고, 같은 backfill 을 다시 돌리면
     이 결함이 그대로 부활한다. */
const PRISTINE_STAMP = 0;

let _preloaded: AppState | null = null;
let _migrated = false;
let _downgraded: DbGuard | null = null;

/**
 * 다운그레이드가 감지됐는가(C2) — 값이 있으면 **앱을 정상 부팅시키면 안 된다.**
 *
 * 진행하면 두 갈래로 나쁘다: DB 는 못 열리므로 낡은 localStorage 로 뜨고(= "저장한 게
 * 사라졌다"), 거기서 한 편집은 신버전이 만든 정본과 갈라진다. `main.tsx` 가 이 값을 보고
 * 명시적 화면을 띄운다 — 조용한 폴백은 여기서 정답이 아니다.
 */
export function dbDowngrade(): DbGuard | null {
  return _downgraded;
}

/** 부팅 시 SQLite 에서 읽어 둔 상태. 없으면 null → 호출부가 기존 localStorage 경로를 탄다. */
export function preloadedState(): AppState | null {
  return _preloaded;
}

/** 이번 부팅에서 localStorage → SQLite 1회 이관이 일어났는가(진단·테스트용). */
export function didMigrate(): boolean {
  return _migrated;
}

/** 테스트가 모듈 상태를 되돌릴 때 쓴다(모듈 캐시가 파일 간에 새는 것 방지). */
export function resetBootState(): void {
  _preloaded = null;
  _migrated = false;
  _downgraded = null;
}

/**
 * 앱 스토어가 만들어지기 전에 저장소를 준비한다. `main.tsx` 가 `await` 한다.
 *
 * · SQLite 미가용(브라우저·dev 서버·트랙 A) → 아무것도 안 하고 기존 localStorage 경로 유지.
 *   **이 폴백은 남긴다** — 없애면 `npm run dev` 와 트랙 A(시각 베이스라인 전량)가 함께 죽는다.
 *   배포 진입점이 셸 하나인 것과, 개발·테스트가 브라우저인 것은 다른 이야기다.
 * · DB 에 데이터 있음 → 그게 정본.
 * · DB 비었음 → localStorage 에서 읽어 **SQLite 로 옮긴다**(1회 이관).
 *
 * 어떤 실패도 앱을 못 뜨게 하지 않는다 — 실패하면 `_preloaded` 가 null 로 남아
 * 기존 localStorage 경로로 부팅한다(정본이 아직 거기 있으므로 안전한 폴백).
 */
/**
 * 폰 웹앱의 부팅 읽기(C-6). `phone/main.tsx` 가 `await` 한다.
 *
 * `initAppStore` 와 **한 가지가 결정적으로 다르다**: localStorage → SQLite 1회 이관을
 * 하지 않는다. 폰에는 옮길 레거시 정본이 없고, 있다면 그건 **다른 오리진에서 온 남의
 * 데이터**다. 빈 DB 는 여기서 "새 기기 — 아직 클라우드에서 안 받았다"로 읽히고, 진입점이
 * 곧이어 `syncOnce()` 로 받아온다.
 *
 * ⚠ 그래서 빈 DB 에 `defaults()` 를 **쓰지 않는다**. 썼다면 그 기본값이 `updated_at` 을
 * 달고 아웃박스에 실려 **클라우드의 진짜 데이터를 LWW 로 덮을** 수 있다 — 첫 부팅이
 * 사용자의 전 데이터를 지우는 경로다. 빈 채로 두고 pull 을 기다리는 것이 유일하게 안전하다.
 */
export async function initPhoneStore(): Promise<void> {
  try {
    if (!(await isDbAvailable())) return;
    seedStamp(await readMaxStamp()); // 어떤 쓰기보다 먼저 — 이유는 `initAppStore` 주석 참조
    await initDocs();
    const rows = await readRows();
    setDiffBaseline(rows);
    if (rows) _preloaded = rowsToState(rows);
  } catch {
    _preloaded = null; // 빈 화면으로 뜨고 동기화가 채운다. 부팅 실패보다 낫다.
  }
}

export async function initAppStore(): Promise<void> {
  if (!isTauri()) return;
  try {
    /* ⚠ **DB 를 열기 전에** 다운그레이드를 판정한다(C2 · 2026-07-26 감사). 순서가 계약이다 —
       `isDbAvailable()` 이 곧 `load()` 이고, 다운그레이드면 그게 실패해 아래 catch 도 아닌
       "조용한 localStorage 폴백"으로 흘러 **뜨는데 데이터가 옛날 것**이 된다. 판정이 참이면
       이 함수는 아무것도 읽지 않고 나가고, `main.tsx` 가 앱 대신 명시적 화면을 띄운다. */
    const guard = await import('../tauri').then((m) => m.dbVersionGuard());
    if (guard?.downgraded) {
      _downgraded = guard;
      console.error(
        `[db] 다운그레이드 감지 — DB v${guard.applied} > 이 빌드 v${guard.bundled}. 정상 부팅을 중단합니다.`,
      );
      return;
    }
    if (!(await isDbAvailable())) return flagStaleBoot();
    /* ⚠ **어떤 쓰기보다 먼저** 타임스탬프 발급기에 씨앗을 심는다(C-1). 모듈 지역 변수라
       재시작하면 0 으로 돌아가는데, 그 상태에서 시계가 뒤로 가 있으면 **이미 DB 에 쓴 값보다
       작은 타임스탬프를 발급**해 그 편집이 워터마크 질의에 영영 안 걸린다(`stamp.ts` 참조).
       아래 `initDocs` 의 1회 이관도 쓰기이므로 그보다 앞에 있어야 한다. */
    seedStamp(await readMaxStamp());
    /* AppState 밖 사용자 저작물(내 요약·독후감·진로 메모)을 메모리로 끌어올린다(4단계-J).
       ⚠ **`readRows` 보다 먼저** 부른다 — `loadReads()` 는 동기이고 렌더 경로에서 불리므로,
       첫 렌더보다 늦게 채워지면 사용자에겐 "요약이 사라졌다"로 보인다. */
    await initDocs();
    const rows = await readRows();
    /* ⚠ 행이 있어도 **마커가 남아 있으면 그건 정본이 아니라 절반이다**(D003). 이 한 줄이
       없으면 부분 이관이 다음 부팅에 정본으로 확정된다 — 위 `MIGRATION_MARK` 주석 참조. */
    const 재개 = rows !== null && (await migrationInterrupted());
    if (rows && !재개) {
      // 증분 diff 의 기준선 — 세우지 않으면 첫 쓰기가 DB 를 한 번 더 읽는다(불필요한 왕복).
      setDiffBaseline(rows);
      _preloaded = rowsToState(rows);
      markDbOpened(); // D006 — 다음 부팅이 «전에는 열렸다» 를 말할 수 있게 하는 유일한 근거
      return;
    }
    /* 빈 DB(기준선 null · 전량이 신규 upsert) 또는 중단된 이관(부분 DB 가 기준선 → diff 가
       나머지만 채운다 = 멱등). 어느 쪽이든 localStorage 정본을 읽어 SQLite 로 옮긴다.
       boot() 는 손상 시 CORRUPT_KEY 보존 + defaults() 폴백까지 이미 처리한다. */
    setDiffBaseline(rows);
    await execDb('INSERT INTO sync_state (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2', [
      MIGRATION_MARK,
      'started',
    ]);
    const fromLocal = boot(storage);
    /* ⚠ 청크 스탬프로 쓴다 — 수개월치 데이터가 한 스탬프 그룹이 되면 첫 클라우드 연결에서
       아웃박스가 상한(500)에 걸려 영구 차단된다(C1). 청크마다 스탬프를 갈아 다배치로 나간다. */
    /* ⚠ `writeRows` 는 이제 **객체**를 준다(`{ ok, touched }`) — `const ok = await …` 로 받아
       `if (!ok)` 로 쓰면 객체는 언제나 truthy 라 **쓰기 실패가 조용히 성공으로 읽힌다**(이관이
       실패했는데 `_migrated = true` 가 되고, 그 다음 부팅은 빈 DB 를 정본으로 본다). 타입은
       이걸 안 잡아 준다 — 그래서 구조분해로 받는다. */
    /* ⚠ 스탬프 선택이 이 줄의 전부다 — 근거는 위 `PRISTINE_STAMP` 주석(C-1). */
    const stamp = isPristineState(fromLocal) ? PRISTINE_STAMP : chunkedStamp(MIGRATION_STAMP_CHUNK);
    const { ok } = await writeRows(stateToRows(fromLocal), stamp);
    if (!ok) return; // 쓰기 실패 — localStorage 경로로 부팅(정본은 아직 거기 있다). 마커는 남긴다.
    await execDb('DELETE FROM sync_state WHERE key = ?', [MIGRATION_MARK]);
    _preloaded = fromLocal;
    _migrated = true;
    markDbOpened();
  } catch (e) {
    /* 진단 불가 실패도 폴백으로 흡수한다 — 부팅 실패는 이 앱에서 가장 나쁜 결과다.
       ⚠ 하지만 **조용히** 삼키지는 않는다. 이 catch 가 무음이던 동안, 부팅 읽기가 실패하면
       앱은 아무 말 없이 localStorage(= 옛 데이터)로 떠서 사용자에겐 "저장한 게 사라졌다"로
       보였다. SD-6 작업 중 실제로 이 침묵 때문에 원인을 못 찾고 계측을 따로 붙여야 했다
       (`getDb()` 의 catch 는 같은 이유로 이미 로그를 남기고 있었다 — 여기만 빠져 있었다). */
    console.error('[db] 부팅 읽기 실패 — localStorage 로 폴백합니다(최근 편집이 안 보일 수 있음).', e);
    _preloaded = null;
    flagStaleBoot();
  }
}

/* ⚠ **이 사실은 개발자 채널에만 있었다**(D006 · 2026-08-21). 위 `console.error` 는 무엇이
   틀렸는지 정확히 알면서 콘솔에만 적었고, 화면 셋은 전부 침묵했다 — 같은 설계의 다른
   가지(C1 배너 · C2 다운그레이드 화면 · 손상 원본 안내)는 전부 화면으로 승격됐는데 이
   가지만 남아 있었다. 조건과 그 근거는 `fallback.ts` 의 `OK_KEY` 주석이 SSOT. */
function flagStaleBoot(): void {
  const 마지막 = dbLastOpenedAt();
  if (마지막 != null) setDbStale(마지막);
}
