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
import { boot } from '../persistence';
import { storage } from '../kv';
import { isTauri } from '../tauri';
import { initDocs } from './docs';
import type { AppState } from '../types';
import { rowsToState, stateToRows } from './rows';
import { isDbAvailable, readMaxStamp, readRows, setDiffBaseline, writeRows } from './sqlite';
import { seedStamp } from './stamp';

let _preloaded: AppState | null = null;
let _migrated = false;

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
}

/**
 * 앱 스토어가 만들어지기 전에 저장소를 준비한다. `main.tsx` 가 `await` 한다.
 *
 * · SQLite 미가용(브라우저·dev 서버·트랙 A) → 아무것도 안 하고 기존 localStorage 경로 유지.
 *   **이 폴백은 남긴다** — 없애면 `npm run dev` 와 트랙 A(스냅샷 59장)가 함께 죽는다.
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
    if (!(await isDbAvailable())) return;
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
    if (rows) {
      // 증분 diff 의 기준선 — 세우지 않으면 첫 쓰기가 DB 를 한 번 더 읽는다(불필요한 왕복).
      setDiffBaseline(rows);
      _preloaded = rowsToState(rows);
      return;
    }
    setDiffBaseline(null); // 빈 DB — 기준선도 비어 있다(전량이 신규 upsert)
    // 빈 DB — 아직 이관 전이다. localStorage 정본을 읽어 SQLite 로 옮긴다.
    // boot() 는 손상 시 CORRUPT_KEY 보존 + defaults() 폴백까지 이미 처리한다.
    const fromLocal = boot(storage);
    const ok = await writeRows(stateToRows(fromLocal));
    if (!ok) return; // 쓰기 실패 — localStorage 경로로 부팅(정본은 아직 거기 있다)
    _preloaded = fromLocal;
    _migrated = true;
  } catch {
    // 진단 불가 실패도 폴백으로 흡수한다. 부팅 실패는 이 앱에서 가장 나쁜 결과다.
    _preloaded = null;
  }
}
