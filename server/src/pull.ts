/* ============================================================
   pull.ts — 받아오기의 **페이지네이션 규칙**(순수).

   ## 왜 라우트에서 떼어냈나

   규율 11-2("커맨드는 AppHandle 을 로직에 섞지 말 것 — 경로·값만 받는 순수 함수로 갈라 두면
   그 자리가 곧 통합 테스트 진입점이 된다")를 서버에 적용한 것이다. D1 바인딩에 묶여 있으면
   노드에서 부를 수 없어 `contract.test.ts` 가 SQL 문자열을 **복제**해야 했는데(그 파일이
   스스로 그렇게 적어 뒀다), 같은 실수를 pull 에서 반복하지 않는다.

   여기 있는 것은 "무엇을 어디까지 줄 것인가"이고, "어떻게 읽는가"는 호출부가 주입한다.

   ## ⚠⚠ 이 파일이 존재하는 이유가 된 결함 (2026-07-20 감사)

   종전 pull 은 테이블마다 **따로** `LIMIT` 을 걸고 `upto = max(전체 스탬프)` 를 돌려줬다:

       A 테이블이 200개에서 잘림(마지막 스탬프 200) · B 테이블은 5000 까지 전부 반환
       → upto = 5000 → 클라이언트가 pullMark = 5000 커밋
       → A 의 201~5000 은 다음 질의 `updated_at > 5000` 에 **영영 안 걸린다**

   C-1 이 fence 로 막은 것과 **같은 실패 모드**(수집 안 된 것이 워터마크 아래로 묻힌다)인데
   방향만 반대(받기)다. 설계서가 _"과다 포함은 LWW 라 무해하고 과소 포함만 위험하다"_ 는
   비대칭을 적어 뒀는데, 그 규율이 수신 측에는 적용돼 있지 않았다.
============================================================ */

/** 한 소스에서 읽은 한 페이지. `cap` 이 null 이면 안 잘렸다 = 상한을 강제하지 않는다. */
export interface Page<T> {
  items: T[];
  cap: number | null;
}

/**
 * 한 소스를 `limit` 개까지 읽되, **잘렸으면 안전 상한**을 함께 돌려준다.
 *
 * ⚠ **스탬프 그룹을 쪼개지 않는다**(`capBatch` 와 같은 규칙). 같은 flush 가 만든 행들은
 * 스탬프가 같아서, 그룹 한가운데를 자르고 `upto` 를 그 스탬프로 잡으면 나머지가 `> upto` 가
 * 아니라 `= upto` 라 **영영 제외**된다. 그래서 안전 상한은 *버려지는 첫 행의 스탬프 - 1* 이다.
 *
 * ⚠ 그룹 하나가 혼자 `limit` 을 넘으면 **통째로 준다**(`fetchGroup`). 안 그러면 안전 상한이
 * `since` 와 같아져 진행이 0 이 되고 **영구 교착**이다 — `capBatch` 의 `taken > 0` 가드와
 * 같은 판단이고 근거도 같다: **정확성이 상한보다 우선**이다(상한은 성능 장치이지 안전
 * 장치가 아니다).
 */
export async function readPage<T>(
  stampOf: (x: T) => number,
  fetchN: (n: number) => Promise<T[]>,
  fetchGroup: (stamp: number) => Promise<T[]>,
  limit: number,
): Promise<Page<T>> {
  const got = await fetchN(limit + 1);
  if (got.length <= limit) return { items: got, cap: null };

  const cut = stampOf(got[limit]!); // 처음으로 **버리는** 행의 스탬프
  const kept = got.filter((x) => stampOf(x) < cut);
  if (kept.length === 0) return { items: await fetchGroup(cut), cap: cut };
  return { items: kept, cap: cut - 1 };
}

/**
 * 전역 상한을 정한다.
 *
 * 잘린 소스가 하나라도 있으면 **가장 보수적인 값**(최솟값)을 쓴다 — 하나라도 불완전하면
 * 그 지점 너머는 "받았다"고 말할 수 없다. 아무 소스도 안 잘렸으면 받은 것의 최대값까지
 * 전진해도 안전하다. 받은 것이 없으면 `since` 그대로 — 전진할 근거가 없다.
 *
 * ⚠ **반드시 `since` 보다 크거나 같다.** 진행이 0 이면 클라이언트가 같은 구간을 영원히 다시
 * 묻는다. `readPage` 가 그룹 통째 반환으로 `cap > since` 를 보장하므로 여기서는 유도된다.
 */
export function ceilingOf(caps: number[], stamps: number[], since: number): number {
  if (caps.length) return Math.min(...caps);
  return stamps.length ? Math.max(...stamps) : since;
}
