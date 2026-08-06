/* ============================================================
   Schedule — 배치 세그먼트(계획개편 §5-3): [일·주·월] 타임블로킹.
   질문 "오늘/이번 주, 무엇을 언제 할까?"에 한 화면으로 답한다.
   상단 네비(뷰 스위치 일/주/월 + 주 뷰 이동) · 본문:
     · 일 = DayPlanner(트레이 + 하루 타임라인 드래그 시간박기)
     · 주 = 주간 캘린더(WeekCalendar) — 요일 클릭 시 일 뷰로 드릴다운
     · 월 = MonthCalendar(마감 + 그날만의 할 일 칩 · 칸 클릭→일 뷰)
   주간 합계·완료율·마감은 상단 바(usePageChrome)로 끌어올린다. 하단 스트립(예상 완료·마감·.ics)은 공통.
============================================================ */
import { useMemo, useState } from 'react';
import { useApp } from '@/store/useApp';
import { useRuntime } from '@/store/useRuntime';
import { useUI } from '@/store/useUI';
import { useNavigate, useSearchParams } from 'react-router-dom';
import State from '@/components/State';
import { selectFinishGains, useSchedule, useStudyMinByWeekday } from '@/store/selectors';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { io } from '@/shell';
import {
  iso,
  parseISO,
  addDays,
  dayDiff,
  weekLabel,
  fmtShort,
  ddayInfo,
  todayISO,
  DOW_MON,
  hNum,
  hLabel,
} from '@/lib/utils';
import { Button } from '@/components/ui';
import { useHeroPointer, useNowMin } from '@/hooks/interactions';
import { useWeekOffset } from '@/hooks/useWeekOffset';
import { computeDay, indexDays, deadlineDdays } from '@/lib/scheduleView';
import { examMarks } from '@/lib/semester';
import { timedTasksForDay } from '@/lib/tasks';
import { WeekCalendar } from './WeekCalendar';
import { DayPlanner } from './DayPlanner';
import { MonthCalendar } from './MonthCalendar';
import { CutCard } from './CutCard';
import { Icon } from '@/components/Icon';

/* ── C-7 이식(Schedule 셸) — Tailwind 클래스 SSOT ───────────────────────────────
   상단 네비(줄바꿈 금지 · 좁으면 서술 텍스트를 sr-only 로 접어 화살표만) · 본문(뷰별 fill) ·
   하단 스트립(예상 완료·마감·.ics). 'ds-seg'/on/spotHost/glow/spotlight/note 는 공용이라 유지.
   내장 크기(text-sm/lg)만 companion line-height 를 흘리므로 정상 흐름엔 leading-text/원본 LH 를
   명시(line-height 트랩). `.dd`(마감 카운트다운)는 <button> 이라 전역 button 이 유틸을 이겨 다른
   값만 `!`. @media(900) 세로 스택은 max-wide: 로 재현. */
const S = {
  wrap: 'flex h-full min-w-0 flex-col',
  nav: 'flex flex-none flex-nowrap items-center gap-2.5 border-b border-line px-5.5 py-3.5',
  wknav: 'flex flex-auto items-center gap-2.5 min-w-0',
  navBtn: 'flex-none whitespace-nowrap',
  wk: 'flex-auto min-w-0 truncate text-center',
  wkLab: 'whitespace-nowrap text-lg leading-text font-extrabold tracking-wk',
  wkOff: 'ml-1.5 whitespace-nowrap text-sm leading-text font-semibold text-mut',
  navLong: 'whitespace-nowrap max-mobile:sr-only',
  body: 'min-h-0 flex-1',
  board2:
    'flex h-full min-h-0 gap-3.5 px-4 pt-2 pb-2.5 max-wide:flex-col max-wide:overflow-y-auto max-wide:[scrollbar-width:thin]',
  boardCard:
    'flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border border-line bg-[image:var(--board-card-bg)] px-3 pt-2.5 pb-2.5 shadow-[var(--shadow-md)]',
  boardWrap: 'flex min-h-0 flex-1 flex-col max-wide:min-h-80',
  calHost: 'min-h-0 flex-1',
  weekEmptyNote: 'mb-2.5', // + 'ds-note'
  warn: 'flex-none mt-3 text-sm leading-body',
  emptyBoard: 'flex h-full flex-col items-center justify-center gap-3 text-center text-mut',
  finStrip: 'flex flex-none flex-wrap items-center gap-4 border-t border-line px-5.5 py-1.5',
  grpL: 'flex-none ds-caps-sm',
  fin: 'inline-flex items-center gap-1.5 text-sm leading-text font-semibold text-mut',
  finDday: 'font-semibold text-mut',
  ddMut: 'text-md font-semibold text-mut',
  dot: 'size-1.75 flex-none rounded-full',
  strip: 'flex flex-none flex-wrap items-center gap-7 border-t border-line px-5.5 py-3.25',
  grp: 'flex min-w-0 flex-wrap items-center gap-2.5',
  dd: 'inline-flex items-center gap-1.5 font-bold!',
  vline: 'h-6 w-px flex-none bg-line2',
  icsNote: 'flex flex-wrap items-center gap-2 text-sm leading-text', // 색은 사용처(mut/stale=warn)에서
} as const;

