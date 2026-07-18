/* ============================================================
   AllocBoard — 배치 세그먼트 '배분' 뷰(재개편 v2 §12-2). 계획의 중심.
   질문 "이번 주, 어느 과목을 어느 요일에 얼마씩?" — 과목(행) × 요일(열) 매트릭스.
   각 셀=그 과목·그 요일 배분(시간). 행 끝=배분/주당예산(✓/부족/초과). 열 아래=요일 배분/가용(초과 빨강).
   첫 편집 시 자동 파생 스냅샷을 managed로 승격(dayPlans 동형) → 배분 있는 주는 스케줄러가 그 벡터로 new 구동(§12-4).
   자동엔진은 복습/Anki/모의를 그 위에 자동으로 얹으므로 여기선 '새 학습(new)' 요일 분배만 사용자가 정한다.
   (React Compiler ON — 수동 메모 없이 파생 인라인.)
============================================================ */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/useApp';
import { ui } from '@/shell';
import { addDays, iso, parseISO, fmtShort, DOW_MON } from '@/lib/utils';
import {
  allocView,
  colSumMin,
  copyPrevWeekAlloc,
  isWeekManaged,
  resetWeekAlloc,
  rowSumMin,
  setAllocCell,
  zeroVec,
} from '@/lib/weekAlloc';
import { Button } from '@/components/ui';
import EmptyState from '@/components/EmptyState';
import type { ScheduleResult } from '@/lib/types';
import s from './AllocBoard.module.css';

/** 분 → 시간 표시(정수는 소수 없이, 반시간은 1자리). 셀·합계 공통. */
function toH(min: number): string {
  const h = min / 60;
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
}

/** 셀 채움 농도(0.16~0.5) — 배분 분량에 비례. 2.5h(150분)에서 포화.
 *  작은 배분도 즉시 보이게 하한 0.16에서 출발, 무거운 날은 진하게 → 주(週) 부하를 색농도로 읽는다. */
function fillAlpha(min: number): number {
  if (min <= 0) return 0;
  return Math.min(0.5, 0.16 + (min / 150) * 0.34);
}

