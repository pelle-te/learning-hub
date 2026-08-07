// @vitest-environment jsdom
/* ============================================================
   selectorsCache.test.ts — 파생 캐시의 **무효화 규칙**(H3·H9 · 2026-07-26 감사).

   두 결함 다 "화면이 조용히 낡는" 부류다. 계산은 정확했고 캐시만 안 깨졌다:

   ① H3 — 캐시 키에 `_today` 가 **있는데** `persistence.migrate()` 가 부팅 때 그 시드를 지워
      프로덕션 값이 항상 `undefined` 였다. "키에 없다"가 아니라 **키는 있고 값이 무효**라,
      자정을 넘겨도 어제 블록·"남은 N"·밀림 수가 그대로 남았다(데스크톱은 며칠 켜 두는 앱이다).
   ② H9 — 위험·나브·반사실 캐시가 **루트 참조** 키였다. immer 는 무관 슬라이스 쓰기에도 새 루트를
      만들므로, `tasks` 드래그 한 번이 전량 재시뮬을 불렀다(AN-16 이 `selectSchedule` 만 고쳤다).

   그래서 여기서 검사하는 것은 값이 아니라 **재계산이 일어났는가/안 일어났는가**다.
============================================================ */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaults } from '@/lib/persistence';
import { selectSchedule, selectFinishGains, selectNavSignals, selectRiskSummary } from '@/store/selectors';
import type { AppState } from '@/lib/types';

/** `_today` 시드가 **없는** 상태 — 프로덕션과 같은 조건(migrate 가 지우므로). */
const noSeed = (): AppState => {
  const s = defaults() as AppState;
  delete (s as { _today?: string })._today;
  return s;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 6, 26, 10, 0, 0));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('H3 — 날짜가 바뀌면 캐시가 깨진다(자정 넘긴 앱이 어제를 보여주지 않게)', () => {
  it('같은 state 라도 하루가 지나면 스케줄이 다시 계산된다', () => {
    const s = noSeed();
    const before = selectSchedule(s);
    expect(selectSchedule(s)).toBe(before); // 같은 날 = 캐시 히트(성능 계약은 그대로)

    vi.setSystemTime(new Date(2026, 6, 27, 0, 30, 0)); // 자정을 넘겼다
    expect(selectSchedule(s)).not.toBe(before); // 시드가 없어도 깨진다 ← 여기가 결함이던 자리
  });

  it('나브 신호·위험 요약도 같은 규칙으로 깨진다(세 캐시 전부)', () => {
    const s = noSeed();
    const nav = selectNavSignals(s);
    const risk = selectRiskSummary(s);
    vi.setSystemTime(new Date(2026, 6, 27, 0, 30, 0));
    expect(selectNavSignals(s)).not.toBe(nav);
    expect(selectRiskSummary(s)).not.toBe(risk);
  });
});

describe('H9 — 무관 슬라이스 쓰기는 재계산을 부르지 않는다(튜플 키)', () => {
  it('backlog 만 바뀌면 반사실 완주일은 캐시 히트', () => {
    const s = noSeed();
    const first = selectFinishGains(s);
    // immer 처럼 **바뀐 슬라이스만** 새 참조로 — 나머지는 참조가 보존된다.
    const s2 = { ...s, backlog: [{ id: 'x', text: '보충', done: false }] } as unknown as AppState;
    expect(selectFinishGains(s2)).toBe(first); // 루트 참조 키였다면 여기서 전량 재시뮬이 돌았다
  });

  it('스케줄 입력이 바뀌면 재계산한다(캐시가 너무 세지 않다는 반대 방향 증명)', () => {
    const s = noSeed();
    const first = selectFinishGains(s);
    const s2 = { ...s, moduleLen: (s.moduleLen ?? 0) + 1 } as AppState;
    expect(selectFinishGains(s2)).not.toBe(first);
  });

  it('backlog 가 바뀌면 나브 신호는 재계산한다 — 보충 개수를 읽으므로', () => {
    const s = noSeed();
    const nav = selectNavSignals(s);
    const s2 = { ...s, backlog: [{ id: 'y', text: '보충', done: false }] } as unknown as AppState;
    expect(selectNavSignals(s2)).not.toBe(nav);
    /* ⚠ 키가 `journal` 이었다 — 그 탭은 W4(N-12)에서 레일을 떠났고, 레일은 **보이는 탭에만**
       신호를 붙이므로 그 문자열은 한 번도 렌더된 적이 없었다(W8 에서 발견 · `selectors.ts` 주석). */
    expect(selectNavSignals(s2)['review-run']).toContain('보충 1');
  });
});
