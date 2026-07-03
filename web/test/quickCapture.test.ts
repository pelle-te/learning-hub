/* ============================================================
   quickCapture.test.ts — 자연어 캡처 파서(순수 함수) 회귀.
   기준시각 now를 고정 주입(2026-07-03 금요일)해 상대날짜를 결정적으로 검증.
   throw 없음·raw 공백만 null·title은 항상 비지 않음이라는 계약을 함께 확인.
============================================================ */
import { describe, expect, it } from 'vitest';
import { parseCapture } from '@/lib/quickCapture';

// 고정 기준: 2026-07-03 (금). getDay()===5. 이번주 월요일=2026-06-29.
const NOW = new Date(2026, 6, 3);
const SUBJECTS = ['알고리즘', '미적분', '선형대수'];

describe('quickCapture — 상대 날짜', () => {
  it('오늘/내일/모레/글피', () => {
    expect(parseCapture('오늘', NOW)?.dateISO).toBe('2026-07-03');
    expect(parseCapture('내일', NOW)?.dateISO).toBe('2026-07-04');
    expect(parseCapture('모레', NOW)?.dateISO).toBe('2026-07-05');
    expect(parseCapture('글피', NOW)?.dateISO).toBe('2026-07-06');
  });
  it('영어 today/tomorrow', () => {
    expect(parseCapture('today review', NOW)?.dateISO).toBe('2026-07-03');
    expect(parseCapture('tomorrow mock', NOW)?.dateISO).toBe('2026-07-04');
  });
  it('dateLabel 확인칩', () => {
    expect(parseCapture('내일 복습', NOW)?.dateLabel).toBe('내일');
  });
});

describe('quickCapture — 요일', () => {
  it('오늘이 금요일 → 금요일은 다음 주로', () => {
    expect(parseCapture('금요일 백지 미적분', NOW)?.dateISO).toBe('2026-07-10');
  });
  it('홑 요일은 now 이후 다음 등장(토=내일, 일=모레)', () => {
    expect(parseCapture('토요일', NOW)?.dateISO).toBe('2026-07-04');
    expect(parseCapture('일요일', NOW)?.dateISO).toBe('2026-07-05');
    expect(parseCapture('월요일', NOW)?.dateISO).toBe('2026-07-06');
  });
  it('이번주 X요일(지난 요일도 이번 주로)', () => {
    expect(parseCapture('이번주 월요일', NOW)?.dateISO).toBe('2026-06-29');
  });
  it('다음주 X요일(토요일은 홑 토요일과 달라야)', () => {
    expect(parseCapture('다음주 토요일', NOW)?.dateISO).toBe('2026-07-11');
    expect(parseCapture('담주 토요일', NOW)?.dateISO).toBe('2026-07-11');
  });
  it('요일 dateLabel', () => {
    expect(parseCapture('금요일', NOW)?.dateLabel).toBe('금요일');
    expect(parseCapture('다음주 수요일', NOW)?.dateLabel).toBe('다음주 수요일');
  });
});

describe('quickCapture — 절대 날짜', () => {
  it('N월 N일 — 지난 달이면 내년으로 롤', () => {
    expect(parseCapture('3월 2일 시험', NOW)?.dateISO).toBe('2027-03-02');
  });
  it('N월 N일 — 미래는 올해', () => {
    expect(parseCapture('8월 15일', NOW)?.dateISO).toBe('2026-08-15');
    expect(parseCapture('8월 15일', NOW)?.dateLabel).toBe('8월 15일');
  });
  it('N/N — 미래 올해 · 지난 날이면 내년', () => {
    expect(parseCapture('12/25 파티', NOW)?.dateISO).toBe('2026-12-25');
    expect(parseCapture('1/1', NOW)?.dateISO).toBe('2027-01-01');
  });
});

describe('quickCapture — 시간', () => {
  it('오후 3시 → 900', () => {
    const r = parseCapture('오후 3시 복습', NOW)!;
    expect(r.minute).toBe(900);
    expect(r.timeLabel).toBe('오후 3:00');
  });
  it('오전 9시 → 540', () => {
    expect(parseCapture('오전 9시', NOW)?.minute).toBe(540);
  });
  it('HH:MM (14:30 → 870)', () => {
    const r = parseCapture('14:30 미팅', NOW)!;
    expect(r.minute).toBe(870);
    expect(r.timeLabel).toBe('오후 2:30');
  });
  it('H시 M분 (9시 30분 → 570)', () => {
    expect(parseCapture('9시 30분', NOW)?.minute).toBe(570);
  });
  it('12시 → 720 · 오후 12시 → 720 · 오전 12시 → 0', () => {
    expect(parseCapture('12시', NOW)?.minute).toBe(720);
    expect(parseCapture('오후 12시', NOW)?.minute).toBe(720);
    expect(parseCapture('오전 12시', NOW)?.minute).toBe(0);
  });
  it("'반' → :30 (오후 3시 반 → 930, 3시 반 → 210)", () => {
    expect(parseCapture('오후 3시 반', NOW)?.minute).toBe(930);
    expect(parseCapture('3시 반', NOW)?.minute).toBe(210);
  });
});

