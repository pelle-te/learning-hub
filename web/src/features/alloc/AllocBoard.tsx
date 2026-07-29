/* ============================================================
   AllocBoard — 배치 세그먼트 '배분' 뷰(재개편 v2 §12-2). 계획의 중심.
   질문 "이번 주, 어느 과목을 어느 요일에 얼마씩?" — 과목(행) × 요일(열) 매트릭스.
   각 셀=그 과목·그 요일 배분(시간). 행 끝=배분/주당예산(✓/부족/초과). 열 아래=요일 배분/가용(초과 빨강).
   첫 편집 시 자동 파생 스냅샷을 managed로 승격(dayPlans 동형) → 배분 있는 주는 스케줄러가 그 벡터로 new 구동(§12-4).
   자동엔진은 복습/Anki/모의를 그 위에 자동으로 얹으므로 여기선 '새 학습(new)' 요일 분배만 사용자가 정한다.
   (React Compiler ON — 수동 메모 없이 파생 인라인.)
============================================================ */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/useApp';
import { ui } from '@/shell';
import { addDays, iso, parseISO, fmtShort, DOW_MON, hNum } from '@/lib/utils';
import {
  allocView,
  changedAllocCells,
  colSumMin,
  copyPrevWeekAlloc,
  isUnschedulable,
  isWeekManaged,
  neglectDaysBySid,
  NEGLECT_DAYS,
  resetWeekAlloc,
  rowSumMin,
  setAllocCell,
  weeklyItems,
  zeroVec,
} from '@/lib/weekAlloc';
import { dayStudyMin } from '@/lib/scheduler';
import { commit } from '@/lib/motion';
import { Button, NumberField } from '@/components/ui';
import EmptyState from '@/components/EmptyState';
import type { ScheduleResult } from '@/lib/types';

/* ── AllocBoard — CSS Module → Tailwind 유틸 이식(C-7) ────────────────────────────
   1px 그리드선은 grid gap + 배경(cell=panel/panel2, gap=line)으로 그린다. 셀은 role 정직한 표.
   ⚠ 이 앱은 preflight 를 빼서, **내장 크기 이름**(text-sm/lg/xs)은 companion line-height 를 흘려
     상속 LH 를 덮는다 → 정상흐름 요소엔 leading-[1.6](또는 소스 명시값 1.55)을 못박는다.
     **폼 컨트롤(<button>·<input>)의 자손 텍스트**는 UA line-height:normal 을 상속하므로 leading-[normal].
     커스텀 브리지 크기(text-2xs/md/base14)는 LH 를 안 흘리므로 leading 불필요.
   ⚠ 전역 요소규칙(button/input)은 언레이어라 레이어드 유틸을 이긴다 → 다른 값만 `!`(같으면 클래스 없음).
     colHead <button> 의 로컬 :hover 는 전역 button:hover(더 높은 명시도)에 이미 가려져 있었다 →
     되살리지 않는다(전역이 이기게 둔다 · §15). 규약 SSOT 는 §15 + tokenBridge.css 머리주석. */
