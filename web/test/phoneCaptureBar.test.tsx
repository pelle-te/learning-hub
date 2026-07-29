// @vitest-environment jsdom
/* ============================================================
   phoneCaptureBar.test.tsx — 폰 캡처 입구(E14 · 2026-07-29).

   ⚠ 왜 e2e 가 아닌가: 폰은 미연결이면 **등록 화면**에서 멈춰 이 바에 닿을 수 없고, 정본이
   SQLite(OPFS)라 트랙 A 의 localStorage 시드도 안 닿는다(`phoneReviewView.test.tsx` 와 같은 이유).

   여기서 잠그는 것은 **배관**이다: 담으면 실제로 레코드가 생기는가 · 파싱 결과가 실리는가 ·
   원문이 사라지지 않는가 · 되돌리기가 그 한 건만 지우는가.
============================================================ */
import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import CaptureBar from '@/phone/CaptureBar';
import { useApp } from '@/store/useApp';

afterEach(() => {
  cleanup();
  useApp.getState().mutate((st) => {
    st.backlog = [];
    st.items = [];
  });
});

const bl = () => useApp.getState().state.backlog || [];
const type = (v: string) => fireEvent.change(screen.getByLabelText('빠른 캡처'), { target: { value: v } });
const submit = () => fireEvent.click(screen.getByRole('button', { name: '담기' }));

test('폰 캡처: 친 문장이 즉시 보충으로 담긴다', () => {
  render(<CaptureBar />);
  type('적분 순서 바꾸는 조건이 헷갈림');
  submit();
  expect(bl()).toHaveLength(1);
  expect(bl()[0]!.topic).toBe('적분 순서 바꾸는 조건이 헷갈림');
});

test('폰 캡처: 파싱된 과목이 레코드에 실린다 — 데스크톱과 같은 규칙(captureRecord)', () => {
  useApp.getState().mutate((st) => {
    st.items = [{ id: 'em', name: '전자기학', source: '직접', mode: 'weekly', weeklyHours: 4, chapters: [] }] as never;
  });
  render(<CaptureBar />);
  type('내일 전자기학 복습');
  submit();
  const rec = bl()[0]!;
  expect(rec.sid).toBe('em');
  expect(rec.name).toBe('전자기학');
  // 원문은 어느 칸에든 온전히 남는다(captureRecord 의 유일한 불변식).
  expect([rec.topic, rec.note]).toContain('내일 전자기학 복습');
});

test('폰 캡처: 빈 입력은 아무것도 만들지 않는다', () => {
  render(<CaptureBar />);
  submit();
  expect(bl()).toHaveLength(0);
});

test('폰 캡처: 되돌리기는 **방금 담은 그 한 건만** 지운다', () => {
  useApp.getState().mutate((st) => {
    st.backlog = [
      { id: 'old', ds: '2026-07-01', sid: '', name: '', topic: '먼저 있던 것', note: '', done: false, doneDs: '' },
    ] as never;
  });
  render(<CaptureBar />);
  type('새로 담는 것');
  submit();
  expect(bl()).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: '되돌리기' }));
  expect(bl()).toHaveLength(1);
  expect(bl()[0]!.topic).toBe('먼저 있던 것'); // 목록 끝을 지우는 방식이면 여기서 깨진다
});

test('폰 캡처: 담은 뒤 입력이 비고 확인 줄이 뜬다 — 폰엔 토스트가 없다', () => {
  render(<CaptureBar />);
  type('무언가');
  submit();
  expect(screen.getByLabelText('빠른 캡처')).toHaveValue('');
  expect(screen.getByRole('status')).toHaveTextContent('보충에 담았어요');
});
