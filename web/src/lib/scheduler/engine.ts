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
  reviewBlockMin,
  round1,
  todayISO,
} from '../utils';
import { isWeekManaged } from '../weekAlloc';
import { EXAM_LABEL, examScopes, examsOf, scopeIndexFor } from '../semester';
import { dayStudyMin, studyMinByWeekday } from './windows';
import { adherenceFactor, itemTotalHours, latestBlank, masteryNeed, mistakeNeed } from './priority';
import { applyDayPlans, reseedManualReviews } from './dayPlanOverride';
import type { SchedSubject } from './types';
import type { AppState, Day, Item, ItemStat, ScheduleResult, Shortfall } from '../types';

/* ── `schedule()` 의 두 단계 (2026-08-20 리뷰 M-14 원장 축소) ──────────────────────
   ⚠⚠ **이 파일은 회귀로 동결된 코어다**(머리주석). 그래서 여기 옮긴 것은 **문장이 아니라 위치**뿐
   이다 — 조건·순서·반올림 어느 것도 안 바꿨고 `scheduler.test.ts` 가 그것을 잠근다.
   단계 둘을 뺀 이유는 크기가 아니라 **독립성**이다: daily 배치는 weekly 를 모르고, 복습 대상 날
   고르기는 복습 내용을 모른다. */

/** ③ daily(Anki) — 매일 고정 분 확보. 챕터가 없어 구간이 무의미하므로 과목의 **마지막 시험**까지
 *  매일 돈다(시험이 없으면 지평 끝까지). */
function placeDaily(days: Day[], s: Item, start: string, horizon: number): void {
  const dailyEx = examsOf(s);
  const dailyDs = dailyEx.length ? dailyEx[dailyEx.length - 1]!.date : undefined;
  const dlIdx = clamp(dailyDs ? dayDiff(start, dailyDs) : horizon, 0, days.length - 1);
  for (let j = 0; j <= dlIdx; j++) {
    const d = days[j]!;
    if (d.studyMin - d.used <= 0) continue;
    const m = Math.min(+(s.dailyMin || 0), d.studyMin - d.used);
    if (m <= 0) continue;
    d.items.push({ type: 'anki', sid: s.id, name: s.name, min: Math.round(m), color: s.color });
    d.used += m;
  }
}

/** ⑥ 복습 대상 날 — **세 순위**로 고른다. 못 찾으면 `-1`(= 미배치, 호출부가 센다).
 *  ① 복습예산(`revLeft`)이 남은 첫 날 → ② 그냥 여유가 남은 첫 날 → ③ 여유가 **가장 큰** 날.
 *  ⚠ ③이 있는 이유가 "no silent caps" 다 — 창 안이 전부 빡빡해도 조용히 버리지 않고 가장 덜
 *  빡빡한 날에 넘겨 끼우고, 그 사실을 호출부가 경고로 말한다. */
function pickReviewDay(days: Day[], from: number, min: number): number {
  const end = Math.min(days.length - 1, from + 6);
  for (let j = from; j <= end; j++) if (days[j]!.revLeft >= min) return j;
  for (let j = from; j <= end; j++) if (days[j]!.studyMin - days[j]!.used >= min) return j;
  let best = -1;
  let bestRoom = -1;
  for (let j = from; j <= end; j++) {
    const rm = days[j]!.studyMin - days[j]!.used;
    if (rm > bestRoom) {
      bestRoom = rm;
      best = j;
    }
  }
  return best;
}

