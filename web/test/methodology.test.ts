/* ============================================================
   methodology.test.ts — 학습방법론 데이터 레이어(순수 함수) 회귀.
   reads는 값 반환·뮤테이터는 받은 state 변형이라는 계약을 그대로 검증
   (persist/토스트/다운로드 없음 → jsdom 불필요, 평범한 객체로 충분).
============================================================ */
import { describe, expect, it } from 'vitest';
import {
  activityFeed,
  addBacklog,
  addCbms,
  addSummary,
  archivableCount,
  archiveOldData,
  recordBreakdown,
  backlogClosedBetween,
  blankPassRate,
  blankResultFor,
  buildAnkiCards,
  buildSummaryNotes,
  cbmsBetween,
  cbmsCounts,
  cbmsTop,
  cbmsTrend,
  CBMS_CODES,
  clearBlankResult,
  confRate,
  dataSizeKB,
  delBacklog,
  delCbms,
  delSummary,
  editBacklog,
  editCbms,
  editSummary,
  openBacklog,
  recordCount,
  recordRetentionSnapshot,
  retentionNudge,
  retentionTrend,
  setBlankResult,
  summariesFor,
  summaryCount,
  toggleBacklog,
} from '@/lib/methodology';

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
  it('at 작성시각을 남기고, 인라인 편집이 세 문장·과목만 갈아끼운다(id·at 보존)', () => {
    const s = st();
    addSummary(s, '2026-07-01', 'a', '수학', '핵심', '도구', '의미');
    const rec = summariesFor(s, '2026-07-01')[0]!;
    expect(typeof rec.at).toBe('number'); // 타임스탬프 기록
    const { id, at } = rec;
    editSummary(s, '2026-07-01', id, { sid: 'b', name: '물리', s1: '고침', s3: '결과만' });
    const after = summariesFor(s, '2026-07-01')[0]!;
    expect(after).toMatchObject({ id, at, sid: 'b', name: '물리', s1: '고침', s2: '도구', s3: '결과만' });
    editSummary(s, '2026-07-01', '없는id', { s1: '무시' }); // 없는 id는 조용히 무시
    expect(summariesFor(s, '2026-07-01')[0]!.s1).toBe('고침');
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

  it('at 작성시각 + 인라인 편집이 챕터·유형·메모·확신을 갈아끼운다(id·ds 보존)', () => {
    const s = st();
    addCbms(s, '2026-06-01', 'a', '수학', '1장', 'C', '개념 구멍');
    const rec = s.cbms![0]!;
    expect(typeof rec.at).toBe('number');
    editCbms(s, rec.id, { chapter: '2장', code: 'M', note: '유도 실수', conf: true });
    expect(s.cbms![0]).toMatchObject({
      id: rec.id,
      ds: '2026-06-01',
      chapter: '2장',
      code: 'M',
      note: '유도 실수',
      conf: true,
    });
    editCbms(s, '없는id', { note: '무시' }); // 없는 id는 조용히 무시
    expect(s.cbms![0]!.note).toBe('유도 실수');
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

  it('X-3: ds 미지정 시 _today 시드로 기록(벽시계 아님) — addCbms·setBlankResult·파생 CBMS 모두', () => {
    const s = st({ _today: '2026-07-01' });
    addCbms(s, '', 'a', '수학', '1장', 'C', '메모'); // ds 미지정 → 앱의 '오늘' 단일 출처
    expect(s.cbms![0]!.ds).toBe('2026-07-01');
    setBlankResult(s, '', 'a', '수학', false, '유도 막힘', '2장'); // ds 미지정 → 시드 날짜
    expect(s.blankResults![0]!.ds).toBe('2026-07-01');
    // 막힘 → 자동 연결된 CBMS도 같은 시드 날짜(벽시계 자정 경계 off-by-one 무력화)
    expect(s.cbms!.find((e) => e.note.includes('백지복습 막힘'))!.ds).toBe('2026-07-01');
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

  it('at 작성시각 + 인라인 편집이 주제·메모를 갈아끼운다(id·done 보존)', () => {
    const s = st();
    addBacklog(s, 'a', '수학', '테일러 전개', '급수 수렴 조건');
    const rec = s.backlog![0]!;
    expect(typeof rec.at).toBe('number');
    editBacklog(s, rec.id, { topic: '테일러/매클로린', note: '나머지항 평가' });
    expect(s.backlog![0]).toMatchObject({ id: rec.id, done: false, topic: '테일러/매클로린', note: '나머지항 평가' });
    editBacklog(s, '없는id', { topic: '무시' }); // 없는 id는 조용히 무시
    expect(s.backlog![0]!.topic).toBe('테일러/매클로린');
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

  it('retentionNudge: 악화(+delta)와 유의미한 절대량(≥20)일 때만 경고 문구', () => {
    const s = st();
    expect(retentionNudge(s)).toBeNull(); // 데이터 없음
    s.retentionLog = [
      { wk: '2026-06-22', at: '', due: 10, cards: 100 },
      { wk: '2026-06-29', at: '', due: 8, cards: 100 },
    ];
    expect(retentionNudge(s)).toBeNull(); // 감소 방향 — 조용
    s.retentionLog[1]!.due = 15;
    expect(retentionNudge(s)).toBeNull(); // 늘었지만 20장 미만 — 조용
    s.retentionLog[1]!.due = 34;
    expect(retentionNudge(s)).toContain('34장');
    expect(retentionNudge(s)).toContain('+24');
  });

  it('activityFeed: 5종 이벤트를 구간 필터·날짜 내림차순 단일 피드로', () => {
    const s = st({
      items: [{ id: 'a', name: '수학' }],
      completions: { '2026-07-01': { 'a|new': { done: true, min: 120 }, 'a|rev': { done: false, min: 0 } } },
    });
    addSummary(s, '2026-07-02', 'a', '수학', '핵심', '', '');
    addCbms(s, '2026-06-30', 'a', '수학', '1장', 'C', '');
    addBacklog(s, 'a', '수학', '테일러', '');
    s.backlog![0]!.done = true;
    s.backlog![0]!.doneDs = '2026-07-01';
    setBlankResult(s, '2026-06-20', 'a', '수학', true, '', ''); // 구간 밖
    const feed = activityFeed(s, '2026-06-26', '2026-07-02');
    expect(feed.map((e) => e.kind)).toEqual(['summary', 'done', 'backlog', 'cbms']); // 내림차순 + done:false·구간밖 제외
    expect(feed[1]!.detail).toBe('수학'); // sid→과목명 매핑
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

describe('CBMS_CODES / cbmsTop — 최다코드 argmax SSOT (AN-6·7)', () => {
  it('CBMS_CODES는 CBMS_INFO 5코드 집합', () => {
    expect([...CBMS_CODES].sort()).toEqual(['B', 'C', 'M', 'S', 'T']);
  });
  it('cbmsTop: 오답 0이면 null', () => {
    expect(cbmsTop({ C: 0, B: 0, M: 0, S: 0, T: 0 })).toBeNull();
  });
  it('cbmsTop: 최다 코드·개수·전체합', () => {
    const r = cbmsTop({ C: 1, B: 4, M: 2, S: 0, T: 3 });
    expect(r).toEqual({ code: 'B', n: 4, total: 10 });
  });
  it('cbmsTop: 동점이면 코드 순서(C→B→M→S→T)상 먼저를 유지', () => {
    // C와 M이 3으로 동점 — 먼저 만난 C가 top(> 비교라 뒤 동점은 교체 안 함).
    expect(cbmsTop({ C: 3, B: 0, M: 3, S: 0, T: 0 })?.code).toBe('C');
  });
});

describe('confRate — 과신 오답률 (AN-8)', () => {
  it('오답 없으면 null', () => {
    expect(confRate(st())).toBeNull();
  });
  it('conf 플래그 비율(%)을 반올림', () => {
    const s = st();
    addCbms(s, '2026-07-01', '', '', 'ch1', 'C', 'x', true);
    addCbms(s, '2026-07-01', '', '', 'ch2', 'M', 'y', false);
    addCbms(s, '2026-07-01', '', '', 'ch3', 'B', 'z', true);
    expect(confRate(s)).toEqual({ conf: 2, total: 3, rate: 67 });
  });
  it('구간 필터를 존중', () => {
    const s = st();
    addCbms(s, '2026-06-01', '', '', 'a', 'C', '', true);
    addCbms(s, '2026-07-05', '', '', 'b', 'C', '', false);
    expect(confRate(s, '2026-07-01', '2026-07-31')).toEqual({ conf: 0, total: 1, rate: 0 });
  });
});

describe('recordBreakdown / archivableCount — 설정 진단 (ST-5·4)', () => {
  const seed = () =>
    st({
      _today: '2026-07-15',
      completions: {
        '2026-01-01': { 'a|new': { done: true, min: 60 } },
        '2026-07-10': { 'b|new': { done: true, min: 30 } },
      },
      summaries: {
        '2026-01-02': [{ id: 's1', sid: '', name: '', s1: 'x', s2: '', s3: '', at: 0 }],
        '2026-07-11': [{ id: 's2', sid: '', name: '', s1: 'y', s2: '', s3: '', at: 0 }],
      },
      cbms: [
        { id: 'c1', ds: '2026-01-03', sid: '', name: '', chapter: '', code: 'C', note: '' },
        { id: 'c2', ds: '2026-07-12', sid: '', name: '', chapter: '', code: 'M', note: '' },
      ],
      backlog: [
        { id: 'b1', ds: '2026-01-04', sid: '', name: '', topic: 't', note: '', done: true, doneDs: '2026-01-05' },
        { id: 'b2', ds: '2026-07-13', sid: '', name: '', topic: 'u', note: '', done: false, doneDs: '' },
      ],
      blankResults: [{ id: 'k1', ds: '2026-01-06', sid: '', name: '', passed: true, note: '' }],
    });
  it('recordBreakdown: 범주별 카운트 + recordCount는 그 합', () => {
    const s = seed();
    const b = recordBreakdown(s);
    expect(b).toEqual({ done: 2, summaries: 2, cbms: 2, backlog: 2, blank: 1 });
    expect(recordCount(s)).toBe(2 + 2 + 2 + 2 + 1);
  });
  it('archivableCount: 6개월 이전 항목만 카운트 + archiveOldData(mutate)의 count와 일치', () => {
    const s = seed();
    const n = archivableCount(s, 6); // cutoff ≈ 2026-01-16 → 1월 항목들만(완료1·요약1·오답1·회수백로그1·백지1) = 5
    expect(n).toBe(5);
    const s2 = seed();
    expect(archiveOldData(s2, 6).count).toBe(n); // mutate 버전과 사전 카운트가 동일(SSOT parity)
  });
  it('archivableCount: 오래된 기록 없으면 0', () => {
    expect(archivableCount(st({ _today: '2026-07-15' }), 6)).toBe(0);
  });
});

describe('summariesFor — 순수 읽기(SD-5 회귀 가드)', () => {
  it('동결(frozen) state에서도 변형 없이 읽는다(autoFreeze 하위호환)', () => {
    const frozen = Object.freeze({}) as unknown as AppState;
    expect(() => summariesFor(frozen, '2026-07-01')).not.toThrow();
    expect(summariesFor(frozen, '2026-07-01')).toEqual([]);
    // state에 summaries 키를 심지 않는다(예전 지연초기화 부작용 제거).
    expect((frozen as Record<string, unknown>).summaries).toBeUndefined();
  });
});
