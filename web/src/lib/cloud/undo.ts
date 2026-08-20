/* ============================================================
   cloud/undo.ts — 전역 ⌘Z 의 **적용부**: pre-image 를 다시 쓴다(근본① · 2026-08-01).

   ## ⚠ 새 쓰기 경로를 만들지 않는다 — 검증된 병합 기계를 재사용한다

   되돌리기 = 옛 값을 **fresh 스탬프로 다시 쓰는 것**이고, 그건 `store/syncController.restoreConflict`
   (충돌 되살리기)가 이미 하는 일과 **정확히 같은 모양**이다. 그래서 손으로 테이블별 SQL 을 짜지
   않고 한 배치짜리 합성 배치를 `applyPull` 에 먹인다 — 툼스톤 가드·LWW·씨앗·기준선 세우기·
   에코 방지가 전부 그 안에 있어 **테이블 무관하게** 안전하다.

   사본을 만들면 이 저장소가 그 지점에서 이미 낸 사고 넷(C1·C2·H4·H8)과 같은 부류가 **다섯 번째**로
   생긴다. 넷 다 출하 뒤 감사에서 발견됐다는 것이 요점이다 — "동작한다"가 검증이 아니었다.

   ## ⚠⚠ 두 옵션이 이 파일의 정합성 전부다

   · **`echo: false`** — 이건 원격 수신이 아니라 *로컬 편집*이다. 참이면 억제표가 이 행을
     **키·스탬프 정확 일치**로 다음 배치에서 빼고 워터마크가 그 위로 전진해, 되돌린 값이 다른
     기기에 **영원히 안 간다**(재시작해도 안 낫는다). 근거는 `merge.ts` 의 `echo` 주석이 소유한다.
   · **`keepUndo: true`** — `applyPull` 은 기본으로 스택을 비운다(받아온 행 위에서는 pre-image 가
     무효라서). 되돌리기는 스택을 *소비하는* 쪽이라 여기서 비우면 **1단계 되돌리기**가 된다.
     남은 항목이 여전히 유효한 이유: 항목 N 을 되돌리면 DB 는 "쓰기 N 직전" = "쓰기 N-1 직후"가
     되고, 그게 정확히 항목 N-1 의 pre-image 가 기대하는 베이스다(체인이 끊기지 않는다).
============================================================ */
import {
  dropRedo,
  dropUndo,
  peekRedo,
  peekUndo,
  pushRedo,
  pushUndoFromRedo,
  type PreImageRow,
  type UndoEntry,
} from '../db/undoStack';
import { selectDb } from '../db/sqlite';
import { nextStamp } from '../db/stamp';
import { applyPull } from './merge';
import { OUTBOX_TABLES, tableCols, type OutboxRow, type OutboxTomb } from './contract';
import type { AppState } from '../types';

const SPEC = new Map(OUTBOX_TABLES.map((t) => [t.name, t]));

export interface UndoOutcome {
  /** 메모리에 실을 새 상태. 호출부가 `applyMerged()` 에 넣어야 완결된다(⚠ `loadState` 아님). */
  state: AppState | null;
  /** 실제로 되돌린 행 수. */
  restored: number;
  /** 다른 기기가 그 뒤에 지워서 **되돌리지 않은** 행 수(아래 가드). */
  skipped: number;
  /** 되돌릴 것이 아예 없었다(스택이 비었다). `skipped` 와 구분해야 문구가 거짓말을 안 한다. */
  empty: boolean;
}

/** 툼스톤 식별자 — **JSON 튜플**로 잇는다(H31-③ 과 같은 규약 · 구분자 없는 연결은 복합키를 접는다). */
const tombKey = (tbl: string, k1: string, k2: string): string => JSON.stringify([tbl, k1, k2]);

/**
 * 가장 최근 쓰기를 되돌린다. 스택이 비었으면 아무것도 하지 않는다(`empty:true`).
 *
 * ⚠ 호출부(`store/undoController`)는 **디바운스 대기 중인 편집을 먼저 확정**해야 한다 —
 * 안 그러면 아직 쌓이지도 않은 편집을 두고 그 앞 것을 되돌린다.
 */
export async function undoLastWrite(): Promise<UndoOutcome> {
  return applyInverse(peekUndo(), dropUndo, pushRedo);
}

