import { useLocation, useNavigate } from 'react-router-dom';
import { navGroups, hostTabKey, surfaceOf, surfaceHome, SURFACES, Icon, type TabMeta, type Surface } from '@/shell';
import { prefetchTab } from '@/features/registry';
import { useUI } from '@/store/useUI';
import { useApp } from '@/store/useApp';
import { selectRiskSummary } from '@/store/selectors';
import { openBacklog } from '@/lib/methodology';
import s from './RailSidebar.module.css';

// C-9: 복습 밀림·열린 보충은 review/mastery 탭 안에서만 보여 다른 탭에 있으면 알 길이 없었다.
// 로그 그룹 진입점(학습 기록=review 호스트)에 은은한 카운트 배지로 어디서든 신호(발광·펄스 금지).
const NAV_BADGE_TAB = 'journal';

/* RailSidebar — 라벨+그룹 접이식 사이드바(설계도 §1-2 확장).
   - 펼침(기본): 그룹 헤더(계획·자료·분석·설정) 아래 아이콘+라벨 행. 탭이 늘어도 청킹으로 스캔 가능.
   - 접힘: 60px 아이콘 레일 + 그룹 구분선 + hover 플라이아웃 라벨(집중 모드·공간 회수). useUI.navCollapsed 영속.
   - 흡수 탭(routine/degree/review/mastery/graph)에 있을 땐 그 호스트를 활성으로(섹션 전환은 본문 상단 SubTabs).
   - 방향키/Home/End 이동(roving tabindex) — *라우트 내비*지 ARIA tablist가 아니라 활성 표기는 aria-current="page".
   - settings 그룹(탐구 수집·설정)은 스페이서 아래 하단에(저빈도 운영 화면). */
