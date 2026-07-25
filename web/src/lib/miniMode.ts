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

let restore: WindowBox | null = null;
let origin = '/today';

/** 미니 모드 진입. 창 조작이 실패하면 **false 를 돌려주고 아무것도 안 바꾼다** —
 *  호출부는 라우팅을 취소한다(작아지지 않았는데 알약 화면만 뜨는 반쪽 상태가 최악이다). */
export async function enterMini(from: string): Promise<boolean> {
  if (!isTauri()) return false;
  const box = await windowInnerSize(); // 줄이기 **전에** 재야 의미가 있다
  if (!(await setMiniWindow(true))) return false;
  restore = box;
  origin = from && from !== MINI_PATH ? from : '/today';
  return true;
}

/** 미니 모드 종료 — 창을 되돌리고 **돌아갈 경로**를 알려준다(왔던 탭으로 복귀). */
export async function exitMini(): Promise<string> {
  await setMiniWindow(false, restore);
  restore = null;
  const back = origin;
  origin = '/today';
  return back;
}
