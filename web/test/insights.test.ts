/* ============================================================
   insights.test.ts — 회고 코칭 & 반복 약점(순수·결정적) 회귀.
============================================================ */
import { describe, expect, it } from 'vitest';
import { dayShape, dominantCbms, weakCountBySid, weakSpots, weeklyInsights } from '@/lib/insights';
import type { AppState, CbmsCode } from '@/lib/types';

let _n = 0;
const cbms = (ds: string, name: string, chapter: string, code: CbmsCode) => ({
  id: 'c' + ++_n,
  ds,
  sid: name === '수학' ? 'm' : 'p',
  name,
  chapter,
  code,
  note: '',
});
const bl = (topic: string) => ({
  id: 'b' + ++_n,
  ds: '2026-07-01',
  sid: '',
  name: '읽을거리',
  topic,
  note: '',
  done: false,
  doneDs: '',
});
const blank = (ds: string, passed: boolean) => ({ id: 'k' + ++_n, ds, sid: 'm', name: '수학', passed, note: '' });

const st = (over: Record<string, unknown>): AppState => ({ items: [], ...over }) as unknown as AppState;

const WK = '2026-06-29'; // 그 주 월요일(ds0) — ds6 = 07-05, 지난주 = 06-22~06-28

describe('insights — dayShape (ID-5 오늘의 모양)', () => {
  const D = '2026-06-30';
  it('그날 완료 과목수·세션·분 집계 + 마지막 요약의 마지막 문장', () => {
    const state = st({
      completions: {
        [D]: {
          'm|new': { done: true, min: 60 },
          'm|rev': { done: true, min: 30 },
          'p|new': { done: true, min: 45 },
          's|new': { done: false, min: 20 }, // 미완료 → 제외
        },
      },
      summaries: {
        [D]: [
          { id: 'a', sid: 'm', name: '수학', s1: 'x', s2: 'y', s3: '극한은 근방의 수렴' },
          { id: 'b', sid: 'p', name: '물리', s1: '관성', s2: '', s3: '' }, // 마지막 요약 → s3 없어 s1
        ],
      },
    });
    const sh = dayShape(state, D);
    expect(sh.subjects).toBe(2); // m, p (완료만)
    expect(sh.sessions).toBe(3);
    expect(sh.focusMin).toBe(135);
    expect(sh.learned).toBe('관성'); // 마지막 요약(b)의 s3 없어 s1 폴백
  });

  it('완료·요약 없으면 0·빈 문자열(UI 가 숨김)', () => {
    const sh = dayShape(st({ completions: {}, summaries: {} }), D);
    expect(sh).toMatchObject({ subjects: 0, sessions: 0, focusMin: 0, learned: '' });
  });
});

describe('insights — dominantCbms', () => {
  it('최다 코드가 2건↑·40%↑면 반환, 아니면 null', () => {
    expect(dominantCbms({ C: 3, B: 1, M: 0, S: 0, T: 0 })).toEqual({ code: 'C', n: 3, total: 4 });
    expect(dominantCbms({ C: 1, B: 1, M: 0, S: 0, T: 0 })).toBeNull(); // n<2
    expect(dominantCbms({ C: 2, B: 2, M: 2, S: 0, T: 0 })).toBeNull(); // 33%<40%
    expect(dominantCbms({ C: 0, B: 0, M: 0, S: 0, T: 0 })).toBeNull(); // 전무
  });
});

describe('insights — weakSpots', () => {
  it('(과목·챕터)로 묶어 2회↑ 지점, count 큰 순', () => {
    const s = st({
      cbms: [
        cbms('2026-06-30', '수학', '미적분', 'C'),
        cbms('2026-07-01', '수학', '미적분', 'M'),
        cbms('2026-07-02', '수학', '미적분', 'C'),
        cbms('2026-07-02', '물리', '역학', 'C'), // 1회 → 제외
      ],
    });
    const ws = weakSpots(s);
    expect(ws).toHaveLength(1);
    expect(ws[0]!.subject).toBe('수학');
    expect(ws[0]!.chapter).toBe('미적분');
    expect(ws[0]!.count).toBe(3);
    expect(ws[0]!.codes.sort()).toEqual(['C', 'M']); // 중복 코드 제거
  });

  it('빈 chapter는 무시', () => {
    const s = st({ cbms: [cbms('2026-07-01', '수학', '', 'C'), cbms('2026-07-02', '수학', '', 'C')] });
    expect(weakSpots(s)).toHaveLength(0);
  });
});

describe('insights — weakCountBySid', () => {
  it('sid별로 2회+ 막힌 지점의 count를 롤업한다', () => {
    const s = st({
      cbms: [
        cbms('2026-06-30', '수학', '미적분', 'C'), // m|미적분 (2회 → 포함)
        cbms('2026-07-01', '수학', '미적분', 'M'),
        cbms('2026-07-02', '수학', '선형대수', 'C'), // m|선형대수 (2회 → 포함)
        cbms('2026-07-03', '수학', '선형대수', 'C'),
        cbms('2026-07-02', '물리', '역학', 'C'), // p|역학 1회 → 제외
      ],
    });
    const by = weakCountBySid(s);
    expect(by['m']).toBe(4); // 미적분 2 + 선형대수 2
    expect(by['p']).toBeUndefined(); // 1회뿐이라 weakSpots에서 탈락
  });
  it('데이터 없으면 빈 객체', () => {
    expect(weakCountBySid(st({}))).toEqual({});
  });
});

describe('insights — weeklyInsights', () => {
  it('오답 쏠림·반복 약점·백지 저조·유지율·보충을 warn 우선으로', () => {
    const s = st({
      cbms: [
        cbms('2026-06-30', '수학', '미적분', 'C'),
        cbms('2026-07-01', '수학', '미적분', 'C'),
        cbms('2026-07-02', '수학', '미적분', 'M'),
      ],
      blankResults: [blank('2026-07-01', false), blank('2026-07-02', false)], // 통과율 0%
      backlog: [bl('a'), bl('b'), bl('c')], // 열린 3
      retentionLog: [
        { wk: '2026-06-22', at: '', due: 10, cards: 100 },
        { wk: '2026-06-29', at: '', due: 40, cards: 100 }, // +30, 40장 → 넛지
      ],
    });
    const ins = weeklyInsights(s, WK);
    const kinds = ins.map((i) => i.kind);
    expect(kinds).toContain('cbms');
    expect(kinds).toContain('weakspot');
    expect(kinds).toContain('blank');
    expect(kinds).toContain('retention');
    expect(kinds).toContain('backlog');
    // warn이 info보다 앞(정렬)
    const lastWarn = ins.map((i) => i.tone).lastIndexOf('warn');
    const firstInfo = ins.map((i) => i.tone).indexOf('info');
    expect(lastWarn).toBeLessThan(firstInfo);
  });

  it('백지 통과율 개선이면 good 톤', () => {
    const s = st({
      blankResults: [
        blank('2026-06-23', true),
        blank('2026-06-24', false), // 지난주 50%
        blank('2026-06-30', true),
        blank('2026-07-01', true), // 이번주 100%
      ],
    });
    const ins = weeklyInsights(s, WK);
    const blankIns = ins.find((i) => i.kind === 'blank');
    expect(blankIns).toBeDefined();
    expect(blankIns!.tone).toBe('good');
  });

  it('데이터 없으면 빈 배열', () => {
    expect(weeklyInsights(st({}), WK)).toEqual([]);
  });
});
