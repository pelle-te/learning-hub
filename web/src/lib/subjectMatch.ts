/* ============================================================
   subjectMatch.ts — 과목 이름을 **소스 간에 맞추는** 한 규칙(E3 · 2026-07-29).

   이 앱은 과목 이름을 네 곳에서 각자 적는다: 앱의 `items[].name` · 볼트 폴더명 ·
   지식엔진 산출(`_knowState.subjects[].subject`) · Anki 덱 이름. 그 넷을 잇는 규칙은
   `scheduler/priority.subjectMastery` 안에 **인라인으로만** 있었고, 무엇보다

   ⚠ **실패가 조용했다.** 안 붙으면 `null` 을 돌려주고 끝이라, 몇 과목이 안 붙었는지
   아무 화면에도 없었다. 그런데 그 규칙은 `masteryNeed` 를 통해 **실제로 배분을 구동한다** —
   조용히 틀리고 있어도 아무도 모른다. 그리고 이 미지수 하나가 보류 항목 셋을 동시에 막고
   있었다(`p_eff` 복습 tie-break · 유지 큐 Anki 중복 제외 · 폰 볼트 노트 미러).

   그래서 규칙을 여기로 올리고 **조인 리포트**(`subjectJoin`)를 짝으로 둔다. 리포트가 이
   모듈에 있는 것이 요점이다: 매칭과 계측이 갈리면 "화면이 말하는 성공률"과 "배분이 실제로
   쓰는 매칭"이 서로 다른 규칙이 된다.

   ## 규칙 (옛 `subjectMastery` 에서 문자 그대로 옮겼다 — 배분을 구동하며 검증돼 온 것)
   ① 공백을 지우고 비교한다(양쪽 표기 흔들림 흡수).
   ② **정확 일치 우선.**
   ③ 없으면 포함(부분문자열) 후보 중 **길이차가 가장 작은 것**. 첫-포함 히트를 쓰면
      "물리"↔"물리화학" 같은 오매핑이 배분을 조용히 오염시킨다(L-9).
   ④ 빈 문자열은 어느 쪽이든 매칭 불가로 취급한다 — `''.indexOf('')` 가 0이라, 안 막으면
      빈 질의가 **전 과목을 매칭**하고 빈 후보가 **전 질의에 매칭**된다(L-9 실사고 둘).
   ⑤ 동점이면 먼저 온 후보가 이긴다(안정성 — 후보 순서가 곧 결정성이다).
============================================================ */

/** 비교용 정규화 — 공백 제거. 규칙 ①. */
export function normSubject(s: string): string {
  return (s || '').replace(/\s/g, '');
}

/**
 * `name` 에 가장 잘 맞는 후보의 **인덱스**(없으면 -1). 규칙은 이 파일 머리주석.
 *
 * 인덱스를 돌려주는 이유: 호출부마다 후보에 달린 값이 다르다(숙달도·덱 due·노트 경로).
 * 값을 돌려주면 소비처마다 다른 시그니처가 필요해지고, 그러면 규칙이 다시 갈린다.
 */
export function matchSubjectIndex(name: string, candidates: readonly string[]): number {
  const b = normSubject(name);
  if (!b) return -1; // 규칙 ④
  let best = -1;
  let bestGap = Infinity;
  for (let i = 0; i < candidates.length; i++) {
    const a = normSubject(candidates[i] ?? '');
    if (!a) continue; // 규칙 ④
    if (a === b) return i; // 규칙 ②
    if (a.indexOf(b) >= 0 || b.indexOf(a) >= 0) {
      const gap = Math.abs(a.length - b.length);
      if (gap < bestGap) {
        // 규칙 ③·⑤(`<` 라 동점은 먼저 온 것이 이긴다)
        bestGap = gap;
        best = i;
      }
    }
  }
  return best;
}

/** 조인 계측 결과. `unmatched` 는 **질의 쪽**(대개 앱의 과목) 이름이다 — 사용자가 고칠 수 있는 쪽. */
export interface JoinReport {
  /** 질의 총수(빈 이름 제외). */
  total: number;
  /** 후보에 붙은 수. */
  matched: number;
  /** 안 붙은 질의 이름(입력 순서 유지). */
  unmatched: string[];
}

/**
 * `names` 중 몇 개가 `candidates` 에 붙는지 센다 — **매칭과 같은 규칙으로**(위 ⚠ 참조).
 *
 * ⚠ 후보가 0이면 `matched:0` 이다. 그건 "이름이 안 맞는다"가 아니라 "붙일 상대가 없다"이므로
 *   화면은 그 둘을 구분해 말해야 한다(파이프라인 미가동 vs 표기 불일치는 처방이 다르다).
 */
export function subjectJoin(names: readonly string[], candidates: readonly string[]): JoinReport {
  const unmatched: string[] = [];
  let total = 0;
  let matched = 0;
  for (const n of names) {
    if (!normSubject(n)) continue; // 이름 없는 항목은 셈에서 뺀다(분모를 오염시킨다)
    total++;
    if (matchSubjectIndex(n, candidates) >= 0) matched++;
    else unmatched.push(n);
  }
  return { total, matched, unmatched };
}
