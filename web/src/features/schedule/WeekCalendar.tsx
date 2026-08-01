/* ============================================================
   WeekCalendar — 주간 캘린더(재개편 v5 · 피드백 반영).
   옛 구현의 한계를 셋 다 걷어냈다:
     ① 3시간 격자 + 높이 100% 비율 배치 → **1시간 = 고정 픽셀** 스크롤 격자.
        비율 배치는 하루를 화면에 욱여넣어 30분짜리가 몇 px로 뭉개졌다(이름도 못 읽힘).
     ② 겹치는 일정이 서로를 가림 → lib/scheduleView의 packLanes로 **레인 분할**(나란히).
     ③ 마감·미배치가 시간축 안에 섞임 → 상단 **종일 행**으로 분리(시간 없는 것은 시간축에 두지 않는다).
   추가: 30분 보조선 · 현재 시각 라인 + 시각 배지 · 마운트 시 '지금'으로 자동 스크롤.
   순수 표현 — DayData[]는 Schedule이 준비. 학습 블록 클릭 = 완료 토글(기존 계약 유지).

   v5-wave5: **일정(events)** 을 같은 시간축에 올린다. 일정은 DayData에 실려 오지 않아(=Schedule이
   준비하지 않는 축) 스토어에서 직접 읽는다 — 이 컴포넌트는 이미 useApp으로 state·toggleDone을
   쥐고 있어 "props만 받는 순수 표현"은 이미 근사치였고, 부모(Schedule)를 못 고치는 제약 아래에서
   props 경유는 선택지가 아니다. 읽기는 순수 선택자(eventsForDay)라 파생만 늘고 부수효과는 없다.
============================================================ */
import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/store/useApp';
import { ui } from '@/shell';
import { isDone } from '@/lib/persistence';
import { eventsForDay } from '@/lib/events';
import { toHM, pad2, hNum, hLabel, itemById } from '@/lib/utils';
import { SESSION_TYPE_META as STYPE, packLanes, timeSpan, type DayData, type Row } from '@/lib/scheduleView';
import type { SessionType, Task } from '@/lib/types';
import { Icon } from '@/components/Icon';

/* ── C-7 이식(WeekCalendar) — Tailwind 클래스 SSOT ──────────────────────────────
   [머리글 고정 / 종일 행 / 스크롤 시간축]. 좌측 거터 44px(모바일 34) + 요일 7열은 격자 트랙 토큰
   (grid-cols-weekcal-*)으로 세 층 정렬을 맞춘다. ⚠ 일정 조각(.seg)은 study/event 가 <button>,
   block/task 가 <div> 라 **같은 클래스 문자열이 두 요소형에 걸린다** → 전역 button(언레이어)이
   유틸을 이기는 study/event 쪽 기준으로 button 충돌 속성엔 `!`(div 엔 무해). 색·색믹스는 tokens.css,
   좌측 색 띠는 런타임 --seg(과목색) 파생이라 인라인 style 이 얹는 사용 시점 해석(§14-3 · 절대규칙 #3).
   ⚠ 조각 텍스트: text-xs/lg 는 built-in 이라 companion line-height 를 흘려 원본 LH(1.25/1.1)를
   leading-[…] 로 못박는다(고정 셀 clip 방지 · line-height 트랩). 밀도(micro/compact)·오늘·초과·
   과거·완료는 정적 클래스맵(§15 · 동적 s[k] 금지). */
