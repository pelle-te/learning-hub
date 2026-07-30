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
import { useKeymapDoc } from '@/hooks/useKeymap';
import { flushSync } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '@/store/useApp';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { useSchedule } from '@/store/selectors';
import { prefersReducedMotion, reveal } from '@/lib/motion';
import { ui } from '@/shell';
import { colorForId, rid, makeItem, ddayInfo, DOW, todayISO, round1, hNum, hLabel } from '@/lib/utils';
import { freeWindowsForWeekday } from '@/lib/scheduler';
import {
  allocView,
  rowSumMin,
  weekMonOf,
  removeSidFromAlloc,
  weekAllocTotalMin,
  weekBudgetMin as weekBudgetMinOf,
  weekRequiredMin,
} from '@/lib/weekAlloc';
import { deadlineDdays } from '@/lib/scheduleView';
import { removeSidFromDayPlans } from '@/lib/dayPlans';
import { weakCountBySid } from '@/lib/insights';
import { Button } from '@/components/ui';
import State from '@/components/State';
import DetailDrawer from '@/components/DetailDrawer';
import type { AppState, Item, ItemStat } from '@/lib/types';
import { ItemCard } from './ItemCard';
import { VaultImport } from './VaultImport';
import { SkeletonPanel } from './SkeletonPanel';
import { AvailRail } from './AvailRail';
import { SubjectSheet } from './SubjectSheet';

/** 빈 여백 대신 한눈 지표 — 과목 수·주당 합계·챕터 진행·가장 가까운 마감.
 *  '오늘'은 벽시계가 아니라 **앱 정본**(todayISO, `_today` 시드 존중)을 호출부에서 받는다 —
 *  AvailRail/Alloc이 못박은 계약(단일 출처)을 마감 D-day만 우회하면 시드 주입 시 값이 갈렸다. */
function useInsight(items: Item[], todayDs: string, itemStat: ItemStat[]) {
  return useMemo(() => {
    const named = items.filter((i) => i.name);
    if (!named.length) return null;
    /* ⚠ 두 정의를 **lib 으로 수렴**했다(H11 · 2026-07-26 감사).
       ① 주당 필요 시간 — 여기서 따로 더하던 것이 `AvailRail` 의 같은 계산과 별개로 존재했다.
       ② 가장 가까운 마감 — 필터 없는 최솟값이라 **3월에 끝낸 과목의 D+130 이 항상 이겼다**
          (`deadlineDdays` 는 끝난 과목·지난 마감을 빼는 SSOT 이고, Today·Schedule 은 이미
          그걸 쓴다. 여기만 안 써서 같은 앱이 서로 다른 '가장 가까운 마감'을 말했다). */
    const weekly = weekRequiredMin({ items } as unknown as AppState) / 60;
    const nearestDd = deadlineDdays(itemStat, todayDs)[0];
    const nearest = nearestDd ? { dd: nearestDd.dday, name: nearestDd.name } : null;
    let totalCh = 0;
    let doneCh = 0;
    for (const s of named) {
      for (const ch of s.chapters || []) {
        totalCh++;
        if (ch.done) doneCh++;
      }
    }
    const chPct = totalCh ? Math.round((doneCh / totalCh) * 100) : 0;
    return {
      count: named.length,
      weekly: round1(weekly),
      doneCh,
      totalCh,
      chPct,
      nearest,
    };
  }, [items, todayDs, itemStat]);
}

