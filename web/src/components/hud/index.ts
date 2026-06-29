/* ============================================================
   components/hud — 에디토리얼 다크 HUD 프리미티브 배럴(설계도 §1-2).
   순수 표현 컴포넌트(components → lib만 의존). 네비/스토어가 필요한 셸(RailSidebar·TopBar)은
   app/ 레이어에 둔다. 시그니처 비주얼(NeonTrack·NeonChart·DataTable·Readout)은 첫 소비처
   (Phase B 오늘 페이지~)와 함께 여기 추가한다.
============================================================ */
export { default as HudFrame } from './HudFrame';
export { default as NeonTrack, type NeonSeg } from './NeonTrack';
export { default as Readout } from './Readout';
