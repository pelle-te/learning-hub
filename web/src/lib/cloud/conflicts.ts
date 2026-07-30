/* ============================================================
   cloud/conflicts.ts — 병합이 **행 단위 LWW 로 조용히 덮는 동시 편집**을 포착한다(순수·읽기전용).

   ## 이 파일이 하지 않는 것

   병합 규칙을 바꾸지 않는다. `merge.ts`/서버는 그대로 LWW(늦은 스탬프 승)로 남는다 — 그게
   불변식이고 기기별로 갈리면 안 되는 SQL 이다(`sync-core-audit`). 이 파일은 그 판정을
   **관찰만** 한다: "원격이 이겨서 덮은 로컬 값이 사실 사용자가 방금 고친 것이었나?"를 묻고,
   맞으면 그 **패배한 로컬 값을 그림자로** 남긴다. 사용자가 "다른 기기 편집에 내 편집이
   덮였다"를 뒤늦게라도 알고 되살릴 수 있게 하는 것이 목적(설계서 §150 이 CRDT 를 배제한
   대가 — 조용한 손실 — 를 UI 로 메운다).

   ## 진짜 충돌만 — 오탐을 만들지 않는다

   LWW 가 이기는 경우는 흔하다(에코·정상 최신화 포함). 그중 **손실이 실재하는 것**만 고른다:

     1) 원격이 실제로 덮는다         remote.updatedAt >  local.updatedAt
     2) 로컬도 지난 pull 이후 편집했다 local.updatedAt  >  pullMark   (동시 편집의 증거)
     3) 값이 실제로 다르다           data 가 다름                     (같으면 손실 0)

   (2)가 핵심이다. 로컬이 지난 수신 워터마크 이후로 바뀌지 않았다면 원격이 이겨도 그건 그냥
   **정상 최신화**(다른 기기가 만든 유일한 변경을 받는 것)라 손실이 아니다. 로컬이 그 이후
   바뀌었는데 원격이 이기면 — 두 기기가 같은 레코드를 각자 고쳤고 하나가 졌다는 뜻이다.

   ## ⚠⚠ 왜 **기기 간 스탬프를 그냥 비교해도** 되는가 (H31-① · 2026-07-30 `/감사 근본`)

   위 세 조건은 전부 **다른 기기가 찍은 값**(`r.updatedAt` · `pullMark`)과 **내가 찍은 값**
   (`cur.updatedAt`)을 직접 비교한다. 두 기기의 벽시계가 다르면 이건 성립할 수 없는 비교처럼
   보이고, 실제로 감사가 그렇게 의심했다(_"기기 간 시계 공간을 섞는다"_). **결론은 안전이지만
   그 근거가 어디에도 적혀 있지 않았다** — 그래서 여기 적는다. 근거가 없는 안전은 다음 사람이
   `seedStamp` 한 줄을 지우는 순간 조용히 무너진다.

   근거는 `merge.ts` 의 `for (const r of batch.rows) seedStamp(r.updatedAt)` 다. 받아온 모든
   스탬프가 **로컬 발급기의 하한**이 되고(`db/stamp.ts` 의 `seedStamp` 는 더 큰 값만 채택),
   `nextStamp()` 는 `max(Date.now(), _last + 1)` 이라 그 하한보다 반드시 크다. 따라서:

     · 내 시계가 아무리 느려도 **pull 이후의 로컬 편집은 `pullMark` 보다 큰 스탬프**를 받는다
       → (2)의 "지난 pull 이후 안 바뀜" 판정이 거짓음성을 내지 않는다.
     · 즉 스탬프는 기기별 벽시계가 아니라 **모든 기기가 공유하는 단조 공간**에 산다. 벽시계는
       그 공간의 *초깃값 제안자*일 뿐이다.

   ⚠ 이 성질은 `seedStamp` 호출이 **모든 수신 경로**에 있어야 유지된다. 새 수신 경로를 만들면
   거기서도 씨앗을 심을 것. 검사는 `test/cloudConflicts.test.ts` 의 "시계 공간" 절이 한다.

   detectedAt 은 순수성을 위해 **인자로 받는다**(모듈이 시계를 읽지 않는다 — 테스트 결정성).
============================================================ */
import type { OutboxBatch } from './contract';

/** 병합 직전 로컬 행 한 줄(키로 조회). data 열 순서는 `tableCols(spec).data` 와 같다. */
export interface LocalRowSnap {
  data: unknown[];
  updatedAt: number;
}

/** 로컬 스냅샷 — `snapKey(tbl, key)` 를 키로 한다. 호출부가 병합 전에 채운다. */
export type LocalSnapshot = Map<string, LocalRowSnap>;

/** 덮여서 사라진 로컬 편집 하나의 기록(되살리기·이력의 원천). */
export interface ConflictShadow {
  tbl: string;
  /** 원본 기본키(1~2 열). */
  key: string[];
  /** 덮인(패배한) 로컬 값 — 되살리기의 소스. */
  localData: unknown[];
  localUpdatedAt: number;
  /** 이긴 원격 값 — "무엇으로 덮였나". */
  remoteData: unknown[];
  remoteUpdatedAt: number;
  /** 이 충돌을 관찰한 시점(호출부 주입 · 순수 유지). */
  detectedAt: number;
}

/** 스냅샷 맵의 키 — `[tbl, k1, k2]` JSON. 2열 키는 두 번째까지, 1열은 빈 문자열(db.rs v3 규약).
 *  JSON 튜플이라 키 값(id·날짜·제목)에 무슨 문자가 들어와도 경계가 애매해지지 않는다. */
export function snapKey(tbl: string, key: string[]): string {
  return JSON.stringify([tbl, key[0] ?? '', key[1] ?? '']);
}

/** data 열은 원시값(문자/숫자/불리언/널)이라 얕은 === 비교로 충분하다(rows.ts 계약). */
function dataEqual(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * 받아온 배치가 LWW 로 **조용히 덮을 동시 편집**만 골라 그림자로 돌려준다. 순수·부작용 없음.
 * merge 의 결과에 영향을 주지 않는다 — 호출부는 이 결과를 기록만 하고 병합은 그대로 진행한다.
 *
 * 툼스톤(원격 삭제 vs 로컬 편집)은 **의도적으로 제외**한다: 삭제는 대개 명시적 사용자 의도라
 * "덮였다" 프레이밍이 맞지 않고, 되살리기 UX 도 값 복원과 다르다. 필요해지면 별도로 다룬다.
 */
export function detectConflicts(
  batch: OutboxBatch,
  local: LocalSnapshot,
  pullMark: number,
  detectedAt: number,
): ConflictShadow[] {
  const out: ConflictShadow[] = [];
  for (const r of batch.rows) {
    const cur = local.get(snapKey(r.tbl, r.key));
    if (!cur) continue; // 로컬에 없던 행 — 순수 추가, 충돌 아님
    if (r.updatedAt <= cur.updatedAt) continue; // (1) 원격이 안 이김(에코 포함) — 덮지 않는다
    if (cur.updatedAt <= pullMark) continue; // (2) 로컬이 지난 pull 이후 안 바뀜 — 정상 최신화
    if (dataEqual(cur.data, r.data)) continue; // (3) 값 동일 — 손실 0
    out.push({
      tbl: r.tbl,
      key: r.key,
      localData: cur.data,
      localUpdatedAt: cur.updatedAt,
      remoteData: r.data,
      remoteUpdatedAt: r.updatedAt,
      detectedAt,
    });
  }
  return out;
}
