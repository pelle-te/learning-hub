/* ============================================================
   WeekCalendar — 주간 캘린더(재개편 v4 전면 재작성 · TickTick/Google 캘린더 규약).
   옛 구현의 한계를 셋 다 걷어냈다:
     ① 3시간 격자 + 높이 100% 비율 배치 → **1시간 = 고정 픽셀** 스크롤 격자.
        비율 배치는 하루를 화면에 욱여넣어 30분짜리가 몇 px로 뭉개졌다(이름도 못 읽힘).
     ② 겹치는 일정이 서로를 가림 → lib/scheduleView의 packLanes로 **레인 분할**(나란히).
     ③ 마감·미배치가 시간축 안에 섞임 → 상단 **종일 행**으로 분리(시간 없는 것은 시간축에 두지 않는다).
   추가: 30분 보조선 · 현재 시각 라인 + 시각 배지 · 마운트 시 '지금'으로 자동 스크롤.
   순수 표현 — DayData[]는 Schedule이 준비. 학습 블록 클릭 = 완료 토글(기존 계약 유지).
============================================================ */
import { useEffect, useRef } from 'react';
import { useApp } from '@/store/useApp';
import { ui } from '@/shell';
import { isDone } from '@/lib/persistence';
import { toHM } from '@/lib/utils';
import { SESSION_TYPE_META as STYPE, packLanes, type DayData, type Row } from '@/lib/scheduleView';
import type { Task } from '@/lib/types';
import s from './WeekCalendar.module.css';

/** 1시간 = 몇 px. 44면 30분 일정이 22px — 이름 한 줄이 겨우 들어가는 하한이라 이보다 낮추지 말 것. */
const HOUR_H = 48;
const DAY_H = 24 * HOUR_H;

/** 그릴 수 있는 조각(블록·학습·할일 공통) — packLanes에 넣기 위한 정규화 형태. */
type Seg =
  | { kind: 'block'; key: string; name: string; meta: string; color?: string }
  | { kind: 'study'; key: string; name: string; meta: string; color?: string; row: Extract<Row, { kind: 'study' }> }
  | { kind: 'task'; key: string; name: string; meta: string; color?: string; done: boolean };

/** 높이별 라벨 단계 — 담을 수 없는 라벨을 그리면 겹치고 잘린다.
 *  ~24px: 이름만(한 줄) · ~40px: 이름+시간 · 그 이상: 전부. */
function densityCls(px: number): string {
  return px < 26 ? ' ' + s.micro : px < 44 ? ' ' + s.compact : '';
}

