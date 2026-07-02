/* ============================================================
   methodology.test.ts — 학습방법론 데이터 레이어(순수 함수) 회귀.
   reads는 값 반환·뮤테이터는 받은 state 변형이라는 계약을 그대로 검증
   (persist/토스트/다운로드 없음 → jsdom 불필요, 평범한 객체로 충분).
============================================================ */
import { describe, expect, it } from 'vitest';
import {
  addBacklog,
  addCbms,
  addSummary,
  archiveOldData,
  backlogClosedBetween,
  blankPassRate,
  blankResultFor,
  buildAnkiCards,
  buildSummaryNotes,
  cbmsBetween,
  cbmsCounts,
  cbmsTrend,
  clearBlankResult,
  dataSizeKB,
  delBacklog,
  delCbms,
  delSummary,
  openBacklog,
  recordCount,
  recordRetentionSnapshot,
  retentionTrend,
  setBlankResult,
  summariesFor,
  summaryCount,
  toggleBacklog,
} from '@/lib/methodology';
import type { AppState } from '@/lib/types';

const st = (over?: Record<string, unknown>): AppState => ({ items: [], ...(over || {}) }) as unknown as AppState;

describe('methodology — 3문장 요약', () => {
  it('추가·조회·삭제 + 빈 날짜 키 정리 + 총 카운트', () => {
    const s = st();
    addSummary(s, '2026-07-01', 'a', '수학', '핵심', '도구', '의미');
    addSummary(s, '2026-07-02', 'a', '수학', 'x', 'y', 'z');
    expect(summariesFor(s, '2026-07-01').length).toBe(1);
    expect(summaryCount(s)).toBe(2);
    const id = summariesFor(s, '2026-07-01')[0]!.id;
    delSummary(s, '2026-07-01', id);
    expect(s.summaries!['2026-07-01']).toBeUndefined(); // 비면 키 자체 삭제
    expect(summaryCount(s)).toBe(1);
    delSummary(s, '없는날', 'x'); // 없는 키는 조용히 무시
  });
});

describe('methodology — CBMS 오답', () => {
  it('추가·구간 카운트·구간 조회·삭제', () => {
    const s = st();
    addCbms(s, '2026-06-01', 'a', '수학', '1장', 'C', '개념 구멍');
    addCbms(s, '2026-06-15', 'a', '수학', '2장', 'S', '실수', true);
    addCbms(s, '2026-07-01', 'b', '물리', '역학', 'C', '');
    expect(cbmsCounts(s)).toEqual({ C: 2, B: 0, M: 0, S: 1, T: 0 });
    expect(cbmsCounts(s, '2026-06-10', '2026-06-30')).toEqual({ C: 0, B: 0, M: 0, S: 1, T: 0 });
    expect(cbmsBetween(s, '2026-07-01').length).toBe(1);
    delCbms(s, s.cbms![0]!.id);
    expect(s.cbms!.length).toBe(2);
  });

  it('cbmsTrend: 앱의 오늘(_today 시드) 기준 이번 주/지난 주 집계', () => {
    const s = st({ _today: '2026-07-01' }); // 수요일 → 주 시작 6/29(월)
    addCbms(s, '2026-06-30', 'a', '수학', '', 'C', ''); // 이번 주
    addCbms(s, '2026-06-24', 'a', '수학', '', 'C', ''); // 지난 주
    addCbms(s, '2026-06-10', 'a', '수학', '', 'C', ''); // 그 전(제외)
    expect(cbmsTrend(s)).toEqual({ thisW: 1, lastW: 1 });
  });
});

describe('methodology — 백지 복습 결과', () => {
  it('하루·과목당 1개(중복 갱신) + 막힘은 CBMS(C) 자동 연결·연속 막힘은 중복 금지', () => {
    const s = st();
    setBlankResult(s, '2026-07-01', 'a', '수학', false, '3장 유도 막힘', '3장');
    expect(blankResultFor(s, '2026-07-01', 'a')!.passed).toBe(false);
    expect(cbmsCounts(s).C).toBe(1); // 막힘 → CBMS 자동 생성
    setBlankResult(s, '2026-07-01', 'a', '수학', false, '또 막힘', '3장');
    expect(s.blankResults!.length).toBe(1); // 갱신이지 추가가 아님
    expect(cbmsCounts(s).C).toBe(1); // 직전이 이미 막힘 → CBMS 중복 생성 금지
    setBlankResult(s, '2026-07-01', 'a', '수학', true, '', '');
    expect(blankResultFor(s, '2026-07-01', 'a')!.passed).toBe(true);
    expect(blankPassRate(s)).toEqual({ total: 1, passed: 1 });
    clearBlankResult(s, '2026-07-01', 'a');
    expect(blankResultFor(s, '2026-07-01', 'a')).toBeNull();
    expect(blankPassRate(s)).toBeNull(); // 기록 없음 = null('미측정')
  });
});

