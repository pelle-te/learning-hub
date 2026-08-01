/* ============================================================
   components/Icon.tsx — 라인 아이콘(Lucide 스타일·**단색**·currentColor). 앱 전역의 픽토그램 SSOT.
   ICON_PATHS(→ `lib/iconPaths`)는 신뢰된 정적 상수(SVG inner) → dangerouslySetInnerHTML로 주입.
   CSS는 .ic(전역).

   ## ⚠ 왜 `shell/` 이 아니라 여기인가 (이모지→아이콘 이식의 **선행 조건**)

   종전엔 `shell/icons.tsx` 였고 소비처가 `app/` 셋(RailSidebar·SubTabs·TopBar)뿐이라 그 자리가
   문제되지 않았다. 그런데 이모지 교체 대상은 `features`·`components`·**`phone`** 에 걸쳐 있고,
   `components`·`phone` 은 **`@/shell` 배럴을 import 할 수 없다**(H10·H27 — 배럴 한 칸으로
   스토어·IPC 가 딸려 온다). 즉 옮기지 않고 슬라이스를 시작하면 **중간에 경계 린트가 터진다.**
   `shell/index.ts` 는 탭 아이콘용으로 **재수출만** 한다(옛 import 경로를 안 깨뜨린다).

   ## ⚠ 경로 데이터는 `lib/iconPaths.ts` 에 있다

   `shell/toast` 가 `components` 를 import 할 수 없어서다(그 파일 머리주석이 근거를 갖는다).
   여기는 **그리는 방법**만 소유한다.
============================================================ */
import { ICON_PATHS } from '@/lib/iconPaths';
/** name에 맞는 라인 아이콘(없으면 null).
 *  className: 전역 `.ic`(1em) 위에 크기·획을 덮는 통로(C-7 셸 이식 규약 4 — 자손 셀렉터
 *  `:global(.ic)` 대신 자식에 직접 클래스). `.ic` 가 언레이어드라 크기 override 엔 `!` 가 필요하다. */
export function Icon({ name, className }: { name?: string; className?: string }) {
  const p = name ? ICON_PATHS[name] : '';
  if (!p) return null;
  return (
    <svg
      className={className ? `ic ${className}` : 'ic'}
      viewBox="0 0 24 24"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: p }}
    />
  );
}