/** .ics 신선도 — 마지막 내보내기 서명을 현재 계획과 비교(어긋나면 재내보내기 안내). 스트립용 컴팩트. */
function IcsFreshnessNote() {
  const x = useRuntime((s) => s.cache._icsExport);
  const today = useApp((s) => todayISO(s.state)); // 렌더 순수성: Date.now() 대신 앱 정본 '오늘'(테스트 _today 존중)
  if (!x || !x.at)
    return (
      <span className={`${S.icsNote} text-mut`}>
        <Icon name="calendar" /> 캘린더(.ics) 미내보내기
      </span>
    );
  const when = new Date(x.at);
  const days = isNaN(when.getTime()) ? null : dayDiff(iso(when), today);
  const ago = days == null ? '' : days <= 0 ? '오늘' : days === 1 ? '어제' : `${days}일 전`;
  const stale = x.sig !== io.planSignature();
  if (stale)
    return (
      <span className={`${S.icsNote} text-warn`}>
        <Icon name="calendar" /> .ics 계획과 어긋남({ago})
        <Button sm onClick={() => io.exportICS()}>
          <Icon name="refresh" /> 재내보내기
        </Button>
      </span>
    );
  return (
    <span className={`${S.icsNote} text-mut`}>
      <Icon name="calendar" /> .ics 최신 · 마지막 {ago}
    </span>
  );
}

