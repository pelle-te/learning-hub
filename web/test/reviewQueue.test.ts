/* ============================================================
   reviewQueue.test.ts — buildReviewQueue 배선 회귀(ID-2 과목 인터리빙이 큐에 실제로 흐르는지).
   회상·착각 카드는 비우고 밀린 챕터만 남겨 순서를 검증한다.
============================================================ */
import { describe, expect, it } from 'vitest';
import {
  MAINTENANCE_CAP,
  REQUEUE_GAP,
  anchorOf,
  buildAdhocQueue,
  buildReviewQueue,
  requeue,
  runItemKey,
  chapterCopy,
  type RunItem,
  cursorOp,
  landingIndex,
} from '@/lib/reviewQueue';
import type { Day, ScheduleItem } from '@/lib/types';
import type { AppState } from '@/lib/schema';

const TODAY = '2026-07-04';

const revIt = (sid: string, chapters: string[]): ScheduleItem => ({
  type: 'new',
  sid,
  name: sid.toUpperCase(),
  min: 120,
  chapters,
  color: '#0f0',
});
const day = (ds: string, items: ScheduleItem[]): Day =>
  ({ ds, date: new Date(ds + 'T00:00:00'), wd: 0, studyMin: 0, used: 0, modLeft: 0, revLeft: 0, items }) as Day;

/** 완료 세션 + (회상·착각 없음) 상태. */
function stateWith(done: [string, string, string][]): AppState {
  const completions: Record<string, Record<string, { done: boolean; min: number }>> = {};
  for (const [ds, sid, type] of done)
    (completions[ds] = completions[ds] || {})[sid + '|' + type] = { done: true, min: 60 };
  return { items: [], completions, summaries: {}, cbms: [] } as unknown as AppState;
}

describe('buildReviewQueue — 밀린 챕터가 과목 인터리빙으로 나온다(ID-2)', () => {
  // m 3장·p 1장 모두 20일 전 완료(overdue). 위험순만이라면 m,m,m,p. 인터리빙이면 m,p,m,m.
  const days = [
    day('2026-06-14', [revIt('m', ['m1', 'm2', 'm3']), revIt('p', ['p1'])]), // 20일 전
  ];
  const state = stateWith([
    ['2026-06-14', 'm', 'new'],
    ['2026-06-14', 'p', 'new'],
  ]);

  it('같은 과목이 큐 앞을 통째로 점유하지 않는다(라운드로빈)', () => {
    const q = buildReviewQueue(state, days, TODAY);
    const chapters = q.filter((x) => x.kind === 'chapter').map((x) => (x.kind === 'chapter' ? x.ch.chapter : ''));
    // 회전 순 m→p: [m1,p1],[m2],[m3] → m1,p1,m2,m3. p가 두 번째로 끼어든다(블록 학습 방지).
    expect(chapters).toEqual(['m1', 'p1', 'm2', 'm3']);
  });

  /* ── P-11 보류 선반 — **이 필터가 없으면 큐가 매일 같다** ─────────────────────────── */
  it('뺀 챕터는 큐에서 사라지고, 되돌리면 원래 자리로 돌아온다', () => {
    const withHold = { ...state, reviewHold: { 'm|m2': '2026-07-03' } } as AppState;
    const q = buildReviewQueue(withHold, days, TODAY);
    const chapters = q.filter((x) => x.kind === 'chapter').map((x) => (x.kind === 'chapter' ? x.ch.chapter : ''));
    expect(chapters).toEqual(['m1', 'p1', 'm3']);
    // 되돌리기 = 키 삭제 하나. 별도 복원 상태가 없으므로 원래 위험 티어 그대로 복귀한다.
    const back = buildReviewQueue(state, days, TODAY);
    expect(back.filter((x) => x.kind === 'chapter').length).toBe(4);
  });

  /* ── I040 「오늘은 빼기」 — **큐가 두 시제를 다 먹는다** ────────────────────────────
     ⚠ 이 케이스가 없으면 가장 나쁜 실패가 통과한다: **버튼은 눌리는데 큐가 그대로**.
     종전 큐는 `state.reviewHold` 를 직접 읽었고, 판정자를 `reviewPause` 로 옮기지 않으면
     스누즈가 저장만 되고 아무 일도 안 일어난다. */
  it('오늘 미룬 챕터는 오늘 큐에서 빠지고 **내일 돌아온다**', () => {
    const snoozed = { ...state, reviewSnooze: { 'm|m2': TODAY } } as AppState;
    const chaptersOf = (st: AppState, ds: string): string[] =>
      buildReviewQueue(st, days, ds)
        .filter((x) => x.kind === 'chapter')
        .map((x) => (x.kind === 'chapter' ? x.ch.chapter : ''));
    expect(chaptersOf(snoozed, TODAY)).toEqual(['m1', 'p1', 'm3']);
    expect(chaptersOf(snoozed, '2026-07-05')).toContain('m2'); // 자정에 스스로 풀린다
  });
});

