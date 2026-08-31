// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { renderApp } from './_render';

/* 안내(guide) 탭 — 정적 매뉴얼. serve.js 무관하게 항상 렌더(순수 참조)임을 확인.
   레지스트리 분기 + lazy/Suspense + 세 축 섹션이 뜨는지 본다. 
   ⚠⚠ **주소가 바뀌었다(W4 · 2026-08-07): `/guide` → `/find?view=guide`.** 근거는 위 goals 와
   같다(`shell/tabs.ts`). 본문 분해는 **여전히 유예 상태**이고 이 삭제는 그것과 무관하다 —
   지운 것은 탭 행이지 매뉴얼이 아니다.
*/

afterEach(() => cleanup());

test('안내 탭: 히어로 + 세 축 섹션 + 도구 표를 정적으로 렌더(serve.js 무관)', async () => {
  await renderApp('/find?view=guide');
  await waitFor(() => expect(screen.getByText('이 시스템이 할 수 있는 것 · 하는 법')).toBeInTheDocument());
  /* 축 섹션 제목. ⚠⚠ **「수집·발견 — 자료 축」이 여기 있었다 — 지웠다**(C059 · 2026-08-22):
     그 절이 부르던 탭 넷(`읽을거리`·`증시 동향`·`탐구 수집`·`발견`)이 `TABS` 에 0건이었고,
     수집·교양은 `survey/` 필러 소관이라 이 앱에 착지처가 없다. 즉 이 앱의 축은 **둘**이다. */
  expect(screen.getByText(/전공 학습 — 교재를 노트로/)).toBeInTheDocument();
  expect(screen.queryByText(/수집·발견/), '없는 탭으로 보내는 절이 되살아났다').toBeNull();
  /* ⛔ 2026-08-29 — 「목표·연관성」 절도 같은 이유로 죽었다: 그 절이 부르던 탭 둘
     (`내 길 지도`·`숙달도 지도`)과 goals 계약이 부모 목적 정정으로 함께 은퇴했다.
     즉 이 앱이 안내하는 축은 이제 **하나**다(전공 학습 — 교재를 노트로). */
  expect(screen.queryByText(/목표·연관성/), '가리킬 화면이 없는 절이 되살아났다').toBeNull();
  // 실제 트리거·도구 근거가 박혀 있는지(정확성).
  expect(screen.getByText(/"\(과목\) \(챕터\) 돌려줘"/)).toBeInTheDocument();
  expect(screen.getByText('허브 도구 (제어판)')).toBeInTheDocument();
});
