/* ============================================================
   domainKeys.ts — 도메인 **합성키**에 이름을 준다(H30 · 2026-07-30 `/감사 근본`).

   이 앱에는 문자열로 합친 키가 둘 있고, **이름 없이 38곳에 흩어져** 있었다:

     · `${sid}|${type}`    — 완료 기록(`completions[ds][key]`). **저장된다.**
     · `${sid}|${chapter}` — 약점·오답 칸(`weakSpots`·`MistakeRow.key`). **저장된다.**

   이름이 없으면 두 가지가 일어난다. ① 만드는 규칙이 손으로 복제돼 언젠가 한쪽만 바뀐다
   ② **되파싱이 각자 방식으로** 이뤄진다 — 실제로 `split('|')[0]` · `const [sid] = split('|')` ·
   `const [sid, type] = split('|')` 세 형태가 공존했다.

   ## ⚠⚠ 가장 중요한 것: `chapter` 는 **되파싱할 수 없다**

   `chapter` 는 사용자가 자유롭게 치는 문자열이라 `|` 를 포함할 수 있다. 그래서
   `key.split('|')[1]` 은 **조용히 잘린 챕터명**을 준다. 지금 그런 자리가 없는 것은 우연이고
   (소비처가 `chapter` 를 키가 아니라 옆 필드로 들고 다닌다) 아무 데도 안 적혀 있었다.
   → 챕터를 되찾는 함수를 **일부러 만들지 않는다.** 대신 `keySid()` 로 과목만 꺼낸다 —
   그건 `sid` 가 생성 id 라 `|` 를 못 갖기 때문에 안전하다. 필요해지면 키가 아니라 **값을**
   함께 나르는 것이 답이다(현재 `MistakeRow` 가 그렇게 한다).

   ## ⚠ 형식은 바꾸지 않는다

   두 키 모두 **디스크에 있다**(`completions`·`weakSpots`). 구분자를 "더 안전한 것"으로 바꾸면
   기존 사용자의 완료 기록이 통째로 고아가 된다. 이 파일이 하는 일은 형식을 **고정**하고
   그 규칙이 한 곳에만 있게 하는 것이다 — `cloud/conflicts.snapKey`(JSON 튜플)와 달리 여기는
   마이그레이션 비용이 있는 자리라 판단이 다르다.
============================================================ */

const SEP = '|';

/** 완료 기록 키 — `completions[ds][이 값]`. ⚠ 형식 고정(디스크에 있다). */
export function completionKey(sid: string, type: string): string {
  return sid + SEP + type;
}

/** 약점·오답 칸 키 — `weakSpots` · `MistakeRow.key`. ⚠ 형식 고정(디스크에 있다). */
export function weakKey(sid: string, chapter: string): string {
  return sid + SEP + chapter;
}

/**
 * 합성키에서 **과목 id 만** 꺼낸다(두 종류 모두 첫 칸이 `sid` 다).
 *
 * ⚠ 뒤 칸은 여기서 돌려주지 않는다 — 위 머리주석의 "되파싱할 수 없다" 절이 그 이유다.
 */
export function keySid(key: string): string {
  const i = key.indexOf(SEP);
  return i < 0 ? key : key.slice(0, i);
}

/**
 * 완료 키를 되파싱한다(`sid` + `type`).
 *
 * ⚠ 이건 **완료 키에만** 안전하다: `type` 은 우리가 정한 열거값(`new`·`rev`·`anki`…)이라
 * `|` 를 못 갖는다. 같은 함수를 `weakKey` 에 쓰면 챕터명이 조용히 잘린다.
 */
export function parseCompletionKey(key: string): { sid: string; type: string } {
  const i = key.indexOf(SEP);
  return i < 0 ? { sid: key, type: '' } : { sid: key.slice(0, i), type: key.slice(i + 1) };
}
