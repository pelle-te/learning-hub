/* ============================================================
   scheduler/engine.ts — 통합 스케줄 엔진의 본체 schedule().

   하루 가용시간을 모듈(기본 2h)로 쪼개고, 과목의 '주당 목표 시간'만큼 모듈을 그 주에
   인터리빙·마감 우선으로 분배한다. 챕터 포인터가 전진하고, 복습은 배운 챕터를
   +1·3·7·16일에 생성 — 앵커는 실제 완료일(doneDs · ②#23). 백지복습 최근 실패 과목은
   단축 사다리(1·2·4·8·16)·통과 과목은 +34일 꼬리 1회로 적응. daily(Anki)는 매일 먼저 확보.

   ⚠ 이 파일은 회귀로 동결된 코어다. 동작은 scheduler.test.ts와 100% 동일하게 보존한다.
============================================================ */
import {
  REVIEW_OFFSETS,
  REVIEW_OFFSETS_WEAK,
  REVIEW_TAIL_OFFSET,
  addDays,
  clamp,
  dayDiff,
  iso,
  mondayOf,
  parseISO,
  round1,
  todayISO,
} from '../utils';
import { isWeekManaged } from '../weekAlloc';
import { dayStudyMin, studyMinByWeekday } from './windows';
import { adherenceFactor, itemTotalHours, latestBlank, masteryNeed } from './priority';
import { applyDayPlans, reseedManualReviews } from './dayPlanOverride';
import type { SchedSubject } from './types';
import type { AppState, Day, ItemStat, ScheduleResult } from '../types';

