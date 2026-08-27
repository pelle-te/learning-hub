// @vitest-environment jsdom
/* ============================================================
   reviewRunTab.test.tsx — 복습 세션 러너(I-9) 컴포넌트 회귀.
   빈 큐 폴백 + 회상 카드 흐름(카드 렌더 → 전진 → 세션 완료 리캡).
============================================================ */
import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { renderApp } from './_render';
import { useApp } from '@/store/useApp';

/** ⚠ 렌더 헬퍼는 `test/_render` 한 벌이다(M-12) — 여기 남는 것은 **location state 전달**뿐이다. */
const renderRun = (path: string, state?: unknown) => renderApp(path, { state });

afterEach(() => {
  cleanup();
  useApp.getState().mutate((st) => {
    delete st._today;
    st.summaries = {};
    st.cbms = [];
    st.items = [];
    st.reviewTouches = {};
  });
});

test('review-run: 복습할 게 없으면 깨끗함 폴백', async () => {
  useApp.getState().mutate((st) => {
    st._today = '2026-07-08';
    st.items = [];
    st.summaries = {};
    st.cbms = [];
    st.completions = {};
  });
  await renderRun('/review-run');
  expect(await screen.findByText('복습할 게 없어요')).toBeInTheDocument();
});

/** 회상 카드 1장짜리 세션(4일 전 요약 → pickRetrieval 이 카드 생성 · minAge 2일↑). */
function seedOneRetrieval() {
  useApp.getState().mutate((st) => {
    st._today = '2026-07-08';
    st.items = [];
    st.cbms = [];
    st.completions = {};
    st.summaries = { '2026-07-04': [{ id: 'r1', sid: 's1', name: '선형대수', s1: 'a', s2: 'b', s3: 'c' }] };
  });
}
const press = (key: string) => fireEvent.keyDown(document, { key });

test('review-run: 회상 카드 흐름 — 렌더 → 펼침 → 판정 → 세션 완료', async () => {
  seedOneRetrieval();
  await renderRun('/review-run');
  expect(await screen.findByText('회상')).toBeInTheDocument();
  // 발치 키캡 바가 카드의 옛 버튼 무리를 대신한다(D-3) — 키캡은 진짜 버튼이다.
  // ⚠ 펼치기 전엔 판정 칩(2)이 **바에 없다** — 있으면 Space 와 같은 일을 하는 칩이 둘이 된다.
  expect(screen.queryByRole('button', { name: /다시 설명했어요/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /원래 요약 펼치기/ }));
  fireEvent.click(screen.getByRole('button', { name: /다시 설명했어요/ }));
  expect(await screen.findByText('복습 세션 완료')).toBeInTheDocument();
  expect(screen.getByText(/카드 1장 중/)).toBeInTheDocument();
});

/* ── N-7 이어하기 착지 ───────────────────────────────────────────────────
   칩이 `(7/12)` 를 약속하는 동안 러너는 언제나 0 에서 열렸다 — `resume.ts` 머리주석이 이
   기능의 존재 이유로 든 중복 학습을 기능이 **보장**하던 자리다.

   ⚠ **긍정문으로 잠근다.** "0 에서 시작하지 않는다"만 단언하면 착지가 엉뚱한 카드로 가도
   통과한다(N-1 이 물린 "부정문만 있는 검사"). 몇 번째 카드인지를 직접 본다.
   ⚠ 짝이 되는 음성 테스트가 더 중요하다: 내비 state 없이 그냥 열면 **반드시** 1장부터다.
   그게 깨지면 레일·⌘K 로 연 사람이 묻지도 않고 중간에서 시작한다. */
/** 2장짜리 세션 — 회상(요약) + 유지(끝낸 챕터). 회상·착각은 각각 최대 1장이라 종류를 섞는다. */
function seedTwoCards() {
  useApp.getState().mutate((st) => {
    st._today = '2026-07-08';
    st.cbms = [];
    st.completions = {};
    st.summaries = { '2026-07-04': [{ id: 'r1', sid: 's1', name: '선형대수', s1: 'a', s2: 'b', s3: 'c' }] };
    st.items = [
      {
        id: 'p',
        name: '물리',
        source: '직접',
        mode: 'weekly',
        weeklyHours: 4,
        chapters: [{ id: 'c1', name: '역학', hours: 2, done: true }],
      },
    ] as never;
  });
}

