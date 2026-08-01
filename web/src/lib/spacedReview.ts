/* ============================================================
   spacedReview.ts — 개념(챕터) 레벨 간격반복 위험 — 순수·무의존.
   Anki가 '카드' 레벨을 소유한다면 여기선 '개념(챕터)' 레벨: 내가 실제로 학습/복습/백지한
   (완료된) 세션에서 챕터별 '마지막으로 만진 날'을 뽑아, 망각곡선상 오래 방치된 챕터를 위험으로 표식.

   신호원: 스케줄의 완료 세션(new/rev/blank) + chapters. isDone으로 게이팅 — 계획만 있고 안 한 건 제외.
   이 스캔은 **진행 중** 챕터를 본다(REVIEW_OFFSETS 1·3·7·16 정렬).

   ⚠ 끝낸(done) 챕터는 여기 원리적으로 안 들어온다 — 스케줄러가 `!done` 만 계획에 넣으므로
      **계획이 재생성되는 순간 과거 블록에서도 사라진다**. 예전엔 그 사실이 이 자리에 "⚠ 한계"로
      적혀 있었는데, 그건 문서가 아니라 결함이었다: 끝낸 날부터 그 챕터를 다시 볼 앱 내 경로가
      0이 된다(6개월 전 챕터는 존재하지 않는 것과 같다). 그 구멍은 아래 **유지(maintenance)
      사다리**가 별도 함수로 메운다 — 입력이 '스케줄'이 아니라 '챕터 카탈로그'다.
============================================================ */
import { dayDiff, REVIEW_OFFSETS, REVIEW_TAIL_OFFSET, addDays, iso, parseISO, reviewBlockMin } from './utils';
import { chapterStrength } from './chapterStrength';
import { isDone } from './persistence';
import { CBMS_ADVANCES_REVIEW } from './methodology';
import { vaultAnchors } from './vaultAnchors';
import type { AppState, CbmsCode, Day, SessionType } from './types';

export type ReviewRisk = 'fresh' | 'due' | 'overdue';

export interface ChapterReview {
  sid: string;
  subject: string;
  color?: string;
  chapter: string;
  lastDs: string; // 마지막으로 만진 날
  daysSince: number; // 오늘로부터 경과일
  risk: ReviewRisk;
  /** 유지(끝낸 챕터) 출신 표식 — 본 사다리 항목엔 없다(N-10). 큐·UI 가 한 배열에서 구분한다. */
  maintenance?: true;
  /** 앵커가 **볼트 `reviewed:`**(검증 통과일)에서 왔다 — 앱 안에 인출 기록이 아직 없다는 뜻(W2).
   *  UI 는 이걸 배지로 구분해야 한다: 부모가 라이브 관측이 흐르면 이 지표를 폴백으로 강등하라고
   *  적었는데, 구분 없이 승격시키면 강등할 주체가 사라진다(`vaultAnchors.ts` 머리주석). */
  fromVault?: true;
}

/** 간격반복의 마지막 오프셋(16) 기준: 그 이상 방치=overdue, 마지막 직전(7)↑=due. */
const DUE_DAYS = REVIEW_OFFSETS[REVIEW_OFFSETS.length - 2] ?? 7; // 7
const OVERDUE_DAYS = REVIEW_OFFSETS[REVIEW_OFFSETS.length - 1] ?? 16; // 16
/* ID-10(실패 방향) — 직전 백지가 '막힘'이면 **사다리를 한 칸 앞당긴다**(7→3 · 16→7).
   임의 계수를 만들지 않는 것이 요점이다: 앞당김 폭이 REVIEW_OFFSETS 자신에서 나오므로
   사다리를 고치면 여기가 따라오고, "왜 하필 그 숫자인가"라는 질문이 안 생긴다. */
