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
  isUnschedulable,
  isWeekManaged,
  resetWeekAlloc,
  rowSumMin,
  setAllocCell,
  weeklyItems,
  zeroVec,
} from '@/lib/weekAlloc';
import { dayStudyMin } from '@/lib/scheduler';
import { Button, NumberField } from '@/components/ui';
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

  const rows = weeklyItems(state); // 배분 대상=주간(new) 과목. 술어는 weekAlloc이 단일 소유(복붙 필터 제거).
  const validSids = new Set(rows.map((it) => it.id)); // 삭제된 과목의 고아 배분이 열 합을 부풀리지 않게
  const managed = isWeekManaged(state, weekMon);
  const alloc = allocView(state, res, weekMon); // managed면 명시값, 아니면 자동 파생 스냅샷

  const monday = parseISO(weekMon);
  // 열=월~일(Mon-first). 각 열의 실제 날짜·wd(getDay)·오늘 여부.
  const cols = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    const ds = iso(date);
    const wd = date.getDay();
    // ⚠ 열 가용은 capWd(요일 기본값)가 아니라 **그 날짜의 실제 가용**이어야 한다.
    // capWd는 routine만 반영하지만 스케줄러는 dayStudyMin으로 dayOverrides와 그날 events까지 뺀다.
    // 예전엔 보드가 capWd를 그대로 써서, 수요일에 4시간 일정을 넣어도 "가용 6.0h"를 표시하고
    // 5h 배분에 초과 배지를 안 띄웠다 — 실제로는 layoutDay가 남는 분을 start:null(over)로 떨궈
    // 캘린더에서 조용히 사라진다. "한눈에 조망"이 정확히 틀리던 지점.
    return { i, date, ds, wd, label: DOW_MON[i]!, isToday: ds === todayIso, cap: dayStudyMin(state, ds, wd, capWd) };
  });

  const setCell = (sid: string, wd: number, hours: number) => {
    const mins = Math.max(0, Math.round(hours * 60));
    mutate((st) => setAllocCell(st, res, weekMon, sid, wd, mins));
  };
  // 복사 결과를 정직하게 — copyPrevWeekAlloc은 소스가 비면(계획 첫 주 등) **아무것도 쓰지 않고** 0을 준다.
  // 예전엔 그때도 성공 토스트를 띄워 "복사했어요"만 보이고 화면은 그대로인 무음 실패였다.
  const onCopyPrev = () => {
    let n = 0;
    mutate((st) => {
      n = copyPrevWeekAlloc(st, res, weekMon);
    });
    if (n > 0) ui.toast(`지난 주 배분 ${n}개 과목을 이번 주로 복사했어요.`, 'ok');
    else ui.toast('복사할 지난 주 배분이 없어요(계획 첫 주예요).', 'warn');
  };
  const onReset = () => {
    mutate((st) => resetWeekAlloc(st, weekMon));
    ui.toast('이번 주를 자동 배분으로 되돌렸어요.', 'info');
  };

  const hasSubjects = rows.length > 0;
  const hasCap = capWd.some((m) => m > 0);

  // 열(요일) 합 vs 가용 — 초과 경고용. validSids로 걸러 삭제된 과목의 고아 배분이
  // "보이는 행 합 1h인데 푸터는 4h" 유령을 만들지 않게 한다(표시 단계 방어선).
  const colMins = cols.map((c) => colSumMin(alloc, c.wd, validSids));

  // efficacy 안내 — 계획상 챕터를 다 배우게 된 과목(finished)에 배분해도 '새 학습' 블록은 더 안 생긴다
  // (엔진이 챕터 소진으로 판단 · 복습·Anki만 자동). 배분했는데 왜 안 굴러가는지 조용히 두지 않고 짚어준다.
  const inertFinished = rows.filter(
    (it) => res.itemStat.find((st) => st.id === it.id)?.finished && rowSumMin(alloc[it.id]) > 0,
  );

  // 같은 결의 두 번째 조용한 무효 — 주당 목표시간이 0/미입력인 과목은 엔진의 weeklyRaw 필터에서 빠져
  // 배분해도 new 블록이 0이다. 과목 카드의 '시간 없음 · 스케줄 안 됨'과 **같은 어휘**로 여기서도 짚는다.
  const noTime = rows.filter((it) => isUnschedulable(it));

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

      {noTime.length > 0 && (
        <div className={s.noteWarn}>
          <b>{noTime.map((it) => it.name).join(', ')}</b>은(는) <b>주당 목표 시간</b>이 없어 배분해도{' '}
          <b>시간 없음 · 스케줄 안 됨</b>이에요 — 과목에서 주당 시간을 넣어야 <b>새 학습</b>이 놓여요.
        </div>
      )}

      {inertFinished.length > 0 && (
        <div className={s.noteInfo}>
          완료 과목 <b>{inertFinished.map((it) => it.name).join(', ')}</b>에는 배분해도 계획상 챕터를 다 배우게 돼 있어{' '}
          <b>새 학습</b>은 안 생겨요 — 복습·Anki만 자동으로 얹혀요.
        </div>
      )}

      {/* 매트릭스 — 과목(행) × 요일(열) + 주당 예산 열 + 가용 푸터 행.
          role은 grid가 아니라 **table**이다. grid는 화살표 이동·단일 tab stop 같은 키보드 계약을 약속하는데
          이 보드는 셀마다 숫자 입력이 tab stop인 평범한 표라 그 계약을 이행하지 않는다 — SR 사용자는
          "표"라 안내받고 grid 탐색을 시도했다가 아무 반응도 얻지 못했다(Schedule의 tablist→group 판단과 동형).
          시맨틱 <table>로 내리지 않은 이유: 이 보드는 gap 1px 그리드선 + 스티키 프레임을 CSS grid로 얻는다.
          <table>에 display:grid를 걸면 브라우저가 표 시맨틱을 도로 벗겨(used display 기준 role 매핑)
          같은 거짓말이 된다. → role="table" + 정직한 row/columnheader/rowheader/cell.
          행 높이는 CSS의 `.cell{min-height:48px}`가 고정한다 — 과목 수와 무관하게 일정(신축 없음). */}
      <div className={s.scroll}>
        <div
          className={s.grid}
          role="table"
          aria-label="주간 배분 보드"
          aria-rowcount={rows.length + 2}
          aria-colcount={9}
        >
          {/* 헤더 행 */}
          <div className={s.rowContents} role="row">
            <div className={`${s.cell} ${s.corner}`} role="columnheader">
              과목 · 요일
            </div>
            {cols.map((c) => (
              // 요일 헤더는 '열머리글이자 일 편집기를 여는 버튼'이다. 예전엔 <button role="columnheader">로
              // 버튼 의미를 덮어써 SR엔 정적 머리글로만 읽혔다 → 머리글 래퍼(display:contents) 안에 버튼을 둔다.
              // 오늘 열은 색상 단독으로만 전달되던 걸 aria-current="date"로 보강.
              <div key={c.i} className={s.slot} role="columnheader" aria-current={c.isToday ? 'date' : undefined}>
                <button
                  type="button"
                  className={`${s.cell} ${s.colHead}${c.isToday ? ' ' + s.todayCol : ''}`}
                  onClick={() => onOpenDay(c.ds)}
                  title={`${fmtShort(c.date)} 일 편집기 열기`}
                >
                  <span className={s.dow}>{c.label}</span>
                  <span className={s.date}>{fmtShort(c.date)}</span>
                </button>
              </div>
            ))}
            <div className={`${s.cell} ${s.budgetHead}`} role="columnheader">
              주당
            </div>
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
              <div key={it.id} className={s.rowContents} role="row" style={{ ['--sub' as string]: subColor }}>
                {/* 린트가 draggable 을 상호작용 신호로 읽어 'rowheader 는 포커스 가능해야'라고
                    하지만, 이 행 머리글은 조작 대상이 아니다 — 드래그는 순수 마우스 편의 레이어이고
                    접근성 정본은 셀의 NumberField(step 0.5 · aria-label "과목 · 요일 배분(시간)")라
                    ↑↓·타이핑으로 동일하게 달성된다(결정로그: "드래그 배분은 순수 편의 레이어").
                    tabIndex 를 주면 조작할 수 없는 탭 스톱만 과목 수만큼 늘어난다. */}
                {/* eslint-disable-next-line jsx-a11y/interactive-supports-focus */}
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
                      className={`${s.cell} ${s.inputCell}${cellMin > 0 ? ' ' + s.hasVal : ''}${c.isToday ? ' ' + s.todayCol : ''}${overCell === cellKey ? ' ' + s.dropOver : ''}`}
                      role="cell"
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
                      {/* NumberField — 미완 입력(빈값·"1.")을 커밋하지 않는다. 예전엔 1.5를 치는 도중
                          '.' 시점의 빈값이 0으로 확정됐고, 그 0이 setAllocCell→ensureWeekAlloc을 타고
                          이 주를 managed로 승격시켜 자동 제안을 영구 대체했다(그리고 최종값도 5h가 됐다). */}
                      <NumberField
                        className={s.cellInput}
                        min={0}
                        step={0.5}
                        value={cellMin ? +toH(cellMin) : 0}
                        emptyValue={0} // 칸을 비우는 건 "이 요일엔 배분 안 함"이라는 뜻
                        // 0 셀은 '·'로 채우지 않는다 — 전 칸에 깔린 점이 소음이 돼 "읽을 것 없는 표"로 보였다.
                        // 빈 칸은 비어 보이고(바탕 틴트 없음 · 캘린더 v5 사상), 값 있는 칸만 채움+색띠로 주인공이 된다.
                        placeholder=""
                        onCommit={(v) => setCell(it.id, c.wd, v)}
                        aria-label={`${it.name} · ${c.label}요일 배분(시간)`}
                        title={`${it.name} · ${c.label} — 시간 입력(0.5 단위)`}
                      />
                    </div>
                  );
                })}
                <div className={`${s.cell} ${s.budgetCell} ${s[state_]}`} role="cell">
                  <b>{toH(rowMin)}</b>
                  {budgetMin > 0 && <span className={s.budgetOf}> / {toH(budgetMin)}h</span>}
                  <span className={s.badge}>
                    {/* 챕터를 다 끝낸 과목은 중립 라벨(배분 충족 초록 ✓와 구분 — 오독 방지). */}
                    {state_ === 'done' && '챕터 완료'}
                    {state_ === 'ok' && '충족 ✓'}
                    {state_ === 'under' && `${toH(-diff)}h 남음`}
                    {state_ === 'over' && `+${toH(diff)}h`}
                    {/* 주당 시간이 없는 과목 — 배분해도 엔진이 0블록. 과목 카드와 같은 문구. */}
                    {state_ === 'none' && '시간 없음'}
                  </span>
                </div>
              </div>
            );
          })}

          {/* 가용 푸터 행 — 헤더 행과 마찬가지로 role="row" 래퍼 안에 둔다(예전엔 셀이 표 직속이라 행 구조가 깨졌다). */}
          <div className={s.rowContents} role="row">
            <div className={`${s.cell} ${s.footHead}`} role="rowheader">
              가용
            </div>
            {cols.map((c, i) => {
              const cap = c.cap; // 그 날짜의 실제 가용(일정·override 반영) — capWd 요일 기본값이 아님
              const over = cap > 0 && colMins[i]! > cap + 5;
              return (
                <div
                  key={c.i}
                  className={`${s.cell} ${s.footCell}${over ? ' ' + s.footOver : ''}${c.isToday ? ' ' + s.todayCol : ''}`}
                  role="cell"
                  title={`${c.label} 배분 ${toH(colMins[i]!)}h / 가용 ${toH(cap)}h`}
                >
                  <b>{toH(colMins[i]!)}</b>
                  <span className={s.footCap}>/{toH(cap)}</span>
                </div>
              );
            })}
            {/* 마지막 칸은 빈 자리(예산 열 아래) — 열 수를 맞춰야 행 구조가 정합하므로 aria-hidden 대신 빈 셀. */}
            <div className={`${s.cell} ${s.footEnd}`} role="cell" />
          </div>
        </div>
      </div>

      <div className={s.hint}>
        과목 이름을 <b>요일 칸으로 끌면</b> 그날 +1h(숫자를 직접 넣어도 돼요). 배분한 요일엔 <b>새 학습(new)</b>이
        놓이고, 복습·Anki·모의는 엔진이 자동으로 얹어요. 요일 헤더를 누르면 그날을 <b>시간표까지</b> 짤 수 있어요.
      </div>
    </div>
  );
}
