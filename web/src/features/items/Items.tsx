/* ============================================================
   Items — 계획 › '과목' 탭. 계획 재개편 v3에서 옛 '뼈대'(가용시간·수업·일과) 세그먼트를 흡수했다.
   단일 질문: **"무엇을, 주당 얼마나, 어느 요일에 — 그리고 그럴 시간이 있나?"**

   층 구성(사용자 확정 안):
     · 상단 = 뼈대 요약 스트립(접힘 기본) → 펼치면 SkeletonPanel(수업·일과 편집)
     · 좌   = 과목 갤러리 + 볼트 불러오기
     · 우   = AvailRail(24h 링·요일 막대 = 가용 위에 배분 적재)
     · 클릭 = **객체 화면 `/subject/:id`**(W12 · 옛 SubjectSheet 중앙 시트를 대체)

   배분은 '흡수'가 아니라 '미러' — 전 과목 교차 조망(요일 열 합계)은 배치 탭의 배분 보드가 계속 소유하고,
   여기선 lib/weekAlloc 같은 출처로 한 과목의 행만 편집한다. 두 입구, 한 진실.
============================================================ */
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { useKeymapDoc } from '@/hooks/useKeymap';
import { useListCursor } from '@/hooks/useListCursor';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, skipToken } from '@tanstack/react-query';
import { useApp } from '@/store/useApp';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { useSchedule } from '@/store/selectors';
import { prefersReducedMotion } from '@/lib/motion';
import { rid, makeItem, ddayInfo, DOW, round1, hNum, hLabel, openVaultSearch } from '@/lib/utils';
import { useTodayISO } from '@/hooks/useTodayISO';
import { freeWindowsForWeekday } from '@/lib/scheduler';
import {
  allocView,
  rowSumMin,
  weekMonOf,
  weekAllocTotalMin,
  weekBudgetMin as weekBudgetMinOf,
  weekRequiredMin,
} from '@/lib/weekAlloc';
import { deadlineDdays } from '@/lib/scheduleView';
import { weakCountBySid } from '@/lib/insights';
import { Button } from '@/components/ui';
import State from '@/components/State';
import DetailDrawer from '@/components/DetailDrawer';
import type { VaultScan } from '@/lib/vault';
import type { AppState, Item, ItemStat } from '@/lib/types';
import { ItemCard } from './ItemCard';
import { VaultImport } from './VaultImport';
import { SkeletonPanel } from './SkeletonPanel';
import { AvailRail } from './AvailRail';
import { Icon } from '@/components/Icon';
import { STRUCTURE_VIEW } from '@/shell/tabs';

/* ── P-19 — **`graph`(학습 구조도)가 탭에서 이 화면의 뷰로 내려왔다**(2026-08-01) ────────────
   둘은 **같은 로컬 데이터의 두 시각화**다: 여기가 항목→챕터를 목록으로, 저기가 같은 것을 힘-방향
   구조도로 그린다(서버 페치 0 · 항상 가용). 그런데 호스트가 갈려 있어서 `plan›과목` 과
   `train›구조` 라는 **서로 다른 질문의 자리**에 앉아 있었다.

   ⚠ **파일을 합치지 않는다.** 로드맵이 지적한 교환("탭 하나 줄이려고 파일 하나를 감당 못 하게")을
   피하는 방법은 단순하다 — 호스트만 바꾸고 컴포넌트는 그대로 둔다. `Items.tsx`(434줄) ·
   `Graph.tsx`(741줄) 어느 쪽도 안 커지므로 `max-lines`·인지복잡도 래칫을 건드리지 않는다.
   ⚠ **lazy 다.** 구조도는 캔버스+시뮬레이션이라 무겁고, 목록만 보는 대부분의 방문에서 그 코드를
   내려받을 이유가 없다. 탭이었을 때 `registry.tsx` 가 해 주던 일을 여기서 그대로 한다.
   ⚠ E10 이 두 화면을 남긴 판정(_"인접해 보인다고 같은 질문이 아니다"_)은 **뒤집히지 않았다.**
   저 판정이 가른 짝은 `graph` 대 `mastery`(볼트 산출 개념 히트맵)였고, 그 둘은 여전히 다른
   호스트에 있다. 여기서 합치는 짝은 `graph` 대 `items` — 같은 로컬 데이터다. */
const Graph = lazy(() => import('../graph/Graph'));

/* 이 화면의 두 뷰. URL 이 정본이다(딥링크·⌘K·옛 `/graph` 리다이렉트가 전부 여기 착지한다).
   ⚠ 쿼리 값은 `shell/tabs` 가 소유한다(P3) — ⌘K 의 `act:graph` 가 같은 문자열로 이동하므로,
   여기에 사본을 두면 한쪽만 고쳐졌을 때 팔레트가 조용히 목록 뷰로 착지한다. */
