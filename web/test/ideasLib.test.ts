/* ============================================================
   ideasLib.test.ts — I-1~I-14 신호→행동 파이프의 순수 lib 계약 회귀.
   confTrend·personalBests·seasonPace·shutdownChain·pickConfidentWrong·weeklyRecap·
   frontierNext·백로그 시드·parseCaptureBatch·프리필 배치 큐.
============================================================ */
import { describe, expect, it, beforeEach } from 'vitest';
import { confTrend } from '@/lib/methodology';
import { onThisDay, personalBests, seasonPace, shutdownChain } from '@/lib/records';
import { pickConfidentWrong, confidentWrongCount } from '@/lib/retrieval';
import { jolSummary, weeklyRecap } from '@/lib/insights';
import { frontierNext } from '@/lib/knowledge';
import { backlogFromWeakSpot, backlogFromRootCause } from '@/lib/promote';
import { parseCaptureBatch } from '@/lib/quickCapture';
import { usePrefill } from '@/store/prefill';
import type { AppState, Cbms } from '@/lib/types';

const TODAY = '2026-07-08'; // 수 · mondayOf = 2026-07-06 (이번주 07-06~07-12, 지난주 06-29~07-05)

const cbms = (ds: string, conf: boolean, id = ds): Cbms => ({
  id,
  ds,
  sid: 's1',
  name: '선형대수',
  chapter: '2장',
  code: 'C',
  note: '고유값 착각',
  conf,
  at: 0,
});

/** 완료 세션 목록 → completions 레코드. */
function comps(rows: [ds: string, key: string, min: number][]): AppState['completions'] {
  const out: AppState['completions'] = {};
  for (const [ds, key, min] of rows) (out[ds] = out[ds] || {})[key] = { done: true, min };
  return out;
}

describe('confTrend (I-5) — 과신 오답률 주별 시계열', () => {
  it('weeks 길이·표본게이트(오답0→null)·비율', () => {
    const state = {
      _today: TODAY,
      cbms: [cbms('2026-07-07', true, 'a'), cbms('2026-07-08', false, 'b'), cbms('2026-07-02', false, 'c')],
    } as unknown as AppState;
    const tr = confTrend(state, 6);
    expect(tr.length).toBe(6);
    const thisW = tr[tr.length - 1]!;
    expect(thisW.total).toBe(2);
    expect(thisW.conf).toBe(1);
    expect(thisW.rate).toBe(50);
    const lastW = tr[tr.length - 2]!;
    expect(lastW.total).toBe(1);
    expect(lastW.rate).toBe(0);
    // 오답 없는 과거 주는 rate=null(0%로 오도 금지)
    expect(tr[0]!.rate).toBeNull();
  });
});

describe('personalBests (I-6)', () => {
  it('최장/현재 연속·최고 집중일·주 최다 세션', () => {
    const state = {
      _today: TODAY,
      completions: comps([
        ['2026-07-06', 's1|new', 60],
        ['2026-07-07', 's1|rev', 120],
        ['2026-07-08', 's1|new', 30],
        ['2026-06-20', 's2|new', 45], // 떨어진 과거 하루
      ]),
    } as unknown as AppState;
    const pb = personalBests(state);
    expect(pb.longestStreak).toBe(3);
    expect(pb.currentStreak).toBe(3); // 오늘(07-08)부터 역방향 3일
    expect(pb.bestFocusMin).toBe(120);
    expect(pb.bestFocusDs).toBe('2026-07-07');
    expect(pb.mostSessionsWeek).toBe(3); // 07-06 주에 3세션
    expect(pb.totalDays).toBe(4);
  });

  it('기록 없으면 전부 0', () => {
    const pb = personalBests({ _today: TODAY, completions: {} } as unknown as AppState);
    expect(pb).toMatchObject({ longestStreak: 0, currentStreak: 0, bestFocusMin: 0, totalDays: 0 });
  });
});