/* ── D-1 재큐(세션 내 확장 인출) ─────────────────────────────────────────
   러너 UI 없이 규칙 전량을 덮는다 — 데스크톱·폰 두 러너가 이 한 함수를 공유하므로
   여기가 녹색이면 두 화면의 큐 동작이 같다는 뜻이다(스냅샷과 무관한 안전망). */
const ch = (chapter: string): RunItem => ({
  kind: 'chapter',
  ch: { sid: 's', subject: 'S', chapter, lastDs: '2026-06-01', daysSince: 20, risk: 'overdue' },
});
const keys = (q: RunItem[]): string[] => q.map((i) => (i.kind === 'chapter' ? i.ch.chapter : i.kind));

describe('requeue — 못 한 카드를 세션 안에서 한 번 더', () => {
  const q4 = [ch('a'), ch('b'), ch('c'), ch('d')];

  it(`현재 카드를 ${REQUEUE_GAP}장 뒤에 다시 넣는다`, () => {
    const next = requeue(q4, 0);
    expect(keys(next)).toEqual(['a', 'b', 'c', 'd', 'a']); // idx 0 → 삽입 위치 4
    expect(next[4]!.again).toBe(true);
    expect(next[0]!.again).toBeUndefined();
  });

  it('끝을 넘어가면 마지막에 붙인다(세션 밖으로 밀어내면 삭제가 된다)', () => {
    expect(keys(requeue(q4, 3))).toEqual(['a', 'b', 'c', 'd', 'd']);
  });

  it('재삽입본은 다시 재삽입하지 않는다(상한 1)', () => {
    const once = requeue(q4, 0);
    expect(requeue(once, 4)).toBe(once); // 참조 동일 = 손대지 않음
  });

  it('짧은 큐(<4)에서는 재삽입하지 않는다 — 사실상 직후 반복이 된다', () => {
    const q3 = [ch('a'), ch('b'), ch('c')];
    expect(requeue(q3, 0)).toBe(q3);
    expect(requeue([ch('a')], 0)).toHaveLength(1);
  });

  it('원본 배열을 변형하지 않는다(순수)', () => {
    const before = keys(q4);
    requeue(q4, 1);
    expect(keys(q4)).toEqual(before);
  });

  it('범위 밖 인덱스는 무시한다', () => {
    expect(requeue(q4, 9)).toBe(q4);
    expect(requeue([], 0)).toHaveLength(0);
  });

  it('재삽입본은 원본과 같은 카드로 센다(분모가 흔들리지 않는다)', () => {
    const next = requeue(q4, 0);
    expect(runItemKey(next[4]!)).toBe(runItemKey(next[0]!));
    expect(new Set(next.map(runItemKey)).size).toBe(4); // 큐는 5장이지만 카드는 4장
  });
});

describe('buildReviewQueue — 유지(끝낸 챕터) 꼬리(N-10)', () => {
  /** 끝낸 챕터 n장을 가진 과목 카탈로그. 앵커가 없으므로 전부 due(=옛 done 챕터의 실제 모습). */
  const withDone = (base: AppState, n: number): AppState =>
    ({
      ...base,
      items: [
        {
          id: 'k',
          name: '유지과목',
          chapters: Array.from({ length: n }, (_, i) => ({ id: 'k' + i, name: `k${i}`, hours: 2, done: true })),
        },
      ],
    }) as unknown as AppState;

  it('done 이 0이면 침묵한다 — 큐가 한 장도 안 늘어난다', () => {
    const s = stateWith([]);
    expect(buildReviewQueue(s, [], TODAY)).toHaveLength(0);
  });

  it('세션당 2장 상한 — 끝낸 챕터가 40장이어도 큐는 2장만 는다', () => {
    const s = withDone(stateWith([]), 40);
    const q = buildReviewQueue(s, [], TODAY);
    expect(q).toHaveLength(MAINTENANCE_CAP);
    expect(q.every((i) => i.kind === 'chapter' && i.ch.maintenance)).toBe(true);
  });

  it('유지는 **맨 뒤**다 — 진행 중 밀린 챕터가 유지에 밀리지 않는다(강등 불변식의 배치판)', () => {
    const days = [day('2026-06-14', [revIt('m', ['m1', 'm2'])])]; // 20일 전 = overdue
    const s = withDone(stateWith([['2026-06-14', 'm', 'new']]), 3);
    const q = buildReviewQueue(s, days, TODAY);
    const kinds = q.map((i) => (i.kind === 'chapter' && i.ch.maintenance ? '유지' : i.kind));
    expect(kinds).toEqual(['chapter', 'chapter', '유지', '유지']);
  });
});

