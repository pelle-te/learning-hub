/* ============================================================
   ledgerSeed.ts — 볼트 임포트가 만드는 **가짜 백로그**를 원장으로 교정한다(W4 · 2026-07-31).

   ## 문제
   `chaptersFromVault` 는 모든 챕터를 `done:false` 로 만든다. 실 볼트를 임포트하면 49챕터
   /추정 271시간이 전부 "새로 배울 것"이 된다. 그런데 챕터 원장은 **같은 49챕터**에 대해
   `verified 34 · carded 30` 을 이미 안다. 그래서 첫 인상이 "271시간 짜리 빚"이고, 동시에
   `maintenanceReviews`(끝낸 챕터의 유지 사다리)는 `ch.done` 앵커가 하나도 없어 **영원히 빈
   배열**을 반환한다 — 앱이 아는 것과 원장이 아는 것이 정반대로 어긋나 있었다.

   ## 왜 자동으로 찍지 않는가 — 이 모듈의 본체
   ⚠⚠ `carded` 는 **"카드를 만들었다"이지 "익혔다"가 아니다**(원장이 `reviewed` 를 별도 5단계로
   둔 이유가 그것이다). 자동으로 찍으면 안 익힌 챕터 30개가 본 사다리에서 빠져 유지 큐로
   강등되고, 사용자는 "복습이 적네"로만 느낀다 — 조용한 오류다. 그래서 이 모듈은 **후보를
   계산만 하고**, 찍는 것은 호출부가 사용자에게 한 번 물어서 한다. 49번의 수동 체크가 1클릭이
   되되 **판단은 사람이 한다**가 이 안의 전부다.
============================================================ */
import { matchSubjectIndex } from './subjectMatch';
import type { Ledger } from './ledger';
import type { Chapter } from './types';

/** 원장이 "카드까지 갔다"고 말하는 챕터 1건. */
export interface CardedChapter {
  /** 앱 챕터명(= 볼트 폴더명 = 원장 `arc`). */
  name: string;
  /** 그 챕터에서 관측된 마지막 `reviewed:`(없으면 ''). 완료 앵커로 쓴다. */
  reviewedRecent: string;
}

/**
 * 임포트한 챕터 중 원장 마일스톤 `carded` 를 밟은 것(순수).
 *
 * 과목 이름만 `subjectMatch` 규칙에 맡기고 챕터는 **정확 일치**를 요구한다 — 앱 챕터는
 * `chaptersFromVault` 가 볼트 폴더명 그대로 만든 것이고 원장 `arc` 도 같은 문자열이라
 * 정확 일치가 정상이다(퍼지 매칭은 "01 미분"과 "01 미분의 응용"을 섞는다).
 */
export function cardedChapters(
  led: Ledger | undefined | null,
  subject: string,
  chapters: readonly Chapter[],
): CardedChapter[] {
  if (!led) return [];
  const names = Object.keys(led.subjects || {});
  const si = matchSubjectIndex(subject, names);
  if (si < 0) return [];
  const byArc = new Map((led.subjects[names[si]!]?.chapters || []).map((c) => [c.arc, c]));
  const out: CardedChapter[] = [];
  for (const ch of chapters) {
    const lc = byArc.get(ch.name);
    if (!lc || !lc.milestones?.carded) continue;
    out.push({ name: ch.name, reviewedRecent: lc.reviewed_recent || '' });
  }
  return out;
}

/**
 * 후보를 `done` 으로 찍는다(제자리 변형 — immer draft 의 `chapters` 배열을 받는다).
 *
 * ⚠ `doneDs` 는 **오늘이 아니라 원장이 아는 마지막 관측일**이다. 오늘로 찍으면 유지 사다리가
 * 34일 동안 전부 `fresh` 가 되어, "끝낸 것으로 표시했더니 복습이 사라졌다"가 된다 — 교정하려던
 * 것과 같은 형태의 거짓말을 반대 방향으로 만드는 셈이다. 관측일을 모르면 `doneDs` 를 비워 두고
 * (`maintenanceReviews` 의 '앵커 모름' = `due`) 한 번 인출하면 스스로 교정된다.
 */
export function applyCardedDone(chapters: Chapter[], carded: readonly CardedChapter[]): number {
  const byName = new Map(carded.map((c) => [c.name, c]));
  let n = 0;
  for (const ch of chapters) {
    const c = byName.get(ch.name);
    if (!c || ch.done) continue;
    ch.done = true;
    if (c.reviewedRecent) ch.doneDs = c.reviewedRecent;
    n++;
  }
  return n;
}

/** 확인 문구 — **"카드까지 갔다"이지 "익혔다"가 아님**을 말해야 한다(위 머리주석). */
export function cardedPrompt(subject: string, n: number, total: number): string {
  return (
    `"${subject}"의 챕터 ${total}개 중 ${n}개는 볼트 원장이 **카드 발급까지 끝났다**고 말해요.\n\n` +
    `끝낸 것으로 표시하면 새로 배울 목록에서 빠지고 유지(복습) 사다리로 넘어갑니다.\n` +
    `'카드를 만들었다'는 뜻이지 '익혔다'는 뜻이 아니에요 — 아직 인출 연습이 필요하면 '아니요'를 고르세요.`
  );
}
