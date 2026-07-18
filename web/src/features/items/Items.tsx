/* ============================================================
   Items — 계획 › '과목' 탭. 계획 재개편 v3에서 옛 '뼈대'(가용시간·수업·일과) 세그먼트를 흡수했다.
   단일 질문: **"무엇을, 주당 얼마나, 어느 요일에 — 그리고 그럴 시간이 있나?"**

   층 구성(사용자 확정 안):
     · 상단 = 뼈대 요약 스트립(접힘 기본) → 펼치면 SkeletonPanel(수업·일과 편집)
     · 좌   = 과목 갤러리 + 볼트 불러오기
     · 우   = AvailRail(24h 링·요일 막대 = 가용 위에 배분 적재)
     · 클릭 = SubjectSheet 중앙 시트(과목 정의 + 그 과목의 이번 주 요일 배분)

   배분은 '흡수'가 아니라 '미러' — 전 과목 교차 조망(요일 열 합계)은 배치 탭의 배분 보드가 계속 소유하고,
   여기선 lib/weekAlloc 같은 출처로 한 과목의 행만 편집한다. 두 입구, 한 진실.
============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '@/store/useApp';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { useSchedule } from '@/store/selectors';
import { ui } from '@/shell';
import { PALETTE, rid, makeItem, dayDiff, ddayInfo, DOW, todayISO } from '@/lib/utils';
import { freeWindowsForWeekday } from '@/lib/scheduler';
import {
  allocView,
  rowSumMin,
  weekMonOf,
  removeSidFromAlloc,
  weekAllocTotalMin,
  weekBudgetMin as weekBudgetMinOf,
} from '@/lib/weekAlloc';
import { removeSidFromDayPlans } from '@/lib/dayPlans';
import { weakCountBySid } from '@/lib/insights';
import { Button } from '@/components/ui';
import EmptyState from '@/components/EmptyState';
import DetailDrawer from '@/components/DetailDrawer';
import ds from '@/styles/ds.module.css';
import c from './Items.module.css';
import type { Item } from '@/lib/types';
import { ItemCard } from './ItemCard';
import { VaultImport } from './VaultImport';
import { SkeletonPanel } from './SkeletonPanel';
import { AvailRail } from './AvailRail';
import { SubjectSheet } from './SubjectSheet';

/** 빈 여백 대신 한눈 지표 — 과목 수·주당 합계·챕터 진행·가장 가까운 마감.
 *  '오늘'은 벽시계가 아니라 **앱 정본**(todayISO, `_today` 시드 존중)을 호출부에서 받는다 —
 *  AvailRail/Alloc이 못박은 계약(단일 출처)을 마감 D-day만 우회하면 시드 주입 시 값이 갈렸다. */