/* ── E1 앵커 판정(2026-07-29) ────────────────────────────────────────────
   러너의 인출 판정이 위험모델에 닿는 통로. 카드 종류별로 답이 다르고 **그 차이가 설계**라,
   종류마다 잠근다 — 특히 회상 카드가 null 인 것이 핵심이다(`Summary` 에 chapter 가 없다). */
describe('anchorOf — 어떤 카드가 복습 앵커를 옮길 수 있나', () => {
  const chapterCard = (sid: string, chapter: string): RunItem => ({
    kind: 'chapter',
    ch: { sid, chapter, subject: sid, risk: 'due', daysSince: 9, lastDs: '2026-06-25' } as never,
  });

  it('챕터 카드 — 앵커 그 자체다', () => {
    expect(anchorOf(chapterCard('p', '역학'))).toEqual({ sid: 'p', chapter: '역학' });
  });

  it('착각 재확인 — Cbms 가 sid·chapter 를 다 가지므로 옮긴다', () => {
    const item: RunItem = {
      kind: 'confident',
      card: { ageDays: 3, cbms: { id: 'x', ds: '2026-07-01', sid: 'm', name: '수학', chapter: '적분' } as never },
    };
    expect(anchorOf(item)).toEqual({ sid: 'm', chapter: '적분' });
  });

  it('착각 재확인이라도 chapter 가 비면 옮기지 않는다 — 빈 키로 앵커를 만들지 않는다', () => {
    const item: RunItem = {
      kind: 'confident',
      card: { ageDays: 3, cbms: { id: 'x', ds: '2026-07-01', sid: 'm', name: '수학', chapter: '' } as never },
    };
    expect(anchorOf(item)).toBeNull();
  });

  it('회상 카드 — **원리적으로** 앵커가 없다(Summary 에 chapter 필드 자체가 없다)', () => {
    const item: RunItem = {
      kind: 'retrieval',
      card: {
        ds: '2026-07-01',
        ageDays: 3,
        summary: { id: 'r1', sid: 's1', name: '선형대수', s1: 'a', s2: 'b', s3: 'c' },
      },
    };
    // sid 만으로 그 과목의 아무 챕터나 리셋하는 것은 인출 기록이 아니라 오염이다.
    expect(anchorOf(item)).toBeNull();
  });
});

/* ============================================================
   이어하기 커서 판정(M-10 · 2026-08-20) — **두 러너가 같은 규칙을 쓴다**는 것이 요점이다.
   종전엔 쓰기가 데스크톱에만 있어 커서가 단방향이었고(폰은 읽기만), 그 결과 폰에서 진행한 것이
   PC 에 안 이어지고 폰에서 끝내도 유령 칩이 TTL 동안 남았다.
============================================================ */
describe('cursorOp — 언제 쓰고 언제 지우나', () => {
  it('마지막 장을 넘기면 **지운다** — 안 지우면 이미 끝낸 큐로 착지하는 유령 칩이 남는다', () => {
    expect(cursorOp(11, 12)).toEqual({ kind: 'drop' });
    expect(cursorOp(0, 1)).toEqual({ kind: 'drop' });
  });

  it('5장마다 쓰고 진행 표기는 **다음 카드** 기준이다', () => {
    expect(cursorOp(4, 12)).toEqual({ kind: 'write', progress: '6/12' });
    expect(cursorOp(9, 12)).toEqual({ kind: 'write', progress: '11/12' });
  });

  it('그 외엔 아무것도 안 한다 — 카드마다 쓰면 한 세션이 아웃박스에 같은 말을 12번 남긴다', () => {
    expect(cursorOp(0, 12)).toBeNull();
    expect(cursorOp(3, 12)).toBeNull();
  });

  it('빈 큐는 drop 이다(쓸 진행이 없다)', () => {
    expect(cursorOp(0, 0)).toEqual({ kind: 'drop' });
  });
});

describe('landingIndex — 이어하기 착지', () => {
  it('큐가 줄었어도 범위를 벗어나지 않는다', () => {
    expect(landingIndex(7, 3)).toBe(2);
    expect(landingIndex(-1, 5)).toBe(0);
    expect(landingIndex(2, 5)).toBe(2);
  });
  it('빈 큐면 0', () => {
    expect(landingIndex(5, 0)).toBe(0);
  });
});

