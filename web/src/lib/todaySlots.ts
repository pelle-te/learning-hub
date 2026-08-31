/* ============================================================
   todaySlots.ts — 오늘 탭이 **몇 개를 띄울지** 고르는 규칙(W19·W20 · 2026-07-31 · 순수).

   두 선택이 여기 있다:
   ① `pickRetrievalSlot` — 홈의 인출 카드는 **하루 한 장**이다(W20).
   ② `pickNextStep`      — 완료 화면의 다음 걸음은 **하나**다(W19).

   ## 왜 lib 인가
   둘 다 "무엇을 보여줄까"라는 **판정**이고, 오늘 탭은 이미 인지복잡도 래칫의 상한에 붙어 있다.
   판정을 컴포넌트에 두면 그 상한이 곧 "판정을 더 정교하게 만들지 못하는 이유"가 된다 —
   E17 이 세운 규율(판정=lib · 그리기=components)의 같은 자리다.
============================================================ */

/** 오늘 띄울 인출 카드. 둘 다 있으면 **날짜로 회전**한다. */
export type RetrievalSlot = 'conf' | 'recall' | null;

/**
 * ⚠⚠ **없애지 않고 회전시킨다.** 홈의 인출 카드는 "가려던 게 아닌데 하게 되는" 우발적 인출이
 * 값어치라, 슬롯을 지우면 이 앱이 만드는 학습 증거가 함께 준다. 두 소스 다 이미 날짜 해시로
 * 후보를 고르므로(`pickRetrieval`·`pickConfidentWrong`) 회전이 그 규칙의 연장이고, **매일 한 장은
 * 계속 뜬다**(빈도가 아니라 동시 표시만 줄인다).
 *
 * ⚠ 하나뿐이면 그것이 뜬다 — 회전 때문에 "있는데 안 뜨는 날"이 생기면 그건 회전이 아니라 유실이다.
 * ⚠ 둘 다 있을 때 짝수 날에 착각이 이긴다: "확신했는데 틀린 것"은 오답으로 **이미 관측된 사실**이라
 *   늦게 발견될수록 비싸다. 회상은 다음 날 온다.
 */
export function pickRetrievalSlot(hasConf: boolean, hasRecall: boolean, dayOfMonth: number): RetrievalSlot {
  if (hasConf && hasRecall) return dayOfMonth % 2 === 0 ? 'conf' : 'recall';
  if (hasConf) return 'conf';
  return hasRecall ? 'recall' : null;
}

/** 완료 화면의 다음 걸음 한 개. `kind` 로만 말하고 목적지·문구는 호출부가 안다(lib 은 라우트를 모른다). */
export interface NextStep {
  kind: 'review' | 'backlog';
  label: string;
  aria: string;
}

/**
 * 우선순위는 "지금 행동을 바꾸는 것" 순이다: 밀린 복습 > 열린 보충.
 *
 * ⚠ 사슬 순서가 반증 불가능한 숨은 가중치라는 것은 로드맵 🧊 가 지적한 형태다. 여기서 사슬을
 * 허용하는 조건은 **후보 전부가 화면에 다른 자리를 갖고 있다**는 것이다(W18 의 '오늘 밖'
 * 구역 · 레일) — 사슬이 무엇을 가리키든 나머지가 화면에서 사라지지 않는다.
 *
 * ⚠⚠ **셋째 후보(`frontier` — 다음 개념 추천)는 2026-08-31 에 걷었다**(U044·U086). 그 값의
 * 생산자(지식엔진)가 은퇴해 `frontierTitle` 은 영구히 빈 문자열이었고, 착지처로 적어 둔
 * 「숙달도 탭」은 라우터에 없어 `*` 가 `/today` 로 삼켰다 — 즉 위 조건이 이미 깨져 있었다.
 */
export function pickNextStep(riskN: number, openBacklogN: number): NextStep | null {
  if (riskN > 0) return { kind: 'review', label: `복습 위험 ${riskN}`, aria: `밀린 복습 ${riskN}개 — 복습 세션으로` };
  if (openBacklogN > 0)
    return { kind: 'backlog', label: `보충 ${openBacklogN} 회수`, aria: `열린 보충 ${openBacklogN}건 — 기록으로` };
  return null;
}