export default function Schedule() {
  const state = useApp((s) => s.state);
  const mutate = useApp((s) => s.mutate);
  const res = useSchedule();
  // 주(週) 네비는 공용 기계가 소유 — todayOff 산식·useState·`,`/`.` 단축키·오프셋 배지가
  // Alloc과 글자까지 같은 복제였다(useWeekOffset이 단일 출처). 내부 상태가 '오늘 기준 상대 주'라
  // startDate/_today가 바뀌어도 자동 리베이스된다.
  const { prev: weekPrev, next: weekNext, weekToday, isThisWeek, offsetLabel, weekMon } = useWeekOffset(state);
  // 뷰 선택은 UI 설정 단일 store(useUI)가 소유 — 영속·IDB미러 일관(localStorage 직접 접근 제거).
  const schedView = useUI((s) => s.ui.schedView);
  const setView = useUI((s) => s.setSchedView);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // 보드 위 스포트라이트(틸트 없음 — 큰 패널). 구조분해로 ref-접근 린트 회피.
  const { ref: boardRef, onMouseMove: boardMove, onMouseLeave: boardLeave } = useHeroPointer(0);

  // 현재 주 월요일 — 훅의 `curMon`은 매 렌더 새 Date라 memo 키로 쓰면 매번 깨진다.
  // 안정 스칼라인 `weekMon`(ISO 문자열)에 키잉해 identity를 고정한다 → parts memo deps를 정직하게(억제 주석 없이) 쓴다.
  const curMon = useMemo(() => parseISO(weekMon), [weekMon]);

  const capWd = useStudyMinByWeekday();
  // '지금' 라인·⏱ 지금 행이 로드 시각에 멈추지 않도록 분 단위로 갱신(Today 탭과 동일 감각) — 공유 훅.
  const nowMin = useNowMin();
  const todayIso = todayISO(state); // 앱의 '오늘' 단일 출처(_today 시드 존중) — 날짜비교 결정성.

  // 일/월 뷰의 앵커 날짜(ISO) — 일 뷰=그날, 월 뷰=그 달. 주 뷰는 weekOffset이 독립 소유.
  // 딥링크 `?ds=<ISO>`는 **초기값으로만** 흡수한다(배분 탭 셀 클릭 → 그날 일 뷰 드릴다운).
  // effect에서 setState로 되받으면 캐스케이드 렌더라 린트가 막는다 — 뷰(day) 전환은 보내는 쪽이 미리 하고,
  // 여긴 마운트 시 한 번 읽기만 하면 충분하다(탭 경계를 넘으면 이 컴포넌트는 새로 마운트되므로).
  const [anchorDs, setAnchorDs] = useState(() => {
    const q = searchParams.get('ds');
    return q && /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : todayISO(state);
  });

  const dayNav = (delta: number, toToday?: boolean) =>
    setAnchorDs(toToday ? todayIso : iso(addDays(parseISO(anchorDs), delta)));
  const monthNav = (delta: number, toToday?: boolean) => {
    if (toToday) return setAnchorDs(todayIso);
    const d = parseISO(anchorDs);
    setAnchorDs(iso(new Date(d.getFullYear(), d.getMonth() + delta, 1)));
  };
  // 월 칸 클릭 → 그날 일 뷰로 진입(§6-5).
  const monthPick = (dsPick: string) => {
    setAnchorDs(dsPick);
    setView('day');
  };

  // deps는 전부 정직하게 — 억제 주석 한 줄이 컴포넌트 전체의 React 컴파일러 최적화를 끈다
  // ("skipped optimizing this component because one or more React ESLint rules were disabled").
  // 이 저장소는 수동 memo를 안 쓰므로 bail = 메모 전무 → 자식 prop identity까지 매 렌더 갈린다.
  const parts = useMemo(() => {
    const byDs = indexDays(res); // ds→Day 인덱스를 7일 루프 밖에서 1회 생성(매 호출 재구축 제거).
    return Array.from({ length: 7 }, (_, k) => computeDay(state, byDs, capWd, nowMin, todayIso, curMon, k));
  }, [state, res, capWd, nowMin, todayIso, curMon]);

  /* 줄마다 마감 플래그 — 그날 시험이 있는 과목명(네온 위크-그리드에 표시).
     ⚠ 원시 `it.deadline` 이 아니라 `examMarks` 다(H-1) — 시험을 넣으면 그 필드가 지워져
     **이 표식이 조용히 사라졌다.** 근거는 `lib/semester.ts` 의 `examsOn` 주석이 소유한다. */
  const deadlines = parts.map((p) => examMarks(state.items, p.ds).map((m) => m.name));
  const hasStudyItems = state.items.some((it) => it.name);

  // 주간 합계·완료율(리드아웃) — 이번 화면 주(週) 기준.
  const weekUsedH = parts.reduce((t, p) => t + p.used, 0) / 60;
  const weekPlanMin = parts.reduce((t, p) => t + p.planMin, 0);
  const weekDoneMin = parts.reduce((t, p) => t + p.doneMinTot, 0);
  const compRate = weekPlanMin > 0 ? Math.round((weekDoneMin / weekPlanMin) * 100) : 0;

  // 마감 카운트다운(스트립 + 가장 가까운 마감 리드아웃) — Today 탭과 공유 헬퍼(가까운순·미완료·미래만).
  const ddays = deadlineDdays(res.itemStat, todayIso);
  const nearestDday = ddays.length ? ddays[0]!.dday : null;
  const soon = ddays.slice(0, 4);

  /* N-3 반사실 — 적응형 계수가 적용된 계획에서만 계산된다(아니면 빈 배열 · 비용 0).
     `schedule()` 이 순수 함수라 "계수 없이 한 번 더" 돌린 결과이지 추정이 아니다. */
  const gainById = new Map(selectFinishGains(state).map((g) => [g.id, g]));
  // 과목별 예상 완료일(스케줄러 산출 finishDate) — 하단 리드아웃. finishDate/완료 표식 있는 과목만.
  const finishes = (res.itemStat || [])
    .filter((st) => st.name && (st.finishDate || st.finished))
    .map((st) => ({
      id: st.id,
      name: st.name,
      color: st.color,
      finished: !!st.finished,
      late: st.late || 0,
      md: st.finishDate ? fmtShort(parseISO(st.finishDate)) : null,
      dday: st.nextExam ? dayDiff(todayIso, st.nextExam) : null, // ⚠ 다가오는 시험 기준(H-2)
      gain: gainById.get(st.id),
    }));

  // 배치 전용 리드아웃(뷰별 스왑) — 일=그날, 주=이번 주(週), 월=그 달. 탭재설계 '상단 리드아웃' 사상.
  const anchorDate = parseISO(anchorDs);
  const anchorDay = computeDay(state, indexDays(res), capWd, nowMin, todayIso, anchorDate, 0); // anchorDs 하루치
  const dayCompRate = anchorDay.planMin > 0 ? Math.round((anchorDay.doneMinTot / anchorDay.planMin) * 100) : 0;
  const anchorY = anchorDate.getFullYear();
  const anchorM = anchorDate.getMonth();
  const monthDays = res.days.filter((d) => {
    const dt = parseISO(d.ds);
    return dt.getFullYear() === anchorY && dt.getMonth() === anchorM;
  });
  const monthUsedH = monthDays.reduce((t, d) => t + d.used, 0) / 60;
  const monthOpenTasks = (state.tasks || []).filter((t) => {
    if (!t.ds || t.done) return false;
    const dt = parseISO(t.ds);
    return dt.getFullYear() === anchorY && dt.getMonth() === anchorM;
  }).length;

  /* ── W22 앵커 — **44px `primary` 는 뷰가 정한다** ───────────────────────────────────
     ⚠⚠ 첫 판(2026-07-31)이 `primary` 를 `anki 없이 anchorDay.planMin` 로 **고정**해 두 결함을 냈다:
     ① 주·월 뷰에서 *그 날* 계획을 말해 화면이 보여 주는 범위와 어긋났다.
     ② 일 뷰에선 같은 수가 `primary` 와 첫 리드아웃 **두 자리**에 떠서 상단 바가 넘쳤다 —
        이 배치가 다른 화면에서 강제한 "한 양 = 한 자리"를 정작 여기서 어겼다(실렌더가 잡았다).
     → 뷰별 헤드라인을 **하나 만들고**, `primary` 가 그것을 가져가면 리드아웃에서는 뺀다. */
  const head =
    schedView === 'day'
      ? { label: `${fmtShort(anchorDate)} 계획`, value: hNum(anchorDay.planMin), unit: 'h' }
      : schedView === 'month'
        ? { label: `${anchorM + 1}월`, value: monthUsedH.toFixed(1), unit: 'h' }
        : { label: '이번 주', value: weekUsedH.toFixed(1), unit: 'h' };

  const readouts =
    schedView === 'day'
      ? [
          { label: '완료', value: anchorDay.planMin ? `${dayCompRate}%` : '—' },
          { label: '가용', value: hLabel(anchorDay.studyMin) },
        ]
      : schedView === 'month'
        ? [
            { label: '미완 할일', value: monthOpenTasks ? String(monthOpenTasks) : '—' },
            // 라벨은 정본 헬퍼로 — 직접 조립하면 오늘 마감이 "D-0"으로 뜬다(정본은 "D-DAY").
            { label: '마감', value: nearestDday == null ? '—' : ddayInfo(nearestDday).lab },
          ]
        : [
            { label: '완료', value: weekPlanMin ? `${compRate}%` : '—' },
            { label: '마감', value: nearestDday == null ? '—' : ddayInfo(nearestDday).lab },
          ];

  // 주 뷰에서 다른 주를 보는 중이면 "이번 주로", 그 외엔 .ics 내보내기.
  usePageChromeEffect(
    () => ({
      // W22 — 헤드라인은 위 `head` 하나가 소유한다(리드아웃에는 없다 · 한 양 = 한 자리).
      primary: head,
      readouts,
      action:
        schedView === 'week' && !isThisWeek
          ? { label: '이번 주로 →', onClick: weekToday }
          : { label: '캘린더(.ics) 내보내기', onClick: () => io.exportICS() },
    }),
    [schedView, readouts, isThisWeek, head],
  );

  // 뷰 스위치 [일·주·월] — 배분은 독립 세그먼트로 승격돼 여기서 빠졌다(재개편 v4).
  // tablist 계약(화살표 이동·tabpanel) 미이행 → group+aria-pressed가 정직(WCAG 4.1.2).
  const VIEW_LABEL = { day: '일', week: '주', month: '월' } as const;
  const viewSeg = (
    <div className="ds-seg ml-auto" role="group" aria-label="캘린더 보기 방식">
      {(['day', 'week', 'month'] as const).map((v) => (
        <button
          key={v}
          aria-pressed={schedView === v}
          className={schedView === v ? 'ds-on' : ''}
          onClick={() => setView(v)}
        >
          {VIEW_LABEL[v]}
        </button>
      ))}
    </div>
  );
  const navBar = (
    <div className={S.nav}>
      {/* 일 뷰 — 날짜 이동도 여기가 소유(주·월과 대칭). 뷰 본문이 자체 네비를 또 그리면
          같은 기능이 두 줄에 흩어지고, 이 줄은 뷰 스위치만 남아 빈 띠가 된다. */}
      {schedView === 'day' && (
        <div className={S.wknav}>
          <Button sm className={S.navBtn} onClick={() => dayNav(-1)} aria-label="이전 날">
            <Icon name="chevronLeft" />
            <span className={S.navLong}> 이전 날</span>
          </Button>
          <div className={S.wk}>
            <b className={S.wkLab}>{fmtShort(anchorDate)}</b>
            <span className={S.wkOff}>
              {DOW_MON[(anchorDate.getDay() + 6) % 7]}요일{anchorDs === todayIso && ' · 오늘'}
            </span>
          </div>
          <Button sm className={S.navBtn} onClick={() => dayNav(1)} aria-label="다음 날">
            <span className={S.navLong}>다음 날 </span>
            <Icon name="chevronRight" />
          </Button>
          {anchorDs !== todayIso && (
            <Button sm className={S.navBtn} variant="ghost" onClick={() => dayNav(0, true)}>
              오늘
            </Button>
          )}
        </div>
      )}
      {/* 월 뷰 — 달 이동을 여기(공통 nav)가 소유한다. 뷰 본문이 자체 헤더를 또 그리면 헤더가 두 줄이 되고,
          정작 이 줄은 뷰 스위치만 남아 빈 띠가 된다. 주 뷰의 주 이동과 같은 자리·같은 문법. */}
      {schedView === 'month' && (
        <div className={S.wknav}>
          <Button sm className={S.navBtn} onClick={() => monthNav(-1)} aria-label="이전 달">
            <Icon name="chevronLeft" />
            <span className={S.navLong}> 이전 달</span>
          </Button>
          <div className={S.wk}>
            <b className={S.wkLab}>
              {anchorDate.getFullYear()}년 {anchorDate.getMonth() + 1}월
            </b>
            <span className={S.wkOff}>{monthUsedH.toFixed(1)}h</span>
          </div>
          <Button sm className={S.navBtn} onClick={() => monthNav(1)} aria-label="다음 달">
            <span className={S.navLong}>다음 달 </span>
            <Icon name="chevronRight" />
          </Button>
          <Button sm className={S.navBtn} variant="ghost" onClick={() => monthNav(0, true)}>
            오늘
          </Button>
        </div>
      )}
      {schedView === 'week' && (
        <div className={S.wknav}>
          {/* aria-label로 이름을 고정한다 — 라벨을 span으로 쪼개면 접근가능한 이름 계산이 조각 사이 공백을
              버려 "◀이전 주"가 된다(폭에 따라 이름이 흔들리는 것도 곤란). 일·월 네비와 같은 문법. */}
          <Button sm className={S.navBtn} onClick={weekPrev} aria-label="이전 주">
            <Icon name="chevronLeft" />
            <span className={S.navLong}> 이전 주</span>
          </Button>
          <div className={S.wk}>
            <b className={S.wkLab}>{weekLabel(curMon)}</b>
            <span className={S.wkOff}>{offsetLabel}</span>
          </div>
          <Button sm className={S.navBtn} onClick={weekNext} aria-label="다음 주">
            <span className={S.navLong}>다음 주 </span>
            <Icon name="chevronRight" />
          </Button>
          <Button sm className={S.navBtn} variant="ghost" onClick={weekToday}>
            오늘
          </Button>
        </div>
      )}
      {viewSeg}
    </div>
  );

  return (
    <section className={S.wrap} aria-label="주간 스케줄">
      {navBar}

      {/* 컷 카드(P-9) — **옛 "다 못 끝내요" 경고 줄이 있던 자리**. 그 줄은 은퇴했다: 앱이 부족분을
          알면서 유일한 처방으로 `주당 시간↑`(사용자가 할 수 없는 것)을 내놓고 있었고, 그래서
          액션이 0이었다. 지금은 같은 자리에서 "무엇을 뺄까"를 묻는다. 새 탭 0 · IA 변경 0. */}
      {res.shortfalls.map((sf) => (
        <CutCard key={sf.sid} sf={sf} mutate={mutate} />
      ))}

      {/* 편성 경고 — 뷰(개요/카드) 무관 공통 스트립(카드뷰에서 소실되지 않도록 분기 밖으로 승격). */}
      {res.warnings.length > 0 && (
        <div
          className={`${S.warn} ${res.warnings.some((w) => w.includes('못') || w.includes('초과')) ? 'text-bad' : 'text-warn'}`}
        >
          {res.warnings.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </div>
      )}

      {/* ⚠ **컷 카드가 있으면 본문을 스크롤로 돌린다**(실렌더로 잡았다 · §15-4). 이 화면은 fill
          프레임(`h-full`)이라 위에 카드가 끼면 캘린더 몫이 그대로 줄고, 실측에서 **격자가 0px 로
          납작해졌다** — 무엇을 뺄지 고르라면서 그 판단의 근거인 주간 격자를 지운 셈이다.
          카드가 없을 때는 종전 그대로다(스크롤 없음 · 베이스라인 무변화). */}
      <div className={res.shortfalls.length ? `${S.body} [scrollbar-width:thin] overflow-y-auto` : S.body}>
        <div className={res.shortfalls.length ? 'h-104' : 'h-full'}>
          {schedView === 'day' ? (
            <DayPlanner ds={anchorDs} res={res} nowMin={nowMin} todayIso={todayIso} />
          ) : schedView === 'month' ? (
            <MonthCalendar anchor={parseISO(anchorDs)} res={res} todayIso={todayIso} onPick={monthPick} />
          ) : (
            <div className={S.board2}>
              {/* 위크보드 — 정보의 주인공(발광 카드 + 포인터 스포트라이트). */}
              <div
                ref={boardRef}
                onMouseMove={boardMove}
                onMouseLeave={boardLeave}
                className={`${S.boardCard} ds-spotHost ds-glow`}
              >
                <div className="ds-spotlight" aria-hidden="true" />
                {hasStudyItems ? (
                  <div className={S.boardWrap}>
                    {weekPlanMin === 0 && (
                      // 과목은 있는데 이 주에 학습 블록이 하나도 안 잡힌 경우(모두 완료·마감 지남·가용 없음) —
                      // 일과만 뜬 캘린더가 왜 비었는지 조용히 두지 않고 짚어준다.
                      <div className={`ds-note ${S.weekEmptyNote}`}>
                        이 주에는 배치된 <b>학습 블록</b>이 없어요 — 마감이 지났거나 가용시간이 부족할 수 있어요.
                        일과(수면·수업)만 표시됩니다.
                      </div>
                    )}
                    <div className={S.calHost}>
                      <WeekCalendar
                        parts={parts}
                        nowMin={nowMin}
                        dows={DOW_MON}
                        deadlines={deadlines}
                        tasksByDay={parts.map((p) => timedTasksForDay(state, p.ds))}
                        // 요일 클릭 = 그날 일 계획 창으로. 옛 우측 아젠다(선택 요일 세부)를 대체한다 —
                        // 같은 화면에 요약을 또 그리느니 편집까지 되는 일 뷰로 보내는 게 낫다.
                        onOpenDay={(dsPick) => {
                          setAnchorDs(dsPick);
                          setView('day');
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className={S.emptyBoard}>
                    <State
                      glyph="calendar"
                      title="주간 보드가 비어 있어요"
                      desc={
                        <>
                          학습 항목을 추가하면 이 캘린더에 <b>공부·복습 블록</b>이 자동 배치됩니다. 지금은 기본
                          일과(수면·식사)만 보여요.
                        </>
                      }
                      next={
                        <Button sm variant="primary" onClick={() => navigate('/items')}>
                          학습 항목 추가하기 →
                        </Button>
                      }
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 예상 완료 스트립 — 과목별 스케줄러 산출 완료일(온디맨드 리드아웃, 완료/지연 표식).
          ⚠ 원본 `.finDone{color:acc}` 는 `.fin b`(명시도 0,1,1 > 0,1,0)에 가려 실제로는 잉크로 렌더된다
          (완료 지연이면 `.fin.finLate b` 로 bad) — 픽셀 보존을 위해 그 실효 색을 그대로 재현한다. */}
      {finishes.length > 0 && (
        <div className={S.finStrip}>
          <span className={S.grpL}>예상 완료</span>
          {finishes.map((f) => {
            const bCls = `font-bold ${f.late > 0 ? 'text-bad' : 'text-txt'}`;
            return (
              <span key={f.id} className={S.fin}>
                <span className={S.dot} style={{ background: f.color || 'var(--acc)' }} />
                {f.name}{' '}
                {f.finished ? (
                  <b className={bCls}>✓ 완료</b>
                ) : (
                  <b className={bCls}>
                    {f.md ?? '—'}
                    {f.dday != null && f.dday >= 0 && <span className={S.finDday}> · D-{f.dday}</span>}
                    {/* N-3 — 이행률 계수가 이 날짜를 며칠 밀었는지. **진단이지 평가가 아니다**:
                        '늦었다'가 아니라 "계획대로 지키면 이 날"이라고만 말한다(이행률은 통제 밖
                        사유로도 떨어진다 · records 의 '성취 회수' 톤). 계수가 없으면 아예 안 뜬다. */}
                    {f.gain && (
                      <span className={S.finDday} title={`계획대로 지키면 ${f.gain.idealDate}`}>
                        {' '}
                        · 지키면 −{f.gain.days}일
                      </span>
                    )}
                  </b>
                )}
              </span>
            );
          })}
        </div>
      )}

      {/* 하단 스트립 — 마감 카운트다운 + .ics 신선도 */}
      <div className={S.strip}>
        <div className={S.grp}>
          <span className={S.grpL}>마감</span>
          {soon.length ? (
            soon.map((d) => {
              const { lab } = ddayInfo(d.dday);
              return (
                <button key={d.name + d.deadline} type="button" className={S.dd} onClick={() => navigate('/items')}>
                  <span className={S.dot} style={{ background: d.color || 'var(--acc)' }} />
                  {d.name} <b className={d.dday <= 7 ? 'text-bad' : 'text-acc'}>{lab}</b>
                </button>
              );
            })
          ) : (
            <span className={S.ddMut}>없음</span>
          )}
        </div>
        <div className={S.vline} />
        <IcsFreshnessNote />
      </div>
    </section>
  );
}