/* ============================================================
   I041 — **만성 실패(leech)의 문구와 처방**(2026-08-22 발상 축).

   `spacedReview` 는 A-4 에서 leech 를 판정하고 앞당김을 멈추면서, 그 자리에
   *"UI 는 이걸 다른 문구로 그려야 한다 — 표식 없이 빈도만 낮추면 사용자에겐 그냥 「앱이 이
   챕터를 잊었다」로 보인다"* 고 적어 뒀다. 실측하니 **`leech` 를 읽는 화면이 0개**였다.

   ⚠ 여기서 잠그는 것: ① leech 는 다른 배지·다른 본문을 받는다 ② 그 본문이 «간격이 아니라
   자료»라고 말한다(더 자주 보여 주자는 말로 읽히면 A-4 의 판정이 뒤집힌다) ③ 유지(maintenance)
   문구가 leech 보다 먼저다(끝낸 챕터의 설명이 우선 — 그게 «왜 돌아왔나»의 답이다).
============================================================ */
describe('I041 — leech 문구', () => {
  const ch = (over: Record<string, unknown> = {}) =>
    ({
      sid: 'm',
      subject: '수학',
      chapter: '3장',
      lastDs: '2026-06-20',
      daysSince: 14,
      risk: 'overdue',
      ...over,
    }) as never;

  it('leech 는 다른 배지를 받는다 — 「많이 밀림」이 아니다', () => {
    expect(chapterCopy(ch({ leech: true })).badge).toBe('반복해서 막힘');
    expect(chapterCopy(ch()).badge).toBe('많이 밀림');
  });

  it('⚠ 본문이 「간격이 아니라 자료」라고 말한다 — 더 자주 보자는 말로 읽히면 A-4 가 뒤집힌다', () => {
    const body = chapterCopy(ch({ leech: true })).body;
    expect(body).toContain('자료');
    expect(body).not.toContain('망각곡선을 리셋');
  });

  it('유지 문구가 leech 보다 먼저다 — 끝낸 챕터는 「왜 돌아왔나」가 먼저 답해야 한다', () => {
    expect(chapterCopy(ch({ leech: true, maintenance: true })).badge).toBe('유지');
  });
});

/* ============================================================
   I043 — **임시 학습 세트**(2026-08-22 발상 축).

   밖의 대응(필터 덱)이 자기 매뉴얼에 *"반복 사용에 부적절"* 을 적어 두는 이유가 이 기능의 설계
   조건이다: 임의 세트가 **정규 스케줄을 영구히 오염**시키는 것이 그 문서가 경고하는 실패다.

   ⚠ 여기서 잠그는 것:
   ① 부른 것만 나온다(순서·중복 없음) ② **위험도를 무시한다**(fresh 여도 부르면 온다 —
   「이 범위만」의 뜻이 그것) ③ **보류·스누즈를 무시한다**(빼 뒀다는 이유로 안 보여 주면 화면이
   아무 일도 안 한 것처럼 보인다) ④ 회상·착각 카드를 안 섞는다(세트는 세트다).
   ⚠ 「앵커를 안 옮긴다」는 러너 쪽 계약이라 여기서 못 잰다 — 그 자리는 `ReviewRun.advance` 다.
============================================================ */
describe('buildAdhocQueue — 임시 학습 세트(I043)', () => {
  const days = [day('2026-06-14', [revIt('m', ['m1', 'm2', 'm3']), revIt('p', ['p1'])])];
  const state = stateWith([
    ['2026-06-14', 'm', 'new'],
    ['2026-06-14', 'p', 'new'],
  ]);
  const names = (q: RunItem[]): string[] =>
    q.filter((x) => x.kind === 'chapter').map((x) => (x.kind === 'chapter' ? x.ch.chapter : ''));

  it('부른 챕터만 나온다', () => {
    expect(names(buildAdhocQueue(state, days, TODAY, ['m|m2', 'p|p1']))).toEqual(['m2', 'p1']);
  });

  it('빈 목록이면 빈 큐다(정규 큐로 조용히 떨어지지 않는다)', () => {
    expect(buildAdhocQueue(state, days, TODAY, [])).toEqual([]);
  });

  it('⚠ 보류·스누즈를 무시한다 — 이름을 대고 부른 챕터를 안 보여 주면 원인이 어디에도 없다', () => {
    const held = { ...state, reviewHold: { 'm|m2': '2026-07-03' }, reviewSnooze: { 'm|m3': TODAY } } as AppState;
    expect(names(buildAdhocQueue(held, days, TODAY, ['m|m2', 'm|m3']))).toEqual(['m2', 'm3']);
  });

  it('회상·착각 카드를 안 섞는다 — 세트는 세트다', () => {
    expect(buildAdhocQueue(state, days, TODAY, ['m|m1']).every((x) => x.kind === 'chapter')).toBe(true);
  });

  it('모르는 키는 조용히 빠진다(지워진 챕터를 가리키는 옛 링크)', () => {
    expect(names(buildAdhocQueue(state, days, TODAY, ['m|없는장', 'm|m1']))).toEqual(['m1']);
  });
});