export default function Items() {
  /* E16 — 드래그 재정렬의 키보드 대안이 주석·`aria-label` 에만 있었다. 등재해야 `?` 가 이 화면에
     대해 사실을 말한다(치트시트가 거짓말할 자유를 없앤다). */
  useKeymapDoc('이 화면 · 과목', [{ display: 'Alt + ↑ / ↓', label: '과목 순서 바꾸기' }]);
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
  const [morphing, setMorphing] = useState(false); // 이 열림이 카드→시트 VT morph 인가(진입 애니 대체)
  const [showSkeleton, setShowSkeleton] = useState(false); // 뼈대 편집 스트립 펼침(온디맨드 세부)
  const [showImport, setShowImport] = useState(false); // 인라인 볼트 불러오기 토글(§5-2)
  const todayIso = todayISO(state); // 앱의 '오늘' 단일 출처(_today 시드 존중) — 파일 전체가 이것만 쓴다.
  const insight = useInsight(items, todayIso, res.itemStat);

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
                  {hNum(allocWeekMin)}
                  <small className="text-base14 font-bold text-mut"> / {hNum(weekBudgetMin)} h</small>
                </>
              ),
            },
            {
              label: '챕터',
              value: insight.totalCh ? (
                <>
                  {insight.doneCh}
                  <small className="text-base14 font-bold text-mut"> / {insight.totalCh}</small>
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
      st.items.push(makeItem({ id, source: '직접', name: '새 과목' }));
    });
    setMorphing(false); // 새 과목은 카드가 아직 없어 morph 없이 연다
    setSheetId(id); // 새 과목은 바로 시트를 열어 편집
  }, [mutate]);

  const recolorAll = useCallback(() => {
    if (!items.length) {
      ui.toast('재배정할 과목이 없어요.', 'warn');
      return;
    }
    ui.backupNow(); // 되돌리기용 1단계 백업
    // 0단계-G 이후 색은 id 파생이라 '순서 재배정'이라는 개념이 없다 — 이 버튼은 이제
    // **저장된 색을 현재 PALETTE로 다시 맞추는** 복구 동작이다(옛 팔레트로 내보낸 백업을
    // 가져왔을 때처럼 저장값이 낡은 경우). 부팅 시 refineItemColors가 하는 일과 같다.
    mutate((st) => {
      st.items.forEach((s) => {
        s.color = colorForId(s.id);
      });
    });
    ui.toastUndo('과목 색을 현재 팔레트로 다시 맞췄어요.');
  }, [items.length, mutate]);

  const removeItem = useCallback(
    async (id: string) => {
      const it = items.find((s) => s.id === id);
      const okConfirm = await ui.confirm(
        `"${(it && it.name) || '이 과목'}"을(를) 삭제할까요? (챕터·진행 기록도 함께 사라집니다)`,
        { title: '과목 삭제', okLabel: '삭제', danger: true },
      );
      if (!okConfirm) return;
      /* ⚠ **이 앱에서 가장 파괴적인 삭제인데 유일하게 안전망이 없었다.** 훨씬 작은 형제들 —
         챕터(`ChapterEditor`)·수업/블록(`SkeletonPanel`)·졸업 과목(`Degree.delCourse`) — 은
         전부 `backupNow()`+`toastUndo()` 를 갖는데, 챕터·진행·배분·dayPlans 를 **한꺼번에**
         지우는 여기만 확인창 하나였다. 파괴력과 복구가능성이 정확히 역전돼 있었다. */
      ui.backupNow();
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
      ui.toastUndo(`"${(it && it.name) || '과목'}" 삭제됨`);
    },
    [items, mutate],
  );

  // 드래그 정렬 — HTML5 DnD. 색은 **id 파생**이라 순서와 무관하다(0단계-G) → 재정렬 후
  // 색을 다시 유도하던 보정이 필요 없어졌다. 그 보정이 있던 이유(인덱스 파생 → 순서가 색을 바꿈)
  // 자체가 사라졌다.
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
    const reduce = prefersReducedMotion();
    reveal(card); // 모션 자제 판정은 `lib/motion` 이 소유한다(H16 — 흩어져 있던 것이 재발 원인이었다)
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

  // 카드 → 과목 시트 열기. VT 지원 + 모션 허용이면 클릭된 카드에 공유 이름을 얹어 시트로 morph
  // 시킨다(카드 위치·크기에서 시트로 보간). flushSync 로 시트를 동기 마운트해야 new 스냅샷이 잡힌다.
  // 미지원/reduced-motion/fx-lite/새 과목(카드 없음)이면 즉시 열림(무해 폴백).
  const openSheet = useCallback((id: string) => {
    const el = document.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(id)}"]`);
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
    const reduce =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const lite = document.documentElement.getAttribute('data-fx') === 'lite';
    if (typeof doc.startViewTransition === 'function' && el && !reduce && !lite) {
      el.style.viewTransitionName = 'subject-morph'; // old 스냅샷: 이 카드가 그 이름
      doc.startViewTransition(() =>
        flushSync(() => {
          el.style.viewTransitionName = ''; // new 스냅샷: 카드는 이름 반납(시트가 이어받는다)
          setMorphing(true);
          setSheetId(id);
        }),
      );
    } else {
      setMorphing(false);
      setSheetId(id);
    }
  }, []);

  const n = items.length;
  const sheetItem = sheetId ? items.find((i) => i.id === sheetId) : null;

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col" aria-label="과목">
      <div className="flex flex-none items-center gap-3.5 pt-4.5 pr-5.5 pb-3.5 pl-5.5 max-narrow:px-3.5 max-narrow:pt-3.5 max-narrow:pb-2.5">
        <div className="min-w-0">
          <h2 className="mb-0! text-xs! leading-[1.6] font-extrabold! tracking-eyebrow! text-acc! uppercase">
            과목{n ? ` · ${n}과목` : ''}
          </h2>
          <div className="mt-1 text-hint leading-[1.4] text-mut">
            카드를 누르면 <b className="font-bold text-txt">그 과목의 목표·챕터·요일 배분</b>을 한 창에서 정해요. 순서는
            드래그 또는 <b className="font-bold text-txt">Alt+↑↓</b>
            (키보드).
          </div>
        </div>
        <div className="ml-auto flex flex-wrap justify-end gap-2">
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
      <div className="flex-none px-5.5 max-narrow:px-3.5">
        <button
          type="button"
          className="flex w-full items-center gap-2.5 rounded-md! border-line2! py-2.25! pr-3.5! pl-3.5! text-left text-sm! leading-[normal]"
          onClick={() => setShowSkeleton(true)}
          aria-haspopup="dialog"
        >
          <span className="w-3 flex-none text-xs leading-[normal] text-mut" aria-hidden="true">
            ›
          </span>
          <span className="flex-none text-skel-title font-extrabold tracking-skel text-acc uppercase">뼈대</span>
          <span className="whitespace-nowrap text-mut tabular-nums">
            가용 <b className="font-extrabold text-txt">{hLabel(weekFreeMin)}</b>/주
          </span>
          <span className="h-3 w-px flex-none bg-line2" aria-hidden="true" />
          <span className="whitespace-nowrap text-mut tabular-nums">
            수업 <b className="font-extrabold text-txt">{classCount}</b>
          </span>
          <span className="h-3 w-px flex-none bg-line2" aria-hidden="true" />
          <span className="whitespace-nowrap text-mut tabular-nums">
            일과 <b className="font-extrabold text-txt">{blockCount}</b>
          </span>
          <span className="ml-auto text-xs leading-[normal] whitespace-nowrap text-mut">수업·일과 편집</span>
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
        <div className="flex-none pt-2.5 pr-5.5 pb-0 pl-5.5 max-narrow:px-3.5">
          <VaultImport onClose={() => setShowImport(false)} />
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-items-cols max-wide:grid-cols-1 max-wide:overflow-y-auto">
        {items.length === 0 ? (
          <div className="px-5.5 pt-1.5 pb-5.5">
            <div className="ds-rule">
              <State
                glyph="📚"
                title="아직 과목이 없어요"
                desc={
                  <>
                    공부할 과목을 추가하면 <b>주당 목표 시간</b>과 <b>챕터</b>로 스케줄러가 매일 블록을 자동 배치합니다.
                    옵시디언 볼트나 Anki에서 통째로 불러올 수도 있어요.
                  </>
                }
                next={
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
          <div className="grid min-h-0 [scrollbar-width:thin] grid-cols-gallery content-start gap-3.5 overflow-y-auto pt-1.5 pr-4 pb-5.5 pl-5.5 max-wide:overflow-visible max-wide:px-5.5 max-wide:pt-1.5 max-wide:pb-2 max-narrow:grid-cols-1 max-narrow:px-3.5 max-narrow:pt-1.5 max-narrow:pb-4.5">
            {items.map((s) => (
              /* 드래그 재정렬의 키보드 대안이 같은 요소에 있다 — 아래 onKeyDown 의 Alt+↑↓.
                 이 래퍼는 일부러 포커스를 안 받는다(카드마다 탭 스톱을 늘리지 않으려고);
                 키 이벤트는 자식 ItemCard 의 포커스 가능한 헤드(role=button·tabIndex=0)에서
                 버블링돼 도달한다. */
              // eslint-disable-next-line jsx-a11y/no-static-element-interactions
              <div
                key={s.id}
                data-item-id={s.id}
                className={`cursor-grab rounded-drag transition-opacity duration-fast ease-[var(--ease)]${overId === s.id && dragId !== s.id ? ' outline-2 outline-offset-2 outline-acc outline-dashed' : ''}${dragId === s.id ? ' opacity-45' : ''}`}
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
                  onOpen={openSheet}
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
        <SubjectSheet
          item={sheetItem}
          mutate={mutate}
          onClose={() => setSheetId(null)}
          onDelete={removeItem}
          morph={morphing}
        />
      )}
    </section>
  );
}
