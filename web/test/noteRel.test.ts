/* ============================================================
   noteRel.test.ts — **챕터 → 노트 파일 해석**(I006 · 2026-08-22 발상 축).

   이 앱은 «이 챕터를 공부하라»고 말할 수 있지만 그 일을 **시작시킬 수는 없었다** — 노트를 여는
   경로가 0이었다(실측: capabilities 12종에 opener 없음 · 소스 grep 0). 첫 조각은 «이 챕터가
   어느 파일 하나인가»이고, 그 판정이 이 함수다.

   ⚠ 여기서 잠그는 것:
   ① **유일할 때만** 연다 — 여럿이면 «대상을 연다»가 아니라 «아무거나 연다»다
   ② 챕터 이름을 만드는 규칙이 `subjectsFromIndex` 와 **같다**(`folder.split('/').slice(1)`).
      갈리면 화면이 아는 챕터와 여기서 찾는 챕터가 다른 것이 되고, 그건 조용하다
   ③ `file` 이 없는 노트(옛 인덱스)는 후보가 아니다 — 열 수 없는 것을 열 수 있다고 말하지 않는다
============================================================ */
import { describe, expect, it } from 'vitest';
import { noteRelFor, subjectsFromIndex, type IndexNote } from '@/lib/vault';

const N = (folder: string, file: string | null, subject = '회로이론'): IndexNote => ({ subject, folder, file });

describe('noteRelFor — 유일할 때만 연다', () => {
  it('⭐ 그 챕터의 노트가 하나면 볼트 상대경로를 준다', () => {
    const notes = [N('회로이론/01 기초', '옴의법칙.md'), N('회로이론/02 회로해석', '노드해석.md')];
    expect(noteRelFor(notes, '회로이론', '01 기초')).toBe('회로이론/01 기초/옴의법칙.md');
  });

  it('⚠⚠ 여럿이면 null — 어느 것을 여는지 모르는 채로 파일이 열리면 안 된다', () => {
    const notes = [N('회로이론/01 기초', 'a.md'), N('회로이론/01 기초', 'b.md')];
    expect(noteRelFor(notes, '회로이론', '01 기초')).toBeNull();
  });

  it('없으면 null(빈 목록·다른 과목·다른 챕터)', () => {
    const notes = [N('회로이론/01 기초', 'a.md')];
    expect(noteRelFor([], '회로이론', '01 기초')).toBeNull();
    expect(noteRelFor(notes, '전자기학', '01 기초')).toBeNull();
    expect(noteRelFor(notes, '회로이론', '02 없음')).toBeNull();
  });

  it('⚠ `file` 이 없는 옛 인덱스 노트는 후보가 아니다 — 못 여는 것을 열 수 있다 하지 않는다', () => {
    expect(noteRelFor([N('회로이론/01 기초', null)], '회로이론', '01 기초')).toBeNull();
  });

  it('⚠⚠ 챕터 이름 규칙이 `subjectsFromIndex` 와 같다 — 갈리면 조용히 어긋난다', () => {
    const notes = [N('회로이론/02 회로해석/심화', 'x.md')];
    const chapters = subjectsFromIndex({ notes })
      .find((s) => s.name === '회로이론')
      ?.chapters.map((c) => c.name);
    expect(chapters).toEqual(['02 회로해석/심화']); // 다중 깊이도 그대로 이어붙인다
    expect(noteRelFor(notes, '회로이론', '02 회로해석/심화')).toBe('회로이론/02 회로해석/심화/x.md');
  });

  it('과목 루트 노트도 같은 이름(`(과목 루트)`)으로 풀린다', () => {
    const notes = [N('회로이론', 'MOC.md')];
    expect(noteRelFor(notes, '회로이론', '(과목 루트)')).toBe('회로이론/MOC.md');
  });
});
