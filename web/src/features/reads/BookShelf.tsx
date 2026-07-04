/* ============================================================
   BookShelf — 독서(읽을거리 ②). 책 읽고 *직접* 독후감을 쓴다. AI 없음·로컬 저장.
   왼쪽 책 목록(추가·읽는 중/완독) · 오른쪽 선택한 책의 독후감 에디터 + 별점 + 상태.
============================================================ */
import { useState } from 'react';
import EmptyState from '@/components/EmptyState';
import { Button } from '@/components/ui';
import { ui } from '@/shell';
import { newBook, type Book } from '@/lib/reads';
import r from './Reads.module.css';

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
    <div className={r.cols}>
      {/* 왼쪽 — 추가 + 책 목록 */}
      <aside className={r.listPane}>
        <div className={r.addBox}>
          <input
            className={r.addInput}
            placeholder="책 제목"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add();
            }}
            aria-label="책 제목"
          />
          <input
            className={r.addInput}
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
          <div className={r.bookFilter} role="group" aria-label="독서 상태 필터">
            {(['all', 'reading', 'done'] as const).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={statusFilter === f}
                className={statusFilter === f ? `${r.bookFilterBtn} ${r.bookFilterOn}` : r.bookFilterBtn}
                onClick={() => setStatusFilter(f)}
              >
                {f === 'all' ? '전체' : f === 'reading' ? '읽는 중' : '완독'}
              </button>
            ))}
          </div>
        )}
        {books.length ? (
          shown.length ? (
            <ul className={r.list}>
              {shown.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    className={b.id === effId ? `${r.listItem} ${r.itemOn}` : r.listItem}
                    onClick={() => setSelId(b.id)}
                    aria-current={b.id === effId}
                  >
                    <span className={r.itemTop}>
                      <span className={r.statusTag} data-done={b.status === 'done'}>
                        {b.status === 'done' ? '완독' : '읽는 중'}
                      </span>
                      {b.rating > 0 && <span className={r.stars}>{'★'.repeat(b.rating)}</span>}
                      {b.review.trim() && (
                        <span className={r.doneMark} title="독후감 있음">
                          ✎
                        </span>
                      )}
                    </span>
                    <span className={r.itemTitle}>{b.title}</span>
                    <span className={r.itemMeta}>
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
            <div className={r.listEmpty}>이 상태의 책이 없어요.</div>
          )
        ) : (
          <div className={r.listEmpty}>왼쪽 위에서 첫 책을 추가해 보세요.</div>
        )}
      </aside>

      {/* 오른쪽 — 독후감 에디터 */}
      <div className={r.readerPane}>
        {sel ? (
          <div className={r.bookEditor}>
            <header className={r.bookHead}>
              <h2 className={r.readerTitle}>{sel.title}</h2>
              <div className={r.readerMeta}>
                {sel.author ? sel.author + ' · ' : ''}
                시작 {shortDate(sel.startedAt) || '—'}
                {sel.status === 'done' && shortDate(sel.finishedAt) ? ` · 완독 ${shortDate(sel.finishedAt)}` : ''}
              </div>
              <div className={r.bookControls}>
                <div className={r.rating} role="group" aria-label="별점">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={r.star}
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
            <div className={r.editorHead}>
              <span className={r.editorLabel}>독후감</span>
              <span className={r.editorCount}>{draft.trim() ? draft.trim().length : 0}자</span>
            </div>
            <textarea
              className={`${r.editorArea} ${r.bookArea}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitReview}
              placeholder="이 책에서 무엇을 배웠나요? 기억에 남는 문장, 내 생각, 적용할 점을 자유롭게…"
              aria-label="독후감"
            />
          </div>
        ) : (
          <div className={r.emptyHost}>
            <EmptyState
              glyph="📖"
              title="독서 기록을 시작해 보세요"
              desc="읽은 책을 추가하고 독후감을 남기면, 무엇을 읽고 무엇을 얻었는지가 쌓입니다."
            />
          </div>
        )}
      </div>
    </div>
  );
}
