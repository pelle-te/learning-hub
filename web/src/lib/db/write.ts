/* ============================================================
   db/write.ts — **셸의 앱 상태 정본 쓰기 경로** + 되읽기 자기검증.

   ⚠ **이 파일은 2단계-D 에 `dual.ts`("양방향 검증 구간")로 태어났고, 그 헤더는 "localStorage 가
   아직 정본이고 SQLite 는 나란히 기록한다 · 이 층은 2단계-E 에서 통째로 사라진다"고 적고 있었다.
   둘 다 거짓이 됐다.** 2단계-E 에서 사라지기는커녕 **정본 쓰기 그 자체**가 됐다(`useApp.flush`
   가 셸에서 부르는 유일한 저장 경로 · `useApp.ts` 참조). 4단계-J 에서 이름과 문서를 실제에 맞췄다.

   그 드리프트가 위험했던 이유: 옛 주석이 "실패해도 localStorage 정본은 이미 저장됐다",
   "사용자가 할 수 있는 일이 없다"고 적고 있었다. 셸에선 **실패가 곧 데이터 유실**이라
   정반대다 — 이 파일을 고치러 온 사람이 그 문장을 믿으면 경고를 지우는 쪽으로 판단한다.

   ## 지금의 계약

   · **셸**: `writeAndVerify` 가 정본을 쓴다. 실패는 `useApp` 이 사용자에게 경고한다(무시 금지).
   · **브라우저(dev·트랙 A)**: SQLite 가 정본이 아니다 → `skipped` 로 즉시 반환하고
     localStorage 경로가 저장을 맡는다(2·3단계와 같은 폴백 규율).
   · **정본인데 연결 실패**(C1 · 2026-07-26): `unavailable` 로 반환한다. 이게 `skipped` 와
     같은 값이던 것이 결함이었다 — 둘 다 "SQL 을 못 돌렸다"지만 전자는 **정상**이고 후자는
     **데이터 유실 직전**이라, 한 값으로 뭉치면 호출부가 폴백도 경고도 못 한다.

   왜 쓰기만 하지 않고 **되읽어** 대조하는가: `stateToRows`/`rowsToState` 왕복은
   `dbRows.test.ts` 가 이미 잠갔다. 남은 미지는 그 사이의 **SQL 층**(타입 강제 변환·NULL 처리)이고,
   그건 실제로 디스크를 왕복해 봐야만 드러난다. 2단계-E 의 `SQLITE_BUSY`·WAL 사고가 정확히
   거기서 나왔다 — 검증을 떼면 그 부류가 다시 조용해진다.
============================================================ */
import { stateToRows, rowsToState } from './rows';
import { readRows, readTouched, touchedKey, writeRows, isDbAvailable, isSqlitePrimary } from './sqlite';
import { pushUndo } from './undoStack';
import type { AppState } from '../types';

/** 대조 결과 — 소비처(개발 콘솔·설정 탭 진단)가 읽는다. */
export interface ParityReport {
  ok: boolean;
  /** 값이 갈린 최상위 슬라이스 이름. ok=true 면 빈 배열. */
  mismatched: string[];
  /** SQL 경로가 **정상적으로** 안 돈 경우(브라우저·dev·트랙 A — SQLite 가 정본이 아니다).
   *  이땐 ok 를 판정하지 않는다. ⚠ "DB 가 죽었다"는 여기가 아니라 `unavailable` 이다. */
  skipped: boolean;
  /** SQLite 가 **정본인데** 연결에 실패했다(C1). `ok:false` 와 함께 온다 —
   *  호출부는 localStorage 폴백 + 지속 배너로 이어야 한다. */
  unavailable: boolean;
  /** 병합 반영 창이라 **쓰지 않고 미뤘다**(C-2). 실패가 아니다 — 호출부는 편집 큐를 **되살리고**
   *  재예약해야 한다. 경고·폴백 대상이 아니므로 `ok:true` 와 함께 온다. */
  deferred?: boolean;
}

