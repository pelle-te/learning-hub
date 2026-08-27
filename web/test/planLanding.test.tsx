// @vitest-environment jsdom
/* ============================================================
   planLanding.test.tsx — 계획 탭 '착지'의 결정론 회귀 고정(Wave 2).
   결함: Today의 "오늘 계획 짜기"가 `/plan-host`로만 보내 캘린더의 **영속 뷰**(schedView·기본 week)에
   떨어졌다 — '오늘'을 요청했는데 주 격자(혹은 지난번 아무 뷰)가 열려 첫 화면이 매번 달랐다.
   계약(C029 · 2026-08-22 갱신): CTA는 **주소 하나로** 의도를 다 말한다 — `?ds=<오늘>&span=day`.

   ⚠⚠ **종전 계약은 «뷰를 보내는 쪽에서 먼저 전환한다»** 였다(`setSchedView('day')` 를 부르고
   내비게이션). 그건 뷰가 **영속 토글**이라 주소로 말할 방법이 없어서였고, 대가는 «새 딥링크
   입구마다 그 한 줄을 기억해야 한다» 였다 — 잊으면 조용히 다른 화면이 뜬다. C029 가 그 상태를
   주소로 올렸다(`?span=`). 그래서 이 파일의 단언도 **저장소 값이 아니라 주소와 화면**을 본다.
   (일반 진입 = 나브 '계획'·⌘K·g p는 여전히 영속 뷰 존중 — 주소가 말이 없으면 그게 기본값이다.)
============================================================ */
import { afterEach, beforeEach, expect, test } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { renderApp } from './_render';
import { useApp } from '@/store/useApp';
import { useUI } from '@/store/useUI';
import { todayISO, parseISO, fmtShort } from '@/lib/utils';

beforeEach(() => {
  // 과목은 있으나(hasItems) 챕터가 없어 오늘 블록이 0 → Today가 "오늘 계획 짜기" CTA를 띄우는 상태.
  useApp.getState().mutate((st) => {
    /* ⚠ '오늘'을 **고정한다**. 안 하면 이 파일은 **일요일에만 통과한다** — 시드가 주 3시간짜리
       과목이라 평일엔 배분 블록이 생기고, 그러면 전제("오늘 블록 0")가 깨져 CTA 자체가
       사라진다. 2026-07-19(일)에 작성돼 녹색이었다가 07-20(월)에 빨간불이 됐다.
       벽시계 대신 앱 정본 `_today` 를 쓰는 건 이 저장소의 기존 규약이다. */
    st._today = '2026-07-19'; // 일요일 — 배분 블록이 0인 날
    st.items = [
      {
        id: 'sx',
        source: '직접',
        name: '미적분',
        color: '#4f8ff0',
        mode: 'weekly',
        weeklyHours: 3,
        dailyMin: 30,
        deadline: '',
        chapters: [],
      },
    ];
    st.weekAlloc = {};
    st.dayPlans = {};
    st.tasks = [];
  });
});
afterEach(() => cleanup());

/** 클릭 후: 캘린더 일(day) 뷰 + 오늘 날짜에 착지했는지. `영속` = 클릭 전 영속 뷰 값. */
async function expectLandedOnToday(영속: 'week' | 'month') {
  /* ① **일 뷰가 실제로 그려졌다.** 「이전 날」 네비는 일 뷰에만 있다 — 저장소 값이 아니라
     화면을 보는 것이 이 계약의 요지다(C029: 주소가 이기고, 화면이 그 결과다). */
  await waitFor(() => expect(screen.getByLabelText('이전 날')).toBeInTheDocument());
  /* ② **영속값은 그대로다** — 즉 일 뷰를 띄운 것은 저장소가 아니라 **주소**다.
     ⚠ 이게 이 파일의 새 판별자다(C029). `window.location` 을 볼 수는 없다 — `renderApp` 이
     MemoryRouter 라 그 값이 안 바뀐다. 그런데 «영속값이 안 바뀌었는데 일 뷰가 떴다»는
     주소가 이겼다는 것의 **직접적인 증거**이고, 종전 계약(보내는 쪽이 저장소를 먼저 바꾼다)
     아래에서는 **원리적으로 참일 수 없다** — 그래서 더 강한 단언이다. */
  expect(
    useUI.getState().ui.schedView,
    '영속 뷰가 바뀌었다 — 보내는 쪽이 저장소를 만지는 옛 계약으로 되돌아갔는가',
  ).toBe(영속);
  // ③ 그 날짜가 '오늘'(앱 단일 출처 todayISO — new Date() 직접 사용 아님)이다.
  const todayLab = fmtShort(parseISO(todayISO(useApp.getState().state)));
  expect(screen.getByText(todayLab)).toBeInTheDocument();
}

test('히어로 CTA "오늘 계획 짜기" → 영속 뷰가 month여도 캘린더 일 뷰 + 오늘로 착지', async () => {
  useUI.getState().setSchedView('month'); // 지난번에 월 뷰를 보다 나간 사용자
  await renderApp('/today');

  // 히어로 CTA(캡션 '캘린더 · 오늘')를 상단 바 액션·레일 칩과 구분해 집는다.
  const cap = await screen.findByText('캘린더 · 오늘 →');
  fireEvent.click(cap.closest('button')!);
  await expectLandedOnToday('month');
});

test('상단 바 액션 "오늘 계획 짜기 →"도 같은 목적지(일 뷰 · 오늘)', async () => {
  useUI.getState().setSchedView('week'); // 기본값(v4 "기본 착지=캘린더 주 뷰")에서 출발해도
  await renderApp('/today');

  fireEvent.click(await screen.findByRole('button', { name: '오늘 계획 짜기 →' }));
  await expectLandedOnToday('week');
});

test('?ds= 딥링크는 그 날짜로 열린다(초기값으로만 흡수)', async () => {
  useUI.getState().setSchedView('day');
  await renderApp('/schedule?ds=2026-01-05');

  await waitFor(() => expect(screen.getByLabelText('이전 날')).toBeInTheDocument());
  expect(screen.getByText('1/5')).toBeInTheDocument();
});
