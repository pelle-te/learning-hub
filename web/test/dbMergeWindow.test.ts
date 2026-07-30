/* ============================================================
   dbMergeWindow.test.ts — **병합 반영 창의 판정 시점**(C-2 · 2026-07-30 `/감사 근본`).

   ## 왜 이 파일이 따로 있나

   이 결함은 플래그의 *값*이 아니라 **판정의 시점**이었다. 종전 회귀(`appSync.test.ts` 의
   C1 케이스)는 `beginMergeApply()` 를 **손으로 먼저 켜고** flush 를 불렀다 — 그러면 가드는
   당연히 발화하므로, *창이 켜지기 전에 시작된 flush* 라는 진짜 인터리브를 **원리적으로
   관측하지 못했다.** 그래서 정적 검사·유닛 전량 녹색인 채로 살아 있었다.

   ## 잠그는 인터리브

       ① `applyPull` 이 `runExclusive` 로 체인을 잡는다(pull 200행이면 수백 ms)
       ② 그 콜백의 **마지막 줄**에서 `beginMergeApply()` 가 켜진다  ← 여기가 핵심
       ③ ①과 ② 사이에 디바운스 flush 가 발화한다 → 이 순간 플래그는 **아직 false**

   종전 구현은 ③에서 체인 **밖**으로 판정했으므로 가드를 통과했고, 통과한 쓰기는 체인 뒤에
   줄을 서서 *병합-후 기준선* 과 *병합-전 메모리* 를 diff 했다 — 받아온 행을 되돌리는 upsert +
   상대 기기가 만든 행의 툼스톤. 그 되돌림이 LWW 로 서버까지 이겨 **다른 기기 편집이 영구
   소실**된다(가드가 막으려던 결과 그대로).

   ⚠ 브라우저(localStorage) 경로에는 이 게이트가 없고 **없는 것이 맞다** — 병합은 SQLite
     기준선(`readRows`/`setDiffBaseline`)에만 존재하므로 지킬 대상 자체가 없다. 종전 테스트가
     그 경로로 게이트를 검증한 것은 편의였고, 편의가 관측 범위를 좁히고 있었다.
============================================================ */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { writeRows, isDbAvailable, isSqlitePrimary, readTouched, readRows } = vi.hoisted(() => ({
  writeRows: vi.fn(),
  isDbAvailable: vi.fn(),
  isSqlitePrimary: vi.fn(),
  readTouched: vi.fn(),
  readRows: vi.fn(),
}));

vi.mock('@/lib/db/sqlite', () => ({
  writeRows,
  isDbAvailable,
  isSqlitePrimary,
  readTouched,
  readRows,
  /* 이 목의 구분자는 실물과 같을 필요가 없다 — 여기서 검사하는 것은 **판정 시점**이고
     되읽기 대조는 도달하지도 않는다(미룰 때는 SQL 을 한 줄도 안 쓴다). 실물의 NUL 구분자는
     `db/sqlite.ts` 의 `touchedKey` 가 소유한다. */
  touchedKey: (t: string, k: unknown[]) => [t, ...k].join('|'),
}));

import { writeAndVerify, runExclusive, beginMergeApply, endMergeApply, lastParity } from '@/lib/db/write';
import { defaults } from '@/lib/persistence';

beforeEach(() => {
  endMergeApply(); // 이전 케이스 잔류 방지 — 창이 열린 채 남으면 다음 케이스가 전부 미뤄진다
  writeRows.mockReset().mockResolvedValue({ ok: true, touched: [] });
  isDbAvailable.mockReset().mockResolvedValue(true);
  isSqlitePrimary.mockReset().mockReturnValue(true);
  readTouched.mockReset().mockResolvedValue(new Map());
  readRows.mockReset().mockResolvedValue(null);
});

describe('⚠⚠ 병합창 판정은 직렬화 체인 *안*에서 일어난다(C-2)', () => {
  it('플래그가 켜지기 *전에* 시작된 flush 도 미뤄진다 — 종전 구현이 통과시킨 그 창', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });

    /* `applyPull` 흉내 — 체인을 잡고 있다가 **마지막 줄**에서 창을 켠다(merge.ts 의 실제 순서). */
    const pull = runExclusive(async () => {
      await gate;
      beginMergeApply();
    });

    /* 이 시점 `isMergeApplyPending()` 은 **false** 다. 종전엔 여기서 판정해 통과했다. */
    const flushing = writeAndVerify(defaults());

    release();
    await pull;
    const r = await flushing;

    expect(r.deferred, '병합창에서 시작된 쓰기는 미뤄져야 한다(C-2)').toBe(true);
    expect(writeRows, '미뤘다면 SQL 을 한 줄도 쓰지 않는다 — 쓰면 받아온 행을 되돌린다').not.toHaveBeenCalled();
  });

  it('미룸은 실패가 아니다 — ok/unavailable 이 경고·폴백을 유발하지 않는다', async () => {
    beginMergeApply();
    const r = await writeAndVerify(defaults());
    expect(r.deferred).toBe(true);
    /* `ok:false` 면 호출부가 "저장 실패" 토스트를 띄우고, `unavailable` 이면 localStorage
       임시본 + 지속 배너까지 간다. 미룬 것은 그 둘 중 어느 것도 아니다. */
    expect(r.ok).toBe(true);
    expect(r.unavailable).toBe(false);
  });

  it('창이 닫히면 같은 호출이 정상적으로 쓴다(게이트가 상시가 아님)', async () => {
    endMergeApply();
    const r = await writeAndVerify(defaults());
    expect(r.deferred).toBeUndefined();
    expect(writeRows).toHaveBeenCalledTimes(1);
  });

  it('미룬 회차는 대조 진단을 오염시키지 않는다', async () => {
    // 먼저 정상 쓰기로 진단을 채운다.
    await writeAndVerify(defaults());
    const before = lastParity();

    beginMergeApply();
    await writeAndVerify(defaults());
    /* 미룬 회차가 `_last` 를 덮으면 설정 탭 진단이 "마지막 저장은 skipped" 라고 말하기
       시작한다 — 안 잰 것을 결과로 보고하는 형태(이 저장소가 H6 에서 못박은 규율). */
    expect(lastParity()).toEqual(before);
  });
});