const CELL = 'flex min-h-12 items-center px-2.25 py-1.75';
const S = {
  wrap: 'flex h-full min-h-0 flex-col gap-3 px-5.5 pt-3.5 pb-3 max-wide:px-3.5 max-wide:py-3',
  toolbar: 'flex flex-none flex-wrap items-center gap-3',
  // 모드 배지 — 공통 골격 + 상태별 톤 맵(자동/내 배분 · §15 정적 맵). 자간 0.08em 은 tracking-mode.
  mode: 'rounded-full border px-2.5 py-0.75 text-xs leading-[1.6] font-extrabold tracking-mode',
  modeAuto: 'border-line bg-alloc-mode-bg text-mut',
  modeManual: 'border-line-acc-hover bg-acc-glow text-acc',
  toolHint: 'min-w-0 truncate text-sm leading-[1.6] text-mut',
  toolBtns: 'ml-auto flex gap-2',
  scroll: 'min-h-0 flex-initial overflow-auto [scrollbar-width:thin]',
  grid: 'grid min-w-140 grid-cols-alloc gap-px rounded-base border border-line bg-line',
  // 네 모서리 셀 라운딩(overflow:hidden 대체) + 스티키 프레임.
  corner: `${CELL} sticky top-0 left-0 z-[5] rounded-tl-base bg-panel2 text-2xs font-extrabold tracking-widest text-mut uppercase`,
  // 요일 열머리글 <button> — 전역 button 패딩(8/13)을 .cell(7/9)로 이겨야 해 px/py 에 `!`.
  colHead: 'flex min-h-12 flex-col items-center justify-center gap-px px-2.25! py-1.75! text-center',
  colToday: 'bg-alloc-col-today!',
  dow: 'text-sm leading-[normal] font-extrabold text-txt', // <button> 자손 → UA normal 상속
  date: 'text-2xs font-semibold text-mut', // 커스텀 크기 → LH 안 흘림(leading 불필요)
  /* ⚠ 오늘 열에서는 **묵음색을 쓰지 않는다**(H22 · 2026-07-26). 열 배경이 `--alloc-col-today`
     로 밝아져 `--mut` 과의 대비가 4.13:1 로 내려간다(10px 본문 → 4.5:1 요구 · axe serious).
     오늘 열은 강조 대상이므로 본문색이 의미상으로도 맞다. a11y 로스터를 `TABS` 밖 화면까지
     넓히자마자 이 화면이 처음 검사됐고, 그 첫 실행에서 잡혔다. */
  dateToday: 'text-2xs font-semibold text-txt',
  budgetHead: `${CELL} sticky top-0 right-0 z-[5] justify-end rounded-tr-base bg-panel2 text-2xs font-extrabold tracking-widest text-mut uppercase`,
  // 과목 행 머리글(드래그 소스) — group 으로 grab 도트 hover 를 자식에 전달. bg 는 그랩 상태로 분기.
  rowHead: `${CELL} group sticky left-0 z-[3] min-w-0 cursor-grab gap-1.75 text-md font-bold text-txt active:cursor-grabbing`,
  grab: 'h-3 w-2 flex-none rounded-xs bg-[image:var(--grab-dots)] opacity-50 group-hover:opacity-90',
  swatch: 'size-2.25 flex-none rounded-cell',
  rowName: 'min-w-0 truncate',
  // 입력 셀 — 비례 채움(.fill) + 색띠(before) + 빈칸 호버 '+'(after) + 드롭 오버(after '+1h').
  inputCell: 'relative flex min-h-12 items-center overflow-hidden p-0 text-md',
  // UX-A3: 드롭/타이핑으로 값이 바뀔 때 농도가 "툭" 갈리지 않게. 전역 reduced-motion 백스톱이 닿는다.
  fill: 'absolute inset-0 bg-[var(--sub,var(--acc))] transition-opacity duration-200', // opacity 는 런타임 인라인
  before:
    "before:pointer-events-none before:absolute before:top-0 before:bottom-0 before:left-0 before:z-[1] before:w-0.75 before:bg-[var(--sub,var(--acc))] before:content-['']",
  hoverPlus:
    "hover:after:pointer-events-none hover:after:absolute hover:after:inset-0 hover:after:flex hover:after:items-center hover:after:justify-center hover:after:text-md hover:after:font-bold hover:after:text-alloc-plus hover:after:content-['+']",
  dropOver:
    "outline-2 -outline-offset-2 outline-dashed outline-acc after:pointer-events-none after:absolute after:inset-0 after:z-[2] after:flex after:items-center after:justify-center after:bg-acc-glow after:text-xs after:leading-[1.6] after:font-extrabold after:text-acc after:content-['+1h']",
  // UX-A2 드롭 가능 프리뷰 — 잡은 과목 행의 놓을 수 있는 칸을 드래그 **시작 시점에** 옅게 예고한다.
  // dropOver(2px 실선급 점선 + '+1h')의 한 단 아래 버전 — 같은 시각 언어라 "여기 놓을 수 있다"가
  // 한 어휘로 읽힌다. ⚠ 정적이다(애니 아님) → reduced-motion·React Compiler 어느 쪽과도 무관.
  dragHint: 'outline-1 -outline-offset-1 outline-dashed outline-line-acc-hover',
  // UX-A4 스윕 — 툴바 액션이 **실제로 바꾼** 칸만 1회 훑는다. 지연은 인라인 animation-delay.
  sweep: 'animate-[alloc-sweep_0.62s_var(--ease)_both]',
  // UX-A1 가장자리 비례 막대 — 셀의 .fill 관용구를 '결론' 칸(주당 예산 · 요일 가용)에 재사용.
  edgeBar: 'pointer-events-none absolute inset-y-0 left-0',
  // NumberField <input type=number> — 전역 input 규칙(언레이어)을 이기려 다른 값만 `!`.
  // color/font-size(13)/width 는 전역과 동일 → 클래스 없음. ink≡txt.
  cellInput:
    'relative z-[1] h-full min-h-12 cursor-text border-0! bg-transparent! px-1! py-0! text-center font-bold tabular-nums placeholder:font-normal placeholder:text-alloc-ph! focus:-outline-offset-2! focus:bg-acc-glow! focus:outline-2 focus:outline-acc',
  // ⚠ overflow-hidden + 자식 relative z-[1] 은 UX-A1 막대 때문이다 — 막대는 절대배치라
  //   비배치 형제(숫자·배지)보다 **위에** 칠해진다. 숫자를 배치요소로 올려야 막대가 배경이 된다.
  budgetCell: `${CELL} sticky right-0 z-[3] flex-col items-end justify-center gap-px overflow-hidden text-right text-md`,
  budgetB: 'relative z-[1] text-base14 font-extrabold text-txt tabular-nums',
  budgetOf: 'relative z-[1] text-xs leading-[1.6] font-semibold text-mut',
  badge: 'relative z-[1] text-2xs',
  // ID-7 방치 배지 — 행 이름 뒤 우측 정렬 warn 핀. 예산 배지(우측 셀)와 위계·위치가 달라 오독 없다.
  neglect:
    'ml-auto flex-none rounded-full bg-tint-warn px-1.5 py-0.5 text-2xs font-bold whitespace-nowrap text-warn tabular-nums',
  footHead: `${CELL} sticky left-0 z-[3] rounded-bl-base bg-panel2 text-2xs font-extrabold tracking-widest text-mut uppercase`,
  footCell: `${CELL} relative justify-center gap-0.75 overflow-hidden text-sm leading-[1.6] text-mut`,
  footNum: 'relative z-[1] font-extrabold tabular-nums',
  footCap: 'relative z-[1] font-semibold text-mut',
  footEnd: `${CELL} sticky right-0 z-[3] rounded-br-base bg-panel2`,
  hint: 'flex-none text-sm leading-[1.55] text-mut',
  hintB: 'font-bold text-txt',
} as const;

