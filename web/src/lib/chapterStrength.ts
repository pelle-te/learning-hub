/* ============================================================
   chapterStrength.ts — **T-5 챕터 기억 강도**(순수 · React 무관)

   ## 왜 생겼나
   발산 5회차 🌍 격차표: _"카드마다 **난이도·안정성·회상확률 3값**을 이력으로 적합"_(FSRS) 대비
   우리 현재는 **없음** — 저장값이 `reviewTouches` 의 **날짜 문자열 하나**이고 복습 사다리는
   전 챕터가 동일했다. 즉 앱은 "언제 봤나"만 알고 **"얼마나 붙었나"는 몰랐다.**

   ## ⚠ 이건 FSRS 가 아니다 — 그리고 그렇게 보이면 안 된다
   FSRS 는 수백만 리뷰로 적합한 3파라미터 모델이다. 우리에게 있는 것은 챕터당 **한 자릿수** 관측
   (`blankResults[].chapter` 의 통과/막힘)뿐이고, 그 표본으로 회상확률을 내놓으면 **정밀도의 착시**를
   만든다 — 숫자가 소수점을 갖는 순간 사용자는 그것을 측정치로 읽는다. 그래서 여기서 내는 것은
   **연속값이 아니라 3구간**이고, 각 구간의 정의는 아래 한 줄로 전부 적을 수 있다.
   근거 없이 똑똑한 척하는 순위가 이 축에서 가장 위험하다(P-9 의 컷 순서가 배운 것과 같은 교훈).

   ## 표본이 없으면 `unseen` 이다 — 0이 아니라
   관측 0을 "강도 0"으로 그리면 **값 부재와 값 0 이 같은 픽셀**이 된다(`Subject.tsx` 가 숙달도에서
   같은 함정을 이미 피해 뒀다). 호출부는 `unseen` 을 **안 그리는 쪽**으로 다뤄야 한다.
============================================================ */
import { dayDiff } from './utils';
import type { AppState } from './types';

/** 3구간. 연속값을 안 내는 이유는 머리주석 참조. */
export type StrengthBand = 'strong' | 'shaky' | 'unseen';

export interface ChapterStrength {
  /** 이 챕터를 대상으로 남은 백지복습 기록 수(챕터가 적힌 것만 — 옛 기록엔 챕터가 없다). */
  attempts: number;
  passes: number;
  /** 가장 최근 시도의 통과 여부. 표본이 없으면 null. */
  lastPassed: boolean | null;
  /** 마지막으로 이 챕터를 **인출한** 날(`reviewTouches` · 계획 밖 복습도 포함). */
  lastTouchDs: string | null;
  /** 마지막 인출로부터 지난 일수. 인출 기록이 없으면 null. */
  daysSince: number | null;
  band: StrengthBand;
}

/** 표본 없음의 단일 표현 — 호출부가 `unseen` 을 "0" 으로 오해하지 않게 한 곳에서 만든다. */
const UNSEEN: ChapterStrength = {
  attempts: 0,
  passes: 0,
  lastPassed: null,
  lastTouchDs: null,
  daysSince: null,
  band: 'unseen',
};

/**
 * 한 챕터의 기억 강도.
 *
 * 구간 규칙(전부 여기 세 줄이다 — 숨은 가중치 없음):
 *  - `unseen` — 채점된 시도가 **0**이다. 인출만 했고 채점이 없으면 여전히 `unseen` 이다
 *    (본 것과 붙은 것은 다르다).
 *  - `shaky`  — **가장 최근 시도가 막힘**이거나, 통과율이 절반 미만이다.
 *  - `strong` — 그 외(= 최근 시도가 통과이고 통과율이 절반 이상).
 *
 * ⚠ 최근 시도를 통과율보다 **먼저** 본다: 3전 3승 뒤 오늘 막혔다면 그 챕터는 지금 흔들리는 것이지
 * 75% 가 아니다. 평균은 최근성을 지운다.
 */
export function chapterStrength(state: AppState, sid: string, chapter: string, todayDs: string): ChapterStrength {
  if (!chapter) return UNSEEN;
  const tries = (state.blankResults || [])
    .filter((b) => b.sid === sid && b.chapter === chapter)
    .sort((a, b) => (a.ds < b.ds ? -1 : a.ds > b.ds ? 1 : 0));
  const lastTouchDs = (state.reviewTouches || {})[sid + '|' + chapter] || null;
  const daysSince = lastTouchDs ? dayDiff(lastTouchDs, todayDs) : null;
  if (!tries.length) return { ...UNSEEN, lastTouchDs, daysSince };

  const passes = tries.filter((t) => t.passed).length;
  const lastPassed = !!tries[tries.length - 1]!.passed;
  const band: StrengthBand = !lastPassed || passes * 2 < tries.length ? 'shaky' : 'strong';
  return { attempts: tries.length, passes, lastPassed, lastTouchDs, daysSince, band };
}

/** 화면 어휘 — 라벨을 호출부마다 지으면 같은 구간이 화면마다 다른 말이 된다. */
export const BAND_LABEL: Record<StrengthBand, string> = {
  strong: '붙음',
  shaky: '흔들림',
  unseen: '미측정',
};
