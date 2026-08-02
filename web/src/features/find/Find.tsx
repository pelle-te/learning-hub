/* ============================================================
   Find — **T-25 검색 화면**(`/find`). `guide` 은퇴의 짝.

   ## 왜 매뉴얼이 아니라 검색인가

   `guide` 는 347줄 **정적 매뉴얼**이었고 레일 한 칸을 상시 썼다. 그런데 이 앱에서 사람이 실제로
   찾는 것은 **탭 이름이 아니라 내용**이다 — "회로 3장이 어디 있더라", "그 보충 뭐였지". 매뉴얼은
   그 질문에 답하지 못하고, 답할 수 있는 것(⌘K)은 **떠 있는 동안만** 존재해 훑어보기가 안 된다.

   ## ⌘K 와 무엇이 다른가 — **머무를 수 있다**

   팔레트는 고르면 닫힌다. 그래서 "여러 개를 훑고 비교한다"가 안 되고, 뒤로 왔다 갔다 하면
   검색어를 매번 다시 친다. 이 화면은 URL 을 갖고(`?q=`) 결과가 **남아 있는다** — 같은 `lib`
   (`contentSearch`)를 쓰므로 **판정은 한 벌**이고, 달라지는 것은 수명뿐이다.

   ## ⚠ 여기서 검색 규칙을 새로 만들지 않는다

   `contentSearch` 가 이미 객체 6종(과목·챕터·책·보충·약점·오답)을 인덱싱한다. 여기서 자체
   필터를 짜면 팔레트와 이 화면이 **같은 질의에 다르게 답하고**, 그때 어느 쪽이 규칙인지 말할 수
   없다. 늘어난 것은 결과 개수 상한 하나뿐이다(화면이 넓으니 더 보여 준다).
============================================================ */
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '@/store/useApp';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { contentSearch, type ContentHit } from '@/lib/contentSearch';
import { loadReads } from '@/lib/reads';
import { destinations } from '@/shell';
import State from '@/components/State';
import { Button, Pill } from '@/components/ui';

/** 화면이 넓으니 팔레트(8)보다 많이 보여 준다 — **유일하게 다른 값**이다(머리주석). */
const LIMIT = 40;

const KIND_LABEL: Record<ContentHit['kind'], string> = {
  subject: '과목',
  chapter: '챕터',
  book: '읽을거리',
  backlog: '보충',
  weak: '약점',
  mistake: '오답',
};

export default function Find() {
  const state = useApp((s) => s.state);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const q = params.get('q') ?? '';

  const reads = useMemo(() => loadReads(), []);
  const hits = useMemo(() => (q.trim() ? contentSearch(q, state, reads, LIMIT) : []), [q, state, reads]);
  /* 화면 이름도 함께 찾는다 — 내용이 주(主)지만 "그 탭 이름이 뭐였지"도 실재하는 질문이다.
     ⚠ 은퇴한 화면은 여기 안 나온다(`destinations()` 가 이미 걸러 준다 · Q-22). */
  const screens = useMemo(
    () => (q.trim() ? destinations().filter((t) => t.label.toLowerCase().includes(q.trim().toLowerCase())) : []),
    [q],
  );

  usePageChromeEffect(
    () => ({
      primary: null, // 렌즈다 — 44px 앵커를 세우지 않는다(잊은 것이 아니라 없다고 정한 것)
      readouts: q.trim() ? [{ label: '결과', value: hits.length + screens.length }] : [],
    }),
    [q, hits.length, screens.length],
  );

  return (
    <div className="flex h-full flex-col gap-3.5 p-6">
      <div className="ds-fld flex-none">
        <label htmlFor="find-q">무엇을 찾나요</label>
        <input
          id="find-q"
          type="search"
          value={q}
          /* ⚠ `autoFocus` 는 린트가 (옳게) 막는다 — 스크린리더 사용자를 화면 중간으로 순간이동
             시킨다. 이 화면은 ⌘K 와 달리 **머무는** 곳이라 자동 포커스의 이득도 작다. */
          placeholder="과목·챕터·보충·약점·오답·읽을거리"
          onChange={(e) => setParams(e.target.value ? { q: e.target.value } : {}, { replace: true })}
        />
      </div>

      {!q.trim() ? (
        <State
          kind="empty"
          glyph="search"
          title="내용으로 찾습니다"
          desc="탭 이름이 아니라 과목·챕터·보충·약점·오답·읽을거리를 직접 찾아요. ⌘K 와 같은 규칙이지만, 여기선 결과가 남아 있어 여러 개를 훑을 수 있습니다."
          next={{ terminal: '위 칸에 한 단어만 넣어 보세요.' }}
        />
      ) : hits.length + screens.length === 0 ? (
        <State
          kind="empty"
          glyph="search"
          title={`“${q}” 에 걸리는 것이 없어요`}
          desc="더 짧은 단어로 줄여 보세요 — 부분 일치로 찾습니다."
          next={{ terminal: '검색어를 줄여 보세요.' }}
        />
      ) : (
        <ul className="m-0 flex min-h-0 flex-1 [scrollbar-width:thin] list-none flex-col gap-1.5 overflow-y-auto p-0">
          {screens.map((t) => (
            <li key={`s-${t.key}`}>
              <Button variant="ghost" className="w-full justify-start!" onClick={() => navigate('/' + t.key)}>
                <Pill tiny>화면</Pill>
                <span className="ml-2">{t.label}</span>
              </Button>
            </li>
          ))}
          {hits.map((h) => (
            <li key={h.id}>
              <Button variant="ghost" className="w-full justify-start!" onClick={() => navigate(h.to)}>
                <Pill tiny>{KIND_LABEL[h.kind]}</Pill>
                <span className="ml-2 min-w-0 truncate">{h.label}</span>
                {h.subject && <span className="ds-tiny ml-auto text-mut">{h.subject}</span>}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
