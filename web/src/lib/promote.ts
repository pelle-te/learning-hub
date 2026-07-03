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
