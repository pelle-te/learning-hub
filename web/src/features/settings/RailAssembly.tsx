/* ============================================================
   settings/RailAssembly — **사용자가 조립하는 레일**(N-17 · W5 · 발산 6회차).

   ⚠ 파일을 가른 이유는 `max-lines` 래칫이다(Settings 가 727줄 상한을 넘었다). 그 래칫이
   막으려는 것이 정확히 이것이다 — 설정 화면이 "모든 것의 서랍"이 되는 것. 조립은 자기
   관심사가 뚜렷하므로 자기 파일을 갖는 것이 맞다.
============================================================ */
import { useUI } from '@/store/useUI';
import { navGroups } from '@/shell';
import { moveRailTab, railLayout, toggleRailHidden } from '@/shell/railLayout';
import { toast } from '@/shell/toast';
import { Button } from '@/components/ui';
import { Icon } from '@/components/Icon';

/**
 * 레일 조립(N-17 · W5) — **사용자가 접는다.**
 *
 * ⚠ 이 앱의 종전 답은 강등이었다(개발자가 방문 원장을 보고 자리를 옮긴다). 다섯 번 반복된
 * 처방이라 그 층의 문제가 아니라는 신호였고, 여기서는 판단이 필요 없는 결정을 판단으로
 * 만들지 않는다 — 근거는 `shell/railLayout` 머리주석.
 * ⚠ **판정을 화면이 하지 않는다**: 마지막 하나 보호·섹션 안 이동은 순수 lib 이 소유한다.
 *   나브가 통째로 비는 사고는 화면으로는 "아무 일도 안 일어남"이라 조용하기 때문이다.
 * ⚠ 숨겨도 ⌘K·`g`·딥링크는 그대로다 — 그 사실을 문구에 적는다(안 적으면 '삭제'로 읽힌다).
 */
export default function RailAssembly() {
  const hidden = useUI((s) => s.ui.railHidden);
  const order = useUI((s) => s.ui.railOrder);
  const setRailLayout = useUI((s) => s.setRailLayout);
  const declared = navGroups();
  const shown = railLayout(declared, { hidden, order });
  const allKeys = declared.flatMap((g) => g.tabs.map((t) => t.key));
  const shownOf = (key: string): string[] => shown.find((g) => g.key === key)?.tabs.map((t) => t.key) ?? [];
  return (
    <details className="ds-foot mt-1! tabular-nums">
      <summary>레일 정리 — 안 쓰는 화면 접기 · 순서 바꾸기</summary>
      <div className="ds-tiny mt-1.5 text-mut">
        접어도 ⌘K·<kbd>G</kbd> 키·링크로는 그대로 갑니다 — 레일에서만 빠져요. 순서는 그 질문 안에서만 바뀝니다.
      </div>
      {declared.map((g) => (
        <div key={g.key} className="mt-2">
          <div className="ds-tiny font-extrabold text-mut">{g.label}</div>
          <div className="mt-1 flex flex-col gap-1">
            {g.tabs.map((t) => {
              const off = hidden.includes(t.key);
              const members = shownOf(g.key);
              return (
                <div key={t.key} className="ds-tiny flex items-center gap-2">
                  <label className="ds-chkRow m-0! flex-1">
                    <input
                      type="checkbox"
                      checked={!off}
                      onChange={() => {
                        const next = toggleRailHidden(hidden, t.key, allKeys);
                        if (!next.ok) return toast('레일에 하나는 남아야 해요.', 'warn');
                        setRailLayout({ hidden: next.hidden });
                      }}
                    />
                    {t.label}
                  </label>
                  <Button
                    sm
                    variant="ghost"
                    disabled={off || members[0] === t.key}
                    onClick={() => setRailLayout({ order: moveRailTab(order, members, t.key, -1) })}
                    aria-label={`${t.label} 위로`}
                  >
                    <Icon name="chevronRight" className="-rotate-90" />
                  </Button>
                  <Button
                    sm
                    variant="ghost"
                    disabled={off || members[members.length - 1] === t.key}
                    onClick={() => setRailLayout({ order: moveRailTab(order, members, t.key, 1) })}
                    aria-label={`${t.label} 아래로`}
                  >
                    <Icon name="chevronRight" className="rotate-90" />
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </details>
  );
}
