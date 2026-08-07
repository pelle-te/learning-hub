/* ============================================================
   knowledgeElements.ts — **N-4 지식요소(KC) 축**(순수 · React 무관)

   ## 이 파일이 여는 것: 챕터를 **가로지르는** 약점
   이 앱의 모든 약점 축이 `sid|챕터명` 이라, 3장·5장·7장에서 각각 한 번씩 막히면 **어느
   챕터도 `weakSpots` 임계(2회)에 안 들어오고 앱은 "괜찮다"고 말한다.** 실제로는 세 챕터의
   공통 도구에서 세 번 막힌 것이다 — 단원별로는 다 통과인데 시험에서 무너지는 형태.

   `weakSpots`(챕터 단위)와 **경쟁하지 않는다.** 같은 오답을 두 축으로 볼 뿐이고, 둘이 다른
   답을 내는 것이 정상이다: 챕터 축은 *어디를 다시 볼까*, 요소 축은 *무엇을 훈련할까*.

   ## ⚠⚠ 처방이 다르다는 것이 이 축의 전부다
   챕터 축의 처방은 "그 챕터를 다시 봐라"이고, 이 축의 처방은 **"챕터 3개를 각각 정독하지
   말고 요소 1개를 훈련해라"** 다. 그 차이가 없으면 이 축은 중복이다.

   ## ⚠ 폐기 조건이 붙어 있다
   로드맵 N-4 의 전제는 *"한 요소가 실제로 2개 이상 챕터에 걸친다"* 이고, 안 걸치면
   **요소 = 챕터**라 이 축은 중복이다. 그래서 `crossChapter` 가 이 파일의 판정 함수다 —
   그 목록이 계속 비면 축을 지운다(발산 §1-b 의 폐기 조건을 코드로 옮긴 것).
============================================================ */
import type { AppState, Cbms } from './types';

/** 태그 정규화 — **`trim` 만 한다.** 동의어 통합은 사람이 볼 문제이고, 자동으로 묶으면
 *  묶은 근거가 어디에도 안 남는다(대소문자·띄어쓰기도 그 사람의 표기다). */
export const normKc = (s: string): string => s.trim();