describe('methodology — 보충 백로그', () => {
  it('추가·토글(완료일 스탬프)·열린 목록·구간 마감 수·삭제', () => {
    const s = st();
    addBacklog(s, 'a', '수학', '테일러 전개', '급수 수렴 조건');
    addBacklog(s, 'b', '물리', '각운동량', '');
    expect(openBacklog(s).length).toBe(2);
    const id = s.backlog![0]!.id;
    toggleBacklog(s, id);
    expect(openBacklog(s).length).toBe(1);
    expect(s.backlog![0]!.doneDs).not.toBe('');
    expect(backlogClosedBetween(s, '2000-01-01', '2999-12-31')).toBe(1);
    toggleBacklog(s, id); // 되돌리면 완료일도 비움
    expect(s.backlog![0]!.doneDs).toBe('');
    toggleBacklog(s, '없는id'); // 조용히 무시
    delBacklog(s, id);
    expect(s.backlog!.length).toBe(1);
  });
});

describe('methodology — Anki 카드/요약 노트 빌드', () => {
  it('buildAnkiCards: 요약+오답 → TSV 라인(탭·개행 이스케이프)', () => {
    const s = st();
    addSummary(s, '2026-07-01', 'a', '수학', '핵심\t현상', '도구\n설명', '의미');
    addCbms(s, '2026-07-01', 'a', '수학', '1장', 'C', '메모');
    const lines = buildAnkiCards(s);
    expect(lines.length).toBe(2);
    lines.forEach((l) => expect(l.split('\t').length).toBe(3)); // 필드 안 탭은 공백으로
    expect(lines[0]).toContain('<br>'); // 개행은 <br>
    expect(lines[1]).toContain('오답::C');
    expect(buildAnkiCards(s, '2026-07-02').length).toBe(0); // 구간 필터
  });

  it('buildSummaryNotes: 날짜별 마크다운, 기록 없으면 빈 문자열', () => {
    const s = st({ _today: '2026-07-02' });
    expect(buildSummaryNotes(s)).toBe('');
    addSummary(s, '2026-07-01', 'a', '수학', '핵심', '도구', '의미');
    const md = buildSummaryNotes(s);
    expect(md).toContain('## 2026-07-01');
    expect(md).toContain('수학 — 핵심');
    expect(md).toContain('- **도구·어떻게**: 도구');
  });
});

describe('methodology — 규모/아카이빙/유지율', () => {
  it('recordCount·dataSizeKB', () => {
    const s = st({ completions: { '2026-07-01': { 'a|new': true, 'a|rev': true } } });
    addSummary(s, '2026-07-01', 'a', '수학', 'x', '', '');
    addCbms(s, '2026-07-01', 'a', '수학', '', 'C', '');
    expect(recordCount(s)).toBe(4);
    expect(dataSizeKB(st({ pad: 'x'.repeat(4096) }))).toBeGreaterThanOrEqual(4); // KB 반올림
    expect(dataSizeKB(st())).toBe(0); // 작은 state는 0으로 반올림
  });

  it('archiveOldData: cutoff 이전 기록을 archive로 분리하고 state에서 비운다', () => {
    const s = st({ completions: { '2000-01-01': { 'a|new': true }, '2999-01-01': { 'a|new': true } } });
    addSummary(s, '2000-01-01', 'a', '수학', 'x', '', '');
    addCbms(s, '2000-01-01', 'a', '수학', '', 'C', '');
    addBacklog(s, 'a', '수학', '옛 보충', '');
    s.backlog![0]!.done = true;
    s.backlog![0]!.doneDs = '2000-01-02';
    const { archive, count } = archiveOldData(s, 6);
    expect(count).toBe(4);
    expect(Object.keys(archive.completions)).toEqual(['2000-01-01']);
    expect(s.completions!['2000-01-01']).toBeUndefined();
    expect(s.completions!['2999-01-01']).toBeDefined(); // 미래(=cutoff 이후)는 유지
    expect(s.summaries!['2000-01-01']).toBeUndefined();
    expect(s.cbms!.length).toBe(0);
    expect(s.backlog!.length).toBe(0);
  });

  it('retention: 주별 스냅샷(같은 주는 교체)과 추세 delta', () => {
    const s = st();
    expect(retentionTrend(s).has).toBe(false);
    recordRetentionSnapshot(s, [
      { new: 3, learn: 2, review: 5, total: 100 },
      { new: 0, learn: 0, review: 10, total: 50 },
    ]);
    recordRetentionSnapshot(s, [{ new: 1, learn: 0, review: 1, total: 150 }]); // 같은 주 → 교체
    expect(s.retentionLog!.length).toBe(1);
    expect(s.retentionLog![0]!.due).toBe(2);
    s.retentionLog!.unshift({ wk: '2026-06-22', at: '', due: 9, cards: 140 }); // 지난 주 수동 시드
    const t = retentionTrend(s);
    expect(t.has).toBe(true);
    expect(t.delta).toBe(7); // 지난 주 9 → 이번 주 2 = 밀린 카드 7 감소
    recordRetentionSnapshot(s, 'not-array' as unknown as never); // 방어: 무시
    expect(s.retentionLog!.length).toBe(2);
  });
});
