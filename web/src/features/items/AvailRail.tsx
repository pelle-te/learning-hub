/* ============================================================
   AvailRail — 과목 탭 우측 상시 레일: "이 요일에 몇 시간 쓸 수 있나".
   옛 routine 탭의 우측 시그니처 컬럼(24h 발광 링 + 요일 막대)을 승계하되, 계획 재개편 v3에서
   한 겹을 더 얹었다 — 요일 막대가 **가용(용량)** 위에 **이번 주 배분(적재)** 를 겹쳐 그린다.
   과목 상세 시트에서 요일 칸을 채울 때 "그 요일이 이미 꽉 찼는지"를 여기서 바로 읽으라는 뜻
   (배분 보드의 '열 합계' 맥락을 과목 탭에도 최소한으로 이식 — 보드는 schedule 탭에 그대로 있다).
   배분 수치는 lib/weekAlloc의 allocView/colSumMin 단일 출처 → 보드와 자동 동기(미러, 별도 상태 없음).
============================================================ */
import { useState } from 'react';
import { useApp } from '@/store/useApp';
import { useNowMin } from '@/hooks/interactions';
import { useSchedule, useStudyMinByWeekday } from '@/store/selectors';
import { freeWindowsForWeekday, blocksForWeekday, peakRange } from '@/lib/scheduler';
import { allocView, colSumMin, weekMonOf } from '@/lib/weekAlloc';
import { DOW, parseISO, todayISO } from '@/lib/utils';
import DayRing from './DayRing';
import ds from '@/styles/ds.module.css';
import r from './Skeleton.module.css';

