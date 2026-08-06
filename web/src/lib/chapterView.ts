/* ============================================================
   chapterView.ts — 챕터 1건의 **전 상태**를 한 셀렉터로(N-2 첫 조각).

   문제: "전자기학 3장, 노트 썼나 카드 있나 언제 복습" 을 알려면 `items`+`mastery`+`ledger`+
   `graph` **4화면·최소 6클릭**이었다. 객체(챕터)가 목적지가 아니라 화면마다 흩어진 행이었다.

   ⚠ **1차 조각은 앱 상태만 읽는다**(계획·복습·기록). 볼트 산출물(mastery·ledger) 조인은
   **일부러 미뤘다**: 조인 키가 basename 정확일치 수준이고(퍼지 매칭은 로드맵이 명시 거부)
   실패하면 서랍 절반이 빈칸인데, **빈 서랍은 "데이터 없음"이 아니라 "이 도구가 나를 모른다"로
   읽혀** 신뢰를 깎는다. 그래서 첫 조각은 **반드시 채워지는 것만** 담았다.

   ## ✅ 2단계 — 그 유보를 **실측이 풀었다**(2026-08-06)

   N-2 는 조인을 _"성공률 실측 뒤"_ 로 미뤘고, 그 실측을 실 볼트에서 돌렸다:

     · 과목 축 — 원장 4 / 지식 4 · **교집합 4(100%)**
     · 개념 축 — 지식 개념 **626개 전량이 원장 챕터에 도달**(인덱스 경유 · 실패 0)
     · 챕터 축 — 볼트 폴더에서 파생한 챕터명이 원장 `arc` 와 **전부 일치**

   즉 유보의 근거였던 위험(_"절반이 빈칸"_)은 **이 볼트에서 실현되지 않는다.** 원인은 우연이
   아니라 구조다 — 두 산출물이 **같은 파이프라인이 같은 폴더 트리를 훑어** 만들어진다.

   ⚠ **그래도 실패를 가정한다.** 사용자가 챕터 이름을 손으로 고치면 그 순간 조인이 깨지고,
   그건 로드맵이 못 박은 그 형태로 나타난다 → `chapterVault()` 는 **못 붙으면 `null`**이고
   호출부는 그 칸을 **아예 안 그린다**(빈칸을 그리지 않는다 = 유보의 원래 취지 유지).
============================================================ */
import type { Furthest, Ledger } from './ledger';
import { matchSubjectIndex } from './subjectMatch';
import { chapterReviews, maintenanceReviews, type ReviewRisk } from './spacedReview';
import type { AppState, Day } from './types';

export interface ChapterSnapshot {
  sid: string;
  subject: string;
  chapter: string;
  /** 학습 분량(시간). 카탈로그에 없으면 null. */
  hours: number | null;
  done: boolean;
  /** 끝낸 날(N-10 이후 기록). 옛 완료 챕터는 null = 모름. */
  doneDs: string | null;
  /** 마지막으로 만진 날(계획 완료 + 러너 터치 중 최신). 없으면 null. */
  lastDs: string | null;
  /** 경과일 — `lastDs` 가 있을 때만. */
  daysSince: number | null;
  /** 복습 위험. 끝낸 챕터는 유지 사다리 기준(절대 overdue 가 아니다 · N-10). */
  risk: ReviewRisk | null;
  /** 유지 큐 소속인가(=끝낸 챕터). */
  maintenance: boolean;
  /** 이 챕터에 남긴 CBMS(막힘·착각) 기록 수. */
  cbms: number;
}

