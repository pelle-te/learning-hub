/* ============================================================
   WeekCalendar — 주간 스케줄 시그니처(전면 재발명). 요일 7열 × 시간축 세로 그리드.
   프리미엄 캘린더(Cron/Amie)처럼 학습·일과 블록이 시간 위치에 네온 카드로 떠 있다.
   학습 블록 클릭 = 완료 토글(아젠다 체크 기능 흡수). 오늘 열 강조 + 지금 라인.
   순수 표현 — DayData[]는 Schedule이 준비. 시간 범위는 주 전체 세그를 3시간 격자로 스냅.
============================================================ */
import { useApp } from '@/store/useApp';
import { isDone } from '@/lib/persistence';
import { toHM } from '@/lib/utils';
import { SESSION_TYPE_META as STYPE, type DayData } from '@/lib/scheduleView';
import s from './WeekCalendar.module.css';

function hh(min: number): string {
  return String(Math.floor(min / 60)).padStart(2, '0');
}

/** 짧은 세그 단계별 라벨 감춤 — 45분 미만 compact(메타 숨김) · 25분 미만 micro(이름까지 숨김).
 *  높이가 라벨을 못 담아 겹침·잘림이 나던 것을 방지. micro는 컬러 엣지/틴트만 남고 hover(title)로 확인. */
function sizeCls(dur: number): string {
  return dur < 25 ? ' ' + s.micro : dur < 45 ? ' ' + s.compact : '';
}

