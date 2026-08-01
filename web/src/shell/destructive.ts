/* ============================================================
   shell/destructive.ts — **되돌리기 3단 사다리**(Q-13 · 2026-08-02).

   이 앱에는 파괴적 동작을 다루는 관용구가 **두 벌 공존**하고 있었다: `ui.confirm`(7파일 14곳)과
   전역 ⌘Z(`store/undoController`). 둘이 만나는 자리가 최악이었다 — 학기 삭제·과목 삭제는
   **확인창을 띄우고 나서 `toastUndoable`("⌘Z 로 되돌리기")을 띄웠다.** 같은 안전장치를 두 번
   과금한 것이고, 사용자 입장에선 "되돌릴 수 있다면서 왜 묻나"다. 반대로 `UpdateCard` 는
   **`window.confirm`**(앱 모달이 아니라 OS 대화상자)을 불러 포커스 트랩·`isModalOpen()` 키
   게이트 밖에 있었다.

   ## 사다리 — 어느 단인지는 **"되돌릴 수 있나"** 하나로 갈린다

   | 단 | 조건 | 형태 | 예 |
   | --- | --- | --- | --- |
   | ① | **⌘Z 가 덮는다**(앱 데이터 행 편집) | **안 묻는다.** 즉시 실행 + `toastUndoable` | 과목·학기·책 삭제 |
   | ② | 못 되돌리지만 **재구성 가능**(밖에 원본이 있거나 다시 만들 수 있다) | 묻는다(`confirmLossy`) | 기록 보관, 앱 재시작, 원장 맞추기 |
   | ③ | **비가역**(밖에도 원본이 없다 · 외부 상태를 바꾼다) | 묻는다 + `danger` (`confirmIrreversible`) | 전체 초기화, 기기 폐기 |

   ⚠ **①에서 확인창을 되살리지 말 것.** 되돌리기가 있는데도 묻는 것은 사용자를 두 번 세우는
   일이고, 그렇게 잦아진 확인창은 곧 **읽지 않고 누르는 버튼**이 된다 — 그때 ③의 확인창까지
   함께 무력해진다. 확인창의 가치는 희소성에서 나온다.
   ⚠ 반대로 **①의 판정은 "⌘Z 스택에 들어가나"이지 "느낌상 가벼운가"가 아니다.** `mutate`(또는
   `patch`) 를 거쳐 `lib/db/undoStack` 에 pre-image 가 남는 편집만 ①이다. 스토어를 안 거치는
   것(집중 세션 중단·파일 쓰기·네트워크 호출)은 전부 ② 이상이다.

   ## 왜 `confirm` 을 직접 부르지 못하게 막는가

   집행자는 **불변식 ⑨**(`test/invariants.test.ts`)다 — `shell/modal.tsx` 와 이 파일 밖에서
   `confirm(` 호출이 0건임을 센다. 사다리를 주석으로만 두면 다음 삭제 버튼이 다시 `ui.confirm`
   을 부르고, 그게 정확히 이번에 발견된 상태다(같은 앱에 두 관용구 공존). 어휘를 강제하면
   **어느 단인지 고르는 일이 코드에 보인다.**
============================================================ */
import { confirm, type ConfirmOpts } from './modal';
import { toastUndoable } from './toast';

/**
 * **①단 — 묻지 않는다.** ⌘Z 가 덮는 편집을 즉시 실행하고, 되돌릴 수 있다는 사실만 알린다.
 *
 * @param msg 완료 문구(⌘Z 힌트는 `toastUndoable` 이 붙인다 — 호출부가 적지 말 것)
 * @param run 스토어 뮤테이션. **동기**여야 한다 — 되돌리기 스택은 `mutate` 한 번이 한 항목이고,
 *   비동기로 쪼개면 한 번의 ⌘Z 가 절반만 되돌린다.
 */
export function commitUndoable(msg: string, run: () => void): void {
  run();
  toastUndoable(msg);
}

/**
 * **②단 — 되돌릴 수 없지만 재구성 가능.** 평범한 확인창(빨간색 아님).
 *
 * ⚠ `danger` 를 받지 않는다. 위험 표시를 옵션으로 두면 호출부마다 판단이 갈려 사다리가 무너진다 —
 * 빨간 버튼이 필요하다고 느껴지면 그건 ③이다.
 */
export function confirmLossy(message: string, opts: Omit<ConfirmOpts, 'danger'> = {}): Promise<boolean> {
  return confirm(message, { ...opts, danger: false });
}

/**
 * **③단 — 비가역.** 확인창 + `danger`(빨간 확인 버튼).
 *
 * ⚠ 문구는 **무엇이 영영 사라지는지**를 말한다. "정말 삭제할까요?"는 아무 정보가 없어서 사용자가
 * 읽지 않고 누르게 만든다 — 이 앱의 기존 문구들(`'${d.name}' 을(를) 폐기할까요? 되돌릴 수 없고,
 * 다시 쓰려면 등록 코드가 필요합니다.`)이 이미 그 형태다.
 */
export function confirmIrreversible(message: string, opts: Omit<ConfirmOpts, 'danger'> = {}): Promise<boolean> {
  return confirm(message, { ...opts, danger: true });
}
