/* ============================================================
   chapterView.ts — 챕터 1건의 **전 상태**를 한 셀렉터로(N-2 첫 조각).

   문제: "전자기학 3장, 노트 썼나 카드 있나 언제 복습" 을 알려면 `items`+`mastery`+`ledger`+
   `graph` **4화면·최소 6클릭**이었다. 객체(챕터)가 목적지가 아니라 화면마다 흩어진 행이었다.

   ⚠ **1차 조각은 앱 상태만 읽는다**(계획·복습·기록). 볼트 산출물(mastery·ledger) 조인은
   **일부러 미룬다**: 조인 키가 basename 정확일치 수준이고(퍼지 매칭은 로드맵이 명시 거부)
   실패하면 서랍 절반이 빈칸인데, **빈 서랍은 "데이터 없음"이 아니라 "이 도구가 나를 모른다"로
   읽혀** 신뢰를 깎는다. 그래서 첫 조각은 **반드시 채워지는 것만** 담는다 — 여기 있는 세 값은
   전부 앱이 스스로 쓴 데이터라 조인이 실패할 수 없다.
============================================================ */
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
