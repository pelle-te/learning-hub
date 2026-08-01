// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ThemeProvider from '@/app/ThemeProvider';
import App from '@/app/App';
import { useApp } from '@/store/useApp';
import { iso } from '@/lib/utils';

/* Phase 3 — today 탭이 React로 동작: 파생(useSchedule) 카드가 뜨고,
   일일 의식(ritual) 토글이 앱상태에 반영되는지. */
function renderApp(initialPath: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/* ⚠ **과목을 심는 것이 계약이다(H14 · 2026-07-26 감사).** 종전엔 `defaults()`(items: []) 위에서
   렌더했는데, 그 상태의 실제 화면은 **콜드 스타트 온보딩**이다 — 즉 이 테스트들은 사용자가
   그 상태에서 볼 수 없는 대시보드를 검사하고 있었다(스크림 뒤에 조건 없이 살아 있었기 때문에
   가능했고, 그 '뒤에 살아 있음'이 곧 H14 의 결함이었다: Tab 이 새고 SR 이 둘을 섞어 읽었다).
   대시보드를 검사하려면 대시보드가 뜨는 상태를 만들어야 한다.

   ⚠⚠ **그리고 챕터까지 심어야 한다(2026-08-01).** 종전 시드는 `chapters: []` 라 스케줄러가
   블록을 하나도 배치하지 못했고 → `todayTotal === 0` → `flowNodes` 가 비어 **W19 의
   `emptyDay` 분기**가 흐름 레일 컬럼을 통째로 안 그렸다. 그 컬럼 안에 이 파일이 찾는
   `오늘의 흐름` 헤딩과 `＋ 블록 상세 · 일일 의식` 버튼이 산다.
   즉 W19(2026-07-31) 이후 이 파일의 케이스 셋은 **계속 빨간 채로 두 커밋을 지나왔다** —
   시드가 "대시보드가 뜨는 상태"를 만든다고 했는데 실제로는 *빈 날* 을 만들고 있었다.
   H14 가 이 시드에 남긴 교훈("검사하려면 그 상태를 만들어라")이 한 단계 더 필요했던 것이다.

   ⚠⚠ **그리고 `weekly` 과목만으로는 부족하다 — 이 파일은 주(週)의 끝에서 깨졌다(실측
   2026-08-01 토).** 주간 과목은 **주 예산으로 배분**되므로 그 주의 남은 이틀(토·일)에는
   배치가 0 일 수 있다(실측: 08-01 토 0 · 08-02 일 0 · 08-03 월 1). 용량이 없어서가 아니라
   (그날도 studyMin 780 · 모듈 5칸) 이번 주 몫이 이미 앞쪽 날짜로 갔기 때문이고, **그건
   스케줄러가 맞다.** 틀린 것은 "주간 과목 하나면 오늘 블록이 있다"고 가정한 시드다.
   → `daily` 과목을 하나 더 심는다. `daily` 는 마감까지 **매일** 고정 분을 확보하므로
   요일·주차와 무관하게 오늘 블록이 최소 하나 있다(실측: 7일 전부 ≥1).
   ⚠ `_today` 를 못박는 우회로는 **안 통한다**(시도했다): `schedule()` 의 날짜 범위는 실시계에서
   오고 `todayISO(state)` 만 시드를 따르므로, 둘이 갈려 오늘이 계획 범위 밖으로 나간다.
   이 파일은 아래에서 이미 같은 교훈을 적어 뒀다 — _"벽시계에 따라 답이 달라지는 단언은 그
   자체가 결함이다"_ — 그때는 **시각**만 고쳤고 **요일·주차**가 남아 있었다. */
beforeEach(() => {
  useApp.getState().mutate((st) => {
    st.rituals = {};
    if (!st.items.some((i) => i.name)) {
      st.items.push({
        id: 'seed',
        name: '테스트 과목',
        mode: 'weekly',
        weeklyHours: 5,
        // 형태는 `schema.ts` 의 `ChapterSchema` 그대로 — `{name, deadline, mastery}` 같은 임의
        // 형태를 `as never` 로 밀어 넣으면 통과는 하지만 스케줄러가 배치할 것을 못 찾는다.
        chapters: [
          { id: 'c1', name: '1장', hours: 3, done: false },
          { id: 'c2', name: '2장', hours: 3, done: false },
        ],
      } as never);
      // 요일·주차와 무관하게 오늘 블록을 보장하는 쪽(머리주석 ⚠⚠).
      st.items.push({ id: 'seed-daily', name: '매일 과목', mode: 'daily', dailyMin: 30, chapters: [] } as never);
    }
  });
});
afterEach(() => cleanup());

test('today: React 카드(대시보드 히어로·오늘의 흐름)가 뜨고 #page를 쓰지 않는다', async () => {
  renderApp('/today');
  await waitFor(() => expect(screen.getByLabelText('오늘 대시보드')).toBeInTheDocument());
  // 단일 초점 히어로 — kicker(지금/다음/오늘 할 일·오늘 학습).
  const hero = screen.getByLabelText('오늘 대시보드');
  expect(within(hero).getByText(/^(지금 할 일|다음 할 일|오늘 할 일|오늘 학습)$/)).toBeInTheDocument();
  /* E8 — `이번 주 N h` 는 스트립에서 빠졌다. 오늘의 판단이 아니라 주(週)의 조망이고,
     `/schedule` 이 그 질문을 소유하는 화면이다(매일 보이지만 매일 쓸모는 없던 자리). */
  expect(within(hero).queryByText('이번 주')).toBeNull();
  // 흐름 레일 헤딩(블록 체크리스트를 흡수한 now-중심 타임라인).
  expect(screen.getByRole('heading', { name: /^오늘의 흐름/ })).toBeInTheDocument();
  expect(document.getElementById('page')).toBeNull();
});

test('today: 아침 계획 의식 토글이 store.rituals에 기록된다', async () => {
  renderApp('/today');
  // 의식·블록 상세는 단일 화면 대시보드의 "＋ 블록 상세 · 일일 의식" 패널 안에 있음 — 먼저 연다.
  fireEvent.click(await screen.findByRole('button', { name: /일일 의식/ }));
  const cb = await screen.findByRole('checkbox', { name: /아침 계획/ });
  fireEvent.click(cb);

  const ds = iso(new Date());
  await waitFor(() => expect(useApp.getState().state.rituals?.[ds]?.plan).toBe(true));
});

test('today: ID-5 오늘의 모양 — 완료·요약 있으면 셧다운 회고 한 줄이 뜬다', async () => {
  const ds = iso(new Date());
  useApp.getState().mutate((st) => {
    st.completions = { [ds]: { 'm|new': { done: true, min: 60 }, 'p|new': { done: true, min: 30 } } };
    st.summaries = { [ds]: [{ id: 'a', sid: 'm', name: '미적분', s1: 'x', s2: 'y', s3: '극한의 정의를 다시 정리' }] };
  });
  renderApp('/today');
  fireEvent.click(await screen.findByRole('button', { name: /일일 의식/ })); // 상세 오버레이 열기
  /* ⚠⚠ **오버레이 안으로 범위를 좁힌다 — 안 좁히면 이 테스트는 저녁에만 깨진다.**
     '오늘의 모양'은 두 곳에서 렌더된다: 여기 의식 카드(`Today.tsx` · 잴 것이 있으면 언제나)와
     시그니처(`TodaySignature` · **`dayPhase`가 `closing`일 때만**). 늦은 시각엔 남은 가용이
     가장 짧은 블록보다 작아져 `closing`이 참이 되고, 그러면 화면에 둘 다 떠서
     `findByText`가 "Found multiple elements"로 죽는다.
     실제로 2026-07-26(N-5 국면 도입) 이후 **저녁에 게이트를 돌렸다면 늘 실패했을** 테스트였다 —
     게이트가 늘 낮에 돌아 안 보였을 뿐이고, 2026-07-29 21:39 커밋에서 처음 드러났다.
     벽시계에 따라 답이 달라지는 단언은 그 자체가 결함이다(`e2e`가 `boot(at)`으로 시각을
     고정하는 것과 같은 이유). 여기서 보려는 것은 **의식 오버레이의 회고 한 줄**이므로
     그 컨테이너 안에서만 찾으면 국면과 무관해진다. */
  const sheet = within(await screen.findByRole('dialog', { name: '오늘 상세' }));
  expect(await sheet.findByText(/오늘의 모양/)).toBeInTheDocument();
  expect(sheet.getByText(/극한의 정의를 다시 정리/)).toBeInTheDocument();
  // cleanup: 다음 테스트에 새지 않게.
  useApp.getState().mutate((st) => {
    st.completions = {};
    st.summaries = {};
  });
});

/* ── E8 스트립도 침묵한다(2026-07-29) ────────────────────────────────────
   `store/selectors.ts` 가 레일 신호에 대해 못박은 계약 — "0·평온은 아무것도 안 그린다.
   매일 0을 외치면 신호가 죽는다" — 이 스트립에서만 정반대로 돌고 있었다(`마감 임박 없음` ·
   `열린 보충 0 건` · `의식 ☐ ☐`). 한 저장소 안에 침묵의 규칙이 둘일 수는 없다.

   ⚠ 스냅샷으로는 이걸 못 잡는다: all-clear 화면이 스냅샷에 있어도 "없음"이 정답으로 굳으면
   그대로 통과한다(§15-4 가 반복해 물린 형태). 계약은 여기서 문장으로 잠근다. */
test('today: 마감·Anki·보충이 전부 비면 하단 스트립이 통째로 없다', async () => {
  useApp.getState().mutate((st) => {
    st.items = [{ id: 'seed', name: '테스트 과목', mode: 'weekly', weeklyHours: 5, chapters: [] }] as never;
    st.backlog = [];
    st.cbms = [];
    delete st._ankiLive;
  });
  renderApp('/today');
  await waitFor(() => expect(screen.getByLabelText('오늘 대시보드')).toBeInTheDocument());
  const hero = screen.getByLabelText('오늘 대시보드');
  // 0을 말하는 문구가 하나도 없다 — 있으면 그게 매일 반복되는 소음이다.
  expect(within(hero).queryByText('마감 임박')).toBeNull();
  expect(within(hero).queryByText('열린 보충')).toBeNull();
  expect(within(hero).queryByText('Anki 대기')).toBeNull();
  expect(within(hero).queryByText('없음')).toBeNull();
  // 의식 토글도 여기 없다(같은 토글이 앱 안에 셋이었다 — 닫는 길 CTA 가 소유한다).
  expect(within(hero).queryByText('의식')).toBeNull();
});
