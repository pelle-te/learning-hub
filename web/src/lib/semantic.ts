/* ============================================================
   semantic.ts — 로컬 임베딩 시맨틱 레이어(킬러 기능 ②).
   내 학습 자산(챕터·요약·독후감·백로그)을 로컬 Ollama 임베딩(serve.js /api/embed 프록시)으로
   벡터화해 ① ⌘K 의미 검색("그때 읽은 인플레이션 글") ② 지식맵 과목-간 자동 연결 엣지를 만든다.
   전부 로컬(local-first) — 텍스트는 localhost 밖으로 나가지 않는다.

   구조: 순수 계산(해시·코사인·topK·코퍼스 구성)과 IO(임베딩 fetch·IDB 캐시)를 분리.
   벡터 캐시는 텍스트 해시 키 — 내용이 안 바뀐 항목은 재임베딩하지 않는다(증분).
   Ollama/임베딩 모델이 없으면 조용히 비활성(한 세션 1회만 시도) — 기능은 보강이지 의존이 아니다.
============================================================ */
import { embedTexts } from './api';
import { idbMirror, idbLoad } from './idb';
import type { AppState } from './types';
import type { ReadsLocal } from './reads';

export type SemKind = 'chapter' | 'summary' | 'book' | 'backlog';

export interface SemEntry {
  id: string;
  kind: SemKind;
  /** 팔레트에 보여줄 제목. */
  label: string;
  /** 임베딩 입력 텍스트(짧게 — 서버 캡 3000자). */
  text: string;
  /** 선택 시 이동할 라우트. */
  to: string;
}

export interface SemHit extends SemEntry {
  sim: number;
}

/* ── 순수 계산 ─────────────────────────────────────────────── */

/** djb2 문자열 해시(증분 캐시 키) — 빠르고 충분히 분산. */
export function hashText(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** 코사인 유사도. 길이 불일치·영벡터는 0. */
export function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** 질의 벡터에 가장 가까운 상위 k개(minSim 미만은 제외, 유사도 내림차순). */
export function topK(query: number[], entries: { entry: SemEntry; vec: number[] }[], k = 5, minSim = 0.35): SemHit[] {
  return entries
    .map(({ entry, vec }) => ({ ...entry, sim: cosine(query, vec) }))
    .filter((h) => h.sim >= minSim)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, k);
}

/** 앱 상태 + 읽을거리 블롭 → 임베딩 코퍼스. 순수(입력만 사용) — 테스트 가능. */
export function buildCorpus(state: AppState, reads: ReadsLocal | null): SemEntry[] {
  const out: SemEntry[] = [];
  // ① 챕터 — 과목명과 함께(짧은 이름만으론 의미가 빈약).
  for (const it of state.items || []) {
    if (!it.name) continue;
    for (const ch of it.chapters || []) {
      if (!ch.name) continue;
      out.push({
        id: `ch:${it.id}:${ch.id}`,
        kind: 'chapter',
        label: `${it.name} — ${ch.name}`,
        text: `${it.name} ${ch.name}`,
        to: '/graph',
      });
    }
  }
  // ② 내가 쓴 3문장 요약(학습 기록, s1~s3) — 가장 밀도 높은 의미 자산.
  const sm = state.summaries || {};
  for (const ds of Object.keys(sm)) {
    for (const s of sm[ds] || []) {
      const text = [s.s1, s.s2, s.s3]
        .map((x) => (x || '').trim())
        .filter(Boolean)
        .join(' ');
      if (!text) continue;
      out.push({
        id: `sum:${ds}:${s.id}`,
        kind: 'summary',
        label: `${ds.slice(5)} 요약 · ${s.name || '무제'}`,
        text: `${s.name || ''} ${text}`.slice(0, 2000),
        to: '/journal',
      });
    }
  }
  // ③ 독후감(읽을거리 로컬 블롭).
  for (const b of reads?.books || []) {
    const review = (b.review || '').trim();
    if (!b.title || !review) continue;
    out.push({
      id: `book:${b.id}`,
      kind: 'book',
      label: `독서 · ${b.title}`,
      text: `${b.title} ${b.author || ''} ${review}`.slice(0, 2000),
      to: '/reads',
    });
  }
  // ④ 보충 백로그(승격된 소비물 포함 — 소비→학습 루프의 의미 검색).
  for (const bl of state.backlog || []) {
    const topic = (bl.topic || '').trim();
    if (!topic) continue;
    out.push({
      id: `bl:${bl.id}`,
      kind: 'backlog',
      label: `백로그 · ${topic}`,
      text: `${topic} ${bl.note || ''}`.slice(0, 1200),
      to: '/journal',
    });
  }
  return out;
}

/* ── IO — 벡터 캐시(IDB) + 임베딩 ─────────────────────────── */

const IDB_KEY = 'semvec';
const BATCH = 16; // 서버 캡 32의 절반 — 콜드 로드에도 응답이 빠르게 오도록

interface VecCache {
  model: string;
  vecs: Record<string, number[]>; // hashText(text) → vector
}

let _cache: VecCache | null = null;
let _cacheLoaded = false;

async function loadCache(): Promise<VecCache> {
  if (_cache) return _cache;
  if (!_cacheLoaded) {
    _cacheLoaded = true;
    try {
      const raw = await idbLoad(IDB_KEY);
      if (raw) {
        const p = JSON.parse(raw) as VecCache;
        if (p && typeof p === 'object' && p.vecs) _cache = { model: p.model || '', vecs: p.vecs };
      }
    } catch {
      /* 캐시는 보강 — 없으면 새로 */
    }
  }
  if (!_cache) _cache = { model: '', vecs: {} };
  return _cache;
}

