/* ============================================================
   ArticlePractice — 지문 연습(읽을거리 ①). 수집 원문을 읽고 *내가 직접* 요약을 쓴다.
   영어 지문 = 영어 공부(원문 독해) / 한국어 지문 = 어휘력 + 요약 연습.
   원문은 절대 가공하지 않는다(요약은 사용자 몫). 왼쪽 목록 · 오른쪽 리더+내 요약 에디터.
   serve.js가 꺼져 있으면 우아 안내, 수집 0편이면 '수집 시작'(reads-collect 도구).
============================================================ */
import { useEffect, useMemo, useRef, useState } from 'react';
import ArtifactGate from '@/components/ArtifactGate';
import EmptyState from '@/components/EmptyState';
import { useCollectTool } from '@/components/useCollectTool';
import { Button } from '@/components/ui';
import { coachSummary, lookupVocab, previewFromJsonStream, type CoachFeedback, type VocabResult } from '@/lib/api';
import { ui } from '@/shell';
import { useApp } from '@/store/useApp';
import { addBacklog } from '@/lib/methodology';
import { backlogFromArticle } from '@/lib/promote';
import type { Article, ArticleWork } from '@/lib/reads';
import ds from '@/styles/ds.module.css';
import r from './Reads.module.css';

type Filter = 'all' | 'en' | 'ko';

interface VocabState {
  x: number;
  y: number;
  word: string;
  loading: boolean;
  result: VocabResult | null;
  error: string | null;
}

