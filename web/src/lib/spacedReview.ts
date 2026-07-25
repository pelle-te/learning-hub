/* ============================================================
   spacedReview.ts — 개념(챕터) 레벨 간격반복 위험 — 순수·무의존.
   Anki가 '카드' 레벨을 소유한다면 여기선 '개념(챕터)' 레벨: 내가 실제로 학습/복습/백지한
   (완료된) 세션에서 챕터별 '마지막으로 만진 날'을 뽑아, 망각곡선상 오래 방치된 챕터를 위험으로 표식.

   신호원: 스케줄의 완료 세션(new/rev/blank) + chapters. isDone으로 게이팅 — 계획만 있고 안 한 건 제외.
   ⚠ 한계: 챕터를 'done' 처리하면 스케줄 계획에서 빠져(=이 스캔에서도 빠짐) — 진행 중 과목의
      '배웠지만 다시 안 본' 챕터를 겨냥한다(가장 잊기 쉬운 구간). REVIEW_OFFSETS(1·3·7·16)와 정렬.
============================================================ */
import { dayDiff, REVIEW_OFFSETS, REVIEW_TAIL_OFFSET, addDays, iso, parseISO } from './utils';
import { isDone } from './persistence';
import type { AppState, Day, SessionType } from './types';

export type ReviewRisk = 'fresh' | 'due' | 'overdue';

export interface ChapterReview {
  sid: string;
  subject: string;
  color?: string;
  chapter: string;
  lastDs: string; // 마지막으로 만진 날
  daysSince: number; // 오늘로부터 경과일
  risk: ReviewRisk;
}

/** 간격반복의 마지막 오프셋(16) 기준: 그 이상 방치=overdue, 마지막 직전(7)↑=due. */
const DUE_DAYS = REVIEW_OFFSETS[REVIEW_OFFSETS.length - 2] ?? 7; // 7
const OVERDUE_DAYS = REVIEW_OFFSETS[REVIEW_OFFSETS.length - 1] ?? 16; // 16
/* ID-10(실패 방향) — 직전 백지가 '막힘'이면 **사다리를 한 칸 앞당긴다**(7→3 · 16→7).
   임의 계수를 만들지 않는 것이 요점이다: 앞당김 폭이 REVIEW_OFFSETS 자신에서 나오므로
   사다리를 고치면 여기가 따라오고, "왜 하필 그 숫자인가"라는 질문이 안 생긴다. */
const FAIL_DUE_DAYS = REVIEW_OFFSETS[REVIEW_OFFSETS.length - 3] ?? 3; // 3
const FAIL_OVERDUE_DAYS = DUE_DAYS; // 7

/**
 * 경과일 → 위험도. `failing` 이면 임계를 한 칸 앞당긴다(ID-10 · **실패 방향만**).
 *
 * 왜 실패 방향만인가: 이 함수는 러너 큐·오늘탭 배지·통계가 함께 읽는 **핵심 파생 계약**이다.
 * 통과 방향(잘했으니 간격을 늘림)까지 한 번에 넣으면 "복습이 줄었다"가 위험 감소인지 계산
 * 변경인지 구분할 수 없게 된다 — 게다가 통과 방향을 정밀하게 하려면 백지 결과가 챕터 단위여야
 * 하는데(현재는 과목-일 단위 = 토대 B) 그 전엔 잘한 챕터와 못 한 챕터가 한 신호를 공유한다.
 * **앞당김은 그 거친 신호로도 안전하다** — 최악이 "덜 급한 챕터를 조금 일찍 본다"이기 때문이다.
 * 반대 방향은 최악이 "잊은 챕터를 안 보여준다"라 같은 근거로 못 넣는다(비대칭이 설계 결정이다).
 */
export function riskOf(daysSince: number, failing = false): ReviewRisk {
  const over = failing ? FAIL_OVERDUE_DAYS : OVERDUE_DAYS;
  const due = failing ? FAIL_DUE_DAYS : DUE_DAYS;
  if (daysSince >= over) return 'overdue';
  if (daysSince >= due) return 'due';
  return 'fresh';
}

/**
 * 직전 백지 복습이 **막힘**으로 끝난 과목 id 집합(ID-10 입력).
 *
 * 과목당 가장 최근(오늘 이하) 백지 결과 하나만 본다 — 오래된 실패가 영원히 따라다니면 그건
 * 간격반복이 아니라 낙인이다. 그 뒤 통과 기록이 있으면 자연히 빠진다.
 * ⚠ 백지 결과는 (날짜, 과목) 단위다(챕터 아님 · 토대 B). 그래서 이 신호는 **과목 전체**에
 *   걸린다 — 같은 과목의 안 막힌 챕터도 함께 앞당겨진다. 위 비대칭 근거가 그것을 허용한다.
 */