let _last: ParityReport = { ok: true, mismatched: [], skipped: true, unavailable: false };

/**
 * 행축 대조로 감당할 접촉 행 상한 — 넘으면 종전 **전량 되읽기**로 떨어진다.
 *
 * 왜 상한이 필요한가: 첫 쓰기(기준선 없음)와 대량 쓰기(가져오기·복구·되돌리기)는 손댄 행이 곧
 * 전체라(2년 근사 상태에서 5,348행), 키를 나열해 읽으면 `IN` 목록이 병적으로 길어지고 전량
 * 읽기보다 비싸진다. 400 은 `WRITE_STAMP_CHUNK` 와 같은 자릿수 — 일반 편집 flush 는 변경 행이
 * 한 자릿수라 여기 근처에도 안 온다(즉 실사용에선 **언제나 행축**이다).
 */
const ROW_VERIFY_MAX = 400;
let _inflight: Promise<unknown> | null = null;

/** 마지막 대조 결과(설정 탭 진단·테스트가 읽는다). */
export function lastParity(): ParityReport {
  return _last;
}

/* ⚠⚠ **병합 반영 진행 플래그(C1 · 2026-07-24 감사)** — `runExclusive` 가 못 닫는 잔여 창을 막는다.
   `runExclusive` 는 병합 *배치 쓰기 도중*의 flush 만 직렬화한다. 그런데 `applyPull`(merge.ts)이
   병합-후 행으로 **diff 기준선을 세우고 반환한 뒤**, 메모리 반영(`useApp.applyMerged`)은 그 사이의
   `await commitPullMark`(체인 밖 IPC) + `syncOnce` 언와인드가 끝난 다음에야 일어난다. 그 창에서
   `useApp` 디바운스 flush 가 발화하면 **낡은 메모리를 병합-후 기준선과 diff** 해서 받아온 행을
   되돌리는 문장을 만들고, 그 되돌림이 LWW 로 서버까지 이겨 다른 기기 편집이 조용히 소실된다.
   기준선-세우기(`applyPull`)와 메모리-반영(`applyMerged`) 사이 동안 flush 를 **미룬다**. */
let _mergeApplyPending = false;

/**
 * 병합 반영 창 시작 — `applyPull` 이 기준선을 세운 직후(같은 `runExclusive` 안) 켠다.
 *
 * ⚠⚠ **이 플래그는 불리언이라 중첩되지 않는다 — 그리고 중첩이 실제로 났었다(H8 · 2026-07-31).**
 * `runSync` 와 `restoreConflict` 가 둘 다 창을 열고 둘 다 `finally` 에서 무조건 닫는데 겹침
 * 가드를 공유하지 않아, 안쪽 finally 가 바깥 창을 조기에 닫고 그 틈으로 flush 가 통과했다.
 * 처방은 카운터가 아니라 **직렬화**다(`store/syncController.ts` 의 `exclusiveMerge`) — 무조건
 * 닫는 방어망이 C1 의 안전장치라 카운터로 바꾸면 그 방어망이 남의 창을 감산한다.
 *
 * 여기 있는 것은 그 처방의 **집행자**다: 이미 열린 창을 또 열면 게이트를 우회한 새 경로가
 * 생겼다는 뜻이므로 시끄럽게 보고한다(관측 없는 규율은 다음 리팩터에서 조용히 되돌아간다).
 */
export function beginMergeApply(): void {
  if (_mergeApplyPending) {
    /* 삼키지 않는다 — 그러나 던지지도 않는다(병합 도중 예외는 워터마크·기준선 계약을 흔든다).
       관측만 하고 창은 열린 채로 둔다(닫히지 않은 쪽이 안전한 방향이다 — flush 를 미룰 뿐이다). */
    void import('../telemetry').then((m) =>
      m.reportError(new Error('병합 반영 창이 중첩됐다 — exclusiveMerge 를 우회한 경로가 있다'), 'mergeApply.nested'),
    );
  }
  _mergeApplyPending = true;
}

