/* ============================================================
   SubTabs — 흡수 탭의 '페이지 안 섹션' 세그먼트.
   호스트 탭(스케줄·기록·통계) 상단에 떠서 형제 섹션(가용시간·졸업/리뷰/숙달도)으로 전환.
   App이 라우트마다 tabKey를 넘기고, 그 key가 SUBTAB_GROUPS에 속할 때만 렌더(아니면 null).
   라우트는 전부 살아있어 ⌘K·g단축키·딥링크와 동선이 일치한다.
============================================================ */
import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { subTabGroupOf, Icon } from '@/shell';
import { prefetchTab } from '@/features/registry';

/* ⚠ C-7 셸 이식 — raw <button> 은 **언레이어드 전역 `button{}`**(styles/global/components.css)에서
   배경·보더·radius·padding·font-size(13px) 를 받는다. Tailwind 유틸은 `@layer utilities` 라
   언레이어드를 못 이겨 그 속성들엔 `!`(important)가 필요하다(Items.tsx 버튼과 같은 관용구).
   스냅샷은 정지 상태만 캡처하므로 hover/active 캐스케이드는 런타임 충실만 노린다. */
const SEG =
  'inline-flex overflow-hidden rounded-sm border border-line bg-panel-seg max-mobile:flex max-mobile:max-w-full max-mobile:overflow-x-auto max-mobile:[scrollbar-width:none]';
// 전역 button 을 덮는 정지-상태 기반(색·배경은 활성 여부로 분기 — 같은 속성 유틸을 둘 다 붙이면
// 레이어 순서로 갈려 못 덮는다).
const BTN_BASE =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-none! border-y-0! border-l-0! border-r! border-line2! px-3.75! py-2! text-sm! leading-[normal] font-bold! tracking-label transition-colors duration-150 ease-[var(--ease)] last:border-r-0! focus-visible:outline-2 focus-visible:outline-acc focus-visible:-outline-offset-2';
const BTN_ON = 'bg-acc-soft! text-acc! ring-1 ring-inset ring-acc-glow';
const BTN_OFF = 'bg-transparent! text-mut! hover:bg-panel2! hover:text-ink!';

export default function SubTabs({ tabKey }: { tabKey: string }) {
  const navigate = useNavigate();
  const group = subTabGroupOf(tabKey);
  const btns = useRef<Array<HTMLButtonElement | null>>([]);
  // D-4 — 옛 `shell` 플래그(화면 없는 호스트를 버튼에서 제외)는 사라졌다. 이제 호스트는 자기 화면을
  // 가진 세그먼트 자신이라(계획 = 캘린더) 걸러낼 것이 없다.
  const segs = group ?? [];
  if (segs.length < 2) return null;

  const activeIdx = segs.findIndex((t) => t.key === tabKey);

  // 방향키 roving — 세그먼트를 관련 버튼 묶음(WAI)으로: ←/→(및 ↑/↓)로 포커스 이동, Home/End로 양끝.
  // 활성화는 네이티브 버튼(Enter/Space)·클릭이 소유(수동 활성 — 라우트 전환은 명시 동작으로).
  const onKeyDown = (e: React.KeyboardEvent) => {
    const n = segs.length;
    const cur = btns.current.findIndex((b) => b === document.activeElement);
    const from = cur < 0 ? Math.max(0, activeIdx) : cur;
    let to = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = (from + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = (from - 1 + n) % n;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = n - 1;
    else return;
    e.preventDefault();
    btns.current[to]?.focus();
  };

  return (
    <div className="mb-4.5">
      {/* roving tabindex: 활성 버튼만 Tab 순서에 두고(0), 나머지는 -1 — 그룹을 한 정거장으로. */}
      {/* onKeyDown 은 ←/→/Home/End 포커스 이동만 한다(활성화는 자식 <button> 의 Enter/Space 가
          소유). WAI 세그먼트 패턴 그대로이고, 린트는 컨테이너 role=group 만 보고 '비대화형에
          핸들러'라 읽는다. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div className={SEG} role="group" aria-label="페이지 섹션" onKeyDown={onKeyDown}>
        {segs.map((t, i) => {
          const active = t.key === tabKey;
          return (
            <button
              key={t.key}
              ref={(el) => {
                btns.current[i] = el;
              }}
              type="button"
              className={`${BTN_BASE} ${active ? BTN_ON : BTN_OFF}`}
              aria-current={active ? 'page' : undefined}
              tabIndex={active ? 0 : -1}
              onMouseEnter={() => prefetchTab(t.key)}
              onFocus={() => prefetchTab(t.key)}
              onClick={() => navigate('/' + t.key, { viewTransition: true })}
            >
              <Icon name={t.icon} className="size-3.5!" />
              <span>{t.segLabel ?? t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
