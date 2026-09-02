/* ============================================================
   icsParse.test.ts — **`.ics` 를 거꾸로 읽는다**(I008 · 2026-08-22 발상 축).

   겨누는 곳은 셋이고, 셋 다 **조용히 틀리는** 부류다:
   ① **접힌 줄** — 75옥텟 넘는 강의명이 두 줄로 잘려 온다. 안 펴면 이름이 뭉개지는데 화면은
      멀쩡히 뜬다(빈 문자열이 아니라 *잘린* 문자열이라 검사에 안 걸린다).
   ② **반복 주기** — 격주·서수(`2MO`)를 매주로 펴면 **없는 수업이 매주 가용시간을 먹는다.**
      가용시간은 계획 전체를 누르므로, 여기서 조용히 틀리면 그 여파가 앱 끝까지 간다.
   ③ **시간대** — 벽시계 값을 UTC 로 오해하면 9시 수업이 0시가 된다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { icsDraftIsEmpty, lectureToBlock, matchLectureSid, parseIcs, readIcsTime } from '@/lib/icsParse';
import { BLOCK_CLASS } from '@/lib/utils';

const cal = (...events: string[]): string =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events.flatMap((e) => ['BEGIN:VEVENT', e, 'END:VEVENT']), 'END:VCALENDAR'].join(
    '\r\n',
  );

describe('readIcsTime — 벽시계와 UTC 를 가른다', () => {
  it('TZID 가 붙은 값은 **벽시계 그대로**다', () => {
    expect(readIcsTime('20260302T090000')).toEqual({ ds: '2026-03-02', min: 540 });
  });

  it('종일(VALUE=DATE)은 분이 없다', () => {
    expect(readIcsTime('20260302')).toEqual({ ds: '2026-03-02', min: null });
  });

  it('⚠ `Z` 는 UTC 다 — 로컬로 환산한다(파일이 벽시계가 아니라고 명시한 값)', () => {
    const t = readIcsTime('20260302T000000Z')!;
    const local = new Date(Date.UTC(2026, 2, 2, 0, 0, 0));
    /* ⚠ `ds` 도 함께 잰다(C073 · 2026-09-02). 종전엔 `min` 만 봐서, `ds` 를 UTC 날짜 그대로 돌려주는
       회귀가 서쪽 TZ(`tz-west` · LA)에서 **하루 틀린 채** 초록이었다 — 자정 UTC 는 그쪽에서 전날이다.
       이 파일은 `vitest.tz.config.ts` 매트릭스 안이라 그 축이 실제로 돈다. */
    const ds = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
    expect(t).toEqual({ ds, min: local.getHours() * 60 + local.getMinutes() });
  });

  it('형태가 아니면 null — 지어내지 않는다', () => {
    expect(readIcsTime('내일 아침')).toBeNull();
  });
});