/**
 * 병합 반영 창이 닫힐 때까지 **짧게** 기다린다(H9 · 창 닫기 가드 전용).
 *
 * ⚠ 왜 필요한가: 병합창에서 `flushNow()` 를 부르면 `writeAndVerify` 가 `deferred:true` 로 즉시
 * 반환하고 400ms 타이머를 재예약한다. 그런데 `whenSettled()` 는 그 체인 링크가 이미 resolve 됐으므로
 * **곧바로 통과**하고 창이 파괴된다 — **타이머는 영원히 안 뛴다.** 즉 가드의 존재 이유(비동기 SQL
 * 쓰기가 잘리는 것을 막는다)가 정확히 이 경우에만 무력화돼 있었다.
 *
 * ⚠ 상한을 두는 것이 이 함수의 계약이다. 무한히 기다리면 "인터넷이 죽으면 앱이 안 닫힌다"의
 * 로컬판이 된다 — 바깥 `installCloseGuard` 가 이미 3초 상한을 걸므로 여기는 그보다 짧아야 한다.
 */
export function waitForMergeWindow(timeoutMs = 1200, stepMs = 25): Promise<boolean> {
  if (!_mergeApplyPending) return Promise.resolve(true);
  const deadline = Date.now() + timeoutMs;
  return new Promise<boolean>((resolve) => {
    const tick = (): void => {
      if (!_mergeApplyPending) return resolve(true);
      if (Date.now() >= deadline) return resolve(false);
      setTimeout(tick, stepMs);
    };
    setTimeout(tick, stepMs);
  });
}

/** 병합 반영 창 종료 — `applyMerged`(메모리 반영 완료) + `runSync` finally(방어)가 끈다. */
export function endMergeApply(): void {
  _mergeApplyPending = false;
}

/** flush 가 이 창에서 쓰면 받아온 행을 되돌린다 — `useApp.flush` 가 이 값을 보고 미룬다. */
export function isMergeApplyPending(): boolean {
  return _mergeApplyPending;
}

/** 진행 중인 SQL 쓰기가 끝날 때까지 기다린다(없으면 즉시 resolve).
    창 닫기 가드가 쓴다 — **실측(2026-07-19)**: 디바운스 대기 중 창을 닫으면 비동기 SQL 쓰기가
    통째로 잘린다(트랙 B `2단계-C` 케이스). 동기 localStorage 는 `pagehide` 로 지켜지지만
    `await` 가 걸린 경로는 못 지켜진다. 정본이 SQLite 인 지금 이 대기는 **데이터 보존 계약**이다.

    ## ⚠ 여기서 기다리는 것은 **로컬 디스크뿐이다**(C-1 · 설계서 §5-2)

    클라우드 밀어올리기(`lib/cloud/push.ts`)를 `_inflight` 체인에 **넣지 말 것.** 넣으면 창
    닫기가 네트워크를 기다리게 되어 **인터넷이 죽었을 때 앱이 안 닫힌다** — 1단계에서 다른
    원인으로 이미 겪은 실패 모드다. 성질이 다르기 때문에 경계가 여기 있다:
    · 로컬 쓰기 유실 = **소실**(정본이 여기다) → 기다릴 값이 있다.
    · 원격 전송 유실 = **지연**(워터마크가 안 전진해 다음 시도가 재개한다) → 기다릴 값이 없다.

    타임아웃을 달아 "적당히 기다리기"로 절충하지 않는 이유도 같다 — 그건 느리지만 성공했을
    로컬 쓰기를 버리는 쪽이라, 막으려는 것(유실)을 스스로 저지른다. */
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
 * 상태를 SQLite 에 쓰고 되읽어 대조한다. **셸에선 이것이 정본 저장이다.**
 * 호출부(`useApp.flush`)를 막지 않지만(그래야 UI 가 안 멈춘다), **실패를 삼키지도 않는다** —
 * `ParityReport.ok` 가 거짓이면 호출부가 사용자에게 경고한다. 옛 이름 `mirrorAndVerify` 의
 * "mirror" 는 부차적 사본을 뜻해 오해를 불렀다(정본을 미러라 부르면 실패를 가볍게 다루게 된다).
 */
