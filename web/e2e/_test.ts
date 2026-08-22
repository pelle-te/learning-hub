/* ============================================================
   _test.ts — **모든 트랙 A 케이스가 비동기 실패를 본다**(C067 · 2026-08-22 · 근본 원인 **R2**).

   ## 왜 스펙마다가 아니라 여기인가

   R2 = *"비동기 실패가 어느 층에도 안 걸린다."* 근거 셋 중 셋째가 **«e2e 가 `pageerror` 를
   검사하지 않는다»** 였다(실측: `page.on('pageerror'…)` 가 저장소 전체에 `phone.spec.ts` 한 곳).

   `C051`(타입 인지 린트)이 그 축의 절반을 닫았지만 `checksVoidReturn.attributes: false` 로
   **69곳**(`onClick={async …}`)을 범위 밖에 뒀다. 그 69곳은 **눌러야** 거부가 난다 — 즉
   «화면을 열어 보는» 검사로는 원리적으로 안 걸린다. 실제로 `asyncErrors.spec.ts` 의 전 화면
   순회는 **0건**을 냈다. 그 0은 «없다»가 아니라 «이 순회는 안 누른다» 였다.

   누르는 것은 **다른 스펙들**이다(`smoke`·`plan`·`visual`·`a11y` 가 클릭·드래그·팔레트를 돈다).
   그래서 리스너를 스펙마다 손으로 다는 대신 **`test` 를 한 겹 감싼다** — 새 스펙이 생겨도
   자동으로 덮인다(손 목록은 표류한다는 이 저장소의 규율 그대로).

   ## 계약

   · `pageerror` — 페이지의 동기 예외.
   · `unhandledrejection` — 떠 있는 거부. Playwright 이벤트가 **아니라서** 페이지 안에 직접 걸고,
     `addInitScript` 로 **첫 스크립트보다 먼저** 걸어야 부팅 중 거부도 잡힌다.
   · 케이스가 끝날 때 하나라도 있으면 **그 케이스를 실패시킨다.**

   ⚠ **일부러 오류를 내는 케이스**(`asyncErrors.spec.ts` 의 검출력 확인)는 `expectAsyncFailures`
   로 «이만큼 날 것이다»를 선언한다 — 선언 없이 나면 실패다. 예외를 「무시 목록」이 아니라
   **선언**으로 두는 이유: 무시 목록은 조용히 자라지만 선언은 그 케이스 안에 보인다.

   ⚠ 트랙 A(Chromium + `vite preview`)라 **WebView2 에서만 나는 것은 원리적으로 못 본다** —
   그건 트랙 B 의 몫이다. 여기서 재는 것은 «앱 코드가 스스로 만드는 거부»다.
============================================================ */
import { test as base, expect, type Page } from '@playwright/test';

export interface AsyncFailure {
  kind: 'pageerror' | 'rejection';
  text: string;
}

const 수집 = new WeakMap<Page, AsyncFailure[]>();
const 예상 = new WeakMap<Page, number>();

/** 이 케이스는 **의도적으로** 비동기 실패를 만든다고 선언한다(검출력 확인용). */
export function expectAsyncFailures(page: Page, n: number): void {
  예상.set(page, n);
}

/** 지금까지 잡힌 것 — 케이스가 직접 들여다볼 때 쓴다. */
export function asyncFailures(page: Page): AsyncFailure[] {
  return 수집.get(page) ?? [];
}

export const test = base.extend<{ 비동기실패감시: void }>({
  비동기실패감시: [
    async ({ page }, use) => {
      const out: AsyncFailure[] = [];
      수집.set(page, out);
      page.on('pageerror', (e) => out.push({ kind: 'pageerror', text: e.message }));
      await page.exposeFunction('__reportRejection', (text: string) => {
        out.push({ kind: 'rejection', text });
      });
      await page.addInitScript(() => {
        window.addEventListener('unhandledrejection', (e) => {
          const r: unknown = e.reason;
          const msg = r instanceof Error ? `${r.name}: ${r.message}` : String(r);
          (window as unknown as { __reportRejection?: (s: string) => void }).__reportRejection?.(msg);
        });
      });

      await use();

      const 관측 = out.map((f) => `[${f.kind}] ${f.text}`);
      const n = 예상.get(page) ?? 0;
      if (n > 0) {
        expect(관측.length, `의도된 실패 ${n}건을 선언했는데 ${관측.length}건이 났다`).toBe(n);
        return;
      }
      expect(관측, '잡히지 않은 비동기 실패 — 어느 층도 이것을 보고 있지 않다(R2)').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