export function WeekCalendar({
  parts,
  sel,
  onSelect,
  nowMin,
  dows,
  deadlines,
  tasksByDay,
}: {
  parts: DayData[];
  sel: number;
  onSelect: (k: number) => void;
  nowMin: number;
  dows: string[];
  deadlines: string[][];
  /** 요일별 타임박스된 자유 할일(계획개편 §5-3 오버레이). 시각 미지정은 여기 없음(일 뷰 트레이 소유). */
  tasksByDay?: Task[][];
}) {
  const toggleDone = useApp((st) => st.toggleDone);
  const state = useApp((st) => st.state);
  const scrollRef = useRef<HTMLDivElement>(null);
  const didScroll = useRef(false);

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
          color: t.color,
          done: !!t.done,
        },
        start: t.start,
        end: t.start + dur,
      });
    }
    return packLanes(segs);
  });

  // 마운트 시 '지금'(오늘이 이 주에 없으면 첫 일정)으로 스크롤 — 하루 24시간을 다 보여주면
  // 정작 볼 시간대가 화면 밖이다. 1회만(사용자가 스크롤한 뒤 되돌리지 않게).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || didScroll.current) return;
    const firstStart = Math.min(
      ...colSegs.flatMap((segs) => segs.map((p) => p.start)),
      todayIdx >= 0 ? nowMin : Infinity,
    );
    const focusMin = Number.isFinite(firstStart) ? firstStart : 8 * 60;
    // scrollTop 직접 대입 — 초기 위치라 애니메이션이 불필요하고, jsdom엔 Element.scrollTo가 없어
    // scrollTo를 쓰면 테스트에서 컴포넌트가 통째로 터진다(실제로 그렇게 깨졌다).
    el.scrollTop = Math.max(0, (focusMin / 60) * HOUR_H - HOUR_H);
    didScroll.current = true;
  }, [colSegs, nowMin, todayIdx]);

  const hours = Array.from({ length: 25 }, (_, h) => h);

  return (
    <div className={s.cal}>
      {/* 요일 머리글 — 스크롤과 무관하게 고정(어느 열을 보는지 잃지 않게). */}
      <div className={s.head}>
        <span className={s.gutterHead} />
        {parts.map((p, k) => (
          <button
            key={p.ds}
            type="button"
            className={`${s.dayHead}${p.isToday ? ' ' + s.today : ''}${k === sel ? ' ' + s.sel : ''}`}
            onClick={() => onSelect(k)}
            aria-label={`${dows[k]} ${p.date.getMonth() + 1}/${p.date.getDate()} · 배정 ${(p.used / 60).toFixed(1)}시간`}
            aria-pressed={k === sel}
          >
            <span className={s.dow}>{dows[k]}</span>
            <span className={s.date}>{p.date.getDate()}</span>
            <span className={`${s.dayH}${p.over ? ' ' + s.over : ''}`}>{(p.used / 60).toFixed(1)}h</span>
          </button>
        ))}
      </div>

      {/* 종일 행 — 시각이 없는 것(마감·미배치 학습)을 시간축에서 분리. 비어 있으면 렌더하지 않는다. */}
      {parts.some(
        (p, k) => (deadlines[k]?.length ?? 0) > 0 || p.rows.some((r) => r.kind === 'study' && r.start == null),
      ) && (
        <div className={s.allday}>
          <span className={s.alldayLab}>종일</span>
          {parts.map((p, k) => {
            const dls = deadlines[k] ?? [];
            const unplaced = p.rows.reduce((n, r) => n + (r.kind === 'study' && r.start == null ? 1 : 0), 0);
            return (
              <div
                key={p.ds}
                className={`${s.alldayCell}${p.isToday ? ' ' + s.today : ''}${k === sel ? ' ' + s.sel : ''}`}
                onClick={() => onSelect(k)}
                role="presentation"
              >
                {dls.map((name) => (
                  <span key={name} className={s.chipDeadline} title={`마감: ${name}`}>
                    🚩 {name}
                  </span>
                ))}
                {unplaced > 0 && (
                  <button
                    type="button"
                    className={s.chipUnplaced}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(k);
                    }}
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

      {/* 시간 격자 — 1시간 고정 픽셀. 세로 스크롤은 이 컨테이너가 소유(머리글은 위에 고정). */}
      <div className={s.scroll} ref={scrollRef}>
        <div className={s.grid} style={{ height: DAY_H }}>
          <div className={s.gutter}>
            {hours.slice(0, 24).map((h) => (
              <span key={h} className={s.hourLab} style={{ top: h * HOUR_H }}>
                {String(h).padStart(2, '0')}
              </span>
            ))}
          </div>

          <div className={s.cols}>
            {/* 격자선 — 열 뒤에 한 벌만(열마다 그리면 DOM이 7배). */}
            <div className={s.lines} aria-hidden="true">
              {hours.map((h) => (
                <span key={h} className={s.lineH} style={{ top: h * HOUR_H }} />
              ))}
              {hours.slice(0, 24).map((h) => (
                <span key={`half${h}`} className={s.lineHalf} style={{ top: h * HOUR_H + HOUR_H / 2 }} />
              ))}
            </div>

            {parts.map((p, k) => {
              const isPast = todayIdx >= 0 && k < todayIdx;
              return (
                <div
                  key={p.ds}
                  className={`${s.col}${p.isToday ? ' ' + s.today : ''}${k === sel ? ' ' + s.sel : ''}${isPast ? ' ' + s.colPast : ''}`}
                  onClick={() => onSelect(k)}
                  role="presentation"
                >
                  {colSegs[k]!.map((pl) => {
                    const e = pl.item;
                    const top = (pl.start / 60) * HOUR_H;
                    const h = Math.max(14, ((pl.end - pl.start) / 60) * HOUR_H - 2);
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
                    const dens = densityCls(h);

                    if (e.kind === 'study') {
                      const x = e.row.it;
                      const done = isDone(state, p.ds, x.sid, x.type);
                      const tag = STYPE[x.type];
                      return (
                        <button
                          key={e.key}
                          type="button"
                          className={`${s.seg} ${s.study} ${s[tag.cls]}${dens}${done ? ' ' + s.done : ''}${past ? ' ' + s.segPast : ''}`}
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
                          <span className={s.segName}>{e.name}</span>
                          <span className={s.segMeta}>{e.meta}</span>
                        </button>
                      );
                    }
                    return (
                      <div
                        key={e.key}
                        className={`${s.seg} ${e.kind === 'task' ? s.task : s.block}${dens}${e.kind === 'task' && e.done ? ' ' + s.done : ''}${past ? ' ' + s.segPast : ''}`}
                        style={style}
                        data-tip={`${e.name}\n${e.meta}`}
                        title={h < 26 ? e.name : undefined}
                        aria-label={`${e.name} ${e.meta}`}
                      >
                        <span className={s.segName}>{e.name}</span>
                        <span className={s.segMeta}>{e.meta}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {/* 현재 시각 — 열 위를 가로지르는 한 줄(오늘 열만 강조점). */}
            {todayIdx >= 0 && (
              <span className={s.now} style={{ top: (nowMin / 60) * HOUR_H }} aria-hidden="true">
                <span className={s.nowCap}>{toHM(nowMin)}</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
