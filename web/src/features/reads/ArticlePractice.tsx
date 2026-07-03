/* ============================================================
   ArticlePractice — 지문 연습(읽을거리 ①). 수집 원문을 읽고 *내가 직접* 요약을 쓴다.
   영어 지문 = 영어 공부(원문 독해) / 한국어 지문 = 어휘력 + 요약 연습.
   원문은 절대 가공하지 않는다(요약은 사용자 몫). 왼쪽 목록 · 오른쪽 리더+내 요약 에디터.
   serve.js가 꺼져 있으면 우아 안내, 수집 0편이면 '수집 시작'(reads-collect 도구).
============================================================ */
import { useMemo, useRef, useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import EmptyState from '@/components/EmptyState';
import { Button } from '@/components/ui';
import { runTool, coachSummary, lookupVocab, type CoachFeedback, type VocabResult } from '@/lib/api';
import { ui } from '@/shell';
import type { Article, ArticleWork, ReadsArtifact } from '@/lib/reads';
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
  query,
}: {
  articles: Article[];
  work: Record<string, ArticleWork>;
  setWork: (id: string, w: ArticleWork) => void;
  online: boolean;
  pingLoading: boolean;
  query: UseQueryResult<ReadsArtifact>;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [selId, setSelId] = useState<string | null>(null);
  const [collecting, setCollecting] = useState(false);

  // Ollama 코치(내 요약 채점) — serve.js/Ollama 필요. 원문 요약은 하지 않는다.
  const [coachBusy, setCoachBusy] = useState(false);
  const [coach, setCoach] = useState<CoachFeedback | null>(null);
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
    setCoach(null); // 지문 바뀌면 이전 채점 결과 감춤
    setVocab(null);
  }

  const commit = (done?: boolean) => {
    if (!effId) return;
    const cur = work[effId];
    setWork(effId, {
      summary: draft,
      done: done ?? cur?.done ?? false,
      updatedAt: new Date().toISOString(),
    });
  };

  const collect = async () => {
    if (collecting) return;
    setCollecting(true);
    try {
      const res = await runTool('reads-collect', {});
      if (res.ok) {
        await query.refetch();
        ui.toast('읽을거리 수집 완료', 'ok');
      } else {
        ui.toast('수집 실패 — serve.js 출력 확인', 'bad');
      }
    } catch (e) {
      ui.toast('수집 요청 실패: ' + ((e as Error).message || e), 'bad');
    }
    setCollecting(false);
  };

  // 내 요약 채점 — 현재 초안을 원문과 대조(Ollama). 원문 요약은 시키지 않는다.
  const askCoach = async () => {
    if (!sel || coachBusy) return;
    if (!draft.trim()) {
      ui.toast('먼저 요약을 써 보세요.', 'warn');
      return;
    }
    commit(); // 채점 전 현재 초안 저장
    setCoachBusy(true);
    setCoach(null);
    try {
      const res = await coachSummary(sel.text, draft, sel.lang);
      if (res.ok && res.feedback) setCoach(res.feedback);
      else ui.toast(res.error || '채점 실패', 'bad');
    } catch (e) {
      ui.toast('AI 채점 실패: ' + ((e as Error).message || e), 'bad');
    }
    setCoachBusy(false);
  };

  // 리더에서 단어/구를 선택하면 위치를 잡아 어휘 팝오버 준비(뜻은 버튼 눌러 조회).
  const onReaderMouseUp = () => {
    const s = window.getSelection();
    const text = s?.toString().trim() ?? '';
    const host = readerRef.current;
    if (!s || !text || text.length > 60 || text.includes('\n') || !host || s.rangeCount === 0) {
      return;
    }
    const rect = s.getRangeAt(0).getBoundingClientRect();
    const box = host.getBoundingClientRect();
    if (!rect.width) return;
    setVocab({
      x: rect.left - box.left + rect.width / 2,
      y: rect.bottom - box.top + 6,
      word: text,
      loading: false,
      result: null,
      error: null,
    });
  };

  const doVocab = async () => {
    if (!sel || !vocab) return;
    setVocab({ ...vocab, loading: true, error: null });
    try {
      const res = await lookupVocab(vocab.word, sel.text.slice(0, 600), sel.lang);
      setVocab((v) =>
        v ? { ...v, loading: false, result: res.vocab ?? null, error: res.ok ? null : (res.error ?? '실패') } : v,
      );
    } catch (e) {
      setVocab((v) => (v ? { ...v, loading: false, error: (e as Error).message || '조회 실패' } : v));
    }
  };

  // ── 빈/오프라인 상태 ─────────────────────────────────────────
  if (!articles.length) {
    if (query.isLoading || pingLoading) {
      return <div className={r.loading}>지문 불러오는 중…</div>;
    }
    if (!online) {
      return (
        <div className={r.emptyHost}>
          <EmptyState
            glyph="📰"
            title="serve.js가 꺼져 있어요"
            desc={
              <>
                읽을거리 지문은 로컬 서버가 수집해요. 러닝허브 폴더에서 <code>node serve.js</code>로 켜면 내 RSS
                피드에서 원문을 가져옵니다. 피드 설정: <code>러닝허브/_읽을거리/feeds.json</code>
              </>
            }
          />
        </div>
      );
    }
    return (
      <div className={r.emptyHost}>
        <EmptyState
          glyph="📰"
          title="아직 수집된 지문이 없어요"
          desc={
            <>
              내 RSS 피드에서 오늘의 칼럼·뉴스 원문을 가져올게요. 영어는 영어 공부, 한국어는 어휘력·요약 연습용 지문으로
              쌓입니다.
            </>
          }
          actions={
            <Button variant="primary" onClick={collect} disabled={collecting}>
              {collecting ? (
                <>
                  <span className={ds.spin} /> 수집 중…
                </>
              ) : (
                '지문 수집 시작'
              )}
            </Button>
          }
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
          <button
            type="button"
            className={r.collectBtn}
            onClick={collect}
            disabled={collecting || !online}
            title={online ? '새 지문 수집' : 'serve.js가 꺼져 있어요'}
          >
            {collecting ? <span className={ds.spin} /> : '↻'} 수집
          </button>
        </div>
        <ul className={r.list}>
          {list.map((a) => {
            const w = work[a.id];
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
                    {w?.done && (
                      <span className={r.doneMark} title="요약 완료">
                        ✓
                      </span>
                    )}
                  </span>
                  <span className={r.itemTitle}>{a.title}</span>
                  <span className={r.itemMeta}>
                    {a.source} · {a.words}
                    {a.lang === 'en' ? ' words' : '자'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* 오른쪽 — 리더(원문) + 내 요약 에디터 */}
      <div className={r.readerPane}>
        {sel ? (
          <>
            <article className={r.reader}>
              <header className={r.readerHead}>
                <div className={r.readerMeta}>
                  <span className={r.langTag} data-lang={sel.lang}>
                    {sel.lang === 'en' ? 'EN' : 'KO'}
                  </span>
                  {sel.field} · {sel.source}
                  <a className={r.srcLink} href={sel.url} target="_blank" rel="noreferrer noopener">
                    원문 ↗
                  </a>
                </div>
                <h2 className={r.readerTitle}>{sel.title}</h2>
              </header>
              <div className={r.readerBody} ref={readerRef} onMouseUp={onReaderMouseUp}>
                {sel.text.split(/\n\n+/).map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
                {vocab && (
                  <div
                    className={r.vocabPop}
                    style={{ left: vocab.x, top: vocab.y }}
                    role="dialog"
                    aria-label="어휘 뜻"
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
                      <div className={r.vocabBody}>
                        <span className={ds.spin} /> 뜻 찾는 중…
                      </div>
                    ) : vocab.error ? (
                      <div className={r.vocabBody}>{vocab.error}</div>
                    ) : vocab.result ? (
                      <div className={r.vocabBody}>
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
              </div>

              {coach && (
                <div className={r.coach}>
                  <div className={r.coachTop}>
                    {typeof coach.score === 'number' && (
                      <span className={r.coachScore} data-good={coach.score >= 70}>
                        {coach.score}점
                      </span>
                    )}
                    {coach.comment && <span className={r.coachComment}>{coach.comment}</span>}
                  </div>
                  {coach.missing?.length ? <CoachList label="빠진 핵심" items={coach.missing} tone="miss" /> : null}
                  {coach.redundant?.length ? <CoachList label="군더더기" items={coach.redundant} tone="mut" /> : null}
                  {coach.accuracy?.length ? <CoachList label="정확성" items={coach.accuracy} tone="bad" /> : null}
                  {coach.corrections?.length ? (
                    <CoachList label="바로잡기" items={coach.corrections} tone="bad" />
                  ) : null}
                  {coach.key_expressions?.length ? (
                    <CoachList
                      label="핵심 표현"
                      items={coach.key_expressions.map((k) => `${k.en} — ${k.ko}`)}
                      tone="mut"
                    />
                  ) : null}
                  {coach.model_summary && (
                    <div className={r.coachModel}>
                      <span className={r.coachModelLabel}>모범 요약</span>
                      {coach.model_summary}
                    </div>
                  )}
                </div>
              )}
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
