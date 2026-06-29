/* ============================================================
   Items — 탭: 학습 항목 (Phase 3 · 앱상태/Zustand)
   레거시 ui-items.js의 innerHTML 렌더 + globalThis 변형을 React + store.mutate로 이전.
   구조 레이아웃은 레거시 전역 클래스(card/itemrow/fieldgrid/chaptbl…)를 재사용(Phase 6까지 style.css 유지),
   인터랙티브/칩은 토큰 기반 공용 컴포넌트(Button/Pill/Kpi)로 — 룩 일관·테마 자동 대응.
============================================================ */
import { useCallback, useMemo, useState } from 'react';
import { useApp } from '@/store/useApp';
import { ui } from '@/shell';
import { PALETTE, rid, iso, dayDiff, ddayInfo } from '@/lib/utils';
import { Button, KpiGrid, Kpi } from '@/components/ui';
import ds from '@/styles/ds.module.css';
import type { Item } from '@/lib/types';
import { ItemCard } from './ItemCard';

/** 빈 여백 대신 한눈 지표 — 과목 수·주당 합계·챕터 진행·가장 가까운 마감. */
function useInsight(items: Item[]) {
  return useMemo(() => {
    const named = items.filter((i) => i.name);
    if (!named.length) return null;
    const todayDs = iso(new Date());
    let weekly = 0;
    let totalCh = 0;
    let doneCh = 0;
    let nearest: { dd: number; name: string } | null = null;
    for (const s of named) {
      weekly += s.mode === 'daily' ? ((s.dailyMin || 0) * 7) / 60 : s.weeklyHours || 0;
      for (const c of s.chapters || []) {
        totalCh++;
        if (c.done) doneCh++;
      }
      if (s.deadline) {
        const dd = dayDiff(todayDs, s.deadline);
        if (nearest == null || dd < nearest.dd) nearest = { dd, name: s.name };
      }
    }
    const chPct = totalCh ? Math.round((doneCh / totalCh) * 100) : 0;
    return {
      count: named.length,
      weekly: Math.round(weekly * 10) / 10,
      doneCh,
      totalCh,
      chPct,
      nearest,
    };
  }, [items]);
}

export default function Items() {
  const items = useApp((s) => s.state.items);
  const mutate = useApp((s) => s.mutate);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const insight = useInsight(items);

  const toggle = useCallback((id: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => setOpen(new Set()), []);
  const expandAll = useCallback(() => setOpen(new Set(items.map((i) => i.id))), [items]);

  const addItem = useCallback(() => {
    const id = rid();
    mutate((st) => {
      st.items.push({
        id,
        source: '직접',
        name: '새 과목',
        color: PALETTE[st.items.length % PALETTE.length],
        mode: 'weekly',
        weeklyHours: 3,
        dailyMin: 30,
        deadline: '',
        chapters: [],
      });
    });
    setOpen((prev) => new Set(prev).add(id)); // 새 과목은 바로 펼쳐서 편집
  }, [mutate]);

  const recolorAll = useCallback(() => {
    if (!items.length) {
      ui.toast('재배정할 과목이 없어요.', 'warn');
      return;
    }
    ui.backupNow(); // 되돌리기용 1단계 백업
    mutate((st) => {
      st.items.forEach((s, i) => {
        s.color = PALETTE[i % PALETTE.length];
      });
    });
    ui.toastUndo('과목 색을 새 팔레트로 재배정했어요.');
  }, [items.length, mutate]);

  const removeItem = useCallback(
    async (id: string) => {
      const it = items.find((s) => s.id === id);
      const okConfirm = await ui.confirm(
        `"${(it && it.name) || '이 과목'}"을(를) 삭제할까요? (챕터·진행 기록도 함께 사라집니다)`,
        { title: '과목 삭제', okLabel: '삭제', danger: true },
      );
      if (!okConfirm) return;
      mutate((st) => {
        st.items = st.items.filter((s) => s.id !== id);
      });
      setOpen((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      ui.toast('과목 삭제됨', 'info');
    },
    [items, mutate],
  );

  const n = items.length;

  return (
    <>
      <div className={ds.card}>
        <div className={ds.row} style={{ alignItems: 'center' }}>
          <h2 style={{ flex: 1, margin: 0 }}>
            학습 항목{' '}
            <span className={`${ds.muted} ${ds.tiny}`} style={{ fontWeight: 400 }}>
              {n ? `(${n})` : ''}
            </span>
          </h2>
          {n > 1 && (
            <>
              <Button sm variant="ghost" onClick={expandAll} title="모두 펼치기">
                모두 펼치기
              </Button>
              <Button sm variant="ghost" onClick={collapseAll} title="모두 접기">
                모두 접기
              </Button>
              <Button sm variant="ghost" onClick={recolorAll} title="모든 과목 색을 새 팔레트 순서로 재배정">
                색 재배정
              </Button>
            </>
          )}
          <Button sm variant="primary" onClick={addItem}>
            + 과목 추가
          </Button>
        </div>
        <div className={ds.foot}>
          과목 줄을 누르면 펼쳐서 편집할 수 있어요. <b>주당 목표 시간</b>과 <b>챕터(순서·예상시간)</b>를 넣으면 그날
          배운 챕터·복습이 자동으로 잡힙니다. 챕터는 볼트 현황 탭에서 가져올 수도 있어요.
        </div>
      </div>

      {insight && (
        <KpiGrid>
          <Kpi value={insight.count} label="과목" />
          <Kpi
            value={
              <>
                {insight.weekly}
                <span className={`${ds.muted} ${ds.tiny}`}> h</span>
              </>
            }
            label="주당 합계 시간"
          />
          <Kpi
            value={
              <>
                {insight.doneCh}
                <span className={`${ds.muted} ${ds.tiny}`}> / {insight.totalCh}</span>
              </>
            }
            label={`챕터 완료 (${insight.chPct}%)`}
          />
          <Kpi
            value={insight.nearest ? ddayInfo(insight.nearest.dd).lab : '—'}
            label={insight.nearest ? `${insight.nearest.name} 마감` : '마감 없음'}
          />
        </KpiGrid>
      )}

      <div id="itemCards">
        {items.length === 0 ? (
          <div className={ds.card}>
            <div className={ds.empty}>학습 항목이 없습니다. + 과목 추가 또는 볼트/Anki 탭에서 넣으세요.</div>
          </div>
        ) : (
          items.map((s) => (
            <ItemCard
              key={s.id}
              item={s}
              open={open.has(s.id)}
              onToggle={toggle}
              onDelete={removeItem}
              mutate={mutate}
            />
          ))
        )}
      </div>
    </>
  );
}
