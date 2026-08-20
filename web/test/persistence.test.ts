/* ============================================================
   persistence.test.ts — 영속/마이그레이션/방법론 데이터 호환 회귀(Vitest).
   레거시 test/state.test.js(S1~S11)를 새 lib(src/lib) 대상으로 이식 — 동작 parity 보증.
   boot/persist는 주입형 KV(Map 기반)로 검증(브라우저 없이).
============================================================ */
import { describe, expect, it } from 'vitest';
import {
  boot,
  consumeBootFallback,
  CORRUPT_KEY,
  defaults,
  exportSnapshot,
  KEY,
  migrate,
  persist,
  sanitizeImported,
  restoreReviewTouch,
  reviewTouchOf,
  SCHEMA_VERSION,
  setChapterDone,
  setDone,
  studyStreak,
  touchReview,
} from '@/lib/persistence';
import { addCbms, blankPassRate, buildAnkiCards, setBlankResult } from '@/lib/methodology';
import type { KV } from '@/lib/types';

function memKV(): KV & { store: Map<string, string> } {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    store: m,
  };
}

/** 최소 유효 상태(validShape 통과용) */
function oldShape(extra?: Record<string, unknown>): Record<string, unknown> {
  return {
    items: [{ id: 'a', name: '수학', mode: 'weekly', weeklyHours: 5, chapters: [] }],
    routine: [],
    degree: { semesters: [] },
    startDate: '2026-01-01',
    ...(extra || {}),
  };
}
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

