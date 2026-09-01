/* ============================================================
   semester.test.ts — **T-1 학기 계약**의 읽기 SSOT(`lib/semester.ts`) 회귀.

   이 파일이 지키는 계약은 둘이다:
   1. **옛 저장은 한 글자도 다르게 동작하지 않는다** — `deadline`/`deadlineThru` 만 있는 과목이
      `examsOf`/`examScopes` 를 통과했을 때 옛 계산과 같은 구간이 나온다. (엔진 쪽 동작 보존은
      `scheduler.test.ts` 52케이스가 잠그고, 여기서는 그 전제인 **정규화**를 잠근다.)
   2. **새 동작은 시험이 2개일 때만 나타난다** — 구간이 갈리고, 국면이 계산되고, 두 우주가 이어진다.
============================================================ */
import { describe, expect, it } from 'vitest';
import {
  EXAM_LABEL,
  MAX_EXAMS,
  activeSemester,
  courseOfItem,
  examMarks,
  examScopes,
  examsOf,
  hasExams,
  isSoftSubject,
  itemOfCourse,
  linkableItems,
  scopeIndexFor,
  semesterPhase,
  unlinkedCourses,
} from '@/lib/semester';
import type { Item, Semester } from '@/lib/types';
import type { AppState } from '@/lib/schema';

const ch = (id: string, hours = 1) => ({ id, name: id, hours, done: false });
const item = (over: Partial<Item> = {}): Item =>
  ({ id: 'sub1', name: '전자기학', mode: 'weekly', weeklyHours: 5, chapters: [], ...over }) as Item;

