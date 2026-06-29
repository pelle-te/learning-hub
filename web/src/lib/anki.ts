/* ============================================================
   anki.ts — Anki 현황(볼트 _anki 파일 + AnkiConnect) — 서버/외부 데이터.
   ① 볼트 카드 스캔: 정본 _index.json.anki 매니페스트 우선, 없으면 anki/ 폴더 .txt 폴백.
   ② 실시간 due: AnkiConnect(localhost:8765, deckNames+getDeckStats).
   순수 fetch만 — 앱 상태에 복제 X. TanStack Query가 캐시/로딩/에러 소유(설계도 §1-B).
============================================================ */
import { loadVaultIndex } from './vault';

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
  return { at: new Date().toLocaleString('ko'), decks };
}

/** 볼트 카드 스캔 — _index.json.anki 우선, 없으면 anki/ 폴더 .txt 폴백. 취소 시 null. */
export async function pickAndScanAnki(
  existing?: FileSystemDirectoryHandle,
): Promise<{ scan: AnkiFile; handle: FileSystemDirectoryHandle } | null> {
  const picker = (window as unknown as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> })
    .showDirectoryPicker;
  let handle = existing;
  if (!handle) {
    if (!picker) throw new Error('이 브라우저는 폴더 연결을 지원하지 않아요(Chrome/Edge).');
    try {
      handle = await picker();
    } catch {
      return null;
    }
  }
  let decks: AnkiFileDeck[] = [];
  let src = '';
  const idx = await loadVaultIndex(handle);
  if (idx && Array.isArray(idx.anki) && idx.anki.length) {
    decks = (idx.anki as IndexAnki[]).map((a) => ({
      file: a.file.replace(/\.txt$/, ''),
      subj: a.file.split('_')[0],
      cards: a.cards,
    }));
    src = '_index.json';
  } else {
    const entries = (h: FileSystemDirectoryHandle) =>
      (h as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries();
    let ank: FileSystemDirectoryHandle | null = null;
    for await (const [n, e] of entries(handle))
      if ((n === 'anki' || n === '_anki') && e.kind === 'directory') ank = e as FileSystemDirectoryHandle;
    if (!ank) throw new Error('정본 _index.json도 anki 폴더도 못 찾았어요. 전공(볼트) 폴더를 선택하세요.');
    for await (const [fn, fh] of entries(ank)) {
      if (fh.kind !== 'file' || !fn.endsWith('.txt')) continue;
      const t = await (await (fh as FileSystemFileHandle).getFile()).text();
      const cards = t.split('\n').filter((l) => l.trim() && !l.startsWith('#')).length;
      decks.push({ file: fn.replace('.txt', ''), subj: fn.split('_')[0], cards });
    }
    src = 'anki/ 폴더';
  }
  return { scan: { at: new Date().toLocaleString('ko'), src, decks }, handle };
}

/** 덱들의 오늘 풀 due 합(new+learn+review). */
export function totalDue(decks: AnkiDeck[]): number {
  return decks.reduce((t, d) => t + (+d.new || 0) + (+d.learn || 0) + (+d.review || 0), 0);
}
