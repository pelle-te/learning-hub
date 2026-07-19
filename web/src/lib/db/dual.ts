/* ============================================================
   db/dual.ts — 양방향 검증 구간(플랫폼 개편 2단계-D).

   계약: **localStorage 가 아직 정본이고, SQLite 는 같은 상태를 나란히 기록한다.**
   매 flush 마다 SQL 로 쓴 뒤 되읽어 JSON 경로와 대조한다. 불일치는 조용히 넘기지 않고
   개발 콘솔에 슬라이스 단위로 보고한다 — "언젠가 봤더니 데이터가 달랐다"를 막는 게 이 구간의 존재 이유다.

   왜 쓰기만 하지 않고 **되읽어** 대조하는가: `stateToRows`/`rowsToState` 왕복은
   `dbRows.test.ts` 가 이미 잠갔다. 여기서 남은 미지는 그 사이의 **SQL 층**(타입 강제 변환·
   NULL 처리·트랜잭션)이고, 그건 실제로 디스크를 왕복해 봐야만 드러난다.

   이 층은 2단계-E 에서 통째로 사라진다(JSON 경로 제거 = SQLite 가 정본). 그때까지만 산다.
============================================================ */
import { stateToRows, rowsToState } from './rows';
import { readRows, writeRows, isDbAvailable } from './sqlite';
import type { AppState } from '../types';

/** 대조 결과 — 소비처(개발 콘솔·설정 탭 진단)가 읽는다. */
export interface ParityReport {
  ok: boolean;
  /** 값이 갈린 최상위 슬라이스 이름. ok=true 면 빈 배열. */
  mismatched: string[];
  /** SQL 경로가 아예 못 돈 경우(브라우저·DB 미가용). 이땐 ok 를 판정하지 않는다. */
  skipped: boolean;
}

let _last: ParityReport = { ok: true, mismatched: [], skipped: true };
let _inflight: Promise<unknown> | null = null;

/** 마지막 대조 결과(설정 탭 진단·테스트가 읽는다). */
export function lastParity(): ParityReport {
  return _last;
}

/** 진행 중인 SQL 쓰기가 끝날 때까지 기다린다(없으면 즉시 resolve).
    창 닫기 가드가 쓴다 — **실측(2026-07-19)**: 디바운스 대기 중 창을 닫으면 비동기 SQL 쓰기가
    통째로 잘린다(트랙 B `2단계-C` 케이스). 동기 localStorage 는 `pagehide` 로 지켜지지만
    `await` 가 걸린 경로는 못 지켜지므로, 정본이 SQLite 로 뒤집히는 2단계-E 전에 이 대기가 필요하다. */
export function whenSettled(): Promise<void> {
  return Promise.resolve(_inflight).then(
    () => undefined,
    () => undefined,
  );
}

/** 최상위 슬라이스별로 갈린 곳을 찾는다 — 통짜 비교는 "다르다"까지만 알려줘 진단이 안 된다. */
function diffSlices(a: AppState, b: AppState): string[] {
  const ra = a as unknown as Record<string, unknown>;
  const rb = b as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
  const out: string[] = [];
  for (const k of keys) {
    // JSON 문자열 비교 — 키 순서까지 같아야 하는 건 아니지만, 두 경로 모두 같은 매퍼를 타므로
    // 순서도 결정적이다. 다르면 일단 보고하고 사람이 본다(거짓 양성이 침묵보다 낫다).
    if (JSON.stringify(ra[k]) !== JSON.stringify(rb[k])) out.push(k);
  }
  return out.sort();
}

/**
 * SQLite 에 같은 상태를 기록하고 되읽어 대조한다.
 * 호출부(useApp.flush)를 **막지 않는다** — 실패해도 localStorage 정본은 이미 저장됐다.
 */
export function mirrorAndVerify(state: AppState): Promise<ParityReport> {
  // 체인으로 이어 붙인다 — 동시 실행하면 두 스냅샷 쓰기가 서로 섞여 마지막 것이 정본이 아닐 수 있다.
  // 그리고 `whenSettled()` 가 기다릴 대상이 하나로 모인다.
  const next = Promise.resolve(_inflight)
    .catch(() => undefined)
    .then(() => runMirror(state));
  _inflight = next;
  return next;
}

async function runMirror(state: AppState): Promise<ParityReport> {
  if (!(await isDbAvailable())) {
    _last = { ok: true, mismatched: [], skipped: true };
    return _last;
  }
  try {
    const wrote = await writeRows(stateToRows(state));
    if (!wrote) {
      _last = { ok: false, mismatched: ['<쓰기 실패>'], skipped: false };
      return _last;
    }
    const back = await readRows();
    if (!back) {
      _last = { ok: false, mismatched: ['<되읽기 실패>'], skipped: false };
      return _last;
    }
    const mismatched = diffSlices(state, rowsToState(back));
    _last = { ok: !mismatched.length, mismatched, skipped: false };
    if (mismatched.length) {
      // 개발 중에만 시끄럽게 — 사용자에게 토스트를 띄우진 않는다(이 구간에서 정본은 여전히
      // localStorage 라 사용자가 할 수 있는 일이 없고, 매 저장 경고는 무시를 학습시킨다).
      console.warn('[2단계 양방향 대조] SQL 경로가 JSON 경로와 다릅니다:', mismatched);
    }
    return _last;
  } catch (e) {
    _last = { ok: false, mismatched: [`<예외: ${(e as Error).message}>`], skipped: false };
    return _last;
  }
}
