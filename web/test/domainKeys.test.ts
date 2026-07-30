/* ============================================================
   domainKeys.test.ts — 도메인 합성키(H30 · 2026-07-30 `/감사 근본`).

   ⚠ 여기서 잠그는 것 셋:
   ① **형식이 안 바뀐다** — 두 키 모두 디스크에 있다(`completions`·`weakSpots`). 구분자를
      "더 안전한 것"으로 바꾸면 기존 사용자의 완료 기록이 통째로 고아가 된다.
   ② **`type` 은 안전하게 되파싱된다**(우리가 정한 열거값이라 `|` 를 못 갖는다).
   ③ **`chapter` 는 되파싱할 수 없다** — 사용자가 치는 자유 문자열이라 `|` 를 포함할 수 있고,
      `split('|')[1]` 은 **조용히 잘린 챕터명**을 준다. 지금 그런 자리가 없는 것은 우연이었고
      아무 데도 안 적혀 있었다. 그래서 되찾는 함수를 **일부러 안 만들었고**, 이 케이스가
      "만들면 왜 틀리는지"를 박제한다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { completionKey, keySid, parseCompletionKey, weakKey } from '@/lib/domainKeys';

describe('형식 고정 — 디스크에 있는 키다', () => {
  it('완료 키는 `sid|type` 그대로다', () => {
    expect(completionKey('em', 'rev')).toBe('em|rev');
  });
  it('약점 키는 `sid|chapter` 그대로다', () => {
    expect(weakKey('em', '3 변위전류')).toBe('em|3 변위전류');
  });
});

describe('되파싱', () => {
  it('과목 id 는 두 종류 모두에서 안전하게 나온다', () => {
    expect(keySid('em|rev')).toBe('em');
    expect(keySid('em|3 변위전류')).toBe('em');
  });

  it('완료 키는 sid·type 으로 갈린다', () => {
    expect(parseCompletionKey('em|rev')).toEqual({ sid: 'em', type: 'rev' });
  });

  it('⚠ 챕터명에 `|` 가 있어도 **과목은** 정확하다 — 첫 구분자만 본다', () => {
    expect(keySid('em|a|b')).toBe('em');
  });

  it('⚠⚠ 챕터를 `split` 으로 되찾으면 **조용히 잘린다** — 그래서 그 함수를 안 만들었다', () => {
    const key = weakKey('em', '3장 | 변위전류');
    expect(key.split('|')[1], '이 값이 챕터라고 믿으면 화면이 잘린 이름을 보여 준다').toBe('3장 ');
    // 옳은 길: 키에서 되찾지 말고 값을 함께 나른다(`MistakeRow` 가 그렇게 한다).
    expect(keySid(key)).toBe('em');
  });

  it('구분자가 없으면 통째로 sid 다(방어적 — 옛 데이터·빈 값)', () => {
    expect(keySid('em')).toBe('em');
    expect(parseCompletionKey('em')).toEqual({ sid: 'em', type: '' });
  });
});
