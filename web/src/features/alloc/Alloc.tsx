/* ============================================================
   Alloc — 계획 › '배분' 세그먼트. 옛 배치 탭의 alloc 뷰를 독립 탭으로 승격(계획 재개편 v4).
   질문 "이번 주, 어느 과목을 어느 요일에 얼마씩?" — 캘린더(언제 할까)와 리듬이 다르다:
   배분은 주(週) 단위로 한 번 정하는 '전략', 캘린더는 매일 보는 '전술'. 뷰 스위치 안에 섞여 있으면
   계획의 축이 흐려져 세그먼트로 분리했다([캘린더 · 배분 · 과목] 순).

   보드 자체(과목행×요일열 매트릭스)는 AllocBoard가 소유 — 여긴 주 네비·리드아웃·드릴다운 배선만.
   ⚠ features → features import 금지(boundaries)라 AllocBoard가 schedule/에서 여기로 물리 이주했다.
============================================================ */
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/useApp';
import { useUI } from '@/store/useUI';
import { useSchedule, useStudyMinByWeekday } from '@/store/selectors';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { io } from '@/shell';
import { weekLabel, todayISO, ddayInfo, hNum, hLabel, iso, addDays, parseISO } from '@/lib/utils';
import { weekAllocTotalMin, weekBudgetMin as weekBudgetMinOf, weekDoneNewMin } from '@/lib/weekAlloc';
import { deadlineDdays } from '@/lib/scheduleView';
import { Button } from '@/components/ui';
import { useWeekOffset } from '@/hooks/useWeekOffset';
import { AllocBoard } from './AllocBoard';

/* Alloc 세그먼트 셸 — 옛 CSS Module 을 Tailwind 유틸로 이식(C-7). 주 네비 크롬만 소유(보드는 AllocBoard).
   ⚠ 내장 크기 이름(text-lg/sm)은 preflight 없는 이 앱에서 companion line-height 를 흘리므로 정상흐름
   요소엔 leading-[1.6](본문 상속)을 명시로 못박는다. 자간 -0.01em 은 사다리 밖이라 tracking-wk 로 이름. */
const C = {
  wrap: 'flex h-full min-w-0 flex-col',
  nav: 'flex flex-none flex-wrap items-center gap-2.5 border-b border-line px-5.5 py-3.5',
  // 주 이동 클러스터 — 한 덩어리(1 1 260px). 버튼 세로 붕괴 방지로 자식 Button 에 whitespace-nowrap.
  wknav: 'flex min-w-0 shrink grow basis-65 items-center gap-2.5',
  wk: 'min-w-22.5 flex-1 text-center',
  wkLab: 'text-lg leading-[1.6] font-extrabold tracking-wk whitespace-nowrap',
  wkOff: 'ml-1.5 text-sm leading-[1.6] font-semibold whitespace-nowrap text-mut',
  // 지난주 대조 한 줄 — 주 네비 오른쪽 끝(보드 바로 위).
  prev: 'ml-auto text-sm leading-[1.6] whitespace-nowrap text-mut tabular-nums',
  body: 'min-h-0 flex-1',
};

