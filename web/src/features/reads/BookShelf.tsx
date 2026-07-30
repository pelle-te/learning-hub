/* ============================================================
   BookShelf — 독서(읽을거리 ②). 책 읽고 *직접* 독후감을 쓴다. AI 없음·로컬 저장.
   왼쪽 책 목록(추가·읽는 중/완독) · 오른쪽 선택한 책의 독후감 에디터 + 별점 + 상태.
============================================================ */
import { useState } from 'react';
import State from '@/components/State';
import { Button } from '@/components/ui';
import { ui } from '@/shell';
import { useFlushOnUnmount } from '@/hooks/interactions';
import { newBook, type Book } from '@/lib/reads';

// 공유 셸 클래스(§15 부칙 · 상태색은 정적 분기로 자식에 직접). 전역 input{}/button{} 과 다른 속성만 !.
const ADD_INPUT = 'rounded-md! bg-panel! px-3! py-2.25! text-base14!';
// 책 목록 항목(button) — 테두리/배경은 선택 여부로 정적 분기(base+active 동시 지정 시 no-conflicting 회피).
const LIST_ITEM = 'w-full flex flex-col gap-1 text-left rounded-base! py-2.75!';
// 독서 상태 필터(button) — 테두리/배경/색은 global button{} 이 주는 line/panel2/txt 위에 활성만 얹는다.
// ⚠ leading-[normal]: preflight 미탑재 → button 은 UA line-height:normal(body 1.6 미상속). 원본
// 필터 버튼은 명시 line-height 없이 normal 로 렌더됐다 — 1.6 고정 시 ~1px 밀려 dark 스냅샷 깨짐.
const BOOK_FILTER_BTN = 'flex-1 px-2! py-1! text-xs! leading-[normal]! font-semibold!';