const CAL = {
  cal: 'flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-panel shadow-inset-line2',
  head: 'grid flex-none grid-cols-weekcal-head gap-px overflow-y-hidden border-b border-line bg-panel [scrollbar-gutter:stable] max-mobile:grid-cols-weekcal-head-narrow',
  gutterHead: 'block',
  dayHead:
    'flex flex-col items-center gap-px border-x-0! border-t-2! border-b-0! border-t-transparent! bg-transparent! px-0.5! pt-2! pb-1.75! focus-visible:-outline-offset-2!',
  dow: 'text-sched-dow font-bold tracking-tag',
  date: 'text-sched-date font-extrabold leading-display tabular-nums max-mobile:text-lg',
  dateToday: 'min-w-6.5 rounded-full bg-acc px-1.5 text-bg',
  dayH: 'text-2xs tabular-nums',
  allday:
    'grid max-h-21 flex-none grid-cols-weekcal-head gap-px overflow-y-hidden border-b border-line bg-[var(--tint-ink-faint)] [scrollbar-gutter:stable] [scrollbar-width:thin] max-mobile:grid-cols-weekcal-head-narrow',
  alldayLab: 'pt-1.5 pr-1.5 text-right text-sched-meta whitespace-nowrap text-mut',
  alldayCell: 'flex min-w-0 flex-col gap-0.75 px-0.75 py-1.25',
  chipBase: 'truncate rounded-chip-md px-1.5 py-0.5 text-left text-2xs font-bold',
  chipDeadline: 'bg-[var(--sched-chip-bad)] text-bad',
  chipUnplaced:
    'truncate rounded-chip-md! border-0! bg-[var(--sched-chip-warn)]! px-1.5! py-0.5! text-left text-2xs! font-bold! text-warn!',
  scroll: 'min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable] [scrollbar-width:thin]',
  grid: 'relative grid grid-cols-weekcal-grid max-mobile:grid-cols-weekcal-grid-narrow',
  gutter: 'relative',
  hourLab: 'absolute right-1.5 -translate-y-1/2 text-2xs tabular-nums text-mut',
  cols: 'relative grid grid-cols-7 gap-px',
  lines: 'pointer-events-none absolute inset-0 col-span-full',
  lineH: 'absolute inset-x-0 h-px bg-line2',
  lineHalf: 'absolute inset-x-0 h-px bg-[var(--line2-half)]',
  col: 'relative min-w-0',
  now: 'pointer-events-none absolute inset-x-0 col-span-full z-[3] h-0 border-t-2 border-solid border-t-bad',
  nowCap:
    'absolute left-0.5 -top-2 rounded-chip-sm bg-bad px-1 py-0.25 text-sched-cap font-extrabold tabular-nums text-bg',
} as const;

// 일정 조각 — 구조(base) + 밀도별 패딩(pad) + 종류별 채움/그림자/좌측띠(kind) + 세션타입 폴백색(type).
// ⚠ seg-scope — 과목색(--seg) 파생 채움/링을 **이 요소에서** 다시 선언한다(tw.css 머리주석: :root 선언은
//    폴백으로 굳어 인라인 --seg 를 못 따라간다). 없으면 조각 채움이 통째로 빈다.
const SEG_BASE = 'seg-scope absolute flex cursor-default flex-col gap-px overflow-hidden rounded-seg! text-left';
const SEG_PAD = {
  base: 'py-0.75! pr-1.5! pl-2.25!',
  event: 'py-0.75! pr-1.5! pl-2!', // 일정은 좌측 띠가 굵어 padding-left 8px
  micro: 'py-0.25! pr-1! pl-1.5!',
};
const SEG_KIND = {
  study:
    'border-t-0! border-r-0! border-b-0! border-l-4! border-l-[color:var(--seg,var(--acc))]! bg-[var(--seg-fill)]! shadow-[var(--shadow-seg)]',
  event:
    'border-t-0! border-r-0! border-b-0! border-l-[length:var(--bw-event)]! border-l-[color:var(--seg,var(--acc))]! bg-[var(--seg-fill)]! shadow-[var(--shadow-seg-event)]',
  block:
    'border-solid border-t-0 border-r-0 border-b-0 border-l-4 border-l-[color:var(--seg-block-line)] bg-[var(--seg-block-fill)] shadow-[var(--shadow-seg-block)]',
  task: 'border border-dashed border-[color:var(--seg-task-line)] border-l-4 [border-left-style:solid] border-l-[color:var(--seg,var(--acc))] bg-[var(--seg-fill-20)] shadow-[var(--shadow-seg)]',
};
// 세션 타입 폴백색(과목색 인라인 --seg 없을 때) — 정적 맵(§15 · 절대규칙 #3: 리터럴 hex 금지).
const SEG_TYPE: Record<SessionType, string> = {
  new: '[--seg:var(--acc)]',
  rev: '[--seg:var(--acc2)]',
  anki: '[--seg:var(--warn)]',
  blank: '[--seg:var(--violet)]',
  mock: '[--seg:var(--bad)]',
};

