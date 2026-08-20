/* ============================================================
   resume.test.ts — 이어하기 커서(N-7)의 판정 규칙. 전부 순수 함수라 여기서 전량 덮인다.
============================================================ */
import { describe, expect, it } from 'vitest';
import {
  latestResume,
  putResume,
  clearResume,
  resumeLabel,
  resumeIndex,
  RESUME_TTL_MIN,
  focusRemainingMs,
  type ResumeCursor,
  RESUME_ROUTE,
  ownResume,
} from '@/lib/resume';

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

/* 화면이 약속한 진행과 러너가 실제로 착지하는 자리를 잇는 파서. 이 둘이 갈려 있던 동안
   칩은 `(7/12)` 라 말하고 러너는 언제나 1장부터 열렸다 — 이 기능이 막으려던 중복 학습을
   기능이 보장하던 자리다. */
describe('resume — 착지 인덱스', () => {
  const cur = (progress?: string) => ({ kind: 'review' as const, label: '복습 세션', at: NOW, progress });

  it('쓰는 쪽 규약과 맞물린다 — `idx+2`(다음 카드의 1-based) 를 0-based 로 되돌린다', () => {
    // ReviewRun.advance 가 idx=5 에서 쓴 값이 "7/12" 다 → 다시 열면 0-based 6 번 카드.
    expect(resumeIndex(cur('7/12'))).toBe(6);
    expect(resumeIndex(cur('1/12'))).toBe(0);
  });

  it('진행 표기가 없거나 형태가 아니면 null — 모르면 처음부터가 안전한 기본값이다', () => {
    expect(resumeIndex(cur())).toBeNull();
    expect(resumeIndex(cur('복습 중'))).toBeNull();
    expect(resumeIndex(cur('7'))).toBeNull();
    expect(resumeIndex(cur('0/12'))).toBeNull(); // 1-based 라 0 은 나올 수 없는 값
  });

  it('큐 길이는 보지 않는다 — 클램프는 실제 큐를 쥔 호출부의 몫', () => {
    expect(resumeIndex(cur('99/12'))).toBe(98);
  });
});

/* ── E26 다른 기기의 집중 세션(2026-07-29) ───────────────────────────────
   집중은 로컬 KV 에만 살아 기기를 넘지 않았다 → PC 에서 25분을 걸고 자리를 뜨면 폰은 모르고,
   그 블록을 폰에서 체크하면 PC 종료 토스트의 완료 제안과 이중이 된다. 커서에 종료 시각
   한 필드를 더해 닫는다. **읽기 전용**이라는 것이 이 기능의 경계다. */
describe('focusRemainingMs — 다른 기기가 지금 집중 중인가', () => {
  const NOW = 1_700_000_000_000;
  const cur = (p: Partial<ResumeCursor>): ResumeCursor => ({ kind: 'focus', label: '전자기학', at: NOW, ...p });

  it('종료 시각이 미래면 남은 시간을 준다', () => {
    expect(focusRemainingMs(cur({ endsAt: NOW + 90_000 }), NOW)).toBe(90_000);
  });

  it('이미 끝났으면 null — 남은 시간을 우기지 않는다(시계 어긋남 방어)', () => {
    expect(focusRemainingMs(cur({ endsAt: NOW - 1 }), NOW)).toBeNull();
  });

  it('집중이 아닌 커서는 null — 복습·기록 이어하기엔 종료 시각이 없다', () => {
    expect(focusRemainingMs(cur({ kind: 'review', endsAt: NOW + 90_000 }), NOW)).toBeNull();
  });

  it('옛 저장본(endsAt 없음)은 조용히 null — 무마이그레이션 계약', () => {
    expect(focusRemainingMs(cur({}), NOW)).toBeNull();
  });
});

describe("Q-27 'screen' 커서 — 떠날 때 남기는 되돌아갈 곳", () => {
  const NOW = 1_800_000_000_000;
  const screen = (over: Partial<ResumeCursor> = {}): ResumeCursor => ({
    kind: 'screen',
    label: '복습 예보',
    at: NOW,
    route: '/forecast',
    ...over,
  });

  it('유효한 커서로 인정된다(다른 기기에서 읽힌다)', () => {
    const st = { resume: { other: screen() } } as unknown as AppState;
    expect(latestResume(st, 'me', NOW)?.cur.kind).toBe('screen');
  });

  it("문구가 '이어하기'가 아니다 — 하던 일이 없으므로 되돌아가기다", () => {
    expect(resumeLabel(screen())).toBe('직전 화면 — 복습 예보');
  });

  it('경로를 커서가 들고 온다 — kind 가 화면을 정하는 다른 셋과 성질이 다르다', () => {
    expect(screen().route).toBe('/forecast');
    expect(RESUME_ROUTE.screen).toBe('/today'); // route 가 비었을 때의 폴백
  });

  it('ownResume 는 자기 커서를 본다 — latestResume 과 정반대다', () => {
    const st = { resume: { me: screen(), other: screen({ label: '남' }) } } as unknown as AppState;
    expect(ownResume(st, 'me', NOW)?.label).toBe('복습 예보');
    expect(latestResume(st, 'me', NOW)?.cur.label).toBe('남');
  });

  it('만료된 자기 커서는 null — 덮어쓰기 판정이 유령을 존중하지 않게', () => {
    const st = { resume: { me: screen({ at: NOW - 400 * 60_000 }) } } as unknown as AppState;
    expect(ownResume(st, 'me', NOW)).toBeNull();
  });
});
