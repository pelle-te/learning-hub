/* ============================================================
   utils.test.ts — 순수 유틸 함수 회귀(Vitest). 날짜·시간 변환은 TZ에 민감하고
   여러 탭(오늘·통계·스케줄·캘린더)이 공유하므로, 경계값을 고정해 드리프트를 막는다.
============================================================ */
import { describe, expect, it } from 'vitest';
import {
  addDays,
  agoLabel,
  clamp,
  dayDiff,
  ddayInfo,
  fmt,
  fmtShort,
  hLabel,
  iso,
  itemById,
  jsq,
  mondayOf,
  parseISO,
  pctLabel,
  toHM,
  toMin,
  minuteSegments,
  todayISO,
  weekLabel,
} from '@/lib/utils';

describe('iso / parseISO — 로컬 날짜(UTC 밀림 방지)', () => {
  it('iso는 로컬 연·월·일을 0패딩해 YYYY-MM-DD로 만든다', () => {
    expect(iso(new Date(2026, 0, 5))).toBe('2026-01-05'); // 1월=0, 한 자리 월/일 패딩
    expect(iso(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
  it('자정 직후에도 날짜가 전날로 밀리지 않는다(로컬 기준)', () => {
    expect(iso(new Date(2026, 5, 29, 0, 30))).toBe('2026-06-29');
  });
  it('parseISO ∘ iso 왕복은 같은 날짜를 보존한다', () => {
    const d = new Date(2026, 5, 29);
    expect(iso(parseISO(iso(d)))).toBe('2026-06-29');
  });
});

describe('todayISO — 오늘의 단일 출처', () => {
  it('state._today가 있으면 그 시드를 그대로 쓴다', () => {
    expect(todayISO({ _today: '2026-06-23' } as Pick<AppState, '_today'>)).toBe('2026-06-23');
  });
  it('시드가 없으면 실제 오늘(iso(new Date()))로 폴백한다', () => {
    expect(todayISO(null)).toBe(iso(new Date()));
    expect(todayISO()).toBe(iso(new Date()));
  });
});

describe('addDays — 불변(원본 미변경)', () => {
  it('양수·음수 이동이 정확하고 월 경계를 넘는다', () => {
    expect(iso(addDays(new Date(2026, 5, 29), 3))).toBe('2026-07-02');
    expect(iso(addDays(new Date(2026, 5, 1), -1))).toBe('2026-05-31');
  });
  it('원본 Date를 변형하지 않는다', () => {
    const d = new Date(2026, 5, 29);
    addDays(d, 10);
    expect(iso(d)).toBe('2026-06-29');
  });
});

describe('dayDiff — 일수 차(부호 포함)', () => {
  it('미래는 양수, 과거는 음수, 같은 날은 0', () => {
    expect(dayDiff('2026-06-23', '2026-06-29')).toBe(6);
    expect(dayDiff('2026-06-29', '2026-06-23')).toBe(-6);
    expect(dayDiff('2026-06-29', '2026-06-29')).toBe(0);
  });
  it('월·연 경계를 정확히 넘는다(DST 무관 반올림)', () => {
    expect(dayDiff('2026-12-31', '2027-01-01')).toBe(1);
  });
});

/* ============================================================
   C038(2026-08-22) — **자정 걸침 분할 규칙이 세 벌이었다.**

   `scheduler/windows.ts` 둘 · `scheduler/layout.ts` 하나가 글자 그대로 같은 식을 각자 들고
   있었고 셋을 잇는 것은 산문뿐이었다(*"수면과 동일 규칙"* · *"freeWindows 분할과 동일 규칙"*).
   이 부류는 **이미 한 번 청구됐다** — `windows.ts` 가 옛 구현이 `23:00–07:00` 한 칸을 놓쳐
   «심야에 공부를 배정»한 사고를 적어 뒀다. 다음 재발 경로는 «`s === e` 를 종일로 읽어야 하는
   요구»이고, 그때 두 벌만 고쳐지면 **스케줄러가 점유로 뺀 시간을 타임라인은 폭 0 으로 그린다.**
   지금은 규칙의 집이 `utils.minuteSegments` 하나다.
============================================================ */
describe('minuteSegments — 자정 걸침 분할의 단일 정본(C038)', () => {
  it('자정을 안 걸치면 한 구간', () => {
    expect(minuteSegments('09:00', '10:45')).toEqual([[540, 645]]);
  });

  it('자정을 걸치면 두 구간 — 안 쪼개면 e<s 로 걸러져 그 시간이 공부 가능으로 남는다', () => {
    expect(minuteSegments('23:00', '01:00')).toEqual([
      [1380, 1440],
      [0, 60],
    ]);
  });

  it('⚠ 시작=끝은 **폭 0 한 구간**이다(종일이 아니다) — 이 판정이 세 소비처에 하나여야 한다', () => {
    expect(minuteSegments('07:00', '07:00')).toEqual([[420, 420]]);
  });

  it('총 길이가 보존된다 — 쪼개기가 시간을 만들거나 없애지 않는다', () => {
    const 길이 = (segs: [number, number][]) => segs.reduce((a, [s, e]) => a + (e - s), 0);
    expect(길이(minuteSegments('23:00', '07:00'))).toBe(480); // 8시간
    expect(길이(minuteSegments('13:00', '14:00'))).toBe(60);
  });
});

describe('toMin / toHM — 분↔HH:MM', () => {
  it('toMin은 HH:MM을 분으로, 분 생략 시 0으로 본다', () => {
    expect(toMin('09:30')).toBe(570);
    expect(toMin('00:00')).toBe(0);
    expect(toMin('9')).toBe(540); // 분 없는 입력
    expect(toMin('23:59')).toBe(1439);
  });
  it('toHM은 분을 0패딩 HH:MM으로, 반올림한다', () => {
    expect(toHM(570)).toBe('09:30');
    expect(toHM(0)).toBe('00:00');
    expect(toHM(1439)).toBe('23:59');
    expect(toHM(89.6)).toBe('01:30'); // 반올림(90분)
  });
});

describe('clamp', () => {
  it('범위 안은 그대로, 밖은 경계로 자른다', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
});

describe('jsq — 출력 이스케이프', () => {
  it('jsq는 백슬래시·작은따옴표·개행/CR을 차단한다', () => {
    expect(jsq("a'b")).toBe("a\\'b");
    expect(jsq('a\\b')).toBe('a\\\\b');
    expect(jsq('a\nb\rc')).toBe('a bc');
  });
});

describe('hLabel — 분→시간 표시', () => {
  it('소수 첫째 자리로 반올림하고 h를 붙인다', () => {
    expect(hLabel(120)).toBe('2h');
    expect(hLabel(90)).toBe('1.5h');
    expect(hLabel(100)).toBe('1.7h'); // 1.666… → 1.7
  });
});

describe('mondayOf / weekLabel — 월요일 시작 주', () => {
  it('주중 어느 요일이든 그 주 월요일 자정을 돌려준다', () => {
    // 2026-06-29는 월요일
    expect(iso(mondayOf(new Date(2026, 5, 29)))).toBe('2026-06-29');
    // 일요일(2026-07-05)은 같은 주 월요일(06-29)로
    expect(iso(mondayOf(new Date(2026, 6, 5)))).toBe('2026-06-29');
    // 토요일(2026-07-04)도 06-29
    expect(iso(mondayOf(new Date(2026, 6, 4)))).toBe('2026-06-29');
  });
  it('자정으로 정규화한다(시각 0)', () => {
    const m = mondayOf(new Date(2026, 5, 29, 15, 30));
    expect(m.getHours()).toBe(0);
    expect(m.getMinutes()).toBe(0);
  });
  it('weekLabel은 월~일 범위를 M/D ~ M/D로 표기', () => {
    expect(weekLabel(new Date(2026, 5, 29))).toBe('6/29 ~ 7/5');
  });
});

describe('fmt / fmtShort', () => {
  it('fmt는 M/D (요일), fmtShort는 M/D', () => {
    const d = new Date(2026, 5, 29); // 월요일
    expect(fmt(d)).toBe('6/29 (월)');
    expect(fmtShort(d)).toBe('6/29');
  });
});

describe('itemById', () => {
  const state = {
    items: [
      { id: 'a', name: '수학' },
      { id: 'b', name: '영어' },
    ],
  } as unknown as Pick<AppState, 'items'>;
  it('id로 항목을 찾고, 없으면 undefined', () => {
    expect(itemById(state, 'b')?.name).toBe('영어');
    expect(itemById(state, 'zzz')).toBeUndefined();
  });
  it('items가 비어도 throw하지 않는다', () => {
    expect(itemById({ items: [] } as unknown as Pick<AppState, 'items'>, 'a')).toBeUndefined();
  });
});

describe('ddayInfo — 마감 라벨/강조색', () => {
  it('당일은 D-DAY, 미래는 D-n, 과거는 D+n', () => {
    expect(ddayInfo(0).lab).toBe('D-DAY');
    expect(ddayInfo(5).lab).toBe('D-5');
    expect(ddayInfo(-3).lab).toBe('D+3');
  });
  it('cls는 지남=bad, 임박(≤7)=warn, 여유=빈문자', () => {
    expect(ddayInfo(-1).cls).toBe('bad');
    expect(ddayInfo(0).cls).toBe('warn');
    expect(ddayInfo(7).cls).toBe('warn');
    expect(ddayInfo(8).cls).toBe('');
  });
});

/* ── 상대 시각 표기 ────────────────────────────────────────────────────────
   `markets.fmtPublished`(뉴스)에만 있던 규칙을 올린 것. 두 번째 소비처는 ⋯ 메뉴의
   "되돌리기"가 **언제 것인지** 말하는 자리다 — 그게 없던 동안 되돌리기는 며칠 전 상태로
   조용히 갈 수 있었다. */
describe('agoLabel — 짧은 상대표기', () => {
  const NOW = Date.UTC(2026, 6, 29, 12, 0, 0);
  const ago = (ms: number) => agoLabel(NOW - ms, NOW);

  it('경계값', () => {
    expect(ago(0)).toBe('방금');
    // ⚠ 반올림이라 30초를 넘기면 '1분 전'이다(floor 아님) — 옛 `fmtPublished` 의 거동 그대로.
    expect(ago(29_000)).toBe('방금');
    expect(ago(59_000)).toBe('1분 전');
    expect(ago(3 * 60_000)).toBe('3분 전');
    expect(ago(2 * 3600_000)).toBe('2시간 전');
    expect(ago(24 * 3600_000)).toBe('어제');
    expect(ago(3 * 24 * 3600_000)).toBe('3일 전');
  });

  it('일주일이 넘으면 날짜로 — "39일 전"은 사람이 못 읽는다', () => {
    expect(ago(40 * 24 * 3600_000)).toMatch(/^\d+\/\d+$/);
  });

  it('미래 시각(시계 오차)은 방금으로 접는다 — "-3분 전"은 결함으로 읽힌다', () => {
    expect(agoLabel(NOW + 5 * 60_000, NOW)).toBe('방금');
  });
});

describe('pctLabel — 사전분포 검역(부모 ②#54)', () => {
  it('null 은 0% 가 아니라 "미측정" — 없는 것과 0인 것은 다르다', () => {
    expect(pctLabel(null)).toBe('미측정');
  });
  it('undefined(로딩 중)는 종전대로 0% — 로딩 상태와 검역 상태를 섞지 않는다', () => {
    expect(pctLabel(undefined)).toBe('0%');
  });
  it('정상 수치는 회귀 없음', () => {
    expect(pctLabel(0)).toBe('0%');
    expect(pctLabel(0.474)).toBe('47%');
    expect(pctLabel(1)).toBe('100%');
  });
});
