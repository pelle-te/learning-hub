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
    const res = await fetch('http://localhost:8765', {
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
  return decks.reduce((t, d) => t + (+d.new || 0) + (+d.learn || 0) + (+d.review || 0), 0);
}

/** 볼트 카드 파일덱들의 총 카드 수 합 — totalDue와 대칭. 인라인 reduce 3중복 수렴(SR-11). */
export function totalCards(decks: AnkiFileDeck[]): number {
  return decks.reduce((t, d) => t + (+d.cards || 0), 0);
}
