/* ============================================================
   contentSearch — ⌘K 오프라인 통합 검색의 **순수 랭킹**. React·스토어·IPC 무관.

   ⚠ **왜 lib 인가**(H15 · 2026-08-01 `/감사 근본`). 이 함수는 `shell/actions.ts` 에 살았다 —
   백업·내보내기·가져오기·테마를 담당하는 "데이터·백업" 모듈이다. 검색엔진이 거기 있을 이유는
   **단 한 줄**이었다(`const s = st().state`). 나머지 94줄은 상태를 받아 히트를 내는 순수 함수다.

   비용은 이미 치르고 있었다: `test/contentSearch.test.ts` 가 **순수 함수를 검사하려고** zustand 를
   시드하고 `vi.mock` 으로 IPC 표면을 막았다. 인자 하나를 안 받았다는 이유로 테스트가 앱 전체를
   세우고 있었던 셈이다.

   → 상태를 **인자로 받는다**. `shell/actions.ts` 에는 그 한 줄을 채우는 어댑터만 남는다.
   (⚠ 짝인 `verbsFor` 는 **여기 오지 않는다** — mutate·toast·navigate 를 엮는 진짜 액션이라
     `shell` 이 제자리다. 옮겨야 할 것은 "찾기"지 "하기"가 아니었다.)
============================================================ */
import { keySid } from '@/lib/domainKeys';
import { openBacklog } from '@/lib/methodology';
import { weakSpots } from '@/lib/insights';
import type { AppState } from '@/lib/types';

export type ContentHit = {
  id: string;
  kind: 'subject' | 'chapter' | 'backlog' | 'weak' | 'mistake';
  label: string;
  to: string;
  /* ── 동사가 작용할 대상(N-1) ──────────────────────────────────────────
     ⚠ `id` 문자열(`c-chap:<sid>:<cid>`)을 되파싱하지 않는다. 그 문자열은 cmdk 의 키일 뿐
     계약이 아니고, 접두어 규칙이 한 번 바뀌면 동사가 **조용히 엉뚱한 객체에** 작용한다
     (잘못된 쓰기는 이 저장소가 반복해서 물린 침묵하는 부류다). 필드로 들고 다닌다. */
  /** 소속 과목 id — subject·chapter·weak. weak 는 CBMS 항목의 sid 다. */
  sid?: string;
  /** 과목명(표시·볼트 질의용) — sid 가 지워진 과목을 가리킬 수 있어 이름을 함께 든다. */
  subject?: string;
  /** 챕터명 — chapter·weak. */
  chapter?: string;
  /** 보충 레코드 id — backlog. */
  blId?: string;
};

/** E-6/C-3: ⌘K 오프라인 통합 검색 — Ollama 불필요. 메모리에 이미 있는 학습 항목(과목·챕터)·독서(책)·
   열린 보충(backlog)·반복 약점(weak)을 부분문자열로 찾아 해당 탭으로 이동. 의미검색(semanticPalette)의
   오프라인 보완(임베딩 없이 항상 동작).
   ⚠ **독서(책) 축이 P10 W4 에서 빠졌다** — 그 화면이 `survey/` 로 갔다. 함께 사라진 것이
   `reads` 인자이고, 그래서 이 함수는 이제 `AppState` 하나만 본다(옛 C-1 의 '팔레트가 열릴 때
   1회 스냅샷' 최적화도 필요 없어졌다 — 스냅샷할 것이 없다). */