const STRUCTURE = STRUCTURE_VIEW;

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
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // sid(=item.id)별 반복 약점 총합 — cbms가 바뀔 때만 롤업 재계산(SR-2). weakCountBySid는 state.cbms만 읽으므로
  // 반응형 cbms 슬라이스를 넘겨 재계산을 그 변화에 묶는다(전체 state 구독으로 인한 불필요 리렌더 회피).
  const weakBySid = useMemo(() => weakCountBySid({ ...useApp.getState().state, cbms }), [cbms]);
  /* 온보딩(W3)이 `?import=1`·`?skeleton=1` 로 **서로 다른 목적지**에 착지한다 — 종전엔 3버튼이
     전부 `/items` 라 "3단계"가 한 화면으로 무너져 있었다. 초기값으로만 읽고(아래 1회 소비),
     그 뒤로는 평범한 토글이다. */
  /* P-19 뷰 — **URL 이 정본**이다. `useState` 로 두면 옛 `/graph` 딥링크·⌘K·뒤로가기가 착지할
     자리가 없어지고, 그건 탭을 없앤 대가로 *도달성*을 잃는 것이다(IA 재편의 금지 사항). */
  const structure = searchParams.get('view') === STRUCTURE;
  const setView = useCallback(
    (on: boolean) =>
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (on) next.set('view', STRUCTURE);
          else next.delete('view');
          return next;
        },
        { replace: true },
      ),
    [setSearchParams],
  );
  const [showSkeleton, setShowSkeleton] = useState(() => searchParams.get('skeleton') === '1');
  const [showImport, setShowImport] = useState(() => searchParams.get('import') === '1');
  // 볼트에 뭐가 있나 — `app/VaultSync` 가 부팅에 채운 캐시만 구독(fetch 0). 빈 상태 위계 판정용(W1).
  const vaultSubjects = useQuery<VaultScan>({ queryKey: ['vault'], queryFn: skipToken }).data?.subjects.length || 0;
  const todayIso = useTodayISO(state); // 앱의 '오늘' 단일 출처(_today 시드 존중 · 자정 롤오버 H20) — 파일 전체가 이것만 쓴다.
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
      /* W22/H3 — `primary` 는 **필수 키**다(`store/usePageChrome.ts` 머리주석). 이 화면은 렌즈라
         44px 앵커를 세우지 않는다 — 잊은 것이 아니라 없다고 정한 것이다. */
      primary: null,
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
      /* ⚠⚠ **목표를 기본값으로 채우지 않는다(W1 · 2026-07-31).** 이 버튼 한 번이 온보딩 3단계 중
         **2단계를 동시에 충족**시키고 `Today` 가 셋업 스크림을 영구히 걷었다 — 사용자는 `새 과목`
         하나만 있는 대시보드를 받고 볼트 임포트는 영영 안 만난다. 목표는 사람이 정하는 것이므로
         빈 채로 시트를 연다(`SetupGuide.setupComplete` 의 2단계 판정이 이 값을 본다).
         ⚠ `weeklyHours: 0` 은 이제 `makeItem` 의 **기본값**이라 여기서 반복하지 않아도 된다.
           남겨 두는 이유는 이 화면이 그 계약에 **의존한다는 사실을 지역에서 읽히게** 하기
           위해서다 — 기본이 다시 올라가면 이 줄이 그 자리에서 막는다(H20). */
      st.items.push(makeItem({ id, source: '직접', name: '새 과목', weeklyHours: 0 }));
    });
    navigate(`/subject/${id}`); // 새 과목은 바로 객체 화면을 열어 편집(카드가 아직 없어 morph 없음)
  }, [mutate, navigate]);

  /* ⚠⚠ **`색 재배정` 버튼을 지웠다 — 구조적 no-op 이었다**(P4 · 2026-08-01).

     하던 일은 `s.color = colorForId(s.id)` 였고 그건 `lib/utils.refineItemColors` 와 **문자 그대로
     같다.** 그리고 그 함수는 상태가 메모리로 들어오는 **진입 3경로 전부**에서 이미 돈다
     (`useApp.ts:78` 부팅 · `:91` 기본값 · `:281` `loadState`). 주석이 든 유일한 존치 사유
     ("옛 팔레트로 내보낸 백업을 가져왔을 때")도 그 셋째 경로가 덮는다 — 즉 버튼을 누르든 안
     누르든 저장값은 항상 같다. title 의 *"새 팔레트 **순서**로"* 는 2026-07-24 에 OKLCH 파생이
     배열 팔레트를 대체하며 죽은 어휘의 화석이었다(색에 '순서'가 없어진 지 오래다).

     ⚠ 되살리지 말 것: 색이 저장값처럼 보이는 순간(절대규칙 #3) 이런 버튼이 다시 필요해 보인다.
     필요한 것은 버튼이 아니라 **파생이 1곳인가**이고, 그 답은 이미 예다. */

  /* ⚠ 과목 삭제는 **객체 화면이 소유한다**(W12) — 삭제 버튼이 거기 있고, 그 화면이 삭제 후
     목록으로 돌아온다. 여기 사본을 남기면 참조 무결성 3줄(`removeSidFromAlloc`·
     `removeSidFromDayPlans`)이 두 벌이 되고, 그 부류가 이 저장소가 반복해 물린 형태다. */

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

  /* 온보딩 딥링크 1회 소비 — 값은 위 `useState` 초기값이 이미 읽었다. 여기선 URL 만 정리한다
     (안 지우면 뒤로가기·재방문마다 패널이 다시 열린다 — `?focus=` 가 같은 이유로 1회 소비다). */
  useEffect(() => {
    if (!searchParams.has('import') && !searchParams.has('skeleton')) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('import');
        next.delete('skeleton');
        return next;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams]);

  /* ⚠ `?focus=<itemId>` 1회소비 + 카드 하이라이트 + `CSS.escape` 장치 **통째로 사라졌다**(W12).
     그 장치는 "객체에 URL 이 없다"의 우회로였다 — 지식맵이 과목 하나를 가리키고 싶은데 착지할
     화면이 목록뿐이라, 목록에 데려다 놓고 **눈으로 찾을 자리를 깜빡여** 알려 줬다. 객체 축이
     서면 그냥 `/subject/:id` 로 간다. 딥링크 호출부도 그 주소를 쓴다. */

  /* 카드 → **객체 화면**(W12). 종전엔 중앙 시트를 열었고, 그래서 과목이라는 명사에 URL 이 없어
     ⌘K·딥링크·뒤로가기가 전부 이 화면을 경유해야 했다. VT 지원이면 카드→페이지 morph 로
     이어 그린다(같은 `subject-morph` 이름 · 이름 반납은 라우트 전환이 자동으로 한다). */
  const openSubject = useCallback(
    (id: string) => {
      const el = document.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(id)}"]`);
      // ⚠ 두 이유(OS·앱 설정)를 여기서 다시 OR 하지 않는다 — 판정은 `lib/motion` 하나다(H19).
      if (el && !prefersReducedMotion()) el.style.viewTransitionName = 'subject-morph';
      navigate(`/subject/${id}`, { viewTransition: true });
    },
    [navigate],
  );

  /* W13 — 과목 갤러리 커서. 카드 자체는 이미 탭 스톱 하나였지만(ItemCard 의 role=button 헤드)
     **동사가 없었다** — 열려면 Enter, 볼트로 가려면 마우스였다. 어휘는 훅이 닫는다: `e` 편집(=열기)
     · `v` 볼트. 삭제(`d`)는 여기 없다 — 객체 화면이 소유한다(W12 · 확인창+백업이 거기 붙어 있다). */
  const galleryCursor = useListCursor<Item>({
    items: items.map((it) => ({ key: it.id, item: it })),
    docTitle: '이 화면 · 과목',
    verbs: { e: (it) => openSubject(it.id), v: (it) => openVaultSearch(it.name) },
  });

  const n = items.length;

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col" aria-label="과목">
      <div className="flex flex-none items-center gap-3.5 pt-4.5 pr-5.5 pb-3.5 pl-5.5 max-narrow:px-3.5 max-narrow:pt-3.5 max-narrow:pb-2.5">
        <div className="min-w-0">
          <h2 className="mb-0! text-xs! leading-text font-extrabold! tracking-eyebrow! text-acc! uppercase">
            과목{n ? ` · ${n}과목` : ''}
          </h2>
          <div className="mt-1 text-hint leading-snug text-mut">
            {structure ? (
              <>
                같은 과목·챕터를 <b className="font-bold text-txt">연결 구조</b>로 봐요. 노드를 끌어 배치하고, 누르면
                상세가 열려요.
              </>
            ) : (
              <>
                카드를 누르면 <b className="font-bold text-txt">그 과목의 목표·챕터·요일 배분</b>을 한 창에서 정해요.
                순서는 드래그 또는 <b className="font-bold text-txt">Alt+↑↓</b>
                (키보드).
              </>
            )}
          </div>
        </div>
        {/* P-19 뷰 전환 — **세그먼트 바가 아니라 이 화면 안의 토글**이다. 세그먼트는 "다른 질문의
            자리"를 뜻하는데 이 둘은 같은 질문의 두 표현이라, 바깥으로 올리면 다시 갈라진다. */}
        {/* ⚠ **`ds-seg` 를 쓴다 — `aria-pressed` 에는 시각 스타일이 없다**(실렌더로 잡았다 · §15-4).
            처음엔 ghost 버튼 두 개에 `aria-pressed` 만 달았는데, 이 저장소에는 그 속성에 대응하는
            CSS 가 **한 줄도 없다**(전역·컴포넌트 통틀어 0건). 스크린리더에는 상태가 가고 눈에는
            안 가는 형태였다 — 정적 검사·타입 어느 쪽도 못 보는 부류다. 캘린더 뷰 스위치가 쓰는
            같은 세그로 맞춘다(`ds-on` 이 활성 칸을 액센트로 채운다). */}
        <div className="ds-seg ml-auto flex-none" role="group" aria-label="보기 전환">
          {(
            [
              [false, '목록'],
              [true, '구조도'],
            ] as const
          ).map(([on, lab]) => (
            <button
              key={lab}
              type="button"
              aria-pressed={on === structure}
              className={on === structure ? 'ds-on' : ''}
              onClick={() => setView(on)}
            >
              {lab}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {!structure && (
            <Button
              sm
              variant="ghost"
              onClick={() => setShowImport((v) => !v)}
              aria-pressed={showImport}
              title="옵시디언 볼트에서 과목을 불러와요(탭 이동 없이)"
            >
              <Icon name="folder" /> 불러오기
            </Button>
          )}
          {!structure && (
            <Button sm variant="primary" onClick={addItem}>
              + 과목 추가
            </Button>
          )}
        </div>
      </div>

      {/* 구조도 뷰 — 같은 데이터의 두 번째 표현. `lazy` 라 목록만 보는 방문엔 안 내려온다. */}
      {structure ? (
        <Suspense
          fallback={<div className="flex min-h-0 flex-1 items-center justify-center text-mut">구조도 로딩…</div>}
        >
          <Graph />
        </Suspense>
      ) : (
        <>
          {/* 뼈대 스트립 — 상시로는 요약만(가용·수업·일과). 누르면 과목과 **같은 중앙 시트**로 편집기가 뜬다.
          제자리 펼침을 쓰지 않는 이유는 ItemCard 아코디언을 걷어낸 이유와 같다: 뒤 갤러리가 아래로 밀려
          조망이 깨진다. 같은 탭 안에서 '펼침'과 '시트' 두 어휘를 섞지 않는다(일관성). */}
          <div className="flex-none px-5.5 max-narrow:px-3.5">
            <button
              type="button"
              className="flex w-full items-center gap-2.5 rounded-md! border-line2! py-2.25! pr-3.5! pl-3.5! text-left text-sm! leading-auto"
              onClick={() => setShowSkeleton(true)}
              aria-haspopup="dialog"
            >
              <span className="w-3 flex-none text-xs leading-auto text-mut" aria-hidden="true">
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
              <span className="ml-auto text-xs leading-auto whitespace-nowrap text-mut">수업·일과 편집</span>
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
                    glyph="books"
                    title="아직 과목이 없어요"
                    desc={
                      <>
                        공부할 과목을 추가하면 <b>주당 목표 시간</b>과 <b>챕터</b>로 스케줄러가 매일 블록을 자동
                        배치합니다. 옵시디언 볼트나 Anki에서 통째로 불러올 수도 있어요.
                      </>
                    }
                    next={
                      /* ⚠ **위계가 뒤집혀 있었다(W1 · 2026-07-31).** primary 는 `+ 첫 과목 추가`,
                     임포트는 ghost 였다 — 시각적으로 지배적인 버튼이 `새 과목` 하나를 만들고
                     온보딩을 끝내는 막다른 길이었다. 볼트에 실제로 뭔가 있으면 그쪽이 primary. */
                      <>
                        <Button
                          variant={vaultSubjects ? 'primary' : 'default'}
                          onClick={() => setShowImport(true)}
                          title="옵시디언 볼트/Anki를 스캔해 과목을 여기서 바로 불러오세요(탭 이동 없이)"
                        >
                          <Icon name="folder" /> 볼트/Anki에서 불러오기
                          {vaultSubjects > 0 && <span className="ds-tiny"> — 과목 {vaultSubjects}개 대기</span>}
                        </Button>
                        <Button variant={vaultSubjects ? 'ghost' : 'primary'} onClick={addItem}>
                          + 첫 과목 추가
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
                    ref={galleryCursor.register(s.id)}
                    onFocusCapture={() => galleryCursor.onItemFocus(s.id)}
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
                      onOpen={openSubject}
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
        </>
      )}
    </section>
  );
}
