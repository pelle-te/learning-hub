/* ============================================================
   since.ts — **T-13 "지난번 이후" 레이어**. 순수 · React 무관.

   ## 무엇이 없었나

   앱은 언제나 **지금 상태**만 그린다. 그래서 "내가 마지막으로 본 뒤로 뭐가 달라졌나"는 전부
   기억으로 재구성해야 했다 — 그리고 며칠 만에 여는 사용자에게는 그 재구성이 불가능하다.
   부재 브리핑(P-1)이 *오늘 탭 한 곳*에서 그 질문에 답했지만, 나머지 22화면은 그대로였다.

   ## ⚠⚠ 이 파일의 요점은 **세는 것이 아니라 안 그리는 조건**이다

   로드맵이 이 항목의 전제를 이렇게 적었다: _"델타가 화면당 5개 이하다 — **20개면 강조가
   아니라 소음**"_. 즉 이 기능은 델타가 작을 때만 값이 있고, 커지면 자기가 해치려던 것
   (화면의 조용함)을 정확히 해친다. 그래서 `SINCE_NOISE_MAX` 를 넘으면 **수를 안 돌려준다** —
   화면이 판단하게 두면 화면마다 문턱이 갈리고, 그러면 이 규율이 한 번의 복붙으로 사라진다.

   ## ⚠ 기기별이다 — 동기화하지 않는다

   "내가 마지막으로 본 시점"은 **이 기기의 주의(attention)**에 대한 사실이지 앱 데이터가 아니다.
   PC 에서 본 것이 폰의 "새 것" 표시를 지우면, 폰 사용자는 본 적 없는 것을 본 것으로 처리당한다
   (`themeAuto`·`trayResident` 와 같은 논증 → `UIState`).

   ## ⚠ 화면마다 델타의 정의를 새로 만들지 않는다

   여기 표에 없는 화면은 **0 이 아니라 `null`**(= 셀 수 없음)이다. 0 으로 답하면 "새 것이 없다"고
   단정하게 되는데, 실제로는 세는 방법이 없는 것뿐이다 — 이 저장소가 반복해 물린 형태
   (값 부재와 값 0 이 같은 픽셀).
============================================================ */
import type { AppState } from './types';

/** 이 수를 넘으면 표식을 안 준다(머리주석 §요점). 5 는 로드맵이 적어 둔 전제 그대로다. */
export const SINCE_NOISE_MAX = 5;

/** 화면 key → 그 화면에서 "새 것"의 날짜들을 뽑는 법. **여기 없으면 셀 수 없다(null).** */
const COUNTERS: Record<string, (s: AppState) => string[]> = {
  // 오답 노트 — CBMS 기록의 날짜.
  mistakes: (s) => (s.cbms || []).map((c) => c.ds),
  // 문항 원장(T-7).
  questions: (s) => (s.questions || []).map((q) => q.ds),
  // 학습 기록 — 3문장 요약. `at`(epoch ms)뿐이라 ISO 로 맞춘다.
  journal: (s) =>
    Object.values(s.summaries || {})
      .flat()
      .map((x) => (x.at ? new Date(x.at).toISOString().slice(0, 10) : ''))
      .filter(Boolean),
};

/**
 * 마지막으로 본 뒤 늘어난 개수. **셀 수 없으면 `null`**, 소음 문턱을 넘어도 `null`.
 *
 * ⚠ `seenDs` 가 없으면(한 번도 안 본 화면) `null` 이다 — 첫 방문에 "23개 새로 생겼어요"는
 * 델타가 아니라 그냥 전체 개수이고, 그건 이 레이어가 말하려는 것이 아니다.
 */
export function sinceCount(state: AppState, key: string, seenDs: string | undefined): number | null {
  const pick = COUNTERS[key];
  if (!pick || !seenDs) return null;
  const n = pick(state).filter((ds) => ds > seenDs).length;
  if (n <= 0) return null; // 0 은 표식이 아니다(평온엔 아무것도 안 그린다)
  return n > SINCE_NOISE_MAX ? null : n;
}

/** 표식을 그릴 수 있는 화면들 — 화면이 목록을 손으로 베끼지 않게 여기서 준다. */
export function countableKeys(): string[] {
  return Object.keys(COUNTERS);
}
