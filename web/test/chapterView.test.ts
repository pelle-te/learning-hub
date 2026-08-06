/* ============================================================
   chapterView.test.ts — 챕터 서랍(N-2 첫 조각)이 **반드시 채워지는 것만** 담는지.
   조인 실패로 빈칸이 생길 수 있는 볼트 산출물은 1차에 없다는 것이 이 테스트의 요지다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { chapterSnapshot, riskWord } from '@/lib/chapterView';
import type { AppState, Day, ScheduleItem } from '@/lib/types';

const TODAY = '2026-07-08';
const newIt = (sid: string, chapters: string[]): ScheduleItem => ({
  type: 'new',
  sid,
  name: '물리',
  min: 120,
  chapters,
});
const day = (ds: string, items: ScheduleItem[]): Day =>
  ({ ds, date: new Date(ds + 'T00:00:00'), wd: 0, studyMin: 0, used: 0, modLeft: 0, revLeft: 0, items }) as Day;

const stateOf = (chapters: { name: string; hours: number; done?: boolean; doneDs?: string }[], extra = {}) =>
  ({
    items: [{ id: 'p', name: '물리', chapters: chapters.map((c, i) => ({ id: 'c' + i, ...c, done: !!c.done })) }],
    completions: { [TODAY]: { 'p|new': { done: true, min: 120 } } },
    cbms: [],
    ...extra,
  }) as unknown as AppState;

describe('chapterSnapshot — 앱이 스스로 쓴 값만(조인 실패가 불가능하다)', () => {
  it('진행 중 챕터 — 분량·진행·마지막 인출·오답 수', () => {
    const st = stateOf([{ name: '역학', hours: 3 }], {
      cbms: [
        { id: 'e1', sid: 'p', chapter: '역학', code: 'C' },
        { id: 'e2', sid: 'p', chapter: '열', code: 'B' },
      ],
    });
    const s = chapterSnapshot(st, [day(TODAY, [newIt('p', ['역학'])])], TODAY, 'p', '역학')!;
    expect(s.hours).toBe(3);
    expect(s.done).toBe(false);
    expect(s.lastDs).toBe(TODAY);
    expect(s.daysSince).toBe(0);
    expect(s.cbms).toBe(1); // 다른 챕터 기록은 안 센다
    expect(s.maintenance).toBe(false);
  });

  it('끝낸 챕터 — 유지 큐에서 오고, 끝낸 날을 모르면 모른다고 남는다', () => {
    const st = stateOf([{ name: '역학', hours: 3, done: true }]);
    const s = chapterSnapshot(st, [], TODAY, 'p', '역학')!;
    expect(s.done).toBe(true);
    expect(s.doneDs).toBeNull();
    expect(s.maintenance).toBe(true);
    expect(riskWord(s)).toBe('유지 복습 때'); // 앵커가 없으면 유지 큐가 due 로 잡는다(N-10)
  });

  it('끝낸 날이 있으면 그대로 싣는다(N-10 스탬프)', () => {
    const st = stateOf([{ name: '역학', hours: 3, done: true, doneDs: '2026-07-01' }]);
    expect(chapterSnapshot(st, [], TODAY, 'p', '역학')!.doneDs).toBe('2026-07-01');
  });

  it('카탈로그에 없는 과목·챕터는 null(빈 서랍을 그리지 않는다)', () => {
    const st = stateOf([{ name: '역학', hours: 3 }]);
    expect(chapterSnapshot(st, [], TODAY, 'zzz', '역학')).toBeNull();
    expect(chapterSnapshot(st, [], TODAY, 'p', '없는장')!.hours).toBeNull();
  });

  it('기록이 전혀 없는 챕터는 "기록 없음" — 없는 위험을 지어내지 않는다', () => {
    const st = stateOf([{ name: '열', hours: 2 }]);
    expect(riskWord(chapterSnapshot(st, [], TODAY, 'p', '열')!)).toBe('기록 없음');
  });
});

/* ============================================================
   N-2 **2단계** — 볼트 조인(2026-08-06). 이 절이 잠그는 것은 조인의 성공이 아니라 **실패**다.

   1단계가 조인을 미룬 근거는 _"실패하면 서랍 절반이 빈칸이고, 빈 서랍은 '데이터 없음'이 아니라
   '이 도구가 나를 모른다'로 읽힌다"_ 였다. 실측(과목 4/4 · 개념 626/626)이 그 위험을 부정했지만
   **부정된 것은 이 볼트에서의 발생 확률이지 그 형태 자체가 아니다** — 사용자가 챕터 이름을 손으로
   고치면 그 순간 되살아난다. 그래서 실패 경로가 `null` 로 끝나는지를 성공 경로보다 먼저 잠근다.
============================================================ */
import { chapterVault } from '@/lib/chapterView';
import type { Ledger } from '@/lib/ledger';

const LED = {
  _schemaVersion: 1,
  generated: '',
  generated_by: '',
  n_chapters: 1,
  stage_counts: { sourced: 1, noted: 1, verified: 0, carded: 0, reviewed: 0 },
  backlog: { unprocessed_src: [], subjects_without_src: [] },
  subjects: {
    회로이론: {
      slug: 'circ',
      abbr: '회로',
      domain: '전공',
      src: '',
      src_present: true,
      chapters: [
        {
          chapter_id: 'c1',
          arc: '01 회로 변수',
          notes: 7,
          concept: 5,
          status: { verified: 4, drafted: 3, raw: 0, 구버전: 0 },
          verified_ratio: 0.57,
          carded_notes: 4,
          cards: 21,
          reps: 0,
          reviewed_recent: '2026-07-11',
          milestones: { sourced: true, noted: true, verified: false, carded: true, reviewed: false },
          furthest: 'carded',
        },
      ],
    },
  },
} as unknown as Ledger;

describe('N-2 2단계 — 볼트 조인은 성립할 때만 존재한다', () => {
  it('과목·챕터가 붙으면 원장의 사실을 그대로 싣는다(재계산 0)', () => {
    const v = chapterVault(LED, '회로이론', '01 회로 변수')!;
    expect(v).toEqual({ notes: 7, verified: 4, cards: 21, furthest: 'carded', reviewedRecent: '2026-07-11' });
  });

  it('⭐ 챕터 이름이 갈리면 **null** — 빈칸을 그리지 않는다(1단계 유보의 취지)', () => {
    expect(chapterVault(LED, '회로이론', '01 회로변수')).toBeNull(); // 공백 하나 차이
    expect(chapterVault(LED, '회로이론', '02 저항')).toBeNull();
  });

  it('⚠ 챕터는 **퍼지로 붙이지 않는다** — `01 극한`과 `01 극한과 연속`이 서로를 먹으면 안 된다', () => {
    expect(chapterVault(LED, '회로이론', '01 회로')).toBeNull();
  });

  it('원장이 아직 없으면(콜드·미가동) null — 서랍은 종전 모습 그대로다', () => {
    expect(chapterVault(undefined, '회로이론', '01 회로 변수')).toBeNull();
    expect(chapterVault(null, '회로이론', '01 회로 변수')).toBeNull();
  });

  it('모르는 과목은 null', () => {
    expect(chapterVault(LED, '없는과목', '01 회로 변수')).toBeNull();
  });
});