export interface WriteOptions {
  /**
   * 이 쓰기의 pre-image 를 **되돌리기 스택에 쌓을 것인가**(기본 참 · 전역 ⌘Z).
   *
   * ⚠ **`loadState` 경로(가져오기·초기화·복구)는 거짓을 준다.** 두 이유가 겹친다:
   * ① 그건 "편집"이 아니라 상태 통째 교체라 되돌리기 단위가 다르고, 사용자 결정대로 그 층은
   *    **`BACKUP_KEY` 스냅샷**이 계속 맡는다. ② 손댄 행이 곧 전체(2년 근사 상태에서 5,348행 ·
   *    166KB)라 한 번에 예산을 통째로 먹고, 그러면 **평범한 편집의 되돌리기가 전부 밀려난다** —
   *    스냅샷이 이미 덮는 사건 하나를 위해 안 덮는 사건 수십 개를 버리는 교환이다.
   */
  undo?: boolean;
}

export function writeAndVerify(state: AppState, opts: WriteOptions = {}): Promise<ParityReport> {
  // 체인으로 이어 붙인다 — 동시 실행하면 두 스냅샷 쓰기가 서로 섞여 마지막 것이 정본이 아닐 수 있다.
  // 그리고 `whenSettled()` 가 기다릴 대상이 하나로 모인다.
  return runExclusive(async () => {
    /* ⚠⚠ **병합창 판정은 반드시 체인 *안*에서 한다(C-2 · 2026-07-30 `/감사 근본`).**

       종전엔 `useApp.flush` 가 체인 **밖에서** `isMergeApplyPending()` 을 보고 통과 여부를
       정했다. 그런데 창을 켜는 `beginMergeApply()` 는 `applyPull` 의 `runExclusive` 콜백
       **마지막 줄**에 있다 — 즉 그 콜백이 도는 동안(데스크톱 plugin-sql 순차 execute 라
       pull 200행이면 수백 ms) 플래그는 **아직 false** 다. 그 창에 flush 가 판정하면:

         ① 가드를 통과한다(플래그 false) → ② `writeAndVerify` 가 체인 **뒤에** 줄을 선다
         → ③ `applyPull` 이 끝나 기준선이 **병합-후**로 세워진다
         → ④ 이제 우리 차례인데 손에 든 것은 **병합-전 메모리**다
         → `diffRowsDetailed(병합-후 기준선, 병합-전 메모리)` = **받아온 행을 되돌리는 upsert
           + 상대 기기가 만든 행의 툼스톤** → 다음 push 가 그걸 서버까지 밀어 **다른 기기
           편집이 영구 소실**된다.

       가드가 막으려던 결과와 **정확히 같다** — 판정 시점만 창 밖이었다. 체인 안으로 옮기면
       ①③ 사이가 원자적이 되어 인터리브 자체가 성립하지 않는다.

       ⚠ H4(2026-07-24)가 병합 *쓰기*를 이 체인에 얹었고, C1 이 *플래그*를 더했다. 남아 있던
         것은 **그 플래그를 어디서 읽는가**였다. 두 수정의 미완이 이 한 줄이다. */
    if (isMergeApplyPending()) {
      /* ⚠ `_last` 를 갈아치우지 않는다 — 미룬 것은 대조 결과가 아니다. 여기서 덮으면 설정 탭
         진단이 "마지막 저장은 skipped" 라고 말하기 시작한다(안 잰 것을 결과로 보고하는 형태). */
      return { ok: true, mismatched: [], skipped: true, unavailable: false, deferred: true };
    }
    return runWrite(state, opts.undo ?? true);
  });
}