test('review-run: 이어하기로 오면 그 카드에서 시작한다(N-7 착지)', async () => {
  seedTwoCards();
  await renderRun('/review-run', { resumeAt: 1 });
  // 1장을 건너뛰고 2번째 카드(유지)에 착지 — 회상 카드는 이미 다른 기기에서 봤다.
  expect(await screen.findByText('유지')).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-label', '복습 진행 2 / 2');
  // 건너뛴 카드가 있다는 사실을 말하고, 되돌아갈 길을 함께 준다.
  expect(screen.getByText(/다른 기기에서 1장까지 봤어요/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '처음부터 보기' }));
  expect(await screen.findByText('회상')).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-label', '복습 진행 1 / 2');
});

test('review-run: 그냥 열면 언제나 1장부터 — 이어하기는 기본값이 아니라 의도다', async () => {
  seedTwoCards();
  await renderRun('/review-run');
  expect(await screen.findByText('회상')).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-label', '복습 진행 1 / 2');
  expect(screen.queryByText(/다른 기기에서/)).toBeNull();
});

/* ── D-3 키보드 계약 ─────────────────────────────────────────────────────
   이 화면엔 keydown 이 0개였다. 계약 자체가 새 표면이라 각 키를 잠근다 — 특히
   "대조 없는 판정 금지"는 어기면 **조용히** 거짓 기록을 만든다(눈에 안 보인다). */
test('review-run 키: Space 펼치기 → 2 판정 → 완료', async () => {
  seedOneRetrieval();
  await renderRun('/review-run');
  await screen.findByText('회상');
  expect(screen.queryByText('a')).toBeNull(); // 아직 원래 요약은 감춰져 있다
  press(' ');
  expect(await screen.findByText('a')).toBeInTheDocument();
  press('2');
  expect(await screen.findByText('복습 세션 완료')).toBeInTheDocument();
});

test('review-run 키: 펼치기 전 2 는 판정이 아니라 펼치기다(대조 없는 인출 기록 금지)', async () => {
  seedOneRetrieval();
  await renderRun('/review-run');
  await screen.findByText('회상');
  press('2');
  // 세션이 끝나지 않았고, 대신 원래 요약이 펼쳐졌다.
  expect(screen.queryByText('복습 세션 완료')).toBeNull();
  expect(await screen.findByText('a')).toBeInTheDocument();
});

test('review-run 키: 1 은 펼치기 전에도 건너뛴다 — 인출로 세지 않는다', async () => {
  seedOneRetrieval();
  await renderRun('/review-run');
  await screen.findByText('회상');
  press('1');
  expect(await screen.findByText('복습 세션 완료')).toBeInTheDocument();
  expect(screen.getByText(/카드 1장 중/).textContent).toContain('0개를 인출'); // 건너뛰기는 성과가 아니다
});

test('review-run 키: u 는 직전 전진을 되돌린다(빨라진 키의 짝)', async () => {
  seedOneRetrieval();
  await renderRun('/review-run');
  await screen.findByText('회상');
  press('1');
  expect(await screen.findByText('복습 세션 완료')).toBeInTheDocument();
  press('u');
  expect(await screen.findByText('회상')).toBeInTheDocument(); // 카드로 돌아왔다
});

/* N-10 — 끝낸 챕터가 유지 카드로 **실제 러너에** 뜨는지. 유닛(reviewQueue)은 큐 배열까지만 보고,
   배선(`ch.maintenance` 가 카드 문구까지 닿는지)은 여기서만 관측된다. 설명 없는 재등장은
   "앱이 완료를 잊었다"로 읽히므로 문구 자체가 계약이다(§15-4). */
test('review-run: 끝낸 챕터가 유지 카드로 뜨고 왜 돌아왔는지 말한다', async () => {
  useApp.getState().mutate((st) => {
    st._today = '2026-07-08';
    st.summaries = {};
    st.cbms = [];
    st.completions = {};
    st.items = [
      {
        id: 'p',
        name: '물리',
        source: '직접',
        mode: 'weekly',
        weeklyHours: 4,
        chapters: [{ id: 'c1', name: '역학', hours: 2, done: true }], // 앵커 없는 옛 완료 챕터
      },
    ] as never;
  });
  await renderRun('/review-run');
  expect(await screen.findByText('유지')).toBeInTheDocument();
  expect(screen.getByText(/끝낸 챕터인데 마지막으로 본 날이 기록에 없어요/)).toBeInTheDocument();
  // 앵커가 없으면 "N일 방치"를 말하지 않는다 — 모르는 것을 아는 척하지 않는다.
  expect(screen.queryByText(/일 방치/)).not.toBeInTheDocument();
});

