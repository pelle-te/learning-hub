/* ============================================================
   cardCoverage.ts — **N-6 카드 커버리지**: 51챕터의 구멍 지도. 판정은 순수 · 조회만 주입.

   ## 왜 필요한가

   덱은 **과목 단위**다(`AnkiDeck.name`). 그래서 이 앱은 "Anki 340장 밀림"까지는 말하지만
   *어느 챕터에 카드가 아예 없는지*는 원리적으로 모른다 — 그리고 카드가 없는 챕터는 복습
   사다리에도, 밀림 수에도, 어느 경고에도 **안 나타난다**(없는 것에 대한 due 는 0이다).
   즉 가장 위험한 구멍이 가장 조용하다. 학기 중 만든 카드는 앞 챕터에 몰리고 뒤로 갈수록
   비는 것이 흔한 형태인데, 시험 범위는 그 뒤쪽까지다.

   ## ⚠ 이 파일의 존재 판정 — `verdict`

   로드맵 N-6 의 가장 싼 검증은 _"내보낸 카드에 챕터 표기가 있나"_ 였다. 표기가 없으면 이
   지도는 **전 칸이 0** 이 되고, 그건 "카드가 없다"가 아니라 **"셀 수 없다"** 다. 둘을 같은
   픽셀로 그리면 앱이 사용자에게 없는 구멍을 만들어 보여 준다 → `verdict: 'none'` 이 그
   상태의 이름이고, 화면은 그때 지도 대신 **왜 셀 수 없는지**를 말해야 한다.

   ## ⚠ 조회를 주입받는다

   AnkiConnect 는 IO 이고 사용자의 Anki 가 떠 있어야 한다. 여기서 직접 부르면 이 판정을
   테스트할 수 없다 — `scanCoverage` 는 **세는 함수를 인자로 받는다**(`recallWindows` 가
   `examsOfItem` 을 받는 것과 같은 관용구).
============================================================ */
import type { Item } from './types';

/** 칸 하나 — 과목 × 챕터. */
export interface CoverageCell {
  sid: string;
  subject: string;
  chapter: string;
  /** 그 챕터 이름으로 찾은 카드 수. */
  cards: number;
  /** 그 챕터를 끝냈나 — **끝냈는데 카드가 0인 칸**이 이 지도의 알맹이다. */
  done: boolean;
}

export interface CoverageRow {
  sid: string;
  name: string;
  cells: CoverageCell[];
  /** 카드가 하나라도 있는 챕터 수. */
  withCards: number;
  total: number;
}

export interface Coverage {
  rows: CoverageRow[];
  /** `none` = 전 칸 0(= 셀 수 없다 · 위 ⚠) · `partial` = 구멍 있음 · `full` = 전 챕터에 카드 있음. */
  verdict: 'none' | 'partial' | 'full';
  /** **끝낸 챕터 중 카드가 0인 칸** — 많은 순이 아니라 과목·챕터 순(지도의 읽기 순서 그대로). */
  gaps: CoverageCell[];
}

/** 조회 결과의 키 — `sid|챕터이름`. ⚠ `cbms.chapter`·`Question.chapter` 와 **같은 축**(이름 문자열)이다. */
export function coverageKey(sid: string, chapter: string): string {
  return `${sid}|${chapter}`;
}

/**
 * Anki 검색어 — `"deck:*과목*" "챕터"`.
 *
 * ⚠ 덱 이름이 과목과 정확히 같지 않을 수 있어 `*` 로 감싼다(`dueBySubject` 가 `subjectMatch` 로
 * 하는 일의 검색어 판). ⚠ 따옴표 안의 `"` 는 검색을 깨뜨리므로 지운다 — 이스케이프 규칙이
 * AnkiConnect 쪽에 명세돼 있지 않아, 넣는 것보다 빼는 것이 예측 가능하다.
 */
export function ankiQuery(subject: string, chapter: string): string {
  const q = (s: string): string => s.replace(/"/g, ' ').trim();
  return `"deck:*${q(subject)}*" "${q(chapter)}"`;
}

/** 조회 결과(키 → 카드 수) → 지도. **순수**. */
export function coverage(items: readonly Item[], counts: Readonly<Record<string, number>>): Coverage {
  const rows: CoverageRow[] = [];
  for (const it of items) {
    if (!it.name || !(it.chapters || []).length) continue;
    const cells = (it.chapters || []).map((c) => ({
      sid: it.id,
      subject: it.name,
      chapter: c.name,
      cards: Math.max(0, counts[coverageKey(it.id, c.name)] ?? 0),
      done: !!c.done,
    }));
    rows.push({
      sid: it.id,
      name: it.name,
      cells,
      withCards: cells.filter((c) => c.cards > 0).length,
      total: cells.length,
    });
  }
  const total = rows.reduce((a, r) => a + r.total, 0);
  const withCards = rows.reduce((a, r) => a + r.withCards, 0);
  return {
    rows,
    verdict: total === 0 || withCards === 0 ? 'none' : withCards === total ? 'full' : 'partial',
    /* ⚠ **끝낸 챕터만** 구멍으로 센다. 아직 안 배운 챕터에 카드가 없는 것은 구멍이 아니라
       순서다 — 그것까지 세면 학기 초에 목록이 51줄이 되고, 그 목록은 아무도 안 읽는다. */
    gaps: rows.flatMap((r) => r.cells.filter((c) => c.done && c.cards === 0)),
  };
}

/**
 * 챕터마다 카드 수를 센다. `count` 는 검색어 하나를 받아 **개수**를 돌려주는 함수(주입).
 *
 * ⚠ 실패한 질의는 **0이 아니라 누락**이다 — 키를 안 넣는다. 0으로 채우면 Anki 가 중간에 죽은
 * 것이 "카드 없음"으로 굳고, 그 지도는 사용자를 잘못된 작업으로 보낸다(`ankiLapses` 의
 * `unavailable` 규율과 같다).
 */
export async function scanCoverage(
  items: readonly Item[],
  count: (query: string) => Promise<number>,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const it of items) {
    if (!it.name) continue;
    for (const c of it.chapters || []) {
      try {
        out[coverageKey(it.id, c.name)] = await count(ankiQuery(it.name, c.name));
      } catch {
        /* 누락으로 남긴다(위 ⚠). */
      }
    }
  }
  return out;
}
