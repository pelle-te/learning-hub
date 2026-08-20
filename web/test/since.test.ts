/* ============================================================
   since.test.ts — T-13 "지난번 이후" 레이어.

   ⚠ 여기서 잠그는 것은 **세는 법이 아니라 안 그리는 조건**이다. 이 항목의 전제가
   _"델타가 화면당 5개 이하다 — 20개면 강조가 아니라 소음"_ 이었고, 그 문턱이 코드 밖으로
   새면(화면이 각자 판단하면) 한 번의 복붙으로 사라진다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { SINCE_NOISE_MAX, countableKeys, sinceCount } from '@/lib/since';

const cbms = (ds: string, i: number) =>
  ({ id: `c${i}`, ds, sid: 's', name: 's', chapter: 'c', code: 'C', note: '' }) as never;
const st = (o: Partial<AppState>): AppState => ({ cbms: [], questions: [], summaries: {}, ...o }) as never;

describe('sinceCount', () => {
  it('마지막으로 본 뒤 생긴 것만 센다', () => {
    const s = st({ cbms: [cbms('2026-07-30', 1), cbms('2026-08-02', 2), cbms('2026-08-03', 3)] });
    expect(sinceCount(s, 'mistakes', '2026-08-01')).toBe(2);
  });

  it('소음 문턱을 넘으면 **수를 안 준다**(null) — 이게 이 파일의 요점이다', () => {
    const many = Array.from({ length: SINCE_NOISE_MAX + 1 }, (_, i) => cbms('2026-08-03', i));
    expect(sinceCount(st({ cbms: many }), 'mistakes', '2026-08-01')).toBeNull();
    // 경계 바로 아래는 준다 — 판별력이 있는지 함께 본다.
    expect(sinceCount(st({ cbms: many.slice(0, SINCE_NOISE_MAX) }), 'mistakes', '2026-08-01')).toBe(SINCE_NOISE_MAX);
  });

  it('0 은 표식이 아니다 — 평온엔 아무것도 안 그린다', () => {
    expect(sinceCount(st({ cbms: [cbms('2026-07-01', 1)] }), 'mistakes', '2026-08-01')).toBeNull();
  });

  it('한 번도 안 본 화면은 null — 첫 방문의 "23건"은 델타가 아니라 전체 개수다', () => {
    expect(sinceCount(st({ cbms: [cbms('2026-08-03', 1)] }), 'mistakes', undefined)).toBeNull();
  });

  it('셀 수 없는 화면은 0 이 아니라 null — 값 부재와 값 0 을 같은 픽셀로 그리지 않는다', () => {
    expect(sinceCount(st({}), 'stats', '2026-08-01')).toBeNull();
    expect(countableKeys()).not.toContain('stats');
  });

  it('문항 원장·학습 기록도 센다', () => {
    const q = st({ questions: [{ id: 'q', ds: '2026-08-03', sid: 's', prompt: 'p' }] as never });
    expect(sinceCount(q, 'questions', '2026-08-01')).toBe(1);
    const j = st({
      summaries: {
        s: [{ id: 'x', sid: 's', name: 'n', s1: '', s2: '', s3: '', at: Date.parse('2026-08-03') }],
      } as never,
    });
    expect(sinceCount(j, 'journal', '2026-08-01')).toBe(1);
  });
});
