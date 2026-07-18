/* ============================================================
   dayPlannerShared — 일 편집기(DayPlanner ↔ DayPlannerCards)가 함께 쓰는 식별자·타입.
   컴포넌트 분리 후 양쪽이 같은 상수를 봐야 하는데, 카드가 DayPlanner를 import하면 순환이 된다.
   그래서 값 없는 얇은 모듈로 내린다.
============================================================ */

/** 드래그 페이로드 종류 — 공부 블록인지 자유 할 일인지. */
export type DragKind = 'block' | 'task';

/** 드래그 데이터 MIME — 외부 드롭(파일 등)과 구분하는 자체 타입. */
export const MIME = 'application/x-plan-item';

/** 타임라인 컬럼 식별용 클래스(포인터 리사이즈 시 높이 측정). */
export const COL_CLASS = 'planTimelineCol';

/** 카드 안 편집 버튼이 aria-controls로 가리키는 편집 바(화면에 동시 1개). */
export const EDIT_BAR_ID = 'dayPlannerEditBar';
