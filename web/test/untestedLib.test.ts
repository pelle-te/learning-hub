// @vitest-environment jsdom
/* ============================================================
   untestedLib.test.ts — **"테스트 가능성" 때문에 갈라 놓고 테스트가 없던 모듈들**(2026-08-20 리뷰 m-17).

   이 저장소는 *"IO 를 섞으면 vitest 에서 검증 불가"* 를 파일을 가르는 1순위 사유로 쓴다. 그런데
   그 사유로 `lib` 에 내려온 뒤 **테스트 트리에서 import 0건**인 모듈이 넷 있었다:
   `observations`(별도 파일이 담당) · `conflictView` · `perf`.
   여기 셋은 각각 크기가 작아 파일을 셋으로 쪼개면 머리주석이 본문보다 길어진다 — 대신
   **"순수인데 안 검사되던 것"** 이라는 한 가지 사유로 묶는다(`semesterAxis.test.ts` 가 같은 형태로
   자기 묶음을 정당화한다: 대상이 다르면 묶지 않는다, 사유가 같으면 묶는다).

   ⚠ 여기서 잠그는 것은 **표시 규칙과 폴백**이다 — 값 부재를 지어내지 않는가, 못 읽는 값을
   추측하지 않는가. 이 저장소가 반복해 물린 축(값 부재 ≠ 값 0)이 전부 그 자리다.
============================================================ */
import { describe, expect, it, vi } from 'vitest';

import { previewOf, tableLabel, whenLabel, RESTORE_CONFIRM } from '@/lib/conflictView';
import { BOOT_MARKS, bootWave, mark, setNativeStart } from '@/lib/perf';

describe('conflictView — 충돌을 사람 말로', () => {
  it('모르는 테이블은 **이름을 지어내지 않고** 그대로 보여준다', () => {
    expect(tableLabel('settings')).not.toBe('settings'); // 아는 것엔 라벨이 있다
    expect(tableLabel('완전히_새_테이블')).toBe('완전히_새_테이블');
  });

  it('빈 행은 "(빈 값)" — 빈 문자열을 그리면 값 부재가 화면에서 사라진다', () => {
    expect(previewOf([])).toBe('(빈 값)');
    expect(previewOf([null, undefined, ''])).toBe('(빈 값)');
  });

  it('긴 값은 잘리고 **잘렸다는 표시**가 남는다', () => {
    const long = 'x'.repeat(200);
    const s = previewOf([long], 20);
    expect(s.endsWith('…')).toBe(true);
    expect(s.length).toBeLessThanOrEqual(21);
  });

  it('못 읽는 시각은 **빈 문자열** — 지어내지 않는다', () => {
    expect(whenLabel(Number.NaN)).toBe('');
    expect(whenLabel(Date.UTC(2026, 7, 1, 3, 0))).not.toBe('');
  });

  it('되살리기 문구는 **파급을 말한다** — 두 화면이 같은 약속을 하기 위한 상수다', () => {
    expect(RESTORE_CONFIRM).toContain('덮어');
    expect(RESTORE_CONFIRM, '다른 기기로 전파된다는 사실이 빠지면 약속이 반쪽이다').toContain('다른 기기');
  });
});

describe('perf — 부팅 웨이브', () => {
  it('마크가 없으면 **null** 이다(0 이 아니다 — 안 잰 것과 0ms 는 다르다)', () => {
    vi.spyOn(performance, 'getEntriesByName').mockReturnValue([]);
    expect(bootWave()).toEqual({ nativeToOrigin: null, entryToApp: null, appToData: null, total: null });
    vi.restoreAllMocks();
  });

  /* ⚠ **셸이 아니면 `nativeToOrigin` 은 null 이다**(P035 · 2026-08-27). 프로세스가 없는 것과
     기동이 0 ms 인 것은 다르고, 이 값은 사람이 보는 리드아웃이다 — 0 을 그리면 «네이티브 기동이
     공짜» 라고 말하는 셈이 된다. 브라우저·폰에서는 아무도 `setNativeStart` 를 안 부른다. */
  it('네이티브 기동 시각을 안 밀어 넣으면 그 칸은 null 이다(0 이 아니다)', () => {
    const at: Record<string, number> = {
      [BOOT_MARKS.entry]: 10,
      [BOOT_MARKS.app]: 20,
      [BOOT_MARKS.firstData]: 30,
    };
    vi.spyOn(performance, 'getEntriesByName').mockImplementation(
      (n: string) => (at[n] == null ? [] : [{ startTime: at[n] } as PerformanceEntry]) as PerformanceEntryList,
    );
    expect(bootWave().nativeToOrigin, '셸이 아닌데 기동 구간이 채워졌다').toBeNull();
    vi.restoreAllMocks();
  });

  it('밀어 넣으면 `timeOrigin` 과 같은 축에서 뺀다 — 단위가 epoch ms 라는 계약', () => {
    setNativeStart(performance.timeOrigin - 500);
    const at: Record<string, number> = { [BOOT_MARKS.entry]: 10, [BOOT_MARKS.app]: 20, [BOOT_MARKS.firstData]: 30 };
    vi.spyOn(performance, 'getEntriesByName').mockImplementation(
      (n: string) => (at[n] == null ? [] : [{ startTime: at[n] } as PerformanceEntry]) as PerformanceEntryList,
    );
    expect(bootWave().nativeToOrigin).toBe(500);
    /* 단조 시계를 넣는 실수 — 그러면 `timeOrigin`(epoch)에서 빼서 **1970년 이래의 ms** 가 나온다.
       그건 음수가 아니라 터무니없이 큰 양수라 «0 으로 접기» 가드가 못 잡는다. Rust 쪽
       `boot.rs` 의 epoch 범위 테스트가 그 축을 잠그고, 여기는 계약을 문서로 남긴다. */
    vi.restoreAllMocks();
  });

  it('순서가 뒤집혀도 음수를 내지 않는다 — "대기 0" 이지 "-0.8ms" 가 아니다', () => {
    const at: Record<string, number> = {
      [BOOT_MARKS.entry]: 100,
      [BOOT_MARKS.app]: 90, // 같은 커밋에 들어온 경우
      [BOOT_MARKS.firstData]: 95,
    };
    vi.spyOn(performance, 'getEntriesByName').mockImplementation(
      (n: string) => (at[n] == null ? [] : [{ startTime: at[n] } as PerformanceEntry]) as PerformanceEntryList,
    );
    const w = bootWave();
    expect(w.entryToApp).toBe(0);
    expect(w.appToData).toBe(5);
    vi.restoreAllMocks();
  });

  it('같은 마크를 두 번 찍어도 한 번만 남는다(StrictMode 이중 마운트 방어)', () => {
    const marked: string[] = [];
    vi.spyOn(performance, 'getEntriesByName').mockImplementation(
      (n: string) => (marked.includes(n) ? [{ startTime: 1 } as PerformanceEntry] : []) as PerformanceEntryList,
    );
    vi.spyOn(performance, 'mark').mockImplementation((n: string) => {
      marked.push(n);
      return {} as PerformanceMark;
    });
    mark('entry');
    mark('entry');
    expect(marked.filter((x) => x === BOOT_MARKS.entry)).toHaveLength(1);
    vi.restoreAllMocks();
  });
});

/* ⚠ `icsFeed` 케이스가 여기 있었다 — 그 모듈이 삭제됐다(I050 · 2026-08-22). */