export default function ArticlePractice({
  articles,
  work,
  setWork,
  online,
  pingLoading,
  loading,
  isError,
  errorMessage,
  refetch,
  refetchPing,
}: {
  articles: Article[];
  work: Record<string, ArticleWork>;
  setWork: (id: string, w: ArticleWork) => void;
  online: boolean;
  pingLoading: boolean;
  /* 쿼리 표면 전체(UseQueryResult) 대신 필요한 조각만 — 데이터 레이어 누수 차단. */
  loading: boolean;
  isError: boolean;
  errorMessage?: string;
  refetch: () => Promise<unknown>;
  refetchPing: () => Promise<unknown>;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [selId, setSelId] = useState<string | null>(null);
  const mutate = useApp((s) => s.mutate);
  const { collecting, collect } = useCollectTool('reads-collect', refetch, '읽을거리 수집 완료');

  // B5 — '학습으로 보내기': 읽은 글을 보충 백로그(나중에 학습할 큐)로 승격. 소비→학습 루프를 닫는다.
  // 중복 승격 방지 — 이 세션에 이미 보낸 지문은 버튼을 '보냄'으로 잠근다(반복 클릭=중복 백로그).
  const [promoted, setPromoted] = useState<ReadonlySet<string>>(() => new Set());
  const promote = (a: Article) => {
    if (promoted.has(a.id)) return;
    const seed = backlogFromArticle(a);
    mutate((st) => addBacklog(st, '', seed.name, seed.topic, seed.note));
    setPromoted((prev) => new Set(prev).add(a.id));
    ui.toast('보충 백로그로 보냈어요 — 기록·오늘 탭에서 회수', 'ok');
  };

  // Ollama 코치(내 요약 채점) — serve.js/Ollama 필요. 원문 요약은 하지 않는다.
  // 결과에 지문 id를 태깅한다: 응답(수십 초)이 오기 전 다른 지문으로 옮기면
  // 옛 지문의 채점이 새 지문 아래 붙는 오표시(레이스)가 났었다 — 현재 지문일 때만 렌더.
  const [coachBusy, setCoachBusy] = useState(false);
  const [coachPreview, setCoachPreview] = useState('');
  const [coach, setCoach] = useState<{ id: string; fb: CoachFeedback } | null>(null);
  const coachAbort = useRef<AbortController | null>(null);
  // 채점 결과가 도착하면 결과 카드로 포커스를 옮긴다 — 전체를 role=status로 장황하게 읽지 않고
  // 간결히 '결과가 왔다'만 알린다(막 채점한 transient 결과일 때만; 지문 전환 시엔 옮기지 않음).
  const coachResultRef = useRef<HTMLDivElement>(null);
  // Ollama 어휘(선택한 단어 뜻) — 리더 위 팝오버.
  const [vocab, setVocab] = useState<VocabState | null>(null);
  const readerRef = useRef<HTMLDivElement>(null);

  const list = useMemo(
    () => (filter === 'all' ? articles : articles.filter((a) => a.lang === filter)),
    [articles, filter],
  );
  // 유효 선택 파생 — 저장 selId가 목록에 없으면(필터 변경·수집) 첫 지문으로(효과 없이 렌더에서 계산).
  const effId = selId && list.some((a) => a.id === selId) ? selId : (list[0]?.id ?? null);
  const sel = articles.find((a) => a.id === effId) ?? null;

  // 선택이 바뀌면 내 요약 초안을 work에서 로드 — 렌더 중 조건부 setState(React 권장; effect 아님).
  const [draftFor, setDraftFor] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  if (effId !== draftFor) {
    setDraftFor(effId);
    setDraft(effId ? (work[effId]?.summary ?? '') : '');
    setVocab(null);
  }
  // 지문이 바뀌거나 떠나면 진행 중 채점을 중단(생성 낭비 방지 — 오표시는 id 태깅이 이미 막는다).
  useEffect(() => () => coachAbort.current?.abort(), [effId]);

  const commit = (done?: boolean) => {
    if (!effId) return;
    const cur = work[effId];
    setWork(effId, {
      summary: draft,
      done: done ?? cur?.done ?? false,
      updatedAt: new Date().toISOString(),
    });
  };

  // 언마운트 안전망 — g키 라우트 이동 등 blur 없이 떠나면 미커밋 초안이 유실됐다.
  const flushRef = useRef<() => void>(() => {});
  flushRef.current = () => {
    if (!effId) return;
    const cur = work[effId];
    if ((cur?.summary ?? '') !== draft) {
      setWork(effId, { summary: draft, done: cur?.done ?? false, updatedAt: new Date().toISOString() });
    }
  };
  useEffect(() => () => flushRef.current(), []);

  // 채점이 방금 도착하면(현재 지문의 transient 결과) 결과 카드로 포커스 이동 — SR에 간결히 알림.
  useEffect(() => {
    if (coach && sel && coach.id === sel.id) coachResultRef.current?.focus();
  }, [coach, sel]);

  // 내 요약 채점 — 현재 초안을 원문과 대조(Ollama 스트리밍). 원문 요약은 시키지 않는다.
  const askCoach = async () => {
    if (!sel || coachBusy) return;
    if (!draft.trim()) {
      ui.toast('먼저 요약을 써 보세요.', 'warn');
      return;
    }
    const target = sel; // 요청 시점의 지문 고정 — 응답 도착 시점의 선택과 무관하게 태깅
    commit(); // 채점 전 현재 초안 저장
    setCoachBusy(true);
    setCoach(null);
    setCoachPreview('');
    const ac = new AbortController();
    coachAbort.current = ac;
    try {
      const res = await coachSummary(target.text, draft, target.lang, {
        signal: ac.signal,
        onDelta: (t) => setCoachPreview(previewFromJsonStream(t)),
      });
      if (res.ok && res.feedback) {
        setCoach({ id: target.id, fb: res.feedback });
        // 영속화 — 수십 초 걸린 채점을 이탈·새로고침에도 보존(레이스는 target 고정으로 이미 안전).
        const cur = work[target.id];
        setWork(target.id, {
          summary: cur?.summary ?? draft,
          done: cur?.done ?? false,
          updatedAt: new Date().toISOString(),
          coach: res.feedback,
          coachAt: new Date().toISOString(),
        });
      } else ui.toast(res.error || '채점 실패', 'bad');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') ui.toast('AI 채점 실패: ' + ((e as Error).message || e), 'bad');
    }
    setCoachBusy(false);
  };

  // 리더에서 단어/구를 선택하면 위치를 잡아 어휘 팝오버 준비(뜻은 버튼 눌러 조회).
  // pointerup — 마우스뿐 아니라 터치(long-press 선택)에서도 뜬다.
  const onReaderSelect = () => {
    const s = window.getSelection();
    const text = s?.toString().trim() ?? '';
    const host = readerRef.current;
    if (!s || !text || text.length > 60 || text.includes('\n') || !host || s.rangeCount === 0) {
      return;
    }
    const rect = s.getRangeAt(0).getBoundingClientRect();
    const box = host.getBoundingClientRect();
    if (!rect.width) return;
    // 팝오버는 translateX(-50%)라 문단 좌우 끝 단어에서 리더 밖으로 잘렸다 — x를 클램프.
    const rawX = rect.left - box.left + rect.width / 2;
    const x = Math.max(100, Math.min(rawX, Math.max(100, box.width - 100)));
    setVocab({
      x,
      y: rect.bottom - box.top + 6,
      word: text,
      loading: false,
      result: null,
      error: null,
    });
  };

  // 팝오버 닫기 — Esc + 바깥 클릭(기존엔 ✕ 또는 지문 전환뿐이었다).
  const vocabPopRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!vocab) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setVocab(null);
    };
    const onDown = (e: PointerEvent) => {
      if (vocabPopRef.current && !vocabPopRef.current.contains(e.target as Node)) setVocab(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [vocab]);

  const doVocab = async () => {
    if (!sel || !vocab) return;
    const reqWord = vocab.word; // 응답 도착 시 다른 단어가 선택돼 있으면 버린다(레이스 가드)
    setVocab({ ...vocab, loading: true, error: null });
    try {
      const res = await lookupVocab(reqWord, sel.text.slice(0, 600), sel.lang);
      setVocab((v) =>
        v && v.word === reqWord
          ? { ...v, loading: false, result: res.vocab ?? null, error: res.ok ? null : (res.error ?? '실패') }
          : v,
      );
    } catch (e) {
      setVocab((v) =>
        v && v.word === reqWord ? { ...v, loading: false, error: (e as Error).message || '조회 실패' } : v,
      );
    }
  };

  // ── 빈/오프라인 상태 ─────────────────────────────────────────
  if (!articles.length) {
    if (loading || pingLoading) {
      return (
        <div className={r.loading} role="status">
          지문 불러오는 중…
        </div>
      );
    }
    // serve.js는 켜져 있으나 아티팩트 쿼리가 실패(500·깨진 JSON 등) — '미수집'과 구분해 실제 오류를 노출.
    if (isError && online) {
      return (
        <div className={r.emptyHost}>
          <EmptyState
            glyph="⚠️"
            title="지문을 불러오지 못했어요"
            desc={<>serve.js는 켜져 있지만 응답에 문제가 있어요{errorMessage ? ` — ${errorMessage}` : '.'}</>}
            actions={
              <Button variant="primary" onClick={() => void refetch()}>
                다시 시도
              </Button>
            }
          />
        </div>
      );
    }
    return (
      <div className={r.emptyHost}>
        <ArtifactGate
          online={online}
          onRetry={() => {
            void refetchPing();
            void refetch();
          }}
          glyph="📰"
          offlineDesc={
            <>
              읽을거리 지문은 로컬 서버가 수집해요. 러닝허브 폴더에서 <code>node serve.js</code>로 켜면 내 RSS 피드에서
              원문을 가져옵니다. 피드 설정: <code>러닝허브/_읽을거리/feeds.json</code>
            </>
          }
          emptyTitle="아직 수집된 지문이 없어요"
          emptyDesc={
            <>
              내 RSS 피드에서 오늘의 칼럼·뉴스 원문을 가져올게요. 영어는 영어 공부, 한국어는 어휘력·요약 연습용 지문으로
              쌓입니다.
            </>
          }
          collecting={collecting}
          onCollect={() => void collect()}
          collectLabel="지문 수집 시작"
        />
      </div>
    );
  }

  const myWords = draft.trim() ? draft.trim().split(/\s+/).length : 0;

  return (
    <div className={r.cols}>
      {/* 왼쪽 — 지문 목록 + 필터 + 수집 */}
      <aside className={r.listPane}>
        <div className={r.listHead}>
          <div className={r.langFilter} role="group" aria-label="언어 필터">
            {(['all', 'en', 'ko'] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                className={filter === f ? `${r.langBtn} ${r.langOn}` : r.langBtn}
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? '전체' : f === 'en' ? 'EN' : 'KO'}
              </button>
            ))}
          </div>
          <Button
            sm
            onClick={() => void collect()}
            disabled={collecting || !online}
            title={online ? '새 지문 수집' : 'serve.js가 꺼져 있어요'}
          >
            {collecting ? <span className={ds.spin} /> : '↻'} 수집
          </Button>
        </div>
        <ul className={r.list}>
          {list.length ? (
            list.map((a) => {
              const w = work[a.id];
              const hasDraft = !w?.done && !!w?.summary?.trim();
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    className={a.id === effId ? `${r.listItem} ${r.itemOn}` : r.listItem}
                    onClick={() => setSelId(a.id)}
                    aria-current={a.id === effId}
                  >
                    <span className={r.itemTop}>
                      <span className={r.langTag} data-lang={a.lang}>
                        {a.lang === 'en' ? 'EN' : 'KO'}
                      </span>
                      <span className={r.itemField}>{a.field}</span>
                      {w?.done ? (
                        <span className={r.doneMark} title="요약 완료">
                          ✓
                        </span>
                      ) : hasDraft ? (
                        <span className={r.draftMark} title="작성 중인 초안 있음">
                          ✎
                        </span>
                      ) : null}
                    </span>
                    <span className={r.itemTitle}>{a.title}</span>
                    <span className={r.itemMeta}>
                      {a.source} · {a.words}
                      {a.lang === 'en' ? ' words' : '자'}
                    </span>
                  </button>
                </li>
              );
            })
          ) : (
            <li className={r.listEmpty}>이 언어의 지문이 없어요 — 필터를 바꾸거나 수집해 보세요.</li>
          )}
        </ul>
      </aside>

      {/* 오른쪽 — 리더(원문) + 내 요약 에디터 */}
      <div className={r.readerPane}>
        {sel ? (
          <>
            {/* lang — 영어 지문은 SR이 영어 음성으로 낭독하도록 부분 언어 전환(WCAG 3.1.2). */}
            <article className={r.reader} lang={sel.lang === 'en' ? 'en' : undefined}>
              <header className={r.readerHead}>
                <div className={r.readerMeta} lang="ko">
                  <span className={r.langTag} data-lang={sel.lang}>
                    {sel.lang === 'en' ? 'EN' : 'KO'}
                  </span>
                  {sel.field} · {sel.source}
                  <a
                    className={r.srcLink}
                    href={/^https?:\/\//i.test(sel.url) ? sel.url : undefined}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    원문 ↗
                  </a>
                </div>
                <h2 className={r.readerTitle}>{sel.title}</h2>
              </header>
              <div className={r.readerBody} ref={readerRef} onPointerUp={onReaderSelect}>
                {sel.text.split(/\n\n+/).map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
                {vocab && (
                  <div
                    className={r.vocabPop}
                    style={{ left: vocab.x, top: vocab.y }}
                    role="dialog"
                    aria-label="어휘 뜻"
                    lang="ko"
                    ref={vocabPopRef}
                  >
                    <div className={r.vocabHead}>
                      <b className={r.vocabWord}>{vocab.word}</b>
                      <button className={r.vocabClose} type="button" onClick={() => setVocab(null)} aria-label="닫기">
                        ✕
                      </button>
                    </div>
                    {sel.lang === 'ko' ? (
                      // 한국어 단어는 로컬 8B가 뜻을 부정확하게 내므로 국어사전 링크로(정확·즉시).
                      <a
                        className={r.vocabDict}
                        href={`https://ko.dict.naver.com/#/search?query=${encodeURIComponent(vocab.word)}`}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        📖 국어사전에서 보기 ↗
                      </a>
                    ) : vocab.loading ? (
                      <div className={r.vocabBody} role="status">
                        <span className={ds.spin} /> 뜻 찾는 중…
                      </div>
                    ) : vocab.error ? (
                      <div className={r.vocabBody} role="alert">
                        {vocab.error}
                      </div>
                    ) : vocab.result ? (
                      <div className={r.vocabBody} role="status">
                        {vocab.result.pos && <span className={r.vocabPos}>{vocab.result.pos}</span>}
                        <div className={r.vocabMean}>{vocab.result.meaning}</div>
                        {vocab.result.synonyms?.length ? (
                          <div className={r.vocabSyn}>유의어: {vocab.result.synonyms.join(', ')}</div>
                        ) : null}
                        {vocab.result.example && (
                          <div className={r.vocabEx}>
                            “{vocab.result.example}”
                            {vocab.result.example_ko ? (
                              <div className={r.vocabExKo}>{vocab.result.example_ko}</div>
                            ) : null}
                          </div>
                        )}
                        <a
                          className={r.vocabDictSm}
                          href={`https://en.dict.naver.com/#/search?query=${encodeURIComponent(vocab.word)}`}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          영어사전 ↗
                        </a>
                      </div>
                    ) : (
                      <button className={r.vocabGo} type="button" onClick={doVocab} disabled={!online}>
                        {online ? '🔍 뜻 보기' : 'serve.js 꺼짐'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </article>

            <div className={r.editor}>
              <div className={r.editorHead}>
                <span className={r.editorLabel}>
                  {sel.lang === 'en' ? '내 정리 (영어 공부 — 핵심 표현·해석)' : '내 요약 (직접 요약해 보기)'}
                </span>
                <span className={r.editorCount}>{myWords} 단어</span>
              </div>
              <textarea
                className={r.editorArea}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => commit()}
                placeholder={
                  sel.lang === 'en'
                    ? '모르는 단어·구문, 핵심 문장 해석, 이 글의 요지를 영어/한국어로 정리…'
                    : '이 글을 한두 문단으로 요약해 보세요. 핵심 주장과 근거를 내 말로…'
                }
                aria-label="내 요약"
              />
              <div className={r.editorActions}>
                <Button
                  sm
                  variant={work[sel.id]?.done ? 'default' : 'primary'}
                  onClick={() => commit(!work[sel.id]?.done)}
                >
                  {work[sel.id]?.done ? '✓ 완료됨 — 되돌리기' : '요약 완료로 표시'}
                </Button>
                <Button
                  sm
                  onClick={askCoach}
                  disabled={coachBusy || !online}
                  title={online ? '' : 'serve.js가 꺼져 있어요'}
                >
                  {coachBusy ? (
                    <>
                      <span className={ds.spin} /> 채점 중…
                    </>
                  ) : (
                    '🤖 AI 채점 받기'
                  )}
                </Button>
                <Button
                  sm
                  onClick={() => promote(sel)}
                  disabled={promoted.has(sel.id)}
                  title={promoted.has(sel.id) ? '이미 백로그로 보냈어요' : '보충 백로그로 보내기'}
                >
                  {promoted.has(sel.id) ? '✓ 보냄' : '📥 학습으로 보내기'}
                </Button>
              </div>

              {/* 진행 상태만 간결히 공지(sr-only) — 스트리밍 토큰은 장황해 읽지 않는다. */}
              {coachBusy && (
                <span
                  role="status"
                  style={{
                    position: 'absolute',
                    width: 1,
                    height: 1,
                    overflow: 'hidden',
                    clip: 'rect(0 0 0 0)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  채점 중…
                </span>
              )}

              {/* 채점 스트리밍 미리보기 — 완성 문장부터 타이핑되듯(SR에는 위 상태만 공지). */}
              {coachBusy && coachPreview && (
                <p className={r.coachStream} aria-hidden="true">
                  {coachPreview}
                </p>
              )}

              {/* 결과는 그 지문의 것만 — 방금 채점(transient, 늦게 온 응답 오표시 방지)이 우선,
                  없으면 저장된 채점(work[id].coach)을 폴백해 이탈·새로고침 후에도 보인다. */}
              {(() => {
                const fb = coach && coach.id === sel.id ? coach.fb : work[sel.id]?.coach;
                const savedAt = coach && coach.id === sel.id ? undefined : work[sel.id]?.coachAt;
                if (!fb) return null;
                return (
                  <div className={r.coach} ref={coachResultRef} tabIndex={-1} aria-label="AI 채점 결과">
                    <div className={r.coachTop}>
                      {typeof fb.score === 'number' && (
                        <span className={r.coachScore} data-good={fb.score >= 70}>
                          {fb.score}점
                        </span>
                      )}
                      {fb.comment && <span className={r.coachComment}>{fb.comment}</span>}
                      {savedAt && (
                        <span className={`${ds.muted} ${ds.tiny}`} style={{ marginLeft: 'auto' }}>
                          저장된 채점
                        </span>
                      )}
                    </div>
                    {fb.missing?.length ? <CoachList label="빠진 핵심" items={fb.missing} tone="miss" /> : null}
                    {fb.redundant?.length ? <CoachList label="군더더기" items={fb.redundant} tone="mut" /> : null}
                    {fb.accuracy?.length ? <CoachList label="정확성" items={fb.accuracy} tone="bad" /> : null}
                    {fb.corrections?.length ? <CoachList label="바로잡기" items={fb.corrections} tone="bad" /> : null}
                    {fb.key_expressions?.length ? (
                      <CoachList
                        label="핵심 표현"
                        items={fb.key_expressions.map((k) => `${k.en} — ${k.ko}`)}
                        tone="mut"
                      />
                    ) : null}
                    {fb.model_summary && (
                      <div className={r.coachModel}>
                        <span className={r.coachModelLabel}>모범 요약</span>
                        {fb.model_summary}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </>
        ) : (
          <div className={r.loading}>왼쪽에서 지문을 선택하세요.</div>
        )}
      </div>
    </div>
  );
}

/** 코치 피드백 항목 묶음(빠진 핵심·군더더기·정확성 등). */
function CoachList({ label, items, tone }: { label: string; items: string[]; tone: 'miss' | 'bad' | 'mut' }) {
  return (
    <div className={r.coachGroup}>
      <span className={r.coachLabel} data-tone={tone}>
        {label}
      </span>
      <ul className={r.coachItems}>
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}
