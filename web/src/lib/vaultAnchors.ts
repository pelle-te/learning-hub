/* ============================================================
   vaultAnchors.ts — 볼트 `reviewed:` 를 챕터 복습 앵커로 잇는 한 곳(W2 · 2026-07-31).

   ## 왜 있는가
   볼트 인덱스는 노트 468건에 `reviewed:`(검증 통과일)를 갖고, 그걸 앱의 사다리(`riskOf`)에
   넣으면 **overdue 26 · due 6 · fresh 2** 다. 그런데 앱은 "복습 0/0"이라 말한다 — 경계
   (`vault.ts` 의 옛 `IndexNote` 5키)가 그 필드를 버리고 있었기 때문이다.

   ## 방향 제약 — 이 모듈의 본체
   ⚠⚠ `reviewed:` 는 **인출일이 아니라 검증 통과일**이다. 그래서 위험을 **올리는 방향으로만**
   쓴다: 앱 앵커(완료 세션·`reviewTouches`)가 하나라도 있는 챕터에는 **절대 개입하지 않는다.**
   반대로 쓰면(볼트 날짜가 앱 앵커를 덮어 최신으로 만들면) 잊은 챕터가 큐에서 사라지고 사용자는
   "복습 없음"을 정상으로 읽는다 — `spacedReview.ts:44-50` 이 못박은 비대칭과 **같은 규칙**이다.

   ⚠ 부모(`벌트DB.py:1032`)가 _"라이브 관측이 흐르면 관측이 우선하고 이 지표는 폴백으로
   강등되어야 한다"_ 고 적었다. 앱이 이걸 승격시키면 강등할 주체가 사라지므로 **볼트 유래
   앵커는 `fromVault` 로 표식**하고 UI 가 배지로 구분한다(`ChapterReview.fromVault`).

   ## 왜 레지스트리(모듈 상태)인가
   앵커의 출처는 `['vault']` **쿼리 캐시**다 — 앱 상태가 아니다(스키마 0 · 동기화 0 이 W2 의
   제약이다). 그런데 소비처는 `chapterReviews` 를 부르는 8곳이고 그중엔 `store/selectors` 의
   참조-캐시와 `lib/reviewQueue` 처럼 React 밖도 있어, 인자로 꿰면 lib 시그니처 여덟이 한꺼번에
   흔들린다. 그래서 **쓰는 곳 하나**(`useVaultAnchorsSync`)·**읽는 곳 lib 내부**로 좁힌 레지스트리를
   둔다. 안전한 이유는 위 방향 제약이다 — 레지스트리가 비어 있거나 낡아도 최악이 "볼트가 아는
   위험을 아직 모른다"이지 **없는 안전을 주장하지는 않는다**.
   버전 카운터를 함께 노출해 메모 키가 갱신을 관측할 수 있게 한다(안 그러면 배지가 조용히 stale).
============================================================ */
import { matchSubjectIndex } from './subjectMatch';
import type { VaultScan } from './vault';
import type { Item } from './types';

/** `sid|챕터명` → 볼트 `reviewed:` 최신일. */
export type VaultAnchors = ReadonlyMap<string, string>;

const EMPTY: VaultAnchors = new Map();
let current: VaultAnchors = EMPTY;
let version = 0;
const subs = new Set<() => void>();

/**
 * 앵커가 갈렸을 때 알림(반환값은 해제 함수).
 *
 * ⚠⚠ **버전 카운터만으로는 반쪽이었다(H7 · 2026-07-31 `/감사 근본`).** 카운터는 `selectors` 의
 * 참조-캐시가 *다시 계산하게* 만들지만, **다시 계산할 계기 자체를 만들지는 않는다** — 소비처는
 * `useApp((s) => s.state)` 를 구독하는데 앵커는 스토어가 아니라 모듈 상태이기 때문이다. 그래서
 * ① 콜드 부팅 첫 화면이 앵커 없이 그려지고(스캔은 마운트 뒤에 도착한다) ② **볼트 감시로 갱신이
 * 도착해도 그 화면에 머무는 한 반영이 0** 이었다(다음 렌더까지). 머리주석이 경고한 _"조용히
 * stale"_ 이 다른 경로로 성립한 것이다.
 *
 * ⚠ 앵커를 `AppState` 로 올려 해결하지 않는다 — 그건 W2 의 제약(스키마 0 · 동기화 0)을 깨고,
 * 무엇보다 **볼트 유래 값이 `settings` 행을 타고 D1 으로 나가는** 경로를 새로 만든다
 * (`_vaultScan` 이 정확히 그 이유로 프라이버시 가드였다 — `lib/persistence.ts`).
 */
export function subscribeVaultAnchors(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

/** 현재 등록된 볼트 앵커(없으면 빈 맵). lib 내부 소비 전용. */
export function vaultAnchors(): VaultAnchors {
  return current;
}
/** 메모 키에 싣는 버전 — 앵커가 갈리면 증가한다(참조-캐시가 갱신을 관측하는 유일한 방법). */
export function vaultAnchorsVersion(): number {
  return version;
}
/** 앵커 교체(쓰는 곳은 `useVaultAnchorsSync` 하나). 내용이 같으면 버전을 올리지 않는다. */
export function setVaultAnchors(next: VaultAnchors): void {
  if (next.size === current.size && [...next].every(([k, v]) => current.get(k) === v)) return;
  current = next;
  version++;
  // 구독자에게 알린다 — 하나가 던져도 나머지·레지스트리를 막지 않는다.
  for (const cb of [...subs]) {
    try {
      cb();
    } catch {
      /* 관측이 데이터를 해치지 않는다 */
    }
  }
}
/** 테스트·리셋용 — 레지스트리를 비운다. */
export function clearVaultAnchors(): void {
  setVaultAnchors(EMPTY);
}

/**
 * 볼트 스캔 + 앱 과목 → 앵커 맵(순수).
 *
 * 조인은 **과목 이름 하나**만 `subjectMatch` 규칙에 맡기고(표기 흔들림 흡수), 챕터는 정확
 * 일치를 요구한다 — 앱 챕터는 `chaptersFromVault` 가 볼트 폴더명 그대로 만든 것이라 정확
 * 일치가 정상이고, 여기서 퍼지 매칭을 하면 "01 미분"과 "01 미분의 응용"이 앵커를 나눠 갖는다.
 */
export function vaultAnchorsFrom(scan: VaultScan | null | undefined, items: readonly Item[]): VaultAnchors {
  const out = new Map<string, string>();
  if (!scan || !scan.subjects.length) return out;
  const names = scan.subjects.map((s) => s.name);
  for (const it of items) {
    const si = matchSubjectIndex(it.name || '', names);
    if (si < 0) continue;
    const byName = new Map(scan.subjects[si]!.chapters.map((c) => [c.name, c.reviewedRecent]));
    for (const ch of it.chapters || []) {
      const rv = byName.get(ch.name);
      if (rv) out.set(it.id + '|' + ch.name, rv);
    }
  }
  return out;
}
