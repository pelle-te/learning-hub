/* ============================================================
   applyMarks.test.ts — **학사 눈금 인입 규칙**(C036 · 2026-08-22 코드 축 1회차).

   ## 왜 이 파일이 여태 없었나

   이 11줄은 `degree/CalendarIntake.tsx` 와 `degree/SyllabusIntake.tsx` 에 **글자 그대로**
   복제돼 있었고(`diff` 차이 0줄) 그 규칙에 닿는 테스트는 **0건**이었다 —
   `rg -c "CalendarIntake|SyllabusIntake" test e2e` → 0. 즉 **컴포넌트를 렌더하지 않으면 도달
   방법 자체가 없었다.** 코드 축 1회차가 이것을 근본 원인 **R3**(새 표면이 규칙을 `.tsx` 콜백
   안에 두고 테스트를 안 붙인다)로 세웠고, 처방은 «읽기가 사는 곳으로 쓰기를 내린다» 였다.
   읽기(`marksOf`)는 이미 `lib/semester.ts` 한 곳이 소유하고 있었다.

   ## 무엇이 깨질 뻔했나 — 사본이 갈리는 구체적 경로

   중복 판정 키가 `(ds, kind)` 다. 같은 날 **보강 두 건**(1교시·3교시)이 오면 지금도 한 건만
   들어가므로, 키에 `label` 을 더하는 수정이 언젠가 온다. 그때 고치는 사람은 자기가 연 화면
   하나만 고치고 → `.ics` 경로는 두 건 · 붙여넣기 경로는 한 건이 들어간다.
   **같은 학기에 인입 경로에 따라 다른 눈금 집합**이 남고, 게이트는 전량 녹색이다.

   ⚠ 아래 「같은 날 같은 종류 둘」 케이스는 **현재 동작을 못박는 것**이지 그것이 옳다는 주장이
   아니다 — 바꾸고 싶으면 여기 한 곳을 고치면 되고, 그게 이 항목의 산출물이다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { applyMarks, marksOf } from '@/lib/semester';
import type { AcademicMark, Semester } from '@/lib/types';

const 학기 = (marks?: AcademicMark[]): Semester =>
  ({ id: 'sem1', name: '2026-1', startDs: '2026-03-02', courses: [], ...(marks ? { marks } : {}) }) as never;
const 눈금 = (ds: string, kind: string, label = '') => ({ ds, kind, label }) as Omit<AcademicMark, 'id'>;

describe('applyMarks — 학사 눈금 인입의 단일 정본', () => {
  it('빈 학기에 눈금을 넣고 들어간 건수를 돌려준다', () => {
    const s = 학기();
    expect(applyMarks(s, [눈금('2026-03-10', '정정마감'), 눈금('2026-04-20', '중간고사')])).toBe(2);
    expect(marksOf(s).map((m) => m.kind)).toEqual(['정정마감', '중간고사']);
  });

  it('id 를 붙인다 — 호출부가 짓지 않는다', () => {
    const s = 학기();
    applyMarks(s, [눈금('2026-03-10', '정정마감')]);
    expect(marksOf(s)[0]!.id, 'id 없이 들어가면 삭제·편집이 대상을 못 고른다').toBeTruthy();
  });

  it('⚠⚠ 같은 (ds, kind) 는 안 넣는다 — 학기 중 재인입(I010)이 정상 사용이다', () => {
    const s = 학기();
    applyMarks(s, [눈금('2026-03-10', '정정마감')]);
    expect(applyMarks(s, [눈금('2026-03-10', '정정마감')]), '재인입이 눈금을 쌓았다').toBe(0);
    expect(marksOf(s)).toHaveLength(1);
  });

  it('⚠ 같은 날 같은 종류가 둘이면 **한 건만** 들어간다 — 현재 동작을 못박는다', () => {
    /* 같은 날 보강 1교시·3교시. 라벨이 달라도 키가 `(ds, kind)` 라 한 건이다.
       바꾸려면 `applyMarks` 한 곳을 고친다 — 종전엔 두 화면을 따로 고쳐야 했고, 그게 이 항목이다. */
    const s = 학기();
    expect(applyMarks(s, [눈금('2026-05-06', '보강', '1교시'), 눈금('2026-05-06', '보강', '3교시')])).toBe(1);
    expect(marksOf(s)).toHaveLength(1);
  });

  it('같은 날 다른 종류는 둘 다 들어간다 — 중복 판정이 과하게 넓지 않다', () => {
    const s = 학기();
    expect(applyMarks(s, [눈금('2026-05-06', '보강'), 눈금('2026-05-06', '휴강')])).toBe(2);
  });

  it('이미 있던 눈금을 보존한다 — 인입이 기존 목록을 갈아엎지 않는다', () => {
    /* ⚠ `kind:'개강'` 은 학기 눈금 어휘(`fix|drop|off|makeup`) 밖이다 — **보존만 보는** 케이스라
       값의 의미는 안 쓴다. 캐스트로 그 의도를 적는다(V068 이 타입 검사를 켜며 드러났다). */
    const s = 학기([{ id: 'old', kind: '개강', ds: '2026-03-02', label: '' }] as never);
    applyMarks(s, [눈금('2026-03-10', '정정마감')]);
    expect(marksOf(s).map((m) => m.id)).toContain('old');
    expect(marksOf(s)).toHaveLength(2);
  });

  it('빈 입력은 아무것도 안 만든다 — `marks` 필드도 안 생긴다', () => {
    const s = 학기();
    expect(applyMarks(s, [])).toBe(0);
    expect(s.marks, '빈 배열을 심으면 «눈금이 있다»와 «없다»가 같은 픽셀이 된다').toBeUndefined();
  });
});
