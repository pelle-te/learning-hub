/* ============================================================
   promote.ts — 진단 → 학습으로 '승격' 매핑 — 순수·무의존.
   "이건 제대로 공부하자" 싶은 것을 보충 백로그(나중에 학습할 큐)로 보낸다. 백로그는 홈
   스트립('열린 보충')과 학습 기록 피드에 이미 노출돼, 식별→행동 루프를 닫는다.
   (전용 '학습 항목/과목'으로 만들면 스케줄러가 오염되므로 백로그가 올바른 그릇.)

   ⚠ **소비(읽을거리·증시) 승격이 P10 W4 에서 빠졌다**(2026-08-07). 이 파일의 원래 이름값은
   *소비→학습* 이었고 진단 승격은 나중에 얹힌 것인데, 지금은 진단 쪽만 남았다. 교양 재료가 학습에
   닿는 길은 이제 **survey 의 발견 큐 → 승격 → pipeline** 하나다(P10 I-5) — hub 이 그 통로를
   따로 갖지 않는 것이 요점이라, 여기 `backlogFrom<외부글>` 을 다시 만들지 말 것.
============================================================ */

export interface BacklogSeed {
  name: string; // 백로그의 과목 라벨(출처 종류)
  topic: string; // 무엇을 학습할지(제목)
  note: string; // 근거(출처·링크·발췌)
}

/** 승격 성공 토스트 문안 — 여러 호출부가 하드코딩 복제하던 것 SSOT화(SR-10). */
export const PROMOTE_TOAST = '보충 백로그로 보냈어요 — 기록·오늘 탭에서 회수';

/* ── 진단→학습 승격(I-1): 소비뿐 아니라 '내 약점'도 같은 백로그 그릇으로. 진단(반복약점·근본원인)을
   원클릭으로 보충 큐에 넣어 식별→행동을 잇는다. WeakSpot 타입에 결합하지 않으려 구조만 받는다. ── */

/** 반복 약점(과목·챕터·막힘 횟수) → 백로그 씨앗. */
export function backlogFromWeakSpot(w: { subject: string; chapter: string; count: number }): BacklogSeed {
  return {
    name: '반복 약점',
    topic: `${w.subject} — ${w.chapter}`,
    note: `이 지점에서 ${w.count}번 막힘 — 교재로 되돌아가 다시 인출`,
  };
}

/** 약점의 근본원인(선수개념) → 백로그 씨앗. 이 뿌리를 메우면 상류 N개가 함께 풀린다. */
export function backlogFromRootCause(c: { cause: string; count: number }): BacklogSeed {
  return {
    name: '근본원인',
    topic: c.cause,
    note: `${c.count}개 약점의 뿌리(선수개념) — 먼저 메우면 상류가 함께 풀림`,
  };
}