/** 1시간의 **최소** 높이(px). 44 밑으로 내리면 30분 일정이 22px가 안 돼 이름 한 줄도 못 담는다
 *  — v5에서 비율 배치를 걷어낸 이유가 이것이라 이 바닥은 절대 안 내린다.
 *  다만 프레임에 여유가 있으면 이 값 **위로** 늘려 트랙이 화면을 채운다(아래 hourH 참고). */
const HOUR_H = 44;
/** 심야(00:00~NIGHT_END)는 한 칸으로 접는다 — 대부분 수면이라 7시간을 그대로 그리면 그냥 빈다. */
const NIGHT_END = 7 * 60;
const NIGHT_H = HOUR_H;
/** 표시 범위가 아무리 좁아도 최소 이만큼은 그린다(일정 하나뿐인 날 캘린더가 납작해지지 않게). */
const MIN_SPAN_H = 9;

/** 표시 범위 계산은 lib/scheduleView.timeSpan 단일 함수가 소유한다(일 뷰와 동형 로직이 두 벌로 갈라져
 *  단위테스트 밖에 있던 것을 합쳤다). 정시 스냅 · 앞뒤 1시간 여유 · 일정이 없으면 08–20 기본 창. */
const SPAN_OPTS = { snap: 60, minSpan: MIN_SPAN_H * 60, fallback: { lo: 8 * 60, hi: 20 * 60 } } as const;

/** 그릴 수 있는 조각(블록·학습·할일·일정 공통) — packLanes에 넣기 위한 정규화 형태.
 *  일정을 별도 오버레이로 그리지 않고 이 파이프라인에 태우는 이유: 겹침 레인 분할·밀도 라벨·
 *  표시 범위(timeSpan) 계산이 전부 조각 단위라, 새 kind 하나면 셋이 공짜로 따라온다. */
type Seg =
  | { kind: 'block'; key: string; name: string; meta: string; color?: string }
  | { kind: 'study'; key: string; name: string; meta: string; color?: string; row: Extract<Row, { kind: 'study' }> }
  | { kind: 'task'; key: string; name: string; meta: string; color?: string; done: boolean }
  | { kind: 'event'; key: string; name: string; meta: string; color?: string };

/** 높이별 라벨 단계 — 담을 수 없는 라벨을 그리면 겹치고 잘린다.
 *  ~24px: 이름만(한 줄) · ~40px: 이름+시간 · 그 이상: 전부. */
type Dens = 'micro' | 'compact' | '';
function densOf(px: number): Dens {
  return px < 26 ? 'micro' : px < 44 ? 'compact' : '';
}
/** 조각 이름 클래스 — 밀도(micro=10px)·종류(block=옅은 600 · event=800 · 그 외 700)로 갈린다. */
function segNameCls(dens: Dens, kind: Seg['kind']): string {
  const weight =
    kind === 'block' ? 'font-semibold text-[color:var(--txt-84)]' : kind === 'event' ? 'font-extrabold' : 'font-bold';
  return `truncate leading-tight ${dens === 'micro' ? 'text-2xs' : 'text-xs'} ${weight}`;
}
/** 조각 메타 — compact/micro/모바일에서 감춘다(고정 셀에 겹쳐 잘림 방지). */
function segMetaCls(dens: Dens): string {
  return `truncate text-sched-meta leading-tight text-[color:var(--txt-82)] ${dens ? 'hidden' : ''} max-mobile:hidden`;
}

