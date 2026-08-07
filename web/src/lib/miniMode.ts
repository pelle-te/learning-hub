/* ============================================================
   miniMode.ts — 집중 미니 HUD 창 모드(N-8)의 상태와 전환.

   집중 중 "얼마 남았지?"가 **alt-tab 2회**였다 — `FocusChip` 은 TopBar 안이라 앱 창이 가려지면
   같이 사라진다. 집중을 지키려는 도구가 그 왕복으로 집중을 깨고 있었다. 타이머는 새 탭이
   아니라 **창 모드**다(이 항목이 출하되면 "딥워크 타이머 전용 탭" 재제안의 근거가 사라진다).

   ⚠ 복귀 크기는 **진입 시 실측**해 여기 들고 있는다. 상수로 굳히면 사용자가 키워 둔 창을 앱이
   조용히 되돌리고, 그 손실은 되돌릴 방법이 없다. 실측이 실패하면(브라우저·권한) 폴백을 쓴다.
   ⚠ 모듈 상태(메모리)다 — 미니 모드 중 앱을 재시작하면 복귀 크기를 잃고 폴백으로 돌아간다.
   영속시키지 않는 이유: 창 크기는 사용자가 언제든 손으로 고치는 값이라 저장하면 *과거의 크기*를
   되살리는 쪽이 더 자주 틀린다. 잃어도 한 번의 리사이즈로 끝나는 손실만 남긴다.
============================================================ */
import { isTauri, setMiniWindow, windowInnerSize, type WindowBox } from './tauri';

/** 미니 HUD 라우트 — 탭이 아니다(나브·팔레트·g단축키 어디에도 안 뜬다). */
export const MINI_PATH = '/mini';

/* ── 왜 들어왔는가(N-20 · W3) ─────────────────────────────────────────────────
   ⚠⚠ 종전엔 이 축이 **부울 하나**(`transient`)였고, 그 비트가 답하던 질문은 *"캡처가 끝나면
   나갈까"* 였다. N-20 이 세 번째 이유를 추가한다: **세션 없이 상주하는 알약**. 부울로는
   표현 불가라(둘 다 false 인 상태가 두 뜻을 갖게 된다) 어휘를 준다 — `shell/tabs.ts` 가
   `hidden` 부울을 `role` 로 바꾼 것과 같은 형태이고, 이유도 같다: **부정으로 정의된 비트는
   소비처마다 자기 해석을 덧붙인다.**

   · `session`  — 집중 세션을 접었다. 세션이 끝나면 **자동으로 펼친다**(FocusChip 이 감시).
   · `capture`  — 캡처 한 줄을 받으러 잠깐(Q-26). 캡처가 닫히면 자동으로 나간다.
   · `resident` — 세션과 무관한 **상주**(N-20). 아무도 자동으로 안 내보낸다. */
export type MiniMode = 'session' | 'capture' | 'resident';

let restore: WindowBox | null = null;
let origin = '/today';
let mode: MiniMode = 'session';

/**
 * 미니 모드 진입. 창 조작이 실패하면 **false 를 돌려주고 아무것도 안 바꾼다** —
 * 호출부는 라우팅을 취소한다(작아지지 않았는데 알약 화면만 뜨는 반쪽 상태가 최악이다).
 *
 * @param how 왜 들어왔는가(위 `MiniMode`). 나가는 조건이 여기서 갈린다.
 */
export async function enterMini(from: string, how: MiniMode = 'session'): Promise<boolean> {
  if (!isTauri()) return false;
  const box = await windowInnerSize(); // 줄이기 **전에** 재야 의미가 있다
  if (!(await setMiniWindow(true))) return false;
  restore = box;
  origin = from && from !== MINI_PATH ? from : '/today';
  mode = how;
  return true;
}

/** 지금의 미니 모드가 **왜** 켜졌나. `exitMini` 가 끝내면서 기본값으로 되돌린다. */
export function miniMode(): MiniMode {
  return mode;
}

/**
 * 미니 모드 종료 — 창을 되돌리고 **돌아갈 경로**를 알려준다(왔던 탭으로 복귀).
 * 창 복원에 실패하면 **`null`** 이다 — 호출부는 라우팅을 취소해야 한다.
 *
 * ⚠⚠ **`setMiniWindow` 의 반환값을 버리지 않는다**(H9 · 2026-08-01). 그 안에서
 * `setResizable(false)` 뒤 `setSize` 가 던지는 경로가 있는데, 종전엔 결과를 무시하고 무조건
 * 라우팅해서 **전체 앱이 320×92 창에 감금**됐다 — 창을 못 늘리고(resizable 이 false 로 남는다)
 * 알약 UI 도 없으니 나갈 문이 화면에 하나도 없다. **재시작 외 탈출 경로가 없는 상태**이고,
 * 그건 이 앱에서 낼 수 있는 가장 나쁜 실패다. `enterMini` 는 이미 같은 규율을 지키고 있었다
 * (_"작아지지 않았는데 알약 화면만 뜨는 반쪽 상태가 최악"_) — 나가는 쪽만 비대칭이었다.
 *
 * ⚠ 실패해도 `restore`·`origin` 을 **비우지 않는다**: 다음 시도가 같은 크기로 복귀해야 한다.
 */
export async function exitMini(): Promise<string | null> {
  /* ⚠ 셸이 아니면 **되돌릴 창이 없다** — 여기서 null 을 주면 "해당 없음"을 "실패"로 보고하게
     된다(브라우저에선 `enterMini` 가 애초에 false 라 알약에 들어갈 수도 없다). 실패 판정은
     Tauri 안에서만 의미가 있다. */
  const restored = await setMiniWindow(false, restore);
  if (isTauri() && !restored) return null;
  restore = null;
  mode = 'session';
  const back = origin;
  origin = '/today';
  return back;
}
