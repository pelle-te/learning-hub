/* ============================================================
   anki.ts — Anki 현황(볼트 _anki 파일 + AnkiConnect) — 서버/외부 데이터.
   ① 볼트 카드 스캔: 정본 _index.json.anki 매니페스트 우선, 없으면 anki/ 폴더 .txt 폴백.
   ② 실시간 due: AnkiConnect(localhost:8765, deckNames+getDeckStats).
   순수 fetch만 — 앱 상태에 복제 X. TanStack Query가 캐시/로딩/에러 소유(설계도 §1-B).
============================================================ */
import { iso } from './utils';
import { loadVaultIndex } from './vault';
import { dirEntries, pickDirectory } from './fsAccess';
import { isTauri, shellAnkiConnect, shellAnkiScan } from './tauri';

import { matchSubjectIndex } from './subjectMatch';

/** AnkiConnect 주소 — **브라우저 폴백 전용**이다(셸에서는 `src-tauri/src/anki.rs` 가 중계한다:
 *  AnkiConnect 가 `Origin` 을 검사하는데 `tauri://` 오리진이 그 화이트리스트에 없다).
 *  ⚠ 그쪽 `ANKI_CONNECT_URL` 과 **같은 값이어야 한다** — 포트는 애드온 설정으로 바뀔 수 있는
 *  값인데 지금은 주입 경로가 없다(2026-08-20 리뷰 m-23). 이름을 준 것은 그 사실을 grep 가능하게
 *  만드는 것까지다: 사용자가 포트를 바꾸는 경로가 필요해지면 두 상수를 함께 설정에서 읽게 한다
 *  (`src-tauri/src/ollama.rs` 가 `OLLAMA_BASE_URL` 로 이미 그 형태다). */
const ANKI_CONNECT_URL = 'http://localhost:8765';

export interface AnkiDeck {
  name: string;
  new: number;
  learn: number;
  review: number;
  total: number;
}
export interface AnkiLive {
  at: string;
  decks: AnkiDeck[];
  /** 조회한 **날짜**(로컬 ISO). `at` 은 `toLocaleString` 이라 사람은 읽어도 코드는 못 판정한다.
   *  ⚠ optional 인 이유는 옛 저장본 때문이다 — 이 필드 이전에 `runtime` 테이블에 남은 값은
   *  날짜를 모르고, 그때는 **모른다고 말한다**(아래 `ankiFreshness`). */
  ds?: string;
}
export interface AnkiFileDeck {
  file: string;
  subj: string;
  cards: number;
}
export interface AnkiFile {
  at: string;
  src: string;
  decks: AnkiFileDeck[];
}

interface IndexAnki {
  file: string;
  cards: number;
}

/** AnkiConnect 단일 호출 — Anki 미실행/방화벽 시 3초 타임아웃(무한대기 방지). */
export async function ankiConnect<T = unknown>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  /* 셸(4단계-F)에선 Rust 가 중계한다 — AnkiConnect 가 `Origin` 을 검사하는데 셸 오리진
     `http://tauri.localhost` 는 기본 화이트리스트(`http://localhost`)에 없다. Rust 요청엔
     Origin 이 안 붙고, AnkiConnect 는 오리진 없는 요청(비-브라우저)을 허용한다.
     ⚠ 이 근거는 AnkiConnect 의 문서화된 동작이지 이 기계에서의 관측이 아니다 — 프로브를 돌린
        시점에 Anki 가 꺼져 있었고, 브라우저는 CORS 거부와 연결 거부를 같은 오류로 준다. */
  if (isTauri()) {
    const j = await shellAnkiConnect<{ error?: string; result?: T }>(action, params);
    if (j.error) throw new Error(j.error);
    return j.result as T;
  }
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), 3000);
  try {
    const res = await fetch(ANKI_CONNECT_URL, {
      method: 'POST',
      body: JSON.stringify({ action, version: 6, params }),
      signal: ac.signal,
    });
    const j = (await res.json()) as { error?: string; result?: T };
    if (j.error) throw new Error(j.error);
    return j.result as T;
  } finally {
    clearTimeout(to);
  }
}

interface DeckStat {
  name: string;
  new_count: number;
  learn_count: number;
  review_count: number;
  total_in_deck: number;
}

/** 실시간 due — deckNames → getDeckStats. 연결 실패 시 throw(Query isError로 폴백 안내). */
export async function fetchAnkiLive(): Promise<AnkiLive> {
  const names = await ankiConnect<string[]>('deckNames');
  const stats = await ankiConnect<Record<string, DeckStat>>('getDeckStats', { decks: names });
  const decks: AnkiDeck[] = Object.values(stats).map((d) => ({
    name: d.name,
    new: d.new_count,
    learn: d.learn_count,
    review: d.review_count,
    total: d.total_in_deck,
  }));
  const now = new Date();
  return { at: now.toLocaleString('ko'), ds: iso(now), decks };
}