export function contentSearch(query: string, s: AppState, limit = 8): ContentHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const cap = limit * 3;
  const hits: ContentHit[] = [];
  /* ⚠⚠ **객체가 자기 URL 을 갖는다(W12 · 2026-07-31).** 예전엔 과목·챕터 히트가 전부 `/items`
     로 갔다 — 처음엔 탭 루트라 "고른 것이 어디 있는지 표시가 없었고", AN-17 이 그 위에
     `?focus=<itemId>`(스크롤 + 1.5초 하이라이트)를 얹었다. 그 장치는 **"객체에 착지할 화면이
     없다"의 우회로**였다: 목록에 데려다 놓고 눈으로 찾을 자리를 깜빡여 알려 준 것이다. 그리고
     바로 아래 주석이 스스로 자백했듯 _"챕터 단위 앵커가 없으니 소속 과목 카드까지가 정직한
     최선"_ 이었다 — 챕터는 원리적으로 착지 불가였다.
     이제 둘 다 `/subject/:id` 로 가고, **챕터는 `#ch-<id>` 로 자기 자리에** 선다. */
  const itemAnchor = (id: string) => '/subject/' + encodeURIComponent(id);
  const chapterAnchor = (id: string, cid: string) => `${itemAnchor(id)}#ch-${encodeURIComponent(cid)}`;
  for (const it of s.items) {
    if (it.name.toLowerCase().includes(q))
      hits.push({
        id: 'c-subj:' + it.id,
        kind: 'subject',
        label: it.name,
        to: itemAnchor(it.id),
        sid: it.id,
        subject: it.name,
      });
    for (const c of it.chapters || []) {
      if (hits.length >= cap) break;
      if (c.name.toLowerCase().includes(q))
        hits.push({
          id: 'c-chap:' + it.id + ':' + c.id,
          kind: 'chapter',
          label: `${it.name} · ${c.name}`,
          to: chapterAnchor(it.id, c.id),
          sid: it.id,
          subject: it.name,
          chapter: c.name,
        });
    }
  }
  // C-3: 열린 보충 — topic/과목/근거 텍스트를 이미 메모리에 들고 있으나 ⌘K서 못 찾던 것.
  for (const bl of openBacklog(s)) {
    if (hits.length >= cap) break;
    if ((bl.topic + ' ' + bl.name + ' ' + bl.note).toLowerCase().includes(q))
      hits.push({
        id: 'c-bl:' + bl.id,
        kind: 'backlog',
        label: bl.topic || bl.name || '보충',
        to: '/journal',
        blId: bl.id,
      });
  }
  // C-3: 반복 약점(2회+ 막힌 과목·챕터) → 리뷰 탭.
  for (const w of weakSpots(s)) {
    if (hits.length >= cap) break;
    if ((w.subject + ' ' + w.chapter).toLowerCase().includes(q))
      hits.push({
        id: 'c-weak:' + w.key,
        kind: 'weak',
        label: `${w.subject} · ${w.chapter}`,
        to: '/review',
        // weakSpots 의 key 는 `sid|chapter` 다 — 이미 갖고 있는 값을 필드로 꺼낸다(되파싱 금지).
        sid: keySid(w.key),
        subject: w.subject,
        chapter: w.chapter,
      });
  }
  /* 오답 메모(CBMS `note`) — **가장 밀도 높은 자기 텍스트인데 유일하게 검색 밖이었다.**
     "내가 왜 틀렸는지 적어 둔 그것"에 도달하는 경로가 오답 탭을 눈으로 스크롤하는 것뿐이었다.
     ⚠ 목적지는 `?sid=` 로 **과목까지 좁혀** 보낸다 — 조인 키가 과목 id 라 실패가 원리적으로
       없다(챕터 이름 매칭이 아니다). 챕터 단위 앵커는 없으므로 과목까지가 정직한 최선이다. */
  for (const e of s.cbms || []) {
    if (hits.length >= cap) break;
    if (`${e.note} ${e.name} ${e.chapter}`.toLowerCase().includes(q))
      hits.push({
        id: 'c-cbms:' + e.id,
        kind: 'mistake',
        label: `${e.name || '?'}${e.chapter ? ' · ' + e.chapter : ''} — ${(e.note || '').slice(0, 40)}`,
        to: '/mistakes?sid=' + encodeURIComponent(e.sid),
        sid: e.sid,
        subject: e.name,
        chapter: e.chapter,
      });
  }
  return hits.slice(0, limit);
}