describe('onThisDay (ID-4 회고)', () => {
  // TODAY=2026-07-08. −4주=2026-06-10, −1년=2025-07-08. 이력 30일+ 게이트 위해 오래된 완료 하나.
  const summaries = {
    '2026-06-10': [{ id: 'x', sid: 's1', name: '회로이론', s1: '극한의 정의 재정리', s2: '', s3: '' }],
  };
  const base = {
    _today: TODAY,
    completions: comps([['2026-05-01', 's1|new', 60]]), // 68일 전 = 이력 30일+ 충족
    summaries,
  } as unknown as AppState;

  it('−4주 요약을 달력 정합으로 회수(과목+s1 한 줄)', () => {
    const out = onThisDay(base, TODAY);
    expect(out.length).toBeGreaterThanOrEqual(1);
    const wk = out.find((e) => e.daysAgo === 28)!;
    expect(wk.offsetLabel).toBe('4주 전 오늘');
    expect(wk.subject).toBe('회로이론');
    expect(wk.detail).toBe('극한의 정의 재정리');
  });

  it('이력 30일 미만이면 침묵(0의 벽 방지)', () => {
    const young = {
      _today: TODAY,
      completions: comps([['2026-07-01', 's1|new', 60]]), // 7일 전뿐 → 이력 < 30
      summaries,
    } as unknown as AppState;
    expect(onThisDay(young, TODAY)).toEqual([]);
  });

  it('그날 기록 없으면 그 오프셋은 건너뛴다 · 완료만 있으면 분으로 폴백', () => {
    const compOnly = {
      _today: TODAY,
      completions: comps([
        ['2026-05-01', 's1|new', 60], // 이력 게이트용
        ['2026-06-10', 's2|new', 45], // −4주 그날 완료(요약 없음)
      ]),
      summaries: {},
    } as unknown as AppState;
    const out = onThisDay(compOnly, TODAY);
    const wk = out.find((e) => e.daysAgo === 28)!;
    expect(wk.detail).toBe('45분 학습했어요');
    expect(out.some((e) => e.daysAgo === 365)).toBe(false); // −1년엔 기록 없음 → 없음
  });
});

describe('seasonPace (I-7)', () => {
  it('이번주 학습량·페이스 판정', () => {
    const state = {
      _today: TODAY,
      completions: comps([
        ['2026-07-06', 's1|new', 60],
        ['2026-07-07', 's1|rev', 120],
        ['2026-07-08', 's1|new', 30],
      ]),
    } as unknown as AppState;
    const sp = seasonPace(state, 4);
    expect(sp.thisWeekMin).toBe(210);
    expect(sp.weeks.length).toBe(5); // baseline 4 + 이번주
    expect(sp.ahead).toBe(true); // 과거 4주 0분 → 이번주 앞섬
    expect(typeof sp.deltaPct).toBe('number');
  });
});

describe('shutdownChain (I-13)', () => {
  it('연속성 도트 + 오늘부터 역방향 streak', () => {
    const state = {
      _today: TODAY,
      rituals: {
        '2026-07-08': { plan: false, shutdown: true, note: '' },
        '2026-07-07': { plan: false, shutdown: true, note: '' },
        '2026-07-06': { plan: false, shutdown: false, note: '' },
      },
    } as unknown as AppState;
    const ch = shutdownChain(state, 14);
    expect(ch.days.length).toBe(14);
    expect(ch.days[ch.days.length - 1]!.ds).toBe(TODAY);
    expect(ch.streak).toBe(2); // 07-08·07-07 true, 07-06 false에서 끊김
  });
});

describe('pickConfidentWrong / confidentWrongCount (I-10)', () => {
  it('conf가 선 과거 오답만·당일 제외·없으면 null', () => {
    const state = {
      _today: TODAY,
      cbms: [
        cbms('2026-07-06', true, 'past-conf'), // 2일전, conf → 후보
        cbms('2026-07-08', true, 'today-conf'), // 오늘(age0) → 제외
        cbms('2026-07-05', false, 'not-conf'), // conf 아님 → 제외
      ],
    } as unknown as AppState;
    expect(confidentWrongCount(state, TODAY)).toBe(1);
    const card = pickConfidentWrong(state, TODAY);
    expect(card?.cbms.id).toBe('past-conf');
    expect(card?.ageDays).toBe(2);

    const none = { _today: TODAY, cbms: [] } as unknown as AppState;
    expect(pickConfidentWrong(none, TODAY)).toBeNull();
  });
});

describe('weeklyRecap (I-12)', () => {
  it('그 주 성취 집계 + 격려 문구', () => {
    const state = {
      _today: TODAY,
      completions: comps([
        ['2026-07-06', 's1|new', 60],
        ['2026-07-07', 's1|rev', 120],
      ]),
      summaries: { '2026-07-07': [{ id: 'x', sid: 's1', name: '선대', s1: 'a', s2: 'b', s3: 'c' }] },
      backlog: [
        {
          id: 'b1',
          ds: '2026-07-01',
          sid: '',
          name: '읽을거리',
          topic: 't',
          note: 'n',
          done: true,
          doneDs: '2026-07-08',
        },
      ],
      cbms: [],
    } as unknown as AppState;
    const rc = weeklyRecap(state, '2026-07-06');
    expect(rc.doneSessions).toBe(2);
    expect(rc.focusMin).toBe(180);
    expect(rc.summaries).toBe(1);
    expect(rc.backlogClosed).toBe(1);
    expect(rc.wins.length).toBeGreaterThanOrEqual(3);
  });

  it('조용한 주 → wins 빈 배열', () => {
    const rc = weeklyRecap(
      { _today: TODAY, completions: {}, summaries: {}, backlog: [], cbms: [] } as unknown as AppState,
      '2026-07-06',
    );
    expect(rc.wins).toEqual([]);
  });
});