/**
 * **Q-8 다시 실행(⇧⌘Z).** 되돌리기가 덮기 직전의 값을 되돌려 놓는다.
 *
 * ⚠ 별도 경로를 만들지 않는다 — 되돌리기와 **글자 그대로 같은 연산**이고, 다른 것은 (어느
 * 스택에서 꺼내나 · 어디에 반대편을 쌓나) 둘뿐이다. 몸통을 복제하면 툼스톤 가드나 `echo:false`
 * 가 한쪽에만 남는 식으로 갈리는데, 그게 이 파일 머리주석이 경고하는 사고 넷의 형태다.
 */
export async function redoLastWrite(): Promise<UndoOutcome> {
  return applyInverse(peekRedo(), dropRedo, pushUndoFromRedo);
}

/**
 * 되돌리기·다시실행의 공통 몸통. 방향의 차이는 인자 셋뿐이다.
 *
 * @param entry        적용할 항목(없으면 `empty:true`).
 * @param drop         적용에 **성공한 뒤** 그 항목을 버리는 함수(항등 대조는 그 안에 있다).
 * @param pushOpposite 덮기 **직전** 값을 반대편 스택에 쌓는 함수 — 이게 방향을 되돌릴 수 있게 한다.
 */
async function applyInverse(
  entry: UndoEntry | null,
  drop: (e: UndoEntry) => void,
  pushOpposite: (rows: PreImageRow[], stamp: number) => boolean,
): Promise<UndoOutcome> {
  /* ⚠⚠ **peek → apply → drop** 이지 pop 이 아니다(H2 · 2026-08-01). 먼저 꺼내면 아래 `applyPull`
     이 던질 때 항목이 이미 사라진 뒤라, ⌘Z 를 누를 때마다 스택이 한 칸씩 **조용히 파괴**된다
     (호출부에 `.catch` 도 없어 화면은 아무 말도 안 했다). 근거는 `db/undoStack.peekUndo` 주석. */
  if (!entry) return { state: null, restored: 0, skipped: 0, empty: true };

  /* ⚠⚠ **툼스톤 가드 — 다른 기기가 지운 행은 되살리지 않는다**(착지 조건 ④).

     `applyPull` 자신의 가드(`deleted_at >= ?`)는 여기서 **원리적으로 못 도와준다**: 우리는 fresh
     스탬프(단조 최대)를 싣기 때문에 그 조건이 언제나 거짓이라 무조건 부활한다. 그게 일반 편집에는
     옳다 — 지워진 행을 다시 만드는 것은 정당한 새 편집이다. 그러나 되돌리기는 **소급 조작**이라
     성질이 다르다: 내 쓰기 *뒤에* 내려진 삭제 결정을 조용히 뒤집으면 안 된다.

     그래서 판정을 이 층에서 한 번 한다 — 기준은 항목의 스탬프이고, 질의는 한 번이다(`deleted_at >`
     로 이미 좁혀지므로 실사용에선 0행). 걸린 행은 **버리지 않고 세어서 말한다**(침묵이 결함이다).

     ⚠ "다른 기기가 **편집**한 행"은 여기서 안 본다 — pull 이 오면 스택이 통째로 비므로
     (`merge.applyPull`) 그 상태 자체가 성립하지 않는다. 툼스톤만 보는 이유는 그 하나가 *같은
     pull 에 실려 온 뒤에도* 남아 있는 흔적이라 방어가 공짜이기 때문이다. */
  const later = await selectDb<{ tbl: string; k1: string; k2: string }>(
    'SELECT tbl, k1, k2 FROM tombstones WHERE deleted_at > ?',
    [entry.stamp],
  );
  const blocked = new Set((later ?? []).map((t) => tombKey(String(t.tbl), String(t.k1), String(t.k2))));

  const rows: OutboxRow[] = [];
  const tombstones: OutboxTomb[] = [];
  let skipped = 0;
  /* ⚠⚠ **이 역연산이 찍은 최대 스탬프** — 반대편 스택의 기준선이 된다(아래 `pushOpposite`).
     `entry.stamp`(원본 쓰기의 스탬프)를 쓰면 안 되는 이유가 이 변수의 존재 이유 전부다. */
  let inverseStamp = 0;
  for (const p of entry.rows) {
    const spec = SPEC.get(p.table);
    if (!spec) continue; // 캡처가 이미 걸렀어야 한다(sync 테이블만 담는다 · rows.ts) — 방어적
    const key = p.key.map((k) => String(k));
    const k1 = key[0] ?? '';
    const k2 = spec.keyLen === 2 ? (key[1] ?? '') : '';
    if (blocked.has(tombKey(p.table, k1, k2))) {
      skipped++;
      continue;
    }
    const stamp = nextStamp();
    if (stamp > inverseStamp) inverseStamp = stamp;
    if (p.vals) rows.push({ tbl: p.table, key, data: p.vals.slice(spec.keyLen), updatedAt: stamp });
    // 없던 행 = 이번 쓰기가 만든 행 → 되돌리기는 **삭제**다(툼스톤을 남겨 다른 기기에도 전파된다).
    else tombstones.push({ tbl: p.table, k1, k2, deletedAt: stamp });
  }

  /* 쓸 것이 하나도 안 남았다(전부 툼스톤에 막혔다) → 적용은 없지만 **항목은 소비된 것**이다.
     남겨 두면 같은 ⌘Z 가 같은 경고를 영원히 반복한다. */
  if (!rows.length && !tombstones.length) {
    drop(entry);
    return { state: null, restored: 0, skipped, empty: skipped === 0 };
  }

  /* ⚠⚠ **반대 방향을 먼저 확보한다**(Q-8). 지금 DB 에 있는 값이 곧 "이 되돌리기를 되돌리는 값"
     이다 — 쓰고 나면 영원히 못 읽으므로 **쓰기 전에** 읽어야 한다. 실패해도 무해하다: 아래
     `applyPull` 이 던지면 항목이 그대로 남아 재시도가 성립하고, 반대편 스택에 쌓인 것은 다음
     시도에서 같은 값으로 다시 덮인다. */
  /* ⚠⚠ **기준선은 `entry.stamp` 가 아니라 `inverseStamp` 다**(2026-08-20 리뷰 M-6).

     종전엔 원본 쓰기의 스탬프를 그대로 실었는데, 그러면 위 툼스톤 가드(`deleted_at > 항목의
     스탬프`)에 **이 역연산이 방금 찍은 툼스톤이 언제나 걸린다** — `nextStamp()` 는 단조라
     항상 `entry.stamp` 보다 크기 때문이다. 결과는 **"추가 → ⌘Z → ⇧⌘Z" 가 100% 실패**하고,
     그것도 *"다른 기기가 지워 되돌리지 않았어요"* 라는 **거짓 사유**와 함께 항목이 소비된다
     (`store/undoController.ts` 의 `skipped` 문구 · 다른 기기는 관여한 적이 없다).

     반대 방향 항목의 기준선은 "그 항목이 만들어질 때 세상이 어땠나"여야 하고, 그 시점은
     원본 쓰기가 아니라 **이 역연산**이다. 그래야 가드가 *역연산 이후에 다른 기기가 내린 삭제*
     만 잡는다 — 원래 의도한 의미론 그대로. */
  pushOpposite(await currentImages(rows, tombstones), inverseStamp);

  const merged = await applyPull({ since: 0, upto: 0, rows, tombstones }, { echo: false, keepUndo: true });
  drop(entry); // ⚠ 성공한 **뒤에만**. 던지면 항목이 남아 재시도가 성립한다(H2).
  return { state: merged.state, restored: rows.length + tombstones.length, skipped, empty: false };
}

