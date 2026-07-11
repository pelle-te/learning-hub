/* ============================================================
   promote.ts — 소비(읽을거리·증시) → 학습으로 '승격' 매핑 — 순수·무의존.
   읽다가 "이건 제대로 공부하자" 싶은 글을 보충 백로그(나중에 학습할 큐)로 보낸다.
   백로그는 홈 스트립('열린 보충')과 학습 기록 피드에 이미 노출돼, 소비→학습 루프를 닫는다.
   (전용 '학습 항목/과목'으로 만들면 스케줄러가 오염되므로 백로그가 올바른 그릇 — 뉴스는 학기 과목이 아님.)
============================================================ */
import type { Article } from './reads';
import type { NewsItem } from './markets';

export interface BacklogSeed {
  name: string; // 백로그의 과목 라벨(출처 종류)
  topic: string; // 무엇을 학습할지(제목)
  note: string; // 근거(출처·링크·발췌)
}

/** 승격 성공 토스트 문안 — reads·markets 두 탭이 하드코딩 복제하던 것 SSOT화(SR-10). */
export const PROMOTE_TOAST = '보충 백로그로 보냈어요 — 기록·오늘 탭에서 회수';

/** 공백 정리 + 길이 제한. */
function excerpt(s: string, max = 180): string {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

/** 읽을거리 지문 → 백로그 씨앗. */
export function backlogFromArticle(a: Article): BacklogSeed {
  const ex = excerpt(a.text);
  return {
    name: '읽을거리',
    topic: (a.title || '(제목 없음)').trim(),
    note: `[읽을거리·${a.source}] ${a.url}${ex ? '\n' + ex : ''}`,
  };
}

/** 증시 뉴스/칼럼 → 백로그 씨앗. */
export function backlogFromNews(n: NewsItem): BacklogSeed {
  const ex = excerpt(n.summary);
  return {
    name: '증시 동향',
    topic: (n.title || '(제목 없음)').trim(),
    note: `[증시·${n.source}] ${n.url}${ex ? '\n' + ex : ''}`,
  };
}

/* ── 진단→학습 승격(I-1): 소비뿐 아니라 '내 약점'도 같은 백로그 그릇으로. 진단(반복약점·근본원인)을
   원클릭으로 보충 큐에 넣어 식별→행동을 잇는다. WeakSpot 타입에 결합하지 않으려 구조만 받는다. ── */

/** 반복 약점(과목·챕터·막힘 횟수) → 백로그 씨앗. */
export function backlogFromWeakSpot(w: { subject: string; chapter: string; count: number }): BacklogSeed {
  return {
    name: '반복 약점',
    topic: `${w.subject} — ${w.chapter}`,
    note: `이 지점에서 ${w.count}번 막힘 — 교재로 되돌아가 다시 인출`,
  };
}

/** 약점의 근본원인(선수개념) → 백로그 씨앗. 이 뿌리를 메우면 상류 N개가 함께 풀린다. */
export function backlogFromRootCause(c: { cause: string; count: number }): BacklogSeed {
  return {
    name: '근본원인',
    topic: c.cause,
    note: `${c.count}개 약점의 뿌리(선수개념) — 먼저 메우면 상류가 함께 풀림`,
  };
}
