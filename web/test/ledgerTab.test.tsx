// @vitest-environment jsdom
/* ============================================================
   ledgerTab.test.tsx — 정본 원장 탭. 오프라인 셋업 폴백 · 파이프라인 퍼널/과목 행 렌더 ·
   셀 클릭 → 챕터 상세(5단계 체크리스트). 통합 4단계 소비의 렌더 계약을 잠근다.
============================================================ */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { renderApp } from './_render';

function jsonRes(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body };
}

const LEDGER = {
  generated: '2026-07-12',
  generated_by: 'test',
  n_chapters: 2,
  stage_counts: { sourced: 2, noted: 2, verified: 1, carded: 0, reviewed: 0 },
  backlog: { unprocessed_src: ['벡터 해석'], subjects_without_src: ['반도체공학'] },
  subjects: {
    과기법: {
      slug: 'stlaw',
      abbr: 'STLAW',
      domain: '인문',
      src: '과기법',
      src_present: true,
      chapters: [
        {
          chapter_id: 'stlaw-01',
          arc: '01 법의 가치관',
          notes: 5,
          concept: 5,
          status: { verified: 5, drafted: 0, raw: 0, 구버전: 0 },
          verified_ratio: 1,
          carded_notes: 5,
          cards: 10,
          reps: 3,
          reviewed_recent: null,
          milestones: { sourced: true, noted: true, verified: true, carded: false, reviewed: false },
          furthest: 'verified',
        },
        {
          chapter_id: 'stlaw-02',
          arc: '02 헌법',
          notes: 3,
          concept: 3,
          status: { verified: 0, drafted: 0, raw: 0, 구버전: 3 },
          verified_ratio: 0,
          carded_notes: 0,
          cards: 0,
          reps: 0,
          reviewed_recent: null,
          milestones: { sourced: true, noted: true, verified: false, carded: false, reviewed: false },
          furthest: 'noted',
        },
      ],
    },
  },
};

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('오프라인(워크스페이스 미설정): 셋업 안내로 폴백한다', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/ping') return jsonRes({ ok: false }, false);
      return jsonRes({ ok: false, error: 'off' }, false);
    }),
  );
  await renderApp('/ledger');
  await waitFor(() => expect(screen.getByText('아직 챕터 원장이 없어요')).toBeInTheDocument());
});

test('원장 데이터 → 과목 행·백로그 렌더, 셀 클릭 시 챕터 상세가 열린다', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/ping') return jsonRes({ ok: true, server: 's', tools: ['ledger-build'], work: '/' });
      if (url === '/api/artifact/ledger') return jsonRes({ ok: true, data: LEDGER });
      return jsonRes({ ok: false }, false);
    }),
  );
  await renderApp('/ledger');

  // 과목 행(매트릭스) + 백로그 칩
  await waitFor(() => expect(screen.getByText('과기법')).toBeInTheDocument());
  expect(screen.getByText('벡터 해석')).toBeInTheDocument(); // 미처리 참고자료
  expect(screen.getByText('반도체공학')).toBeInTheDocument(); // 출처 없는 과목

  // 챕터 셀 클릭 → 온디맨드 상세(dialog)
  fireEvent.click(screen.getByLabelText(/01 법의 가치관 — verified/));
  await waitFor(() => expect(screen.getByRole('dialog', { name: /01 법의 가치관 상세/ })).toBeInTheDocument());
  expect(screen.getByText('stlaw-01', { exact: false })).toBeInTheDocument();
});
