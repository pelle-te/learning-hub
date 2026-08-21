/* ============================================================
   scheduler/simulate.ts — **바꾸기 전에 결과를 본다**(I018 · 2026-08-22 발상 축).

   ## 이 앱에 없던 시제

   과거는 아주 잘 잰다(`route_visits`·`day_signals`·`retrievalLatency`·`estimateCalibration`).
   현재는 정확히 판정한다(`dayCapacity` 가 "오늘 안에 들어가는가"를 한 문장으로).
   **미래는 없었다** — `schedule(state)` 는 순수 함수인데 소비처 전부가 *현재 상태 1회 실행*이고,
   `shortfalls[]` 는 «부족합니다»까지만 말하고 멈춘다(리포트 §4-C).

   그래서 이 앱이 «무엇을 뺄까»를 물을 때(`CutCard`) 그 답의 근거는 **산술 근사**였다:
   `고른 시간 합 ≥ 부족분`. 그런데 배치는 합이 아니다 — 하루 상한 · 복습 예산 · 다른 과목과의
   경쟁이 있어서, 같은 시간을 빼도 부족분이 안 닫히거나 **다른 과목의 부족분이 새로 생긴다.**
   엔진이 이미 그 답을 알고 있고, 다만 아무도 두 번째로 물어보지 않았을 뿐이다.

   ## ⚠⚠ 상태를 건드리지 않는다

   패치는 **필요한 가지만 복제**해서 얹는다(`structuredClone` 전체가 아니다 — 이 상태는 크고
   시뮬레이션은 사용자 입력마다 돈다). 복제 범위가 틀리면 «미리보기»가 진짜 데이터를 바꾼다.
   그 계약은 `test/simulate.test.ts` 의 **입력 불변 케이스**가 잠근다.

   ## ⚠ 예산

   실측(2026-08-22 · 20챕터 과목 하나 · vitest): **20회 7.3ms = 회당 0.37ms**. 이 항목이 세운
   문턱(슬라이더 <50ms · 버튼 <500ms)을 두 자릿수 여유로 통과하므로 **연속 입력 자리에도** 놓을
   수 있다. `test/simulate.test.ts` 가 상한을 넉넉히 잡고 지킨다 — 거기서 특정 밀리초를 못박으면
   기계 편차가 회귀로 읽히고 그 게이트는 곧 꺼진다.

   ⚠ **캐시를 두지 않는다.** 캐시는 «무엇이 입력인가»의 목록을 한 벌 더 만들고, 이 저장소에서
   손으로 적은 목록은 반드시 표류한다(`SCHEDULE_INPUT_KEYS` 불변식이 그걸 Proxy 로 잠그는
   이유이기도 하다). 0.37ms 는 캐시를 살 이유가 없는 값이다.
============================================================ */
import type { AppState, ScheduleResult, Shortfall } from '../types';
import { schedule } from './engine';

/** 무엇을 바꿔 볼 것인가. 필드를 늘릴 때는 **복제 범위**를 함께 늘려야 한다(머리주석). */
export interface SimPatch {
  /** 이 챕터들을 이번 범위에서 뺀다(`deferred`). `CutCard` 가 쓰는 형태. */
  defer?: { sid: string; chapterIds: ReadonlySet<string> };
}

/**
 * 패치를 얹은 상태로 스케줄을 한 번 더 돌린다. **입력 `state` 는 변하지 않는다.**
 *
 * ⚠ 얕은 복제 사슬(`state → items → item → chapters → chapter`)만 판다. 그 밖은 참조를 공유하고
 * 엔진이 읽기만 하므로 안전하다 — 엔진이 상태를 쓰기 시작하면 이 가정이 깨지고, 그때는
 * 시뮬레이션이 조용히 진짜 데이터를 바꾼다. 그래서 불변 케이스가 테스트에 있다.
 */
export function simulate(state: AppState, patch: SimPatch): ScheduleResult {
  return schedule(applyPatch(state, patch));
}

function applyPatch(state: AppState, patch: SimPatch): AppState {
  const d = patch.defer;
  if (!d || !d.chapterIds.size) return state;
  return {
    ...state,
    items: state.items.map((it) =>
      it.id !== d.sid
        ? it
        : {
            ...it,
            chapters: (it.chapters ?? []).map((c) => (d.chapterIds.has(c.id) ? { ...c, deferred: true } : c)),
          },
    ),
  };
}

/**
 * 한 과목·한 시험의 부족분이 패치 뒤에 어떻게 되는가.
 *
 * @returns `closed` = 그 부족분이 사라졌다 · `gapH` = 남은 부족분(사라졌으면 0) ·
 *   `collateral` = **패치 때문에 새로 생기거나 커진 다른 부족분**.
 *
 * ⚠⚠ `collateral` 이 이 함수의 존재 이유다. 산술 근사는 «이 과목이 닫히는가»만 답할 수 있는데,
 * 배치는 과목끼리 자리를 다투므로 한쪽을 닫으면 다른 쪽이 열릴 수 있다. 그걸 안 보여 주면
 * 사용자는 챕터를 뺀 다음 **다른 카드가 새로 뜨는 것을 자기 탓으로** 읽는다.
 */
export interface ShortfallDelta {
  closed: boolean;
  gapH: number;
  collateral: { sid: string; name: string; examLabel: string; addedH: number }[];
}

export function shortfallDelta(
  before: readonly Shortfall[],
  after: readonly Shortfall[],
  target: Shortfall,
): ShortfallDelta {
  const key = (s: Shortfall): string => s.sid + '|' + s.examId;
  const k = key(target);
  const hit = after.find((s) => key(s) === k);
  const beforeBy = new Map(before.map((s) => [key(s), s.gapH]));
  const collateral: ShortfallDelta['collateral'] = [];
  for (const s of after) {
    if (key(s) === k) continue;
    const was = beforeBy.get(key(s)) ?? 0;
    /* 1e-6 은 이 저장소가 시간(h)을 비교할 때 쓰는 여유다(`CutCard` 의 `covers` 와 같은 값).
       부동소수 잔차를 «새 부족분»이라 말하면 카드가 유령을 그린다. */
    if (s.gapH > was + 1e-6)
      collateral.push({ sid: s.sid, name: s.name, examLabel: s.examLabel, addedH: s.gapH - was });
  }
  return { closed: !hit, gapH: hit?.gapH ?? 0, collateral };
}
