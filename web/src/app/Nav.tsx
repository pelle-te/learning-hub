import { useLocation, useNavigate } from 'react-router-dom';
import { orderedTabs, groupOrder, tabByKey, hostTabKey, GROUP_LABELS, GROUP_ICONS, Icon } from '@/shell';
import { prefetchTab } from '@/features/registry';

/* Nav — 2단 계층 네비(상위=그룹 / 하위=그 그룹의 탭). 레거시 renderNav를 React로 옮긴 것.
   클래스(.navtop/.navsub/.navparent/.navchild/.ic)는 styles/global/(base.css)을 재사용.
   - hover/focus 시 대상 탭 청크 프리페치 + viewTransition으로 부드러운 탭 전환.
   - 방향키/Home/End로 탭 사이 이동(WAI-ARIA tablist 키보드 계약 — 자동 활성).
   - 외곽은 navigation 랜드마크(이전의 중첩 tablist 무효 ARIA 교정). */
export default function Nav() {
  const navigate = useNavigate();
  const loc = useLocation();
  // 흡수 탭(routine/degree/review/mastery)에 있을 땐 1차 나브는 그 '호스트'(스케줄/기록/통계)를
  // 활성으로 친다. 섹션 전환은 호스트 상단 SubTabs가 담당(나브는 호스트만 노출).
  const curKey = hostTabKey(loc.pathname.replace(/^\//, '') || 'today');

  // 탭 전환은 View Transitions API로(미지원 브라우저는 라우터가 즉시 폴백).
  const go = (key: string) => navigate('/' + key, { viewTransition: true });

  const tabs = orderedTabs();
  const groups = groupOrder();
  const cur = tabByKey(curKey);
  const curGroup = cur ? cur.group : groups[0] || null;

  // 하위 탭: 현재 그룹의 탭들(숨김 탭은 그게 현재 탭일 때만 — 길잃음 방지)
  const subs = tabs.filter((t) => t.group === curGroup && (!t.hidden || curKey === t.key));

  /** tablist 방향키 핸들러 팩토리. items=각 탭의 {nav: 이동대상 key, focus: 포커스할 element id}.
     cur 기준 좌우(↑↓)/Home/End로 이동(자동 활성) + 렌더 후 포커스(roving tabindex 패턴). */
  const onListKey = (items: { nav: string; focusId: string }[], curIdx: number) => (e: React.KeyboardEvent) => {
    if (curIdx < 0) return;
    let next = -1;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (curIdx + 1) % items.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (curIdx - 1 + items.length) % items.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = items.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    const tgt = items[next]!;
    go(tgt.nav);
    requestAnimationFrame(() => document.getElementById(tgt.focusId)?.focus());
  };

  // 그룹 버튼은 그 그룹의 첫 탭으로 진입(이동) + 그룹 버튼 자신에 포커스 유지.
  const groupFirstKey = (g: string) => tabs.filter((t) => t.group === g && !t.hidden)[0]?.key ?? '';
  const groupItems = groups.map((g) => ({ nav: groupFirstKey(g), focusId: 'grp-' + g }));
  const subItems = subs.map((t) => ({ nav: t.key, focusId: 'tab-' + t.key }));

  return (
    <nav className="nav" id="nav" aria-label="메뉴">
      <div
        className="navtop"
        role="tablist"
        aria-label="구역"
        onKeyDown={onListKey(groupItems, curGroup ? groups.indexOf(curGroup) : -1)}
      >
        {groups.map((g) => {
          const active = g === curGroup;
          const first = tabs.filter((t) => t.group === g && !t.hidden)[0];
          return (
            <button
              key={g}
              id={'grp-' + g}
              role="tab"
              className={'navparent' + (active ? ' active' : '')}
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onMouseEnter={() => first && prefetchTab(first.key)}
              onFocus={() => first && prefetchTab(first.key)}
              onClick={() => first && go(first.key)}
            >
              <Icon name={GROUP_ICONS[g]} />
              <span>{GROUP_LABELS[g] || g}</span>
            </button>
          );
        })}
      </div>
      <div
        className="navsub"
        role="tablist"
        aria-label={(curGroup && GROUP_LABELS[curGroup]) || ''}
        onKeyDown={onListKey(
          subItems,
          subs.findIndex((t) => t.key === curKey),
        )}
      >
        {subs.map((t) => {
          const active = curKey === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              id={'tab-' + t.key}
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              className={'navchild' + (active ? ' active' : '')}
              onMouseEnter={() => prefetchTab(t.key)}
              onFocus={() => prefetchTab(t.key)}
              onClick={() => go(t.key)}
            >
              <Icon name={t.icon} />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