/** 한 기록의 태그들(중복 제거 · 빈 값 제거). */
export function kcOf(e: Pick<Cbms, 'kc'>): string[] {
  const out: string[] = [];
  for (const raw of e.kc || []) {
    const k = normKc(raw);
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

export interface KcStat {
  kc: string;
  /** 이 요소로 태그된 오답 수. */
  hits: number;
  /** 그 오답들이 걸친 **서로 다른 챕터** 키(`sid|chapter`). */
  chapters: string[];
  /** 가장 최근 기록일. */
  lastDs: string;
}

/**
 * 요소별 집계 — 걸친 챕터가 많은 순 → 횟수 순.
 *
 * ⚠ 정렬 1순위가 **횟수가 아니라 걸친 챕터 수**인 것이 의도다. 한 챕터에서 5번 막힌 것은
 * 챕터 축이 이미 잡는다(`weakSpots`). 이 축이 유일하게 볼 수 있는 것은 **번짐**이다.
 * ⚠ 미래 기록은 안 센다(시드·시계 어긋남 방어 — 이 저장소 공통 규율).
 */
export function kcStats(state: AppState, todayDs: string): KcStat[] {
  const by = new Map<string, { hits: number; chapters: Set<string>; lastDs: string }>();
  for (const e of state.cbms || []) {
    if (!e.ds || e.ds > todayDs) continue;
    const chapterKey = e.sid && e.chapter ? e.sid + '|' + e.chapter : '';
    for (const kc of kcOf(e)) {
      const g = by.get(kc);
      if (g) {
        g.hits++;
        if (chapterKey) g.chapters.add(chapterKey);
        if (e.ds > g.lastDs) g.lastDs = e.ds;
      } else {
        by.set(kc, { hits: 1, chapters: new Set(chapterKey ? [chapterKey] : []), lastDs: e.ds });
      }
    }
  }
  return [...by.entries()]
    .map(([kc, g]) => ({ kc, hits: g.hits, chapters: [...g.chapters].sort(), lastDs: g.lastDs }))
    .sort((a, b) => b.chapters.length - a.chapters.length || b.hits - a.hits || (a.kc < b.kc ? -1 : 1));
}

/**
 * **챕터를 가로지르는** 요소만 — 이 축의 존재 이유이자 폐기 조건.
 *
 * 2개 이상 챕터에 걸친 요소가 없다면 요소 = 챕터이고, 그러면 이 축은 중복이라 **지워야 한다**
 * (로드맵 N-4 의 검증: *"다른 챕터에서 같은 태그가 2회 이상 나오면 참, 0이면 폐기"*).
 */
export function crossChapter(state: AppState, todayDs: string): KcStat[] {
  return kcStats(state, todayDs).filter((s) => s.chapters.length >= 2);
}

/** 지금까지 쓴 태그 전부(최근 쓴 순) — 입력 자동완성용. 새 분류 체계를 만들지 않는 대신
 *  **이미 쓴 말을 다시 제안**하는 것이 동의어 난립을 막는 유일한 장치다. */
export function knownKc(state: AppState, todayDs: string): string[] {
  return kcStats(state, todayDs)
    .slice()
    .sort((a, b) => (a.lastDs > b.lastDs ? -1 : a.lastDs < b.lastDs ? 1 : a.kc < b.kc ? -1 : 1))
    .map((s) => s.kc);
}

/**
 * 한 칸(`sid|chapter`)의 오답 전부에 요소 태그를 **덧붙인다**(N-4 입구).
 *
 * ⚠ 왜 기록 단위가 아니라 칸 단위인가: 이 축의 검증이 *"기존 오답 30건에 손으로 달아 본다"*
 * 인데, 기록마다 달게 하면 30번을 눌러야 해서 **실험 자체가 안 일어난다**(오답 로그가 항목당
 * 시간에서 죽는다는 것이 `ReviewRun` 이 이미 인용한 근거다). 칸 단위면 한 번에 끝나고,
 * 이 축이 보려는 것(**챕터를 가로지르는 번짐**)은 칸 단위로도 그대로 관측된다 —
 * 다른 칸에 같은 태그가 붙는지가 전부이기 때문이다.
 *
 * ⚠ **덧붙이기다(덮어쓰기 아님)** — 한 오답이 두 도구에 걸칠 수 있고, 기존 태그를 지우는
 * 것은 이 함수의 일이 아니다(떼는 것은 `untagChapter` 가 한다).
 * ⚠ 챕터가 빈 칸(`sid|`)도 태그할 수 있다 — `mistakeArchive` 가 그 기록을 안 버리는 것과
 * 같은 이유다(과목 단위로라도 "여기서 막힌다"는 사실이 남는다).
 */
export function tagChapter(state: AppState, sid: string, chapter: string, kc: string): number {
  const tag = normKc(kc);
  if (!tag) return 0;
  let n = 0;
  for (const e of state.cbms || []) {
    if ((e.sid || '') !== sid || (e.chapter || '').trim() !== chapter) continue;
    const cur = kcOf(e);
    if (cur.includes(tag)) continue;
    e.kc = [...cur, tag];
    n++;
  }
  return n;
}

/** 그 칸에서 태그 하나를 뗀다(잘못 단 것을 되돌리는 유일한 경로). 뗀 기록 수를 돌려준다. */
export function untagChapter(state: AppState, sid: string, chapter: string, kc: string): number {
  const tag = normKc(kc);
  let n = 0;
  for (const e of state.cbms || []) {
    if ((e.sid || '') !== sid || (e.chapter || '').trim() !== chapter) continue;
    const cur = kcOf(e);
    if (!cur.includes(tag)) continue;
    e.kc = cur.filter((k) => k !== tag);
    n++;
  }
  return n;
}

/** 그 칸에 이미 붙어 있는 태그들(표시용 · 정렬 고정). */
export function chapterKc(state: AppState, sid: string, chapter: string): string[] {
  const out = new Set<string>();
  for (const e of state.cbms || []) {
    if ((e.sid || '') !== sid || (e.chapter || '').trim() !== chapter) continue;
    for (const k of kcOf(e)) out.add(k);
  }
  return [...out].sort();
}
