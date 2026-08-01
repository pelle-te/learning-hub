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
import { ICON_PATHS, type IconName } from '@/lib/iconPaths';
/** name에 맞는 라인 아이콘(없으면 null).
 *
 *  ⚠ `name` 이 **`IconName`** 이다(H22 · 2026-08-01) — `string` 이던 동안 오타는 조용히
 *  `null` 을 렌더했고 전 게이트가 녹색이었다. 머리주석이 집행자로 지목한 `check-icons.mjs` 는
 *  존재한 적이 없다(`lib/iconPaths.ts` 의 그 절이 근거를 갖는다).
 *
 *  className: 전역 `.ic`(1em) 위에 크기·획을 덮는 통로(C-7 셸 이식 규약 4 — 자손 셀렉터
 *  `:global(.ic)` 대신 자식에 직접 클래스).
 *  ⚠ **`!` 는 필요 없다**(D4 · 2026-08-01 정정). 여기 *"`.ic` 가 언레이어드라"* 라고 적혀
 *  있었는데 `.ic` 는 `global/base.css:59` = **base 레이어**이고(`global/index.css` 가
 *  `layer(base)` 로 import 한다), 계단이 `base < components < theme < utilities` 라
 *  **유틸리티가 이미 이긴다.** `acab94e` 가 이 파일을 `shell/` 에서 옮기며 C-7 이전 문장을
 *  그대로 가져온 것이고, `디자인시스템.md` 는 처음부터 맞게 적혀 있었다. */
export function Icon({ name, className }: { name?: IconName; className?: string }) {
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