export default function Alloc() {
  const state = useApp((s) => s.state);
  const res = useSchedule();
  const capWd = useStudyMinByWeekday();
  const navigate = useNavigate();
  const setSchedView = useUI((s) => s.setSchedView);
  const todayIso = todayISO(state); // 앱의 '오늘' 단일 출처(_today 시드 존중)

  // 주 네비(오프셋 상태 · , / . 단축키 · 배지 라벨)는 useWeekOffset 단일 기계가 소유 —
  // 예전엔 todayOff 산식·useState·useWeekNavKeys가 캘린더와 글자까지 같은 모양으로 복제돼 있었다.
  // ⚠ 훅이 내부에서 useWeekNavKeys를 등록하므로 여기서 또 등록하면 이중 이동이 된다.
  const { rel, prev, next, weekToday, isThisWeek, offsetLabel, curMon, weekMon } = useWeekOffset(state);

  // 분자·분모 모두 weekAlloc의 단일 집계를 쓴다 — 각자 필터를 굴리던 시절엔 주당 0h 과목이
  // 분자에만 들어가 "4.0 / 2.0h · 예산 달성 200%" 같은 오염이 났다(집합 불일치).
  const weekAllocMin = weekAllocTotalMin(state, res, weekMon);
  // 주당 예산 합(스케줄 가능한 주간 과목 weeklyHours) — 배분이 채워가는 목표. '가용 총량'(수십 h)보다 배분과 직접 관계돼 리드아웃에 적합.
  const weekBudgetMin = weekBudgetMinOf(state);
  const allocPct = weekBudgetMin > 0 ? Math.round((weekAllocMin / weekBudgetMin) * 100) : 0;
  /* 지난주 대조 — **다음 주 숫자를 정하는 자리에 유일하게 없던 근거**(Later).
     보드는 "이번 주 얼마를 배분했나"만 말했고, "지난주엔 그 배분이 얼마나 지켜졌나"는 어디에도
     없었다. 새 데이터는 0이다(배분·완료 둘 다 이미 있다).
     ⚠ `new` 타입으로 좁힌 이유는 `weekDoneNewMin` 머리주석 — 안 좁히면 비교 불가능한 대조가 된다.
     ⚠ **이번 주에는 안 그린다**(진행 중이라 실제가 늘 모자라 보인다 = 매일 지는 게임). */
  const prevMon = iso(addDays(parseISO(weekMon), -7));
  const prevAllocMin = weekAllocTotalMin(state, res, prevMon);
  const prevDoneMin = weekDoneNewMin(state, prevMon);
  const showPrev = isThisWeek && prevAllocMin > 0;
  const ddays = deadlineDdays(res.itemStat, todayIso);
  const nearestDday = ddays.length ? ddays[0]!.dday : null;

  usePageChromeEffect(
    () => ({
      /* N-15 `primary` — 이 탭에서 먼저 읽어야 할 하나(예산을 얼마나 채웠나). 종전엔 리드아웃
         셋이 같은 30px 로 나란히 서서 "무엇을 먼저 보라"를 아무도 말하지 않았다.
         ⚠ 시그니처 비주얼(배분 보드 매트릭스)은 본문 한복판이라 상단 44px 과 읽는 순서가
           겹치지 않는다 — `stats` 회전 스파인과 같은 판단. */
      primary: weekBudgetMin ? { value: String(allocPct), unit: '%', label: '예산 달성' } : null,
      readouts: [
        {
          label: '이번 주 배분',
          value: (
            <>
              {hNum(weekAllocMin)}
              <small className="text-base14 font-bold text-mut"> / {hLabel(weekBudgetMin)}</small>
            </>
          ),
          accent: true,
        },
        /* ⚠ 옛 '예산 달성' 리드아웃은 **44px `primary` 로 승격**돼 여기서 사라졌다. 남겨 두면
           같은 수치가 한 화면에 두 번(그중 하나는 제일 크게) 뜨고, 그건 위계를 만드는 것이
           아니라 없애는 것이다 — 승격의 요점은 *하나를 크게*이지 *하나를 더*가 아니다.
           ⚠ 예산이 0이라 primary 를 못 세우는 경우에만 종전 자리로 되돌린다(그때는 위계를
           말할 대상 자체가 없다). */
        ...(weekBudgetMin ? [] : [{ label: '예산 달성', value: '—' }]),
        // D-day 라벨은 정본 헬퍼가 소유 — 직접 `D-${dday}`를 조립하면 오늘 마감이 "D-0"으로 샌다.
        { label: '마감', value: nearestDday == null ? '—' : ddayInfo(nearestDday).lab },
      ],
      action: !isThisWeek
        ? { label: '이번 주로 →', onClick: weekToday }
        : { label: '캘린더(.ics) 내보내기', onClick: () => io.exportICS() },
    }),
    [weekAllocMin, weekBudgetMin, allocPct, nearestDday, rel],
  );

  return (
    <section className={C.wrap} aria-label="주간 배분">
      <div className={C.nav}>
        <div className={C.wknav}>
          <Button sm className="whitespace-nowrap" onClick={prev}>
            ◀ 이전 주
          </Button>
          <div className={C.wk}>
            <b className={C.wkLab}>{weekLabel(curMon)}</b>
            <span className={C.wkOff}>{offsetLabel}</span>
          </div>
          <Button sm className="whitespace-nowrap" onClick={next}>
            다음 주 ▶
          </Button>
          <Button sm variant="ghost" className="whitespace-nowrap" onClick={weekToday}>
            오늘
          </Button>
        </div>
        {/* 지난주 대조 — **상단 크롬이 아니라 여기**다. 크롬은 primary(44px)+리드아웃 3+액션으로
            이미 폭을 다 써서 4번째를 얹으면 형제 라벨이 두 줄로 접힌다(실렌더로 확인). 그리고
            이 값의 집은 원래 여기가 맞다: 다음 주 숫자를 정하는 보드 **바로 위**에 있어야
            근거로 읽힌다(크롬에 있으면 그냥 또 하나의 지표다). */}
        {showPrev ? (
          <span className={C.prev} title="지난주 새 학습: 실제로 해낸 시간 / 배분했던 시간">
            지난주 <b className="font-extrabold text-txt">{hNum(prevDoneMin)}</b>
            <span className="text-mut"> / {hLabel(prevAllocMin)} 지킴</span>
          </span>
        ) : null}
      </div>

      <div className={C.body}>
        <AllocBoard
          weekMon={weekMon}
          res={res}
          capWd={capWd}
          todayIso={todayIso}
          // 셀/요일 클릭 → 캘린더 탭의 그날 일 뷰로 드릴다운(전략=보드 → 전술=타임박스).
          // 세그먼트가 갈렸으므로 날짜는 딥링크(?ds=)로, 뷰 전환은 **보내는 쪽에서 먼저** 한다
          // — 받는 쪽 effect에서 setState로 되받으면 캐스케이드 렌더가 된다(린트가 막는 패턴).
          onOpenDay={(dsPick) => {
            setSchedView('day');
            navigate(`/schedule?ds=${dsPick}`);
          }}
        />
      </div>
    </section>
  );
}
