/* ============================================================
   resume.test.ts — 이어하기 커서(N-7)의 판정 규칙. 전부 순수 함수라 여기서 전량 덮인다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { latestResume, putResume, clearResume, resumeLabel, RESUME_TTL_MIN } from '@/lib/resume';
import type { AppState } from '@/lib/types';

const NOW = Date.UTC(2026, 6, 26, 12, 0, 0);
const MIN = 60_000;
const st = (resume: Record<string, unknown>): AppState => ({ resume }) as unknown as AppState;

describe('resume — 어느 커서를 보여줄 것인가', () => {
  it('**다른 기기** 커서만 본다 — 자기 커서를 이어하라고 권하면 방금 한 일을 되돌리란 말이 된다', () => {
    const s = st({
      me: { kind: 'focus', label: '내 것', at: NOW - MIN },
      other: { kind: 'review', label: '남의 것', at: NOW - 2 * MIN },
    });
    expect(latestResume(s, 'me', NOW)?.cur.label).toBe('남의 것');
  });

  it('6시간이 지나면 스스로 사라진다 — 커서는 할 일 목록이 아니다', () => {
    const fresh = st({ d: { kind: 'review', label: 'A', at: NOW - (RESUME_TTL_MIN - 1) * MIN } });
    const stale = st({ d: { kind: 'review', label: 'A', at: NOW - (RESUME_TTL_MIN + 1) * MIN } });
    expect(latestResume(fresh, 'me', NOW)).not.toBeNull();
    expect(latestResume(stale, 'me', NOW)).toBeNull();
  });

  it('미래 시각은 무시한다 — 안 그러면 영원히 안 없어지는 커서가 생긴다', () => {
    expect(latestResume(st({ d: { kind: 'focus', label: 'A', at: NOW + 10 * MIN } }), 'me', NOW)).toBeNull();
  });

  it('여러 기기면 가장 최근 것 하나', () => {
    const s = st({
      a: { kind: 'focus', label: '오래된', at: NOW - 30 * MIN },
      b: { kind: 'review', label: '최근', at: NOW - 5 * MIN },
    });
    expect(latestResume(s, 'me', NOW)?.deviceId).toBe('b');
  });

  it('모양이 깨진 행은 건너뛴다(다른 기기가 미래 버전을 쓸 수 있다)', () => {
    const s = st({ bad: { kind: 'nope', label: 1 }, ok: { kind: 'focus', label: 'A', at: NOW - MIN } });
    expect(latestResume(s, 'me', NOW)?.cur.label).toBe('A');
  });
});

describe('resume — 쓰기는 자기 행만', () => {
  it('put 은 자기 키만 건드린다(남의 행은 읽기 전용 = 동기화 충돌이 원리적으로 없다)', () => {
    const s = st({ other: { kind: 'review', label: '남', at: NOW } });
    putResume(s, 'me', { kind: 'focus', label: '내', at: NOW });
    const map = (s as unknown as { resume: Record<string, { label: string }> }).resume;
    expect(Object.keys(map).sort()).toEqual(['me', 'other']);
    expect(map.other!.label).toBe('남');
  });

  it('기기 id 가 없으면(클라우드 미연결) 아무것도 안 쓴다', () => {
    const s = st({});
    putResume(s, '', { kind: 'focus', label: 'A', at: NOW });
    expect((s as unknown as { resume: Record<string, unknown> }).resume).toEqual({});
  });

  it('이름 없는 커서는 안 쓴다 — 읽을 수 없는 이어하기는 이어하기가 아니다', () => {
    const s = st({});
    putResume(s, 'me', { kind: 'focus', label: '', at: NOW });
    expect((s as unknown as { resume: Record<string, unknown> }).resume).toEqual({});
  });

  it('clear 는 자기 행만 지운다', () => {
    const s = st({ me: { kind: 'focus', label: 'A', at: NOW }, other: { kind: 'focus', label: 'B', at: NOW } });
    clearResume(s, 'me');
    expect(Object.keys((s as unknown as { resume: Record<string, unknown> }).resume)).toEqual(['other']);
  });
});

describe('resume — 문구', () => {
  it('진행 표기가 있으면 함께 읽힌다', () => {
    expect(resumeLabel({ kind: 'review', label: '복습 세션', at: NOW, progress: '6/12' })).toBe(
      '복습 이어하기 — 복습 세션 (6/12)',
    );
    expect(resumeLabel({ kind: 'focus', label: '전자기학', at: NOW })).toBe('집중 이어하기 — 전자기학');
  });
});
