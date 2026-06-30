/* ============================================================
   components/hud — 에디토리얼 다크 HUD 프리미티브 배럴(설계도 §1-2).
   순수 표현 컴포넌트(components → lib만 의존). 네비/스토어가 필요한 셸(RailSidebar·TopBar)은
   app/ 레이어에 둔다. (NeonTrack·Readout은 소비처가 사라져 제거됨 — 각 탭이 로컬 위젯을 씀.)
============================================================ */
export { default as HudFrame } from './HudFrame';
