/* ============================================================
   Alloc — 계획 › '배분' 세그먼트. 옛 배치 탭의 alloc 뷰를 독립 탭으로 승격(계획 재개편 v4).
   질문 "이번 주, 어느 과목을 어느 요일에 얼마씩?" — 캘린더(언제 할까)와 리듬이 다르다:
   배분은 주(週) 단위로 한 번 정하는 '전략', 캘린더는 매일 보는 '전술'. 뷰 스위치 안에 섞여 있으면
   계획의 축이 흐려져 세그먼트로 분리했다([캘린더 · 배분 · 과목] 순).

   보드 자체(과목행×요일열 매트릭스)는 AllocBoard가 소유 — 여긴 주 네비·리드아웃·드릴다운 배선만.
   ⚠ features → features import 금지(boundaries)라 AllocBoard가 schedule/에서 여기로 물리 이주했다.
============================================================ */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/useApp';
import { useUI } from '@/store/useUI';
import { useSchedule, useStudyMinByWeekday } from '@/store/selectors';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { io } from '@/shell';
import { iso, mondayOf, parseISO, addDays, dayDiff, weekLabel, todayISO } from '@/lib/utils';
import { allocView, rowSumMin } from '@/lib/weekAlloc';
import { deadlineDdays } from '@/lib/scheduleView';
import { Button } from '@/components/ui';
import { useWeekNavKeys } from '@/hooks/interactions';
import { AllocBoard } from './AllocBoard';
import c from './Alloc.module.css';

export default function Alloc() {
  const state = useApp((s) => s.state);
  const res = useSchedule();
  const capWd = useStudyMinByWeekday();
  const navigate = useNavigate();
  const setSchedView = useUI((s) => s.setSchedView);
  const todayIso = todayISO(state); // 앱의 '오늘' 단일 출처(_today 시드 존중)

  // '오늘'이 속한 주의 오프셋(시작 주 기준) — 초기 주·'이번 주' 배지·'이번 주로'의 공통 기준.
  const todayOff = Math.round(dayDiff(iso(mondayOf(parseISO(state.startDate))), iso(mondayOf(parseISO(todayIso)))) / 7);
  const [weekOffset, setWeekOffset] = useState(todayOff);
  // , / . — 이전/다음 주(버튼과 동일 동작, 캘린더·리뷰 탭과 같은 키).
  useWeekNavKeys(
    () => setWeekOffset((o) => o - 1),
    () => setWeekOffset((o) => o + 1),
  );

  const curMon = addDays(mondayOf(parseISO(state.startDate)), weekOffset * 7);
  const weekMon = iso(curMon);

  const allocMap = allocView(state, res, weekMon);
  const weekAllocMin = state.items.reduce(
    (t, it) => (it.name && it.mode !== 'daily' ? t + rowSumMin(allocMap[it.id]) : t),
    0,
  );
  // 주당 예산 합(주간 과목 weeklyHours) — 배분이 채워가는 목표. '가용 총량'(수십 h)보다 배분과 직접 관계돼 리드아웃에 적합.
  const weekBudgetMin = state.items.reduce(
    (t, it) => (it.name && it.mode !== 'daily' ? t + Math.round((it.weeklyHours || 0) * 60) : t),
    0,
  );
  const allocPct = weekBudgetMin > 0 ? Math.round((weekAllocMin / weekBudgetMin) * 100) : 0;
  const ddays = deadlineDdays(res.itemStat, todayIso);
  const nearestDday = ddays.length ? ddays[0]!.dday : null;

  const weekToday = () => setWeekOffset(todayOff);

  usePageChromeEffect(
    () => ({
      readouts: [
        {
          label: '이번 주 배분',
          value: (
            <>
              {(weekAllocMin / 60).toFixed(1)}
              <small> / {(weekBudgetMin / 60).toFixed(1)}h</small>
            </>
          ),
          accent: true,
        },
        { label: '예산 달성', value: weekBudgetMin ? `${allocPct}%` : '—' },
        { label: '마감', value: nearestDday == null ? '—' : `D-${nearestDday}` },
      ],
      action:
        weekOffset !== todayOff
          ? { label: '이번 주로 →', onClick: weekToday }
          : { label: '캘린더(.ics) 내보내기', onClick: () => io.exportICS() },
    }),
    [weekAllocMin, weekBudgetMin, allocPct, nearestDday, weekOffset, todayOff],
  );

  return (
    <section className={c.wrap} aria-label="주간 배분">
      <div className={c.nav}>
        <div className={c.wknav}>
          <Button sm onClick={() => setWeekOffset((o) => o - 1)}>
            ◀ 이전 주
          </Button>
          <div className={c.wk}>
            <b className={c.wkLab}>{weekLabel(curMon)}</b>
            <span className={c.wkOff}>
              {weekOffset === todayOff
                ? '이번 주'
                : weekOffset > todayOff
                  ? `+${weekOffset - todayOff}주`
                  : `${weekOffset - todayOff}주`}
            </span>
          </div>
          <Button sm onClick={() => setWeekOffset((o) => o + 1)}>
            다음 주 ▶
          </Button>
          <Button sm variant="ghost" onClick={weekToday}>
            오늘
          </Button>
        </div>
      </div>

      <div className={c.body}>
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