const FAIL_DUE_DAYS = REVIEW_OFFSETS[REVIEW_OFFSETS.length - 3] ?? 3; // 3
const FAIL_OVERDUE_DAYS = DUE_DAYS; // 7
/* Q-4(통과 방향) — 붙은 챕터는 **한 칸 미룬다**(7→16 · 16→34). 앞당김과 **정확히 대칭**이고
   폭이 역시 사다리 자신에서 나온다(꼬리 34 = `REVIEW_TAIL_OFFSET`). ⚠ **상한 한 칸**이다 —
   두 칸을 허용하면 잘 본 챕터가 두 달 뒤로 사라지고, 그건 간격반복이 아니라 방치다. */
const STRONG_DUE_DAYS = OVERDUE_DAYS; // 16
const STRONG_OVERDUE_DAYS = REVIEW_TAIL_OFFSET; // 34

/**
 * 경과일 → 위험도. `failing` 이면 한 칸 **앞당기고**(ID-10), `strong` 이면 한 칸 **미룬다**(Q-4).
 *
 * ## ⚠⚠ 이 함수는 한동안 의도적으로 **비대칭**이었다 — 그 근거가 2026-08-02 에 무효가 됐다
 * 옛 주석(그대로 옮긴다): _"통과 방향을 정밀하게 하려면 백지 결과가 챕터 단위여야 하는데
 * (현재는 과목-일 단위 = 토대 B) 그 전엔 잘한 챕터와 못 한 챕터가 한 신호를 공유한다.
 * 앞당김은 그 거친 신호로도 안전하다 — 최악이 '덜 급한 챕터를 조금 일찍 본다'이기 때문이다.
 * 반대 방향은 최악이 '잊은 챕터를 안 보여준다'라 같은 근거로 못 넣는다."_
 *
 * **그 전제가 사라졌다**: `blankResults[].chapter` 가 2026-08-01 근본이관 ①로 들어와, 통과/막힘이
 * **챕터 단위로 관측된다**(`chapterStrength`). 즉 미룸을 정밀하게 걸 수 있게 됐다. 그래서 비대칭을
 * 유지할 이유가 없어졌고, Q-4 가 통과 방향을 연다.
 *
 * ## 그래도 남는 두 안전장치
 * ① **상한 한 칸.** 두 칸 미룸은 없다 — 최악이 여전히 "잊은 챕터를 안 보여준다"라서다.
 * ② **`failing` 이 이긴다.** 둘 다 참일 수 없어야 하지만 신호가 갈리면(과목은 막혔는데 이 챕터는
 *    연속 통과) **앞당김을 택한다** — 위험 쪽으로 틀리는 편이 안전하다.
 */