function saveCache(): void {
  if (!_cache) return;
  try {
    idbMirror(JSON.stringify(_cache), IDB_KEY);
  } catch {
    /* 비차단 */
  }
}

/** 세션 가용성 — 임베딩 실패(Ollama 꺼짐·모델 미설치) 시 이 세션에선 재시도하지 않는다. */
let _disabled = false;
export function semanticAvailable(): boolean {
  return !_disabled;
}

/** 텍스트 배열 → 벡터 배열(캐시 우선, 미스만 배치 임베딩). 실패 시 null(세션 비활성). */
export async function vectorsFor(texts: string[]): Promise<(number[] | null)[] | null> {
  if (_disabled) return null;
  const cache = await loadCache();
  const hashes = texts.map(hashText);
  const missIdx = hashes.map((h, i) => (cache.vecs[h] ? -1 : i)).filter((i) => i >= 0);
  for (let off = 0; off < missIdx.length; off += BATCH) {
    const slice = missIdx.slice(off, off + BATCH);
    try {
      const res = await embedTexts(slice.map((i) => texts[i]!));
      if (!res.ok || !res.vectors) {
        _disabled = true; // 모델 미설치·Ollama 꺼짐 — 이 세션은 조용히 비활성
        return null;
      }
      // 모델이 바뀌었으면 캐시 전체가 다른 공간 — 비우고 다시 시작.
      if (cache.model && cache.model !== (res.model || '')) cache.vecs = {};
      cache.model = res.model || cache.model;
      slice.forEach((i, j) => {
        const v = res.vectors![j];
        if (v) cache.vecs[hashes[i]!] = v;
      });
    } catch {
      _disabled = true;
      return null;
    }
  }
  if (missIdx.length) saveCache();
  return hashes.map((h) => cache.vecs[h] ?? null);
}

/** 코퍼스 전체의 (entry, vec) 짝 — 캐시 증분 임베딩. 실패 시 null. */
export async function indexCorpus(entries: SemEntry[]): Promise<{ entry: SemEntry; vec: number[] }[] | null> {
  if (!entries.length) return [];
  const vecs = await vectorsFor(entries.map((e) => e.text));
  if (!vecs) return null;
  const out: { entry: SemEntry; vec: number[] }[] = [];
  entries.forEach((entry, i) => {
    const vec = vecs[i];
    if (vec) out.push({ entry, vec });
  });
  return out;
}

/* ── 지식맵 자동 연결(챕터 ↔ 챕터, 과목 경계 너머) ─────────────── */

export interface SemEdge {
  /** Graph 잎 노드 id(= chapter.id) 쌍. */
  source: string;
  target: string;
  sim: number;
}

/** 서로 다른 과목의 챕터 벡터 쌍 중 유사도 minSim 이상 상위 maxEdges — 순수(테스트 대상).
    같은 과목 안 챕터는 이미 허브로 이어져 있어 제외한다. */
export function crossChapterEdges(
  chapters: { itemId: string; chapterId: string; vec: number[] }[],
  minSim = 0.62,
  maxEdges = 24,
): SemEdge[] {
  const out: SemEdge[] = [];
  for (let i = 0; i < chapters.length; i++) {
    for (let j = i + 1; j < chapters.length; j++) {
      const a = chapters[i]!;
      const b = chapters[j]!;
      if (a.itemId === b.itemId) continue;
      const sim = cosine(a.vec, b.vec);
      if (sim >= minSim) out.push({ source: a.chapterId, target: b.chapterId, sim });
    }
  }
  return out.sort((a, b) => b.sim - a.sim).slice(0, maxEdges);
}

/** 지식맵용 — 챕터를 임베딩해 과목-간 의미 연결 엣지를 만든다. Ollama 불가면 []. */
export async function semanticChapterEdges(items: AppState['items'], minSim = 0.62, maxEdges = 24): Promise<SemEdge[]> {
  if (_disabled) return [];
  const chs: { itemId: string; chapterId: string; text: string }[] = [];
  for (const it of items || []) {
    if (!it.name) continue;
    for (const ch of it.chapters || []) {
      if (ch.name) chs.push({ itemId: it.id, chapterId: ch.id, text: `${it.name} ${ch.name}` });
    }
  }
  if (chs.length < 2) return [];
  const vecs = await vectorsFor(chs.map((c) => c.text));
  if (!vecs) return [];
  const withVec = chs
    .map((c, i) => ({ itemId: c.itemId, chapterId: c.chapterId, vec: vecs[i] }))
    .filter((c): c is { itemId: string; chapterId: string; vec: number[] } => !!c.vec);
  return crossChapterEdges(withVec, minSim, maxEdges);
}

/** 의미 검색 — 질의를 임베딩해 코퍼스 상위 k. Ollama 불가·코퍼스 빈 경우 []. */
export async function semanticSearch(
  query: string,
  state: AppState,
  reads: ReadsLocal | null,
  k = 5,
): Promise<SemHit[]> {
  const q = query.trim();
  if (!q || _disabled) return [];
  const corpus = buildCorpus(state, reads);
  if (!corpus.length) return [];
  const indexed = await indexCorpus(corpus);
  if (!indexed || !indexed.length) return [];
  const qv = await vectorsFor([q]);
  if (!qv || !qv[0]) return [];
  return topK(qv[0], indexed, k);
}
