/* ============================================================
   db/undoStack.ts — 전역 ⌘Z 의 **pre-image 스택**(순수 · 근본① · 2026-08-01).

   ## 무엇을 쌓는가

   한 항목 = **한 번의 flush 가 손대기 _직전_ 그 행들이 어땠는가**다. 되돌리기는 그 pre-image 를
   다시 쓰는 것이고, 쓰는 기계는 이미 검증된 `cloud/merge.applyPull` 을 재사용한다
   (`cloud/undo.ts`). 그래서 이 파일에는 SQL 도 IPC 도 React 도 없다 — 전량 유닛 테스트가 붙는다.

   ⚠ **되돌리기 단위가 flush 인 것이 의도다.** persist 가 400ms 디바운스라 드래그 한 번이
   1~2 항목이 된다(로드맵 2026-07-31 실측 ④). 뮤테이션 단위로 잡으면 리사이즈 한 번에 스택이
   수십 개로 차고, 그 소음이 정확히 착수 전 걱정하던 형태였다.

   ## ⚠⚠ 상한이 **엔트리 수가 아니라 바이트**인 이유 (사용자 결정 · 실측이 근거)

   행 하나의 크기 편차가 **670배**다(실측 2026-07-31): `week_alloc` 26B · `records` 80B ·
   `completions` 82B · `summaries` 147B · `ds_map`(일일 배치) 883B · **`settings.items` 17,353B**.
   `settings` 는 **한 행 = 슬라이스 전체**라 과목·챕터 편집 한 번이 통째 스냅샷이 된다.
   → "20 엔트리"는 week_alloc 이면 520B, items 면 **347KB** 다. 즉 엔트리 수 상한은 메모리에
   아무 상한도 걸지 못한다. 바이트로 재고 오래된 것부터 버린다.

   ⚠ **가장 최근 항목 하나는 예산을 넘겨도 남긴다.** 예산은 성능 장치이지 안전 장치가 아니고
   (`cloud/contract.capBatch` 의 "첫 그룹은 통째로" 와 같은 규율), 예산 하나 때문에 *방금 한
   편집*을 못 되돌리면 그건 되돌리기가 없는 것과 같다.
============================================================ */

/**
 * 쓰기 **전** 그 행의 모습 하나.
 *
 * ⚠ `vals: null` 은 **"그 행이 없었다"** 는 뜻이고, 되돌리기는 그때 *삭제*여야 한다(신규 생성의
 * 역연산). 이걸 표현할 수 없으면 "추가"를 영원히 못 되돌린다 — 옵셔널로 두지 않고 명시 null 인
 * 이유가 그것이다(`undefined` 는 "안 담았다"와 구분이 안 된다).
 */
export interface PreImageRow {
  /** 테이블 이름(`db/rows.ts` 의 `TABLES[].name`). */
  table: string;
  /** 기본키 값들(`keyLen` 개). `vals` 가 null 이어도 이건 항상 있다 — 지울 행을 가리켜야 한다. */
  key: unknown[];
  /** 쓰기 전 데이터 열 전량(키 포함 · `spec.cols` 순서 · `updated_at` 제외). 없었으면 null. */
  vals: unknown[] | null;
}

/** 되돌릴 수 있는 쓰기 하나. */
export interface UndoEntry {
  /**
   * 이 쓰기가 발급한 **최대 스탬프**. 되돌리기가 "이 쓰기 _뒤에_ 생긴 툼스톤"을 가려내는 기준이다
   * (`cloud/undo.ts`) — 그게 없으면 다른 기기가 지운 행을 되돌리기가 조용히 되살린다.
   */
  stamp: number;
  rows: PreImageRow[];
  /** `rows` 의 근사 바이트(예산 회계용 · 아래 `preImageBytes`). */
  bytes: number;
}

/**
 * 스택이 들 수 있는 총 바이트. 512KB 는 `settings.items`(17KB) 기준 **~30 편집**, 작은 행
 * (records 80B)이면 수천 편집이다 — 축이 바이트라 둘 다 같은 예산으로 덮인다.
 */
export const UNDO_BYTE_BUDGET = 512 * 1024;