describe('시간표 — 주 반복이 일과 블록이 된다', () => {
  it('BYDAY 여럿을 요일 배열로(0=일 축)', () => {
    const d = parseIcs(
      cal(
        [
          'SUMMARY:회로이론',
          'DTSTART;TZID=Asia/Seoul:20260302T090000',
          'DTEND;TZID=Asia/Seoul:20260302T104500',
          'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20260620T000000Z',
          'LOCATION:팔달관 401',
        ].join('\r\n'),
      ),
    );
    expect(d.lectures).toEqual([{ name: '회로이론', days: [1, 3], start: '09:00', end: '10:45', where: '팔달관 401' }]);
    expect(d.unparsed).toBe(0);
    expect(d.events).toBe(1);
  });

  it('⚠ BYDAY 가 없으면 **DTSTART 의 요일**로 — 주 1회 강의가 통째로 새면 안 된다', () => {
    // 2026-03-05 는 목요일.
    const d = parseIcs(
      cal(['SUMMARY:전자회로2', 'DTSTART:20260305T130000', 'DTEND:20260305T150000', 'RRULE:FREQ=WEEKLY'].join('\r\n')),
    );
    expect(d.lectures[0]!.days).toEqual([4]);
  });

  it('⚠⚠ 격주(INTERVAL=2)는 일과로 안 옮긴다 — 없는 수업이 매주 시간을 먹는다', () => {
    const d = parseIcs(
      cal(['SUMMARY:격주 세미나', 'DTSTART:20260302T090000', 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO'].join('\r\n')),
    );
    expect(d.lectures).toEqual([]);
    expect(d.unparsed, '버렸으면 **버렸다고 세야 한다**').toBe(1);
  });

  /* ⚠⚠ C035(2026-08-22) — `COUNT=n` 은 위 `INTERVAL=2` 와 **같은 축의 다른 갈래**였는데
     한쪽만 막혀 있었다. 3주짜리 보강이 종료 개념 없는 `RoutineBlock` 이 되어 3주 뒤부터
     매주 그 시간을 영구히 먹고, 재인입이 정상 사용(I010)이라 반입마다 하나씩 쌓였다. */
  it('⚠⚠ 유한 반복(COUNT=n)은 일과로 안 옮긴다 — 끝난 뒤에도 매주 시간을 먹는다', () => {
    // ⚠ 제목에 눈금 어휘(「보강」 등)를 쓰지 마라 — 단발 눈금으로 착지해 `unparsed` 가 0이 된다.
    const d = parseIcs(
      cal(['SUMMARY:임시 특강', 'DTSTART:20260302T190000', 'RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=3'].join('\r\n')),
    );
    expect(d.lectures, '유한 반복이 상시 일과가 됐다').toEqual([]);
    expect(d.unparsed, '버렸으면 **버렸다고 세야 한다**').toBe(1);
  });

  it('⚠ 그 옆칸인 `UNTIL` 은 그대로 통과한다 — 학기 종료 표기이고 뜻이 반대다', () => {
    const d = parseIcs(
      cal(
        ['SUMMARY:정규 강의', 'DTSTART:20260302T090000', 'RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20260620T000000Z'].join(
          '\r\n',
        ),
      ),
    );
    expect(d.lectures.map((l) => l.name)).toEqual(['정규 강의']);
  });

  it('⚠ 서수 BYDAY(`2MO` 둘째 월요일)도 주 반복이 아니다', () => {
    const d = parseIcs(
      cal(['SUMMARY:월례회의', 'DTSTART:20260302T090000', 'RRULE:FREQ=WEEKLY;BYDAY=2MO'].join('\r\n')),
    );
    expect(d.lectures).toEqual([]);
  });

  it('끝 시각이 없으면 한 시간 — 0분 블록은 목록만 채운다', () => {
    const d = parseIcs(cal(['SUMMARY:채플', 'DTSTART:20260302T110000', 'RRULE:FREQ=WEEKLY;BYDAY=MO'].join('\r\n')));
    expect(d.lectures[0]).toMatchObject({ start: '11:00', end: '12:00' });
  });

  it('⚠ 접힌 줄을 편다 — 안 펴면 긴 강의명이 조용히 잘린다', () => {
    const long = 'SUMMARY:자료구조및알고리즘이해 (전자공학과 3학년 1분반';
    const d = parseIcs(cal([long, ' · 팔달관)', 'DTSTART:20260302T090000', 'RRULE:FREQ=WEEKLY;BYDAY=MO'].join('\r\n')));
    expect(d.lectures[0]!.name).toBe('자료구조및알고리즘이해 (전자공학과 3학년 1분반· 팔달관)');
  });

  it('이름이 없는 이벤트는 버린다 — 이름 없는 블록은 일과에서 못 고른다', () => {
    const d = parseIcs(cal(['DTSTART:20260302T090000', 'RRULE:FREQ=WEEKLY;BYDAY=MO'].join('\r\n')));
    expect(d.lectures).toEqual([]);
    expect(d.unparsed).toBe(1);
  });
});

describe('학사일정 — 붙여넣기 경로와 **같은 어휘**로 읽는다', () => {
  it('휴강·수강 정정이 눈금이 된다', () => {
    const d = parseIcs(
      cal(
        ['SUMMARY:개교기념일 휴강', 'DTSTART;VALUE=DATE:20260406'].join('\r\n'),
        ['SUMMARY:수강 정정 기간', 'DTSTART;VALUE=DATE:20260309'].join('\r\n'),
      ),
    );
    expect(d.marks).toEqual([
      { kind: 'off', ds: '2026-04-06', label: '개교기념일 휴강' },
      { kind: 'fix', ds: '2026-03-09', label: '수강 정정 기간' },
    ]);
  });

  it('중간·기말은 시험으로 — 눈금보다 우선한다', () => {
    const d = parseIcs(cal(['SUMMARY:중간고사 기간', 'DTSTART;VALUE=DATE:20260420'].join('\r\n')));
    expect(d.exams).toEqual([{ kind: 'mid', date: '2026-04-20', week: null }]);
    expect(d.marks).toEqual([]);
  });

  it('⚠ 제목이 밋밋하면 DESCRIPTION 도 본다 — 학사일정 `.ics` 가 그 형태로 온다', () => {
    const d = parseIcs(
      cal(['SUMMARY:학사일정', 'DESCRIPTION:2학기 수강 철회 마감', 'DTSTART;VALUE=DATE:20260501'].join('\r\n')),
    );
    expect(d.marks[0]).toMatchObject({ kind: 'drop', ds: '2026-05-01' });
  });

  it('아무 어휘에도 안 걸리면 `unparsed` — 조용히 버리지 않는다', () => {
    const d = parseIcs(cal(['SUMMARY:동아리 MT', 'DTSTART;VALUE=DATE:20260510'].join('\r\n')));
    expect(icsDraftIsEmpty(d)).toBe(true);
    expect(d).toMatchObject({ unparsed: 1, events: 1 });
  });
});

/* ── I013 — 수업이 과목의 일부가 된다 ──────────────────────────────────────────────── */
describe('matchLectureSid — 강의명을 과목에 묶는다', () => {
  const ITEMS = [
    { id: 'a', name: '회로이론' },
    { id: 'b', name: '전자회로2' },
    { id: 'c', name: '물리화학' },
  ];

  it('공백을 무시하고 정확 일치를 우선한다', () => {
    expect(matchLectureSid('회 로 이 론', ITEMS)).toBe('a');
  });

  it('⚠ 포함이면 **길이차가 가장 작은** 후보 — 「물리」가 「물리화학」을 먹지 않게', () => {
    expect(matchLectureSid('물리', [{ id: 'x', name: '물리화학' }, ...ITEMS])).toBe('x');
    expect(matchLectureSid('물리화학 실험', ITEMS)).toBe('c');
  });

  it('⚠ 못 맞추면 undefined — 지어내지 않는다(교양 수업은 학습 항목이 아예 없다)', () => {
    expect(matchLectureSid('대학글쓰기', ITEMS)).toBeUndefined();
    expect(matchLectureSid('', ITEMS)).toBeUndefined();
  });
});

describe('lectureToBlock — 일과 블록의 계약', () => {
  it('유형은 수업으로 고정 · 요일 배열은 사본이다', () => {
    const l = { name: '회로이론', days: [1, 3], start: '09:00', end: '10:45' };
    const b = lectureToBlock(l, BLOCK_CLASS);
    expect(b).toMatchObject({ name: '회로이론', type: BLOCK_CLASS, start: '09:00', end: '10:45', days: [1, 3] });
    expect(b.id, 'id 는 저장 계약이라 lib 이 발급한다').toBeTruthy();
    b.days.push(9);
    expect(l.days, '초안을 공유하면 두 번 적용할 때 오염된다').toEqual([1, 3]);
  });

  it('⚠ 과목을 못 맞췄으면 `sid` 키를 **아예 안 만든다** — `undefined` 를 담으면 저장 계약에 빈 칸이 생긴다', () => {
    const b = lectureToBlock({ name: '대학글쓰기', days: [2], start: '10:00', end: '11:00' }, BLOCK_CLASS);
    expect('sid' in b).toBe(false);
    expect(lectureToBlock({ name: '회로이론', days: [1], start: '09:00', end: '10:00' }, BLOCK_CLASS, 'a').sid).toBe(
      'a',
    );
  });
});