export function schedule(state: AppState): ScheduleResult {
  // 시작일 방어 — 사용자가 시작일을 빈 값으로 지우면 parseISO('')=Invalid → dayDiff=NaN →
  // horizon=Math.max(6,NaN)=NaN → 루프가 0회 → days=[]로 전 탭이 빈 화면이 됐다. 오늘로 폴백.
  const start = Number.isNaN(parseISO(state.startDate).getTime()) ? todayISO(state) : state.startDate;
  const items = state.items.filter((s) => s.name);
  const warnings: string[] = [];
  const shortfalls: Shortfall[] = [];
  const capWd = studyMinByWeekday(state);
  const ML = state.moduleLen || 120;
  const revFrac = (state.reviewRatio || 0) / 100;
  const weeklyRaw = items.filter((s) => s.mode !== 'daily' && +(s.weeklyHours || 0) > 0);
  const daily = items.filter((s) => s.mode === 'daily' && +(s.dailyMin || 0) > 0);
  if (!items.length)
    return { days: [], itemStat: [], weekHours: {}, chapterLog: [], warnings, shortfalls, capUsed: 0, capTotal: 0, ML };

  /* 1) 기간(horizon) */
  // T-1. horizon 이 시험을 넘어서야 하므로 **모든 시험 중 가장 늦은 날짜**를 본다. 시험이 승격된
  // 옛 저장에서는 `deadline` 하나뿐이라 종전 값과 같다.
  const lastDL = items.reduce((m, s) => {
    const ex = examsOf(s);
    const d = ex.length ? ex[ex.length - 1]!.date : '';
    return d > m ? d : m;
  }, '');
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
  /* ⚠ 루프 밖에서 한 번만 판다(2026-08-20 리뷰 n-3) — 종전엔 `addDays(parseISO(start), i)` 로 매 회 같은 문자열을
     다시 파싱했다(`parseISO` 는 split 배열 + map 배열 + Date 를 할당한다). `priority.ts` 의
     H29 주석이 **바로 이웃에서** 같은 결함을 명시하고 이 처방을 적용했는데 이 루프엔 안 왔다. */
  const startDate = parseISO(start);
  for (let i = 0; i <= horizon; i++) {
    const date = addDays(startDate, i);
    const ds = iso(date);
    const wd = date.getDay();
    let sMin = dayStudyMin(state, ds, wd, capWd);
    if (adapt < 1 && ds >= today) sMin = Math.round(sMin * adapt); // 오늘/미래만 축소(과거 원본 유지)
    days.push({ ds, date, wd, studyMin: sMin, used: 0, modLeft: 0, revLeft: 0, items: [] });
  }
  const adaptApplied = adapt < 1;

  /* 3) daily(Anki) 먼저 — 매일 고정 분 확보 */
  daily.forEach((s) => placeDaily(days, s, start, horizon));
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
    // T-1. 시험 구간(`examScopes`)이 옛 `deadline`+`deadlineThru` 계산을 **집어삼켰다** — 시험이
    // 0~1개면 구간 하나가 `0..scopeEnd` 라 결과가 종전과 동일하다(`lib/semester.ts` 머리주석 §2).
    // 옛 id 를 못 찾으면 전 범위로 폴백하는 P-10 의 판단도 `examScopes` 안으로 옮겨갔다.
    const scopes = examScopes(it);
    // deferred(P-9)는 done 과 같은 자리에서 빠진다 — 블록도 안 만들고 부족분에도 안 센다.
    // 다만 `_allTotal`·`_done0` 은 원본 그대로라 통계가 포기를 진척으로 세지 않는다.
    const chs = all
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => !c.done && !c.deferred)
      .map(({ c, i }) => {
        const segIdx = scopeIndexFor(scopes, i);
        return { id: c.id, name: c.name, hours: Math.max(0.1, +c.hours || 1), inScope: segIdx >= 0, segIdx };
      });
    // 구간별 남은 시간과 누적 끝 — `_cum` 과 직접 비교해 **시험마다** 부족분을 낸다.
    let cum = 0;
    const segs = scopes.map((sc, si) => {
      const hours = chs.reduce((t, c) => t + (c.segIdx === si ? c.hours : 0), 0);
      cum += hours;
      return { exam: sc.exam, dlIdx: clamp(dayDiff(start, sc.exam.date), 0, days.length - 1), hours, cumEndH: cum };
    });
    return {
      ...it,
      _allTotal: all.length,
      _done0: all.filter((c) => c.done).length,
      _hadChapters: all.length > 0,
      _chs: chs,
      _cum: 0,
      _idx: 0,
      _totalH: chs.reduce((t, c) => t + c.hours, 0),
      _scopeH: chs.reduce((t, c) => t + (c.inScope ? c.hours : 0), 0),
      _segs: segs,
      _dlIdx: segs.length ? segs[segs.length - 1]!.dlIdx : horizon,
      _schedMin: 0,
      _sessions: [],
      _carry: 0,
      // Q-3. "약한 과목 먼저"의 근거가 **둘**이 됐다: 지식엔진 숙달도(외부 관측)와 반복 오답
      // (내 기록). 둘을 더해 **정렬 항 하나**로 둔다 — 항을 늘리면 "왜 이 과목이 먼저인가"의
      // 설명이 조합적으로 불어난다. 둘 다 `graphPriority` 한 스위치가 끈다.
      // ⚠ 종전 이 줄은 "(기본 off → 영향 0)"이라 적었는데 **사실과 다르다** — I-6(W7)이 기본을
      //   `true` 로 뒤집었다(`persistence.ts` 의 `defaults()`). 그 오해 때문에 `mistakeNeed` 의
      //   전량 스캔 비용이 검토 밖에 남아 있었다(2026-08-20 리뷰 m-6). 지금은 그쪽에 참조 캐시가
      //   붙어 과목 수와 무관하게 1회만 돈다.
      _masteryNeed: masteryNeed(state, it.name) + mistakeNeed(state, it.id),
      _weekTgt: 0,
      _weekDone: 0,
    };
  });

  /* ⚠ **과목당 한 번만 판다**(2026-08-20 리뷰 M-4). `latestBlank(state, sid)` 는
     `(blankResults, sid)` 의 순수 함수인데 `pushReviewTasks` 가 **new 블록을 놓을 때마다**
     불렀다 — 자동 경로(일자 × modLeft) + 배분 경로(주 × 7 × 과목) + 수동 배치(날 × 블록)라
     호출이 네 자릿수가 되고, 매 호출이 `blankResults` 전량 스캔이었다. sid 는 과목 수만큼만
     존재하므로 여기서 한 번 접어 두면 그 축이 통째로 사라진다. */
  const blankBySid = new Map<string, boolean | null>();
  for (const s of weekly) blankBySid.set(s.id, latestBlank(state, s.id));
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
  /** T-1. **지금 배치하려는 챕터**의 마감 인덱스. 새 챕터 배치·긴급도 정렬이 보는 값이다.
   *  ⚠ 시험이 0~1개면 항상 `s._dlIdx` 와 같다 — 구간이 하나뿐이고 구간 밖은 폴백이 같은 값이라
   *  종전 동작이 **한 글자도 안 바뀐다**(`scheduler.test.ts` 가 잠근 계약).
   *  ⚠ 복습 꼬리(`pushReviewTasks`)는 일부러 이걸 안 쓴다 — 중간고사 범위의 복습은 시험을 지나
   *  기말까지 이어져야 하므로 바깥 울타리(`_dlIdx`)가 맞다. */
  function curDl(s: SchedSubject): number {
    const ch = s._chs[s._idx];
    const seg = ch && ch.segIdx >= 0 ? s._segs[ch.segIdx] : undefined;
    return seg ? seg.dlIdx : s._dlIdx;
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
    const blank = blankBySid.get(s.id) ?? null; // 위에서 과목당 1회 계산(M-4)
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
          min: reviewBlockMin(ML),
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
          if (mins <= 0 || !chaptersLeft(s) || di > curDl(s)) return;
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
        const cand = weekly.filter((s) => s._weekDone < s._weekTgt && chaptersLeft(s) && di <= curDl(s));
        if (!cand.length) break;
        cand.sort((a, b) => {
          const ua = curDl(a) - di;
          const ub = curDl(b) - di; // ① 마감 임박(하드 제약) — T-1 이후 "현재 챕터가 속한 시험"까지
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
    const tg = pickReviewDay(days, t.idx, t.min);
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
      `복습 ${revMissed}개가 용량 부족으로 미배치됐어요 — 주당 시간↑·복습비중↑ 또는 가용시간 확보를 검토하세요.`,
    );
  if (revOver > 0)
    warnings.push(
      `복습 ${revOver}개가 여유 없는 날에 끼워졌어요(그날 계획이 가용시간을 초과) — 일부 복습을 줄이거나 날을 비우세요.`,
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
    // T-1. "마감"의 대표값 = **마지막 시험 날짜**. 옛 저장은 시험이 승격된 하나뿐이라 `s.deadline`
    // 과 같은 값이고, 시험을 안 쓰는 과목은 종전대로 undefined 다.
    const lastExamDs = s._segs.length ? s._segs[s._segs.length - 1]!.exam.date : s.deadline;
    /* ⚠⚠ **D-day 는 마지막 시험이 아니라 다가오는 시험이다**(H-2 · 2026-08-06 감사).
       `semester.ts` 의 `nextExamOf` 가 정확히 이 이유로 만들어졌는데(_"중간고사가 코앞인데
       기말까지의 D-60 을 보여주면 그 숫자는 거짓말"_) 화면 다섯이 계속 `deadline` 을 그리고
       있었다 — 새 어휘를 만들고 소비처를 안 옮기면 옛 값이 그대로 산다.
       여기서 함께 내보내 **파생이 한 곳**이 되게 한다(화면마다 `nextExamOf` 를 부르면 그 다섯이
       각자 today 를 구하게 되고, 그건 H-17 이 잡은 자정 넘김 버그의 생산 라인이다). */
    /* ⚠ 기준은 `start`(스케줄 시작일)가 아니라 **`today`** 다 — 시작일은 학기 시작이라 과거일 수
       있고, 그걸로 재면 이미 지난 중간고사가 "다가오는 시험"이 된다. 반대로 시작일이 미래면
       코앞의 시험이 통째로 빠진다(실측: 이 실수로 `/today` 의 마감 스트립이 비었다). */
    const nextExamDs =
      s._segs.find((g) => g.exam.date >= today)?.exam.date ??
      (s.deadline && s.deadline >= today ? s.deadline : undefined);
    const late = finished && finishDate && lastExamDs ? Math.max(0, dayDiff(lastExamDs, finishDate)) : 0;
    // _hadChapters 가드 — 챕터 없는 과목은 chaptersLeft()가 늘 true라 finished가 영영 false다.
    // 그 상태에서 마감만 있으면 경고가 영구히 뜨는 오탐이라 실제 챕터가 있던 과목만 본다.
    // ⚠ 판정 분모가 `_totalH`(전부)에서 `_scopeH`(마감이 덮는 범위)로 바뀌었다 — P-10.
    //   `deadlineThru` 가 없으면 둘이 같으므로 종전 동작과 한 글자도 다르지 않다.
    // ⚠ 그리고 이 자리는 이제 **문자열 경고를 안 만든다** — P-9. 옛 문장의 유일한 처방이
    //   `주당 시간↑` 이었는데 그건 사용자가 할 수 없는 것이라 액션이 0이었다. 대신 부족분과
    //   컷 후보를 구조로 내보내고, 화면이 "무엇을 뺄까"를 묻는다.
    // ⚠⚠ T-1 이후 이 판정은 **시험 구간마다** 돈다. 옛 모델은 과목당 마감 1개라 부족분도 하나였는데,
    //   중간은 벅찬데 기말은 여유로운 상태가 실재하고 그 둘은 처방이 다르다(중간 범위를 컷해도 기말
    //   부족분은 안 줄어든다). 시험이 0~1개면 루프가 1회라 **종전과 결과가 동일**하다.
    let emitted = false;
    if (s._hadChapters) {
      s._segs.forEach((seg, si) => {
        // 이 구간이 덮는 남은 시간 중 실제로 들어간 만큼 — `_cum` 은 챕터 순서대로 쌓이고 구간도
        // 챕터 순서대로 이어지므로, 구간 [cumEndH-hours, cumEndH) 와 `_cum` 의 교집합이 곧 커버다.
        const segStartH = seg.cumEndH - seg.hours;
        const fit = clamp(s._cum - segStartH, 0, seg.hours);
        if (seg.hours <= 1e-6 || fit >= seg.hours - 1e-6) return;
        const inSeg = s._chs.filter((c) => c.segIdx === si);
        // 규칙: **남은 시간 큰 것부터 · 동률이면 뒤 챕터부터.** 화면에도 이 한 줄을 적어 사용자가
        // 뒤집을 수 있게 한다 — 컷 순서를 학습과학으로 정당화하지 않는다(트리아지 문헌과 깊이-넓이
        // 문헌이 정면으로 갈린다). 근거 없이 똑똑한 척하는 순위가 이 축에서 가장 위험하다.
        const candidates = inSeg
          .map((c, i) => ({ c, i }))
          .sort((a, b) => b.c.hours - a.c.hours || b.i - a.i)
          .map(({ c }) => ({ id: c.id, name: c.name, hours: round1(c.hours) }));
        const gapH = seg.hours - fit;
        const suggest: string[] = [];
        let acc = 0;
        for (const c of candidates) {
          if (acc >= gapH - 1e-6) break;
          suggest.push(c.id);
          acc += c.hours;
        }
        emitted = true;
        shortfalls.push({
          sid: s.id,
          name: s.name,
          color: s.color,
          deadline: seg.exam.date,
          examId: seg.exam.id,
          examLabel: EXAM_LABEL[seg.exam.kind],
          needH: round1(seg.hours),
          fitH: round1(fit),
          gapH: round1(gapH),
          // "범위가 좁혀졌나" = 이 구간이 남은 챕터 전부를 덮지는 않는다.
          scoped: inSeg.length < s._chs.length,
          candidates,
          suggest,
        });
      });
    }
    if (!emitted && late > 0) warnings.push(`"${s.name}": 학습 종료(${finishDate})가 마감(${lastExamDs}) 초과.`);
    return {
      id: s.id,
      name: s.name,
      color: s.color,
      weeklyHours: +(s.weeklyHours || 0),
      totalCh: total,
      doneCh,
      totalH: round1(s._totalH),
      schedH: round1(s._schedMin / 60),
      deadline: lastExamDs,
      nextExam: nextExamDs,
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
    shortfalls,
    capUsed,
    capTotal,
    ML,
    adapt,
    adaptApplied,
    reviewViaAnki,
  };
}
