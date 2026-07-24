/* ============================================================
   ics.ts — 캘린더(.ics) 빌드 + 계획 서명(프레임워크 무관). 레거시 scheduler.js의 ICS 경로 이식.
   planSignature: 계획 입력의 가벼운 지문 → .ics 신선도 판정(F-10). 내보낼 때의 서명과 현재가 다르면
   스케줄 탭이 "재내보내기 필요"를 띄운다.
============================================================ */
import { schedule, layoutDay } from './scheduler';
import { iso, parseISO, hLabel, rid, pad2, minutesOfDay } from './utils';
import type { AppState } from './types';

function icsEsc(s: unknown): string {
  return (s ?? '').toString().replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}
/** 로컬 시각 → YYYYMMDDTHHMMSS(플로팅 로컬타임). */
function icsDt(ds: string, min: number): string {
  const d = parseISO(ds);
  // 자정 종료(min>=1440)는 iCalendar에서 불법인 24:00:00 → 다음날 00:00:00으로 정규화.
  // (늦은 모듈이 22:00–24:00처럼 wake1=1440까지 차면 DTEND가 T240000이 돼 엄격한 캘린더가 거부했다.)
  if (min >= 1440) {
    d.setDate(d.getDate() + Math.floor(min / 1440));
    min %= 1440;
  }
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}T${pad2(h)}${pad2(m)}00`;
}

const LABEL: Record<string, string> = {
  new: '📘 학습',
  rev: '🔁 복습',
  blank: '📝 백지복습',
  mock: '🧪 모의시험',
  anki: '🃏 Anki',
};

/** 현재 계획을 VCALENDAR 문자열로(학습 세션만 이벤트화). */
export function buildICS(state: AppState): string {
  const r = schedule(state);
  const now = new Date();
  const stamp = icsDt(iso(now), minutesOfDay(now));
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//러닝허브//KR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  (r.days || []).forEach((day) => {
    if (!day.items.length) return;
    const L = layoutDay(state, day);
    L.tl
      .filter((x) => x.kind === 'study' && x.start != null)
      .forEach((x, i) => {
        const label = LABEL[x.type || 'anki'] || '🃏 Anki';
        const ch = x.chapters && x.chapters.length ? ' — ' + x.chapters.join(', ') : '';
        lines.push(
          'BEGIN:VEVENT',
          `UID:${day.ds}-${x.sid}-${x.type}-${i}-${rid()}@studyplanner`,
          `DTSTAMP:${stamp}`,
          `DTSTART:${icsDt(day.ds, x.start as number)}`,
          `DTEND:${icsDt(day.ds, x.end as number)}`,
          `SUMMARY:${icsEsc(label + ' ' + x.name)}`,
          `DESCRIPTION:${icsEsc(x.name + ch + ' (' + hLabel((x.end as number) - x.start) + ')')}`,
          'END:VEVENT',
        );
      });
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

/** 계획에 영향을 주는 입력의 가벼운 지문 — .ics 신선도 판정용. */
export function planSignature(state: AppState): string {
  try {
    const it = (state.items || []).map((s) => [
      s.id,
      s.name,
      s.mode,
      s.weeklyHours,
      s.dailyMin,
      s.deadline,
      (s.chapters || []).map((c) => [c.name, c.hours, !!c.done]),
    ]);
    const rt = (state.routine || []).map((b) => [b.name, b.type, b.start, b.end, (b.days || []).join('')]);
    return JSON.stringify([
      it,
      rt,
      state.dayOverrides || {},
      state.moduleLen,
      state.reviewRatio,
      state.peakStart,
      state.peakEnd,
      state.blankReviewWeekly,
      state.mockEveryWeeks,
      state.reviewViaAnki,
      state.adaptiveCapacity,
      state.startDate,
    ]);
  } catch {
    return '';
  }
}
