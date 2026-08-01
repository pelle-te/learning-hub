/* ============================================================
   shell/keyGate.ts — **단일키 단축키를 삼켜야 하는가**의 단일 판정(H10~H11 · 2026-08-01).

   ## 왜 생겼나

   `App.tsx` 의 전역 keydown 리스너는 **캡처 단계**라 다이얼로그·오버레이보다 **먼저** 돈다.
   그런데 그 게이트가 `isTyping() || useOverlay.palette` **둘뿐**이었다. 같은 스토어의 `help`
   (치트시트)도, `shell/modal` 의 확인창도, `/mini` 알약도 안 봤다. 관측된 결과:

   · `?` 로 치트시트를 열고 **거기 적힌** `g`+키를 눌러 보면 **뒤에서 탭이 바뀐다**
     (도움말이 자기 내용을 실행해 버린다 — 배우려는 행위가 상태를 바꾼다).
   · `전체 초기화` 확인창이 떠 있는데 `]` 를 누르면 **다른 화면 위로 확인창이 옮겨 앉는다.**
     사용자는 "무엇을" 초기화하는지에 대한 문맥을 잃은 채 확인을 누르게 된다.
   · `/mini`(320×92 알약)에서 `]`·`g` 를 누르면 라우트만 바뀌고 **`exitMini()` 는 안 불려
     창이 알약 크기로 남는다** — 전체 앱이 그 안에 갇힌다(H11).

   ## ⚠ 판정을 여기 하나로 모은 이유

   호출부마다 조건을 적으면 **새 오버레이가 생길 때마다 그 목록이 갈린다** — 실제로 갈렸다
   (`palette` 는 세 곳이 알고 `help` 는 아무도 몰랐다). 층이 하나라도 떠 있으면 단일키는
   앱의 것이 아니다, 라는 **한 문장**으로 닫는다.

   ⚠ `useOverlay.getState()` 로 읽는다(구독 아님) — 리스너는 한 번 등록되고, 구독하면
   오버레이를 열고 닫을 때마다 document 리스너가 재등록된다(`useOverlay` 머리주석).
============================================================ */
import { isTyping } from '@/hooks/interactions';
import { useOverlay } from '@/store/useOverlay';
import { MINI_PATH } from '@/lib/miniMode';
import { isModalOpen } from './modal';

/**
 * 지금 **단일키 단축키**(`?` · `[` `]` · `g`+키)를 무시해야 하는가.
 *
 * @param pathname 현재 경로 — 이벤트 시점에 `window.location.pathname` 을 넘긴다(라우터 상태를
 *   구독하면 리스너가 라우트마다 재등록된다).
 *
 * ⚠ 수정자 조합(⌘K·⌘Z)은 **이 판정 대상이 아니다.** 그것들은 오버레이 위에서도 동작해야
 *   하고(팔레트 토글) 자기 가드를 따로 갖는다.
 */
export function singleKeyBlocked(pathname: string): boolean {
  if (isTyping()) return true;
  const ov = useOverlay.getState();
  if (ov.palette || ov.help || ov.miniCapture) return true;
  if (isModalOpen()) return true;
  /* ⚠ `/mini` 는 오버레이가 아니라 **창 모드**다 — 라우트를 바꾸면 화면은 넘어가는데 창은
     알약(320×92)으로 남는다(`lib/miniMode` 는 `exitMini()` 에서만 되돌린다). 나가는 문은
     알약 안의 확장 버튼과 `FocusChip` 둘뿐이고, 그 둘만 `exitMini()` 를 부른다. */
  return pathname === MINI_PATH;
}
