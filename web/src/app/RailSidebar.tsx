import { useLocation, useNavigate } from 'react-router-dom';
import { orderedTabs, hostTabKey, tabByKey, Icon } from '@/shell';
import { prefetchTab } from '@/features/registry';
import s from './RailSidebar.module.css';

/* RailSidebar — 60px 아이콘 레일(설계도 §1-2). 현 2단 Nav를 대체한다.
   - 1차 탭(숨김 제외)을 평면 아이콘 리스트로. 흡수 탭(routine/degree/review/mastery)에 있을 땐
     그 호스트(스케줄/기록/통계)를 활성으로 친다(섹션 전환은 본문 상단 SubTabs가 담당).
   - hover/focus 시 대상 청크 프리페치 + viewTransition으로 부드러운 전환.
   - 방향키/Home/End 이동(WAI-ARIA tablist 키보드 계약·roving tabindex).
   - 하단 ⚙는 설정으로(저빈도 운영 화면은 ⌘K·직접 URL과 동선 일치). */
export default function RailSidebar() {
  const navigate = useNavigate();
  const loc = useLocation();
  const cur = hostTabKey(loc.pathname.replace(/^\//, '') || 'today');
  const go = (key: string) => navigate('/' + key, { viewTransition: true });

  const tabs = orderedTabs().filter((t) => !t.hidden);
  const settingsActive = cur === 'settings' || cur === 'control';

  // roving tabindex: ↑↓/←→/Home/End로 탭 이동(자동 활성) + 렌더 후 포커스.
  const onKey = (idx: number) => (e: React.KeyboardEvent) => {
    let next = -1;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        next = (idx + 1) % tabs.length;
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        next = (idx - 1 + tabs.length) % tabs.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = tabs.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    const t = tabs[next]!;
    go(t.key);
    requestAnimationFrame(() => document.getElementById('rail-' + t.key)?.focus());
  };

  const settings = tabByKey('settings');

  return (
    <nav className={s.rail} aria-label="주요 메뉴">
      <div className={s.logo} aria-hidden="true">
        L
      </div>
      <div role="tablist" aria-label="탭" style={{ display: 'contents' }}>
        {tabs.map((t, i) => {
          const active = cur === t.key;
          return (
            <button
              key={t.key}
              id={'rail-' + t.key}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={t.label}
              tabIndex={active ? 0 : -1}
              className={s.item + (active ? ' ' + s.on : '')}
              onKeyDown={onKey(i)}
              onMouseEnter={() => prefetchTab(t.key)}
              onFocus={() => prefetchTab(t.key)}
              onClick={() => go(t.key)}
            >
              <Icon name={t.icon} />
              <span className={s.label}>{t.label}</span>
            </button>
          );
        })}
      </div>
      <div className={s.spacer} />
      <button
        type="button"
        aria-label={settings?.label || '설정'}
        aria-current={settingsActive ? 'page' : undefined}
        className={s.item + (settingsActive ? ' ' + s.on : '')}
        onMouseEnter={() => prefetchTab('settings')}
        onFocus={() => prefetchTab('settings')}
        onClick={() => go('settings')}
      >
        <Icon name="gear" />
        <span className={s.label}>{settings?.label || '설정'}</span>
      </button>
    </nav>
  );
}