describe('persistence/migrate (S1~S6, S10~S11 parity)', () => {
  it('S1 migrate가 신규 필드(적응·실행레이어)를 보강', () => {
    const m = migrate(clone(oldShape()))!;
    expect(m).toBeTruthy();
    expect(m.adaptiveCapacity).toBe(true);
    expect(m.reviewViaAnki).toBe(false);
    expect(m.peakStart).toBe('');
    expect(typeof m.summaries).toBe('object');
    expect(Array.isArray(m.cbms)).toBe(true);
    expect(Array.isArray(m.backlog)).toBe(true);
    expect(m.blankReviewWeekly).toBe(true);
    expect(m.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('S2 migrate는 무효 입력을 null로 거부', () => {
    expect(migrate(null)).toBeNull();
    expect(migrate({})).toBeNull();
    expect(migrate({ items: [], routine: [] })).toBeNull();
  });

  it('S3 migrate가 _today 시드를 제거', () => {
    const m = migrate(oldShape({ _today: '2026-06-28' }))!;
    expect(m._today).toBeUndefined();
  });

  it('S4 migrate가 폐지된 "공부" 블록을 제거', () => {
    const m = migrate(
      oldShape({
        routine: [
          { id: 'b1', name: '공부', type: '공부', start: '09:00', end: '11:00', days: [1] },
          { id: 'b2', name: '수면', type: '수면', start: '00:00', end: '07:00', days: [0, 1, 2, 3, 4, 5, 6] },
        ],
      }),
    )!;
    expect(m.routine.length).toBe(1);
    expect(m.routine[0].type).toBe('수면');
  });

  it('S5 persist 후 boot가 동일 데이터를 복원', () => {
    const kv = memKV();
    const s = boot(kv);
    s.items.push({ id: 'z', name: '추가과목', mode: 'weekly', weeklyHours: 3, chapters: [] });
    s.summaries['2026-06-28'] = [{ id: 's1', sid: '', name: '추가과목', s1: 'a', s2: 'b', s3: 'c' }];
    persist(kv, s);
    const b = boot(kv);
    expect(b.items.some((i) => i.name === '추가과목')).toBe(true);
    expect(b.summaries['2026-06-28']).toBeTruthy();
  });

  it('S6 손상 raw는 CORRUPT_KEY에 보존하고 기본값으로 부팅', () => {
    const kv = memKV();
    kv.setItem(KEY, '{이건 깨진 JSON');
    const b = boot(kv);
    expect(Array.isArray(b.items)).toBe(true);
    expect(kv.getItem(CORRUPT_KEY)).toBe('{이건 깨진 JSON');
  });

  it('S10 exportSnapshot이 런타임 스캔 캐시를 제외', () => {
    const s = defaults() as AppState & Record<string, unknown>;
    s._vaultScan = { at: 1 };
    s._ankiLive = { decks: [] };
    s._ankiFile = { decks: [] };
    const snap = exportSnapshot(s) as Record<string, unknown>;
    expect(snap._vaultScan).toBeUndefined();
    expect(snap._ankiLive).toBeUndefined();
    expect(snap._ankiFile).toBeUndefined();
    expect(Array.isArray(snap.items)).toBe(true);
    expect(typeof snap.startDate).toBe('string');
  });

  it('S11 retentionLog 보강 + _icsExport export 제외', () => {
    const m = migrate(oldShape())!;
    expect(Array.isArray(m.retentionLog)).toBe(true);
    const s = defaults() as AppState & Record<string, unknown>;
    s._icsExport = { at: '2026-06-28T00:00:00Z', sig: 'x' };
    const snap = exportSnapshot(s) as Record<string, unknown>;
    expect(snap._icsExport).toBeUndefined();
  });
});

/* 부팅 폴백 마커 — IDB 복구 안내(BootRecovery)가 소비. 정상 부팅에선 절대 세팅되지 않아야 한다. */
describe('boot 폴백 마커(consumeBootFallback)', () => {
  it('정상 부팅(유효 저장본)에선 마커 없음', () => {
    const kv = memKV();
    persist(kv, defaults());
    boot(kv);
    expect(consumeBootFallback()).toBeNull();
  });

  it('저장본 없음 → missing, 소비하면 지워짐(1회성)', () => {
    boot(memKV());
    expect(consumeBootFallback()).toBe('missing');
    expect(consumeBootFallback()).toBeNull(); // StrictMode 이중 이펙트 대비
  });

  it('저장본 손상 → corrupt', () => {
    const kv = memKV();
    kv.setItem(KEY, '{이건 깨진 JSON');
    boot(kv);
    expect(consumeBootFallback()).toBe('corrupt');
  });

  it('초기화 후 재부팅(기본값이 persist됨)은 정상 부팅 — 마커 없음', () => {
    const kv = memKV();
    boot(kv); // 첫 부팅: missing
    persist(kv, defaults()); // resetAll → loadState(defaults()) → 즉시 persist와 동일
    boot(kv);
    expect(consumeBootFallback()).toBeNull();
  });
});

/* 런타임 캐시 저장 계약(2계층 스코프). 파일 내보내기는 전부 제외(S10·S11), 로컬 persist는
   소비되는 캐시(_ankiLive·_knowState·_icsExport)는 남기고 순수 휘발 캐시만 뗀다. */
describe('런타임 캐시 persist 계약(스코프별 선택 제외)', () => {
  it('로컬 persist→boot는 소비되는 캐시(_ankiLive·_knowState·_icsExport)를 보존(즉시 부팅)', () => {
    const kv = memKV();
    const s = boot(kv) as AppState & Record<string, unknown>;
    s._ankiLive = { decks: [{ due: 12 }] }; // 오늘 탭 KPI가 reload 후 읽음
    s._knowState = { subjects: [{ subject: '수학', mastery: 0.7 }] }; // 스케줄러 graphPriority
    s._icsExport = { at: '2026-06-29T00:00:00Z', sig: 'abc' }; // 캘린더 신선도 배지
    persist(kv, s);
    const b = boot(kv) as AppState & Record<string, unknown>;
    expect(b._ankiLive).toEqual({ decks: [{ due: 12 }] });
    expect(b._knowState).toEqual({ subjects: [{ subject: '수학', mastery: 0.7 }] });
    expect(b._icsExport).toEqual({ at: '2026-06-29T00:00:00Z', sig: 'abc' });
  });

  it('로컬 persist는 순수 휘발 캐시(_vaultScan·_ankiFile)는 떼어낸다', () => {
    const kv = memKV();
    const s = boot(kv) as AppState & Record<string, unknown>;
    s._vaultScan = { at: 1 };
    s._ankiFile = { decks: [] };
    persist(kv, s);
    const stored = JSON.parse(kv.getItem(KEY)!) as Record<string, unknown>;
    expect(stored._vaultScan).toBeUndefined();
    expect(stored._ankiFile).toBeUndefined();
  });

  it('파일 내보내기(exportSnapshot)는 로컬에 남는 캐시까지 전부 제외(이식성)', () => {
    const s = defaults() as AppState & Record<string, unknown>;
    s._ankiLive = { decks: [] };
    s._knowState = { subjects: [] };
    const snap = exportSnapshot(s) as Record<string, unknown>;
    expect(snap._ankiLive).toBeUndefined();
    expect(snap._knowState).toBeUndefined();
  });
});

describe('methodology 데이터 (S7~S9 parity)', () => {
  it('S7 buildAnkiCards가 요약·오답을 TSV로 생성', () => {
    const s = defaults();
    s.summaries['2026-06-28'] = [{ id: 's', sid: '', name: '전자기학', s1: '현상', s2: '도구', s3: '결과' }];
    s.cbms = [{ id: 'c', ds: '2026-06-28', sid: '', name: '전자기학', chapter: '3장', code: 'M', note: '유도막힘' }];
    const lines = buildAnkiCards(s);
    expect(lines.length).toBe(2);
    lines.forEach((l) => expect(l.split('\t').length).toBe(3));
    expect(lines[0].includes('전자기학')).toBe(true);
  });

  it('S8 addCbms가 확신없음(conf) 플래그를 기록', () => {
    const s = defaults();
    addCbms(s, '2026-06-28', '', '수학', '3장', 'M', '메모', true);
    expect(s.cbms[s.cbms.length - 1].conf).toBe(true);
    addCbms(s, '2026-06-28', '', '수학', '3장', 'M', '메모2');
    expect(s.cbms[s.cbms.length - 1].conf).toBe(false);
  });

  it('S9 setBlankResult: 막힘→CBMS(C) 연결·통과율 집계', () => {
    const s = defaults();
    const c0 = (s.cbms || []).length;
    setBlankResult(s, '2026-06-28', 'm', '수학', false, '변위전류 유도', '3장');
    expect((s.cbms || []).length).toBe(c0 + 1);
    expect(s.cbms[s.cbms.length - 1].code).toBe('C');
    setBlankResult(s, '2026-06-28', 'm', '수학', false, '다시', '3장');
    expect((s.cbms || []).length).toBe(c0 + 1); // 중복 막힘은 CBMS 추가 안 함
    setBlankResult(s, '2026-06-28', 'n', '물리', true, '', '');
    const pr = blankPassRate(s)!;
    expect(pr.total).toBe(2);
    expect(pr.passed).toBe(1);
  });
});

/* 연속 학습일(스트릭) — todayISO(state)를 읽으므로 state._today를 시드해 '오늘'을 고정한다.
   완료기록이 있는 날(맵에 항목이 하나라도) = 스트릭 카운트, 빈 맵({})은 미완료로 취급. */
describe('studyStreak — 연속 학습일(오늘/어제 폴백/끊김/빈맵)', () => {
  /** 지정한 날들에 완료기록을 심은 상태(_today 시드). */
  function streakState(today: string, doneDays: string[]): AppState {
    const s = defaults() as AppState;
    s._today = today;
    s.completions = {};
    doneDays.forEach((ds) => (s.completions![ds] = { 'x|new': { done: true, min: 30 } }));
    return s;
  }

  it('오늘만 완료 → 스트릭 1', () => {
    expect(studyStreak(streakState('2026-06-28', ['2026-06-28']))).toBe(1);
  });

  it('연속 3일(오늘 포함) → 3, 그 앞이 비면 멈춘다', () => {
    const s = streakState('2026-06-28', ['2026-06-26', '2026-06-27', '2026-06-28']); // 06-25는 없음
    expect(studyStreak(s)).toBe(3);
  });

  it('오늘은 공백이나 어제 있으면 어제부터 카운트(폴백)', () => {
    const s = streakState('2026-06-28', ['2026-06-26', '2026-06-27']); // 오늘(28) 없음
    expect(studyStreak(s)).toBe(2);
  });

  it('오늘·어제 모두 공백 → 끊긴 스트릭은 0', () => {
    const s = streakState('2026-06-28', ['2026-06-25']); // 28·27 둘 다 없음
    expect(studyStreak(s)).toBe(0);
  });

  it('빈 완료맵({}) 날은 미완료로 취급 — 오늘이 빈맵이면 어제로 폴백', () => {
    const s = streakState('2026-06-28', ['2026-06-27']);
    s.completions!['2026-06-28'] = {}; // 키만 있고 항목 0
    expect(studyStreak(s)).toBe(1);
  });

  it('완료기록이 전혀 없으면 0', () => {
    expect(studyStreak(streakState('2026-06-28', []))).toBe(0);
  });
});

describe('sanitizeImported — 가져오기 방어선(크래시 유발 레코드만 제거)', () => {
  it('잘못된 cbms.code는 제거하고 유효 레코드는 보존', () => {
    const s = {
      cbms: [
        { id: 'a', code: 'C', label: 'ok' },
        { id: 'b', code: 'Z', label: 'bad-code' }, // 열거 밖
        { id: 'c', code: 'M', label: 'ok2' },
      ],
    } as unknown as AppState;
    sanitizeImported(s);
    expect((s.cbms as { id: string }[]).map((c) => c.id)).toEqual(['a', 'c']);
  });

  it('completions의 비수치 min 엔트리만 제거', () => {
    const s = {
      completions: {
        s1: { '2026-06-01': { done: true, min: 60 }, '2026-06-02': { done: true, min: 'x' } },
      },
    } as unknown as AppState;
    sanitizeImported(s);
    const days = (s.completions as Record<string, Record<string, unknown>>).s1;
    expect(Object.keys(days)).toEqual(['2026-06-01']);
  });

  it('dayOverrides의 비string/number 값 제거, 정상 유지', () => {
    const s = {
      dayOverrides: { '2026-06-01': 120, '2026-06-02': 'rest', '2026-06-03': { bad: 1 } },
    } as unknown as AppState;
    sanitizeImported(s);
    expect(Object.keys(s.dayOverrides as object)).toEqual(['2026-06-01', '2026-06-02']);
  });

  it('필드가 없으면 무해(no-op)', () => {
    const s = { items: [], routine: [] } as unknown as AppState;
    expect(() => sanitizeImported(s)).not.toThrow();
  });
});

/* ── E1 복습 앵커 터치(2026-07-29) ───────────────────────────────────────
   `touchReview` 는 단조 증가라 되감기가 원리적으로 불가능하다 — 러너의 `U`(되돌리기)가
   세션 state 만 물리고 앵커를 두고 오면 **화면은 물렸다고 하고 모델은 인출했다고 하는**
   어긋남이 조용히 남는다. 그 짝(`restoreReviewTouch`)을 왕복으로 잠근다. */
describe('reviewTouches — 앵커 터치와 되돌리기가 왕복한다', () => {
  const empty = () => ({}) as unknown as AppState;

  it('없던 앵커를 만들고 조회한다', () => {
    const s = empty();
    expect(reviewTouchOf(s, 'p', '역학')).toBeUndefined();
    touchReview(s, 'p', '역학', '2026-07-29');
    expect(reviewTouchOf(s, 'p', '역학')).toBe('2026-07-29');
  });

  it('단조 증가 — 더 옛 날짜로는 뒤로 안 간다', () => {
    const s = empty();
    touchReview(s, 'p', '역학', '2026-07-29');
    touchReview(s, 'p', '역학', '2026-07-01');
    expect(reviewTouchOf(s, 'p', '역학')).toBe('2026-07-29');
  });

  it('되돌리기 — 원래 없었으면 **지운다**(빈 문자열이나 옛 값을 남기지 않는다)', () => {
    const s = empty();
    const prev = reviewTouchOf(s, 'p', '역학'); // undefined
    touchReview(s, 'p', '역학', '2026-07-29');
    restoreReviewTouch(s, 'p', '역학', prev);
    expect(reviewTouchOf(s, 'p', '역학')).toBeUndefined();
    expect(Object.keys(s.reviewTouches || {})).toHaveLength(0);
  });

  it('되돌리기 — 이전 값이 있었으면 그 값으로 되돌린다', () => {
    const s = empty();
    touchReview(s, 'p', '역학', '2026-07-20');
    const prev = reviewTouchOf(s, 'p', '역학');
    touchReview(s, 'p', '역학', '2026-07-29');
    expect(reviewTouchOf(s, 'p', '역학')).toBe('2026-07-29');
    restoreReviewTouch(s, 'p', '역학', prev);
    expect(reviewTouchOf(s, 'p', '역학')).toBe('2026-07-20');
  });

  it('앵커 키는 sid|chapter — 같은 챕터명이 과목을 넘나들지 않는다', () => {
    const s = empty();
    touchReview(s, 'p', '역학', '2026-07-29');
    expect(reviewTouchOf(s, 'm', '역학')).toBeUndefined();
  });
});

describe('T-8 시각 원장 — 완료에 하루 중 시각이 붙는다', () => {
  const st = (over: Record<string, unknown> = {}) =>
    ({ completions: {}, _today: '2026-08-02', ...over }) as unknown as AppState;

  it('완료를 체크하면 doneAt(HH:MM)이 기록된다', () => {
    const s = st({ _nowHm: '21:40' });
    setDone(s, '2026-08-02', 'sub1', 'new', 120, true);
    expect(s.completions['2026-08-02']!['sub1|new']).toMatchObject({
      done: true,
      doneDs: '2026-08-02',
      doneAt: '21:40',
    });
  });

  it('_nowHm 시드가 없으면 벽시계 HH:MM 형식이다', () => {
    const s = st();
    setDone(s, '2026-08-02', 'sub1', 'new', 120, true);
    expect(s.completions['2026-08-02']!['sub1|new']!.doneAt).toMatch(/^\d{2}:\d{2}$/);
  });

  it('체크 해제는 종전대로 항목을 지운다 — 이 조각은 완료 의미를 안 건드린다', () => {
    const s = st({ _nowHm: '21:40' });
    setDone(s, '2026-08-02', 'sub1', 'new', 120, true);
    setDone(s, '2026-08-02', 'sub1', 'new', 120, false);
    expect(s.completions['2026-08-02']).toBeUndefined();
  });

  it('⚠ _nowHm 시드는 가져온 데이터에서 제거된다 — 안 그러면 전 완료 시각이 고정값이 된다', () => {
    // 시드 제거의 자리는 `migrate` 다(`sanitizeImported` 가 아니라) — `_today` 가 이미 거기 있고
    // 부팅 경로가 전부 `migrate` 를 지난다. `_nowHm` 을 다른 자리에 두면 한쪽 입구로만 새어든다.
    const cleaned = migrate({ ...defaults(), _today: '2026-01-01', _nowHm: '03:00' })!;
    expect(cleaned._today).toBeUndefined();
    expect((cleaned as { _nowHm?: string })._nowHm).toBeUndefined();
  });
});

describe('Q-1 진도 커밋 — 블록에서 챕터를 확정한다', () => {
  const mk = () =>
    ({
      items: [
        {
          id: 'sub1',
          name: '전자기학',
          mode: 'weekly',
          chapters: [
            { id: 'c1', name: '1장', hours: 2, done: false },
            { id: 'c2', name: '2장', hours: 2, done: false },
          ],
        },
      ],
    }) as unknown as AppState;

  it('이름으로 찾아 done + doneDs 를 쓴다 — 블록이 가진 것이 이름뿐이라서', () => {
    const s = mk();
    setChapterDone(s, 'sub1', '2장', true, '2026-08-02');
    expect(s.items[0]!.chapters![1]).toMatchObject({ done: true, doneDs: '2026-08-02' });
    expect(s.items[0]!.chapters![0]!.done).toBe(false);
  });

  it('해제하면 doneDs 도 지운다 — 복습 앵커가 유령으로 남지 않게', () => {
    const s = mk();
    setChapterDone(s, 'sub1', '2장', true, '2026-08-02');
    setChapterDone(s, 'sub1', '2장', false, '2026-08-02');
    expect(s.items[0]!.chapters![1]!.done).toBe(false);
    expect(s.items[0]!.chapters![1]!.doneDs).toBeUndefined();
  });

  it('없는 챕터·없는 과목은 조용히 무동작(예외로 블록 토글을 깨뜨리지 않는다)', () => {
    const s = mk();
    expect(() => setChapterDone(s, 'sub1', '없는장', true, '2026-08-02')).not.toThrow();
    expect(() => setChapterDone(s, 'nope', '1장', true, '2026-08-02')).not.toThrow();
    expect(s.items[0]!.chapters!.every((c) => !c.done)).toBe(true);
  });
});
