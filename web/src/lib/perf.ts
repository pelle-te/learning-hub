/* ============================================================
   perf.ts — **런타임 계량**(W16 · 2026-07-31). 순수 · 의존 0.

   ## 왜 생겼나 — 관측되지 않는 층이었다
   `performance.mark`/`measure`/`PerformanceObserver`/`requestIdleCallback` 이 `web/src` 전체에
   **한 건도 없었다**(2026-07-31 실측). `npm run budget` 은 4축으로 **바이트**를 재지만 그 바이트가
   몇 ms 가 되는지는 아무도 안 봤다 — H14 가 "부팅 웨이브"라는 축을 만들어 낸 자리인데도 계량
   단위가 여전히 KB 였다. `lib/telemetry.ts` 는 에러만 싣는다.

   ## 무엇을 재는가 — 부팅 웨이브 3마크
   ① `entry`     — 엔트리 모듈이 평가된 시점(`main.tsx` 첫 줄)
   ② `app`       — `App` 청크가 마운트된 시점(SD-7 의 동적 import 가 끝난 시점)
   ③ `first-data`— 첫 화면이 **실제 데이터로** 그려진 시점(스켈레톤이 아니라)
   그리고 그 사이를 `measure` 로 잇는다 — DevTools Performance 패널에 그대로 뜬다.

   ⚠ **바이트의 짝이다.** W14 가 유리 3선언을 걷었는데 그게 실제로 싸지는지 재는 방법이 이것뿐이다.
   ⚠ 값을 화면에 띄우지 않는다(아직) — 계량이 먼저고 판단은 그 다음이다. 노출 지점은
     연동 탭의 텔레메트리 콘솔 하나이고, 그건 이 모듈의 `bootWave()` 를 읽기만 한다.
   ⚠ `performance` 가 없거나 마크가 빠져도 **조용히 무동작**이다 — 계량이 앱을 죽이면 본말전도다.
============================================================ */

/** 부팅 웨이브 마크 이름 — 문자열을 흩뿌리지 않는다(오타가 곧 영구 결측이다). */
export const BOOT_MARKS = {
  entry: 'hub:entry',
  app: 'hub:app',
  firstData: 'hub:first-data',
} as const;
export type BootMark = keyof typeof BOOT_MARKS;

const ok = (): boolean => typeof performance !== 'undefined' && typeof performance.mark === 'function';

/** 마크 1회 기록 — 같은 이름이 두 번 오면 **첫 번째만** 남긴다(React StrictMode 이중 마운트 방어). */
export function mark(name: BootMark): void {
  if (!ok()) return;
  const id = BOOT_MARKS[name];
  try {
    if (performance.getEntriesByName(id, 'mark').length) return;
    performance.mark(id);
    // 직전 단계와의 구간을 함께 남긴다 — 마크만 있으면 사람이 매번 빼기를 해야 한다.
    if (name === 'app') measure('boot:entry→app', BOOT_MARKS.entry, id);
    if (name === 'firstData') {
      measure('boot:app→first-data', BOOT_MARKS.app, id);
      measure('boot:entry→first-data', BOOT_MARKS.entry, id);
    }
  } catch {
    /* 계량 실패는 삼킨다 — 관측이 관측 대상을 죽이면 안 된다. */
  }
}

function measure(label: string, from: string, to: string): void {
  try {
    if (!performance.getEntriesByName(from, 'mark').length) return;
    performance.measure(label, from, to);
  } catch {
    /* 시작 마크가 없으면 구간이 없다 — 정상 경로(엔트리 마크 이전에 App 이 뜰 수는 없다). */
  }
}

export interface BootWave {
  /** 엔트리 → App 마운트(ms). 모르면 null. */
  entryToApp: number | null;
  /** App 마운트 → 첫 실데이터(ms). */
  appToData: number | null;
  /** 엔트리 → 첫 실데이터(ms) — 사용자가 체감하는 '앱이 떴다'. */
  total: number | null;
}

/** 현재까지 기록된 부팅 웨이브. 아직 안 끝났으면 해당 칸이 null 이다(0 이 아니다 — 값 부재와 값 0 을 안 섞는다). */
export function bootWave(): BootWave {
  if (!ok()) return { entryToApp: null, appToData: null, total: null };
  const dur = (label: string): number | null => {
    const e = performance.getEntriesByName(label, 'measure');
    return e.length ? Math.round(e[e.length - 1]!.duration) : null;
  };
  return {
    entryToApp: dur('boot:entry→app'),
    appToData: dur('boot:app→first-data'),
    total: dur('boot:entry→first-data'),
  };
}