export function riskOf(daysSince: number, failing = false, strong = false): ReviewRisk {
  const shift = failing ? 'fail' : strong ? 'strong' : 'base'; // failing 이 strong 을 이긴다(안전 방향)
  const over = shift === 'fail' ? FAIL_OVERDUE_DAYS : shift === 'strong' ? STRONG_OVERDUE_DAYS : OVERDUE_DAYS;
  const due = shift === 'fail' ? FAIL_DUE_DAYS : shift === 'strong' ? STRONG_DUE_DAYS : DUE_DAYS;
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

/**
 * (과목|챕터) → **가장 최근 CBMS 코드**(P-3 입력). 챕터가 빈 기록은 안 센다 — 사다리는 챕터
 * 단위라 붙일 자리가 없다.
 *
 * ⚠ `failingSids` 와 **입도가 다른 것이 이 함수의 전부다.** 저쪽은 백지 결과가 (날짜, 과목)
 * 단위라(토대 B) 신호가 과목 전체에 걸리고, 그래서 같은 과목의 안 막힌 챕터까지 함께
 * 앞당겨진다. CBMS 기록은 **챕터를 알고 있으므로** 그 번짐을 안 만든다.
 * ⚠ 과거의 실패가 영원히 따라다니지 않게 **가장 최근 하나만** 본다(`failingSids` 와 같은 규율 —
 * 오래된 실패가 영원히 남으면 그건 간격반복이 아니라 낙인이다).
 */
export function latestCbmsByChapter(state: AppState, todayDs: string): Map<string, CbmsCode> {
  const latest = new Map<string, { ds: string; at: number; code: CbmsCode }>();
  for (const e of state.cbms || []) {
    const chapter = (e.chapter || '').trim();
    if (!e.sid || !chapter) continue;
    if (!e.ds || e.ds > todayDs) continue; // 미래 기록 무시(시드·시계 어긋남 방어)
    const key = e.sid + '|' + chapter;
    const cur = latest.get(key);
    // 같은 날 여러 건이면 작성시각(`at`)이 동률을 깬다 — 없으면 뒤에 온 것이 이긴다(안정 정렬).
    if (!cur || e.ds > cur.ds || (e.ds === cur.ds && (e.at ?? 0) >= cur.at))
      latest.set(key, { ds: e.ds, at: e.at ?? 0, code: e.code });
  }
  const out = new Map<string, CbmsCode>();
  for (const [k, v] of latest) out.set(k, v.code);
  return out;
}

const TOUCH_TYPES: ReadonlySet<SessionType> = new Set<SessionType>(['new', 'rev', 'blank']);

/** 챕터별 '마지막으로 만진 날' → 경과일·위험도. todayDs 이후(미래) 배치는 무시. 위험 큰 순 정렬. */
export function chapterReviews(state: AppState, days: Day[], todayDs: string): ChapterReview[] {
  const last = new Map<
    string,
    { ds: string; subject: string; sid: string; color?: string; chapter: string; fromVault?: true }
  >();
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
  /* W2 — 볼트 `reviewed:` 앵커 주입. ⚠ **앱 앵커가 아예 없는 챕터에만** 넣는다(`last.has` 가
     그 가드다) — 볼트 값은 검증 통과일이라 인출 기록을 절대 이기면 안 된다(방향 제약 · 자세한
     근거는 `lib/vaultAnchors.ts` 머리주석). 끝낸 챕터는 유지 큐가 소유하므로 여기서 뺀다. */
  const anchors = vaultAnchors();
  if (anchors.size) {
    for (const it of state.items || []) {
      for (const ch of it.chapters || []) {
        if (ch.done) continue;
        const key = it.id + '|' + ch.name;
        if (last.has(key)) continue;
        const ds = anchors.get(key);
        if (!ds || ds > todayDs) continue;
        last.set(key, { ds, subject: it.name, sid: it.id, color: it.color, chapter: ch.name, fromVault: true });
      }
    }
  }
  /* ID-10 — 직전 백지가 막힌 과목은 임계를 한 칸 앞당긴다(성패 가중 · 실패 방향만).
     ⚠⚠ **P-3(2026-08-01) — 그 트리거를 챕터의 CBMS 코드가 가른다.** 순서가 규칙이다:
       ① 이 챕터에 최근 CBMS 코드가 있으면 **그것이 결정한다**(지식 결손 계열만 앞당긴다).
       ② 없으면 종전대로 과목 단위 백지 신호(`failingSids`)로 떨어진다.
     ①이 ②를 이기는 이유: CBMS 는 **챕터를 알고** 백지 결과는 과목만 안다. 더 정밀한 신호가
     있는데 거친 신호로 덮으면, 검산 한 번 놓친 챕터(`S`)가 정말 모르는 챕터와 같은 급함을
     갖는다 — 그게 이 항목이 없앤 오탐이다.
     ⚠ 백지 실패는 대개 자기 CBMS('C')를 자동 생성하므로(`setBlankResult`) ①로 흡수된다.
       즉 ②는 "CBMS 를 안 남긴 옛 기록"의 폴백이지 경쟁 경로가 아니다. */
  const failing = failingSids(state, todayDs);
  const cbmsByChapter = latestCbmsByChapter(state, todayDs);
  const out: ChapterReview[] = [];
  for (const e of last.values()) {
    const daysSince = dayDiff(e.ds, todayDs);
    const code = cbmsByChapter.get(e.sid + '|' + e.chapter);
    const failingNow = code ? CBMS_ADVANCES_REVIEW.has(code) : failing.has(e.sid);
    /* Q-4(통과 방향) — 이 **챕터**가 붙어 있으면 한 칸 미룬다. 신호가 챕터 단위라는 것이 요점이다:
       과목 단위 `failingSids` 로는 못 하던 일이고, 그 불가능이 곧 옛 비대칭의 근거였다.
       ⚠ `strong` 은 `chapterStrength` 의 3구간 중 하나일 뿐이다 — `unseen`(표본 0)은 미룸에
       참여하지 않는다. 안 재 본 챕터를 "잘한다"고 가정하면 그게 가장 나쁜 오류다. */
    const strongNow = chapterStrength(state, e.sid, e.chapter, todayDs).band === 'strong';
    out.push({
      sid: e.sid,
      subject: e.subject,
      color: e.color,
      chapter: e.chapter,
      lastDs: e.ds,
      daysSince,
      risk: riskOf(daysSince, failingNow, strongNow),
      ...(e.fromVault ? { fromVault: true as const } : null),
    });
  }
  return out.sort((a, b) => b.daysSince - a.daysSince || (a.subject < b.subject ? -1 : 1));
}

/* ── 유지(maintenance) 큐 — 끝낸 챕터가 사라지지 않게 (N-10) ─────────────────
   `chapterReviews` 의 입력은 **스케줄**이라 done 챕터를 볼 수 없다(엔진이 블록을 안 만든다).
   그래서 여기선 입력을 뒤집어 **챕터 카탈로그**(`items[].chapters`)에서 done 만 훑는다.

   설계 결정 셋:
   ① **사다리를 새로 짓지 않는다** — 본 사다리(1·3·7·16·34)가 대략 2배 성장이므로 꼬리(34)에서
      같은 성장률로 잇는다. "왜 하필 그 숫자"가 안 생기고, 본 사다리를 고치면 여기가 따라온다.
   ② **한 단 강등 — 유지는 절대 `overdue` 가 되지 않는다.** 진행 중 챕터의 overdue 가 유지에
      밀리면 그건 간격반복이 아니라 향수(鄕愁)다. 최대 `due` 라 티어 정렬만으로 불변식이 선다.
   ③ **앵커를 모르는 챕터**(이 기능 이전에 끝낸 것 · `doneDs` 없음)는 '모름'으로 두고 `due` 로만
      취급한다 — 오래됐다고 단정하지 않는다. 한 번 인출하면 `reviewTouches` 가 진짜 앵커를
      남기므로 스스로 교정된다. 수십 장이 한꺼번에 몰리는 것은 소비처의 **세션 상한**이 막는다
      (`reviewQueue.MAINTENANCE_CAP`) — 상한 없이 이걸 켜면 "끝냈는데 전부 다시"가 된다. */
export const MAINTENANCE_OFFSETS: readonly number[] = [
  REVIEW_TAIL_OFFSET,
  REVIEW_TAIL_OFFSET * 2,
  REVIEW_TAIL_OFFSET * 4,
]; // 34 · 68 · 136

export interface MaintenanceReview extends ChapterReview {
  /** 유지 큐 출신 표식 — 본 사다리 항목과 한 배열에 섞일 때의 구분자(UI 문구·정렬). */
  maintenance: true;
  /** 앵커(끝낸 날 또는 마지막 인출)를 아는가. false 면 `daysSince` 는 의미 없다. */
  anchored: boolean;
}

/** 끝낸 챕터의 유지 상태. 앵커를 아는 것 먼저(오래된 순) → 모르는 것(과목·챕터명 결정 순). */
export function maintenanceReviews(state: AppState, todayDs: string): MaintenanceReview[] {
  const touches = state.reviewTouches || {};
  const out: MaintenanceReview[] = [];
  for (const it of state.items || []) {
    for (const ch of it.chapters || []) {
      if (!ch.done) continue;
      // 앵커 = 끝낸 날과 마지막 인출 중 **최신**(미래 값은 시드·시계 어긋남 방어로 무시).
      const cands = [ch.doneDs, touches[it.id + '|' + ch.name]].filter((d): d is string => !!d && d <= todayDs);
      const lastDs = cands.length ? cands.sort()[cands.length - 1]! : '';
      const anchored = !!lastDs;
      const daysSince = anchored ? dayDiff(lastDs, todayDs) : 0;
      out.push({
        sid: it.id,
        subject: it.name,
        color: it.color,
        chapter: ch.name,
        lastDs,
        daysSince,
        // 강등된 사다리: 첫 칸(34일)을 넘겼거나 언제인지 모르면 due, 그 외 fresh. overdue 는 없다.
        risk: !anchored || daysSince >= MAINTENANCE_OFFSETS[0]! ? 'due' : 'fresh',
        maintenance: true,
        anchored,
      });
    }
  }
  return out.sort(
    (a, b) =>
      Number(b.anchored) - Number(a.anchored) ||
      b.daysSince - a.daysSince ||
      (a.subject + a.chapter < b.subject + b.chapter ? -1 : 1),
  );
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
/**
 * 과목 라운드로빈 한 겹(순수 · 티어 없음). 같은 과목이 연달아 오지 않게 섞되 **각 과목 안의
 * 순서는 보존**한다(입력 순 = 그 과목에서 가장 급한 것부터).
 *
 * ⚠ 제네릭인 이유(E25 · 2026-07-29): 이 규칙이 **복습 큐에서만** 쓰이고 있었다. 계획 쪽
 * `scheduler/layout` 은 생성 순을 그대로 배치해, 앱이 복습 12장에 대해선 인터리빙을 지키면서
 * **하루 6시간의 본 학습에서는 안 지키는** 비대칭이 있었다. 규칙을 두 벌로 만들지 않으려고
 * 키 접근자만 받는다.
 */
export function interleaveByKey<T>(items: T[], keyOf: (t: T) => string): T[] {
  if (items.length < 2) return items.slice();
  const byKey = new Map<string, T[]>();
  for (const it of items) {
    const k = keyOf(it);
    const g = byKey.get(k);
    if (g) g.push(it);
    else byKey.set(k, [it]);
  }
  const groups = [...byKey.values()];
  const out: T[] = [];
  const rounds = Math.max(...groups.map((g) => g.length));
  for (let round = 0; round < rounds; round++) {
    for (const g of groups) if (round < g.length) out.push(g[round]!);
  }
  return out;
}

export function interleaveBySubject(chapters: ChapterReview[]): ChapterReview[] {
  const out: ChapterReview[] = [];
  for (const tier of RISK_TIERS) {
    const inTier = chapters.filter((c) => c.risk === tier);
    if (inTier.length < 2) {
      if (inTier.length) out.push(inTier[0]!);
      continue;
    }
    // 라운드로빈은 `interleaveByKey` 가 소유한다 — 계획 배치와 **같은 한 겹**을 쓴다(E25).
    out.push(...interleaveByKey(inTier, (c) => c.sid));
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
/** 그날 계상된 챕터 1건(앞당길 후보·블록 환산의 원재료). */
export interface ForecastChapter {
  sid: string;
  subject: string;
  color?: string;
  chapter: string;
  /** 그 챕터의 학습 분량(시간 · Chapter.hours). 알 수 없으면 엔진과 같은 1h 폴백. */
  hours: number;
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
  /** 그날 계상된 챕터 원본 — 분량 큰 순(앞당길 후보 산출용). */
  load: ForecastChapter[];
  /** 부하를 **복습 블록 수**로 환산한 값(N-9). 개수가 아니라 분량으로 재므로 30분짜리와 3시간짜리
   *  챕터가 같은 무게로 세지지 않는다. 부하가 있으면 최소 1(엔진의 복습은 블록 단위라 반올림 0이 없다). */
  blocks: number;
  /** 그날 복습에 쓸 수 있는 가용선(블록). 계획 배열에 그 날이 없으면 **null = 모름**(선을 안 그린다). */
  capBlocks: number | null;
  /** blocks > capBlocks — 그날은 복습이 물리적으로 안 들어간다. 모르면(capBlocks null) false. */
  over: boolean;
}

/* ── 가용선(N-9) ───────────────────────────────────────────────────────────
   개수 막대는 "언젠가 몰린다"까지만 말하고 "그 날은 물리적으로 안 들어간다"를 못 말한다.
   비교가 가능하려면 부하와 가용이 **같은 단위**여야 하는데, 그 단위를 새로 지어낼 필요가 없다 —
   엔진이 이미 "학습 1모듈(ML분)당 복습 1블록(reviewBlockMin)"으로 계획하고 있다. 그래서
     · 부하 = 그날 복습할 챕터들이 **원래 몇 모듈치 학습이었나**(Chapter.hours 합 ÷ ML)
     · 가용 = 그날 복습에 쓸 수 있는 분 ÷ 복습 1블록 분
   둘 다 엔진 상수에서 파생돼 **임의 계수가 0개**다(spacedReview 는 계수를 안 만든다는 규율).

   ⚠ **분이 아니라 블록으로 반올림**한다. `Chapter.hours` 는 볼트 산출에서 노트×0.5h 같은 거친
      추정이라 분 단위 비교는 가짜 정밀이고, 가용선이 틀리면 앱이 "불가능"이라 겁을 준다.
   ⚠ 가용에서 **`rev` 블록은 빼지 않는다** — 계획의 rev 가 바로 이 예보가 투영하는 그것이라,
      빼면 같은 복습을 두 번 세고 가용선이 실제보다 낮아진다(= 없는 위기를 만든다).
   ⚠ 이 예보는 **완료된 학습만** 투영하므로(chapterReviews 의 isDone 게이팅) 미래에 배울 것에서
      나올 복습은 안 들어 있다. 즉 부하는 하한이다 — 그래서 가용선을 넘으면 "정말 넘는다". */

/** `sid|챕터명` → 학습 시간. 엔진의 `Math.max(0.1, +c.hours || 1)` 폴백과 같은 규칙을 쓴다
 *  (같은 챕터가 계획에선 1h, 예보에선 0h 로 세지면 두 화면이 다른 세계를 말한다). */
function chapterHours(state: AppState): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of state.items || [])
    for (const c of it.chapters || []) m.set(it.id + '|' + c.name, Math.max(0.1, +c.hours || 1));
  return m;
}

/** 그날 복습에 쓸 수 있는 분 → 블록. 계획 배열에 없는 날은 null(모름 · 선을 안 그린다). */
function capBlocksOf(day: Day | undefined, revMin: number): number | null {
  if (!day) return null;
  // 이미 계획된 **비복습** 블록(학습·Anki·백지·모의)은 그 시간을 이미 쓴다 → 가용에서 뺀다.
  const committed = day.items.reduce((t, it) => (it.type === 'rev' ? t : t + it.min), 0);
  return Math.floor(Math.max(0, day.studyMin - committed) / revMin);
}

/** 앞 horizon일 날짜별 복습 부하(볼트 챕터) 예보. 챕터 하나가 여러 오프셋 경계에 걸리면
 *  각 날에 계상된다(예: 오늘 만진 챕터 → 1·3·7일에 각각 = 실제 간격반복 파도 모양).
 *  이미 모든 오프셋을 지난(overdue) 챕터는 미래 투영이 음수라 자연히 빠진다(=오늘탭 backlog).
 *  각 날은 부하·가용을 **복습 블록** 단위로 함께 싣는다(위 가용선 주석). */
export function dueForecast(
  state: AppState,
  days: Day[],
  todayDs: string,
  horizon: number = FORECAST_HORIZON,
): ForecastDay[] {
  // dayOffset(1..horizon) → 그날 계상된 챕터들
  const buckets = new Map<number, ForecastChapter[]>();
  const hoursOf = chapterHours(state);
  const project = (ch: ChapterReview, offsets: readonly number[]): void => {
    const hours = hoursOf.get(ch.sid + '|' + ch.chapter) ?? 1;
    for (const off of offsets) {
      const d = off - ch.daysSince; // 오늘로부터 이 복습까지 남은 일수
      if (d < 1 || d > horizon) continue;
      const at = buckets.get(d);
      const entry: ForecastChapter = { sid: ch.sid, subject: ch.subject, color: ch.color, chapter: ch.chapter, hours };
      if (at) at.push(entry);
      else buckets.set(d, [entry]);
    }
  };
  for (const ch of chapterReviews(state, days, todayDs)) project(ch, FORECAST_OFFSETS);
  /* 끝낸 챕터의 유지 복습도 같은 파도다(N-10) — 예보만 그것을 못 보면 "계획엔 있는데 예보엔
     없는 일"이 생긴다. ⚠ **앵커를 아는 것만** 투영한다: 언제 끝냈는지 모르는 챕터는 미래
     날짜를 특정할 수 없고, 모르는 것을 특정 날짜에 그리면 그 날의 가용선 판정까지 거짓이 된다
     (그쪽은 러너의 세션 상한이 소화한다). */
  for (const ch of maintenanceReviews(state, todayDs)) if (ch.anchored) project(ch, MAINTENANCE_OFFSETS);
  const ML = state.moduleLen || 120;
  const revMin = reviewBlockMin(ML);
  const dayOf = new Map(days.map((d) => [d.ds, d]));
  const base = parseISO(todayDs);
  const out: ForecastDay[] = [];
  for (let d = 1; d <= horizon; d++) {
    const load = (buckets.get(d) || [])
      .slice()
      .sort((a, b) => b.hours - a.hours || (a.subject + a.chapter < b.subject + b.chapter ? -1 : 1));
    const bySid = new Map<string, ForecastSubject>();
    for (const c of load) {
      const cur = bySid.get(c.sid);
      if (cur) cur.count++;
      else bySid.set(c.sid, { sid: c.sid, subject: c.subject, color: c.color, count: 1 });
    }
    const subjects = [...bySid.values()].sort((a, b) => b.count - a.count || (a.subject < b.subject ? -1 : 1));
    const date = addDays(base, d);
    const ds = iso(date);
    // 부하 블록 = 그 챕터들이 원래 몇 모듈치 학습이었나. 부하가 있으면 최소 1블록(복습은 블록 단위).
    const modules = load.reduce((t, c) => t + (c.hours * 60) / ML, 0);
    const blocks = load.length ? Math.max(1, Math.round(modules)) : 0;
    const capBlocks = capBlocksOf(dayOf.get(ds), revMin);
    out.push({
      ds,
      offset: d,
      wd: date.getDay(),
      chapters: load.length,
      subjects,
      load,
      blocks,
      capBlocks,
      over: capBlocks != null && blocks > capBlocks,
    });
  }
  return out;
}

/** 앞당길 후보 — 가용선을 넘는 날의 챕터를, **그 전에 여유가 있는 가장 이른 날**로 옮긴다.
 *  분량 큰 것부터(같은 수의 클릭으로 가장 많이 던다) 최대 cap개. 목적지를 못 찾으면 `toOffset:null`
 *  = "오늘 미리 보기"(복습을 앞당기는 건 언제나 가능하다 — 예보에 없는 오늘이 마지막 답).
 *  ⚠ 후보마다 목적지 여유를 1블록씩 소진한다 — 안 그러면 셋 다 같은 날을 가리켜 그 날이 새 파도가 된다. */
export interface PullForward {
  chapter: ForecastChapter;
  /** 목적지 오프셋(1..) · null 이면 오늘. */
  toOffset: number | null;
}
export function pullForwardCandidates(forecast: ForecastDay[], offset: number, cap = 3): PullForward[] {
  const target = forecast.find((f) => f.offset === offset);
  if (!target) return [];
  const slack = new Map<number, number>();
  for (const f of forecast)
    if (f.offset < offset && f.capBlocks != null) slack.set(f.offset, Math.max(0, f.capBlocks - f.blocks));
  return target.load.slice(0, cap).map((chapter) => {
    for (const [off, s] of slack)
      if (s >= 1) {
        slack.set(off, s - 1);
        return { chapter, toOffset: off };
      }
    return { chapter, toOffset: null };
  });
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
