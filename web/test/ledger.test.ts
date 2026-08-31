/* ============================================================
   ledger.test.ts — 정본 원장(과목×챕터 5단계) 웹 소비 레이어 순수 파생 회귀(Vitest).
   subjectRollup(도달·furthest·진척) · 정렬 · 병목 · stageIndex/색.
============================================================ */
import { describe, expect, it } from 'vitest';
import {
  LEDGER_STAGES,
  STAGE_META,
  PLANNED_COLOR,
  furthestColor,
  stageIndex,
  subjectRollup,
  subjectRollups,
  bottleneckStage,
  type Ledger,
  type LedgerChapter,
  type LedgerStage,
  type LedgerSubject,
} from '@/lib/ledger';

/** 마일스톤을 furthest까지 채운 챕터(그 이하 단계 전부 true). planned면 전부 false. */
function ch(id: string, furthest: LedgerChapter['furthest']): LedgerChapter {
  const idx = stageIndex(furthest);
  const milestones = Object.fromEntries(LEDGER_STAGES.map((s, i) => [s, i <= idx])) as Record<LedgerStage, boolean>;
  return {
    chapter_id: id,
    arc: id,
    notes: 3,
    concept: 3,
    status: { verified: 0, drafted: 0, raw: 0, 구버전: 3 },
    verified_ratio: furthest === 'verified' ? 1 : 0,
    carded_notes: 0,
    cards: idx >= 3 ? 5 : 0,
    reps: 0,
    reviewed_recent: idx >= 4 ? '2026-07-01' : null,
    milestones,
    furthest,
  };
}

function subject(chapters: LedgerChapter[], src_present = true): LedgerSubject {
  return { slug: 'x', abbr: 'X', domain: 'stem', src: src_present ? 'X' : null, src_present, chapters };
}

describe('subjectRollup — 과목 롤업', () => {
  it('reached는 마일스톤 독립 카운트(누적 하위 포함)', () => {
    const s = subject([ch('a', 'verified'), ch('b', 'noted'), ch('c', 'carded')]);
    const r = subjectRollup('과목', s);
    // a: sourced,noted,verified / b: sourced,noted / c: sourced,noted,verified,carded
    expect(r.reached.sourced).toBe(3);
    expect(r.reached.noted).toBe(3);
    expect(r.reached.verified).toBe(2); // a, c
    expect(r.reached.carded).toBe(1); // c
    // ⛔ `reviewed` 단언이 2026-08-29 에 빠졌다 — 그 단계가 은퇴했다(부모 스키마 파생).
  });

  it('furthestDist는 furthest 값별 챕터 수(planned 포함)', () => {
    const s = subject([ch('a', 'planned'), ch('b', 'noted'), ch('c', 'noted')]);
    const r = subjectRollup('과목', s);
    expect(r.furthestDist.planned).toBe(1);
    expect(r.furthestDist.noted).toBe(2);
    expect(r.furthestDist.verified).toBe(0);
  });

  it('progress = Σ(stageIndex+1)/(total*4) — 0..1', () => {
    // carded(idx3→4) + planned(idx-1→0) = 4 / (2*4) = 0.5  ⛔ reviewed 은퇴로 분모가 5→4
    const s = subject([ch('a', 'carded'), ch('b', 'planned')]);
    expect(subjectRollup('과목', s).progress).toBeCloseTo(0.5, 6);
    // 전부 carded → 1.0, 전부 planned → 0
    expect(subjectRollup('x', subject([ch('a', 'carded')])).progress).toBe(1);
    expect(subjectRollup('x', subject([ch('a', 'planned')])).progress).toBe(0);
  });

  it('빈 과목은 progress 0(0 나눗셈 방어)', () => {
    expect(subjectRollup('빈', subject([])).progress).toBe(0);
  });

  it('src_present를 srcPresent로 전달', () => {
    expect(subjectRollup('x', subject([ch('a', 'noted')], false)).srcPresent).toBe(false);
  });
});

function mkLedger(subjects: Record<string, LedgerSubject>): Ledger {
  const all = Object.values(subjects).flatMap((s) => s.chapters);
  const stage_counts = Object.fromEntries(
    LEDGER_STAGES.map((s) => [s, all.filter((c) => c.milestones[s]).length]),
  ) as Record<LedgerStage, number>;
  return {
    generated: '2026-07-12',
    generated_by: 'test',
    n_chapters: all.length,
    stage_counts,
    backlog: { unprocessed_src: [], subjects_without_src: [] },
    subjects,
  };
}

describe('subjectRollups — 정렬', () => {
  it('진척 낮은 과목이 먼저(손볼 곳 우선), 동률이면 챕터 많은 순', () => {
    const led = mkLedger({
      앞선: subject([ch('a', 'carded'), ch('b', 'verified')]),
      뒤진: subject([ch('c', 'noted')]),
      중간: subject([ch('d', 'verified'), ch('e', 'verified')]),
    });
    const order = subjectRollups(led).map((r) => r.subject);
    expect(order[0]).toBe('뒤진'); // progress 0.4
    expect(order[order.length - 1]).toBe('앞선'); // 최고 진척
  });
});

describe('bottleneckStage — 병목', () => {
  it('인접 단계 통과율이 가장 낮은 지점을 고른다', () => {
    /* ⛔ 2026-08-29 — 종전 답은 `reviewed`(from carded 2 → 0/2 = 0)였다. 그 단계가 은퇴해
       사슬이 carded 에서 끝나므로 이제 최저는 **verified**(from noted 10 → 2/10 = 0.2)다. */
    const led = mkLedger({
      s: subject([
        ...Array.from({ length: 8 }, (_, i) => ch(`n${i}`, 'noted')),
        ch('v1', 'carded'),
        ch('v2', 'carded'),
      ]),
    });
    const b = bottleneckStage(led)!;
    expect(b.stage).toBe('verified');
    expect(b.passed).toBe(2);
    expect(b.from).toBe(10);
  });

  it('직전 단계가 0이면 그 단계는 건너뛴다(0 나눗셈 방어)', () => {
    const led = mkLedger({ s: subject([ch('a', 'noted')]) });
    // sourced=1,noted=1,verified=0,carded=0,reviewed=0 → verified ratio 0/1=0 최저
    const b = bottleneckStage(led)!;
    expect(b.stage).toBe('verified');
  });

  it('챕터 없으면 null', () => {
    expect(bottleneckStage(mkLedger({}))).toBeNull();
  });
});

describe('stageIndex / furthestColor', () => {
  it('stageIndex: 5단계 0..4, planned -1', () => {
    expect(stageIndex('sourced')).toBe(0);
    expect(stageIndex('carded')).toBe(3);
    expect(stageIndex('planned')).toBe(-1);
  });
  it('furthestColor: planned는 회색, 각 단계는 STAGE_META 색', () => {
    expect(furthestColor('planned')).toBe(PLANNED_COLOR);
    expect(furthestColor('verified')).toBe(STAGE_META.verified.color);
  });
  it('STAGE_META는 4단계 전부 라벨·색을 가진다', () => {
    expect(LEDGER_STAGES.length).toBe(4); // 분모 — 비면 아래 순회가 공허하게 통과한다(2026-07-31 감사 F3)
    for (const s of LEDGER_STAGES) {
      expect(STAGE_META[s].label).toBeTruthy();
      expect(STAGE_META[s].color).toBeTruthy();
    }
  });
});
