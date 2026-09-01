/* ============================================================
   knowledgeElements.test.ts — N-4 지식요소(KC) 축.
   잠그는 것: ① **번짐**이 정렬 1순위 ② `crossChapter` 가 폐기 조건이다 ③ 자동 정규화 안 함.
============================================================ */
import { describe, expect, it } from 'vitest';
import type { AppState } from '@/lib/schema';
import {
  chapterKc,
  crossChapter,
  kcOf,
  kcStats,
  knownKc,
  normKc,
  tagChapter,
  untagChapter,
} from '@/lib/knowledgeElements';

const TODAY = '2026-08-07';
const cb = (ds: string, chapter: string, kc: string[], sid = 'c') =>
  ({ id: ds + chapter + kc.join(), ds, sid, name: '회로이론', chapter, code: 'C', note: '', kc }) as never;
const st = (rows: unknown[]): AppState => ({ cbms: rows }) as unknown as AppState;

describe('kcOf — 태그 정리', () => {
  it('공백만 자르고 중복·빈 값을 없앤다', () => {
    expect(kcOf({ kc: [' 라플라스 ', '라플라스', '', '  ', '페이저'] })).toEqual(['라플라스', '페이저']);
  });
  it('⚠ 대소문자·띄어쓰기는 **안 건드린다** — 동의어 통합은 사람이 볼 문제다', () => {
    expect(normKc('  Laplace 변환 ')).toBe('Laplace 변환');
    expect(kcOf({ kc: ['laplace', 'Laplace'] })).toEqual(['laplace', 'Laplace']);
  });
  it('태그가 없으면 빈 배열', () => {
    expect(kcOf({})).toEqual([]);
  });
});

describe('kcStats — 번짐이 정렬 1순위다', () => {
  it('⭐ 한 챕터에서 5번보다 세 챕터에서 3번이 위다 — 후자만 이 축이 볼 수 있다', () => {
    const s = st([
      cb('2026-07-01', '3장', ['라플라스']),
      cb('2026-07-02', '5장', ['라플라스']),
      cb('2026-07-03', '7장', ['라플라스']),
      ...Array.from({ length: 5 }, (_, i) => cb(`2026-07-1${i}`, '2장', ['부호규약'])),
    ]);
    const rows = kcStats(s, TODAY);
    expect(rows[0]!.kc).toBe('라플라스'); // 챕터 3개
    expect(rows[0]!.chapters).toHaveLength(3);
    expect(rows[1]!.kc).toBe('부호규약'); // 횟수는 더 많지만 챕터 1개
    expect(rows[1]!.hits).toBe(5);
  });

  it('한 기록에 태그가 여럿이면 각각 센다', () => {
    const rows = kcStats(st([cb('2026-07-01', '3장', ['라플라스', '페이저'])]), TODAY);
    expect(rows.map((r) => r.kc).sort()).toEqual(['라플라스', '페이저']);
  });

  it('미래 기록은 안 센다(시드·시계 어긋남 방어)', () => {
    expect(kcStats(st([cb('2099-01-01', '3장', ['라플라스'])]), TODAY)).toEqual([]);
  });

  it('태그 없는 오답은 이 축에 안 들어온다(챕터 축이 이미 본다)', () => {
    expect(kcStats(st([cb('2026-07-01', '3장', [])]), TODAY)).toEqual([]);
  });
});

describe('crossChapter — 이 축의 폐기 조건이다', () => {
  it('⭐ 2챕터 이상 걸친 요소만 — 이게 이 축의 존재 이유다', () => {
    const s = st([
      cb('2026-07-01', '3장', ['라플라스']),
      cb('2026-07-02', '5장', ['라플라스']),
      cb('2026-07-03', '3장', ['부호규약']),
      cb('2026-07-04', '3장', ['부호규약']),
    ]);
    expect(crossChapter(s, TODAY).map((r) => r.kc)).toEqual(['라플라스']);
  });

  it('⚠⚠ 안 걸치면 빈 배열 — **요소 = 챕터라면 이 축은 중복이고 지워야 한다**', () => {
    const s = st([cb('2026-07-01', '3장', ['부호규약']), cb('2026-07-02', '3장', ['부호규약'])]);
    expect(crossChapter(s, TODAY)).toEqual([]);
  });
});

describe('knownKc — 이미 쓴 말을 다시 제안한다', () => {
  it('최근 쓴 순 — 새 분류 체계 대신 이것이 동의어 난립을 막는다', () => {
    const s = st([cb('2026-07-01', '3장', ['오래된것']), cb('2026-08-01', '5장', ['최근것'])]);
    expect(knownKc(s, TODAY)).toEqual(['최근것', '오래된것']);
  });
});

describe('tagChapter / untagChapter — 칸 단위 입구', () => {
  const rows = () => [cb('2026-07-01', '3장', []), cb('2026-07-02', '3장', ['기존']), cb('2026-07-03', '5장', [])];

  it('그 칸의 오답 **전부**에 붙인다 — 기록마다 누르면 실험이 안 일어난다', () => {
    const s = st(rows());
    expect(tagChapter(s, 'c', '3장', '라플라스')).toBe(2);
    expect(chapterKc(s, 'c', '3장')).toEqual(['기존', '라플라스']);
    expect(chapterKc(s, 'c', '5장')).toEqual([]); // 다른 칸은 안 건드린다
  });

  it('⚠ 덧붙이기지 덮어쓰기가 아니다 — 한 오답이 두 도구에 걸칠 수 있다', () => {
    const s = st(rows());
    tagChapter(s, 'c', '3장', '라플라스');
    expect(s.cbms![1]!.kc).toEqual(['기존', '라플라스']);
  });

  it('같은 태그를 두 번 달아도 안 늘어난다', () => {
    const s = st(rows());
    tagChapter(s, 'c', '3장', '라플라스');
    expect(tagChapter(s, 'c', '3장', ' 라플라스 ')).toBe(0);
  });

  it('빈 태그는 무동작', () => {
    const s = st(rows());
    expect(tagChapter(s, 'c', '3장', '   ')).toBe(0);
  });

  it('떼는 경로가 있다 — 잘못 단 것을 되돌리는 유일한 길', () => {
    const s = st(rows());
    tagChapter(s, 'c', '3장', '라플라스');
    expect(untagChapter(s, 'c', '3장', '라플라스')).toBe(2);
    expect(chapterKc(s, 'c', '3장')).toEqual(['기존']);
  });
});
