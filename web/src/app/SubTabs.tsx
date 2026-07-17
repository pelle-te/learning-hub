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
import s from './SubTabs.module.css';

export default function SubTabs({ tabKey }: { tabKey: string }) {
  const navigate = useNavigate();
  const group = subTabGroupOf(tabKey);
  const btns = useRef<Array<HTMLButtonElement | null>>([]);
  // 셸 호스트(plan-host 등)는 세그먼트 버튼으로 렌더하지 않는다 — 나브·라우트엔 있지만 자식 세그먼트만 바에 노출.
  const segs = (group ?? []).filter((t) => !t.shell);
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
    <div className={s.wrap}>
      {/* roving tabindex: 활성 버튼만 Tab 순서에 두고(0), 나머지는 -1 — 그룹을 한 정거장으로. */}
      <div className={s.seg} role="group" aria-label="페이지 섹션" onKeyDown={onKeyDown}>
        {segs.map((t, i) => {
          const active = t.key === tabKey;
          return (
            <button
              key={t.key}
              ref={(el) => {
                btns.current[i] = el;
              }}
              type="button"
              className={`${s.btn}${active ? ' ' + s.on : ''}`}
              aria-current={active ? 'page' : undefined}
              tabIndex={active ? 0 : -1}
              onMouseEnter={() => prefetchTab(t.key)}
              onFocus={() => prefetchTab(t.key)}
              onClick={() => navigate('/' + t.key, { viewTransition: true })}
            >
              <Icon name={t.icon} />
              <span>{t.segLabel ?? t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