/** ISO 일시 → 'M/D'(없으면 ''). 독서 시작·완독일 표기용. */
function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function BookShelf({ books, setBooks }: { books: Book[]; setBooks: (b: Book[]) => void }) {
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [selId, setSelId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'reading' | 'done'>('all');
  const shown = statusFilter === 'all' ? books : books.filter((b) => b.status === statusFilter);

  // 유효 선택 파생 — 저장 selId가 목록에 없으면 첫 책으로(효과 없이 렌더에서 계산).
  const effId = selId && books.some((b) => b.id === selId) ? selId : (books[0]?.id ?? null);
  const sel = books.find((b) => b.id === effId) ?? null;

  // 선택이 바뀌면 독후감 초안 로드 — 렌더 중 조건부 setState(React 권장; effect 아님).
  const [draftFor, setDraftFor] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  if (effId !== draftFor) {
    setDraftFor(effId);
    setDraft(effId ? (books.find((b) => b.id === effId)?.review ?? '') : '');
  }

  const patch = (id: string, fields: Partial<Book>) =>
    setBooks(books.map((b) => (b.id === id ? { ...b, ...fields } : b)));

  const add = () => {
    const t = title.trim();
    if (!t) {
      ui.toast('책 제목을 입력하세요.', 'warn');
      return;
    }
    const b = newBook(t, author);
    setBooks([b, ...books]);
    setSelId(b.id);
    setTitle('');
    setAuthor('');
  };

  const commitReview = () => {
    if (effId) patch(effId, { review: draft });
  };

  // 언마운트 안전망 — g키 라우트 이동·모드 전환 등 blur 없이 떠나면 미커밋 독후감 초안이 유실됐다(SR-16 통일).
  useFlushOnUnmount(() => {
    if (!effId) return;
    const cur = books.find((b) => b.id === effId);
    if ((cur?.review ?? '') !== draft) patch(effId, { review: draft });
  });

  const toggleStatus = (b: Book) =>
    patch(b.id, {
      status: b.status === 'done' ? 'reading' : 'done',
      finishedAt: b.status === 'done' ? null : new Date().toISOString(),
    });

  const remove = async (b: Book) => {
    if (await ui.confirm(`"${b.title}"을(를) 삭제할까요? 독후감도 함께 지워집니다.`)) {
      setBooks(books.filter((x) => x.id !== b.id));
    }
  };

  return (
    <div className="grid min-h-0 flex-1 grid-cols-reads gap-4.5 max-mobile:grid-cols-1 max-mobile:grid-rows-[auto_1fr] max-mobile:overflow-y-auto">
      {/* 왼쪽 — 추가 + 책 목록 */}
      <aside className="flex min-h-0 flex-col gap-2.5">
        <div className="flex flex-none flex-col gap-1.75 border-b border-line2 pb-2.5">
          <input
            className={ADD_INPUT}
            placeholder="책 제목"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add();
            }}
            aria-label="책 제목"
          />
          <input
            className={ADD_INPUT}
            placeholder="저자(선택)"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add();
            }}
            aria-label="저자"
          />
          <Button sm variant="primary" onClick={add}>
            + 책 추가
          </Button>
        </div>
        {books.length > 0 && (
          <div className="mb-2 flex gap-1" role="group" aria-label="독서 상태 필터">
            {(['all', 'reading', 'done'] as const).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={statusFilter === f}
                className={`${BOOK_FILTER_BTN} ${statusFilter === f ? 'border-line-acc-mid! bg-tint-acc-panel2! text-txt!' : 'text-mut!'}`}
                onClick={() => setStatusFilter(f)}
              >
                {f === 'all' ? '전체' : f === 'reading' ? '읽는 중' : '완독'}
              </button>
            ))}
          </div>
        )}
        {books.length ? (
          shown.length ? (
            <ul className="m-0 flex min-h-0 flex-1 [scrollbar-width:thin] list-none flex-col gap-1.5 overflow-y-auto p-0 max-mobile:max-h-[var(--reads-list-vh)]">
              {shown.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    className={`${LIST_ITEM} ${b.id === effId ? 'border-acc! bg-acc-soft!' : 'bg-panel!'}`}
                    onClick={() => setSelId(b.id)}
                    aria-current={b.id === effId}
                  >
                    <span className="flex items-center gap-1.75">
                      <span
                        className={`flex-none rounded-sm px-1.75 py-px text-2xs font-extrabold ${
                          b.status === 'done' ? 'bg-good text-on-acc' : 'bg-line2 text-mut'
                        }`}
                      >
                        {b.status === 'done' ? '완독' : '읽는 중'}
                      </span>
                      {b.rating > 0 && (
                        <span className="text-xs leading-[normal] tracking-star text-learning">
                          {'★'.repeat(b.rating)}
                        </span>
                      )}
                      {b.review.trim() && (
                        <span className="ml-auto text-sm leading-[normal] font-black text-good" title="독후감 있음">
                          ✎
                        </span>
                      )}
                    </span>
                    <span className="line-clamp-2 text-base14 leading-[1.35] font-bold text-txt">{b.title}</span>
                    <span className="text-xs leading-[normal] text-mut tabular-nums">
                      {b.author ? `${b.author} · ` : ''}
                      {b.status === 'done' && shortDate(b.finishedAt)
                        ? `완독 ${shortDate(b.finishedAt)}`
                        : shortDate(b.startedAt)
                          ? `시작 ${shortDate(b.startedAt)}`
                          : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-3 py-4.5 text-center text-md text-mut">이 상태의 책이 없어요.</div>
          )
        ) : (
          <div className="px-3 py-4.5 text-center text-md text-mut">왼쪽 위에서 첫 책을 추가해 보세요.</div>
        )}
      </aside>

      {/* 오른쪽 — 독후감 에디터 */}
      <div className="flex min-h-0 min-w-0 flex-col">
        {sel ? (
          <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-line bg-panel px-5.5 py-5">
            <header className="mb-3 flex-none border-b border-line2 pb-3.5">
              <h2 className="m-0! text-reader-title! leading-[1.28] font-black! tracking-title!">{sel.title}</h2>
              <div className="mb-2 flex items-center gap-2 text-sm leading-[1.6] font-bold text-mut">
                {sel.author ? sel.author + ' · ' : ''}
                시작 {shortDate(sel.startedAt) || '—'}
                {sel.status === 'done' && shortDate(sel.finishedAt) ? ` · 완독 ${shortDate(sel.finishedAt)}` : ''}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2.5">
                <div className="inline-flex" role="group" aria-label="별점">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className="border-none! bg-transparent! px-px! py-0! text-xl! leading-none! text-learning!"
                      aria-label={`별점 ${n}`}
                      aria-pressed={sel.rating >= n}
                      onClick={() => patch(sel.id, { rating: sel.rating === n ? 0 : n })}
                    >
                      {sel.rating >= n ? '★' : '☆'}
                    </button>
                  ))}
                </div>
                <Button sm variant={sel.status === 'done' ? 'default' : 'primary'} onClick={() => toggleStatus(sel)}>
                  {sel.status === 'done' ? '읽는 중으로' : '완독으로 표시'}
                </Button>
                <Button sm danger onClick={() => remove(sel)}>
                  삭제
                </Button>
              </div>
            </header>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-sm leading-[1.6] font-extrabold tracking-editor text-acc">독후감</span>
              <span className="text-xs leading-[1.6] text-mut tabular-nums">
                {draft.trim() ? draft.trim().length : 0}자
              </span>
            </div>
            <textarea
              className="min-h-35 flex-1 resize-y rounded-md! bg-bg! px-3.25! py-2.75! text-base14! leading-[1.6]!"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitReview}
              placeholder="이 책에서 무엇을 배웠나요? 기억에 남는 문장, 내 생각, 적용할 점을 자유롭게…"
              aria-label="독후감"
            />
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 place-items-center p-6">
            <State
              glyph="📖"
              title="독서 기록을 시작해 보세요"
              desc="읽은 책을 추가하고 독후감을 남기면, 무엇을 읽고 무엇을 얻었는지가 쌓입니다."
              /* 추가 폼은 같은 화면 왼쪽 위에 있다 — 중복 CTA 대신 위치를 가리킨다(Control 과 같은 판단). */
              next={{ terminal: '← 왼쪽 위 "＋ 책 추가"로 첫 책을 담아 보세요.' }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
