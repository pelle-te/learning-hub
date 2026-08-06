/* ============================================================
   store/resumeCursor.ts — 이어하기 커서(N-7)의 **쓰기 접합점**.

   `lib/resume.ts` 가 "커서란 무엇인가"(모양·TTL·선택 규칙·경로 매핑)를 순수하게 소유하고,
   여기서는 그 위에 **누가 쓰나 · 언제를 찍나 · 미연결이면 어떻게 되나**만 정한다. `lib` 은
   zustand 를 모르므로 그 접합이 store 층에 있어야 한다 — `syncController`(병합)·
   `undoController`(⌘Z)가 같은 자리에 있는 것과 **같은 이유·같은 모양**이다.

   ## 왜 모았나 (M-3 · 2026-08-06 감사)

   같은 여섯 줄이 **세 벌**이었다: `store/useFocus.ts` · `features/review-run/ReviewRun.tsx` ·
   `app/useLeaveCursor.ts`. 그리고 사본이 셋이 되자 규약이 갈렸다 — `at`(시각)을 **호출부가
   찍는 판**과 **글루가 찍는 판**이 공존했다. 그 갈림은 무해하지 않다: `at` 은 TTL 판정과
   "가장 최근 커서" 선택의 유일한 기준이라(`latestResume`), 어느 판을 쓰는지에 따라 커서가
   *행동한 시각*이 아니라 *렌더된 시각*으로 찍힐 수 있다.

   ## 규약 하나 — `at` 은 **여기서** 찍는다

   호출부는 언제나 "지금"을 뜻한다. 그리고 `Date.now()` 를 컴포넌트 본문에 두면
   `react-hooks/purity` 가 렌더 중 불순 호출로 잡는다(핸들러 안이라도 그 핸들러가 렌더 중
   호출되는 함수에 인자로 넘어가면 컴파일러는 호출 가능성을 가정한다 — ReviewRun 이 실제로
   물렸다). 두 이유가 같은 방향을 가리키므로 인자에서 `at` 을 **뺐다**: 넘길 수 없으면 갈릴 수도
   없다.
============================================================ */
import { putResume, clearResume, resumeDevice, type ResumeCursor } from '@/lib/resume';
import { useApp } from './useApp';

/**
 * 이 기기의 커서를 남긴다. **미연결(기기 id 없음)이면 통째로 무동작** — 넘을 기기가 없는데
 * 쓰기만 하면 아무도 안 읽는 행이 아웃박스에 쌓인다(`lib/resume.ts` 머리주석).
 */
export function writeResume(cur: Omit<ResumeCursor, 'at'>): void {
  const id = resumeDevice();
  if (!id) return;
  useApp.getState().mutate((st) => putResume(st, id, { ...cur, at: Date.now() } as ResumeCursor));
}

/** 이 기기의 커서를 지운다(끝냈으니 이어할 것이 없다 — 남기면 다른 기기에 유령 커서가 뜬다). */
export function dropResume(): void {
  const id = resumeDevice();
  if (!id) return;
  useApp.getState().mutate((st) => clearResume(st, id));
}
