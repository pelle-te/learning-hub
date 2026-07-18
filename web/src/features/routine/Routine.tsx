/* ============================================================
   Routine — 리다이렉트 shim. '뼈대' 세그먼트는 '과목' 탭으로 병합됐다(계획 재개편 v3).
   가용시간·수업·일과 편집기는 features/items/SkeletonPanel.tsx, 24h 링·요일 막대는
   features/items/AvailRail.tsx로 이주. 이 키를 남겨두는 이유:
     · `g o` 단축키(shell/shortcuts.ts)·⌘K 팔레트·기존 `/routine` 딥링크가 안 깨지게
     · invariants 테스트가 TABS 키 == LOADERS 키 패리티를 요구
   실제 화면은 없고 '/items'로 넘긴다(PlanHost와 같은 패턴).
============================================================ */
import { Navigate } from 'react-router-dom';

export default function Routine() {
  return <Navigate to="/items" replace />;
}