/* ── E1 인출이 앵커를 옮긴다(2026-07-29) ─────────────────────────────────
   이 화면은 챕터 카드에 "한 번 인출하면 그때부터 유지 주기가 잡힙니다"라고 **약속해 놓고
   그 경로를 주지 않았다** — `touchReview` 의 쓰기 호출부가 `FocusChip` 하나였고, 그건 25분
   세션 완주 + 토스트 클릭까지 요구했다. 유닛(persistence)은 함수만 보고, **배선**(키 → 앱 상태)은
   여기서만 관측된다.

   ⚠ 반증이 본체다: `2`(집중 시작)가 앵커를 옮기면 안 된다. 옮기면 공부 없이 키만 눌러도
   망각곡선이 리셋되고, 그건 조용하다. */
/** 유지 카드 1장짜리 세션(끝낸 챕터 · 앵커 없음) — sid='p' · chapter='역학'. */
function seedOneMaintenance() {
  useApp.getState().mutate((st) => {
    st._today = '2026-07-08';
    st.summaries = {};
    st.cbms = [];
    st.completions = {};
    st.reviewTouches = {};
    st.items = [
      {
        id: 'p',
        name: '물리',
        source: '직접',
        mode: 'weekly',
        weeklyHours: 4,
        chapters: [{ id: 'c1', name: '역학', hours: 2, done: true }],
      },
    ] as never;
  });
}
const touches = () => useApp.getState().state.reviewTouches || {};

test('review-run 키: 3 은 앵커를 오늘로 옮긴다 — 화면이 한 약속을 실제로 지킨다', async () => {
  seedOneMaintenance();
  await renderRun('/review-run');
  await screen.findByText('유지');
  expect(touches()['p|역학']).toBeUndefined();
  press('3');
  expect(await screen.findByText('복습 세션 완료')).toBeInTheDocument();
  expect(touches()['p|역학']).toBe('2026-07-08');
});

test('review-run 키: 2(집중 시작)는 앵커를 옮기지 **않는다** — 세션 시작은 인출 사건이 아니다', async () => {
  seedOneMaintenance();
  await renderRun('/review-run');
  await screen.findByText('유지');
  press('2');
  expect(await screen.findByText('복습 세션 완료')).toBeInTheDocument();
  // 25분을 실제로 보고 완료해야 FocusChip 이 옮긴다. 여기서 옮기면 키 연타가 곧 리셋이 된다.
  expect(touches()['p|역학']).toBeUndefined();
});

test('review-run 키: 1(건너뛰기)도 앵커를 안 옮긴다', async () => {
  seedOneMaintenance();
  await renderRun('/review-run');
  await screen.findByText('유지');
  press('1');
  expect(await screen.findByText('복습 세션 완료')).toBeInTheDocument();
  expect(touches()['p|역학']).toBeUndefined();
});

test('review-run 키: u 는 앵커까지 되돌린다 — 화면과 모델이 갈리지 않는다', async () => {
  seedOneMaintenance();
  await renderRun('/review-run');
  await screen.findByText('유지');
  press('3');
  expect(await screen.findByText('복습 세션 완료')).toBeInTheDocument();
  expect(touches()['p|역학']).toBe('2026-07-08');
  press('u');
  expect(await screen.findByText('유지')).toBeInTheDocument();
  // 세션만 물리고 앵커를 두고 오면 "물렸는데 인출한 것으로 남는" 조용한 어긋남이 된다.
  expect(touches()['p|역학']).toBeUndefined();
});

/* ── E6 과신 카드가 오답으로 착지한다(2026-07-29) ────────────────────────
   완주 화면은 "될 줄 알았는데 안 된 게 N개(과신)"라 말하고 **끝났다**. `insights.ts` 가 그
   방향을 "가장 위험한 부류"라 적어 두고도 다음 행동이 없던 자리이고, 그 마찰이 CBMS 0행의
   직접 원인이다(3화면·6클릭이면 아무도 안 한다). */