describe('examsOf — 옛 두 필드를 시험 1개로 승격', () => {
  it('exams 도 deadline 도 없으면 빈 배열', () => {
    expect(examsOf(item())).toEqual([]);
    expect(hasExams(item())).toBe(false);
  });

  it('deadline 만 있으면 kind=final 시험 하나로 승격된다 — 옛 모델의 마감은 "과목의 끝"이었다', () => {
    const got = examsOf(item({ deadline: '2026-10-20' }));
    expect(got).toHaveLength(1);
    expect(got[0]!.kind).toBe('final');
    expect(got[0]!.date).toBe('2026-10-20');
    expect(got[0]!.thru).toBeUndefined();
  });

  it('deadlineThru 는 승격된 시험의 thru 가 된다', () => {
    const got = examsOf(item({ deadline: '2026-10-20', deadlineThru: 'c3' }));
    expect(got[0]!.thru).toBe('c3');
  });

  it('exams 가 있으면 옛 필드를 무시한다 — 두 원천을 동시에 읽지 않는다', () => {
    const got = examsOf(
      item({
        deadline: '2026-10-20',
        deadlineThru: 'c3',
        exams: [{ id: 'e1', kind: 'mid', date: '2026-09-01', thru: 'c2' }],
      }),
    );
    expect(got).toHaveLength(1);
    expect(got[0]!.id).toBe('e1');
    expect(got[0]!.date).toBe('2026-09-01');
  });

  it('날짜순으로 정렬한다(입력 순서 무관)', () => {
    const got = examsOf(
      item({
        exams: [
          { id: 'fin', kind: 'final', date: '2026-12-10' },
          { id: 'mid', kind: 'mid', date: '2026-10-15', thru: 'c3' },
        ],
      }),
    );
    expect(got.map((e) => e.id)).toEqual(['mid', 'fin']);
  });

  it(`MAX_EXAMS(${MAX_EXAMS}) 를 넘는 입력은 잘린다 — 금도금 미끄럼틀의 방벽`, () => {
    const got = examsOf(
      item({
        exams: [
          { id: 'a', kind: 'mid', date: '2026-09-01' },
          { id: 'b', kind: 'final', date: '2026-10-01' },
          { id: 'c', kind: 'final', date: '2026-11-01' },
        ],
      }),
    );
    expect(got).toHaveLength(MAX_EXAMS);
    expect(got.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('표시 이름은 두 종류뿐이다', () => {
    expect(EXAM_LABEL).toEqual({ mid: '중간', final: '기말' });
  });
});

describe('examScopes — 챕터 배열 위의 연속 구간', () => {
  const chapters = ['c1', 'c2', 'c3', 'c4', 'c5'].map((id) => ch(id));

  it('시험이 없으면 구간도 없다', () => {
    expect(examScopes(item({ chapters }))).toEqual([]);
  });

  it('시험 1개 · thru 없음 → 0..끝 (옛 "안 끝난 챕터 전부"와 동일)', () => {
    const [s] = examScopes(item({ chapters, deadline: '2026-10-20' }));
    expect(s).toMatchObject({ fromIdx: 0, thruIdx: 4 });
  });

  it('시험 1개 · thru=c3 → 0..2 (옛 deadlineThru 계산과 동일)', () => {
    const [s] = examScopes(item({ chapters, deadline: '2026-10-20', deadlineThru: 'c3' }));
    expect(s).toMatchObject({ fromIdx: 0, thruIdx: 2 });
  });

  it('thru 가 지워진 챕터를 가리키면 전 범위로 폴백한다 — 마감 판정이 통째로 멈추지 않게', () => {
    const [s] = examScopes(item({ chapters, deadline: '2026-10-20', deadlineThru: 'GONE' }));
    expect(s).toMatchObject({ fromIdx: 0, thruIdx: 4 });
  });

  it('⭐ 시험 2개 → 구간이 갈린다: 중간 0..2 · 기말 3..4', () => {
    const scopes = examScopes(
      item({
        chapters,
        exams: [
          { id: 'mid', kind: 'mid', date: '2026-10-15', thru: 'c3' },
          { id: 'fin', kind: 'final', date: '2026-12-10' },
        ],
      }),
    );
    expect(scopes).toHaveLength(2);
    expect(scopes[0]).toMatchObject({ fromIdx: 0, thruIdx: 2 });
    expect(scopes[1]).toMatchObject({ fromIdx: 3, thruIdx: 4 });
  });

  it('구간은 겹치지 않고 이어진다 — 두 번째가 첫 번째 thru 다음에서 시작', () => {
    const scopes = examScopes(
      item({
        chapters,
        exams: [
          { id: 'mid', kind: 'mid', date: '2026-10-15', thru: 'c1' },
          { id: 'fin', kind: 'final', date: '2026-12-10', thru: 'c4' },
        ],
      }),
    );
    expect(scopes[0]!.thruIdx + 1).toBe(scopes[1]!.fromIdx);
  });

  it('scopeIndexFor 가 챕터를 구간에 귀속시킨다(범위 밖은 -1)', () => {
    const scopes = examScopes(
      item({
        chapters,
        exams: [
          { id: 'mid', kind: 'mid', date: '2026-10-15', thru: 'c2' },
          { id: 'fin', kind: 'final', date: '2026-12-10', thru: 'c4' },
        ],
      }),
    );
    expect(scopeIndexFor(scopes, 0)).toBe(0);
    expect(scopeIndexFor(scopes, 1)).toBe(0);
    expect(scopeIndexFor(scopes, 2)).toBe(1);
    expect(scopeIndexFor(scopes, 3)).toBe(1);
    expect(scopeIndexFor(scopes, 4)).toBe(-1); // 기말 thru=c4(idx 3) 뒤 → 어느 시험도 안 덮는다
  });
});

/* ── 학기 국면 ─────────────────────────────────────────────────────────── */

const sem = (over: Partial<Semester>): Semester => ({ id: 's1', name: '2026-2학기', courses: [], ...over }) as Semester;
const st = (semesters: Semester[], today = '2026-08-02'): AppState =>
  ({ degree: { semesters }, _today: today }) as unknown as AppState;

describe('semesterPhase — 지금이 학기 중인가 · 방학인가', () => {
  it('학기가 없으면 off', () => {
    expect(semesterPhase(st([])).kind).toBe('off');
    expect(activeSemester(st([]))).toBeNull();
  });

  it('날짜 없는 학기는 판정에 참여하지 않는다 — 그게 T-1 이전의 상태였다', () => {
    expect(semesterPhase(st([sem({})])).kind).toBe('off');
  });

  it('개강 전이면 pre + D-day', () => {
    const p = semesterPhase(st([sem({ startDs: '2026-09-01', endDs: '2026-12-20' })]), '2026-08-02');
    expect(p.kind).toBe('pre');
    expect(p.daysToStart).toBe(30);
    expect(p.week).toBeNull();
    expect(p.semester?.id).toBe('s1');
  });

  it('학기 중이면 in + 주차(1-based) + 종강까지', () => {
    const p = semesterPhase(st([sem({ startDs: '2026-09-01', endDs: '2026-12-20' })]), '2026-09-15');
    expect(p.kind).toBe('in');
    expect(p.dayIndex).toBe(14);
    expect(p.week).toBe(3); // 0~6일=1주차 · 7~13=2주차 · 14~20=3주차
    expect(p.daysToEnd).toBe(96);
  });

  it('학기 첫날은 1주차', () => {
    expect(semesterPhase(st([sem({ startDs: '2026-09-01' })]), '2026-09-01').week).toBe(1);
  });

  it('종강 후 다음 학기가 없으면 off — pre 와 구분된다(처방이 정반대다)', () => {
    const p = semesterPhase(st([sem({ startDs: '2026-03-02', endDs: '2026-06-20' })]), '2026-08-02');
    expect(p.kind).toBe('off');
    expect(p.semester).toBeNull();
  });

  it('학기가 여럿이면 지난 학기를 건너뛰고 다가오는 학기를 고른다', () => {
    const p = semesterPhase(
      st([
        sem({ id: 'past', startDs: '2026-03-02', endDs: '2026-06-20' }),
        sem({ id: 'next', startDs: '2026-09-01', endDs: '2026-12-20' }),
      ]),
      '2026-08-02',
    );
    expect(p.kind).toBe('pre');
    expect(p.semester?.id).toBe('next');
  });

  it('endDs 가 없는 학기는 시작 후 계속 in 이다', () => {
    expect(semesterPhase(st([sem({ startDs: '2026-01-01' })]), '2026-08-02').kind).toBe('in');
  });
});

/* ── 두 우주 잇기 ──────────────────────────────────────────────────────── */

describe('Course ↔ Item — 단방향 다리', () => {
  const linked = st([
    sem({
      startDs: '2026-09-01',
      courses: [
        { id: 'c-emag', name: '전자기학', credits: 3, category: '전공필수', status: '수강', itemId: 'sub1' },
        { id: 'c-solo', name: '교양', credits: 2, category: '교양', status: '수강' },
      ],
    }),
  ]);

  it('itemId 로 회계 쪽 과목과 그 학기를 찾는다', () => {
    const got = courseOfItem(linked, 'sub1');
    expect(got?.course.id).toBe('c-emag');
    expect(got?.course.credits).toBe(3);
    expect(got?.semester.startDs).toBe('2026-09-01');
  });

  it('링크가 없으면 null — 두 우주는 기본적으로 끊겨 있다', () => {
    expect(courseOfItem(linked, 'nope')).toBeNull();
  });

  it('반대 방향은 items 에서 찾는다', () => {
    const state = { items: [item()] } as unknown as AppState;
    expect(itemOfCourse(state, { itemId: 'sub1' })?.name).toBe('전자기학');
    expect(itemOfCourse(state, { itemId: undefined })).toBeNull();
  });

  it('가리키는 Item 이 지워졌으면 null — 끊긴 링크를 유령으로 두지 않는다', () => {
    expect(itemOfCourse({ items: [] } as unknown as AppState, { itemId: 'sub1' })).toBeNull();
  });

  it('unlinkedCourses 는 링크 없음과 끊긴 링크를 **둘 다** 잡는다', () => {
    const semester = linked.degree!.semesters[0]!;
    const withItem = unlinkedCourses({ items: [item()] } as unknown as AppState, semester);
    expect(withItem.map((c) => c.id)).toEqual(['c-solo']);

    const noItem = unlinkedCourses({ items: [] } as unknown as AppState, semester);
    expect(noItem.map((c) => c.id)).toEqual(['c-emag', 'c-solo']);
  });
});

/* ============================================================
   H-1(2026-08-06 감사) — **달력의 마감 표식은 `exams` 에서 나와야 한다.**

   `examsOf` 는 스스로 _"시험을 읽는 유일한 입구"_ 라 선언했는데, 실제로는 세 곳이 원시
   `it.deadline === ds` 로 옆문을 쓰고 있었다(월 캘린더 2 · 주 그리드 1). 그리고 시험을 편집하면
   `SubjectDefinition` 이 `delete it.deadline` 을 한다 → **시험을 넣는 순간 달력에서 그 과목
   마감이 조용히 사라졌다.** 새 모델을 켜는 것이 옛 표시를 끄는 형태이고 오류는 어디에도 안 난다.
============================================================ */
describe('examMarks — 달력·주 그리드의 마감 표식', () => {
  it('옛 저장(deadline 만)도 그 날짜에 표식이 선다 — 무마이그레이션 계약', () => {
    const marks = examMarks([item({ deadline: '2026-10-20' })], '2026-10-20');
    expect(marks).toHaveLength(1);
    expect(marks[0]!.name).toBe('전자기학');
    expect(marks[0]!.exam.kind).toBe('final');
  });

  it('⚠⚠ `exams` 로 옮겨 `deadline` 이 지워져도 표식이 남는다 — 이게 사라지던 결함이다', () => {
    const it2 = item({
      deadline: undefined,
      exams: [
        { id: 'e1', kind: 'mid', date: '2026-10-20' },
        { id: 'e2', kind: 'final', date: '2026-12-15' },
      ],
    });
    expect(examMarks([it2], '2026-10-20').map((m) => m.exam.kind)).toEqual(['mid']);
    expect(examMarks([it2], '2026-12-15').map((m) => m.exam.kind)).toEqual(['final']);
  });

  it('시험이 둘이면 **표식도 둘**이다 — 옛 필드는 한 날짜만 표현할 수 있었다', () => {
    const it2 = item({
      exams: [
        { id: 'e1', kind: 'mid', date: '2026-10-20' },
        { id: 'e2', kind: 'final', date: '2026-12-15' },
      ],
    });
    const 날짜들 = ['2026-10-20', '2026-12-15'].map((ds) => examMarks([it2], ds).length);
    expect(날짜들).toEqual([1, 1]);
  });

  it('이름 없는 과목(빈 슬롯)은 표식을 안 만든다 — 달력에 빈 칩이 서면 안 된다', () => {
    expect(examMarks([item({ name: '', deadline: '2026-10-20' })], '2026-10-20')).toEqual([]);
  });

  it('그 날짜에 시험이 없으면 빈 배열', () => {
    expect(examMarks([item({ deadline: '2026-10-20' })], '2026-10-19')).toEqual([]);
  });
});

/* ============================================================
   P10 D6 — **Subject 일반화**(소양 과목). 계약 셋:
   1. 기본값이 전공이다 — `kind` 없는 옛 저장은 **한 글자도 다르게 동작하지 않는다**.
   2. 소양은 시험 세계에 없다 — 입구(`examsOf`) 하나가 그걸 집행하므로 달력·엔진·화면이 함께 조용해진다.
   3. **저장값은 안 지운다** — 구분을 되돌리면 넣어 뒀던 시험이 그대로 살아난다.
============================================================ */
describe('isSoftSubject / linkableItems — 학기 회계의 경계', () => {
  const soft = (over: Partial<Item> = {}) => item({ id: 'lang', name: '스페인어', kind: 'soft', ...over });

  it('`kind` 가 없으면 전공이다 — 옛 저장 무마이그레이션', () => {
    expect(isSoftSubject(item())).toBe(false);
    expect(isSoftSubject(item({ kind: 'major' }))).toBe(false);
    expect(isSoftSubject(soft())).toBe(true);
  });

  it('소양 과목의 시험은 **읽기 입구에서** 빈다 — 화면과 엔진이 갈리지 않는다', () => {
    const withExam = soft({ exams: [{ id: 'e1', kind: 'mid', date: '2026-10-20' }] });
    expect(examsOf(withExam)).toEqual([]);
    expect(hasExams(withExam)).toBe(false);
    expect(examScopes({ ...withExam, chapters: [ch('c1'), ch('c2')] })).toEqual([]);
    expect(examMarks([withExam], '2026-10-20')).toEqual([]);
  });

  it('옛 `deadline` 만 있는 소양 과목도 마찬가지다 — 승격 경로도 함께 막힌다', () => {
    expect(examsOf(soft({ deadline: '2026-10-20' }))).toEqual([]);
  });

  it('⚠ 저장값은 남는다 — 전공으로 되돌리면 그 시험이 되살아난다(파괴하지 않는다)', () => {
    const stored = { ...soft({ exams: [{ id: 'e1', kind: 'mid' as const, date: '2026-10-20' }] }) };
    expect(examsOf(stored)).toEqual([]);
    expect(examsOf({ ...stored, kind: undefined }).map((e) => e.id)).toEqual(['e1']);
  });

  it('linkableItems — 소양은 학기 과목 연결 후보에서 빠진다(학점으로 안 센다)', () => {
    expect(linkableItems([item(), soft()]).map((i) => i.id)).toEqual(['sub1']);
  });
});