describe('quickCapture — 세션 유형', () => {
  it('복습/리뷰/rev → rev', () => {
    expect(parseCapture('복습', NOW)?.sessionType).toBe('rev');
    expect(parseCapture('리뷰', NOW)?.sessionType).toBe('rev');
    expect(parseCapture('rev', NOW)?.sessionType).toBe('rev');
  });
  it('새/신규/new → new', () => {
    expect(parseCapture('신규 진도', NOW)?.sessionType).toBe('new');
    expect(parseCapture('new topic', NOW)?.sessionType).toBe('new');
  });
  it('백지/blank → blank', () => {
    expect(parseCapture('백지', NOW)?.sessionType).toBe('blank');
    expect(parseCapture('blank test', NOW)?.sessionType).toBe('blank');
  });
  it('모의/모의고사/mock → mock', () => {
    expect(parseCapture('모의고사', NOW)?.sessionType).toBe('mock');
    expect(parseCapture('mock', NOW)?.sessionType).toBe('mock');
  });
  it('anki/암기/카드 → anki', () => {
    expect(parseCapture('암기', NOW)?.sessionType).toBe('anki');
    expect(parseCapture('카드 뽑기', NOW)?.sessionType).toBe('anki');
  });
  it('키워드 없으면 undefined', () => {
    expect(parseCapture('그냥 메모', NOW)?.sessionType).toBeUndefined();
  });
});

describe('quickCapture — 챕터', () => {
  it('N챕터 / N장 / ch N / chapter N', () => {
    expect(parseCapture('2챕터', NOW)?.chapter).toBe('2챕터');
    expect(parseCapture('3장', NOW)?.chapter).toBe('3장');
    expect(parseCapture('ch 5', NOW)?.chapter).toBe('ch 5');
    expect(parseCapture('chapter 7', NOW)?.chapter).toBe('chapter 7');
  });
});

describe('quickCapture — 과목 매칭', () => {
  it('정확 부분문자열', () => {
    expect(parseCapture('알고리즘 복습', NOW, SUBJECTS)?.subject).toBe('알고리즘');
  });
  it('가장 긴 이름 우선', () => {
    expect(parseCapture('선형대수 공부', NOW, ['대수', '선형대수'])?.subject).toBe('선형대수');
  });
  it('토큰 공유(부분문자열 아님)', () => {
    expect(parseCapture('알고리즘 복습', NOW, ['알고리즘 기초'])?.subject).toBe('알고리즘 기초');
  });
  it('매칭 없으면 undefined', () => {
    expect(parseCapture('알고리즘 복습', NOW, ['미적분'])?.subject).toBeUndefined();
  });
  it('subjects 미제공이면 undefined', () => {
    expect(parseCapture('알고리즘 복습', NOW)?.subject).toBeUndefined();
  });
});

describe('quickCapture — title 추출 & 견고성', () => {
  it('토큰 걷어낸 나머지가 title', () => {
    const r = parseCapture('내일 알고리즘 복습 중요', NOW, ['알고리즘'])!;
    expect(r.title).toBe('중요');
    expect(r.dateISO).toBe('2026-07-04');
    expect(r.sessionType).toBe('rev');
    expect(r.subject).toBe('알고리즘');
  });
  it('종합 문장 — 모든 필드 채우고 title은 raw로 폴백(나머지 비면)', () => {
    const raw = '내일 오후 3시 알고리즘 2챕터 복습';
    const r = parseCapture(raw, NOW, SUBJECTS)!;
    expect(r.dateISO).toBe('2026-07-04');
    expect(r.minute).toBe(900);
    expect(r.sessionType).toBe('rev');
    expect(r.chapter).toBe('2챕터');
    expect(r.subject).toBe('알고리즘');
    expect(r.title).toBe(raw); // 나머지가 비어 원본으로 폴백
  });
  it('공백/빈 문자열 → null', () => {
    expect(parseCapture('', NOW)).toBeNull();
    expect(parseCapture('   ', NOW)).toBeNull();
  });
  it('알 수 없는 입력 → title만', () => {
    const r = parseCapture('asdf qwerty', NOW)!;
    expect(r.title).toBe('asdf qwerty');
    expect(r.dateISO).toBeUndefined();
    expect(r.minute).toBeUndefined();
    expect(r.sessionType).toBeUndefined();
  });
});
