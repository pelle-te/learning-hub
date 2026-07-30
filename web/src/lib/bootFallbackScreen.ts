/* ============================================================
   bootFallbackScreen.ts — **부팅 체인이 끝까지 못 간 경우의 마지막 화면**(H21 · 2026-07-30 `/감사 근본`).

   ## 왜 필요한가 — `ErrorBoundary` 가 원리적으로 못 잡는 자리

   두 엔트리(`main.tsx`·`phone/main.tsx`)는 `initStore().then(async () => { await import(...); render() })`
   구조다. 그 `import()` 가 실패하면 **`render()` 에 도달하지 못한다** → `#root` 는 `index.html` 이
   준 **빈 div** 그대로다. 결과는 흰 화면·문장 0·버튼 0 이고, `ShellFallback`/`Fallback` 은
   **자기가 렌더되지 못하는 트리 안에** 있으므로 정의상 이 상황을 못 잡는다.

   종전에는 두 체인 모두 **종단 `.catch()` 가 없었다.** 텔레메트리는 `unhandledrejection` 으로
   그 사실을 서버에 보냈지만(2026-07-25 층), 사용자에게 남는 복구 행동은 **0** 이었다 —
   관측과 전달이 짝이라는 `updater.rs` 의 명제가 여기서 반쪽이었다.

   폰에서 도달 경로가 실재한다: SW 가 `registerType:'autoUpdate'`(skipWaiting)라 새 배포가
   precache 를 갈아치우는 중에 **구 해시 청크**를 요청하면 그 import 가 404 로 죽는다.

   ## ⚠ 이 파일은 의존이 0 이다 — 그게 계약이다

   React 도, 토큰도, 컴포넌트도 쓰지 않는다. 실패한 원인이 "청크를 못 받는 것"인데 폴백이
   또 다른 청크를 요구하면 같은 이유로 실패한다. 그래서 **순수 DOM + 인라인 스타일**이고,
   색은 하드코딩이다(절대규칙 #3 의 예외 — 토큰 CSS 도 로드에 실패했을 수 있다).
   ⚠ 이 파일에 import 를 추가하지 말 것. 추가하는 순간 이 화면이 존재하는 이유가 사라진다.
============================================================ */

/** 사용자가 볼 문장 — 원인을 정확히 모르므로 **다음 행동**만 말한다. */
const TITLE = '앱을 불러오지 못했어요';
const DESC =
  '방금 업데이트됐거나 네트워크가 끊겼을 수 있어요. 새로고침하면 대개 해결됩니다. ' +
  '반복되면 데이터는 안전하게 남아 있으니 잠시 뒤 다시 열어 주세요.';

/**
 * `#root` 에 최소 폴백을 그린다. **이미 무언가 렌더됐으면 아무것도 하지 않는다** —
 * 늦게 도착한 거부(rejection)가 정상 화면을 덮어 버리면 그게 더 나쁜 결함이다.
 */
export function showBootFallback(detail?: unknown): void {
  try {
    const root = document.getElementById('root');
    if (!root || root.childElementCount > 0) return;

    const wrap = document.createElement('div');
    wrap.setAttribute('role', 'alert');
    wrap.style.cssText =
      'min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'gap:14px;padding:24px;text-align:center;background:#050506;color:#e8e8ea;' +
      'font:400 15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif';

    const h = document.createElement('h1');
    h.textContent = TITLE;
    h.style.cssText = 'margin:0;font-size:20px;font-weight:700';

    const p = document.createElement('p');
    p.textContent = DESC;
    p.style.cssText = 'margin:0;max-width:34em;color:#9a9aa2';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '새로고침';
    btn.style.cssText =
      'min-height:44px;padding:0 20px;border:1px solid #3a3a42;border-radius:8px;' +
      'background:#14141a;color:#e8e8ea;font:inherit;font-weight:600;cursor:pointer';
    btn.addEventListener('click', () => location.reload());

    wrap.append(h, p, btn);
    root.append(wrap);
    /* 원인은 콘솔에만 남긴다 — 화면에 스택을 띄우면 사용자가 할 수 있는 일이 늘지 않고,
       경로에 개인정보가 섞일 수 있다(`telemetry.ts` 원칙 ④). 서버 보고는 전역 훅이 한다. */
    if (detail !== undefined) console.error('[boot] 부팅 체인 실패 — 폴백 화면을 띄웠습니다.', detail);
    // 포커스를 버튼에 둔다 — 키보드·스크린리더 사용자가 유일한 행동에 즉시 닿게.
    btn.focus();
  } catch {
    /* 폴백이 던지면 아무 화면도 없다 — 어떤 이유로도 던지지 않는다(`telemetry.ts` 원칙 ①). */
  }
}