export function failingSids(state: AppState, todayDs: string): Set<string> {
  const latest = new Map<string, { ds: string; passed: boolean }>();
  for (const r of state.blankResults || []) {
    if (!r.ds || r.ds > todayDs) continue; // 미래 기록 무시(시드·시계 어긋남 방어)
    const cur = latest.get(r.sid || '');
    if (!cur || r.ds > cur.ds) latest.set(r.sid || '', { ds: r.ds, passed: !!r.passed });
  }
  const out = new Set<string>();
  for (const [sid, v] of latest) if (sid && !v.passed) out.add(sid);
  return out;
}

const TOUCH_TYPES: ReadonlySet<SessionType> = new Set<SessionType>(['new', 'rev', 'blank']);

/** 챕터별 '마지막으로 만진 날' → 경과일·위험도. todayDs 이후(미래) 배치는 무시. 위험 큰 순 정렬. */
export function chapterReviews(state: AppState, days: Day[], todayDs: string): ChapterReview[] {
  const last = new Map<string, { ds: string; subject: string; sid: string; color?: string; chapter: string }>();
  for (const d of days) {
    if (d.ds > todayDs) continue;
    for (const it of d.items) {
      if (!TOUCH_TYPES.has(it.type) || !it.chapters || !it.chapters.length) continue;
      if (!isDone(state, d.ds, it.sid, it.type)) continue;
      for (const ch of it.chapters) {
        const key = it.sid + '|' + ch;
        const cur = last.get(key);
        if (!cur || d.ds > cur.ds)
          last.set(key, { ds: d.ds, subject: it.name, sid: it.sid, color: it.color, chapter: ch });
      }
    }
  }
  // ReviewRun 챕터 터치(계획 밖 인출) 병합 — 계획 파생 lastDs와 max(감사 #22: 밀린 챕터를
  // 복습해도 overdue가 안 풀리던 루프). 스캔에 없는 키는 과목 메타를 몰라 건너뜀 — 위험으로
  // 뜨는 챕터는 완료 이력이 있어 항상 스캔에 존재한다. 미래 ds는 스캔과 동일하게 무시.
  const touches = state.reviewTouches || {};
  for (const k in touches) {
    const ds = touches[k]!;
    const cur = last.get(k);
    if (cur && ds > cur.ds && ds <= todayDs) cur.ds = ds;
  }
  // ID-10 — 직전 백지가 막힌 과목은 임계를 한 칸 앞당긴다(성패 가중 · 실패 방향만).
  const failing = failingSids(state, todayDs);
  const out: ChapterReview[] = [];
  for (const e of last.values()) {
    const daysSince = dayDiff(e.ds, todayDs);
    out.push({
      sid: e.sid,
      subject: e.subject,
      color: e.color,
      chapter: e.chapter,
      lastDs: e.ds,
      daysSince,
      risk: riskOf(daysSince, failing.has(e.sid)),
    });
  }
  return out.sort((a, b) => b.daysSince - a.daysSince || (a.subject < b.subject ? -1 : 1));
}

/** 복습 위험(due/overdue) 챕터만, 위험 큰 순 상위 cap개. */
export function riskChapters(state: AppState, days: Day[], todayDs: string, cap = 8): ChapterReview[] {
  return chapterReviews(state, days, todayDs)
    .filter((c) => c.risk !== 'fresh')
    .slice(0, cap);
}

/* ── 과목 인터리빙(ID-2) ────────────────────────────────────────────────────
   위험순(daysSince desc)으로만 정렬하면 한 과목의 밀린 챕터가 큐 앞을 통째로 점유해, 같은
   과목을 연달아 인출하게 된다 — 인터리빙(끼워 학습)이 블록 학습보다 장기 파지에 유리하다는
   학습과학과 어긋난다(Rohrer&Taylor). 그래서 **위험 티어(overdue→due→fresh)는 유지**하되,
   각 티어 '안에서'만 과목 라운드로빈으로 끼운다.

   ⚠ 티어 순서를 유지하는 것이 핵심 불변식이다("위험순 완전 포기 금지=overdue 밀림"): overdue
   챕터는 어떤 인터리빙에도 due 아래로 내려가지 않는다. 티어 내부의 엄격한 daysSince 순서만
   양보한다(그게 인터리빙의 목적). 과목이 하나뿐이면 라운드로빈은 항등이라 순서가 그대로다. */
const RISK_TIERS: readonly ReviewRisk[] = ['overdue', 'due', 'fresh'];

/** 위험 티어는 보존하고 티어 내부만 과목 라운드로빈으로 인터리빙한다. 입력은 위험순 정렬을
 *  가정(chapterReviews 산출) — 과목 회전 순서 = 각 과목의 가장 급한 챕터 등장 순(결정적). */