describe('frontierNext (I-8)', () => {
  it('prereq_in 최대 프런티어·빈값 null', () => {
    const k = {
      frontier: [
        { title: 'A', prereq_in: 2 },
        { title: 'B', prereq_in: 5 },
      ],
    };
    expect(frontierNext(k)?.title).toBe('B');
    expect(frontierNext(undefined)).toBeNull();
    expect(frontierNext({ frontier: [] })).toBeNull();
  });
});

describe('백로그 시드 (I-1)', () => {
  it('반복 약점 → 씨앗', () => {
    const s = backlogFromWeakSpot({ subject: '선대', chapter: '2장', count: 3 });
    expect(s.name).toBe('반복 약점');
    expect(s.topic).toBe('선대 — 2장');
    expect(s.note).toContain('3번');
  });
  it('근본원인 → 씨앗', () => {
    const s = backlogFromRootCause({ cause: '극한', count: 4 });
    expect(s.name).toBe('근본원인');
    expect(s.topic).toBe('극한');
    expect(s.note).toContain('4개');
  });
});

describe('parseCaptureBatch (I-11)', () => {
  it('멀티라인 → 다건(빈 줄 제외)', () => {
    const now = new Date('2026-07-08T09:00:00');
    const out = parseCaptureBatch('내일 알고리즘 복습\n\n   \n오늘 3문장 요약', now);
    expect(out.length).toBe(2);
    // P-18 — `sessionType` 은 삭제됐다. 이 케이스가 검사하는 것은 **줄 분리**이므로 날짜로 본다.
    expect(out[0]!.dateISO).toBeTruthy();
  });
  it('빈 입력 → 빈 배열', () => {
    expect(parseCaptureBatch('\n\n  ', new Date('2026-07-08T09:00:00'))).toEqual([]);
  });
});

describe('프리필 배치 큐 (I-11)', () => {
  beforeEach(() => usePrefill.setState({ form: null, sid: '', ds: '', nonce: 0, queue: [] }));
  it('requestBatch → 첫 건 투영, consume마다 다음으로 전진', () => {
    usePrefill.getState().requestBatch([
      { form: 'sum', sid: 'a', ds: '' },
      { form: 'cbms', sid: 'b', ds: '' },
    ]);
    expect(usePrefill.getState().form).toBe('sum');
    expect(usePrefill.getState().sid).toBe('a');

    usePrefill.getState().consume('sum');
    expect(usePrefill.getState().form).toBe('cbms');
    expect(usePrefill.getState().sid).toBe('b');

    usePrefill.getState().consume('cbms');
    expect(usePrefill.getState().form).toBeNull();
  });
  it('빈 배치 → 무변경', () => {
    usePrefill.getState().requestBatch([]);
    expect(usePrefill.getState().form).toBeNull();
  });
});

describe('jolSummary (ID-11 인출 전 예측)', () => {
  it('맞힌 수 · 과신 · 과소평가를 나눈다(비율은 안 만든다 — 표본이 최대 3건)', () => {
    const s = jolSummary([
      { predicted: true, recalled: true }, // 맞힘
      { predicted: true, recalled: false }, // 과신 — 될 줄 알았는데 안 됨
      { predicted: false, recalled: true }, // 과소평가
      { predicted: false, recalled: false }, // 맞힘
    ])!;
    expect(s).toEqual({ n: 4, hit: 2, over: 1, under: 1 });
  });

  it('기록이 없으면 null — 호출부가 "잴 것 없음"을 침묵으로 처리한다', () => {
    expect(jolSummary([])).toBeNull();
  });

  it('과신만 있는 세션 — 가장 위험한 방향이 따로 드러난다', () => {
    const s = jolSummary([
      { predicted: true, recalled: false },
      { predicted: true, recalled: false },
    ])!;
    expect(s.over).toBe(2);
    expect(s.hit).toBe(0);
    expect(s.under).toBe(0);
  });
});