/**
 * 이 배치가 손댈 행들의 **현재 모습**을 pre-image 모양으로 읽는다(Q-8 다시실행의 재료).
 *
 * ⚠ 없는 행은 `vals: null` 로 담는다 — 되돌리기가 *만든* 행은 다시실행에서 *지워야* 하고,
 * 그 표현이 곧 `null` 이다(`PreImageRow.vals` 주석과 같은 규약).
 * ⚠ `updated_at` 은 안 담는다 — 우리가 매번 새로 찍는 값이라 pre-image 의 일부가 아니다.
 */
async function currentImages(rows: readonly OutboxRow[], tombs: readonly OutboxTomb[]): Promise<PreImageRow[]> {
  const targets = [
    ...rows.map((r) => ({ tbl: r.tbl, key: r.key.map(String) })),
    ...tombs.map((t) => ({ tbl: t.tbl, key: [t.k1, t.k2] })),
  ];
  const out: PreImageRow[] = [];
  for (const t of targets) {
    const spec = SPEC.get(t.tbl);
    if (!spec) continue;
    const { key } = tableCols(spec);
    const keyVals = key.map((_, i) => t.key[i] ?? '');
    const where = key.map((k) => `${k} = ?`).join(' AND ');
    const got = await selectDb<Record<string, unknown>>(
      `SELECT ${spec.cols.join(',')} FROM ${spec.name} WHERE ${where}`,
      keyVals,
    );
    const row = got?.[0];
    out.push({ table: spec.name, key: keyVals, vals: row ? spec.cols.map((c) => row[c]) : null });
  }
  return out;
}
