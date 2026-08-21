/* ============================================================
   subjectMatch.test.ts — 과목 이름 조인 규칙(E3 · 2026-07-29).

   규칙 자체의 회귀는 `scheduler.test.ts` T27·T33 이 `subjectMastery` 를 통해 이미 잠그고 있다.
   여기서 잠그는 것은 **추출된 규칙이 그와 같은가**와, 새로 생긴 **계측**(`subjectJoin`)이
   매칭과 같은 답을 내는가다 — 둘이 갈리면 화면이 말하는 성공률과 배분이 쓰는 매칭이 달라진다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { matchSubjectIndex, matchSubjectKind, normSubject, subjectJoin } from '@/lib/subjectMatch';

describe('matchSubjectIndex — 규칙', () => {
  it('공백을 무시하고 맞춘다', () => {
    expect(normSubject(' 전자 기학 ')).toBe('전자기학');
    expect(matchSubjectIndex('전자 기학', ['전자기학'])).toBe(0);
  });

  it('정확 일치가 앞선 포함 히트를 이긴다(L-9 오매핑)', () => {
    // '물리화학'이 먼저 오지만 '물리'와 정확 일치하는 뒤 후보가 이겨야 한다.
    expect(matchSubjectIndex('물리', ['물리화학', '물리'])).toBe(1);
  });

  it('정확 일치가 없으면 포함 후보 중 길이차가 가장 작은 것', () => {
    expect(matchSubjectIndex('수학', ['공업수학개론', '수학1'])).toBe(1);
  });

  it('동점이면 먼저 온 후보가 이긴다(결정성)', () => {
    expect(matchSubjectIndex('수학', ['수학a', '수학b'])).toBe(0);
  });

  it('빈 질의는 전 과목을 매칭하지 않는다 — -1(L-9)', () => {
    expect(matchSubjectIndex('', ['물리', '수학'])).toBe(-1);
    expect(matchSubjectIndex('   ', ['물리'])).toBe(-1);
  });

  it('공백뿐인 후보는 전 질의에 매칭되지 않는다 — 역오염 방지(L-9)', () => {
    expect(matchSubjectIndex('물리', ['   ', ''])).toBe(-1);
  });

  it('겹치는 글자가 없으면 -1 — 억지로 붙이지 않는다', () => {
    expect(matchSubjectIndex('전자기학', ['미적분', '통계'])).toBe(-1);
  });
});

describe('subjectJoin — 계측', () => {
  it('붙은 수와 안 붙은 이름을 함께 준다', () => {
    const r = subjectJoin(['물리', '전자기학', '통계'], ['물리학개론', '전자기학']);
    /* ⚠ `partial` 이 붙었다(I035 · 2026-08-22): 「물리」는 정확 일치가 아니라 **추정**이다.
       그 구분이 없으면 배분을 구동하는 추측이 확정처럼 읽힌다. */
    expect(r).toEqual({ total: 3, matched: 2, unmatched: ['통계'], partial: ['물리'] });
  });

  it('후보가 0이면 전부 미연결 — "표기 불일치"가 아니라 "붙일 상대가 없다"', () => {
    const r = subjectJoin(['물리', '수학'], []);
    expect(r).toEqual({ total: 2, matched: 0, unmatched: ['물리', '수학'], partial: [] });
  });

  it('이름 없는 항목은 분모에서 뺀다', () => {
    const r = subjectJoin(['물리', '', '  '], ['물리']);
    expect(r.total).toBe(1);
    expect(r.matched).toBe(1);
  });

  it('계측은 매칭과 **같은 규칙**이다 — 한쪽만 붙는 이름이 없다', () => {
    const names = ['물리', '물리화학', '수학', '없는과목'];
    const cands = ['물리', '수학1'];
    const r = subjectJoin(names, cands);
    const byRule = names.filter((n) => matchSubjectIndex(n, cands) >= 0);
    expect(r.matched).toBe(byRule.length);
    expect(r.unmatched).toEqual(names.filter((n) => matchSubjectIndex(n, cands) < 0));
  });

  it('미연결 목록은 입력 순서를 지킨다(화면이 흔들리지 않게)', () => {
    expect(subjectJoin(['c', 'a', 'b'], []).unmatched).toEqual(['c', 'a', 'b']);
  });
});

/* ============================================================
   I035 — **매칭기를 제안기로 강등한다**(2026-08-22 발상 축).

   규칙 ③(부분문자열)은 «가장 그럴듯한 추측»이고, 그 결과는 `masteryNeed` 를 통해 **배분을
   실제로 구동한다**. 두 칸(붙었다/안 붙었다)으로 보고하면 추측이 확정처럼 읽히고, 틀린 날에도
   화면에 아무 신호가 없다.

   ⚠ 규칙 자체는 안 바꿨다 — 바뀐 것은 **보고**다. 그 사실을 아래 마지막 케이스가 잠근다.
============================================================ */
describe('matchSubjectKind — 어떻게 붙었나', () => {
  it('정확히 같으면 exact(공백은 무시한다 · 규칙 ①)', () => {
    expect(matchSubjectKind('전자기학', ['전자기학'])).toBe('exact');
    expect(matchSubjectKind('전 자 기 학', ['전자기학'])).toBe('exact');
  });

  it('⚠ 부분문자열로 붙은 것은 partial 이다 — 확정이 아니다', () => {
    expect(matchSubjectKind('물리', ['물리학개론'])).toBe('partial');
  });

  it('안 붙으면 none', () => {
    expect(matchSubjectKind('통계', ['물리학개론'])).toBe('none');
    expect(matchSubjectKind('', ['물리'])).toBe('none');
  });

  it('⚠⚠ 규칙은 안 바뀌었다 — 고르는 후보가 `matchSubjectIndex` 와 같다', () => {
    const cands = ['물리', '물리화학'];
    for (const n of ['물리', '물리화', '화학', '없음']) {
      const i = matchSubjectIndex(n, cands);
      const kind = matchSubjectKind(n, cands);
      expect(kind === 'none').toBe(i < 0);
    }
  });
});
