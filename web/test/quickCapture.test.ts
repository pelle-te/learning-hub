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

/* ⚠⚠ **'시간' · '세션 유형' describe 두 개가 여기서 통째로 사라졌다**(P-18 · 2026-08-01).
   파서가 그 둘을 정확히 뽑았고 팔레트가 칩으로 보여줬는데 착지 지점(`captureRecord`)은
   `sid·name·topic·note` 넷만 만든다 — 화면이 약속한 것의 절반이 어디에도 안 갔다.
   근거와 "왜 과목·챕터는 남기나"는 `lib/quickCapture.ts` 머리주석이 SSOT.
   ⚠ 아래 케이스가 그 삭제를 **잠근다** — 다시 뽑기 시작하면 여기가 깨진다. */
describe('quickCapture — 지우기로 한 토큰은 다시 안 생긴다(P-18)', () => {
  it('시각·세션유형은 파싱되지 않고, 그 글자는 title 에 온전히 남는다', () => {
    const r = parseCapture('오후 3시 복습', NOW)!;
    expect(Object.keys(r)).toEqual(['title']);
    expect(r.title).toBe('오후 3시 복습'); // 안 뽑으니 안 걷어낸다 = 글자가 사라지지 않는다
  });
  it('날짜·과목·챕터는 그대로 뽑는다(착지가 있는 셋)', () => {
    const r = parseCapture('내일 알고리즘 2챕터', NOW, ['알고리즘'])!;
    expect(r.dateISO).toBe('2026-07-04');
    expect(r.subject).toBe('알고리즘');
    expect(r.chapter).toBe('2챕터');
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
    // '복습'은 더 이상 걷어내지 않으므로(P-18) title 에 남는다 — 뽑지 않은 글자는 버리지 않는다.
    expect(r.title).toBe('복습 중요');
    expect(r.dateISO).toBe('2026-07-04');
    expect(r.subject).toBe('알고리즘');
  });
  it('종합 문장 — 착지 있는 셋을 채우고 나머지 글자는 title 에 남는다', () => {
    const raw = '내일 오후 3시 알고리즘 2챕터 복습';
    const r = parseCapture(raw, NOW, SUBJECTS)!;
    expect(r.dateISO).toBe('2026-07-04');
    expect(r.chapter).toBe('2챕터');
    expect(r.subject).toBe('알고리즘');
    expect(r.title).toBe('오후 3시 복습');
  });
  it('공백/빈 문자열 → null', () => {
    expect(parseCapture('', NOW)).toBeNull();
    expect(parseCapture('   ', NOW)).toBeNull();
  });
  it('알 수 없는 입력 → title만', () => {
    const r = parseCapture('asdf qwerty', NOW)!;
    expect(r.title).toBe('asdf qwerty');
    expect(r.dateISO).toBeUndefined();
  });
});