export function schedule(state: AppState): ScheduleResult {
  // 시작일 방어 — 사용자가 시작일을 빈 값으로 지우면 parseISO('')=Invalid → dayDiff=NaN →
  // horizon=Math.max(6,NaN)=NaN → 루프가 0회 → days=[]로 전 탭이 빈 화면이 됐다. 오늘로 폴백.
  const start = Number.isNaN(parseISO(state.startDate).getTime()) ? todayISO(state) : state.startDate;
  const items = state.items.filter((s) => s.name);
  const warnings: string[] = [];
  const capWd = studyMinByWeekday(state);
  const ML = state.moduleLen || 120;
  const revFrac = (state.reviewRatio || 0) / 100;
  const weeklyRaw = items.filter((s) => s.mode !== 'daily' && +(s.weeklyHours || 0) > 0);
  const daily = items.filter((s) => s.mode === 'daily' && +(s.dailyMin || 0) > 0);
  if (!items.length)
    return { days: [], itemStat: [], weekHours: {}, chapterLog: [], warnings, capUsed: 0, capTotal: 0, ML };

  /* 1) 기간(horizon) */
  const lastDL = items.reduce((m, s) => (s.deadline && s.deadline > m ? s.deadline : m), '');
  let weeksNeed = 8;
  weeklyRaw.forEach((s) => {
    const th = itemTotalHours(s);
    if (th > 0) weeksNeed = Math.max(weeksNeed, Math.ceil(th / Math.max(0.1, +(s.weeklyHours || 0))));
  });
  weeksNeed = Math.min(weeksNeed, 26);
  const endByPace = iso(addDays(mondayOf(parseISO(start)), weeksNeed * 7 + 6));
  const endDate = lastDL && lastDL > endByPace ? lastDL : endByPace;
  const today = todayISO(state);
  // 마감 경로도 상한(18개월) — 먼 미래 마감 하나가 수천 일 배열을 만들어 편집마다 재계산 지연.
  // X-10: 경과한 startDate/짧은·과거 계획(가벼운 콘텐츠·마감없음)이어도 표시창이 오늘을 포함하도록
  //       전방 확장 — 없으면 lastDay가 오늘 이전에서 끝나 복귀 사용자에게 빈 앱이 된다. 세 번째 항이
  //       오늘까지 보장하며(동일 546 상한), 페이스 계산엔 개입하지 않는 표시-only 확장이다.
  // ⚠ 오늘 보장 항에 같은 546 상한을 걸면 보장 자체가 깨진다: startDate가 546일보다 더 과거면
  //   (예: 2024-01-01 시작 + 오늘 2026-07 = 929일) 배열이 오늘 *이전*에서 끝나 오늘 탭이 비고,
  //   그 상태로 편집하면 빈 자동초안이 manual로 승격돼 그날이 영구히 빈 계획이 된다.
  //   → 오늘 항은 별도의 넉넉한 상한(약 5년)을 쓴다. 상한을 아예 없애지 않는 이유는 startDate가
  //     쓰레기 값(1970-01-01 등)일 때 수만 일 배열이 생기는 것만 막기 위해서다.
  const PACE_HORIZON_MAX = 546; // 18개월 — 페이스/마감 경로(편집마다 재계산되므로 짧게)
  const TODAY_HORIZON_MAX = 1826; // 약 5년 — 표시-only 전방 확장의 안전 상한
  const horizon = Math.max(
    6,
    Math.min(dayDiff(start, endDate), PACE_HORIZON_MAX),
    Math.min(dayDiff(start, today), TODAY_HORIZON_MAX),
  );

  /* 2) 일자 생성 + (적응형) 가용 용량 */
  const adapt = adherenceFactor(state, start, horizon, capWd, today);
  const days: Day[] = [];
  for (let i = 0; i <= horizon; i++) {
    const date = addDays(parseISO(start), i);
    const ds = iso(date);
    const wd = date.getDay();
    let sMin = dayStudyMin(state, ds, wd, capWd);
    if (adapt < 1 && ds >= today) sMin = Math.round(sMin * adapt); // 오늘/미래만 축소(과거 원본 유지)
    days.push({ ds, date, wd, studyMin: sMin, used: 0, modLeft: 0, revLeft: 0, items: [] });
  }
  const adaptApplied = adapt < 1;

  /* 3) daily(Anki) 먼저 — 매일 고정 분 확보 */
  daily.forEach((s) => {
    const dlIdx = clamp(s.deadline ? dayDiff(start, s.deadline) : horizon, 0, days.length - 1);
    for (let j = 0; j <= dlIdx; j++) {
      const d = days[j]!;
      if (d.studyMin - d.used <= 0) continue;
      const m = Math.min(+(s.dailyMin || 0), d.studyMin - d.used);
      if (m <= 0) continue;
      d.items.push({ type: 'anki', sid: s.id, name: s.name, min: Math.round(m), color: s.color });
      d.used += m;
    }
  });
  /* 남은 시간 → 학습 모듈 + 복습예산 */
  days.forEach((d) => {
    const rem = Math.max(0, d.studyMin - d.used);
    const learn = Math.round(rem * (1 - revFrac));
    d.modLeft = Math.floor(learn / ML); // 그날 가능한 학습 모듈 수
    d.revLeft = rem - d.modLeft * ML; // 나머지 = 복습예산
  });

  /* 4) 과목 진행 상태 초기화 (챕터 포인터) — done 챕터는 계획에서 제외 */
  const weekly: SchedSubject[] = weeklyRaw.map((it) => {
    const all = it.chapters || [];
    const chs = all.filter((c) => !c.done).map((c) => ({ name: c.name, hours: Math.max(0.1, +c.hours || 1) }));
    return {
      ...it,
      _allTotal: all.length,
      _done0: all.filter((c) => c.done).length,
      _hadChapters: all.length > 0,
      _chs: chs,
      _cum: 0,
      _idx: 0,
      _totalH: chs.reduce((t, c) => t + c.hours, 0),
      _dlIdx: it.deadline ? clamp(dayDiff(start, it.deadline), 0, days.length - 1) : horizon,
      _schedMin: 0,
      _sessions: [],
      _carry: 0,
      _masteryNeed: masteryNeed(state, it.name),
      _weekTgt: 0,
      _weekDone: 0,
    };
  });
  function advance(s: SchedSubject, addMin: number): string[] {
    if (!s._chs.length) return [];
    const addH = addMin / 60;
    const from = s._cum;
    const to = Math.min(s._totalH, s._cum + addH);
    const covered: string[] = [];
    let acc = 0;
    for (let k = 0; k < s._chs.length; k++) {
      const ch = s._chs[k]!;
      const cs = acc;
      const ce = acc + ch.hours;
      if (ce > from + 1e-6 && cs < to - 1e-6) {
        covered.push(ch.name);
        if (to >= ce - 1e-6) s._idx = Math.max(s._idx, k + 1);
      }
      acc = ce;
    }
    s._cum = to;
    return covered;
  }
  function chaptersLeft(s: SchedSubject): boolean {
    if (!s._hadChapters) return true; // 챕터 없는 과목: 무기한 진행
    if (!s._chs.length) return false; // 모든 챕터 완료
    return s._cum < s._totalH - 1e-6;
  }

  /* 5) 주(週) 단위 학습 모듈 배분 */
  interface ReviewTask {
    idx: number;
    sid: string;
    name: string;
    color?: string;
    chapters: string[];
    min: number;
  }
  const reviewTasks: ReviewTask[] = [];
  const reviewViaAnki = state.reviewViaAnki === true && daily.length > 0;
  const firstMon = mondayOf(parseISO(start));
  // 같은 날 같은 과목의 new는 **한 행**이어야 한다 — 완료 키가 `sid|type`이라 행이 2개면
  // 하나를 체크했을 때 다른 하나도 체크되는 충돌이 난다(rev 병합과 동일 불변식 · T28).
  // 배분(managed) 경로와 자동 분배 경로가 각자 같은 본문을 갖고 있었다 — 한쪽만 고치면 조용히 갈라지는 형태라 합친다.
  const pushNewBlock = (day: Day, s: SchedSubject, mins: number, covered: string[]): void => {
    const exNew = day.items.find((it) => it.type === 'new' && it.sid === s.id);
    if (exNew) {
      exNew.min += mins;
      covered.forEach((c) => {
        if (exNew.chapters && !exNew.chapters.includes(c)) exNew.chapters.push(c);
      });
      return;
    }
    day.items.push({
      type: 'new',
      sid: s.id,
      name: s.name,
      color: s.color,
      min: mins,
      chapters: covered.slice(),
      mod: true,
    });
  };

  // 복습 씨앗(그날 배운 챕터 근거) — 자동·배분 두 경로가 **같은 코드**로 예약해 산출 동형(회귀 안전).
  // reviewViaAnki면 Anki/FSRS 소유라 무동작(자동 경로의 기존 가드와 동일). 앵커=완료일(doneDs)·백지 성과 사다리 보존(②#23).
  const pushReviewTasks = (s: SchedSubject, di: number, covered: string[]): void => {
    if (reviewViaAnki) return;
    const comp = state.completions?.[days[di]!.ds]?.[s.id + '|new'];
    const anchor = comp?.done && comp.doneDs ? clamp(dayDiff(start, comp.doneDs), 0, days.length - 1) : di;
    const blank = latestBlank(state, s.id);
    const offsets =
      blank === false ? REVIEW_OFFSETS_WEAK : blank === true ? [...REVIEW_OFFSETS, REVIEW_TAIL_OFFSET] : REVIEW_OFFSETS;
    offsets.forEach((off) => {
      const ti = anchor + off;
      if (ti < days.length && ti <= s._dlIdx)
        reviewTasks.push({
          idx: ti,
          sid: s.id,
          name: s.name,
          color: s.color,
          chapters: covered.slice(),
          min: Math.max(15, Math.round(ML * 0.25)),
        });
    });
  };
  for (let w = 0; w * 7 <= horizon + 6; w++) {
    const wStart = addDays(firstMon, w * 7);
    const wk = iso(wStart);
    const widx: number[] = [];
    for (let k = 0; k < 7; k++) {
      const di = dayDiff(start, iso(addDays(wStart, k)));
      if (di >= 0 && di < days.length) widx.push(di);
    }
    if (!widx.length) continue;
    // ── 배분 주도(managed week, §12-4) — 그 주 weekAlloc가 있으면 사용자 요일 벡터로 new 블록을 구동. ──
    // 배분에 없는 sid는 그 주 0. 챕터 소진/마감 초과 셀은 스킵(경고는 보드 소관). 복습은 배치된 covered에서 자동(동일 헬퍼).
    // ⚠ weekAlloc 부재 시 이 분기 자체가 실행 안 됨 → 아래 else(자동)가 종전과 100% 동일(회귀 불변식).
    // managed 판정은 lib/weekAlloc.isWeekManaged 단일 술어 — 빈 주 객체(`weekAlloc[wk]={}`)는 managed가
    // 아니다. 예전엔 `{}`도 truthy라 이 분기가 전 과목 0분으로 돌며 그 주 new 블록을 무음 전멸시켰다.
    const alloc = state.weekAlloc?.[wk];
    if (alloc && isWeekManaged(state, wk)) {
      widx.forEach((di) => {
        const day = days[di]!;
        weekly.forEach((s) => {
          const mins = alloc[s.id]?.[day.wd] || 0;
          if (mins <= 0 || !chaptersLeft(s) || di > s._dlIdx) return;
          const covered = advance(s, mins);
          pushNewBlock(day, s, mins, covered);
          s._schedMin += mins;
          s._sessions.push({ di, ds: day.ds, chapters: covered });
          day.used += mins;
          pushReviewTasks(s, di, covered);
        });
      });
      continue; // 이 주는 배분 구동 완료 — 자동 분배 스킵.
    }
    // 과목별 이번 주 목표 모듈 — 분수 모듈을 캐리오버해 과/미배정 방지.
    // SD-4: 시작일이 월요일이 아니면 첫 주(w===0)는 부분주 — 7일치 목표를 짧은 첫 주에 통째로
    //       잡으면 미달충(정수 모듈 유실)되던 것을, 실제 가용 일수 비중(widx.length/7)만큼만
    //       앵커하고 나머지는 _carry로 이월한다. 온전한 주(widx.length===7)는 wkFrac=1로 무변경.
    const wkFrac = w === 0 ? widx.length / 7 : 1;
    weekly.forEach((s) => {
      if (!chaptersLeft(s)) {
        s._weekTgt = 0;
        s._weekDone = 0;
        return;
      }
      const perWeek = ((+(s.weeklyHours || 0) * 60) / ML) * wkFrac;
      const avail = s._carry + perWeek;
      const tgt = Math.floor(avail + 1e-9);
      s._carry = avail - tgt;
      s._weekTgt = tgt;
      s._weekDone = 0;
    });
    // 슬롯 채우기: 날짜순 → 마감 임박 & (그래프) 약한 & 덜 채운 과목
    let lastSid: string | null = null;
    widx.forEach((di) => {
      const day = days[di]!;
      let cap = day.modLeft;
      while (cap > 0) {
        const cand = weekly.filter((s) => s._weekDone < s._weekTgt && chaptersLeft(s) && di <= s._dlIdx);
        if (!cand.length) break;
        cand.sort((a, b) => {
          const ua = a._dlIdx - di;
          const ub = b._dlIdx - di; // ① 마감 임박(하드 제약)
          if (ua !== ub) return ua - ub;
          if (a._masteryNeed !== b._masteryNeed) return b._masteryNeed - a._masteryNeed; // ② 약한 과목
          return a._weekDone / a._weekTgt - b._weekDone / b._weekTgt; // ③ 덜 채운 과목
        });
        const pick = cand.find((s) => s.id !== lastSid) ?? cand[0]!; // 같은 과목 연속 회피
        const covered = advance(pick, ML);
        pushNewBlock(day, pick, ML, covered);
        pick._weekDone++;
        pick._schedMin += ML;
        pick._sessions.push({ di, ds: day.ds, chapters: covered });
        lastSid = pick.id;
        cap--;
        day.used += ML;
        // 복습 예약(그날 배운 챕터 근거) — 배분 경로와 공유하는 pushReviewTasks(reviewViaAnki 가드·완료일 앵커·백지 사다리 내장).
        pushReviewTasks(pick, di, covered);
      }
    });
  }

  /* 6) 복습 배치 — 복습예산 우선, 없으면 모듈 잔여, 그래도 없으면 여유 큰 날. "no silent caps". */
  reviewTasks.sort((a, b) => a.idx - b.idx);
  let revMissed = 0;
  let revOver = 0;
  reviewTasks.forEach((t) => {
    const end = Math.min(days.length - 1, t.idx + 6);
    let tg = -1;
    for (let j = t.idx; j <= end; j++)
      if (days[j]!.revLeft >= t.min) {
        tg = j;
        break;
      }
    if (tg < 0)
      for (let j = t.idx; j <= end; j++)
        if (days[j]!.studyMin - days[j]!.used >= t.min) {
          tg = j;
          break;
        }
    if (tg < 0) {
      let br = -1;
      for (let j = t.idx; j <= end; j++) {
        const rm = days[j]!.studyMin - days[j]!.used;
        if (rm > br) {
          br = rm;
          tg = j;
        }
      }
    }
    if (tg < 0) {
      revMissed++;
      return;
    } // 창 안 모든 날 초과 → 미배치
    if (days[tg]!.studyMin - days[tg]!.used < t.min) revOver++; // 여유 없는 날에 넘겨 끼움
    const d = days[tg]!;
    const ex = d.items.find((it) => it.type === 'rev' && it.sid === t.sid);
    if (ex) {
      ex.min += t.min;
      t.chapters.forEach((c) => {
        if (ex.chapters && !ex.chapters.includes(c)) ex.chapters.push(c);
      });
    } else {
      d.items.push({ type: 'rev', sid: t.sid, name: t.name, color: t.color, min: t.min, chapters: t.chapters.slice() });
    }
    d.used += t.min;
    d.revLeft = Math.max(0, d.revLeft - t.min);
  });
  if (revMissed > 0)
    warnings.push(
      `⚠ 복습 ${revMissed}개가 용량 부족으로 미배치됐어요 — 주당 시간↑·복습비중↑ 또는 가용시간 확보를 검토하세요.`,
    );
  if (revOver > 0)
    warnings.push(
      `⚠ 복습 ${revOver}개가 여유 없는 날에 끼워졌어요(그날 계획이 가용시간을 초과) — 일부 복습을 줄이거나 날을 비우세요.`,
    );

  /* 6.5) 백지 복습(방법론 9절) — 단원(챕터) 단위로 마지막 학습 직후 여유 날에 1개씩. */
  if (state.blankReviewWeekly === true) {
    const blankMin = Math.max(30, Math.round(ML * 0.4));
    interface BlankTask {
      afterIdx: number;
      sid: string;
      name: string;
      color?: string;
      chapters: string[];
      min: number;
    }
    const blankTasks: BlankTask[] = [];
    weekly.forEach((s) => {
      const lastDiOf: Record<string, number> = {};
      (s._sessions || []).forEach((se) => {
        (se.chapters || []).forEach((c) => {
          lastDiOf[c] = Math.max(lastDiOf[c] == null ? -1 : lastDiOf[c], se.di);
        });
      });
      Object.keys(lastDiOf).forEach((ch) => {
        blankTasks.push({
          afterIdx: lastDiOf[ch]!,
          sid: s.id,
          name: s.name,
          color: s.color,
          chapters: [ch],
          min: blankMin,
        });
      });
    });
    blankTasks.sort((a, b) => a.afterIdx - b.afterIdx);
    blankTasks.forEach((t) => {
      const end = Math.min(days.length - 1, t.afterIdx + 6);
      let tg = -1; // 학습 직후 며칠 내 여유 큰 날 — 뒤에서부터
      for (let j = end; j >= t.afterIdx; j--) {
        if (days[j]!.studyMin - days[j]!.used >= t.min) {
          tg = j;
          break;
        }
      }
      if (tg < 0) return; // 용량 없으면 건너뜀(과적재 방지)
      days[tg]!.items.push({
        type: 'blank',
        sid: t.sid,
        name: t.name,
        color: t.color,
        min: t.min,
        chapters: t.chapters.slice(),
      });
      days[tg]!.used += t.min;
    });
  }

  /* 6.6) 모의시험(방법론 12절) — N주마다 1회, 그 주말 여유 날에 1모듈. */
  const mockN = +state.mockEveryWeeks || 0;
  if (mockN > 0) {
    for (let w = 0; w * 7 <= horizon + 6; w++) {
      if ((w + 1) % mockN !== 0) continue;
      const wStart = addDays(firstMon, w * 7);
      let tg = -1;
      for (let k = 6; k >= 0; k--) {
        const di = dayDiff(start, iso(addDays(wStart, k)));
        if (di < 0 || di >= days.length) continue;
        if (days[di]!.studyMin - days[di]!.used >= ML) {
          tg = di;
          break;
        }
      }
      if (tg < 0) continue;
      const learnedBefore = days.slice(0, tg + 1).some((d) => d.items.some((it) => it.type === 'new'));
      if (!learnedBefore) continue; // 배운 게 있어야 모의시험 의미
      // color 없음 — 모의는 연결된 과목이 없어 팔레트 색이 없다. 색 리터럴을 산출물에 굳히면
      // 인라인 --seg가 뷰의 .mock 토큰(var(--bad))을 덮어 절대규칙 3(색=PALETTE 파생)을 깬다.
      // 표시는 type==='mock' 플래그 → CSS 토큰이 담당(DayPlanner·WeekCalendar 동일 규약).
      days[tg]!.items.push({ type: 'mock', sid: 'mock', name: '모의시험', min: ML, chapters: [] });
      days[tg]!.used += ML;
    }
  }

  /* 6.9) 일일 배치 오버라이드(§4-2) — manual인 날의 items를 사용자 배치로 치환.
     무 dayPlans면 무동작(자동 불변). 이후 통계·주별시간·cap이 최종 items를 반영. */
  applyDayPlans(state, days);
  /* 6.95) 복습 재씨앗(§4-3) — 수동 new 블록의 하류 복습 보강. manual 날 없으면 무동작(자동 불변). */
  reseedManualReviews(state, days, start, ML, reviewViaAnki);

  /* 7) 통계 */
  const itemStat: ItemStat[] = weekly.map((s) => {
    const total = s._allTotal;
    const doneCh = Math.min(s._done0 + s._idx, total);
    let lastIdx = -1;
    for (let j = days.length - 1; j >= 0; j--)
      if (days[j]!.items.some((it) => it.sid === s.id && it.type === 'new')) {
        lastIdx = j;
        break;
      }
    const finishDate = lastIdx >= 0 ? days[lastIdx]!.ds : null;
    const finished = !chaptersLeft(s);
    const late = finished && finishDate && s.deadline ? Math.max(0, dayDiff(s.deadline, finishDate)) : 0;
    // _hadChapters 가드 — 챕터 없는 과목은 chaptersLeft()가 늘 true라 finished가 영영 false다.
    // 그 상태에서 마감만 있으면 "다 못 끝내요" 경고가 영구히 뜨는 오탐이라 실제 챕터가 있던 과목만 경고.
    if (s.deadline && s._hadChapters && !finished)
      warnings.push(`⚠ "${s.name}": 마감(${s.deadline})까지 주 ${s.weeklyHours}h로는 챕터를 다 못 끝내요. 주당 시간↑.`);
    else if (late > 0) warnings.push(`⚠ "${s.name}": 학습 종료(${finishDate})가 마감(${s.deadline}) 초과.`);
    return {
      id: s.id,
      name: s.name,
      color: s.color,
      weeklyHours: +(s.weeklyHours || 0),
      totalCh: total,
      doneCh,
      totalH: round1(s._totalH),
      schedH: round1(s._schedMin / 60),
      deadline: s.deadline,
      finishDate,
      finished,
      late,
    };
  });
  daily.forEach((s) => {
    const planned = days.filter((d) => d.items.some((it) => it.sid === s.id)).length;
    itemStat.push({
      id: s.id,
      name: s.name,
      color: s.color,
      daily: true,
      dailyMin: +(s.dailyMin || 0),
      days: planned,
      schedH: round1((planned * +(s.dailyMin || 0)) / 60),
    });
  });

  /* 주별 과목 시간 + 챕터 학습 로그 */
  const weekHours: Record<string, Record<string, number>> = {};
  const chapterLog: ScheduleResult['chapterLog'] = [];
  days.forEach((d) => {
    const wk = iso(mondayOf(d.date));
    d.items.forEach((it) => {
      if (it.type === 'anki' || it.type === 'new') {
        weekHours[wk] = weekHours[wk] || {};
        weekHours[wk][it.sid] = (weekHours[wk][it.sid] || 0) + it.min / 60;
      }
      if (it.type === 'new' && it.chapters && it.chapters.length)
        chapterLog.push({ ds: d.ds, date: d.date, name: it.name, color: it.color, chapters: it.chapters });
    });
  });

  let capTotal = 0;
  let capUsed = 0;
  days.forEach((d) => {
    capTotal += d.studyMin;
    capUsed += d.used;
  });
  return {
    days,
    itemStat,
    weekHours,
    chapterLog,
    warnings: [...new Set(warnings)],
    capUsed,
    capTotal,
    ML,
    adapt,
    adaptApplied,
    reviewViaAnki,
  };
}