/** pre-image 의 근사 바이트. 값이 이미 JSON 문자열이라(행 값 = 레코드 통째 JSON) 길이 합이 곧 크기다. */
export function preImageBytes(rows: readonly PreImageRow[]): number {
  let n = 0;
  for (const r of rows) {
    for (const k of r.key) n += String(k).length;
    if (r.vals) for (const v of r.vals) n += String(v).length;
  }
  return n;
}

/* 최신이 **뒤**다(push/pop). 오래된 것을 버릴 때만 앞에서 shift 한다. */
let _stack: UndoEntry[] = [];
let _bytes = 0;

/**
 * 한 쓰기의 pre-image 를 쌓는다. 빈 목록은 쌓지 않는다(되돌릴 것이 없는 쓰기 = 항목이 아니다 —
 * 그런 걸 쌓으면 ⌘Z 한 번이 "아무 일도 안 일어남"이 되어 사용자에겐 고장으로 보인다).
 *
 * @returns 실제로 쌓았는가.
 */
export function pushUndo(rows: PreImageRow[], stamp: number): boolean {
  if (!rows.length) return false;
  const bytes = preImageBytes(rows);
  _stack.push({ stamp, rows, bytes });
  _bytes += bytes;
  // 예산 초과 → 오래된 것부터. ⚠ 마지막 하나는 예산을 넘겨도 남긴다(머리주석).
  while (_bytes > UNDO_BYTE_BUDGET && _stack.length > 1) {
    _bytes -= _stack.shift()!.bytes;
  }
  return true;
}

/**
 * 가장 최근 항목을 **보기만** 한다(없으면 null).
 *
 * ⚠⚠ **꺼내기(pop)가 아니라 보기(peek)가 기본인 이유**(H2 · 2026-08-01). 종전엔 `cloud/undo.ts`
 * 가 맨 처음 `popUndo()` 를 불렀고, 그 뒤 `applyPull` 이 던지면 **항목은 이미 사라진 뒤**였다.
 * 호출부에 `.catch` 도 없어서 화면엔 아무 말도 안 나왔다 — 즉 **⌘Z 를 누를 때마다 스택이 한 칸씩
 * 조용히 파괴**되고, 사용자는 "안 눌렸나" 하며 더 누른다(누를수록 되돌릴 것이 사라진다).
 * 순서를 **peek → apply → drop** 으로 뒤집으면 실패는 무해해진다: 항목이 그대로 남아 재시도가
 * 성립한다. 예외를 잡아 `pushUndo` 로 되돌리는 대안은 *복구를 또 하나의 실패 가능 경로로* 만든다.
 */
export function peekUndo(): UndoEntry | null {
  return _stack[_stack.length - 1] ?? null;
}

/**
 * 적용에 **성공한** 항목을 버린다. `peekUndo()` 가 준 바로 그 항목일 때만 버린다.
 *
 * ⚠ 항등 대조가 방어의 전부다 — 적용 중 pull 이 와서 `clearUndo()` 가 돌았다면 스택 꼭대기는
 * 이미 남의 것(혹은 없음)이다. 무조건 `pop()` 하면 그 항목을 대신 버린다.
 */
export function dropUndo(entry: UndoEntry): void {
  if (_stack[_stack.length - 1] !== entry) return;
  _stack.pop();
  _bytes -= entry.bytes;
}

/**
 * 스택을 통째로 버린다.
 *
 * ⚠ **pull 병합이 오면 반드시 부른다**(`cloud/merge.applyPull`). 받아온 행이 로컬 행을 덮으면
 * 쌓아 둔 pre-image 는 *더 이상 어떤 상태의 직전도 아니다* — 그걸 그대로 다시 쓰면 다른 기기의
 * 편집을 fresh 스탬프로 덮어 **LWW 로 이겨서 서버까지 밀어올린다.** 즉 되돌리기가 조용한 원격
 * 소실 장치가 된다. 무효화가 이 설계의 착지 조건 넷 중 하나인 이유다.
 */
export function clearUndo(): void {
  _stack = [];
  _bytes = 0;
}

/** 쌓인 항목 수(진단·테스트). */
export function undoDepth(): number {
  return _stack.length;
}

/** 쌓인 총 바이트(진단·테스트). */
export function undoBytes(): number {
  return _bytes;
}
