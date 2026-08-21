/* ============================================================
   scheduler/ — 통합 스케줄 엔진 (모델 v3). 레거시 js/scheduler.js 이식.
   전역 state를 읽던 것을 모두 *state 인자*로 파라미터화(순수 함수 → Vitest 가능).

   1027줄 단일 파일이던 것을 층으로 갈랐다(순수 이동 — 동작 불변):
     windows        하루 가용시간을 구간으로 (일과·수면·일정 차감)
     priority       무엇을 먼저 (총량·숙달도·백지 결과·적응형 용량)
     dayPlanOverride 자동 산출 위에 사용자의 수동 배치 얹기
     engine         본체 schedule() — 위 셋을 조합해 일자별 항목을 만든다
     layout         하루치 세션을 시각에 앉히기
     simulate       **바꾸기 전에 결과를 본다**(I018) — 패치를 얹고 엔진을 한 번 더 돌린다

   이 index가 공개 표면 — 소비처는 계속 `@/lib/scheduler` 하나만 보면 된다.
   (store/selectors의 SCHEDULE_INPUT_KEYS 불변식은 test/invariants.test.ts가 Proxy로 잠근다.)
============================================================ */
export * from './windows';
export * from './priority';
export * from './dayPlanOverride';
export * from './engine';
export * from './layout';
export * from './simulate';
