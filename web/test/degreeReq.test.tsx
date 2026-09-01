// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { renderApp } from './_render';
import { useApp } from '@/store/useApp';

/* 졸업요건 정리 — 졸업 탭(/degree) 안 세그먼트('졸업요건 정리') 뷰.
   SD-2: 하드코딩 샘플을 폐기하고 state.degree(내 학기·과목·성적)로 구동한다.
   레지스트리 분기 + lazy/Suspense + 세그먼트 전환 + 데이터 파생이 맞물리는지 런타임 확인. */

afterEach(() => cleanup());

test('졸업요건 정리: 내 degree 데이터로 요건 충족·재수강 후보를 계산해 렌더(레거시 #page 미사용)', async () => {
  useApp.getState().mutate((st) => {
    st.degree = {
      targetTotal: 130,
      reqMajorReq: 60,
      reqMajorSel: 30,
      reqLiberal: 30,
      /* ⚠ 상태가 **과목 → 학기**로 올라가며 픽스처가 두 학기로 갈렸다(2026-08-31).
         종전엔 한 학기 안에 완료 2 + 수강중 1 이 섞여 있었는데 그 상태는 이제 불가능하다.
         집계값은 그대로다: 이수 6(전공필수) · 수강중 3 · F 하나(재수강 필수). */
      semesters: [
        {
          id: 's1',
          name: '2026-1학기',
          status: '완료',
          courses: [
            { id: 'c1', name: '미적분학', credits: 3, category: '전공필수', grade: 'A+' },
            { id: 'c2', name: '반도체공학', credits: 3, category: '전공필수', grade: 'F' },
          ],
        },
        {
          id: 's2',
          name: '2026-2학기',
          status: '수강중',
          courses: [{ id: 'c3', name: '일반물리', credits: 3, category: '전공선택', grade: '' }],
        },
      ],
    };
  });
  await renderApp('/degree');

  // 기본은 '졸업 계획' — 세그먼트로 '졸업요건 정리'로 전환.
  fireEvent.click(await screen.findByRole('button', { name: '졸업요건 정리' }));

  // 데이터 파생 뷰가 뜬다(하드코딩 '전자공학과' 문구는 더 이상 없음).
  await waitFor(() => expect(screen.getByText('졸업요건 충족 현황')).toBeInTheDocument());
  expect(screen.getByText('1 · 카테고리별 요건 충족')).toBeInTheDocument();
  expect(screen.getByText('남은 졸업학점')).toBeInTheDocument();
  // '전공필수'는 요건표·재수강 구분 양쪽에 나온다 → 존재만 확인.
  expect(screen.getAllByText('전공필수').length).toBeGreaterThan(0);
  // F 과목은 '재수강 필수'로 표면화된다.
  expect(screen.getByText('재수강 필수')).toBeInTheDocument();

  // 레거시 innerHTML(#page) 경로를 쓰지 않는다.
  expect(document.getElementById('page')).toBeNull();
});

test('졸업요건 정리: 과목이 하나도 없으면 EmptyState로 안내', async () => {
  useApp.getState().mutate((st) => {
    st.degree = {
      targetTotal: 130,
      reqMajorReq: 0,
      reqMajorSel: 0,
      reqLiberal: 0,
      semesters: [{ id: 's0', name: '2026-1학기', courses: [] }],
    };
  });
  await renderApp('/degree');
  fireEvent.click(await screen.findByRole('button', { name: '졸업요건 정리' }));
  expect(await screen.findByText('아직 등록된 과목이 없어요')).toBeInTheDocument();
});