export function AllocBoard({
  weekMon,
  res,
  capWd,
  todayIso,
  onOpenDay,
}: {
  weekMon: string; // 이 보드가 편집하는 주의 월요일(ISO)
  res: ScheduleResult;
  capWd: number[]; // 요일별 가용 학습분(index=wd 0=일..6=토)
  todayIso: string;
  onOpenDay: (ds: string) => void; // 셀/요일 클릭 → 그날 일 편집기 드릴다운
}) {
  const state = useApp((st) => st.state);
  const mutate = useApp((st) => st.mutate);
  const navigate = useNavigate();

  // 드래그 배분(§12-2 예산 칩) — 과목 행을 잡아 요일 칸에 놓으면 그날 +1h. 숫자 입력은 키보드 접근 경로로 병존(WCAG 2.1.1).
  const [dragSid, setDragSid] = useState<string | null>(null);
  const [overCell, setOverCell] = useState<string | null>(null); // `${sid}:${wd}`
  const DROP_STEP = 60; // 드롭 1회 = +1h

  const rows = state.items.filter((it) => it.name && it.mode !== 'daily'); // 배분 대상=주간(new) 과목
  const managed = isWeekManaged(state, weekMon);
  const alloc = allocView(state, res, weekMon); // managed면 명시값, 아니면 자동 파생 스냅샷

  const monday = parseISO(weekMon);
  // 열=월~일(Mon-first). 각 열의 실제 날짜·wd(getDay)·오늘 여부.
  const cols = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    const ds = iso(date);
    return { i, date, ds, wd: date.getDay(), label: DOW_MON[i]!, isToday: ds === todayIso };
  });

  const setCell = (sid: string, wd: number, hours: number) => {
    const mins = Math.max(0, Math.round(hours * 60));
    mutate((st) => setAllocCell(st, res, weekMon, sid, wd, mins));
  };
  const onCopyPrev = () => {
    mutate((st) => copyPrevWeekAlloc(st, res, weekMon));
    ui.toast('지난 주 배분을 이번 주로 복사했어요.', 'ok');
  };
  const onReset = () => {
    mutate((st) => resetWeekAlloc(st, weekMon));
    ui.toast('이번 주를 자동 배분으로 되돌렸어요.', 'info');
  };

  const hasSubjects = rows.length > 0;
  const hasCap = capWd.some((m) => m > 0);

  // 열(요일) 합 vs 가용 — 초과 경고용.
  const colMins = cols.map((c) => colSumMin(alloc, c.wd));

  if (!hasSubjects) {
    return (
      <div className={s.wrap}>
        <EmptyState
          glyph="🎛"
          title="배분할 과목이 없어요"
          desc={
            <>
              <b>주당 목표 시간</b>이 있는 과목을 추가하면, 여기서 그 시간을 요일에 배분할 수 있어요(월2·목1처럼).
            </>
          }
          actions={
            <Button sm variant="primary" onClick={() => navigate('/items')}>
              과목 추가하러 가기 →
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className={s.wrap}>
      {/* 툴바 — 모드 배지(+상태 안내) + 이전주복사/자동으로. 배분 합계는 상단 크롬 리드아웃이 소유(중복 제거). */}
      <div className={s.toolbar}>
        <span className={`${s.mode}${managed ? ' ' + s.modeManual : ''}`}>{managed ? '내 배분' : '자동 제안'}</span>
        <span className={s.toolHint}>
          {managed
            ? '내가 정한 배분으로 이번 주가 굴러가요.'
            : '엔진이 제안한 배분이에요 — 칸을 고치면 내 배분으로 바뀌어요.'}
        </span>
        <div className={s.toolBtns}>
          <Button sm variant="ghost" onClick={onCopyPrev} title="지난 주 배분을 이번 주로 복사">
            ⧉ 지난 주 복사
          </Button>
          {managed && (
            <Button sm variant="ghost" onClick={onReset} title="이번 주를 자동 배분으로 되돌리기">
              ↺ 자동으로
            </Button>
          )}
        </div>
      </div>

      {!hasCap && (
        <div className={s.note}>
          이번 주 <b>가용시간</b>이 0이에요 — 뼈대(일과)에서 수업·수면을 확인하면 배분 여력이 생겨요.
        </div>
      )}

      {/* 매트릭스 — 과목(행) × 요일(열) + 주당 예산 열 + 가용 푸터 행 */}
      <div className={s.scroll}>
        <div className={s.grid} role="grid" aria-label="주간 배분 보드">
          {/* 헤더 행 */}
          <div className={`${s.cell} ${s.corner}`} role="columnheader">
            과목 · 요일
          </div>
          {cols.map((c) => (
            <button
              key={c.i}
              type="button"
              className={`${s.cell} ${s.colHead}${c.isToday ? ' ' + s.todayCol : ''}`}
              onClick={() => onOpenDay(c.ds)}
              title={`${fmtShort(c.date)} 일 편집기 열기`}
              role="columnheader"
            >
              <span className={s.dow}>{c.label}</span>
              <span className={s.date}>{fmtShort(c.date)}</span>
            </button>
          ))}
          <div className={`${s.cell} ${s.budgetHead}`} role="columnheader">
            주당
          </div>

          {/* 과목 행들 */}
          {rows.map((it) => {
            const vec = alloc[it.id] || zeroVec();
            const rowMin = rowSumMin(vec);
            const budgetMin = Math.round((it.weeklyHours || 0) * 60);
            const diff = rowMin - budgetMin; // +초과 / -부족
            const eps = 5; // 5분 이내는 정확 일치로
            // 챕터를 다 끝낸 과목은 예산이 남아도 "남음" 경고 대신 "완료"(더 배분하라 조르지 않게).
            const finished = res.itemStat.find((st) => st.id === it.id)?.finished;
            const state_: 'done' | 'ok' | 'under' | 'over' | 'none' = finished
              ? 'done'
              : budgetMin <= 0
                ? 'none'
                : Math.abs(diff) <= eps
                  ? 'ok'
                  : diff < 0
                    ? 'under'
                    : 'over';
            const subColor = it.color || 'var(--acc)';
            return (
              <div
                key={it.id}
                className={s.rowContents}
                role="row"
                style={{ display: 'contents', ['--sub' as string]: subColor }}
              >
                <div
                  className={`${s.cell} ${s.rowHead}${dragSid === it.id ? ' ' + s.rowGrabbing : ''}`}
                  role="rowheader"
                  title={`${it.name} — 요일 칸으로 끌면 그날 +1h`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', it.id);
                    e.dataTransfer.effectAllowed = 'copy';
                    setDragSid(it.id);
                  }}
                  onDragEnd={() => {
                    setDragSid(null);
                    setOverCell(null);
                  }}
                >
                  <span className={s.grab} aria-hidden="true" />
                  <span className={s.swatch} style={{ background: subColor }} />
                  <span className={s.rowName}>{it.name}</span>
                </div>
                {cols.map((c) => {
                  const cellMin = vec[c.wd] || 0;
                  const cellKey = `${it.id}:${c.wd}`;
                  const dropOn = dragSid === it.id; // 잡은 과목 행에만 드롭 허용(과목→요일 의미 유지)
                  return (
                    <div
                      key={c.i}
                      className={`${s.cell} ${s.inputCell}${c.isToday ? ' ' + s.todayCol : ''}${overCell === cellKey ? ' ' + s.dropOver : ''}`}
                      role="gridcell"
                      onDragOver={(e) => {
                        if (!dropOn) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'copy';
                        setOverCell(cellKey);
                      }}
                      onDragLeave={() => setOverCell((o) => (o === cellKey ? null : o))}
                      onDrop={(e) => {
                        if (!dropOn) return;
                        e.preventDefault();
                        setCell(it.id, c.wd, (cellMin + DROP_STEP) / 60);
                        setOverCell(null);
                        setDragSid(null);
                      }}
                    >
                      {/* 비례 시각 채움 — 배분 분량에 따라 과목색 농도가 진해져 주(週) 부하가 한눈에 읽힌다. */}
                      {cellMin > 0 && (
                        <span className={s.fill} style={{ opacity: fillAlpha(cellMin) }} aria-hidden="true" />
                      )}
                      <input
                        type="number"
                        className={s.cellInput}
                        min={0}
                        step={0.5}
                        value={cellMin ? +toH(cellMin) : ''}
                        placeholder="·"
                        onChange={(e) => {
                          const v = e.target.value === '' ? 0 : parseFloat(e.target.value);
                          if (Number.isFinite(v)) setCell(it.id, c.wd, v);
                        }}
                        aria-label={`${it.name} ${c.label} 배분 시간`}
                        title={`${it.name} · ${c.label} — 시간 입력(0.5 단위)`}
                      />
                    </div>
                  );
                })}
                <div className={`${s.cell} ${s.budgetCell} ${s[state_]}`} role="gridcell">
                  <b>{toH(rowMin)}</b>
                  {budgetMin > 0 && <span className={s.budgetOf}> / {toH(budgetMin)}h</span>}
                  <span className={s.badge}>
                    {/* 챕터를 다 끝낸 과목은 중립 라벨(배분 충족 초록 ✓와 구분 — 오독 방지). */}
                    {state_ === 'done' && '챕터 완료'}
                    {state_ === 'ok' && '충족 ✓'}
                    {state_ === 'under' && `${toH(-diff)}h 남음`}
                    {state_ === 'over' && `+${toH(diff)}h`}
                  </span>
                </div>
              </div>
            );
          })}

          {/* 가용 푸터 행 */}
          <div className={`${s.cell} ${s.footHead}`} role="rowheader">
            가용
          </div>
          {cols.map((c, i) => {
            const cap = capWd[c.wd] || 0;
            const over = cap > 0 && colMins[i]! > cap + 5;
            return (
              <div
                key={c.i}
                className={`${s.cell} ${s.footCell}${over ? ' ' + s.footOver : ''}${c.isToday ? ' ' + s.todayCol : ''}`}
                role="gridcell"
                title={`${c.label} 배분 ${toH(colMins[i]!)}h / 가용 ${toH(cap)}h`}
              >
                <b>{toH(colMins[i]!)}</b>
                <span className={s.footCap}>/{toH(cap)}</span>
              </div>
            );
          })}
          <div className={`${s.cell} ${s.footEnd}`} aria-hidden="true" />
        </div>
      </div>

      <div className={s.hint}>
        과목 이름을 <b>요일 칸으로 끌면</b> 그날 +1h(숫자를 직접 넣어도 돼요). 배분한 요일엔 <b>새 학습(new)</b>이
        놓이고, 복습·Anki·모의는 엔진이 자동으로 얹어요. 요일 헤더를 누르면 그날을 <b>시간표까지</b> 짤 수 있어요.
      </div>
    </div>
  );
}
