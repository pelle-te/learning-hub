/* ============================================================
   reads.ts — '읽을거리' 데이터 레이어.
   ① 지문(Article): 수집 원문 산출물 `reads` — 읽기 전용·원문 보존.
      요약은 절대 서버가 하지 않는다(사용자가 직접 하는 연습). 여기선 페치만.
   ② 연습/독서(로컬): 내 요약(ArticleWork)·독서 독후감(Book)은 로컬-퍼스트로 저장
      (localStorage 동기 1차 + IDB 미러 — idb.ts와 동형). 서버 불필요·오프라인 완결.
   순수 계산 + fetch/저장만 — 앱 상태(useApp)에 복제하지 않는다(설계도 §1-B, api.ts와 동일 원칙).
============================================================ */
import { getArtifact, type CoachFeedback } from './api';
import { idbMirror, idbLoad } from './idb';
import { docGet, docSet } from './db/docs';
import { announce } from './sync';
import { rid } from './utils';

/** 수집된 지문 1편(읽을거리_수집.py의 JSON과 1:1). 원문 그대로 — 가공 없음. */
export interface Article {
  id: string;
  lang: 'en' | 'ko';
  field: string;
  source: string;
  title: string;
  url: string;
  published: string;
  words: number;
  text: string;
}
export interface ReadsArtifact {
  at: string;
  date: string;
  articles: Article[];
}

/** 지문 위 내 연습 — 내가 직접 쓴 요약(en=영어공부 메모, ko=요약 연습) + 완료 표시.
    coach: AI 채점 결과(수십 초 걸림) — 이탈·새로고침에도 보존하도록 여기 함께 저장. */
export interface ArticleWork {
  summary: string;
  done: boolean;
  updatedAt: string;
  coach?: CoachFeedback;
  coachAt?: string;
}

/** 독서 1권 — 책 읽고 직접 쓰는 독후감(AI 없음). */
export interface Book {
  id: string;
  title: string;
  author: string;
  status: 'reading' | 'done';
  review: string;
  rating: number; // 0=미평가, 1~5
  startedAt: string;
  finishedAt: string | null;
}

/** 로컬 저장 블롭 — work(지문별 내 요약) + books(독서). */
export interface ReadsLocal {
  work: Record<string, ArticleWork>;
  books: Book[];
}

const LKEY = 'lh:reads';
const IDB_KEY = 'reads';

function empty(): ReadsLocal {
  return { work: {}, books: [] };
}

function coerce(v: unknown): ReadsLocal {
  if (!v || typeof v !== 'object') return empty();
  const o = v as Partial<ReadsLocal>;
  return {
    work: o.work && typeof o.work === 'object' ? o.work : {},
    books: Array.isArray(o.books) ? o.books : [],
  };
}

/** 내 요약·독서 로드(**동기**) — 셸은 부팅에 올린 메모리, 브라우저는 localStorage(`db/docs.ts`).
 *  파싱 실패해도 빈 값(throw X). 동기여야 하는 이유: 팔레트·Reads 탭이 렌더 경로에서 부른다. */
export function loadReads(): ReadsLocal {
  try {
    return coerce(JSON.parse(docGet(LKEY) || 'null'));
  } catch {
    return empty();
  }
}

/** localStorage가 비었을 때 IDB 미러에서 복구(사이트 데이터 삭제 후 부팅). 없으면 null. */
export async function recoverReadsFromIDB(): Promise<ReadsLocal | null> {
  if (docGet(LKEY)) return null;
  try {
    const json = await idbLoad(IDB_KEY);
    if (!json) return null;
    const r = coerce(JSON.parse(json));
    docSet(LKEY, JSON.stringify(r));
    return r;
  } catch {
    return null;
  }
}

/** 저장 — 셸은 메모리 즉시 + SQLite 비동기, 브라우저는 localStorage(동기) + IDB 미러.
 *  분기는 `db/docs.ts` 가 흡수한다 — 이 파일은 어디에 저장되는지 모른다. */
export function saveReads(r: ReadsLocal): boolean {
  const json = JSON.stringify(r);
  idbMirror(json, IDB_KEY); // 브라우저 전용 방어층(셸엔 '사이트 데이터 삭제' 위협이 없다)
  /* ⚠ `undo: true` — **docs 호출부 다섯 중 여기 하나만** 사용자 편집이다(H3 · 2026-08-01).
     나머지 넷(IDB 복구·`_local` 가져오기·산출물 미러 2종)은 기계가 낸 쓰기라 ⌘Z 에 실리면
     "내가 방금 한 편집"이 아닌 것을 되돌리게 된다 — 근거는 `db/docs.docSet` 머리주석. */
  const ok = docSet(LKEY, json, { undo: true });
  if (ok) announce({ kind: 'reads' }); // 다른 탭의 읽을거리 화면 라이브 갱신
  return ok;
}

/** 백업 파일에 동봉된 읽을거리 블롭(_reads) 복원 — 내 요약·독후감은 사용자의 유일한 저작물이라
    내보내기/가져오기 계약에 반드시 포함된다. 형태가 아니면 무시(null). */
export function importReads(v: unknown): ReadsLocal | null {
  if (!v || typeof v !== 'object') return null;
  const r = coerce(v);
  saveReads(r);
  announce({ kind: 'reads' }, true); // 같은 탭의 읽을거리 화면도 갱신(가져오기는 화면 밖 경로)
  return r;
}

/** 지문 아티팩트 페치(워크스페이스 설정 필요). 미수집/오프라인이면 throw → 호출부가 우아 안내. */
export async function fetchReadsArtifact(): Promise<ReadsArtifact> {
  const r = await getArtifact<ReadsArtifact>('reads');
  if (!r.ok || !r.data) throw new Error(r.error || '아직 수집된 지문이 없어요');
  return r.data;
}

/** 새 책 한 권(빈 독후감·읽는 중). */
export function newBook(title: string, author = ''): Book {
  return {
    id: rid(),
    title: title.trim(),
    author: author.trim(),
    status: 'reading',
    review: '',
    rating: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
}

/** 지문 언어별 집계(리드아웃용). */
export function articleStats(articles: Article[], work: Record<string, ArticleWork>) {
  const en = articles.filter((a) => a.lang === 'en').length;
  const ko = articles.length - en;
  const done = articles.filter((a) => work[a.id]?.done).length;
  return { total: articles.length, en, ko, done };
}
