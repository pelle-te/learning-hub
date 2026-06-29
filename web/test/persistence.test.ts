/* ============================================================
   persistence.test.ts — 영속/마이그레이션/방법론 데이터 호환 회귀(Vitest).
   레거시 test/state.test.js(S1~S11)를 새 lib(src/lib) 대상으로 이식 — 동작 parity 보증.
   boot/persist는 주입형 KV(Map 기반)로 검증(브라우저 없이).
============================================================ */
import { describe, expect, it } from 'vitest';
import { boot, CORRUPT_KEY, defaults, exportSnapshot, KEY, migrate, persist, SCHEMA_VERSION } from '@/lib/persistence';
import { addCbms, blankPassRate, buildAnkiCards, setBlankResult } from '@/lib/methodology';
import type { AppState, KV } from '@/lib/types';

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