/* ⚠ 옛 제목은 _"…이름으로 서고, **오답 폼으로 보낸다**"_ 였다. 그 버튼(`오답으로 남기기 →`)은
   **P-2 에서 은퇴했다**(2026-08-01) — `/journal` 로 보내는 길이라 러너 문맥을 잃고 필드를 넷
   다시 채워야 했고, 그래서 `cbms` 가 0행이었다. 지금은 `1`(못 떠올림) **직후 그 자리**에서
   1키로 커밋된다(아래 케이스가 그걸 잠근다). 완주 화면은 여전히 과신을 *짚지만*, 남기는 것은
   세션 중에 이미 끝나 있다. */
test('review-run: 과신 카드가 완주 화면에 이름으로 선다', async () => {
  seedOneRetrieval();
  await renderRun('/review-run');
  await screen.findByText('회상');
  // 펼치기 전 예측 — "떠오를 듯"이라 답하고
  fireEvent.click(screen.getByRole('button', { name: '떠오를 듯' }));
  // 실제로는 건너뛴다 → predicted=true · recalled=false = 과신
  press('1');
  expect(await screen.findByText('복습 세션 완료')).toBeInTheDocument();
  // 어떤 카드였는지를 말한다 — 카운트만으로는 무엇을 남길지 알 수 없다.
  // ⚠ 그 줄 **안에서** 찾는다: P-2 의 "왜 막혔나" 한 줄도 같은 과목명을 말하므로(둘 다 방금 그
  //   카드에 대한 문장이다) 화면 전체에서 찾으면 "Found multiple"로 죽는다.
  const line = screen.getByText(/될 줄 알았는데 안 됐어요/).closest('p')!;
  expect(within(line).getByText('선형대수')).toBeInTheDocument();
  // 은퇴한 경로가 되살아나지 않게 못박는다(재추가 금지 · 근거는 로드맵 P-2).
  expect(screen.queryByRole('button', { name: /오답으로 남기기/ })).toBeNull();
});

/* ── P-2 러너 인라인 CBMS(2026-08-01) ────────────────────────────────────────
   여기서 잠그는 것은 **경로의 길이**다. 종전에 러너에서 오답을 남기는 길은 완주 화면의 버튼
   하나였고 그것도 `/journal` 이동이라 3화면·6클릭이었다 — 이 파일이 검사하던 그 버튼이
   `cbms` 0행의 원인이었다. 지금은 `1` 다음 키 하나다. */
test('review-run: 못 떠올린 직후 1키로 오답이 남는다(3화면·6클릭 → 키 2번)', async () => {
  seedOneRetrieval();
  useApp.getState().mutate((st) => {
    st.cbms = [];
  });
  await renderRun('/review-run');
  await screen.findByText('회상');
  press('1'); // 못 떠올림 — 카드는 **즉시** 전진하고
  // …방금 넘긴 카드의 "왜 막혔나"가 뜬다(모달이 아니라 한 줄).
  expect(await screen.findByRole('group', { name: '못 떠올린 이유 분류' })).toBeInTheDocument();
  press('c'); // 개념 — 1키 커밋
  await waitFor(() => expect(useApp.getState().state.cbms?.length).toBe(1));
  const rec = useApp.getState().state.cbms![0]!;
  expect(rec.code).toBe('C');
  // 문맥이 과목을 이미 안다 — 사용자가 고른 필드는 코드 하나뿐이다(필드 4→1).
  expect(rec.name).toBe('선형대수');
});

test('review-run: 유형을 안 고르고 지나가면 아무것도 안 남는다(순손실 0)', async () => {
  seedOneRetrieval();
  useApp.getState().mutate((st) => {
    st.cbms = [];
  });
  await renderRun('/review-run');
  await screen.findByText('회상');
  press('1');
  expect(await screen.findByText('복습 세션 완료')).toBeInTheDocument();
  expect(useApp.getState().state.cbms?.length ?? 0).toBe(0);
});

test('review-run: 예측이 맞았으면 과신 항목이 안 뜬다 — 성공에 마찰을 걸지 않는다', async () => {
  seedOneRetrieval();
  await renderRun('/review-run');
  await screen.findByText('회상');
  fireEvent.click(screen.getByRole('button', { name: '떠오를 듯' }));
  press(' '); // 펼쳐서 대조
  press('2'); // 다시 설명했어요 → recalled=true
  expect(await screen.findByText('복습 세션 완료')).toBeInTheDocument();
  expect(screen.queryByText(/될 줄 알았는데 안 됐어요/)).toBeNull();
});