// 예산 셀 톤 — 상태별 정적 맵(§15 · 동적 조립 금지). 셀 배경/불투명 + 배지 색/굵기를 각각 분리.
const BUDGET_BG: Record<'done' | 'ok' | 'under' | 'over' | 'none', string> = {
  done: 'bg-panel2 opacity-60',
  ok: 'bg-panel2',
  under: 'bg-panel2',
  over: 'bg-alloc-over',
  none: 'bg-panel2',
};
const BADGE_TONE: Record<'done' | 'ok' | 'under' | 'over' | 'none', string> = {
  done: 'font-bold text-mut', // 완료: 중립(초록 ✓ 오독 방지) · 700
  ok: 'font-extrabold text-good',
  under: 'font-extrabold text-warn',
  over: 'font-extrabold text-bad',
  none: 'font-extrabold',
};

/** 셀 채움 농도(0.16~0.5) — 배분 분량에 비례. 2.5h(150분)에서 포화.
 *  작은 배분도 즉시 보이게 하한 0.16에서 출발, 무거운 날은 진하게 → 주(週) 부하를 색농도로 읽는다. */
function fillAlpha(min: number): number {
  if (min <= 0) return 0;
  return Math.min(0.5, 0.16 + (min / 150) * 0.34);
}

/** 가장자리 막대 농도(UX-A1) — 셀 채움(0.16~0.5)보다 **낮게** 고정한다.
 *  가장자리는 데이터가 아니라 *결론*(합계 대비 예산·가용)이다. 셀보다 진하면 시선이 표 테두리로
 *  끌려가 "어느 칸이 무거운가"라는 본래 질문이 뒤로 밀린다 — 위계 유지가 이 상수의 존재 이유다. */
