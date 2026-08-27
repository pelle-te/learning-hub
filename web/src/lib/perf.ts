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
  /** 프로세스 기동 → WebView2 문서 시작(ms). **셸이 아니면 null**(프로세스가 없다). */
  nativeToOrigin: number | null;
  /** 엔트리 → App 마운트(ms). 모르면 null. */
  entryToApp: number | null;
  /** App 마운트 → 첫 실데이터(ms). */
  appToData: number | null;
  /** 엔트리 → 첫 실데이터(ms) — 웹 층이 본 '앱이 떴다'. */
  total: number | null;
}

/* ⚠⚠ **웹 층 안쪽만 재면 「부팅」의 42% 다**(P035 · 2026-08-27 성능 축). 아래 마크 셋은 전부
   `performance.timeOrigin` 안쪽이고, 그 원점은 **WebView2 문서가 시작된 뒤**다. 실 셸 3회 실측
   중앙: spawn→origin **508 ms** · origin→entry 71 · entry→app 196 · app→first-data 42 =
   총 881 ms 중 **508(58%)이 이 모듈 밖**이었다. 네이티브 기동이 500 ms 느려져도 리드아웃은
   한 자릿수도 안 움직였다 — 「부팅 웨이브」라는 이름이 그만큼 넓은 것을 가리키지 않았다.

   ⚠ **이 모듈은 의존 0 을 유지한다**(머리주석의 계약). 그래서 여기서 커맨드를 부르지 않고,
   셸 진입점이 값을 **밀어 넣는다**. 브라우저·폰에서는 아무도 안 밀어 넣으므로 null 로 남고,
   그게 옳은 답이다(프로세스가 없다).
   ⚠ 단위는 **Unix epoch ms** 여야 한다 — `performance.timeOrigin` 과 같은 축이라 뺄셈이 성립한다.
      단조 시계를 넣으면 두 축을 못 잇는다(Rust 쪽 `boot.rs` 가 같은 계약을 적고 테스트로 잠근다). */
let nativeStartEpochMs: number | null = null;

/** 셸 진입점이 부른다(`main.tsx`). null 이면 무동작 — 한 번 들어온 값을 지우지 않는다. */
export function setNativeStart(epochMs: number | null): void {
  if (epochMs != null && Number.isFinite(epochMs)) nativeStartEpochMs = epochMs;
}

/**
 * 현재까지 기록된 부팅 웨이브. 아직 안 끝났으면 해당 칸이 null 이다(0 이 아니다 — 값 부재와 값 0 을 안 섞는다).
 *
 * ⚠⚠ **마크에서 직접 뺀다 — `measure` 엔트리를 읽지 않는다**(2026-08-01). 종전엔 위 `measure()` 가
 * 남긴 엔트리를 읽었는데, 그건 **`app` 이 `first-data` 보다 먼저 찍힌다**는 순서 가정에 기대고
 * 있었다. 그 가정이 `warmTab`(부팅 260ms 제거)으로 **깨졌다**: 첫 라우트가 더는 Suspense 를 타지
 * 않으면서 두 마크가 **같은 커밋**에 들어갔고, React 는 자식 이펙트(`TabReady`)를 부모 이펙트
 * (`App`)보다 **먼저** 돌리므로 `first-data` 가 앞선다. 그러면 `measure('boot:app→first-data')`
 * 는 시작 마크가 아직 없어 **조용히 안 만들어지고**, 리드아웃의 그 칸이 영구히 빈다 —
 * 이 저장소가 반복해서 물린 *"녹색이 '회귀 없음'이 아니라 '안 쟀음'을 뜻하는"* 형태다.
 * 마크 뺄셈은 순서와 무관하다. `measure` 는 DevTools 타임라인용으로만 남긴다(있으면 좋고 없어도 됨).
 *
 * ⚠ 음수는 **0 으로 접는다.** 위 순서 뒤집힘은 "App 마운트 뒤 데이터까지 -0.8ms"가 아니라
 * **"같은 커밋에 들어왔다 = 대기 0"** 이라는 뜻이다. 음수를 그대로 보이면 계량이 고장 난 것처럼
 * 읽히고, 이 값은 사람이 보는 리드아웃이다.
 */
export function bootWave(): BootWave {
  if (!ok()) return { nativeToOrigin: null, entryToApp: null, appToData: null, total: null };
  const at = (id: string): number | null => {
    const e = performance.getEntriesByName(id, 'mark');
    return e.length ? e[0]!.startTime : null;
  };
  const entry = at(BOOT_MARKS.entry);
  const app = at(BOOT_MARKS.app);
  const data = at(BOOT_MARKS.firstData);
  const span = (from: number | null, to: number | null): number | null =>
    from == null || to == null ? null : Math.max(0, Math.round(to - from));
  return {
    /* ⚠ `timeOrigin` 은 epoch ms 라 그대로 뺀다. 음수는 다른 칸과 같은 이유로 0 으로 접는다
       (시계 보정이 그 사이에 끼면 음수가 될 수 있고, 그건 「기동이 음수 ms」가 아니다). */
    nativeToOrigin:
      nativeStartEpochMs == null ? null : Math.max(0, Math.round(performance.timeOrigin - nativeStartEpochMs)),
    entryToApp: span(entry, app),
    appToData: span(app, data),
    total: span(entry, data),
  };
}
