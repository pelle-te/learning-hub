/* ============================================================
   cloud/merge.ts — 서버에서 받아온 변경을 **로컬 정본에 병합**한다(C-5).

   ## ⚠ 이 파일의 어려움은 SQL 이 아니라 **순서**다

   받아온 행을 로컬 SQLite 에 쓰는 것만으로는 부족하다. 이 앱에는 같은 데이터의 사본이
   **셋** 있고, 하나만 갱신하면 나머지가 그걸 되돌린다:

   ① SQLite(정본) ② `sqlite.ts` 의 `_last`(증분 diff 기준선) ③ zustand 의 메모리 상태

   `_last` 를 안 고치면 다음 저장의 diff 가 **낡은 기준선**과 비교돼 받아온 변경을 되돌리는
   문장을 만든다. 메모리를 안 고치면 다음 flush 가 낡은 메모리로 정본을 덮는다 —
   **0단계-E 에서 이미 물린 부류다**(*낡은 메모리가 복원본을 덮는다*). 그때 배운 교훈이
   `sync.ts` 의 `kind:'local'` 방송이었고, 여기가 그 교훈이 재현되는 자리다.

   그래서 계약이 이렇다: `applyPull()` 이 ①②를 하고 **③에 쓸 상태를 돌려준다.**
   호출부는 그걸 `applyMerged()` 에 넣는다(⚠ `loadState` 가 **아니다** — C1: 그건 병합 진행 중
   들어온 로컬 편집을 지운다. `useApp.applyMerged` 주석). ②를 먼저 맞춰 두므로, 진행 중 편집이
   없으면 `applyMerged` 는 flush 를 아예 안 하고(기준선=스냅샷), 있으면 그 편집만 diff 로 써서
   받아온 행은 **되돌아가지 않는다** — 받아온 행에 새 스탬프가 찍혀 서버로 가는 에코가 안 생긴다.

   ## ⚠ 받아온 것도 신뢰하지 않는다

   서버 응답은 네트워크를 건너온다. `OutboxBatchSchema` 로 **똑같이 검증**한다 — 우리 서버라고
   믿고 넘기면 그건 `lib/tauri.ts` 의 비차단 정책을 신뢰 경계에 잘못 적용하는 것이다.
============================================================ */
import { batchDb } from '../db/sqlite';
import { readRows, setDiffBaseline } from '../db/sqlite';
import { rowsToState } from '../db/rows';
import { reloadDocs } from '../db/docs';
import { runExclusive, beginMergeApply } from '../db/write';
import { clearUndo } from '../db/undoStack';
import { seedStamp } from '../db/stamp';
import type { AppState } from '../types';
import { OUTBOX_TABLES, tableCols, type OutboxBatch } from './contract';
import { noteMergedRows } from './outbox';

const SPEC = new Map(OUTBOX_TABLES.map((t) => [t.name, t]));

export interface MergeResult {
  /** 메모리에 실을 새 상태. 호출부가 `applyMerged()` 에 넣어야 완결된다(⚠ `loadState` 아님 · C1). */
  state: AppState | null;
  /** 실제로 적용한 문장 수(0이면 받아올 게 없었다). */
  applied: number;
}

export interface ApplyPullOptions {
  /**
   * 이 배치가 **원격에서 온 것**인가. 참이면 적용한 행을 에코 억제표에 적어 다음 아웃박스 스캔이
   * 되돌려 올리지 않게 한다(H31-②).
   *
   * ⚠⚠ **합성 배치는 반드시 `false` 다(C1 · 2026-07-31 `/감사 근본`).** `outbox.ts` 의 억제
   * 안전 논거는 _"로컬 편집이 같은 값을 받을 수 없다"_ 인데, `restoreConflict` 는 **로컬 편집을
   * 원격 수신 경로로 통과시키는 유일한 호출자**라 그 전제의 예외다. 참으로 두면 억제표가
   * `키 → 방금 발급한 로컬 스탬프` 를 갖게 되고, 스캔이 `_merged.get(key) === updatedAt` 로
   * **정확히 일치**시켜 그 행을 배치에서 뺀다. 워터마크는 fence 까지 전진하므로 **재시작 후에도
   * 영구 제외** — 로컬은 복원값, 다른 기기는 옛 승자, 양쪽 다 "동기화 완료"라 말하는 조용한
   * 영구 분기다. 그리고 그 되살리기가 이 저장소가 CRDT 를 기각하며 내세운 **유일한 보상 경로**다.
   */
  echo?: boolean;
  /**
   * 되돌리기 스택을 **살려 둘 것인가**(기본 거짓 = 비운다 · 전역 ⌘Z 착지 조건 ①).
   *
   * ⚠⚠ 기본이 "비운다"인 이유: 받아온 행이 로컬 행을 덮으면 쌓아 둔 pre-image 는 *더 이상 어떤
   * 상태의 직전도 아니다.* 그걸 그대로 다시 쓰면 다른 기기의 편집을 fresh 스탬프로 덮어 **LWW 로
   * 이겨 서버까지 밀어올린다** — 되돌리기가 조용한 원격 소실 장치가 된다.
   *
   * ⚠ 참을 주는 곳은 **되돌리기 자신뿐**이다(`cloud/undo.ts`). 그건 스택을 *소비하는* 쪽이라
   * 여기서 비우면 **1단계 되돌리기**가 되어 버린다(한 번 누르면 나머지가 사라진다). 남은 항목이
   * 여전히 유효한 근거는 그쪽 머리주석이 갖는다.
   */
  keepUndo?: boolean;
}