/**
 * 임의의 로컬 DB 쓰기를 flush 와 **같은 직렬화 단위**에서 돌린다(H4).
 *
 * 동기화 병합(`cloud/merge.ts` 의 `applyPull`)이 쓰는 동안 useApp 디바운스 flush 가 끼어들면,
 * 아직 기준선이 안 세워진 창에 **낡은 메모리를 더 큰 스탬프로 써서 받아온 행을 되돌릴** 수 있다
 * (그 되돌림이 LWW 로 서버까지 이겨 다른 기기의 편집이 조용히 소실된다). 병합 쓰기를 이 체인에
 * 얹으면 flush 와 병합이 절대 겹치지 않는다.
 *
 * ⚠ 병합은 **로컬 쓰기**라 `whenSettled()`(창 닫기 가드)가 기다려도 §5-2 의 "로컬만 기다린다"를
 * 어기지 않는다 — 원격 push 는 여전히 이 체인 밖이다(`push.ts` 머리주석).
 */
export function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = Promise.resolve(_inflight)
    .catch(() => undefined)
    .then(fn);
  _inflight = next;
  return next;
}

async function runWrite(state: AppState, captureUndo: boolean): Promise<ParityReport> {
  if (!(await isDbAvailable())) {
    /* ⚠ 여기가 C1 의 자리다. 같은 `null` 이 두 뜻이었다 — 아래 두 갈래로 가른다.
       (`isDbAvailable()` 이 `getDb()` 를 부르며 가용성 플래그를 갱신하므로 순서가 중요하다.) */
    if (!isSqlitePrimary()) {
      _last = { ok: true, mismatched: [], skipped: true, unavailable: false };
      return _last;
    }
    _last = { ok: false, mismatched: ['<DB 연결 불가>'], skipped: false, unavailable: true };
    return _last;
  }
  try {
    const wrote = await writeRows(stateToRows(state));
    if (!wrote.ok) {
      _last = { ok: false, mismatched: ['<쓰기 실패>'], skipped: false, unavailable: false };
      return _last;
    }
    /* ⚠ **성공한 뒤에만 쌓는다**(전역 ⌘Z). 쓰기가 실패했으면 DB 는 pre-image 그대로이거나 부분
       적용이라 "직전"이 무엇인지 모른다 — 그 상태를 되돌릴 수 있다고 말하는 것이 더 나쁘다.
       ⚠ 이 자리가 **캡처의 유일한 지점**이다: 병합 쓰기(`applyPull`)는 `batchDb` 로 가고
       (내 편집이 아니다), 최초 이관(`boot.ts`)은 `writeRows` 를 직접 부른다(기준선이 없어
       `preImages` 가 애초에 빈 배열이다). 즉 여기 없는 경로는 원리적으로 안 쌓인다. */
    if (captureUndo) pushUndo(wrote.preImages, wrote.stamp);
    /* ── 되읽기 대조의 이력(읽는 순서대로) ──────────────────────────────────
       ① 처음엔 **매 flush 전량**이었다. 쓰기는 증분(diff)인데 검증만 O(전체) — 8테이블을 통째로
          읽고(`readRows`) 상태로 되돌린 뒤 양쪽을 stringify 했다. 2년 근사 상태(10,380행/0.67MB)
          에서 순수 JS 10ms + IPC 690KB 를 400ms 마다.
       ② H6(2026-07-26 감사)이 그걸 **표본**(첫 쓰기 + 20회당 1회)으로 바꿨다. 근거: 이 층이 잡는
          것은 스키마·매퍼의 성질이라 한 번 어긋나면 계속 어긋난다 = 표본으로 잡힌다.
       ③ 지금은 **행축**이다(아래). 표본이 옳았던 전제는 "전량이 비싸다"였는데, 손댄 행만 보면
          그 전제 자체가 사라진다.

       ⚠ ②가 남긴 규율은 지금도 유효하다: **안 잰 회차에 `ok:true` 를 새로 쓰지 않는다.** 안 잰
       것을 "일치"라고 보고하면 설정 탭 진단이 거짓말을 한다(감사가 반복해 잡은 부류). 아래
       "바뀐 행 없음" 분기가 직전 결과를 그대로 두는 이유가 그것이다. */
    /* ⚠⚠ **대조를 시간축에서 행축으로 옮겼다(2026-07-29).** 표본 설계의 대가는
       **20회 중 19회가 무검증**이라는 것이었다. 이 층이 잡으려는 것(SQL 층의 타입 강제변환·
       NULL 처리)은 **행의 성질**이므로, 손댄 행만 되읽으면 비용이 O(변경행)으로 떨어지면서
       **매 flush 검증**이 된다 — 더 싸고 탐지력은 오른다. 표본은 "전량이 비싸다"의 우회였지
       목적이 아니었다.

       ⚠ 전량 경로는 **지우지 않고 남긴다.** 첫 쓰기(기준선 없음)와 대량 쓰기(가져오기·복구·
       되돌리기)는 손댄 행이 곧 전체라, 키를 나열해 읽는 것이 오히려 비싸고 `IN` 목록도
       병적으로 길어진다. 그 경계가 `ROW_VERIFY_MAX` 다.

       ⚠ 건너뛰지 않으므로 "안 잰 회차"가 없다 — H6 이 걱정한 "안 잰 것을 일치라고 보고"할
       여지 자체가 사라진다. */
    if (wrote.touched.length && wrote.touched.length <= ROW_VERIFY_MAX) {
      const back = await readTouched(wrote.touched);
      if (!back) {
        _last = { ok: false, mismatched: ['<되읽기 실패>'], skipped: false, unavailable: false };
        return _last;
      }
      const bad = new Set<string>();
      for (const t of wrote.touched) {
        const got = back.get(touchedKey(t.table, t.key));
        /* ⚠ 비교는 **문자열로** 한다. SQLite 는 열 친화성에 따라 숫자를 number 로 돌려주는데
           우리가 쓴 값은 string 일 수 있다 — 그 강제변환이야말로 이 층이 잡으려는 것이지만,
           JSON 값이 그대로 왕복하는 한 정상이다. 원시 타입이 갈리는 것 자체는 SQLite 의 정상
           거동이라 `===` 로 보면 전 행이 불일치가 된다(그러면 경고가 소음이 되어 죽는다). */
        if (!got || got.length !== t.vals.length || got.some((v, i) => String(v) !== String(t.vals[i]))) {
          bad.add(t.table);
        }
      }
      const mismatched = [...bad];
      _last = { ok: !mismatched.length, mismatched, skipped: false, unavailable: false };
      if (mismatched.length) console.warn('[db] 쓴 행과 되읽은 행이 다릅니다:', mismatched);
      return _last;
    }
    if (!wrote.touched.length) return _last; // 바뀐 행이 없다 = 검증할 것도 없다(직전 결과 유지)
    const back = await readRows();
    if (!back) {
      _last = { ok: false, mismatched: ['<되읽기 실패>'], skipped: false, unavailable: false };
      return _last;
    }
    const mismatched = diffSlices(state, rowsToState(back));
    _last = { ok: !mismatched.length, mismatched, skipped: false, unavailable: false };
    if (mismatched.length) {
      /* ⚠ 셸에선 이 불일치가 **정본이 의도와 다르게 저장됐다**는 뜻이다. 콘솔 경고는 진단용이고,
         사용자에게 알리는 책임은 호출부(`useApp` → `warnSaveFailure`)에 있다 — 여기서 토스트를
         띄우면 같은 사건을 두 층이 각자 알리게 된다. */
      console.warn('[db] 저장한 상태가 되읽은 것과 다릅니다:', mismatched);
    }
    return _last;
  } catch (e) {
    console.error('[db] 저장/대조 중 예외', e);
    _last = { ok: false, mismatched: [`<예외: ${(e as Error).message}>`], skipped: false, unavailable: false };
    return _last;
  }
}
