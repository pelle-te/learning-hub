// @vitest-environment jsdom
/* ============================================================
   formSubmit.test.tsx — 폼 키 계약(N-17)을 **실제 카드에서** 잰다.

   훅만 단위로 재면 "붙였는가"가 검사되지 않는다. 그리고 이 항목의 결함은 정확히 *안 붙어
   있던 것*이었다 — `SummaryCard` 의 textarea 셋엔 아무 키 계약이 없어, 이 앱에서 가장 잦은
   일일 기록인 3문장 요약만 유일하게 마우스로 버튼을 눌러야 저장됐다.

   ⚠⚠ IME 케이스가 이 파일의 핵심이다. 옛 핸들러(`e.key === 'Enter' && submit()`)엔 조합
   가드가 없어서, 한글 마지막 음절을 **확정하는** Enter 에 덜 친 내용이 제출됐다. 한국어로만
   쓰는 앱의 한글 입력 칸 7곳이 전부 그랬고, 증상("가끔 반쯤 친 게 저장됨")이 재현 조건을
   모르면 사용자 실수로 읽힌다 — 그래서 사람 눈에 못 맡긴다.
============================================================ */
import { afterEach, beforeEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import SummaryCard from '@/features/day/SummaryCard';
import BacklogCard from '@/features/day/BacklogCard';
import { useApp } from '@/store/useApp';
import { summariesFor, openBacklog } from '@/lib/methodology';

const DS = '2026-07-26';
const app = () => useApp.getState().state;

beforeEach(() => {
  useApp.getState().mutate((s) => {
    s._today = DS;
    s.summaries = {};
    s.backlog = [];
    s.items = [{ id: 'em', name: '전자기학', mode: 'weekly', weeklyHours: 4, chapters: [] }];
  });
});
afterEach(() => {
  cleanup();
  useApp.getState().mutate((s) => {
    s.summaries = {};
    s.backlog = [];
    s.items = [];
    delete s._today;
  });
});

const s1 = () => screen.getByLabelText(/What/);
const enter = (el: HTMLElement, init: Record<string, unknown> = {}) => fireEvent.keyDown(el, { key: 'Enter', ...init });

test('⌘Enter 가 3문장 요약을 저장한다 — 종전엔 마우스밖에 길이 없었다', () => {
  render(<SummaryCard ds={DS} />);
  fireEvent.change(s1(), { target: { value: '변위전류로 파동방정식을 세웠다' } });
  enter(s1(), { ctrlKey: true });
  expect(summariesFor(app(), DS)).toHaveLength(1);
});

test('여러 줄 칸의 맨 Enter 는 줄바꿈이다 — 제출이 아니다', () => {
  render(<SummaryCard ds={DS} />);
  fireEvent.change(s1(), { target: { value: '첫 문장' } });
  enter(s1());
  expect(summariesFor(app(), DS)).toHaveLength(0);
});

/* ⚠ 선재 결함 — 조합 중 Enter 는 "확정"이지 "제출"이 아니다. */
test('⚠ IME 조합 중 Enter 는 제출하지 않는다(한글 확정 Enter)', () => {
  render(<BacklogCard />);
  const topic = screen.getByLabelText('막힌 주제');
  fireEvent.change(topic, { target: { value: '변위전류 막힘' } });
  enter(topic, { isComposing: true });
  expect(openBacklog(app()), '조합 확정 Enter 에 덜 친 내용이 제출됐다').toHaveLength(0);
  // 조합이 끝난 뒤의 Enter 는 정상 제출이다(가드가 기능을 죽이지 않았다).
  enter(topic);
  expect(openBacklog(app())).toHaveLength(1);
});

test('한 줄 칸의 맨 Enter 제출은 그대로다 — 기존 계약 회귀', () => {
  render(<BacklogCard />);
  const topic = screen.getByLabelText('막힌 주제');
  fireEvent.change(topic, { target: { value: '경계조건 법선성분' } });
  enter(topic);
  expect(openBacklog(app())[0]!.topic).toBe('경계조건 법선성분');
});

test('편집 폼에서 Esc 가 취소한다 — 세 카드 모두 없던 계약', () => {
  useApp.getState().mutate((s) => {
    // ⚠ 부분 픽스처 — 이 케이스는 Esc 취소만 본다(`doneDs` 는 안 읽는다).
    s.backlog = [{ id: 'b1', ds: DS, sid: 'em', name: '전자기학', topic: '원본 주제', note: '', done: false } as never];
  });
  render(<BacklogCard />);
  fireEvent.click(screen.getByTitle('수정'));
  const field = screen.getByLabelText('막힌 주제', { selector: '#bl-edit-topic-b1' });
  fireEvent.change(field, { target: { value: '고치다 만 것' } });
  fireEvent.keyDown(field, { key: 'Escape' });
  // 편집 폼이 닫히고 원본이 그대로여야 한다(취소는 저장이 아니다).
  expect(screen.queryByText('저장')).not.toBeInTheDocument();
  expect(openBacklog(app())[0]!.topic).toBe('원본 주제');
});
