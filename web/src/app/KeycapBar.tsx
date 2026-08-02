/* ============================================================
   KeycapBar — **T-22 문맥 키캡 바**(`Alt` 를 누르는 동안만).

   ## 왜 필요한가

   이 앱은 키보드가 두껍다(화면마다 자기 키맵을 등록한다 · `hooks/useKeymap`). 그런데 그 키를
   **볼 방법이 도움말 오버레이(`?`) 하나**뿐이었다 — 즉 키를 확인하려면 지금 하던 일을 멈추고
   전체 화면을 덮는 창을 열어야 한다. 그러면 대개 그냥 마우스로 돌아간다(로드맵의 관측:
   _"못 외우면 마우스로 돌아간다"_).

   키캡 바는 그 사이 칸이다: `Alt` 를 **누르고 있는 동안만** 화면 아래 한 줄로 뜬다. 놓으면
   사라지므로 상태가 없고, 지금 화면의 키만 보여 주므로 목록이 짧다.

   ## ⚠ 새 데이터가 0 이다

   `useActiveKeymaps()` 가 **지금 마운트된 화면의 키맵**을 이미 준다(도움말 오버레이가 쓰는 그
   원천). 여기서 키 목록을 다시 만들면 두 벌이 되고, 그건 `useKeymap` 자신이 머리주석에
   표류 위험으로 적어 둔 형태다.

   ## ⚠ `Alt` 를 가로채지 않는다

   `preventDefault` 를 안 한다 — Windows 에서 `Alt` 단독은 메뉴 활성화이고, 이 앱엔 메뉴가
   없지만 **브라우저·접근성 도구가 그 키를 쓴다**. 우리는 *보여 주기만* 한다.
   ⚠ 창 포커스를 잃으면(Alt+Tab) `keyup` 이 안 온다 → `blur` 로도 닫는다. 안 그러면 돌아왔을 때
   바가 떠 있는 채로 남는다.
============================================================ */
import { useEffect, useState } from 'react';
import { useActiveKeymaps } from '@/hooks/useKeymap';

/* kbd 칩 — `ShortcutsHelp` 와 **같은 관용구**다(UA 기본 monospace 를 유틸로 덮고 하단 립 1px).
   ⚠ 두 화면이 같은 개념(키캡)을 다르게 그리면 사용자가 둘을 다른 것으로 읽는다. */
const KBD =
  'min-w-6 flex-none rounded-sm border border-line bg-panel2 px-1.75 py-1.25 text-center font-mono text-xs leading-none text-txt shadow-kbd';

export default function KeycapBar() {
  const [held, setHeld] = useState(false);
  const maps = useActiveKeymaps();

  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      // ⚠ `altKey` 가 아니라 `key === 'Alt'` 다 — Alt+X 조합에서는 뜨지 않아야 한다(조합은
      //   이미 행동이고, 그 순간 바가 뜨면 화면이 튄다).
      if (e.key === 'Alt' && !e.ctrlKey && !e.metaKey) setHeld(true);
    };
    const up = (e: KeyboardEvent): void => {
      if (e.key === 'Alt') setHeld(false);
    };
    const off = (): void => setHeld(false); // Alt+Tab 은 keyup 을 안 준다(머리주석)
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', off);
    };
  }, []);

  const rows = maps.flatMap((m) => m.bindings);
  if (!held || rows.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[var(--z-modal)] flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 border-t border-line bg-panel px-4 py-2"
      role="status"
      aria-label="이 화면의 단축키"
    >
      {rows.map((b) => (
        <span key={`${b.display}-${b.label}`} className="flex items-center gap-1.5 text-sm">
          <kbd className={KBD}>{b.display}</kbd>
          <span className="text-mut">{b.label}</span>
        </span>
      ))}
    </div>
  );
}
