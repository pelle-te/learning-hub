/* ============================================================
   phaseRamp.ts — **T-4 국면 전환**(학기 처분 · 방학 램프). 순수 · React 무관.

   ## 왜 생겼나 (2026-08-02 · 발산 5회차 T-4)

   앱의 하루 부하 목표는 **항상 같은 식**이었다 — 학기 중이든 방학이든 스케줄러가 남은 챕터를
   가용 시간에 밀어 넣는다. 그런데 학기 사이의 처방은 정반대다: 방학의 하루 목표는 **0 이
   아니라 낮아야** 한다(0 이면 개강 첫날 밀림 벽을 만나고, 학기 중과 같으면 못 지켜 무너진다).

   `semesterPhase()`(T-1)가 국면을 **판정**할 수 있게 됐으므로, 여기서 국면마다 **다른 처방**을
   낸다. 이 파일이 T-1 의 첫 소비자다 — 날짜를 넣은 값이 실제로 나오는 자리.

   ## 규율

   1. **저장하지 않는다.** 국면과 램프는 전부 날짜에서 파생한다 — 저장하면 자정 하나로 낡는다
      (과목 색이 저장값이 아닌 것과 같은 논증).
   2. **`off` 와 `pre` 를 합치지 않는다.** 처방이 정반대다: `pre` 는 "개강까지 하루 N분이면
      밀림 0 에 도착한다"(구체적 수)이고, `off` 는 다음 학기가 **없어서** 도착점 자체가 없다
      → 처방은 수가 아니라 **"다음 학기를 정하라"** 한 문장이다. 수를 지어내면 거짓말이다.
   3. **여기서 스케줄러를 건드리지 않는다.** 램프는 *목표*이지 배치가 아니다. 배치를 바꾸면
      `engine.ts` 와 두 벌의 계획이 생기고, 그건 이 저장소가 반복해 물린 형태다.

   ⚠ **"밀림 0 도착"의 분모는 남은 날이 아니라 `max(1, 남은 날)`이다.** 개강 당일에 나누기 0 이
   되는데, 그 경계는 실제로 매년 한 번 지나간다.
============================================================ */
import type { AppState, Item, Semester } from './types';
import { semesterPhase, type SemesterPhaseKind } from './semester';
import { todayISO } from './utils';

/** 남은 학습량(분) — **안 끝났고 미루지도 않은** 챕터들의 시간 합.
 *
 *  ⚠ `deferred` 를 빼는 이유: 그건 "이번 회차에서 뺐다"는 사용자의 명시 결정이고, 램프가 그걸
 *  다시 밀어 넣으면 은퇴 기능이 무력해진다(Q-22 가 어휘를 준 그 축과 같다). */
export function remainingMin(items: Item[]): number {
  let h = 0;
  for (const it of items) for (const c of it.chapters || []) if (!c.done && !c.deferred) h += c.hours || 0;
  return Math.round(h * 60);
}

/** 국면별 처방 하나. */
export interface PhaseRamp {
  kind: SemesterPhaseKind;
  semester: Semester | null;
  /** 개강까지 남은 일수(`pre` 만). */
  daysToStart: number | null;
  /** 남은 학습량(분). 국면과 무관하게 늘 잰다 — 화면이 분모를 말할 수 있어야 한다. */
  remainingMin: number;
  /**
   * **하루 몇 분이면 개강에 밀림 0 인가**(`pre` 만 · 아니면 null).
   *
   * ⚠ 이 수가 이 항목의 전부다. 방학에 "하루 40분"은 지킬 수 있는 약속이고, 같은 양을 개강
   * 첫 주에 만나면 지킬 수 없는 벽이다 — 바뀐 것은 양이 아니라 **분모**뿐이다.
   */
  perDayMin: number | null;
  /** 처방 한 줄. 화면이 이걸 그대로 쓴다(문구를 화면마다 새로 지으면 갈린다). */
  advice: string;
}

/** 지금 국면의 처방. `ds` 를 받는 이유는 `semesterPhase` 와 같다(자정을 넘길 수 있어야 한다). */
export function phaseRamp(state: Pick<AppState, 'degree' | 'items' | '_today'>, ds = todayISO(state)): PhaseRamp {
  const p = semesterPhase(state, ds);
  const rem = remainingMin(state.items || []);
  const base = { kind: p.kind, semester: p.semester, daysToStart: p.daysToStart, remainingMin: rem };

  if (p.kind === 'in') {
    return {
      ...base,
      perDayMin: null,
      advice: '학기 중 — 하루 목표는 계획이 정한다.',
    };
  }
  if (p.kind === 'pre' && p.daysToStart !== null) {
    const perDay = rem > 0 ? Math.ceil(rem / Math.max(1, p.daysToStart)) : 0;
    return {
      ...base,
      perDayMin: perDay,
      advice:
        rem === 0
          ? '남은 범위가 없어요 — 개강 준비는 선수 점검으로.'
          : `개강까지 ${p.daysToStart}일. 하루 ${perDay}분이면 밀림 0으로 도착해요.`,
    };
  }
  /* `off` — 도착점이 없다. 수를 지어내지 않고 **그 사실 자체**를 처방으로 돌려준다. */
  return {
    ...base,
    perDayMin: null,
    advice: rem > 0 ? '다음 학기가 아직 없어요 — 개강일을 넣으면 하루 목표가 나옵니다.' : '다음 학기가 아직 없어요.',
  };
}

/* ── 학기 처분 ──────────────────────────────────────────────────────────── */

/** 끝난 학기에 아직 매달려 있는 실행 과목 하나. */
export interface StaleLink {
  semester: Semester;
  item: Item;
  /** 그 과목에 남은 챕터 수(0 이면 끝냈는데 링크만 남은 것). */
  openChapters: number;
}

/**
 * **끝난 학기인데 실행 과목이 아직 살아 있는** 것들 — 학기 처분의 입력.
 *
 * 왜 필요한가: 학기가 끝나도 `Item` 은 그대로 남아 스케줄러의 분모에 계속 들어간다. 그래서
 * 종강 다음 날부터 "밀림"이 실제보다 커 보이고, 그 수를 근거로 방학 램프를 계산하면 **지난
 * 학기의 빚을 방학 목표로 갚으라**고 말하게 된다. 처분은 사용자의 결정이지만(끝냈다 / 이월한다)
 * **결정할 것이 있다는 사실**은 앱이 말해야 한다.
 *
 * ⚠ 여기서 아무것도 지우지 않는다 — 목록만 돌려준다. 자동 처분은 사용자가 안 본 사이에
 * 데이터를 바꾸는 것이고, 이 앱은 그 형태를 금지한다(절대규칙 #4의 정신).
 */
export function staleSemesterLinks(
  state: Pick<AppState, 'degree' | 'items' | '_today'>,
  ds = todayISO(state),
): StaleLink[] {
  const byId = new Map((state.items || []).map((i) => [i.id, i]));
  const out: StaleLink[] = [];
  for (const semester of state.degree?.semesters || []) {
    if (!semester.endDs || semester.endDs >= ds) continue; // 아직 안 끝난 학기
    for (const c of semester.courses || []) {
      const item = c.itemId ? byId.get(c.itemId) : undefined;
      if (!item) continue;
      const openChapters = (item.chapters || []).filter((ch) => !ch.done && !ch.deferred).length;
      out.push({ semester, item, openChapters });
    }
  }
  return out;
}
