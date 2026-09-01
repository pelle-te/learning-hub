/* ============================================================
   boundaryParse.test.ts — repo 경계(별도 git repo인 pipeline ↔ hub)의 방어를 잠근다.

   왜 이 파일이 생겼나(2026-07-19 플랫폼 감사 ③⑤): 두 방어가 "선언은 있는데 아무도 안 쓰는"
   상태였다.
   ① artifacts.gen.ts 가 부모 JSON Schema 에서 zod 스키마를 생성해두고("소비처 선택 사용")
      어떤 소비처도 선택하지 않아, 아티팩트 8종이 전부 `as T` 캐스팅이었다. 그래서 버전이
      그대로인 채 생산자가 필드명만 바꾸는 **가장 흔한 드리프트**를 아무도 못 잡았다.
   ② sanitizeImported 가 events 는 방어하면서 tasks 는 빠뜨렸다(ACTIVITY_KEYS·TaskSchema
      에는 이미 있었는데 여기만 누락) — 손상 백업의 tasks[].start 문자열이 캘린더 산술을
      NaN 으로 만든다.

   두 방어 모두 "없어도 테스트가 안 깨지는" 종류라, 여기서 명시적으로 잠근다.
============================================================ */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { parseArtifact } from '@/lib/artifacts';
import { sanitizeImported, defaults } from '@/lib/persistence';
import type { AppState } from '@/lib/schema';

afterEach(() => vi.restoreAllMocks());

/* ledger 계약의 최소 유효 형태(artifacts.gen 의 ledgerArtifactSchema 필수 필드).
   ⚠ subjects 는 배열이 아니라 **record**(과목명 → 과목객체)다 — 이 픽스처를 처음 배열로 썼다가
   테스트가 실패해서 알았다. 파싱이 실제로 동작한다는 증거. */
const LEDGER_OK = {
  _schemaVersion: 1,
  generated: '2026-07-19T00:00:00Z',
  n_chapters: 0,
  stage_counts: {},
  subjects: {},
} as const;

describe('경계 파싱 — parseArtifact', () => {
  it('모양이 계약과 맞으면 경고 없이 통과한다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    parseArtifact('ledger', LEDGER_OK);
    const shapeWarns = warn.mock.calls.filter((c) => String(c[0]).includes('모양이 계약과 다릅니다'));
    expect(shapeWarns).toHaveLength(0);
  });

  it('모양이 어긋나면 경고하되 원본을 그대로 돌려준다(비차단)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // subjects 가 record 가 아님 — 생산자가 타입을 바꾼 상황.
    const broken = { ...LEDGER_OK, subjects: '레코드가-아님' };
    const out = parseArtifact('ledger', broken);

    // 비차단 계약: 원본 그대로(탭을 빈 화면으로 만들지 않는다).
    expect(out).toBe(broken);
    // 그러나 조용하지 않다.
    expect(warn.mock.calls.some((c) => String(c[0]).includes('모양이 계약과 다릅니다'))).toBe(true);
  });

  it('경고에 어긋난 필드 경로가 담긴다(무엇이 바뀌었는지 알려준다)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    parseArtifact('ledger', { ...LEDGER_OK, subjects: '레코드가-아님' });
    const msg = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(msg).toContain('subjects');
  });

  it('미지 필드는 통과시킨다 — 생산자가 필드를 *추가*하는 건 깨짐이 아니다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    parseArtifact('ledger', { ...LEDGER_OK, 신규필드: 123 });
    expect(warn.mock.calls.some((c) => String(c[0]).includes('모양이 계약과 다릅니다'))).toBe(false);
  });

  it('null/undefined 에도 throw 하지 않는다(서버가 빈 응답을 줄 수 있다)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => parseArtifact('ledger', null)).not.toThrow();
    expect(() => parseArtifact('ledger', undefined)).not.toThrow();
  });
});

describe('sanitizeImported — tasks 방어(events 와 동형)', () => {
  const withTasks = (tasks: unknown[]): AppState => ({ ...defaults(), tasks }) as unknown as AppState;

  it('start/min 이 문자열이면 그 필드만 떼고 할 일은 살린다', () => {
    const out = sanitizeImported(withTasks([{ id: 't1', title: '과제 제출', start: '오후 3시', min: '2시간' }]));
    const t = (out as unknown as { tasks: Record<string, unknown>[] }).tasks[0];

    // 레코드는 살아남는다 — 사용자 저작물이라 최소 파괴.
    expect(t).toBeDefined();
    expect(t!.title).toBe('과제 제출');
    // 산술을 NaN 으로 만드는 필드만 제거 → '미지정 트레이 항목'으로 강등.
    expect(t!.start).toBeUndefined();
    expect(t!.min).toBeUndefined();
  });

  it('정상 수치는 건드리지 않는다', () => {
    const out = sanitizeImported(withTasks([{ id: 't1', title: '도서 반납', start: 900, min: 30 }]));
    const t = (out as unknown as { tasks: Record<string, unknown>[] }).tasks[0];
    expect(t!.start).toBe(900);
    expect(t!.min).toBe(30);
  });

  it('NaN·Infinity 도 유한수가 아니므로 제거한다', () => {
    const out = sanitizeImported(withTasks([{ id: 't1', title: 'x', start: NaN, min: Infinity }]));
    const t = (out as unknown as { tasks: Record<string, unknown>[] }).tasks[0];
    expect(t!.start).toBeUndefined();
    expect(t!.min).toBeUndefined();
  });

  it('비객체 원소는 제거한다', () => {
    const out = sanitizeImported(withTasks([null, '문자열', { id: 't1', title: '유효' }]));
    expect((out as unknown as { tasks: unknown[] }).tasks).toHaveLength(1);
  });

  it('tasks 가 없어도(구버전 백업) 무동작 — 무마이그레이션 계약', () => {
    const base = defaults() as unknown as AppState;
    expect(() => sanitizeImported(base)).not.toThrow();
  });
});