/**
 * 이 due 숫자가 **오늘 것인가**.
 *
 * ⚠ 이게 없던 동안 오늘 탭은 `runtime` 테이블에 남은 옛 값을 **오늘 값과 똑같이** 그렸다.
 * Anki due 는 날이 바뀌면 통째로 갈리므로 어제 숫자는 틀린 숫자인데, 화면엔 그 사실이
 * 어디에도 없었다 — "한눈에" 대시보드에서 가장 나쁜 오류 형태(조용하고 그럴듯하다).
 * ⚠ 모르면 모른다고 말한다(`ds` 없는 옛 저장본) — 신선하다고 우기지 않는다.
 */
export function ankiFreshness(
  live: AnkiLive | null | undefined,
  todayDs: string,
): { stale: boolean; label: string } | null {
  if (!live) return null;
  if (!live.ds) return { stale: true, label: '마지막 확인 시각을 몰라요' };
  if (live.ds === todayDs) return { stale: false, label: '오늘 확인함' };
  return { stale: true, label: `${live.ds}에 확인한 값이에요` };
}

/** 볼트 카드 스캔 — `_index.json` 의 anki 매니페스트 우선, 없으면 `anki/` 폴더 `.txt` 폴백.
 *  취소 시 null.
 *
 *  ⚠ **셸에선 폴더를 묻지 않는다**(4단계-I) — 워크스페이스를 이미 알기 때문이다. 3단계가 볼트
 *  노트 읽기에서 없앤 마찰을 여기서도 없앤 것이고, FSA 가 깨져서가 아니다(WebView2 에서
 *  `showDirectoryPicker` 는 실제로 동작한다 — 트랙 B 프로브로 확인). 그래서 셸 경로는
 *  `handle` 이 **null** 이다: 되물을 핸들이라는 개념 자체가 없다. */
export async function pickAndScanAnki(
  existing?: FileSystemDirectoryHandle,
): Promise<{ scan: AnkiFile; handle: FileSystemDirectoryHandle | null } | null> {
  if (isTauri()) {
    const r = await shellAnkiScan<{ src: string; decks: AnkiFileDeck[] }>();
    return { scan: { at: new Date().toLocaleString('ko'), src: r.src, decks: r.decks }, handle: null };
  }
  let handle = existing;
  if (!handle) {
    const picked = await pickDirectory(); // 미지원이면 FsUnsupportedError, 취소면 null
    if (!picked) return null;
    handle = picked;
  }
  let decks: AnkiFileDeck[] = [];
  let src = '';
  const idx = await loadVaultIndex(handle);
  if (idx && Array.isArray(idx.anki) && idx.anki.length) {
    decks = (idx.anki as IndexAnki[]).map((a) => ({
      file: a.file.replace(/\.txt$/, ''),
      subj: a.file.split('_')[0] ?? '',
      cards: a.cards,
    }));
    src = '_index.json';
  } else {
    let ank: FileSystemDirectoryHandle | null = null;
    for await (const [n, e] of dirEntries(handle))
      if ((n === 'anki' || n === '_anki') && e.kind === 'directory') ank = e as FileSystemDirectoryHandle;
    if (!ank) throw new Error('정본 _index.json도 anki 폴더도 못 찾았어요. 전공(볼트) 폴더를 선택하세요.');
    for await (const [fn, fh] of dirEntries(ank)) {
      if (fh.kind !== 'file' || !fn.endsWith('.txt')) continue;
      const t = await (await (fh as FileSystemFileHandle).getFile()).text();
      const cards = t.split('\n').filter((l) => l.trim() && !l.startsWith('#')).length;
      decks.push({ file: fn.replace('.txt', ''), subj: fn.split('_')[0] ?? '', cards });
    }
    src = 'anki/ 폴더';
  }
  return { scan: { at: new Date().toLocaleString('ko'), src, decks }, handle };
}

/** 덱들의 오늘 풀 due 합(new+learn+review). */
export function totalDue(decks: AnkiDeck[]): number {
  return decks.reduce((t, d) => t + deckDue(d), 0);
}

/** 덱 하나의 오늘 due(new+learn+review). */
function deckDue(d: AnkiDeck): number {
  return (+d.new || 0) + (+d.learn || 0) + (+d.review || 0);
}

