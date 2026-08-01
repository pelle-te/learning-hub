/* ============================================================
   Reads(읽을거리) — 탭: 📰 읽을거리. 두 모드를 한 화면에서 세그먼트로 전환.
   ① 지문 연습 — 수집한 원문(영어=영어공부 / 한국어=어휘·요약 연습). 요약은 내가 직접 쓴다.
   ② 독서 — 책 읽고 직접 독후감(AI 없음). 둘 다 내 요약/독후감은 로컬-퍼스트 저장(lib/reads).
   지문 페치는 useReads(Query)·백엔드 상태는 usePing — 오프라인이어도 독서는 항상 동작.
============================================================ */
import { useCallback, useEffect, useState } from 'react';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { useReads } from '@/store/queries';
import { usePing } from '@/store/queries';
import { useCollectTool, useAutoCollect } from '@/hooks/useCollectTool';
import { todayISO } from '@/lib/utils';
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
import { Icon } from '@/components/Icon';

// 상단 세그먼트(지문/독서 토글) — 전역 button{} 과 다른 속성만 ! · 활성/비활성은 정적 분기(규약 4).
const SEG_BTN = 'rounded-md! border-none! px-5! py-2! text-base14! font-extrabold!';
const SEG_ON = 'bg-[image:var(--acc-fill)]! text-on-acc! shadow-seg-on';
const SEG_OFF = 'bg-transparent! text-mut!';

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
  const { data: ping, isLoading: pingLoading, refetch: refetchPing } = usePing();
  const online = !!ping?.ok;

  // E-1 크로스데이 자동갱신 — Markets와 동일 패턴. 탭 열 때 온라인인데 수집 데이터가 없거나 '오늘 것'이
  // 아니면 마운트당 1회 자동 수집(어제 지문이 조용히 남는 문제). 장중 갱신은 목록 헤더의 '수집' 버튼.
  // 오프라인이면 수집하지 않는다(!online 가드). 자동수집 이펙트는 useAutoCollect로 수렴(SR-13).
  // 이 단일 인스턴스가 collect/collecting의 SSOT — ArticlePractice(수동 '수집' 버튼·빈상태)에 prop으로 전달.
  const {
    collecting,
    collect,
    lastError: collectError,
  } = useCollectTool('reads-collect', reads.refetch, '읽을거리 수집 완료');
  const d = reads.data;
  const fresh = !!d && d.date === todayISO() && d.articles.length > 0;
  useAutoCollect(collect, { online, isLoading: reads.isLoading, collecting, fresh });

  const articles = reads.data?.articles ?? [];
  const st = articleStats(articles, local.work);
  const booksReading = local.books.filter((b) => b.status === 'reading').length;
  const booksDone = local.books.length - booksReading;

  // 신선도 — 수집 날짜가 오늘이 아니면 '지남' 배지(자동갱신 실패·오프라인 등으로 어제 지문일 때 표시).
  const collectedDate = reads.data?.date;
  const readsStale = !!collectedDate && collectedDate !== todayISO();
  const collectedMD = collectedDate ? collectedDate.slice(5).replace('-', '/') : '';

  // 리드아웃 — 모드별로 다른 지표를 상단 바에 주입.
  usePageChromeEffect(
    () =>
      mode === 'article'
        ? {
            /* W22 — destination 은 자기 값을 44px 로 말한다(원칙 ②). 기사 모드의 값 = 요약 진척.
               ⚠ 같은 수를 리드아웃에도 두지 않는다 — 첫 판이 그렇게 했다가 상단 바에 같은 양이
               두 번 떴다(한 양 = 한 자리 · Journal·Schedule 도 같은 실수를 함께 고쳤다). */
            primary: st.total > 0 ? { value: String(st.done), unit: `/${st.total}`, label: '요약 완료' } : null,
            readouts: [
              { label: '영어·한국어', value: `${st.en}·${st.ko}` },
              { label: '워크스페이스', value: online ? '● 연결됨' : pingLoading ? '…' : '미설정' },
              ...(collectedDate ? [{ label: '수집', value: readsStale ? `${collectedMD} · 지남` : collectedMD }] : []),
            ],
          }
        : {
            primary: { value: String(booksDone), unit: '권', label: '완독' },
            readouts: [
              { label: '읽는 중', value: booksReading, accent: true },
              { label: '독후감', value: local.books.filter((b) => b.review.trim()).length },
            ],
          },
    [
      mode,
      st.done,
      st.total,
      st.en,
      st.ko,
      online,
      pingLoading,
      booksReading,
      booksDone,
      local.books,
      collectedDate,
      readsStale,
      collectedMD,
    ],
  );

  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col px-6 pb-5 max-mobile:px-3.5 max-mobile:pb-3.5"
      aria-label="읽을거리"
    >
      {/* 세그먼트 — tablist 계약(화살표 이동·tabpanel 연결)을 이행하지 않으므로 role은 group +
          aria-pressed가 정직하다(언어 필터와 동일 패턴 · WCAG 4.1.2). */}
      <div
        className="mt-seg-y mb-4 inline-flex flex-none gap-1 self-center rounded-base border border-line bg-panel p-1"
        role="group"
        aria-label="읽을거리 모드"
      >
        <button
          type="button"
          aria-pressed={mode === 'article'}
          className={`${SEG_BTN} ${mode === 'article' ? SEG_ON : SEG_OFF}`}
          onClick={() => setMode('article')}
        >
          <Icon name="reads" /> 지문 연습
        </button>
        <button
          type="button"
          aria-pressed={mode === 'book'}
          className={`${SEG_BTN} ${mode === 'book' ? SEG_ON : SEG_OFF}`}
          onClick={() => setMode('book')}
        >
          <Icon name="book" /> 독서
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
          isError={reads.isError}
          errorMessage={reads.error instanceof Error ? reads.error.message : undefined}
          refetch={reads.refetch}
          refetchPing={refetchPing}
          collecting={collecting}
          collect={collect}
          collectError={collectError}
        />
      ) : (
        <BookShelf books={local.books} setBooks={setBooks} />
      )}
    </section>
  );
}
