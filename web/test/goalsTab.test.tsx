// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { renderApp } from './_render';
import { GOALS_KEY } from '@/store/queries';
import type { GoalsArtifact } from '@/lib/goals';

/* 내 길(goals) 탭 — P9 Phase 6 Wave②. 손저작 goals.json 을 트리로 렌더하는지 런타임 확인.
   데이터는 serve.js 쿼리(useGoals)라 QueryClient 캐시에 시드해 콜드/서버 없이 결정론 렌더.
   레지스트리 분기 + lazy/Suspense + buildGoalTree 파생이 맞물리는지 본다. 
   ⚠⚠ **주소가 바뀌었다(W4 · 2026-08-07): `/goals` → `/degree?view=path`.** `goals` 는 W9 에
   `degree` 로 흡수됐고 W4 가 로스터 행까지 지웠다(은퇴 어휘가 "영원한 유예"의 도구가 되고
   있었다는 판정 · `shell/tabs.ts` 그 자리 주석이 SSOT). **검사를 지우지 않고 대역을 갈았다** —
   화면은 그대로 살아 있고 사라진 것은 탭 행 하나이므로, 여기서 지켜야 할 것도 그대로다.
*/
const GOALS: GoalsArtifact = {
  _schemaVersion: 1,
  nodes: [
    {
      id: 'research-independence',
      kind: 'goal',
      title: '전파통신 분야 연구원으로 자립',
      weight: 1,
      active: true,
      parent: null,
    },
    {
      id: 'communication-theory',
      kind: 'goal',
      title: '통신이론',
      weight: 1,
      active: true,
      parent: 'research-independence',
    },
    { id: 'antennas', kind: 'goal', title: '안테나', weight: 0.8, active: true, parent: 'research-independence' },
    {
      id: 'degree-requirement',
      kind: 'goal',
      title: '전자공학 학위요건 충족',
      weight: 0.5,
      active: true,
      parent: 'research-independence',
      degree_req: { targetTotal: 128, reqMajorReq: 41, reqMajorSel: 27, reqLiberal: 51 },
    },
  ],
};

/** ⚠ 렌더 헬퍼는 `test/_render` 한 벌이다(M-12) — 여기 남는 것은 **이 파일 고유의 씨앗**뿐이다. */
const renderGoals = (initialPath: string, seed?: GoalsArtifact) =>
  renderApp(initialPath, seed ? { seed: (qc) => qc.setQueryData([...GOALS_KEY], seed) } : {});

afterEach(() => cleanup());

test('내 길 탭: 시드된 goals 트리를 루트 히어로 + 하위목표 카드(학위요건 롤업)로 렌더', async () => {
  await renderGoals('/degree?view=path', GOALS);
  // 루트 성취목표 히어로.
  await waitFor(() => expect(screen.getByText('전파통신 분야 연구원으로 자립')).toBeInTheDocument());
  // 하위목표 카드.
  expect(screen.getByText('통신이론')).toBeInTheDocument();
  expect(screen.getByText('안테나')).toBeInTheDocument();
  // 학위요건 흡수 degree_req 롤업(흡수한 degree.ts 값).
  expect(screen.getByText('전공필수')).toBeInTheDocument();
  expect(screen.getByText('128')).toBeInTheDocument();
  // 하이브리드 연관 안내(정직한 콜드).
  expect(screen.getByText(/노트→목표 연관/)).toBeInTheDocument();
});

test('내 길 탭: 콜드(서버 없음·시드 없음) → 빈 상태로 우아하게', async () => {
  await renderGoals('/degree?view=path'); // 시드 없음 → 쿼리 error(retry 없음) → EmptyState
  await waitFor(() => expect(screen.getByText('내 길이 아직 안 보여요')).toBeInTheDocument());
});
