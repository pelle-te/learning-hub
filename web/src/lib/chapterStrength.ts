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

/* ── I-1 **연속 계수**(W7 · 발산 6회차 · 2026-08-07) ────────────────────────────────────
   ⚠⚠ 이 파일의 머리주석은 *"연속값을 안 낸다"* 라 못박았고, 그 판단을 **뒤집지 않는다** —
   범위를 가른다. 그 결정이 겨눈 것은 **표시**였다(회상확률 소수점을 보이면 사용자가 그것을
   측정치로 읽는다 · 정밀도의 착시). 여기서 쓰려는 것은 **간격**이다: 사다리 칸을 며칠로 잡을지.
   간격은 사람이 읽는 수가 아니라 스케줄러의 내부 값이라 착시를 만들 대상이 없다.
   → **표시는 3구간 그대로, 간격만 연속.** 두 축을 가르는 것이 이 항목의 전부다.

   ⚠ **표본이 얇으면 `null`** 이다(계수 없음 = 종전 동작). 두 번 관측으로 배율을 내면 그건
     정확히 위 머리주석이 경고한 짓이다.
   ⚠ 라플라스 평활(+1/+2)을 쓴다 — 1전 1승이 곧바로 최대 배율을 받으면 첫 통과가 그 챕터를
     한 달 뒤로 밀어 버린다. 표본이 늘수록 극단으로 간다는 성질이 이 문제에 정확히 맞다.
   ⚠ 범위를 좁게 잡는다(0.7~1.4). 넓히면 "잊은 챕터를 안 보여준다"라는 최악이 커지고, 그건
     `riskOf` 가 상한 한 칸을 고수하는 것과 같은 이유로 허용되지 않는다. */

/** 채점 표본이 이 수 미만이면 계수를 안 낸다. `attempts` 2 = 최소한 한 번은 갈린 것. */
const COEF_MIN_ATTEMPTS = 2;

/**
 * 챕터의 **간격 계수**(0.7~1.4). 표본이 얇으면 `null`.
 *
 * 1보다 크면 *더 오래 붙어 있다* → 사다리를 늘린다. 작으면 그 반대.
 * ⚠ **표시에 쓰지 말 것** — 이 값은 스케줄러 내부용이고, 화면은 `band`(3구간)를 쓴다.
 */
export function chapterCoefficient(s: ChapterStrength): number | null {
  if (s.attempts < COEF_MIN_ATTEMPTS) return null;
  const p = (s.passes + 1) / (s.attempts + 2); // 라플라스 평활
  return 0.7 + p * 0.7;
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

/**
 * **전 챕터의 강도를 한 번에** — `sid|chapter` → 강도.
 *
 * ## 왜 배치판이 따로 있나 (2026-08-20 리뷰 M-5)
 *
 * 위 단건판은 호출마다 `blankResults` **전량을 `.filter().sort()`** 한다. 소비처 하나가
 * `spacedReview.chapterShift` 인데 거기서는 챕터마다, 그것도 `strong`·`coef` 두 클로저를 통해
 * **두 번** 불렸다. 그래서 `chapterReviews` 한 번에 (챕터 수 × 2) 회의 전량 스캔이 났다 —
 * 그 파일의 `ShiftContext` 가 스스로 *"한 번 만들어 여러 챕터에 재사용한다(과목 스캔 반복 방지)"*
 * 라 선언해 둔 계약이 실제로는 그 두 필드에서 지켜지지 않고 있었다.
 *
 * 여기서 한 번 접으면 전량 스캔이 **1회**가 되고 조회는 Map 이 된다.
 *
 * ⚠ **단건판을 지우지 않는다** — 화면 소비처(`features/items/Subject.tsx` 등)는 챕터 하나만
 *   보므로 그쪽엔 전량 인덱스가 과하다. 두 판의 결과는 **동형이어야 한다**: 표본 없는 챕터에
 *   대해 배치판은 항목을 안 만들고, 호출부가 `UNSEEN`(+ `lastTouchDs`/`daysSince`)으로 메운다.
 *   그 메움을 `unseenAt` 이 소유해 두 판이 갈리지 않게 한다.
 */
export function chapterStrengths(state: AppState, todayDs: string): Map<string, ChapterStrength> {
  const rows = new Map<string, { ds: string; passed: boolean }[]>();
  for (const b of state.blankResults || []) {
    const chapter = (b.chapter || '').trim();
    if (!b.sid || !chapter) continue;
    const k = b.sid + '|' + chapter;
    const g = rows.get(k);
    if (g) g.push({ ds: b.ds, passed: !!b.passed });
    else rows.set(k, [{ ds: b.ds, passed: !!b.passed }]);
  }
  const touches = state.reviewTouches || {};
  const out = new Map<string, ChapterStrength>();
  for (const [k, tries] of rows) {
    tries.sort((a, b) => (a.ds < b.ds ? -1 : a.ds > b.ds ? 1 : 0));
    const lastTouchDs = touches[k] || null;
    const passes = tries.filter((t) => t.passed).length;
    const lastPassed = !!tries[tries.length - 1]!.passed;
    out.set(k, {
      attempts: tries.length,
      passes,
      lastPassed,
      lastTouchDs,
      daysSince: lastTouchDs ? dayDiff(lastTouchDs, todayDs) : null,
      band: !lastPassed || passes * 2 < tries.length ? 'shaky' : 'strong',
    });
  }
  return out;
}

/** 배치판에 항목이 없는 챕터의 값 — **단건판의 `!tries.length` 가지와 같은 모양**이어야 한다. */
export function unseenAt(state: AppState, sid: string, chapter: string, todayDs: string): ChapterStrength {
  if (!chapter) return UNSEEN;
  const lastTouchDs = (state.reviewTouches || {})[sid + '|' + chapter] || null;
  return { ...UNSEEN, lastTouchDs, daysSince: lastTouchDs ? dayDiff(lastTouchDs, todayDs) : null };
}

/** 화면 어휘 — 라벨을 호출부마다 지으면 같은 구간이 화면마다 다른 말이 된다. */
export const BAND_LABEL: Record<StrengthBand, string> = {
  strong: '붙음',
  shaky: '흔들림',
  unseen: '미측정',
};