export function interleaveBySubject(chapters: ChapterReview[]): ChapterReview[] {
  const out: ChapterReview[] = [];
  for (const tier of RISK_TIERS) {
    const inTier = chapters.filter((c) => c.risk === tier);
    if (inTier.length < 2) {
      if (inTier.length) out.push(inTier[0]!);
      continue;
    }
    // 과목별 그룹(삽입 순 = 위험순 정렬에서 그 과목이 처음 등장한 순서 = 가장 급한 챕터 순).
    const bySubject = new Map<string, ChapterReview[]>();
    for (const c of inTier) {
      const g = bySubject.get(c.sid);
      if (g) g.push(c);
      else bySubject.set(c.sid, [c]);
    }
    const groups = [...bySubject.values()];
    // 라운드로빈: 라운드 r 마다 각 과목의 r번째 챕터를 순서대로 뽑는다. 가장 긴 그룹까지 돌면 끝.
    const rounds = Math.max(...groups.map((g) => g.length));
    for (let round = 0; round < rounds; round++) {
      for (const g of groups) if (round < g.length) out.push(g[round]!);
    }
  }
  return out;
}

/* ── 복습 부하 예보(ID-1) ──────────────────────────────────────────────────
   오늘탭이 '밀린 것'(overdue backlog)을 보여준다면, 여기선 유일하게 비어 있던 시제 —
   '다가오는 복습 파도'를 앞 horizon일 날짜별로 조망한다. 각 챕터를 '마지막 만진 날' +
   간격반복 오프셋(1·3·7·16·34)으로 미래에 투영해, 어느 날 얼마만큼의 복습이 몰릴지를
   '부하의 형태'로 그린다(정확 예측이 아니라 형태 — REVIEW_OFFSETS 는 결정적 사다리다).

   ⚠ Anki(FSRS) 는 미래 due 스케줄을 앱 상태에 두지 않는다(카드 레벨은 Anki 소유). 그래서
      이 순수함수는 **볼트 챕터만** 투영한다 — 예보의 정밀 비대칭을 UI 가 '오늘 기준 Anki due'
      라는 별도 컨텍스트로 정직하게 프레이밍한다(로드맵 ID-1 주석). */

/** 예보 지평(일) — 오늘탭 backlog 다음 2주의 파도를 본다. */
export const FORECAST_HORIZON = 14;
/* 투영에 쓰는 오프셋 = 간격반복 본 사다리 + 꼬리(34) — riskOf 와 같은 모델이라 '오늘 due' 와
   '앞으로 due' 가 같은 규칙을 공유한다(따로 놀지 않게). */
const FORECAST_OFFSETS: readonly number[] = [...REVIEW_OFFSETS, REVIEW_TAIL_OFFSET];

export interface ForecastSubject {
  sid: string;
  subject: string;
  color?: string;
  count: number;
}
export interface ForecastDay {
  ds: string;
  /** 오늘로부터 경과일(1..horizon). */
  offset: number;
  /** 요일(0=일). 주말/평일 시각 구분에 쓴다. */
  wd: number;
  /** 그날 복습 예정 볼트 챕터 총수. */
  chapters: number;
  /** 과목별 분해(내림차순). */
  subjects: ForecastSubject[];
}

/** 앞 horizon일 날짜별 복습 부하(볼트 챕터) 예보. 챕터 하나가 여러 오프셋 경계에 걸리면
 *  각 날에 계상된다(예: 오늘 만진 챕터 → 1·3·7일에 각각 = 실제 간격반복 파도 모양).
 *  이미 모든 오프셋을 지난(overdue) 챕터는 미래 투영이 음수라 자연히 빠진다(=오늘탭 backlog). */
export function dueForecast(
  state: AppState,
  days: Day[],
  todayDs: string,
  horizon: number = FORECAST_HORIZON,
): ForecastDay[] {
  // dayOffset(1..horizon) → sid → 누적 과목
  const buckets = new Map<number, Map<string, ForecastSubject>>();
  for (const ch of chapterReviews(state, days, todayDs)) {
    for (const off of FORECAST_OFFSETS) {
      const d = off - ch.daysSince; // 오늘로부터 이 복습까지 남은 일수
      if (d < 1 || d > horizon) continue;
      let bySid = buckets.get(d);
      if (!bySid) buckets.set(d, (bySid = new Map()));
      const cur = bySid.get(ch.sid);
      if (cur) cur.count++;
      else bySid.set(ch.sid, { sid: ch.sid, subject: ch.subject, color: ch.color, count: 1 });
    }
  }
  const base = parseISO(todayDs);
  const out: ForecastDay[] = [];
  for (let d = 1; d <= horizon; d++) {
    const bySid = buckets.get(d);
    const subjects = bySid
      ? [...bySid.values()].sort((a, b) => b.count - a.count || (a.subject < b.subject ? -1 : 1))
      : [];
    const date = addDays(base, d);
    out.push({
      ds: iso(date),
      offset: d,
      wd: date.getDay(),
      chapters: subjects.reduce((t, s) => t + s.count, 0),
      subjects,
    });
  }
  return out;
}

/** 위험 요약 — {overdue, due, total 위험 수} (배지·홈 넛지용). */
export function riskSummary(state: AppState, days: Day[], todayDs: string): { overdue: number; due: number } {
  let overdue = 0;
  let due = 0;
  for (const c of chapterReviews(state, days, todayDs)) {
    if (c.risk === 'overdue') overdue++;
    else if (c.risk === 'due') due++;
  }
  return { overdue, due };
}
