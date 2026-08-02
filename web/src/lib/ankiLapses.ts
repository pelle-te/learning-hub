/* ============================================================
   ankiLapses.ts — **T-19 Anki 카드 → 챕터 접합**(lapses). 순수 계산 + 얇은 조회.

   ## 무엇이 없었나

   Anki 는 **어느 카드가 반복해서 무너지는지**를 정확히 안다(`prop:lapses`). 이 앱은 그 사실을
   **한 번도 읽은 적이 없다** — `fetchAnkiLive` 는 덱별 due 수만 세고, 그건 "얼마나 밀렸나"이지
   "무엇이 안 붙나"가 아니다. 그래서 반복 실패를 보려면 Anki 를 직접 열어 정렬해야 했다.

   ## ⚠ Rust 변경 0 인 이유

   `ankiConnect` 가 **액션 이름을 인자로 받는 범용 통로**다(셸에선 Rust 가 중계). 그래서 새 액션
   (`findCards`·`cardsInfo`·`notesInfo`)을 쓰는 데 백엔드 변경이 0 이다 — 로드맵이 이 항목에 적어 둔
   _"Rust 변경 0"_ 이 실제로 성립하는지 확인하고 들어갔다.

   ## ⚠⚠ 태그가 없으면 **조용히 0 을 주지 않는다**

   접합의 전제는 _"우리가 심은 태그(`요약::<과목>::<챕터>`)가 살아 있고 실제로 import 했다"_ 이다.
   그 전제가 거짓이면 결과가 0건인데, **0건은 "반복 실패가 없다"와 픽셀이 같다** — 앱이 잘하고
   있다고 거짓말하게 된다. 그래서 판정을 셋으로 가른다: `ok`(붙었다) · `no-tags`(태그 0) ·
   `unavailable`(Anki 가 안 떠 있다). 화면은 그 셋을 다르게 말해야 한다.
============================================================ */
import { ankiConnect } from './anki';

/** 이 횟수를 넘겨 무너진 카드만 본다. 1~2 회는 정상 학습 곡선이지 신호가 아니다. */
export const LAPSE_MIN = 2;

/** 우리가 볼트에서 심는 태그 접두. ⚠ 파이프라인 규약이라 여기서 바꾸면 접합이 통째로 끊긴다. */
const TAG_ROOT = '요약';

export interface LapseRow {
  /** 과목 이름(태그 2번째 마디). */
  subject: string;
  /** 챕터 이름(태그 3번째 마디). 없으면 과목 단위 카드. */
  chapter: string | null;
  lapses: number;
}

export type LapseResult =
  | { kind: 'ok'; rows: LapseRow[] }
  /** 태그가 하나도 안 걸렸다 — **0건과 구분해야 한다**(머리주석). */
  | { kind: 'no-tags' }
  | { kind: 'unavailable'; why: string };

/** `요약::회로이론::3장` → `{ subject, chapter }`. 형식이 아니면 null. */
export function parseTag(tag: string): { subject: string; chapter: string | null } | null {
  const parts = tag.split('::');
  if (parts[0] !== TAG_ROOT || parts.length < 2 || !parts[1]) return null;
  return { subject: parts[1], chapter: parts[2] || null };
}

/** 노트들의 태그·lapses 를 (과목·챕터) 단위로 접는다 — **가장 많이 무너진 것부터**. */
export function foldLapses(notes: { tags: string[]; lapses: number }[]): LapseRow[] {
  const acc = new Map<string, LapseRow>();
  for (const n of notes) {
    if (n.lapses < LAPSE_MIN) continue;
    for (const t of n.tags) {
      const p = parseTag(t);
      if (!p) continue;
      const key = `${p.subject}|${p.chapter ?? ''}`;
      const cur = acc.get(key);
      /* ⚠ **최댓값이지 합계가 아니다.** 한 챕터에 카드가 30장이면 합계는 카드 수에 비례해
         커져서, 카드를 많이 만든 챕터가 자동으로 "가장 위험"이 된다 — 재려던 것은 그게
         아니라 *가장 안 붙는 것*이다. */
      if (cur) cur.lapses = Math.max(cur.lapses, n.lapses);
      else acc.set(key, { subject: p.subject, chapter: p.chapter, lapses: n.lapses });
    }
  }
  return [...acc.values()].sort((a, b) => b.lapses - a.lapses);
}

interface CardInfo {
  /** 소속 노트 id — 태그를 붙이려면 이 키로 조인해야 한다. */
  note?: number;
  lapses?: number;
}
interface NoteInfo {
  noteId?: number;
  tags?: string[];
}

/** 카드(lapses)와 노트(tags)를 노트 id 로 조인한다 — 순수라 테스트가 이 조인을 잠근다. */
export function joinCardsToTags(cards: CardInfo[], notes: NoteInfo[]): { tags: string[]; lapses: number }[] {
  const tagsOf = new Map<number, string[]>();
  for (const n of notes) if (n.noteId != null) tagsOf.set(n.noteId, n.tags || []);
  return cards.filter((c) => c.note != null).map((c) => ({ tags: tagsOf.get(c.note!) || [], lapses: c.lapses ?? 0 }));
}

/**
 * 반복해서 무너지는 챕터들. Anki 가 안 떠 있으면 `unavailable`.
 *
 * ⚠⚠ **왕복이 셋인 것이 정확성의 대가다.** `lapses` 는 **카드** 속성이고 `tags` 는 **노트**
 * 속성이라, AnkiConnect 에는 둘을 함께 주는 질의가 없다. 두 왕복으로 줄이려면 `notesInfo`
 * 하나로 끝내야 하는데 거기엔 lapses 가 없어서 **수를 지어내야 한다** — 그러면 화면에 뜨는
 * "5회 무너짐"이 거짓이 된다. 왕복 하나를 아끼자고 거짓 숫자를 그릴 수는 없다.
 *   ① `findCards`(질의로 이미 좁힘) → ② `cardsInfo`(lapses + note) → ③ `notesInfo`(tags)
 */
export async function fetchLapses(): Promise<LapseResult> {
  try {
    const cardIds = await ankiConnect<number[]>('findCards', {
      query: `tag:${TAG_ROOT}::* prop:lapses>${LAPSE_MIN - 1}`,
    });
    if (!cardIds.length) {
      /* 태그 자체가 있는지 따로 묻는다 — 없으면 "무너진 게 없다"가 아니라 "접합이 안 됐다"다. */
      const any = await ankiConnect<number[]>('findCards', { query: `tag:${TAG_ROOT}::*` });
      return any.length ? { kind: 'ok', rows: [] } : { kind: 'no-tags' };
    }
    const cards = await ankiConnect<CardInfo[]>('cardsInfo', { cards: cardIds });
    const noteIds = [...new Set(cards.map((c) => c.note).filter((n): n is number => n != null))];
    const notes = await ankiConnect<NoteInfo[]>('notesInfo', { notes: noteIds });
    return { kind: 'ok', rows: foldLapses(joinCardsToTags(cards, notes)) };
  } catch (e) {
    return { kind: 'unavailable', why: e instanceof Error ? e.message : 'Anki 에 연결하지 못했어요' };
  }
}