const EDGE_ALPHA = 0.2;
/** 스윕 stagger(UX-A4) — 칸당 지연·지연 상한·다 훑은 뒤 머무는 시간(ms).
 *  상한이 필요한 이유: 복사는 과목×요일이라 칸이 수십 개가 될 수 있고, 캡이 없으면 꼬리가
 *  몇 초씩 늘어져 "아직 뭔가 돌고 있다"로 읽힌다. */
const SWEEP_STEP_MS = 45;
const SWEEP_MAX_DELAY_MS = 540;
const SWEEP_HOLD_MS = 900;

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

  // UX-A4 스윕 — `${sid}:${wd}` → animation-delay(ms). null 이면 아무 칸도 안 훑는 중.
  const [sweep, setSweep] = useState<Record<string, number> | null>(null);
  const sweepFx = useRef<{ t: number | null; raf: number | null }>({ t: null, raf: null });
  useEffect(() => {
    const fx = sweepFx.current;
    return () => {
      if (fx.t != null) clearTimeout(fx.t);
      if (fx.raf != null) cancelAnimationFrame(fx.raf);
    };
  }, []);

  const rows = weeklyItems(state); // 배분 대상=주간(new) 과목. 술어는 weekAlloc이 단일 소유(복붙 필터 제거).
  const validSids = new Set(rows.map((it) => it.id)); // 삭제된 과목의 고아 배분이 열 합을 부풀리지 않게
  const managed = isWeekManaged(state, weekMon);
  const alloc = allocView(state, res, weekMon); // managed면 명시값, 아니면 자동 파생 스냅샷
  // ID-7 방치 신호 — 과목별 마지막 손 댄 뒤 경과일(예산 상태와 직교한 최근성).
  const neglect = neglectDaysBySid(state, todayIso);

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
  /** 툴바 액션이 **실제로 바꾼** 칸을 훑는다(UX-A4). `before` = 액션 직전의 배분 스냅샷.
   *  ⚠ 왜 로드맵이 적은 "copyPrevWeekAlloc 반환 확장"이 아니라 전후 diff 인가:
   *    ① 그 시그니처만 넓히면 '자동으로'(resetWeekAlloc)는 여전히 결과가 안 보인다 — 로드맵이
   *       지적한 "결과가 곳곳에 흩어지는데 토스트만"은 **두 버튼 공통** 증상이다.
   *    ② diff 는 weekAlloc.ts 계약을 안 건드린다(로드맵이 R2 로 표시한 유일한 리스크가 사라진다).
   *    ③ 복사는 '과목 단위'로 쓰는데 시각 단위는 '칸'이라, 어차피 lib 안에서 칸 단위로 되짚어야 했다.
   *  immer 는 구조 공유라 mutate 뒤에도 `before` 참조는 옛 값을 그대로 들고 있다(스냅샷이 성립). */
  const sweepChanged = (before: Record<string, number[]>) => {
    const after = allocView(useApp.getState().state, res, weekMon);
    const keys = changedAllocCells(
      before,
      after,
      rows.map((it) => it.id),
    );
    const delays: Record<string, number> = {};
    keys.forEach((k, i) => (delays[k] = Math.min(i * SWEEP_STEP_MS, SWEEP_MAX_DELAY_MS)));
    const fx = sweepFx.current;
    if (fx.t != null) clearTimeout(fx.t);
    if (fx.raf != null) cancelAnimationFrame(fx.raf);
    if (keys.length === 0) {
      setSweep(null);
      return;
    }
    // 한 번 껐다 켠다 — 같은 칸을 연달아 훑을 때 className 이 동일하면 CSS 애니가 재시작하지 않는다.
    setSweep(null);
    fx.raf = requestAnimationFrame(() => {
      fx.raf = null;
      setSweep(delays);
      fx.t = window.setTimeout(() => {
        fx.t = null;
        setSweep(null);
      }, SWEEP_MAX_DELAY_MS + SWEEP_HOLD_MS);
    });
  };

  const onCopyPrev = () => {
    const before = alloc;
    let n = 0;
    mutate((st) => {
      n = copyPrevWeekAlloc(st, res, weekMon);
    });
    if (n > 0) {
      ui.toast(`지난 주 배분 ${n}개 과목을 이번 주로 복사했어요.`, 'ok');
      sweepChanged(before);
    } else ui.toast('복사할 지난 주 배분이 없어요(계획 첫 주예요).', 'warn');
  };
  const onReset = () => {
    const before = alloc;
    mutate((st) => resetWeekAlloc(st, weekMon));
    ui.toast('이번 주를 자동 배분으로 되돌렸어요.', 'info');
    sweepChanged(before);
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
      <div className={S.wrap}>
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
    <div className={S.wrap}>
      {/* 툴바 — 모드 배지(+상태 안내) + 이전주복사/자동으로. 배분 합계는 상단 크롬 리드아웃이 소유(중복 제거). */}
      <div className={S.toolbar}>
        <span className={`${S.mode} ${managed ? S.modeManual : S.modeAuto}`}>{managed ? '내 배분' : '자동 제안'}</span>
        <span className={S.toolHint}>
          {managed
            ? '내가 정한 배분으로 이번 주가 굴러가요.'
            : '엔진이 제안한 배분이에요 — 칸을 고치면 내 배분으로 바뀌어요.'}
        </span>
        <div className={S.toolBtns}>
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
        <div className="ds-note">
          이번 주 <b>가용시간</b>이 0이에요 — 뼈대(일과)에서 수업·수면을 확인하면 배분 여력이 생겨요.
        </div>
      )}

      {noTime.length > 0 && (
        <div className="ds-note">
          <b>{noTime.map((it) => it.name).join(', ')}</b>은(는) <b>주당 목표 시간</b>이 없어 배분해도{' '}
          <b>시간 없음 · 스케줄 안 됨</b>이에요 — 과목에서 주당 시간을 넣어야 <b>새 학습</b>이 놓여요.
        </div>
      )}

      {inertFinished.length > 0 && (
        <div className="ds-noteInfo">
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
      <div className={S.scroll}>
        <div
          className={S.grid}
          role="table"
          aria-label="주간 배분 보드"
          aria-rowcount={rows.length + 2}
          aria-colcount={9}
        >
          {/* 헤더 행 */}
          <div className="contents" role="row">
            <div className={S.corner} role="columnheader">
              과목 · 요일
            </div>
            {cols.map((c) => (
              // 요일 헤더는 '열머리글이자 일 편집기를 여는 버튼'이다. 예전엔 <button role="columnheader">로
              // 버튼 의미를 덮어써 SR엔 정적 머리글로만 읽혔다 → 머리글 래퍼(display:contents) 안에 버튼을 둔다.
              // 오늘 열은 색상 단독으로만 전달되던 걸 aria-current="date"로 보강.
              <div key={c.i} className="contents" role="columnheader" aria-current={c.isToday ? 'date' : undefined}>
                <button
                  type="button"
                  className={`${S.colHead}${c.isToday ? ' ' + S.colToday : ''}`}
                  onClick={() => onOpenDay(c.ds)}
                  title={`${fmtShort(c.date)} 일 편집기 열기`}
                >
                  <span className={S.dow}>{c.label}</span>
                  <span className={c.isToday ? S.dateToday : S.date}>{fmtShort(c.date)}</span>
                </button>
              </div>
            ))}
            <div className={S.budgetHead} role="columnheader">
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
            // ID-7 방치 배지 — 이번 주 배분했는데(rowMin>0) 7일+ 손 안 댄 과목만(소음 절제).
            const nds = neglect[it.id];
            const neglected = nds != null && nds >= NEGLECT_DAYS && rowMin > 0 && !finished;
            return (
              <div key={it.id} className="contents" role="row" style={{ ['--sub' as string]: subColor }}>
                {/* 린트가 draggable 을 상호작용 신호로 읽어 'rowheader 는 포커스 가능해야'라고
                    하지만, 이 행 머리글은 조작 대상이 아니다 — 드래그는 순수 마우스 편의 레이어이고
                    접근성 정본은 셀의 NumberField(step 0.5 · aria-label "과목 · 요일 배분(시간)")라
                    ↑↓·타이핑으로 동일하게 달성된다(결정로그: "드래그 배분은 순수 편의 레이어").
                    tabIndex 를 주면 조작할 수 없는 탭 스톱만 과목 수만큼 늘어난다. */}
                {/* eslint-disable-next-line jsx-a11y/interactive-supports-focus */}
                <div
                  className={`${S.rowHead} ${dragSid === it.id ? 'bg-acc-glow' : 'bg-panel2'}`}
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
                  <span className={S.grab} aria-hidden="true" />
                  <span className={S.swatch} style={{ background: subColor }} />
                  <span className={S.rowName}>{it.name}</span>
                  {neglected && (
                    <span
                      className={S.neglect}
                      title={`이번 주 배분했지만 ${nds}일째 실제 학습이 없어요 — 계획과 실행이 벌어지는 중`}
                      aria-label={`${nds}일째 손 안 댐`}
                    >
                      💤{nds}
                    </span>
                  )}
                </div>
                {cols.map((c) => {
                  const cellMin = vec[c.wd] || 0;
                  const cellKey = `${it.id}:${c.wd}`;
                  const dropOn = dragSid === it.id; // 잡은 과목 행에만 드롭 허용(과목→요일 의미 유지)
                  const isDrop = overCell === cellKey;
                  const sweepMs = sweep?.[cellKey];
                  // 강조는 하나만 — 지금 올라와 있는 칸(dropOver) > 놓을 수 있는 칸(dragHint) >
                  // 빈 칸 호버 '+'. 드래그 중엔 '+' 를 죽인다(같은 행에 두 어포던스가 겹치면 소음).
                  const affordance = isDrop ? S.dropOver : dropOn ? S.dragHint : cellMin > 0 ? '' : S.hoverPlus;
                  return (
                    <div
                      key={c.i}
                      className={`${S.inputCell} ${c.isToday ? 'bg-alloc-today' : 'bg-panel'}${cellMin > 0 ? ' ' + S.before : ''}${affordance ? ' ' + affordance : ''}${sweepMs != null ? ' ' + S.sweep : ''}`}
                      style={sweepMs != null ? { animationDelay: `${sweepMs}ms` } : undefined}
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
                        // currentTarget 은 디스패치 동안만 유효하다 → 동기로 붙잡아 둔다.
                        const cell = e.currentTarget;
                        setCell(it.id, c.wd, (cellMin + DROP_STEP) / 60);
                        setOverCell(null);
                        setDragSid(null);
                        // UX-A3 착지 펄스 — 이펙트가 아니라 핸들러라 prev 비교·set-state 위험이 없다.
                        // reduced-motion 가드는 lib/motion 이 소유한다(WAAPI 는 전역 CSS 백스톱 밖).
                        commit(cell, subColor);
                      }}
                    >
                      {/* 비례 시각 채움 — 배분 분량에 따라 과목색 농도가 진해져 주(週) 부하가 한눈에 읽힌다. */}
                      {cellMin > 0 && (
                        <span className={S.fill} style={{ opacity: fillAlpha(cellMin) }} aria-hidden="true" />
                      )}
                      {/* NumberField — 미완 입력(빈값·"1.")을 커밋하지 않는다. 예전엔 1.5를 치는 도중
                          '.' 시점의 빈값이 0으로 확정됐고, 그 0이 setAllocCell→ensureWeekAlloc을 타고
                          이 주를 managed로 승격시켜 자동 제안을 영구 대체했다(그리고 최종값도 5h가 됐다). */}
                      <NumberField
                        className={S.cellInput}
                        min={0}
                        step={0.5}
                        value={cellMin ? +hNum(cellMin) : 0}
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
                <div className={`${S.budgetCell} ${BUDGET_BG[state_]}`} role="cell">
                  {/* UX-A1 — "2.5 / 10h · 7.5h 남음"은 결론이 맞지만 **읽어서 빼야** 알 수 있다.
                      같은 결론을 폭으로도 주면 "어느 과목이 미달인가"가 산수 없이 눈에 든다.
                      색은 과목색(--sub) 재사용이라 행 정체성이 유지되고, 초과일 때만 bad 로 갈린다. */}
                  {budgetMin > 0 && (
                    <span
                      className={`${S.edgeBar} ${state_ === 'over' ? 'bg-bad' : 'bg-[var(--sub,var(--acc))]'}`}
                      style={{ width: `${Math.min(100, (rowMin / budgetMin) * 100)}%`, opacity: EDGE_ALPHA }}
                      aria-hidden="true"
                    />
                  )}
                  <b className={S.budgetB}>{hNum(rowMin)}</b>
                  {budgetMin > 0 && <span className={S.budgetOf}> / {hNum(budgetMin)}h</span>}
                  <span className={`${S.badge} ${BADGE_TONE[state_]}`}>
                    {/* 챕터를 다 끝낸 과목은 중립 라벨(배분 충족 초록 ✓와 구분 — 오독 방지). */}
                    {state_ === 'done' && '챕터 완료'}
                    {state_ === 'ok' && '충족 ✓'}
                    {state_ === 'under' && `${hNum(-diff)}h 남음`}
                    {state_ === 'over' && `+${hNum(diff)}h`}
                    {/* 주당 시간이 없는 과목 — 배분해도 엔진이 0블록. 과목 카드와 같은 문구. */}
                    {state_ === 'none' && '시간 없음'}
                  </span>
                </div>
              </div>
            );
          })}

          {/* 가용 푸터 행 — 헤더 행과 마찬가지로 role="row" 래퍼 안에 둔다(예전엔 셀이 표 직속이라 행 구조가 깨졌다). */}
          <div className="contents" role="row">
            <div className={S.footHead} role="rowheader">
              가용
            </div>
            {cols.map((c, i) => {
              const cap = c.cap; // 그 날짜의 실제 가용(일정·override 반영) — capWd 요일 기본값이 아님
              const over = cap > 0 && colMins[i]! > cap + 5;
              // 배경 우선순위: 초과(bad 12%) > 오늘(acc 8%) > 기본(panel2) — 소스 순서(footOver 가 뒤).
              const footBg = over ? 'bg-alloc-foot-over' : c.isToday ? 'bg-alloc-today' : 'bg-panel2';
              return (
                <div
                  key={c.i}
                  className={`${S.footCell} ${footBg}`}
                  role="cell"
                  title={`${c.label} 배분 ${hNum(colMins[i]!)}h / 가용 ${hNum(cap)}h`}
                >
                  {/* UX-A1 — 열은 과목이 없으니 액센트로. "어느 요일이 빡빡한가"가 7개 분수를
                      비교하지 않고도 읽힌다(가용 0인 날은 분모가 없어 막대도 없다). */}
                  {cap > 0 && (
                    <span
                      className={`${S.edgeBar} ${over ? 'bg-bad' : 'bg-acc'}`}
                      style={{ width: `${Math.min(100, (colMins[i]! / cap) * 100)}%`, opacity: EDGE_ALPHA }}
                      aria-hidden="true"
                    />
                  )}
                  <b className={`${S.footNum} ${over ? 'text-bad' : 'text-txt'}`}>{hNum(colMins[i]!)}</b>
                  <span className={S.footCap}>/{hNum(cap)}</span>
                </div>
              );
            })}
            {/* 마지막 칸은 빈 자리(예산 열 아래) — 열 수를 맞춰야 행 구조가 정합하므로 aria-hidden 대신 빈 셀. */}
            <div className={S.footEnd} role="cell" />
          </div>
        </div>
      </div>

      <div className={S.hint}>
        과목 이름을 <b className={S.hintB}>요일 칸으로 끌면</b> 그날 +1h(숫자를 직접 넣어도 돼요). 배분한 요일엔{' '}
        <b className={S.hintB}>새 학습(new)</b>이 놓이고, 복습·Anki·모의는 엔진이 자동으로 얹어요. 요일 헤더를 누르면
        그날을 <b className={S.hintB}>시간표까지</b> 짤 수 있어요.
      </div>
    </div>
  );
}
