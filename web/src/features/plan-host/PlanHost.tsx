/* ============================================================
   features/plan-host/PlanHost.tsx — '계획' 호스트 셸.
   자체 화면 없이 기본 세그먼트(배치=주간 스케줄)로 리다이렉트한다. 나브 '계획'·⌘K·g p·Today
   "오늘 계획 짜기"가 여기로 오면, SubTabs(뼈대·과목·배치)를 얹은 배치 화면이 열린다.
   세그먼트 전환·나브 하이라이트는 shell/tabs.ts SUBTAB_GROUPS(['plan-host',...])와 SubTabs가 담당.
   (Phase 1 = 껍데기 통합. 배치=기존 Schedule. 일일 편집기·트레이는 Phase 3에서 배치 세그먼트에 얹는다.)
============================================================ */
import { Navigate } from 'react-router-dom';

export default function PlanHost() {
  return <Navigate to="/schedule" replace />;
}