function useInsight(items: Item[], todayDs: string) {
  return useMemo(() => {
    const named = items.filter((i) => i.name);
    if (!named.length) return null;
    let weekly = 0;
    let totalCh = 0;
    let doneCh = 0;
    let nearest: { dd: number; name: string } | null = null;
    for (const s of named) {
      weekly += s.mode === 'daily' ? ((s.dailyMin || 0) * 7) / 60 : s.weeklyHours || 0;
      for (const ch of s.chapters || []) {
        totalCh++;
        if (ch.done) doneCh++;
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
  }, [items, todayDs]);
}

export default function Items() {
  const items = useApp((s) => s.state.items);
  const cbms = useApp((s) => s.state.cbms);
  const routine = useApp((s) => s.state.routine);
  const state = useApp((s) => s.state);
  const mutate = useApp((s) => s.mutate);
  const res = useSchedule();
  const [searchParams, setSearchParams] = useSearchParams();
  // sid(=item.id)별 반복 약점 총합 — cbms가 바뀔 때만 롤업 재계산(SR-2). weakCountBySid는 state.cbms만 읽으므로
  // 반응형 cbms 슬라이스를 넘겨 재계산을 그 변화에 묶는다(전체 state 구독으로 인한 불필요 리렌더 회피).
  const weakBySid = useMemo(() => weakCountBySid({ ...useApp.getState().state, cbms }), [cbms]);
  const [sheetId, setSheetId] = useState<string | null>(null); // 열려 있는 과목 상세 시트
  const [showSkeleton, setShowSkeleton] = useState(false); // 뼈대 편집 스트립 펼침(온디맨드 세부)
  const [showImport, setShowImport] = useState(false); // 인라인 볼트 불러오기 토글(§5-2)
  const todayIso = todayISO(state); // 앱의 '오늘' 단일 출처(_today 시드 존중) — 파일 전체가 이것만 쓴다.
  const insight = useInsight(items, todayIso);

  // 이번 주 배분(과목별 합) — 카드 배지 공용. 보드/시트와 같은 출처(lib/weekAlloc).
  const wk = weekMonOf(todayIso);
  const alloc = allocView(state, res, wk);
  // 리드아웃 분자·분모는 lib/weekAlloc의 집계를 그대로 쓴다 — 배분 세그먼트(Alloc)와 **같은 문법**
  // (분자=배분 합, 분모=주당 예산 합)이라야 "같은 라벨이면 같은 의미"가 성립한다.
  const allocWeekMin = weekAllocTotalMin(state, res, wk);
  const weekBudgetMin = weekBudgetMinOf(state);

  // 뼈대 요약 — 스트립이 접혀 있어도 "가용이 얼마고 뭐가 잡혀 있나"는 항상 보인다.
  const weekFreeMin = DOW.reduce((t, _, i) => t + freeWindowsForWeekday(state, i).freeMin, 0);
  const classCount = routine.filter((b) => b.type === '수업').length;
  const blockCount = routine.length - classCount;

  // 과목 수·이번 주 배분·챕터 진행·마감 리드아웃을 상단 크롬으로.
  // ⚠ 문법 통일(결정로그 "오해 소지 '가용 113h' 제거"): 예전엔 같은 라벨 '이번 주 배분'인데 분모가
  //   여기선 주간 가용 총량(113h), 인접 배분 세그먼트에선 주당 예산(10h)이라 같은 이름·다른 의미였다.
  //   → 분모를 배분 세그먼트와 동일한 **주당 예산**으로 맞췄다. 그러면 옛 '주당 목표' 리드아웃은
  //   그 분모와 거의 같은 수라 중복 → 이 탭 고유 관심사인 **챕터 진행**으로 갈음한다.
  //   주간 가용 총량은 사라지지 않고 '뼈대' 스트립에 `가용 Nh/주`라는 **다른 라벨**로 남는다.
  usePageChromeEffect(
    () => ({
      readouts: !insight
        ? []
        : [
            { label: '과목', value: insight.count, accent: true },
            {
              label: '이번 주 배분',
              value: (
                <>
                  {(allocWeekMin / 60).toFixed(1)}
                  <small> / {(weekBudgetMin / 60).toFixed(1)} h</small>
                </>
              ),
            },
            {
              label: '챕터',
              value: insight.totalCh ? (
                <>
                  {insight.doneCh}
                  <small> / {insight.totalCh}</small>
                </>
              ) : (
                '—'
              ),
            },
            {
              label: insight.nearest ? `${insight.nearest.name} 마감` : '마감',
              value: insight.nearest ? ddayInfo(insight.nearest.dd).lab : '—',
            },
          ],
    }),
    [insight, allocWeekMin, weekBudgetMin],
  );

  const addItem = useCallback(() => {
    const id = rid();
    mutate((st) => {
      st.items.push(makeItem(st.items.length, { id, source: '직접', name: '새 과목' }));
    });
    setSheetId(id); // 새 과목은 바로 시트를 열어 편집
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
        // 참조 무결성 — weekAlloc은 sid 맵이라 과목만 지우면 배분이 전 주에 고아로 남고,
        // 그 잔재가 요일 열 합·가용 초과 경고를 부풀린다("보이는 행 합 1h인데 푸터는 4h").
        removeSidFromAlloc(st, id);
        // dayPlans도 같은 이유(sid 참조 무결성 없음) — 남으면 배치·캘린더에 유령 블록이 뜨고
        // 미러링된 completions[ds]['sid|type'] 집계가 완료 분을 계속 부풀린다.
        removeSidFromDayPlans(st, id);
      });
      setSheetId((cur) => (cur === id ? null : cur)); // 삭제한 과목의 시트는 닫는다
      ui.toast('과목 삭제됨', 'info');
    },
    [items, mutate],
  );

  // 드래그 정렬 — HTML5 DnD. 색은 인덱스 파생(PALETTE)이므로 재정렬 즉시 재유도해
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

  // AN-17 — 지식맵 등에서 `?focus=<itemId>`로 진입하면 그 항목 카드로 스크롤 + 짧은 하이라이트.
  // 캔버스(지식맵)의 "학습 항목 열기"가 목록 최상단이 아니라 특정 항목에 정확히 착지하게 한다.
  // focus는 1회 소비(URL 정리) — 하이라이트는 인라인 스타일로 명령형 적용, 모션 자제 시 트랜지션만 생략.
  useEffect(() => {
    const focus = searchParams.get('focus');
    if (!focus) return;
    // 없는 id여도 URL은 정리(재하이라이트 방지). replace로 히스토리 오염 없이 param만 제거.
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('focus');
        return next;
      },
      { replace: true },
    );
    const card = document.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(focus)}"]`);
    if (!card) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    card.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    // 1.5s 하이라이트 펄스 후 소멸 — 이전 값을 저장해 원복(CSS 모듈 미변경, 인라인만).
    const prev = {
      outline: card.style.outline,
      outlineOffset: card.style.outlineOffset,
      boxShadow: card.style.boxShadow,
      borderRadius: card.style.borderRadius,
      transition: card.style.transition,
    };
    card.style.transition = reduce ? 'none' : 'box-shadow 0.35s ease, outline-color 0.35s ease';
    card.style.borderRadius = 'var(--r-lg)';
    card.style.outline = '2px solid var(--acc)';
    card.style.outlineOffset = '3px';
    card.style.boxShadow = '0 0 0 4px var(--acc-glow, color-mix(in srgb, var(--acc) 30%, transparent))';
    const t = window.setTimeout(() => {
      card.style.outline = prev.outline;
      card.style.outlineOffset = prev.outlineOffset;
      card.style.boxShadow = prev.boxShadow;
      card.style.borderRadius = prev.borderRadius;
      card.style.transition = prev.transition;
    }, 1500);
    return () => window.clearTimeout(t);
  }, [searchParams, setSearchParams]);

  const n = items.length;
  const sheetItem = sheetId ? items.find((i) => i.id === sheetId) : null;

  return (
    <section className={c.wrap} aria-label="과목">
      <div className={c.header}>
        <div className={c.lead}>
          <h2 className={c.eyebrow}>과목{n ? ` · ${n}과목` : ''}</h2>
          <div className={c.hint}>
            카드를 누르면 <b>그 과목의 목표·챕터·요일 배분</b>을 한 창에서 정해요. 순서는 드래그 또는 <b>Alt+↑↓</b>
            (키보드).
          </div>
        </div>
        <div className={c.actions}>
          {n > 1 && (
            <Button sm variant="ghost" onClick={recolorAll} title="모든 과목 색을 새 팔레트 순서로 재배정">
              색 재배정
            </Button>
          )}
          <Button
            sm
            variant="ghost"
            onClick={() => setShowImport((v) => !v)}
            aria-pressed={showImport}
            title="옵시디언 볼트에서 과목을 불러와요(탭 이동 없이)"
          >
            📁 불러오기
          </Button>
          <Button sm variant="primary" onClick={addItem}>
            + 과목 추가
          </Button>
        </div>
      </div>

      {/* 뼈대 스트립 — 상시로는 요약만(가용·수업·일과). 누르면 과목과 **같은 중앙 시트**로 편집기가 뜬다.
          제자리 펼침을 쓰지 않는 이유는 ItemCard 아코디언을 걷어낸 이유와 같다: 뒤 갤러리가 아래로 밀려
          조망이 깨진다. 같은 탭 안에서 '펼침'과 '시트' 두 어휘를 섞지 않는다(일관성). */}
      <div className={c.skeleton}>
        <button type="button" className={c.skelBar} onClick={() => setShowSkeleton(true)} aria-haspopup="dialog">
          <span className={c.skelChev} aria-hidden="true">
            ›
          </span>
          <span className={c.skelTitle}>뼈대</span>
          <span className={c.skelStat}>
            가용 <b>{(weekFreeMin / 60).toFixed(1)}h</b>/주
          </span>
          <span className={c.skelSep} aria-hidden="true" />
          <span className={c.skelStat}>
            수업 <b>{classCount}</b>
          </span>
          <span className={c.skelSep} aria-hidden="true" />
          <span className={c.skelStat}>
            일과 <b>{blockCount}</b>
          </span>
          <span className={c.skelHint}>수업·일과 편집</span>
        </button>
      </div>

      <DetailDrawer
        open={showSkeleton}
        onClose={() => setShowSkeleton(false)}
        title="뼈대 — 가용시간·수업·일과"
        placement="center"
      >
        <SkeletonPanel />
      </DetailDrawer>

      {showImport && (
        <div className={c.importWrap}>
          <VaultImport onClose={() => setShowImport(false)} />
        </div>
      )}

      <div className={c.cols}>
        {items.length === 0 ? (
          <div className={c.empty}>
            <div className={ds.card}>
              <EmptyState
                glyph="📚"
                title="아직 과목이 없어요"
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
                      onClick={() => setShowImport(true)}
                      title="옵시디언 볼트/Anki를 스캔해 과목을 여기서 바로 불러오세요(탭 이동 없이)"
                    >
                      📁 볼트/Anki에서 불러오기
                    </Button>
                  </>
                }
              />
            </div>
          </div>
        ) : (
          <div className={c.gallery}>
            {items.map((s) => (
              /* 드래그 재정렬의 키보드 대안이 같은 요소에 있다 — 아래 onKeyDown 의 Alt+↑↓.
                 이 래퍼는 일부러 포커스를 안 받는다(카드마다 탭 스톱을 늘리지 않으려고);
                 키 이벤트는 자식 ItemCard 의 포커스 가능한 헤드(role=button·tabIndex=0)에서
                 버블링돼 도달한다. */
              // eslint-disable-next-line jsx-a11y/no-static-element-interactions
              <div
                key={s.id}
                data-item-id={s.id}
                className={`${c.dragWrap}${overId === s.id && dragId !== s.id ? ' ' + c.dragOver : ''}${dragId === s.id ? ' ' + c.dragging : ''}`}
                draggable
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
                <ItemCard
                  item={s}
                  onOpen={setSheetId}
                  weakCount={weakBySid[s.id]}
                  allocMin={rowSumMin(alloc[s.id])}
                  todayIso={todayIso}
                />
              </div>
            ))}
          </div>
        )}

        <AvailRail />
      </div>

      {sheetItem && (
        <SubjectSheet item={sheetItem} mutate={mutate} onClose={() => setSheetId(null)} onDelete={removeItem} />
      )}
    </section>
  );
}