/** 과목별 due 분해 결과. `unmatchedDecks`/`unmatchedDue` 는 **숨기지 않고 남긴다**(아래 ⚠). */
export interface DueBySubject {
  /** due 내림차순. `sid` 는 앱의 과목 id. */
  rows: { sid: string; name: string; due: number }[];
  /** 어느 과목에도 안 붙은 덱 수. */
  unmatchedDecks: number;
  /** 그 덱들의 due 합. */
  unmatchedDue: number;
}

/**
 * Anki 덱 due 를 **앱의 과목에 붙여** 분해한다(E18 · 2026-07-29).
 *
 * ⚠ 종전엔 `totalDue()` 가 전 덱을 **하나의 숫자**로 합쳤다. 덱 이름이 `AnkiLive.decks[].name`
 * 으로 살아 있는데 어디서도 `items[].name` 과 맞춰보지 않아, "Anki 340장"을 보고 **어느 과목이
 * 밀렸는지 알려면 Anki 를 직접 열어야** 했다(앱 밖 왕복). 그리고 복습 큐는 볼트 챕터만 보므로
 * Anki 가 200장 밀린 과목의 챕터를 태연히 또 올린다 — 두 시스템이 서로를 모른다.
 *
 * ⚠ **미연결 덱을 조용히 흡수하지 않는다.** 합계가 안 맞으면 눈에 띄어야 조인이 틀렸다는 것을
 * 알 수 있다("전자기학 120 · 회로 80 · 미연결 3덱 140장"). 숨기면 계측(E3)이 하려던 일을
 * 이 함수가 되돌린다.
 * ⚠ 매칭 규칙은 `subjectMatch` 가 소유한다 — 배분을 구동하는 그 규칙과 같아야 한다.
 */
export function dueBySubject(decks: AnkiDeck[], items: readonly { id: string; name: string }[]): DueBySubject {
  const names = items.map((i) => i.name);
  const bySid = new Map<string, { sid: string; name: string; due: number }>();
  let unmatchedDecks = 0;
  let unmatchedDue = 0;
  for (const d of decks) {
    const due = deckDue(d);
    if (due <= 0) continue; // 0장인 덱은 분해에 기여하지 않는다(있는 것만 말한다)
    const i = matchSubjectIndex(d.name, names);
    const it = i >= 0 ? items[i] : undefined;
    if (!it) {
      unmatchedDecks++;
      unmatchedDue += due;
      continue;
    }
    const cur = bySid.get(it.id);
    if (cur) cur.due += due;
    else bySid.set(it.id, { sid: it.id, name: it.name, due });
  }
  const rows = [...bySid.values()].sort((a, b) => b.due - a.due || (a.name < b.name ? -1 : 1));
  return { rows, unmatchedDecks, unmatchedDue };
}

/**
 * T-11 — `fromDs`~`toDs`(**양끝 포함**) 사이에 Anki 에서 실제로 복습한 카드 수.
 *
 * 부재 브리핑이 답해야 하는 질문은 "앱이 꺼져 있던 동안 밖에서 학습이 있었나"이고, Anki 는
 * 그 답을 날짜별로 이미 갖고 있다(`getNumCardsReviewedByDay` → `[["2026-08-01", 40], …]`).
 *
 * ⚠ **Rust 변경 0** — `ankiConnect` 가 액션 이름을 인자로 받는 범용 통로다(T-19 와 같은 근거).
 * ⚠ **못 물어보면 `null`이고 0 이 아니다.** Anki 가 안 떠 있는 것과 "그 기간에 한 장도 안 했다"는
 *   완전히 다른 사실인데 0 으로 접으면 화면에서 구분이 사라진다(`ankiLapses` 의 `unavailable` 규율).
 */
export async function ankiReviewedBetween(fromDs: string, toDs: string): Promise<number | null> {
  try {
    const rows = await ankiConnect<[string, number][]>('getNumCardsReviewedByDay');
    if (!Array.isArray(rows)) return null;
    let n = 0;
    for (const row of rows) {
      const [ds, cnt] = row ?? [];
      // 날짜 문자열은 사전순=시간순이라 그대로 비교한다(`iso` 와 같은 형식).
      if (typeof ds === 'string' && typeof cnt === 'number' && ds >= fromDs && ds <= toDs) n += cnt;
    }
    return n;
  } catch {
    return null;
  }
}

/** 볼트 카드 파일덱들의 총 카드 수 합 — totalDue와 대칭. 인라인 reduce 3중복 수렴(SR-11). */
export function totalCards(decks: AnkiFileDeck[]): number {
  return decks.reduce((t, d) => t + (+d.cards || 0), 0);
}
