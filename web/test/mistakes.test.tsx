// @vitest-environment jsdom
/* ============================================================
   mistakes.test.tsx — 오답 노트(ID-9)의 집계 규칙 + 화면 계약.

   집계(`lib/mistakes`)가 이 기능의 전부에 가깝다 — 화면은 그 결과를 나열할 뿐이다. 그래서
   순수 함수를 두껍게 덮고, 컴포넌트는 **두 빈 상태의 구분**(기록 자체가 없음 vs 필터가 만든 없음)과
   필터·행동만 본다. 클래스·픽셀은 단언하지 않는다(형제 테스트들과 같은 규율).
============================================================ */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { mistakeArchive, mistakeTotals } from '@/lib/mistakes';
import Mistakes from '@/features/mistakes/Mistakes';
import { useApp } from '@/store/useApp';
import type { AppState, Cbms } from '@/lib/types';

afterEach(() => cleanup());

let n = 0;
const cb = (over: Partial<Cbms>): Cbms =>
  ({ id: 'c' + n++, ds: '2026-06-01', sid: 'm', name: '수학', chapter: '1장', code: 'C', note: '', ...over }) as Cbms;
const st = (cbms: Cbms[]): AppState => ({ cbms }) as unknown as AppState;

describe('mistakeArchive — (과목, 챕터) 묶기', () => {
  it('같은 칸을 합치고 횟수·최근일·유형을 모은다', () => {
    const rows = mistakeArchive(
      st([
        cb({ ds: '2026-06-01', code: 'C' }),
        cb({ ds: '2026-06-09', code: 'M' }),
        cb({ ds: '2026-06-05', code: 'C' }),
      ]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.count).toBe(3);
    expect(rows[0]!.lastDs).toBe('2026-06-09');
    expect(rows[0]!.codes).toEqual(['C', 'M']); // 빈도 내림차순
    expect(rows[0]!.topCode).toBe('C'); // 최빈 = '근본원인' 대용
  });

  it('횟수 내림차순 정렬 — 이 화면의 질문은 "무엇이 반복해서 막는가"다', () => {
    const rows = mistakeArchive(
      st([
        cb({ chapter: '한 번', ds: '2026-07-01' }), // 최근이지만 1회
        cb({ chapter: '두 번' }),
        cb({ chapter: '두 번' }),
      ]),
    );
    expect(rows.map((r) => r.chapter)).toEqual(['두 번', '한 번']);
  });

  it('챕터 미기재도 버리지 않는다 — 과목 단위 칸으로 남는다', () => {
    const rows = mistakeArchive(st([cb({ chapter: '' }), cb({ chapter: '  ' })]));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.chapter).toBe('');
    expect(rows[0]!.count).toBe(2);
  });

  it("'확신했는데 틀림'을 따로 센다(단순 횟수와 무게가 다르다)", () => {
    const rows = mistakeArchive(st([cb({ conf: true }), cb({ conf: true }), cb({})]));
    expect(rows[0]!.confident).toBe(2);
    expect(rows[0]!.count).toBe(3);
  });

  it('과목 이름은 **최신 기록 것**을 쓴다(과목을 개명해도 아카이브가 옛 이름으로 안 남는다)', () => {
    const rows = mistakeArchive(
      st([cb({ ds: '2026-06-01', name: '옛이름' }), cb({ ds: '2026-06-20', name: '새이름' })]),
    );
    expect(rows[0]!.subject).toBe('새이름');
  });

  it('메모는 최신순 · 빈 메모는 안 담는다', () => {
    const rows = mistakeArchive(
      st([
        cb({ ds: '2026-06-01', note: '먼저' }),
        cb({ ds: '2026-06-10', note: '나중' }),
        cb({ ds: '2026-06-05', note: '   ' }),
      ]),
    );
    expect(rows[0]!.notes.map((x) => x.text)).toEqual(['나중', '먼저']);
  });

  it('필터(과목·유형)가 행을 좁힌다', () => {
    const s = st([cb({ sid: 'm', code: 'C' }), cb({ sid: 'p', name: '물리', code: 'M' })]);
    expect(mistakeArchive(s, { sid: 'p' }).map((r) => r.subject)).toEqual(['물리']);
    expect(mistakeArchive(s, { code: 'C' }).map((r) => r.subject)).toEqual(['수학']);
    expect(mistakeArchive(s, { sid: 'm', code: 'M' })).toEqual([]);
  });

  it('기록이 없으면 빈 배열 · 집계도 전부 0', () => {
    expect(mistakeArchive({} as AppState)).toEqual([]);
    expect(mistakeTotals([])).toEqual({ spots: 0, records: 0, confident: 0 });
  });

  it('집계는 칸 수·기록 수·확신 오답을 나눈다', () => {
    const rows = mistakeArchive(st([cb({ chapter: 'a', conf: true }), cb({ chapter: 'b' }), cb({ chapter: 'b' })]));
    expect(mistakeTotals(rows)).toEqual({ spots: 2, records: 3, confident: 1 });
  });
});

function renderTab(): void {
  render(
    <MemoryRouter>
      <Mistakes />
    </MemoryRouter>,
  );
}

describe('오답 노트 화면', () => {
  it('기록이 통째로 없으면 무엇을 해야 하는지 말한다(막다른 골목 금지)', () => {
    useApp.getState().mutate((s) => void (s.cbms = []));
    renderTab();
    expect(screen.getByText('아직 오답 기록이 없어요')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /기록하러 가기/ })).toBeInTheDocument();
  });

  it('필터가 만든 빈 상태는 **다른 문장**이다(두 사건의 처방이 다르다)', () => {
    useApp.getState().mutate((s) => void (s.cbms = [cb({ sid: 'm', name: '수학', code: 'C' })]));
    renderTab();
    // 다른 유형으로 좁히면 결과 0 — 그런데 기록 자체는 있으므로 '기록 없음'이 뜨면 안 된다.
    fireEvent.click(screen.getByRole('button', { name: '경계' }));
    expect(screen.getByRole('status')).toHaveTextContent(/필터를 풀어/);
    expect(screen.queryByText('아직 오답 기록이 없어요')).toBeNull();
  });

  it('과목 필터가 다른 과목 행을 감춘다', () => {
    useApp
      .getState()
      .mutate(
        (s) =>
          void (s.cbms = [
            cb({ sid: 'm', name: '수학', chapter: '극한' }),
            cb({ sid: 'p', name: '물리', chapter: '역학' }),
          ]),
      );
    renderTab();
    expect(screen.getByText('극한')).toBeInTheDocument();
    expect(screen.getByText('역학')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '물리' }));
    expect(screen.queryByText('극한')).toBeNull();
    expect(screen.getByText('역학')).toBeInTheDocument();
  });

  it('각 행이 행동을 준다 — 재인출·보충·볼트(아카이브가 읽기 전용으로 끝나지 않게)', () => {
    useApp.getState().mutate((s) => void (s.cbms = [cb({ chapter: '극한' })]));
    renderTab();
    for (const name of ['↻ 다시 인출하기', '보충에 담기', '볼트']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('보충에 담기가 실제로 백로그를 만든다', () => {
    useApp.getState().mutate((s) => {
      s.cbms = [cb({ chapter: '극한' })];
      s.backlog = [];
    });
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: '보충에 담기' }));
    const bl = useApp.getState().state.backlog!;
    expect(bl).toHaveLength(1);
    expect(bl[0]!.topic).toBe('극한');
    expect(bl[0]!.sid).toBe('m');
  });
});
