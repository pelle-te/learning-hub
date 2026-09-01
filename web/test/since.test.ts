/* ============================================================
   since.test.ts — T-13 "지난번 이후" 레이어.

   ⚠ 여기서 잠그는 것은 **세는 법이 아니라 안 그리는 조건**이다. 이 항목의 전제가
   _"델타가 화면당 5개 이하다 — 20개면 강조가 아니라 소음"_ 이었고, 그 문턱이 코드 밖으로
   새면(화면이 각자 판단하면) 한 번의 복붙으로 사라진다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { SINCE_NOISE_MAX, countableKeys, sinceCount } from '@/lib/since';
import type { AppState } from '@/lib/schema';

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

/* ============================================================
   C043(2026-08-22) — **저널 델타가 UTC 날짜로 셌다.**

   `COUNTERS.journal` 만 `toISOString().slice(0,10)` 이었고 비교 대상인 `seenDs` 는
   `todayISO()` = **로컬** 이다. KST 오전(00:00–09:00)에 쓴 요약은 전날 날짜가 붙어
   `ds > seenDs` 를 통과하지 못하고, `seenDs` 는 이미 전진했으므로 **다음 날에도 영영**
   배지에 안 뜬다. `utils.iso()` 가 정확히 이 함정 때문에 존재하는데 그 한 줄만 규약 밖이었다.

   ## ⚠⚠ 위 케이스가 못 잡은 이유 — 그리고 이 절이 왜 따로 있나

   위 픽스처는 `Date.parse('2026-08-03')` = **UTC 자정**이라 UTC 표현과 로컬 표현이 *우연히*
   같았다. 즉 결함이 있는 코드로도 초록이었다. 아래는 **로컬 시각으로** 날짜를 짓는다
   (`new Date(y, m, d, h)`) — 그러면 UTC 로 옮길 때 날짜가 밀리는 시간대에서 두 표현이 갈린다.

   ⚠ **이 파일 하나로는 부족하다**: `TZ=UTC` 에서는 어떤 픽스처를 써도 두 표현이 같아 판별력이
   0이다. 그래서 `vitest.config.ts` 의 **`tz` 프로젝트**(`TZ=Asia/Seoul`)가 짝이다(C052).
   아래 두 케이스는 UTC 에서도 **통과**하지만 거기서는 아무것도 재지 않는다 — 재는 것은 그 프로젝트다.
============================================================ */
describe('C043 저널 델타는 로컬 날짜로 센다 (TZ 매트릭스가 짝이다)', () => {
  const 요약 = (at: number) =>
    st({ summaries: { s: [{ id: 'x', sid: 's', name: 'n', s1: '', s2: '', s3: '', at }] } as never });

  it('로컬 오전에 쓴 요약이 그날 것으로 세어진다 — 동쪽(UTC+) 시간대의 실패', () => {
    // 로컬 2026-08-03 08:00. KST 라면 UTC 로는 08-02 23:00 → 옛 코드가 하루를 잃는다.
    const at = new Date(2026, 7, 3, 8, 0, 0).getTime();
    expect(sinceCount(요약(at), 'journal', '2026-08-02'), '아침에 쓴 요약이 배지에서 누락됐다').toBe(1);
  });

  it('로컬 밤에 쓴 요약이 다음 날 것으로 세어지지 않는다 — 서쪽(UTC−) 시간대의 대칭 실패', () => {
    // 로컬 2026-08-03 22:00. UTC−5 라면 UTC 로는 08-04 03:00 → 옛 코드가 하루를 앞당긴다.
    const at = new Date(2026, 7, 3, 22, 0, 0).getTime();
    expect(sinceCount(요약(at), 'journal', '2026-08-03'), '밤에 쓴 요약이 내일 것으로 세어졌다').toBeNull();
  });
});