export function AvailRail() {
  const state = useApp((s) => s.state);
  const res = useSchedule();
  const capWd = useStudyMinByWeekday(); // 요일별 학습 가능 분(요일 기본값). 이 레일은 '요일' 단위 뷰라
  // 날짜별 차감(일정·override)은 의도적으로 반영하지 않는다 — 배분 보드 열은 날짜 단위라 값이 다를 수 있다.
  // 오늘 요일은 앱 정본 '오늘'(_today 시드 존중)에서 파생 — 벽시계 new Date() 대신.
  const todayDow = parseISO(todayISO(state)).getDay(); // 일=0..토=6
  // '지금' 마커가 로드 시각에 얼어붙지 않도록 분 단위 갱신(+ 백그라운드 복귀 즉시 캐치업).
  const nowMin = useNowMin();
  const [ringDow, setRingDow] = useState(todayDow); // 24h 링이 보여주는 요일

  // 요일별 가용 창(링 + 주간 막대 공용). 순수 파생 — freeWindowsForWeekday 단일 출처.
  const free = DOW.map((_, i) => freeWindowsForWeekday(state, i));
  const fw = free[ringDow]!;
  const ringBlocks = blocksForWeekday(state, ringDow);
  const peak = peakRange(state); // 고집중 작업이 우선 배치되는 피크 시간대(미설정이면 null)
  const weekFreeMin = free.reduce((t, f) => t + f.freeMin, 0);

  // 이번 주 배분(과목×요일) — 보드와 같은 뷰. managed면 명시값, 아니면 자동 파생 스냅샷.
  const wk = weekMonOf(todayISO(state));
  const alloc = allocView(state, res, wk);
  // 고아 방어 — 삭제된 과목의 잔여 배분이 요일 적재율·초과 경고를 부풀리지 않게 유효 sid만 센다
  // (정상 경로 청소는 삭제 시 removeSidFromAlloc가 하고, 이건 오염된 저장본에 대한 표시 단계 방어선).
  const validSids = new Set(state.items.map((it) => it.id));
  const allocWd = DOW.map((_, i) => colSumMin(alloc, i, validSids));
  const allocWeekMin = allocWd.reduce((t, m) => t + m, 0);

  // 가용 vs 목표 — 주당 목표(주간시간 + 매일과목×7)를 합쳐 가용시간이 담을 수 있는지 짚어준다.
  const requiredH = state.items.reduce((t, it) => {
    if (!it.name) return t;
    return t + (it.mode === 'daily' ? ((it.dailyMin || 0) * 7) / 60 : it.weeklyHours || 0);
  }, 0);
  const availH = weekFreeMin / 60;
  const shortfall = requiredH > 0 && availH < requiredH;

  return (
    <aside className={r.sigCol} aria-label="가용시간">
      <div className={`${ds.card} ${r.sigCard}`}>
        <div className={r.sigColHead}>
          가용시간 — AVAILABILITY
          <span className={r.sigDow}>{DOW[ringDow]}요일</span>
        </div>
        <DayRing
          dow={DOW[ringDow]!}
          blocks={ringBlocks}
          windows={fw.windows}
          wake0={fw.wake0}
          wake1={fw.wake1}
          freeMin={fw.freeMin}
          nowMin={ringDow === todayDow ? nowMin : null}
          peak={peak}
        />
        <span className={r.sigLegend}>
          <span>
            <i className={r.lgFree} />
            공부 가능
          </span>
          <span>
            <i className={r.lgBlock} />
            일과
          </span>
          <span>
            <i className={r.lgSleep} />
            수면
          </span>
        </span>
        {/* tablist 계약(화살표 이동·tabpanel) 미이행 → group+aria-pressed가 정직(WCAG 4.1.2). */}
        <div className={r.wkbars} role="group" aria-label="요일 선택" style={{ width: '100%' }}>
          {DOW.map((d, i) => {
            const hrs = free[i]!.freeMin / 60;
            const max = Math.max(1, ...free.map((f) => f.freeMin / 60));
            // 배분 적재율 — 그 요일 상한(capWd)이 있으면 그것 대비, 없으면 가용 대비.
            const capMin = capWd[i] || free[i]!.freeMin;
            const usedMin = allocWd[i] || 0;
            const over = capMin > 0 && usedMin > capMin;
            const loadPct = capMin > 0 ? Math.min(100, Math.round((usedMin / capMin) * 100)) : 0;
            return (
              <button
                key={d}
                type="button"
                aria-pressed={i === ringDow}
                className={`${r.wb}${i === ringDow ? ' ' + r.wbOn : ''}${i === todayDow ? ' ' + r.wbToday : ''}`}
                onClick={() => setRingDow(i)}
                title={`${d}요일 — 가용 ${hrs.toFixed(1)}h · 배분 ${(usedMin / 60).toFixed(1)}h${over ? ' (초과)' : ''}`}
              >
                <span className={r.wbBarWrap}>
                  <span className={r.wbBar} style={{ height: `${Math.round((hrs / max) * 100)}%` }}>
                    {/* 배분 적재 — 가용 막대 안을 아래에서 채운다. 초과면 경고색. */}
                    <span
                      className={`${r.wbLoad}${over ? ' ' + r.wbLoadOver : ''}`}
                      style={{ height: `${loadPct}%` }}
                    />
                  </span>
                </span>
                <span className={r.h}>{hrs.toFixed(1)}</span>
                <span className={r.d}>{d}</span>
              </button>
            );
          })}
        </div>
        <div className={r.allocSum}>
          이번 주 배분 <b>{(allocWeekMin / 60).toFixed(1)}h</b> / 가용 <b>{availH.toFixed(1)}h</b>
        </div>
      </div>
      {requiredH > 0 && (
        <div className={r.sigHint} style={shortfall ? { color: 'var(--warn)' } : undefined}>
          주간 가용 <b>{availH.toFixed(1)}h</b> {shortfall ? '<' : '≥'} 학습 목표 <b>{requiredH.toFixed(1)}h</b>
          {shortfall
            ? ' — 가용시간이 목표에 못 미쳐요. 일과를 줄이거나 학습 항목의 목표를 조정하세요.'
            : ' — 목표를 담을 여유가 있어요.'}
        </div>
      )}
      <div className={r.sigHint}>
        깨어있는 시간에서 고정 일과를 빼면 남는 게 공부 가능 시간 — 스케줄러가 이 빈 시간에 블록을 배분합니다. 요일별
        배분을 과목별로 손보려면 <b>배치</b> 탭의 배분 보드에서 한눈에.
      </div>
    </aside>
  );
}
