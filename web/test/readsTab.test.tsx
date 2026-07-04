// @vitest-environment jsdom
/* ============================================================
   readsTab.test.tsx — 읽을거리 탭. 독서(오프라인 로컬)와 지문 연습(스텁 서버)·AI 채점 경로.
============================================================ */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ThemeProvider from '@/app/ThemeProvider';
import App from '@/app/App';

function renderApp(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function jsonRes(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body };
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('독서: 책 추가·별점·독후감·상태 토글이 로컬에 저장된다(오프라인)', async () => {
  renderApp('/reads');

  // 독서 모드로 전환
  fireEvent.click(await screen.findByRole('button', { name: /독서/ })); // 세그먼트 group+aria-pressed 정직화

  fireEvent.change(await screen.findByLabelText('책 제목'), { target: { value: '사피엔스' } });
  fireEvent.change(screen.getByLabelText('저자'), { target: { value: '유발 하라리' } });
  fireEvent.click(screen.getByRole('button', { name: '+ 책 추가' }));

  // 목록·에디터에 반영
  await waitFor(() => expect(screen.getByRole('heading', { name: '사피엔스' })).toBeInTheDocument());

  // 별점 3
  fireEvent.click(screen.getByLabelText('별점 3'));
  // 독후감 작성 + blur 저장
  const ta = screen.getByLabelText('독후감');
  fireEvent.change(ta, { target: { value: '인류사를 관통하는 통찰.' } });
  fireEvent.blur(ta);
  // 완독 토글
  fireEvent.click(screen.getByRole('button', { name: '완독으로 표시' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '읽는 중으로' })).toBeInTheDocument());

  // 로컬 저장 검증
  const saved = JSON.parse(localStorage.getItem('lh:reads') || '{}');
  expect(saved.books[0]).toMatchObject({
    title: '사피엔스',
    rating: 3,
    status: 'done',
    review: '인류사를 관통하는 통찰.',
  });
});

test('지문: 수집 원문을 읽고 내 요약을 쓰면 AI 채점 결과가 뜬다', async () => {
  const articles = [
    {
      id: 'k1',
      lang: 'ko',
      field: '사회',
      source: '경향',
      title: '기후 위기와 도시',
      url: 'https://x/k1',
      published: '',
      words: 800,
      text: '첫 문단.\n\n둘째 문단.',
    },
    {
      id: 'e1',
      lang: 'en',
      field: '과학',
      source: 'BBC',
      title: 'Deep Sea',
      url: 'https://x/e1',
      published: '',
      words: 500,
      text: 'Para one.\n\nPara two.',
    },
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/ping') return jsonRes({ ok: true, server: 's', tools: [], work: '/' });
      if (url === '/api/artifact/reads') return jsonRes({ ok: true, data: { at: 'now', date: 'd', articles } });
      if (url === '/api/reads/coach')
        return jsonRes({
          ok: true,
          lang: 'ko',
          feedback: { score: 82, comment: '핵심을 잘 잡았어요.', missing: ['반론 언급'] },
        });
      return jsonRes({ ok: false, error: 'unknown' }, false);
    }),
  );

  renderApp('/reads');

  // 첫 지문(한국어)이 리더에 뜬다
  await waitFor(() => expect(screen.getByRole('heading', { name: '기후 위기와 도시' })).toBeInTheDocument());

  // 내 요약 작성
  const ta = screen.getByLabelText('내 요약');
  fireEvent.change(ta, { target: { value: '도시가 기후 위기의 최전선이다.' } });

  // AI 채점 → 점수·총평·빠진 핵심 노출
  fireEvent.click(screen.getByRole('button', { name: /AI 채점 받기/ }));
  await waitFor(() => expect(screen.getByText('82점')).toBeInTheDocument());
  expect(screen.getByText('핵심을 잘 잡았어요.')).toBeInTheDocument();
  expect(screen.getByText('반론 언급')).toBeInTheDocument();

  // 요약 저장 확인(로컬)
  const saved = JSON.parse(localStorage.getItem('lh:reads') || '{}');
  expect(saved.work.k1.summary).toContain('최전선');
});

test('지문: EN 필터로 영어 지문만 남고 언어 태그가 바뀐다', async () => {
  const articles = [
    {
      id: 'k1',
      lang: 'ko',
      field: '사회',
      source: '경향',
      title: '한국어 지문',
      url: 'https://x/k1',
      published: '',
      words: 800,
      text: '가.',
    },
    {
      id: 'e1',
      lang: 'en',
      field: '과학',
      source: 'BBC',
      title: 'English Passage',
      url: 'https://x/e1',
      published: '',
      words: 500,
      text: 'Eng.',
    },
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/ping') return jsonRes({ ok: true, server: 's', tools: [], work: '/' });
      if (url === '/api/artifact/reads') return jsonRes({ ok: true, data: { at: 'now', date: 'd', articles } });
      return jsonRes({ ok: false }, false);
    }),
  );

  renderApp('/reads');
  await waitFor(() => expect(screen.getByRole('heading', { name: '한국어 지문' })).toBeInTheDocument());

  // EN 필터
  fireEvent.click(screen.getByRole('button', { name: 'EN', pressed: false }));
  await waitFor(() => expect(screen.getByRole('heading', { name: 'English Passage' })).toBeInTheDocument());
  const list = screen.getByRole('list');
  expect(within(list).queryByText('한국어 지문')).not.toBeInTheDocument();
});
