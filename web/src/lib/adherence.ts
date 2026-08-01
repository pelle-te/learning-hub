/* ============================================================
   lib/adherence.ts — 적응형 용량을 **문장으로**(P-5 · 2026-08-01 · 순수).

   ## 무엇이 없었나 (⚠ 로드맵의 진단을 한 줄 정정한다)

   로드맵 P-5 는 `adherenceFactor` 가 _"계획 용량을 0.5~1.0배로 실제로 깎는데 그 사실이 **어느
   화면에도 없다**"_ 고 적었다. **그건 사실과 다르다** — PL-5 가 이미 오늘 탭 상단 리드아웃에
   `용량 −30%` 를 노출해 뒀다(`TodaySignature` 의 `res.adaptApplied` 분기).

   진짜 공백은 **수가 아니라 문장**이다. `−30%` 만으로는 셋 다 알 수 없다:
     ① 이게 무엇인가(내가 뭘 잘못했나? 설정을 건드렸나?)
     ② 왜 그렇게 됐나
     ③ 어떻게 되돌리나
   사용자가 "계획이 왜 헐거워졌지"를 물을 곳이 없다는 진단은 맞았고, 답이 없던 것은 *노출*이
   아니라 *설명*이다. 그래서 이 모듈은 수를 한 번 더 그리지 않고 **셋을 한 문장으로** 만든다.

   ## ⚠⚠ 문구 조건이 안 지켜지면 이 안은 해롭다

   하락 자체를 크게 그리면 **죄책감 계기판**이 되어 앱을 덜 열게 만든다(방향 §2 (d)의 정반대).
   그래서 문장의 순서가 규칙이다: **① 앱이 이미 조정했다 → ② 근거 → ③ 회복 조건.**
   "당신이 70%밖에 못 했다"로 시작하면 같은 사실이 정반대로 읽힌다.

   ## ⚠ 새 데이터가 0이다

   `factor` 는 정의상 **최근 14일의 (실제 분 ÷ 계획 분)** 이다(`scheduler/priority.adherenceFactor`).
   그래서 "계획의 N% 를 했다"는 지어낸 수가 아니라 **그 계수 자체를 사람 말로 읽은 것**이고,
   분·시간 같은 절대량을 말하려면 새 배선이 필요하므로 **말하지 않는다**(모르는 것을 우기지 않는다).

   ⚠ 자리는 **주간 리뷰**다. 오늘 탭 히어로는 후보에서 뺐다 — 매일 보는 자리에 매일 안 변하는
     수를 문장으로까지 키우면 그게 곧 소음이다(리뷰는 주 1회 여는 화면이라 시제가 맞는다).
============================================================ */
import { ADAPT_WINDOW } from './scheduler/priority';

export interface AdherenceLine {
  /** 화면 문장. */
  line: string;
  /** 회복 조건 한 조각(문장 끝) — 호출부가 따로 강조할 수 있게 나눠 둔다. */
  recover: string;
  /** 최근 14일 이행률(%) — 반올림. */
  ratePct: number;
  /** 깎인 폭(%) — 반올림. */
  cutPct: number;
}

/**
 * 적응형 용량 한 줄. **적용된 날만** 값이 있다(안 깎였으면 말할 것이 없다 — 이 앱의 침묵 규율).
 *
 * @param adapt   `ScheduleResult.adapt`(0.5~1.0). 없으면 1로 본다.
 * @param applied `ScheduleResult.adaptApplied`. false 면 null.
 */
export function adherenceLine(adapt: number | undefined, applied: boolean): AdherenceLine | null {
  const f = typeof adapt === 'number' ? adapt : 1;
  if (!applied || f >= 1) return null;
  const ratePct = Math.round(f * 100);
  const cutPct = Math.round((1 - f) * 100);
  const recover = '계획대로 채운 날이 늘면 자동으로 풀려요.';
  return {
    ratePct,
    cutPct,
    // ⚠ 순서가 규칙이다(머리주석): 조정 사실 → 근거 → 회복 조건.
    line: `계획을 ${cutPct}% 줄여 뒀어요 — 최근 ${ADAPT_WINDOW}일에 계획의 ${ratePct}%를 했기 때문이에요. ${recover}`,
    recover,
  };
}
