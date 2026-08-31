// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { renderApp } from './_render';
import { useApp } from '@/store/useApp';
import { weekMonOf } from '@/lib/weekAlloc';
import { todayISO } from '@/lib/utils';

/* items 탭이 React로 동작: 과목/챕터 추가가 store(앱상태)에 반영되는지.
   (Phase 6에서 레거시 globalThis.state 브리지 제거 — 단일 원천은 Zustand 스토어.) */

beforeEach(() => {
  useApp.getState().mutate((st) => {
    st.items = [];
    st.weekAlloc = {};
  });
});
afterEach(() => cleanup());

test('items: React 탭으로 렌더되고 #page를 쓰지 않는다', async () => {
  await renderApp('/items');
  // 계획 재개편 v3 — 탭 이름이 '학습 항목' → '과목'(뼈대 병합).
  /* ⚠ `level: 2` 로 좁힌다 — 2026-08-31 부터 셸이 **라우트 이름을 `<h1 class="sr-only">`** 로도
     그린다(U065: 표제 축으로 «지금 어디인가»를 되찾게). 레벨을 안 주면 같은 이름이 둘이라
     쿼리가 모호해지고, 이 케이스가 묻는 것은 **탭 본문의 표제**이므로 레벨이 곧 그 뜻이다. */
  await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: /^과목/ })).toBeInTheDocument());
  expect(document.getElementById('page')).toBeNull();
  expect(screen.getByText(/아직 과목이 없어요/)).toBeInTheDocument();
});

test('items: 과목 추가가 store(앱상태)에 반영된다', async () => {
  await renderApp('/items');
  const addBtn = await screen.findByRole('button', { name: '+ 과목 추가' });
  fireEvent.click(addBtn);

  await waitFor(() => expect(screen.getByDisplayValue('새 과목')).toBeInTheDocument());
  expect(useApp.getState().state.items).toHaveLength(1);
});

test('items: 챕터 추가가 해당 과목에 들어간다', async () => {
  useApp.getState().mutate((st) => {
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
  });
  await renderApp('/items');

  // 과목 줄을 눌러 펼친다.
  fireEvent.click(await screen.findByText('미적분'));
  const addCh = await screen.findByRole('button', { name: '+ 챕터 추가' });
  fireEvent.click(addCh);

  await waitFor(() => expect(useApp.getState().state.items[0].chapters).toHaveLength(1));
  expect(screen.getByDisplayValue('새 챕터')).toBeInTheDocument();
});

/* ── 회귀 고정: 챕터 이름은 blur/Enter 에서만 커밋된다(H16 · 2026-08-01) ────────────
   종전엔 `onChange` 가 곧장 `mutate` 라 한 글자마다 `items` 슬라이스가 갈리고 파생 전량이
   다시 돌았다. 되돌아가면 이 두 단언 중 첫째가 즉시 빨개진다 — 그게 이 케이스의 전부다.
   ⚠ 커밋이 **id 로** 찾는지도 함께 본다면 좋겠지만, 그건 정렬 변경과 blur 의 순서를 만들어야
     하는 상호작용이라 여기(jsdom)의 몫이 아니다. 여기서는 커밋 **시점**만 못박는다. */
test('items: 챕터 이름은 타이핑 중엔 상태를 안 건드리고 blur 에 커밋된다', async () => {
  useApp.getState().mutate((st) => {
    st.items = [
      {
        id: 'sch',
        source: '직접',
        name: '미적분',
        color: '#4f8ff0',
        mode: 'weekly',
        weeklyHours: 3,
        dailyMin: 30,
        deadline: '',
        chapters: [{ id: 'c1', name: '1장', hours: 2, done: false }],
      },
    ];
  });
  await renderApp('/items');

  fireEvent.click(await screen.findByText('미적분'));
  const input = await screen.findByLabelText('챕터 이름');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: '1장 — 극한' } });

  // 타이핑 중: 화면은 초안을 보여주지만 앱 상태는 그대로다.
  expect(input).toHaveValue('1장 — 극한');
  expect(useApp.getState().state.items[0]!.chapters[0]!.name).toBe('1장');

  fireEvent.blur(input);
  await waitFor(() => expect(useApp.getState().state.items[0]!.chapters[0]!.name).toBe('1장 — 극한'));
});

