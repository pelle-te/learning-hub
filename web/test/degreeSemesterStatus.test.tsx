// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { renderApp } from './_render';
import { useApp } from '@/store/useApp';

/* ============================================================
   학기 단위 상태 — **화면 쪽 계약**(2026-08-31 · 사용자 판정).

   순수 집계는 `degree.test.ts` 가 잠근다. 여기서 잠그는 것은 그 파일이 **원리적으로 못 보는 것**:
   ① 과목마다 있던 상태 셀렉트가 정말 사라졌나
   ② 학기 셀렉트가 **날짜가 있으면 잠기고** 파생값을 보여 주나
   ③ ⚠ 「학습 항목으로」 버튼이 여전히 뜨나 — 이 개편이 **실제로 회귀를 만든 자리**다.
      종전 조건이 `c.status === '수강중' || c.status === '예정'` 이었는데 새 과목엔 `c.status` 가
      아예 없어져 **항상 거짓**이 됐고, 그래서 버튼이 영영 안 떴다. 유닛·시각·a11y 어느 층도
      이 버튼을 덮지 않아 조용했다(전수 grep: 이 파일 이전 커버리지 **0**).
============================================================ */

afterEach(() => cleanup());

/** 날짜 없는 학기 하나 — 폴백(②) 축을 쓴다. */
function 학기없는날짜(status?: string) {
  return {
    targetTotal: 130,
    reqMajorReq: 60,
    reqMajorSel: 30,
    reqLiberal: 30,
    semesters: [
      {
        id: 's1',
        name: '2026-1학기',
        ...(status ? { status } : {}),
        courses: [{ id: 'c1', name: '미적분학', credits: 3, category: '전공필수', grade: '' }],
      },
    ],
  };
}

async function 학기카드를편다() {
  await renderApp('/degree');
  /* ⚠ 학기 이름은 로드맵 노드에도 뜬다(여럿) — 펼치는 것은 **카드 헤더**다(`ds-itemname`). */
  const 헤더 = await waitFor(() => {
    const el = document.querySelector('.ds-itemname');
    if (!el) throw new Error('학기 카드 헤더를 못 찾았다');
    return el;
  });
  fireEvent.click(헤더);
  await waitFor(() => expect(screen.getByLabelText('학점')).toBeInTheDocument());
}

test('과목마다 있던 상태 셀렉트가 사라지고, 학기 셀렉트 하나가 그 자리를 진다', async () => {
  useApp.getState().mutate((st) => {
    st.degree = 학기없는날짜() as unknown as typeof st.degree;
  });
  await 학기카드를편다();

  /* ① 과목 상태 셀렉트 0 — 상태는 더 이상 과목의 것이 아니다.
     ⚠ `getByLabelText('상태')` 로 세면 **학기 셀렉트가 걸린다**(그쪽은 `<label for>` 로 붙는다).
     옛 과목 셀렉트는 `aria-label="상태"` 를 자기가 달고 있었으므로 그 형태로 센다. */
  expect(document.querySelectorAll('select[aria-label="상태"]')).toHaveLength(0);
  expect(document.querySelectorAll('select[id^="sem-status-"]')).toHaveLength(1);
  const sel = screen.getByLabelText('상태', { selector: 'select[id^="sem-status-"]' });
  expect(sel).toBeEnabled(); // 날짜가 없으니 사람이 정한다
  expect((sel as HTMLSelectElement).value).toBe(''); // 「자동」

  // ② 철회 체크박스가 과목마다 선다(상태 축과 직교).
  expect(screen.getByLabelText('미적분학 철회')).toBeInTheDocument();
});

test('⚠ 회귀 방지 — 「학습 항목으로」 버튼이 뜬다(끝나지 않은 학기의 과목)', async () => {
  useApp.getState().mutate((st) => {
    st.degree = 학기없는날짜('수강중') as unknown as typeof st.degree;
  });
  await 학기카드를편다();
  expect(screen.getByTitle('학습 항목으로')).toBeInTheDocument();
});

test('끝난 학기의 과목에는 「학습 항목으로」가 없다 — 이제 와 만들 일이 없다', async () => {
  useApp.getState().mutate((st) => {
    st.degree = 학기없는날짜('완료') as unknown as typeof st.degree;
  });
  await 학기카드를편다();
  expect(screen.queryByTitle('학습 항목으로')).not.toBeInTheDocument();
});

test('날짜가 있으면 셀렉트가 잠기고 파생값을 보여 준다 — 화면이 우선순위를 말한다', async () => {
  useApp.getState().mutate((st) => {
    st._today = '2026-08-07';
    const d = 학기없는날짜('예정') as unknown as typeof st.degree;
    // ⚠ 어긋난 status('예정')를 일부러 남긴다 — 날짜가 이겨야 한다.
    d.semesters[0]!.startDs = '2026-03-02';
    d.semesters[0]!.endDs = '2026-06-14'; // _today 보다 앞 → 완료
    st.degree = d;
  });
  await 학기카드를편다();

  const sel = screen.getByLabelText('상태', { selector: 'select[id^="sem-status-"]' }) as HTMLSelectElement;
  expect(sel).toBeDisabled();
  expect(sel.value).toBe('완료'); // status='예정' 이 아니라 날짜가 답한다
  expect(screen.getByText('개강·종강일이 정합니다')).toBeInTheDocument();
});
