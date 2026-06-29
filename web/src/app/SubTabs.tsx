/* ============================================================
   SubTabs — 흡수 탭의 '페이지 안 섹션' 세그먼트.
   호스트 탭(스케줄·기록·통계) 상단에 떠서 형제 섹션(가용시간·졸업/리뷰/숙달도)으로 전환.
   App이 라우트마다 tabKey를 넘기고, 그 key가 SUBTAB_GROUPS에 속할 때만 렌더(아니면 null).
   라우트는 전부 살아있어 ⌘K·g단축키·딥링크와 동선이 일치한다.
============================================================ */
import { useNavigate } from 'react-router-dom';
import { subTabGroupOf, Icon } from '@/shell';
import { prefetchTab } from '@/features/registry';
import ds from '@/styles/ds.module.css';
import s from './SubTabs.module.css';

export default function SubTabs({ tabKey }: { tabKey: string }) {
  const navigate = useNavigate();
  const group = subTabGroupOf(tabKey);
  if (!group || group.length < 2) return null;

  return (
    <div className={s.wrap}>
      <div className={ds.seg} role="group" aria-label="페이지 섹션">
        {group.map((t) => {
          const active = t.key === tabKey;
          return (
            <button
              key={t.key}
              type="button"
              className={`${s.btn}${active ? ' ' + ds.on : ''}`}
              aria-current={active ? 'page' : undefined}
              onMouseEnter={() => prefetchTab(t.key)}
              onFocus={() => prefetchTab(t.key)}
              onClick={() => navigate('/' + t.key, { viewTransition: true })}
            >
              <Icon name={t.icon} />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