/** 챕터 1건의 현재 상태. 대상이 카탈로그에 없으면 null. */
export function chapterSnapshot(
  state: AppState,
  days: Day[],
  todayDs: string,
  sid: string,
  chapter: string,
): ChapterSnapshot | null {
  const item = (state.items || []).find((i) => i.id === sid);
  if (!item) return null;
  const ch = (item.chapters || []).find((c) => c.name === chapter);
  const active = chapterReviews(state, days, todayDs).find((c) => c.sid === sid && c.chapter === chapter);
  const keep = maintenanceReviews(state, todayDs).find((c) => c.sid === sid && c.chapter === chapter);
  // 진행 중 스캔이 우선이다 — 같은 챕터가 둘 다에 뜨는 경우는 없지만(done 이면 계획에서 빠진다)
  // 순서를 명시해 두지 않으면 나중에 한쪽이 조용히 이기는 형태가 된다.
  const hit = active ?? keep;
  const cbms = (state.cbms || []).filter((e) => e.sid === sid && e.chapter === chapter).length;
  return {
    sid,
    subject: item.name,
    chapter,
    hours: ch ? +ch.hours || null : null,
    done: !!ch?.done,
    doneDs: ch?.doneDs ?? null,
    lastDs: hit?.lastDs || null,
    daysSince: hit?.lastDs ? hit.daysSince : null,
    risk: hit?.risk ?? null,
    maintenance: !!keep && !active,
    cbms,
  };
}

/** 위험 표기(사람이 읽는 말). 유지 큐 항목은 다른 말을 쓴다 — 같은 'due' 라도 뜻이 다르다. */
export function riskWord(s: ChapterSnapshot): string {
  if (!s.risk) return '기록 없음';
  if (s.maintenance) return s.risk === 'fresh' ? '유지 중' : '유지 복습 때';
  if (s.risk === 'overdue') return '많이 밀림';
  return s.risk === 'due' ? '복습 때' : '최근에 봄';
}

/* ── N-2 2단계 — 볼트 산출물 조인(2026-08-06) ───────────────────────────────────────
   서랍이 여태 답하지 못한 질문이 하나 있었다: **"이 챕터, 자료는 어디까지 갔나"**. 그 답은
   `ledger`(챕터원장)에 이미 있고 축이 같다(과목×챕터) — 그래서 인덱스도 개념 매칭도 필요 없이
   **arc 이름 하나**로 붙는다. 위 머리주석의 실측이 그 이름이 실제로 일치함을 보였다. */

/** 이 챕터의 볼트 쪽 사실. **조인이 성립할 때만** 존재한다(못 붙으면 호출부가 안 그린다). */
export interface ChapterVault {
  /** 이 챕터 폴더의 노트 수. */
  notes: number;
  /** 그중 `status: verified`. */
  verified: number;
  /** Anki 로 나간 카드 수. */
  cards: number;
  /** 5단계 중 가장 멀리 간 곳. */
  furthest: Furthest;
  /** 마지막 검증 통과일(파이프라인). 없으면 null — **인출일이 아니다.** */
  reviewedRecent: string | null;
}

/**
 * 챕터 1건의 볼트 진척. 원장이 없거나 **이름이 안 붙으면 `null`**.
 *
 * ⚠ 과목은 `matchSubjectIndex`(앱 전역의 과목 매칭 하나)로, 챕터는 **정확일치**로 붙인다.
 * 챕터까지 퍼지로 붙이면 `01 극한`과 `01 극한과 연속`이 서로를 먹고, 그 오답은 화면에서
 * 구분되지 않는다(로드맵이 퍼지 매칭을 명시 거부한 지점이 여기다).
 */
export function chapterVault(led: Ledger | undefined | null, subject: string, chapter: string): ChapterVault | null {
  if (!led) return null;
  const names = Object.keys(led.subjects || {});
  const i = matchSubjectIndex(subject, names);
  if (i < 0) return null;
  const s = led.subjects[names[i]!];
  const ch = s?.chapters.find((c) => c.arc === chapter);
  if (!ch) return null;
  return {
    notes: ch.notes,
    verified: ch.status?.verified ?? 0,
    cards: ch.cards,
    furthest: ch.furthest,
    reviewedRecent: ch.reviewed_recent || null,
  };
}
