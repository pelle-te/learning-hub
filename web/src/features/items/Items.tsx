/* ============================================================
   Items — 탭: 학습 항목 (Phase 3 · 앱상태/Zustand)
   구조 레이아웃은 전역 디자인 시스템 클래스(card/itemrow/fieldgrid…)+ds.module을 재사용,
   인터랙티브/칩은 토큰 기반 공용 컴포넌트(Button/Pill/Kpi)로 — 룩 일관·테마 자동 대응.
============================================================ */
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/useApp';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { ui } from '@/shell';
import { PALETTE, rid, makeItem, iso, dayDiff, ddayInfo } from '@/lib/utils';
import { Button } from '@/components/ui';
import EmptyState from '@/components/EmptyState';
import ds from '@/styles/ds.module.css';
import c from './Items.module.css';
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
  const navigate = useNavigate();
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const insight = useInsight(items);
  // 과목 수·주당 합계·챕터 진행·마감 리드아웃을 상단 바로(데모 v6 헤더).
  usePageChromeEffect(
    () => ({
      readouts: !insight
        ? []
        : [
            { label: '과목', value: insight.count, accent: true },
            {
              label: '주당 합계',
              value: (
                <>
                  {insight.weekly}
                  <small> h</small>
                </>
              ),
            },
            {
              label: '챕터',
              value: (
                <>
                  {insight.doneCh}
                  <small> / {insight.totalCh}</small>
                </>
              ),
            },
            {
              label: insight.nearest ? `${insight.nearest.name} 마감` : '마감',
              value: insight.nearest ? ddayInfo(insight.nearest.dd).lab : '—',
            },
          ],
    }),
    [insight],
  );

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
      st.items.push(makeItem(st.items.length, { id, source: '직접', name: '새 과목' }));
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

  // 드래그 정렬 — HTML5 DnD(닫힌 카드만). 색은 인덱스 파생(PALETTE)이므로 재정렬 즉시 재유도해
  // 다음 부팅에 색이 바뀌는 서프라이즈를 없앤다(recolorAll·refineItemColors와 동일 규칙).
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const moveItem = useCallback(
    (fromId: string, toId: string) => {
      if (fromId === toId) return;
      mutate((st) => {
        const from = st.items.findIndex((x) => x.id === fromId);
        const to = st.items.findIndex((x) => x.id === toId);
        if (from < 0 || to < 0) return;
        const [moved] = st.items.splice(from, 1);
        st.items.splice(to, 0, moved!);
        st.items.forEach((x, i) => {
          x.color = PALETTE[i % PALETTE.length];
        });
      });
    },
    [mutate],
  );

  const n = items.length;

  return (
    <section className={c.wrap} aria-label="학습 항목">
      <div className={c.header}>
        <div className={c.lead}>
          <h2 className={c.eyebrow}>학습 항목{n ? ` · ${n}과목` : ''}</h2>
          <div className={c.hint}>
            카드를 누르면 펼쳐 편집해요. <b>주당 목표·챕터</b>를 넣으면 스케줄러가 매일 블록을 자동 배치합니다. 순서는
            드래그 또는 <b>Alt+↑↓</b>(키보드).
          </div>
        </div>
        <div className={c.actions}>
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
      </div>

      {items.length === 0 ? (
        <div className={c.empty}>
          <div className={ds.card}>
            <EmptyState
              glyph="📚"
              title="아직 학습 항목이 없어요"
              desc={
                <>
                  공부할 과목을 추가하면 <b>주당 목표 시간</b>과 <b>챕터</b>로 스케줄러가 매일 블록을 자동 배치합니다.
                  옵시디언 볼트나 Anki에서 통째로 불러올 수도 있어요.
                </>
              }
              actions={
                <>
                  <Button variant="primary" onClick={addItem}>
                    + 첫 과목 추가
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => navigate('/integrations', { viewTransition: true })}
                    title="연동 탭에서 볼트 폴더를 스캔해 과목을 불러오세요"
                  >
                    볼트/Anki에서 불러오기 →
                  </Button>
                </>
              }
            />
          </div>
        </div>
      ) : (
        <div className={c.gallery}>
          {items.map((s) => (
            <div
              key={s.id}
              className={`${c.dragWrap}${overId === s.id && dragId !== s.id ? ' ' + c.dragOver : ''}${dragId === s.id ? ' ' + c.dragging : ''}`}
              draggable={!open.has(s.id)}
              onDragStart={(e) => {
                setDragId(s.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault(); // drop 허용
                setOverId(s.id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId) moveItem(dragId, s.id);
                setDragId(null);
                setOverId(null);
              }}
              onKeyDown={(e) => {
                // 키보드 재정렬(WCAG 2.1.1) — 카드 안 어디에 포커스가 있든 Alt+↑↓로 순서 이동
                // (드래그의 키보드 대안 · 새 tab stop을 만들지 않아 탐색 소음 없음).
                if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
                e.preventDefault();
                const idx = items.findIndex((x) => x.id === s.id);
                const tgt = items[idx + (e.key === 'ArrowDown' ? 1 : -1)];
                if (tgt) moveItem(s.id, tgt.id);
              }}
            >
              <ItemCard item={s} open={open.has(s.id)} onToggle={toggle} onDelete={removeItem} mutate={mutate} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