export default function RailSidebar() {
  const navigate = useNavigate();
  const loc = useLocation();
  const collapsed = useUI((st) => st.ui.navCollapsed);
  const toggleNav = useUI((st) => st.toggleNav);
  const persistedSurface = useUI((st) => st.ui.navSurface);
  const setNavSurface = useUI((st) => st.setNavSurface);
  // 숫자만 구독 — selectRiskSummary도 state 참조 캐시라 이 셀렉터가 알림마다 불려도 전수 스캔은
  // state 버전당 1회다(예전엔 riskSummary가 매 알림마다 days×items×chapters를 통째로 순회했다).
  const reviewBadge = useApp((st) => {
    const state = st.state;
    return selectRiskSummary(state).overdue + openBacklog(state).length;
  });
  const curKey = loc.pathname.split('/')[1] || 'today';
  const cur = hostTabKey(curKey);
  const go = (key: string) => navigate('/' + key, { viewTransition: true });

  // 활성 표면 = 현재 라우트 탭의 surface(1차 원천). 전역 탭(설정)이면 영속값으로 폴백.
  // 라우트가 이기므로 ⌘K·딥링크로 다른 표면 탭에 가면 나브가 자동으로 그 표면으로 따라간다(desync 없음).
  const activeSurface: Surface = surfaceOf(curKey) ?? persistedSurface;
  // 스위처 클릭 — 영속값 갱신 + 그 표면 홈으로 이동(라우트가 activeSurface를 확정).
  const switchSurface = (target: Surface) => {
    if (target === activeSurface) return;
    setNavSurface(target);
    go(surfaceHome(target));
  };

  const groups = navGroups(activeSurface);
  const topGroups = groups.filter((g) => g.key !== 'settings');
  const bottomGroup = groups.find((g) => g.key === 'settings');

  // roving tabindex 대상 = 모든 나브 탭(그룹 순서대로 평면화). 활성 탭이 목록에 없으면(예외) 첫 버튼을 tab stop으로.
  const flat = groups.flatMap((g) => g.tabs);
  const idxOf = (key: string) => flat.findIndex((t) => t.key === key);
  const hasActive = flat.some((t) => t.key === cur);

  // roving: ↑↓/←→/Home/End로 탭 이동(자동 활성) + 렌더 후 포커스.
  const onKey = (idx: number) => (e: React.KeyboardEvent) => {
    let next = -1;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        next = (idx + 1) % flat.length;
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        next = (idx - 1 + flat.length) % flat.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = flat.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    const t = flat[next]!;
    go(t.key);
    requestAnimationFrame(() => document.getElementById('rail-' + t.key)?.focus());
  };

  const renderBtn = (t: TabMeta) => {
    const i = idxOf(t.key);
    const active = cur === t.key;
    const badge = t.key === NAV_BADGE_TAB ? reviewBadge : 0;
    return (
      <button
        key={t.key}
        id={'rail-' + t.key}
        type="button"
        aria-current={active ? 'page' : undefined}
        aria-label={badge > 0 ? `${t.label} — 복습·보충 ${badge}건 대기` : t.label}
        tabIndex={active || (!hasActive && i === 0) ? 0 : -1}
        className={s.item + (active ? ' ' + s.on : '')}
        onKeyDown={onKey(i)}
        onMouseEnter={() => prefetchTab(t.key)}
        onFocus={() => prefetchTab(t.key)}
        onClick={() => go(t.key)}
      >
        <Icon name={t.icon} />
        <span className={s.label}>{t.label}</span>
        {badge > 0 && (
          <span className={s.badge} aria-hidden="true">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </button>
    );
  };

  // 그룹 = 헤더(펼침) 또는 구분선(접힘, 최상단 제외) + 탭 버튼들.
  const renderGroup = (g: { key: string; label: string; tabs: TabMeta[] }, showSep: boolean) => (
    <div key={g.key} className={s.group} role="group" aria-label={g.label}>
      {collapsed ? (
        showSep && <div className={s.divider} aria-hidden="true" />
      ) : (
        <div className={s.head} aria-hidden="true">
          {g.label}
        </div>
      )}
      {g.tabs.map(renderBtn)}
    </div>
  );

  return (
    <nav className={s.rail + (collapsed ? ' ' + s.collapsed : '')} aria-label="주요 메뉴" data-collapsed={collapsed}>
      <div className={s.brand} aria-hidden="true">
        <div className={s.logo}>L</div>
        {!collapsed && <span className={s.word}>러닝 허브</span>}
      </div>

      {/* 표면 스위처(Wave⑥) — 학습(핵심·숙련) ↔ 자료(수집·발견). 펼침=세그먼트, 접힘=아이콘 토글. */}
      {/* role="tablist"/"tab"은 화살표 이동·roving tabindex·aria-controls→tabpanel까지 약속하는 계약인데
          이 스위처는 그 어느 것도 이행하지 않았다 — SR 사용자는 탭 탐색을 시도했다가 아무 반응도 못 얻는다.
          Schedule 세그먼트가 이미 같은 이유로 내린 판단(group + aria-pressed)을 여기에도 적용한다. */}
      <div className={s.surfaces} role="group" aria-label="표면 전환">
        {SURFACES.map((sf) => {
          const on = sf.key === activeSurface;
          return (
            <button
              key={sf.key}
              type="button"
              aria-pressed={on}
              aria-label={sf.label}
              title={sf.label}
              className={s.surfaceBtn + (on ? ' ' + s.surfaceOn : '')}
              onClick={() => switchSurface(sf.key)}
            >
              <Icon name={sf.icon} />
              {!collapsed && <span className={s.surfaceLabel}>{sf.label}</span>}
            </button>
          );
        })}
      </div>

      <div className={s.groups}>{topGroups.map((g, i) => renderGroup(g, i > 0))}</div>
      <div className={s.spacer} />
      {bottomGroup && renderGroup(bottomGroup, true)}
      <button
        type="button"
        className={s.toggle}
        aria-label={collapsed ? '사이드바 펼치기' : '사이드바 접기'}
        aria-pressed={collapsed}
        onClick={toggleNav}
      >
        <Icon name="panelLeft" />
        {!collapsed && <span className={s.label}>접기</span>}
      </button>
    </nav>
  );
}