/* ── 회귀 고정: 과목 삭제 · 수정 ───────────────────────────────────────────
   여긴 오래 '추가'만 검증했다. 삭제 경로는 store에서 items만 걷어내는데, weekAlloc은
   `weekAlloc[주][sid]` 맵이라 참조 무결성이 없다 → 지운 과목의 배분이 전 주에 고아로 남아
   요일 열 합·가용 초과 경고를 부풀렸다("보이는 행 합 1h인데 푸터는 4h"). 아래 테스트가 그 청소를
   못박는다(removeSidFromAlloc 배선이 빠지면 즉시 빨개진다). */

/** 시트를 열고 '과목 삭제' 를 눌러 실제 삭제 경로를 태운다.
 *
 *  ⚠⚠ **확인 모달 단계가 Q-13 에서 사라졌다**(2026-08-02). 과목 삭제는 `mutate` 라 ⌘Z 가 이미
 *  덮는데 종전엔 **확인창을 띄우고 나서** "⌘Z 로 되돌리기" 토스트를 띄웠다(같은 안전장치 이중
 *  과금). 되돌리기 3단 사다리의 ①단 = 묻지 않는다 — 근거는 `shell/destructive.ts` 머리주석.
 *  이 헬퍼가 검증하는 것(참조 무결성 청소)은 그대로다. */
async function deleteSubjectViaUI(name: string) {
  fireEvent.click(await screen.findByText(name));
  fireEvent.click(await screen.findByRole('button', { name: '과목 삭제' }));
}

test('items: 과목을 지우면 그 sid의 주간 배분도 함께 사라진다(고아 방지)', async () => {
  const wk = weekMonOf(todayISO(useApp.getState().state));
  useApp.getState().mutate((st) => {
    st.items = [
      {
        id: 'sdel',
        source: '직접',
        name: '삭제될과목',
        color: '#4f8ff0',
        mode: 'weekly',
        weeklyHours: 3,
        dailyMin: 30,
        deadline: '',
        chapters: [],
      },
      {
        id: 'skeep',
        source: '직접',
        name: '남을과목',
        color: '#f08f4f',
        mode: 'weekly',
        weeklyHours: 2,
        dailyMin: 30,
        deadline: '',
        chapters: [],
      },
    ];
    // managed 주 — 두 과목 모두 월요일(wd=1)에 배분해 둔다.
    st.weekAlloc = { [wk]: { sdel: [0, 180, 0, 0, 0, 0, 0], skeep: [0, 60, 0, 0, 0, 0, 0] } };
  });
  await renderApp('/items');

  await deleteSubjectViaUI('삭제될과목');

  await waitFor(() => expect(useApp.getState().state.items.map((i) => i.id)).toEqual(['skeep']));
  const map = useApp.getState().state.weekAlloc?.[wk];
  expect(map && 'sdel' in map).toBe(false); // ← 고아 배분이 남으면 실패(회귀 고정)
  expect(map?.skeep).toEqual([0, 60, 0, 0, 0, 0, 0]); // 남은 과목 배분은 그대로
});