/**
 * 받아온 배치를 로컬 SQLite 에 병합한다. **행 단위 LWW + 툼스톤 가드**로 서버와 같은 규칙이다.
 *
 * ⚠ 서버(`server/src/index.ts`)와 **같은 SQL 모양**이어야 한다. 한쪽만 고치면 기기마다
 * 병합 결과가 갈린다 — 그게 이 프로젝트에서 가장 비싼 종류의 버그다(재현이 기기 의존).
 */
export async function applyPull(batch: OutboxBatch, opts: ApplyPullOptions = {}): Promise<MergeResult> {
  const echo = opts.echo ?? true;
  /* ⚠ **한 배치로 병합한다**(H-1). 종전엔 행마다 `execDb` 를 순차로 await 했는데, 폰에선
     그게 200 번(pull 상한)의 워커 왕복이었다. 문장 순서는 그대로 유지한다 — 행 upsert 를
     먼저, 그다음 툼스톤(삽입 + 오래된 행 DELETE). 순서가 의미를 가지므로 배치 안에서도 이
     순서로 실행된다(워커·폴백 모두 배열 순). */
  const stmts: { sql: string; args: unknown[] }[] = [];

  for (const r of batch.rows) {
    const spec = SPEC.get(r.tbl);
    if (!spec) continue; // 스키마가 이미 걸렀어야 한다(방어적)
    const { key, data } = tableCols(spec);
    const names = [...key, ...data, 'updated_at'];
    const setters = [...data, 'updated_at'].map((c) => `${c} = excluded.${c}`).join(', ');
    const k1 = r.key[0] ?? '';
    const k2 = key.length === 2 ? (r.key[1] ?? '') : '';
    /* ⚠ 툼스톤 가드가 `ON CONFLICT` 만으로는 안 된다 — 행이 이미 지워졌으면 **충돌이 없어**
       LWW 조건이 평가되지 않고 오래된 편집이 부활한다. 서버에서 실측으로 잡은 결함이고
       (`server/test/contract.test.ts`), 로컬 병합도 같은 함정을 그대로 갖는다. */
    stmts.push({
      sql: `INSERT INTO ${spec.name} (${names.join(',')})
       SELECT ${names.map(() => '?').join(',')}
       WHERE NOT EXISTS (
         SELECT 1 FROM tombstones WHERE tbl = ? AND k1 = ? AND k2 = ? AND deleted_at >= ?
       )
       ON CONFLICT(${key.join(',')}) DO UPDATE SET ${setters}
       WHERE excluded.updated_at > ${spec.name}.updated_at`,
      args: [...r.key, ...r.data, r.updatedAt, r.tbl, k1, k2, r.updatedAt],
    });
  }

  for (const t of batch.tombstones) {
    stmts.push({
      sql: `INSERT INTO tombstones (tbl,k1,k2,deleted_at) VALUES (?,?,?,?)
       ON CONFLICT(tbl,k1,k2) DO UPDATE SET deleted_at = excluded.deleted_at
       WHERE excluded.deleted_at > tombstones.deleted_at`,
      args: [t.tbl, t.k1, t.k2, t.deletedAt],
    });
    const spec = SPEC.get(t.tbl);
    if (!spec) continue;
    const { key } = tableCols(spec);
    const where = key.map((k) => `${k} = ?`).join(' AND ');
    const keys = key.length === 2 ? [t.k1, t.k2] : [t.k1];
    /* ⚠ `<=` 다(H3). 부활 가드(위 `deleted_at >= updatedAt`)는 동점이면 **삭제 승**인데, 이
       DELETE 가 `<` 면 동점 행을 안 지워 **행 승**이라 방향이 엇갈렸다 — 같은 ms 에 A 가 삭제·
       B 가 편집하면 A=삭제·B=존재로 영구 분기했다(양쪽 "동기화 완료"). 두 규칙을 삭제 승으로
       통일한다. 서버(`server/src/index.ts`)도 같은 값이어야 한다(안 그러면 기기별 병합이 갈린다). */
    stmts.push({ sql: `DELETE FROM ${spec.name} WHERE ${where} AND updated_at <= ?`, args: [...keys, t.deletedAt] });
  }

  if (!stmts.length) return { state: null, applied: 0 };

  // 적용 건수 = 시도 건수(서버는 바뀐 것만 보내므로 실사용에선 실제 반영 수와 같다).
  const applied = batch.rows.length + batch.tombstones.length;

  /* ⚠ 병합 쓰기 + 씨앗 + 기준선을 flush 와 **같은 직렬화 단위**(`runExclusive`)에서 돌린다(H4).
     종전엔 아래 `readRows()` 창에 useApp 디바운스 flush 가 끼어들어, 기준선이 안 세워진 사이에
     낡은 메모리를 더 큰 스탬프로 써서 받아온 행을 되돌릴 수 있었다(그 되돌림이 LWW 로 서버까지
     이긴다 — 머리주석이 경고한 구멍). 체인에 얹어 겹침을 원천 차단한다. */
  const rows = await runExclusive(async () => {
    /* ⚠ 실패는 **던진다**(반환하지 않는다). `run.ts` 가 이 예외를 잡으면 pull 워터마크를
       전진시키지 않아 다음 pull 이 같은 구간을 재개한다. 종전 per-row `execDb` 는 실패를
       삼켜서 한 행이 실패해도 워터마크가 전진해 그 행이 조용히 유실될 수 있었다. */
    if (!(await batchDb(stmts))) throw new Error('병합 배치 실패 — pull 을 재개합니다.');

    /* ⚠ **되돌리기 스택을 무효화한다**(전역 ⌘Z). 근거는 `ApplyPullOptions.keepUndo` 주석이
       소유한다 — 요지는 "받아온 행 위에서는 pre-image 가 더 이상 직전이 아니다"이고, 그대로
       쓰면 되돌리기가 다른 기기 편집을 LWW 로 이겨 서버까지 지운다. 쓰기가 **성공한 뒤**에
       비우는 것이 맞다: 실패하면 로컬은 안 바뀌었으므로 스택도 여전히 유효하다. */
    if (!opts.keepUndo) clearUndo();

    /* ⚠ **씨앗을 심는다.** 받아온 스탬프가 로컬 최대값보다 클 수 있다(다른 기기가 더 최근).
       안 심으면 다음 로컬 편집이 그보다 작은 스탬프를 받아 "이미 보낸 것"으로 묻힌다.
       ⚠⚠ 이 한 줄이 동기화 코어의 **여러 불변식이 기대는 지점**이다 — 자세히는 `db/stamp.ts`
       와 `cloud/conflicts.ts` 의 "시계 공간" 절(H31-①). 지우면 조용히 여러 곳이 틀린다. */
    for (const r of batch.rows) seedStamp(r.updatedAt);
    for (const t of batch.tombstones) seedStamp(t.deletedAt);

    /* 방금 받은 행을 적어 둔다 — 다음 아웃박스 스캔이 이 행들을 **되돌려 올리지 않게**(H31-②).
       정확성 장치가 아니라 유선 절약이고, 표가 비어도 종전 거동일 뿐이다(`outbox.ts` 머리주석).
       ⚠ 합성 배치(되살리기)는 여기 들어오면 안 된다 — `ApplyPullOptions.echo` 주석이 소유한다. */
    if (echo) noteMergedRows(batch.rows);

    /* ⚠ 받아온 것에 `docs` 행이 있으면 메모리 사본을 되맞춘다(H1). `docs._cache` 는 부팅에만
       채워져, 안 하면 폰 `ReadsView` 가 받아온 독후감·미러 산출물을 재시작까지 못 본다. */
    if (batch.rows.some((r) => r.tbl === 'docs')) await reloadDocs();

    /* ⚠ **기준선을 먼저, 상태를 나중에.** 이 순서가 에코를 막는다(머리주석 참조).
       되읽은 행으로 기준선을 세워야 `applyMerged` 의 flush(진행 중 편집이 있을 때만)가 받아온
       행을 되돌리지 않는다. */
    const back = await readRows();
    if (back) {
      setDiffBaseline(back);
      /* ⚠ 기준선을 세운 **바로 이 순간부터** 메모리(`applyMerged`)가 반영될 때까지 flush 를 막아야
         한다(C1). 기준선(병합-후)과 메모리(병합-전)가 어긋난 창이 여기서 열리기 때문 — 켜기를
         기준선-세우기와 같은 문장에 두어 그 창의 시작을 원자적으로 만든다. `applyMerged`(성공) 또는
         `runSync` finally(실패 경로)가 반드시 끈다. `back` 이 null(되읽기 실패)이면 기준선도 안 서고
         `applyPull` 이 state=null 을 돌려 `applyMerged` 가 안 불리므로, 여기서 켜지 않는 것이 맞다. */
      beginMergeApply();
    }
    return back;
  });

  if (!rows) return { state: null, applied };
  return { state: rowsToState(rows), applied };
}