export function WeekCalendar({
  parts,
  nowMin,
  dows,
  deadlines,
  tasksByDay,
  onOpenDay,
}: {
  parts: DayData[];
  nowMin: number;
  dows: string[];
  deadlines: string[][];
  /** 요일별 타임박스된 자유 할일(계획개편 §5-3 오버레이). 시각 미지정은 여기 없음(일 뷰 트레이 소유). */
  tasksByDay?: Task[][];
  /** 요일 머리글·칸 클릭 → 그날 일 계획 창으로. 선택 상태(sel)를 두지 않는다 —
      같은 화면에 요약을 또 그리는 대신 편집까지 되는 일 뷰로 보낸다. */
  onOpenDay: (ds: string) => void;
}) {
  const toggleDone = useApp((st) => st.toggleDone);
  const state = useApp((st) => st.state);

  // 스크롤 컨테이너의 가용 높이 — 시간당 높이를 여기서 역산해 트랙이 프레임을 채우게 한다.
  // 내부 트랙 높이를 바꿔도 이 컨테이너 높이는 flex가 정하므로 관측 루프는 생기지 않는다.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [availH, setAvailH] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return; // jsdom 등 미지원 환경 → 고정 HOUR_H 폴백
    const ro = new ResizeObserver(([e]) => setAvailH(e!.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const todayIdx = parts.findIndex((p) => p.isToday);

  // 요일별 조각 — 시간이 있는 것만 시간축에 올린다(미배치 학습은 종일 행으로).
  const colSegs = parts.map((p, k) => {
    const segs: { item: Seg; start: number; end: number }[] = [];
    for (let i = 0; i < p.rows.length; i++) {
      const r = p.rows[i]!;
      if (r.kind === 'block' && r.start != null) {
        const cat = r.btype && r.btype !== r.name ? r.btype : '';
        segs.push({
          item: {
            kind: 'block',
            key: `b${i}`,
            name: r.name,
            meta: `${cat ? cat + ' · ' : ''}${toHM(r.start)}–${toHM(r.end)}`,
            color: r.color,
          },
          start: r.start,
          end: r.end,
        });
      } else if (r.kind === 'study' && r.start != null && r.end != null) {
        segs.push({
          item: {
            kind: 'study',
            key: `s${i}`,
            name: r.it.name,
            meta: `${STYPE[r.it.type].label} · ${toHM(r.start)}`,
            color: r.it.color,
            row: r,
          },
          start: r.start,
          end: r.end,
        });
      }
    }
    for (const t of tasksByDay?.[k] ?? []) {
      if (t.start == null) continue;
      const dur = t.min || 30;
      segs.push({
        item: {
          kind: 'task',
          key: `t${t.id}`,
          name: t.title,
          meta: `할 일 · ${toHM(t.start)}`,
          /* ⚠⚠ **`sid` 로 재파생한다 — `t.color`(굳은 hex)를 읽지 않는다**(D2 · 2026-08-01).
             H13(2026-07-31)이 *"스키마 필드는 남기되 읽지 않는다"* 라 못박고 **writer 만** 닫아서,
             그 이전에 만들어진 할 일은 여전히 옛 hex 를 들고 있었다 → 같은 할 일이 **일 뷰에선
             현재 파생색**(`DayPlanner.segColor`)으로, **주 뷰에선 옛 색**으로 그려졌고 노브
             (`SUBJECT_L`·`SUBJECT_C`) 교체가 주 뷰에 영원히 도달하지 않았다.
             reader 를 닫는 것이 마이그레이션을 대신한다(절대규칙 #3 — 색은 저장값이 아니다). */
          color: t.sid ? itemById(state, t.sid)?.color : undefined,
          done: !!t.done,
        },
        start: t.start,
        end: t.start + dur,
      });
    }
    // 일정 — 완료 개념이 없는 '그 시각에 일어나는 것'. 시각이 반드시 있어 종일 행으로 새지 않는다.
    for (const ev of eventsForDay(state, p.ds)) {
      segs.push({
        /* ⚠ 색을 안 싣는다(D2) — 일정색은 `--event` 토큰 하나이고 아래 렌더가 클래스로 준다
           (`[--seg:var(--event)]`). 인라인으로 실으면 **인라인이 클래스를 이겨** 그 일정만 갈린다. */
        item: { kind: 'event', key: `e${ev.id}`, name: ev.title, meta: `일정 · ${toHM(ev.start)}` },
        start: ev.start,
        end: ev.start + ev.min,
      });
    }
    return packLanes(segs);
  });

  // 표시 범위 — 이 주의 실제 일정에 맞춰 좁힌다.
  const allMins = colSegs.flatMap((segs) => segs.flatMap((p) => [p.start, p.end]));
  if (todayIdx >= 0) allMins.push(nowMin);
  const { lo, hi } = timeSpan(allMins, SPAN_OPTS);
  const nightLo = Math.min(lo, NIGHT_END); // 범위가 심야를 포함할 때만 압축이 의미 있다
  const nightSpan = Math.max(0, NIGHT_END - lo);
  const nightPx = nightSpan > 0 ? NIGHT_H : 0;

  // 시간당 높이 — **프레임에서 역산**한다. 심야를 한 칸으로 접고도 트랙이 화면보다 짧으면
  // 아래가 통째로 비었다(사용자 지적: "00시부터 07까지 간소화 했으면 남은 시간이 시간당 간격이
  // 커지면서 페이지에 꽉차게 되야하는거 아닌가?"). 이제 남는 높이를 시간 행이 나눠 갖는다.
  // ⚠ 바닥은 HOUR_H로 고정 — 그 아래로는 절대 안 눌린다(v5가 비율 배치를 걷어낸 이유). 넘치면 스크롤.
  const fullHours = Math.max(0, (hi - Math.max(lo, NIGHT_END)) / 60);
  const hourH = availH > 0 && fullHours > 0 ? Math.max(HOUR_H, (availH - nightPx) / fullHours) : HOUR_H;

  /** 분 → y(px). lo 기준. 심야 구간(lo~07)은 한 칸으로 압축, 그 뒤는 1시간=hourH 선형. */
  const yOf = (min: number): number => {
    const m = Math.max(lo, Math.min(hi, min));
    if (nightSpan > 0 && m <= NIGHT_END) return ((m - nightLo) / nightSpan) * nightPx;
    return nightPx + ((m - Math.max(lo, NIGHT_END)) / 60) * hourH;
  };
  const spanPx = yOf(hi);

  // 라벨·격자선 — 압축된 심야는 시작점 하나만, 그 뒤는 매시.
  const firstFull = Math.max(lo, nightSpan > 0 ? NIGHT_END : lo) / 60;
  const hours = [
    ...(nightSpan > 0 ? [lo / 60] : []),
    ...Array.from({ length: Math.round(hi / 60 - firstFull) + 1 }, (_, i) => firstFull + i),
  ];

  return (
    <div className={CAL.cal}>
      {/* 요일 머리글 — 스크롤과 무관하게 고정(어느 열을 보는지 잃지 않게). */}
      <div className={CAL.head}>
        <span className={CAL.gutterHead} />
        {parts.map((p, k) => (
          <button
            key={p.ds}
            type="button"
            className={CAL.dayHead}
            onClick={() => onOpenDay(p.ds)}
            /* 오늘은 액센트 알약(색)으로만 말하면 색각·스크린리더에 전달되지 않는다 → 역할과 라벨 양쪽에 실는다. */
            aria-current={p.isToday ? 'date' : undefined}
            aria-label={`${dows[k]} ${p.date.getMonth() + 1}/${p.date.getDate()}${p.isToday ? ' (오늘)' : ''} · 배정 ${hNum(p.used)}시간 — 이 날 계획 열기`}
          >
            <span className={`${CAL.dow} ${p.isToday ? 'text-acc' : 'text-mut'}`}>{dows[k]}</span>
            <span className={`${CAL.date} ${p.isToday ? CAL.dateToday : ''}`}>{p.date.getDate()}</span>
            <span className={`${CAL.dayH} ${p.over ? 'font-extrabold text-bad' : 'text-mut'}`}>{hLabel(p.used)}</span>
          </button>
        ))}
      </div>

      {/* 종일 행 — 시각이 없는 것(마감·미배치 학습)을 시간축에서 분리. 비어 있으면 렌더하지 않는다. */}
      {parts.some(
        (p, k) => (deadlines[k]?.length ?? 0) > 0 || p.rows.some((r) => r.kind === 'study' && r.start == null),
      ) && (
        <div className={CAL.allday}>
          <span className={CAL.alldayLab}>종일</span>
          {parts.map((p, k) => {
            const dls = deadlines[k] ?? [];
            const unplaced = p.rows.reduce((n, r) => n + (r.kind === 'study' && r.start == null ? 1 : 0), 0);
            return (
              // 클릭 핸들러를 걷어냈다 — role="presentation"("의미 없음")을 선언한 채 클릭 동작을 갖는 건
              // 명백한 역할 거짓이고, 포커스도 못 받아 키보드로는 애초에 닿지 않았다.
              // 같은 동작(그날 계획 열기)은 위 요일 머리글 버튼과 아래 '미배치' 버튼이 정직하게 제공한다.
              <div key={p.ds} className={CAL.alldayCell}>
                {dls.map((name) => (
                  <span key={name} className={`${CAL.chipBase} ${CAL.chipDeadline}`} title={`마감: ${name}`}>
                    <Icon name="flag" /> {name}
                  </span>
                ))}
                {unplaced > 0 && (
                  <button
                    type="button"
                    className={CAL.chipUnplaced}
                    onClick={() => onOpenDay(p.ds)}
                    title={`미배치 학습 ${unplaced}개 — 가용시간을 넘겨 시각을 못 잡았어요. 아젠다에서 확인`}
                    aria-label={`${dows[k]} 미배치 학습 ${unplaced}개 — 아젠다 열기`}
                  >
                    미배치 {unplaced}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 시간 격자 — 1시간=hourH(프레임에서 역산, 하한 HOUR_H). 세로 스크롤은 이 컨테이너가 소유(머리글 고정). */}
      <div className={CAL.scroll} ref={scrollRef}>
        <div className={CAL.grid} style={{ height: spanPx }}>
          <div className={CAL.gutter}>
            {hours.map((h) => (
              <span key={h} className={CAL.hourLab} style={{ top: yOf(h * 60) }}>
                {pad2(h)}
              </span>
            ))}
          </div>

          <div className={CAL.cols}>
            {/* 격자선 — 열 뒤에 한 벌만(열마다 그리면 DOM이 7배). */}
            <div className={CAL.lines} aria-hidden="true">
              {hours.map((h) => (
                <span key={h} className={CAL.lineH} style={{ top: yOf(h * 60) }} />
              ))}
              {/* 30분 보조선은 압축 구간(심야)엔 그리지 않는다 — 1시간 높이에 여러 줄이 들어가 격자가 뭉갠다. */}
              {hours
                .filter((h) => h * 60 >= Math.max(lo, NIGHT_END) && h * 60 + 30 < hi)
                .map((h) => (
                  <span key={`half${h}`} className={CAL.lineHalf} style={{ top: yOf(h * 60 + 30) }} />
                ))}
            </div>

            {parts.map((p, k) => {
              const isPast = todayIdx >= 0 && k < todayIdx;
              return (
                // 종일 칸과 같은 이유로 클릭 핸들러 제거(선언한 역할 = 실제 동작). 이 칸은 순수 배치 컨테이너다.
                <div key={p.ds} className={`${CAL.col} ${isPast ? 'opacity-[0.55]' : ''}`}>
                  {colSegs[k]!.map((pl) => {
                    const e = pl.item;
                    const top = yOf(pl.start);
                    const h = Math.max(14, yOf(pl.end) - top - 2);
                    const past = isPast || (p.isToday && nowMin >= pl.end);
                    // 레인 폭 — 겹친 만큼만 나눈다. 뒤 레인은 1.5% 겹쳐 깔아 카드 두께가 보이게(캘린더 관용구).
                    const w = 100 / pl.lanes;
                    const style = {
                      top,
                      height: h,
                      left: `${pl.lane * w}%`,
                      width: `calc(${w}% - 3px)`,
                      ...(e.color ? { ['--seg']: e.color } : {}),
                    } as React.CSSProperties;
                    const dens = densOf(h);
                    const pad = dens === 'micro' ? SEG_PAD.micro : e.kind === 'event' ? SEG_PAD.event : SEG_PAD.base;

                    if (e.kind === 'study') {
                      const x = e.row.it;
                      const done = isDone(state, p.ds, x.sid, x.type);
                      const tag = STYPE[x.type];
                      return (
                        <button
                          key={e.key}
                          type="button"
                          className={`${SEG_BASE} ${pad} ${SEG_KIND.study} ${SEG_TYPE[x.type]} hover:brightness-emph focus-visible:outline-offset-1! ${done || past ? 'ds-past' : ''}`}
                          style={style}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            const next = !done;
                            toggleDone(p.ds, x.sid, x.type, e.row.plannedMin, next);
                            if (next) ui.toast(`${x.name} · ${tag.label} 완료`, 'ok');
                          }}
                          aria-label={`${x.name} ${tag.label} ${toHM(pl.start)} 완료 토글`}
                          aria-pressed={done}
                          data-tip={`${x.name} · ${tag.label}\n${toHM(pl.start)}–${toHM(pl.end)}${x.chapters?.length ? '\n' + x.chapters.join(', ') : ''}`}
                          title={h < 26 ? `${x.name} · ${tag.label}` : undefined}
                        >
                          <span className={`${segNameCls(dens, 'study')} ${done ? 'ds-shed' : ''}`}>{e.name}</span>
                          <span className={segMetaCls(dens)}>{e.meta}</span>
                        </button>
                      );
                    }
                    if (e.kind === 'event') {
                      // 일정은 **완료 토글이 없다**(체크하는 것이 아니라 그 시각에 일어나는 것) →
                      // 학습 조각의 클릭=토글 계약을 옮겨 붙이지 않는다. 대신 그날 일 뷰로 보낸다
                      // (요일 머리글·미배치 칩과 같은 목적지 = 한 화면에 요약을 또 그리지 않는다).
                      return (
                        <button
                          key={e.key}
                          type="button"
                          className={`${SEG_BASE} ${pad} ${SEG_KIND.event} [--seg:var(--event)] hover:brightness-emph focus-visible:outline-offset-1! ${past ? 'ds-past' : ''}`}
                          style={style}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            onOpenDay(p.ds);
                          }}
                          aria-label={`${e.name} 일정 ${toHM(pl.start)}–${toHM(pl.end)} — 이 날 계획 열기`}
                          data-tip={`${e.name} · 일정\n${toHM(pl.start)}–${toHM(pl.end)}`}
                          title={h < 26 ? `${e.name} · 일정` : undefined}
                        >
                          <span className={segNameCls(dens, 'event')}>{e.name}</span>
                          <span className={segMetaCls(dens)}>{e.meta}</span>
                        </button>
                      );
                    }
                    return (
                      // role 없는 div의 aria-label은 name-from-author 불허라 AT가 그냥 버린다
                      // ("접근성 있는 척"). 실제 role을 준다 — 이름+시간 두 조각을 한 덩어리로 묶은 group이고,
                      // 좁은 높이(.compact/.micro)에서 segMeta가 display:none으로 접근성 트리에서까지 사라지므로
                      // 라벨이 그 시간 정보를 유일하게 보전한다.
                      <div
                        key={e.key}
                        role="group"
                        className={`${SEG_BASE} ${pad} ${e.kind === 'task' ? SEG_KIND.task : SEG_KIND.block} ${(e.kind === 'task' && e.done) || past ? 'ds-past' : ''}`}
                        style={style}
                        data-tip={`${e.name}\n${e.meta}`}
                        title={h < 26 ? e.name : undefined}
                        aria-label={`${e.name} ${e.meta}`}
                      >
                        <span className={`${segNameCls(dens, e.kind)} ${e.kind === 'task' && e.done ? 'ds-shed' : ''}`}>
                          {e.name}
                        </span>
                        <span className={segMetaCls(dens)}>{e.meta}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {/* 현재 시각 — 열 위를 가로지르는 한 줄(오늘 열만 강조점). */}
            {todayIdx >= 0 && nowMin >= lo && nowMin <= hi && (
              <span className={CAL.now} style={{ top: yOf(nowMin) }} aria-hidden="true">
                <span className={CAL.nowCap}>{toHM(nowMin)}</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
