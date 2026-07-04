/* ============================================================
   Reads(읽을거리) — 탭: 📰 읽을거리. 두 모드를 한 화면에서 세그먼트로 전환.
   ① 지문 연습 — serve.js가 수집한 원문(영어=영어공부 / 한국어=어휘·요약 연습). 요약은 내가 직접 쓴다.
   ② 독서 — 책 읽고 직접 독후감(AI 없음). 둘 다 내 요약/독후감은 로컬-퍼스트 저장(lib/reads).
   지문 페치는 useReads(Query)·serve.js 상태는 usePing — 오프라인이어도 독서는 항상 동작.
============================================================ */
import { useCallback, useEffect, useState } from 'react';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { useReads } from '@/store/queries';
import { usePing } from '@/store/queries';
import {
  loadReads,
  saveReads,
  recoverReadsFromIDB,
  articleStats,
  type ReadsLocal,
  type ArticleWork,
  type Book,
} from '@/lib/reads';
import { onSync } from '@/lib/sync';
import { ui } from '@/shell';
import ArticlePractice from './ArticlePractice';
import BookShelf from './BookShelf';
import r from './Reads.module.css';

type Mode = 'article' | 'book';

export default function Reads() {
  const [mode, setMode] = useState<Mode>('article');
  const [local, setLocal] = useState<ReadsLocal>(loadReads);

  // 부팅 복구 — localStorage가 비면 IDB 미러에서(사이트 데이터 삭제 대비).
  useEffect(() => {
    recoverReadsFromIDB().then((rec) => {
      if (rec) setLocal(rec);
    });
  }, []);

  // 멀티탭·가져오기 동기화 — 다른 경로가 저장한 읽을거리 블롭을 라이브로 채택.
  useEffect(() => onSync((m) => m.kind === 'reads' && setLocal(loadReads())), []);

  // 단일 저장 경로 — 두 패널이 같은 블롭을 공유(work + books). 저장 실패는 안내.
  const update = useCallback((fn: (prev: ReadsLocal) => ReadsLocal) => {
    setLocal((prev) => {
      const next = fn(prev);
      if (!saveReads(next)) ui.toast('저장 실패 — 저장공간이 가득 찼을 수 있어요.', 'bad', 5000);
      return next;
    });
  }, []);

  const setWork = useCallback(
    (id: string, w: ArticleWork) => update((p) => ({ ...p, work: { ...p.work, [id]: w } })),
    [update],
  );
  const setBooks = useCallback((books: Book[]) => update((p) => ({ ...p, books })), [update]);

  const reads = useReads();
  const { data: ping, isLoading: pingLoading } = usePing();
  const online = !!ping?.ok;

  const articles = reads.data?.articles ?? [];
  const st = articleStats(articles, local.work);
  const booksReading = local.books.filter((b) => b.status === 'reading').length;
  const booksDone = local.books.length - booksReading;

  // 리드아웃 — 모드별로 다른 지표를 상단 바에 주입.
  usePageChromeEffect(
    () =>
      mode === 'article'
        ? {
            readouts: [
              { label: '요약 완료', value: `${st.done}/${st.total}`, accent: true },
              { label: '영어·한국어', value: `${st.en}·${st.ko}` },
              { label: 'serve.js', value: online ? '● ON' : pingLoading ? '…' : 'OFF' },
            ],
          }
        : {
            readouts: [
              { label: '읽는 중', value: booksReading, accent: true },
              { label: '완독', value: booksDone },
              { label: '독후감', value: local.books.filter((b) => b.review.trim()).length },
            ],
          },
    [mode, st.done, st.total, st.en, st.ko, online, pingLoading, booksReading, booksDone, local.books],
  );

  return (
    <section className={r.wrap} aria-label="읽을거리">
      {/* 세그먼트 — tablist 계약(화살표 이동·tabpanel 연결)을 이행하지 않으므로 role은 group +
          aria-pressed가 정직하다(언어 필터와 동일 패턴 · WCAG 4.1.2). */}
      <div className={r.seg} role="group" aria-label="읽을거리 모드">
        <button
          type="button"
          aria-pressed={mode === 'article'}
          className={mode === 'article' ? `${r.segBtn} ${r.segOn}` : r.segBtn}
          onClick={() => setMode('article')}
        >
          📰 지문 연습
        </button>
        <button
          type="button"
          aria-pressed={mode === 'book'}
          className={mode === 'book' ? `${r.segBtn} ${r.segOn}` : r.segBtn}
          onClick={() => setMode('book')}
        >
          📖 독서
        </button>
      </div>

      {mode === 'article' ? (
        <ArticlePractice
          articles={articles}
          work={local.work}
          setWork={setWork}
          online={online}
          pingLoading={pingLoading}
          loading={reads.isLoading}
          refetch={reads.refetch}
        />
      ) : (
        <BookShelf books={local.books} setBooks={setBooks} />
      )}
    </section>
  );
}