test('items: 시트에서 과목 이름·주당 시간 수정이 store에 반영된다', async () => {
  useApp.getState().mutate((st) => {
    st.items = [
      {
        id: 'sedit',
        source: '직접',
        name: '옛이름',
        color: '#4f8ff0',
        mode: 'weekly',
        weeklyHours: 3,
        dailyMin: 30,
        deadline: '',
        chapters: [],
      },
    ];
  });
  await renderApp('/items');

  fireEvent.click(await screen.findByText('옛이름'));
  fireEvent.change(await screen.findByLabelText('과목 이름'), { target: { value: '새이름' } });
  await waitFor(() => expect(useApp.getState().state.items[0]!.name).toBe('새이름'));

  // 주당 목표 스텝퍼(+0.5h) — 시트가 소유한 유일한 시간 편집 입구.
  /* ⚠ N-1(W8) 이후 같은 화면에 `h` 스텝퍼가 **둘**이다(진도 · 주당 과제). 진도 쪽은 접근명이
     그대로이고 과제 쪽이 `주당 과제 h …` 로 좁혀졌다 — 정확 일치로 그 구분을 여기서 잠근다. */
  fireEvent.click(screen.getByRole('button', { name: 'h 늘리기', exact: true }));
  await waitFor(() => expect(useApp.getState().state.items[0]!.weeklyHours).toBe(3.5));
});

/* N-10 — 완료 체크는 **끝낸 날을 함께 남긴다**. 이 스탬프가 없으면 스케줄러가 done 챕터의
   블록을 더는 안 만들면서 그 챕터의 날짜 링크가 통째로 끊겨, 유지 복습이 걸 사다리가 사라진다. */
test('items: 챕터 완료 체크가 doneDs(끝낸 날)를 남기고, 해제하면 지운다', async () => {
  useApp.getState().mutate((st) => {
    st._today = '2026-07-08';
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
        chapters: [{ id: 'c1', name: '극한', hours: 2, done: false }],
      },
    ];
  });
  await renderApp('/items');
  fireEvent.click(await screen.findByText('미적분'));
  const done = await screen.findByRole('checkbox', { name: '완료' });

  fireEvent.click(done);
  await waitFor(() => expect(useApp.getState().state.items[0]!.chapters[0]!.done).toBe(true));
  expect(useApp.getState().state.items[0]!.chapters[0]!.doneDs).toBe('2026-07-08');

  fireEvent.click(done);
  await waitFor(() => expect(useApp.getState().state.items[0]!.chapters[0]!.done).toBe(false));
  expect(useApp.getState().state.items[0]!.chapters[0]!.doneDs).toBeUndefined();
});

/* ⚠⚠ H25(2026-07-30 `/감사 근본`) — **주당 목표 시간을 고쳐 치다 비우면 0h 가 확정됐다.**

   시트의 스텝퍼가 `NumberField` 에 `emptyValue={0}` 을 주고 있었다. 배분 셀에서는 0 이 "이 요일엔
   배분 안 함"이라는 의미 있는 값이지만, 주당 목표 시간에서 0 은 그저 미완 입력이다. 결과가 특히
   나쁜 이유는 **표시가 따라오지 않기** 때문이다: 호출부가 `item.weeklyHours || 3` 이라 저장값 0 을
   화면은 계속 "3h" 로 보여 주고, 스케줄러는 `|| 0` 으로 읽어 그 과목 예산을 0 으로 잡는다.
   `Settings` 의 같은 이름 스텝퍼는 이미 이 사고를 겪고 주석으로 못박아 뒀는데 이 사본에만 살아
   있었다(같은 결함이 두 벌 중 한 벌에만 고쳐진 형태). */
test('items: 주당 목표 시간을 비운 채 떠나도 0h로 확정되지 않는다(H25)', async () => {
  useApp.getState().mutate((st) => {
    st.items = [
      {
        id: 'sy',
        source: '직접',
        name: '선형대수',
        color: '#4f8ff0',
        mode: 'weekly',
        weeklyHours: 3,
        dailyMin: 30,
        deadline: '',
        chapters: [],
      },
    ];
  });
  await renderApp('/items');

  fireEvent.click(await screen.findByText('선형대수'));
  const field = await screen.findByLabelText('주당 목표 시간');
  // 고쳐 치려고 칸을 비우고 그대로 떠난다(blur) — 옛 구현은 여기서 0 을 확정했다.
  fireEvent.change(field, { target: { value: '' } });
  fireEvent.blur(field);

  expect(useApp.getState().state.items[0].weeklyHours, '비운 것이 0h 로 확정됐다').toBe(3);
});