export function WeekCalendar({
  parts,
  sel,
  onSelect,
  nowMin,
  dows,
  deadlines,
}: {
  parts: DayData[];
  sel: number;
  onSelect: (k: number) => void;
  nowMin: number;
  dows: string[];
  deadlines: string[][];
}) {
  const toggleDone = useApp((st) => st.toggleDone);
  const state = useApp((st) => st.state);

  // 주 전체 세그 시간 범위 → 3시간 격자 스냅(기본 06–24). 모든 열이 같은 축을 공유.
  const mins: number[] = [];
  parts.forEach((p) =>
    p.rows.forEach((r) => {
      if (r.kind === 'block' && r.start != null) mins.push(r.start, r.end);
      else if (r.kind === 'study' && r.start != null && r.end != null) mins.push(r.start, r.end);
    }),
  );
  let lo = 6 * 60;
  let hi = 24 * 60;
  if (mins.length) {
    lo = Math.min(lo, Math.min(...mins));
    hi = Math.max(hi, Math.max(...mins));
  }
  lo = Math.max(0, Math.floor(lo / 180) * 180);
  hi = Math.min(1440, Math.ceil(hi / 180) * 180);
  const span = Math.max(1, hi - lo);
  const pos = (m: number) => ((Math.max(lo, Math.min(hi, m)) - lo) / span) * 100;
  const ticks: number[] = [];
  for (let m = lo; m <= hi + 1; m += 180) ticks.push(m);
  // 오늘 기준 — 지난 요일/지난 블록은 흐리게(오늘의 흐름과 같은 시간 감각). 오늘 이전 열 = 과거.
  const todayIdx = parts.findIndex((p) => p.isToday);

  return (
    <div className={s.cal}>
      {/* 요일 머리글 */}
      <div className={s.head}>
        <span className={s.gutterHead} />
        {parts.map((p, k) => (
          <button
            key={p.ds}
            type="button"
            className={`${s.dayHead}${p.isToday ? ' ' + s.today : ''}${k === sel ? ' ' + s.sel : ''}`}
            onClick={() => onSelect(k)}
            aria-label={`${dows[k]} ${p.date.getMonth() + 1}/${p.date.getDate()} · 배정 ${(p.used / 60).toFixed(1)}시간`}
          >
            <span className={s.dow}>{dows[k]}</span>
            <span className={s.date}>{p.date.getDate()}</span>
            <span className={`${s.dayH}${p.over ? ' ' + s.over : ''}`}>{(p.used / 60).toFixed(1)}h</span>
            {(deadlines[k]?.length ?? 0) > 0 && <span className={s.flag} title={`마감: ${deadlines[k]!.join(', ')}`} />}
          </button>
        ))}
      </div>

      {/* 시간축 그리드 + 7열 */}
      <div className={s.body}>
        <div className={s.gutter}>
          {ticks.map((m) => (
            <span key={m} className={s.tick} style={{ top: `${pos(m)}%` }}>
              {hh(m)}
            </span>
          ))}
        </div>
        <div className={s.cols}>
          {parts.map((p, k) => {
            const isPast = todayIdx >= 0 && k < todayIdx;
            // 시각 못 잡은 학습 행(초과용량 → start:null) 개수. 타임라인엔 안 그려지므로 이중계상 아님.
            const unplaced = p.rows.reduce((n, r) => n + (r.kind === 'study' && r.start == null ? 1 : 0), 0);
            return (
              <div
                key={p.ds}
                className={`${s.col}${p.isToday ? ' ' + s.today : ''}${k === sel ? ' ' + s.sel : ''}${isPast ? ' ' + s.colPast : ''}`}
                onClick={() => onSelect(k)}
                role="presentation"
              >
                {ticks.map((m) => (
                  <span key={m} className={s.grid} style={{ top: `${pos(m)}%` }} />
                ))}
                {unplaced > 0 && (
                  <button
                    type="button"
                    className={s.unplaced}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(k);
                    }}
                    title={`미배치 학습 ${unplaced}개 — 아젠다에서 확인·체크`}
                    aria-label={`${dows[k]} 미배치 학습 ${unplaced}개 — 아젠다 열기`}
                  >
                    미배치 {unplaced}
                  </button>
                )}
                {p.rows.map((r, i) => {
                  // 지난 블록(과거 요일 전체 · 오늘이면 이미 끝난 시간)은 흐리게.
                  const segPast = (end: number) => isPast || (p.isToday && nowMin >= end);
                  if (r.kind === 'block' && r.start != null) {
                    const top = pos(r.start);
                    const h = Math.max(2.4, pos(r.end) - top);
                    const dur = r.end - r.start;
                    const cat = r.btype && r.btype !== r.name ? r.btype : '';
                    return (
                      <div
                        key={i}
                        className={`${s.seg} ${s.block}${sizeCls(dur)}${segPast(r.end) ? ' ' + s.segPast : ''}`}
                        style={{ top: `${top}%`, height: `${h}%`, ...(r.color ? { ['--seg']: r.color } : {}) }}
                        data-tip={`${r.name}\n${cat ? cat + ' · ' : ''}${toHM(r.start)}–${toHM(r.end)}`}
                        title={dur < 25 ? r.name : undefined}
                        aria-label={`${r.name}${cat ? ' · ' + cat : ''} ${toHM(r.start)}–${toHM(r.end)}`}
                      >
                        <span className={s.segName}>{r.name}</span>
                      </div>
                    );
                  }
                  if (r.kind === 'study' && r.start != null && r.end != null) {
                    const top = pos(r.start);
                    const h = Math.max(3, pos(r.end) - top);
                    const dur = r.end - r.start;
                    const x = r.it;
                    const tag = STYPE[x.type];
                    const done = isDone(state, p.ds, x.sid, x.type);
                    return (
                      <button
                        key={i}
                        type="button"
                        className={`${s.seg} ${s.study} ${s[tag.cls]}${sizeCls(dur)}${done ? ' ' + s.done : ''}${segPast(r.end) ? ' ' + s.segPast : ''}`}
                        style={{ top: `${top}%`, height: `${h}%`, ...(x.color ? { ['--seg']: x.color } : {}) }}
                        title={dur < 25 ? `${x.name} · ${tag.label}` : undefined}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleDone(p.ds, x.sid, x.type, r.plannedMin, !done);
                        }}
                        aria-label={`${x.name} ${tag.label} ${toHM(r.start)} 완료 토글`}
                        aria-pressed={done}
                        data-tip={`${x.name} · ${tag.label}\n${toHM(r.start)}–${toHM(r.end)}${x.chapters?.length ? '\n' + x.chapters.join(', ') : ''}`}
                      >
                        <span className={s.segName}>{x.name}</span>
                        <span className={s.segMeta}>
                          {tag.label} · {toHM(r.start)}
                        </span>
                      </button>
                    );
                  }
                  return null;
                })}
                {p.isToday && nowMin >= lo && nowMin <= hi && (
                  <span className={s.now} style={{ top: `${pos(nowMin)}%` }} aria-hidden="true" />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
