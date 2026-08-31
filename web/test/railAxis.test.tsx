// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { renderApp } from './_render';
import { useApp } from '@/store/useApp';
import { useUI } from '@/store/useUI';

/* 레일 **축 접기**(2026-08-28) — 「탭이 늘면 레일이 늘어난다」를 끊은 구조의 회귀망.

   사용자 보고가 출발점이다: *"탭이 많아지니까 밀도가 높고 가독성이 떨어진다. 계속 늘어날 수도
   있는데."* 무게 3단(같은 날 먼저 한 것)은 **읽는 비용**을 낮췄을 뿐 그 축을 안 건드렸다 —
   화면이 하나 늘면 레일도 한 줄 늘었다.

   지금 구조: 상시 축(매일 여는 셋) + **아코디언 축들**(열린 것은 언제나 «현재 축» 하나) +
   바닥 칩. 그래서 쉬는 상태는 화면 수와 **무관하게** 6줄이다.

   ⚠⚠ 여기서 잠그는 것은 픽셀이 아니라 **네 가지 계약**이다(전부 실패 모드가 조용하다):
   ① 열림은 라우트의 파생이다 — 저장하지 않는다(두 축이 동시에 열리면 다시 15줄이 된다)
   ② 헤더는 접기 토글이 아니라 **그 축의 얼굴로 가는 이동**이다(빈손으로 끝나는 클릭 금지)
   ③ 접힌 축의 줄도 **DOM 에는 남는다** — 모바일(≤700)에서 레일은 하단 탭바이고 거기엔 축이라는
      개념이 없다. 조건부 렌더로 바꾸면 폰에서 탭이 통째로 사라지는데, 그건 U023 이 이미 한 번
      물린 형태다(화면 밖으로 나간 탭은 도달할 방법이 없다).
   ④ disclosure 는 `aria-expanded` 로 말한다 — 시각적 접힘만 하고 SR 에 안 알리면, 훑는 사람은
      «없는 화면»으로 읽는다. */

beforeEach(() => {
  useApp.getState().mutate((st) => {
    st.theme = 'light';
    st.items = [];
  });
  useUI.setState((s) => {
    s.ui.navCollapsed = false;
  });
});
afterEach(() => cleanup());

const 헤더 = (질문: RegExp) => screen.getByRole('button', { name: 질문 });

test('축 접기 ① 상시 축에 있으면 어떤 축도 열려 있지 않다(쉬는 상태)', async () => {
  await renderApp('/today');
  await screen.findByRole('button', { name: /오늘 학습/ });
  expect(헤더(/언제 얼마나 할까/)).toHaveAttribute('aria-expanded', 'false');
  expect(헤더(/무엇을 아는가/)).toHaveAttribute('aria-expanded', 'false');
});

test('축 접기 ② 헤더 클릭은 그 축의 얼굴로 **이동**한다 — 접기 토글이 아니다', async () => {
  await renderApp('/today');
  await screen.findByRole('button', { name: /오늘 학습/ });

  fireEvent.click(헤더(/언제 얼마나 할까/));

  // 얼굴 = 그 축의 destination(계획). 열림은 그 이동의 **결과**다.
  await waitFor(() => expect(document.getElementById('rail-schedule')).toHaveAttribute('aria-current', 'page'));
  expect(헤더(/언제 얼마나 할까/)).toHaveAttribute('aria-expanded', 'true');
});

test('축 접기 ③ 열린 축은 언제나 하나다 — 다른 축으로 가면 앞의 축이 닫힌다', async () => {
  await renderApp('/stats');
  await screen.findByRole('button', { name: /통계/ });
  expect(헤더(/무엇을 아는가/)).toHaveAttribute('aria-expanded', 'true');
  expect(헤더(/언제 얼마나 할까/)).toHaveAttribute('aria-expanded', 'false');

  fireEvent.click(document.getElementById('rail-schedule')!);

  await waitFor(() => expect(헤더(/언제 얼마나 할까/)).toHaveAttribute('aria-expanded', 'true'));
  expect(헤더(/무엇을 아는가/)).toHaveAttribute('aria-expanded', 'false');
});

test('축 접기 ④ 접힌 축의 줄도 DOM 에 남는다 — 폰 탭바가 같은 목록을 쓴다', async () => {
  await renderApp('/today');
  await screen.findByRole('button', { name: /오늘 학습/ });
  /* ⚠ 「보이지 않는다」는 데스크톱 CSS(`hidden` + `max-mobile:contents`)가 하는 말이고, 여기서
     재는 것은 **존재**다. 조건부 렌더로 바꾸면 이 케이스가 즉시 빨개진다 — 그때 폰 탭바에서
     사라지는 것이 바로 이 줄들이다. */
  expect(document.getElementById('rail-questions')).toBeInTheDocument();
  expect(document.getElementById('rail-ledger')).toBeInTheDocument();
});

test('축 접기 ⑤ 접힘 레일(42px)에는 헤더가 없다 — 질문 한 줄이 들어갈 폭이 없다', async () => {
  useUI.setState((s) => {
    s.ui.navCollapsed = true;
  });
  await renderApp('/today');
  await screen.findByRole('button', { name: /오늘 학습/ });
  expect(screen.queryByRole('button', { name: /언제 얼마나 할까/ })).toBeNull();
  // 대신 전부 평면으로 선다(옛 형태) — 도달성이 접힘 상태에서도 그대로라는 뜻이다.
  expect(document.getElementById('rail-questions')).toBeInTheDocument();
});
