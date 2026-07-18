/* ============================================================
   features/plan-host/PlanHost.tsx — '계획' 호스트 셸.
   자체 화면 없이 기본 세그먼트(배치)로 리다이렉트한다. 나브 '계획'·⌘K·g p·Today "오늘 계획 짜기"가
   여기로 오면, SubTabs(뼈대·과목·배치)를 얹은 배치 화면이 열린다. 배치의 기본 뷰=주간 배분 보드(alloc)라
   계획을 열면 '이번 주 어느 과목을 어느 요일에 얼마씩'이 한눈에 뜨는 중심 화면에 착지한다(재개편 v2 §12-5).
   세그먼트 전환·나브 하이라이트는 shell/tabs.ts SUBTAB_GROUPS(['plan-host',...])와 SubTabs가 담당.
============================================================ */
import { Navigate } from 'react-router-dom';

export default function PlanHost() {
  return <Navigate to="/schedule" replace />;
}
