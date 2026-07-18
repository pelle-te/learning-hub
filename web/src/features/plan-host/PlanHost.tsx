/* ============================================================
   features/plan-host/PlanHost.tsx — '계획' 호스트 셸.
   자체 화면 없이 첫 세그먼트(캘린더=schedule)로 리다이렉트한다. 나브 '계획'·⌘K·g p가 여기로 오면
   SubTabs(캘린더·배분·과목)를 얹은 캘린더 화면이 열린다(재개편 v4 — 배분은 독립 세그먼트로 승격,
   뼈대(routine)는 과목으로 병합돼 shim만 남았다).

   ⚠ 여긴 **뷰를 강제하지 않는다** — 캘린더의 일/주/월 선택은 영속 `schedView`가 소유하고
   기본값은 주(週)다(v4 "기본 착지 = 캘린더 주 뷰", `defaultUI().schedView='week'`). 일반 진입(나브·⌘K·g p)은
   사용자가 마지막에 보던 조망을 존중한다. 반대로 **의도가 '오늘'로 명시된 진입**(Today "오늘 계획 짜기")은
   보내는 쪽이 `setSchedView('day')` + `/schedule?ds=<오늘>`로 결정론적으로 착지시킨다(TodaySignature 참조).
   세그먼트 전환·나브 하이라이트는 shell/tabs.ts SUBTAB_GROUPS(['plan-host',...])와 SubTabs가 담당.
============================================================ */
import { Navigate } from 'react-router-dom';

export default function PlanHost() {
  return <Navigate to="/schedule" replace />;
}
