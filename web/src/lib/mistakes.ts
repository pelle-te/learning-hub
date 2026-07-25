/* ============================================================
   mistakes.ts — 오답 아카이브(ID-9) 순수 집계.

   ## 무엇을 세는가 — **CBMS 기록 하나만** 센다

   백지 실패(`blankResults`)를 따로 합치지 않는다. `setBlankResult` 가 **막힘 + (메모 또는 챕터)**
   를 이미 CBMS 'C' 항목으로 자동 연결하기 때문이다 — 둘을 합치면 같은 사건이 두 번 세어진다.
   메모도 챕터도 없는 막힘은 CBMS 가 안 생기는데, 그건 **아카이브할 내용이 없는 기록**이다
   (무엇을 다시 볼지 가리키는 정보가 0). 그래서 여기서 세지 않는 것이 손실이 아니라 정직이다.

   ## 왜 '주간 리뷰'가 아니라 별도 화면인가

   리뷰는 *이번 주 처방*이고 여기는 *전 기간 아카이브*다 — 시제가 다르다. 한 화면에 섞으면
   주간 프레이밍이 흐려진다. 반대로 나브에 독립 탭으로 세우면 두 화면이 서로를 먹는다.
   그래서 같은 호스트(학습 기록)의 **이웃 세그먼트**다(사용자 결정 2026-07-25).

   ⚠ 순수·결정론: 벽시계를 안 본다(정렬 키는 기록의 ds). React·DOM 무관.
============================================================ */
import { CBMS_CODES } from './methodology';
import type { AppState, CbmsCode } from './types';

/** 오답 한 묶음 = (과목, 챕터) 한 칸. 챕터 미기재는 `chapter: ''` 로 모인다. */
export interface MistakeRow {
  /** `${sid}|${chapter}` — weakSpots 와 같은 키 규약(두 화면이 같은 것을 같은 이름으로 부른다). */
  key: string;
  sid: string;
  subject: string;
  chapter: string;
  /** 이 칸의 오답 기록 수. */
  count: number;
  /** '확신했는데 틀림' 횟수 — 가장 위험한 부류(안다고 믿어 복습을 건너뛴다). */
  confident: number;
  /** 등장한 CBMS 유형(빈도 내림차순 · 동률은 CBMS_CODES 순). */
  codes: CbmsCode[];
  /** 최빈 유형 = 이 칸의 '근본원인' 대용. 기록이 있으면 항상 있다. */
  topCode: CbmsCode;
  /** 가장 최근 기록일(YYYY-MM-DD) — 정렬·'마지막으로 틀린 날'. */
  lastDs: string;
  /** 최근 메모(최신순 · 빈 메모 제외). 화면이 잘라 쓴다. */
  notes: { ds: string; text: string }[];
}

export interface MistakeFilter {
  /** 이 과목만(빈 값=전체). */
  sid?: string;
  /** 이 유형만(빈 값=전체). */
  code?: CbmsCode;
}

/**
 * 전 기간 오답을 (과목, 챕터)로 묶어 아카이브 행을 만든다.
 *
 * 정렬은 **횟수 내림차순 → 최근 순 → 이름** 이다. 횟수를 먼저 두는 이유: 이 화면의 질문은
 * "무엇이 반복해서 나를 막는가"이지 "무엇이 최근인가"가 아니다(최근 순은 학습 기록이 이미 준다).
 */
export function mistakeArchive(state: AppState, filter?: MistakeFilter): MistakeRow[] {
  const byKey = new Map<string, MistakeRow & { _codeN: Record<string, number> }>();
  for (const e of state.cbms || []) {
    if (filter?.sid && e.sid !== filter.sid) continue;
    if (filter?.code && e.code !== filter.code) continue;
    const chapter = (e.chapter || '').trim();
    const key = (e.sid || '') + '|' + chapter;
    let row = byKey.get(key);
    if (!row) {
      row = {
        key,
        sid: e.sid || '',
        subject: e.name || '?',
        chapter,
        count: 0,
        confident: 0,
        codes: [],
        topCode: e.code,
        lastDs: '',
        notes: [],
        _codeN: {},
      };
      byKey.set(key, row);
    }
    row.count += 1;
    if (e.conf) row.confident += 1;
    row._codeN[e.code] = (row._codeN[e.code] || 0) + 1;
    // ⚠ 과목명은 **최신 기록 것**을 쓴다 — 과목 이름을 바꾸면 옛 기록엔 옛 이름이 박혀 있어,
    //   먼저 만난 것을 그대로 쓰면 아카이브만 옛 이름으로 남는다. lastDs 갱신과 한 자리에 둔다
    //   (따로 두면 "이미 갱신한 lastDs 와 비교"라는 조용한 버그가 난다).
    if (e.ds >= row.lastDs) {
      row.lastDs = e.ds;
      if (e.name) row.subject = e.name;
    }
    const text = (e.note || '').trim();
    if (text) row.notes.push({ ds: e.ds, text });
  }

  const rows: MistakeRow[] = [];
  for (const r of byKey.values()) {
    // 빈도 내림차순 · 동률은 CBMS_CODES 순(결정론 — Object.keys 순서에 기대지 않는다).
    const codes = CBMS_CODES.filter((c) => r._codeN[c]).sort(
      (a, b) => (r._codeN[b] || 0) - (r._codeN[a] || 0) || CBMS_CODES.indexOf(a) - CBMS_CODES.indexOf(b),
    );
    r.notes.sort((a, b) => (a.ds < b.ds ? 1 : a.ds > b.ds ? -1 : 0));
    const { _codeN, ...row } = r;
    void _codeN;
    rows.push({ ...row, codes, topCode: codes[0] ?? r.topCode });
  }
  return rows.sort(
    (a, b) => b.count - a.count || (a.lastDs < b.lastDs ? 1 : a.lastDs > b.lastDs ? -1 : 0) || (a.key < b.key ? -1 : 1),
  );
}

/** 아카이브 한눈 집계 — 화면 상단 리드아웃(칸·기록·과신). 행이 없으면 전부 0. */
export function mistakeTotals(rows: MistakeRow[]): { spots: number; records: number; confident: number } {
  let records = 0;
  let confident = 0;
  for (const r of rows) {
    records += r.count;
    confident += r.confident;
  }
  return { spots: rows.length, records, confident };
}
