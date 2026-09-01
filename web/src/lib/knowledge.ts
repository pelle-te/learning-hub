/* ============================================================
   knowledge.ts — 지식상태(_지식상태.json) 소비 — 서버/외부 데이터(프레임워크 무관).
   원본 둘: ① 산출물 `knowledge`(지식엔진.py 산출 · 셸이 읽는다) ② 볼트 폴더의
   _meta/cache/_지식상태.json(FS Access). 둘 다 같은 Knowledge 모양을 돌려준다.
   TanStack Query가 캐시/로딩/에러를 소유(설계도 §1-B). 서버 JSON이라 필드는 느슨(전부 옵셔널).
============================================================ */

export interface KnowledgeConcept {
  title?: string;
  basename?: string;
  p_eff: number;
  state: string;
  weak?: boolean;
  frontier?: boolean;
  root_cause?: string;
}
export interface KnowledgeSubject {
  subject: string;
  /** 과목 평균 유효숙달. `null` = 이 과목에 관측 0건(measured=0) — 전부 사전분포라 평균이 사실이 아니다(부모 ②#54 사전분포 검역). */
  mastery: number | null;
  /** 실제 관측(evidence>0)이 있는 노트 수 — `mastery`가 측정인지 prior인지 가르는 분모. */
  measured?: number;
  n?: number;
  weak?: number;
  unknown?: number;
  concepts?: KnowledgeConcept[];
}
export interface KnowledgeFrontier {
  title?: string;
  basename?: string;
  subject?: string;
  prereq_in?: number;
}
export interface KnowledgeGap {
  title?: string;
  basename?: string;
  subject?: string;
  p_eff: number;
  root_cause?: string;
}
export interface KnowledgeCalibration {
  n_errors?: number;
  confident_wrong?: number;
  overconfidence_rate?: number;
  blank_total?: number;
  blank_pass?: number;
  blank_pass_rate?: number;
}
export interface Knowledge {
  generated?: string;
  n_notes?: number;
  /** 전체 평균 유효숙달. `null` = 사전분포 검역 중(증거덮개율 < 임계) — 숫자를 짓지 않는다. `evidence_coverage` 를 함께 읽어라. */
  overall?: number | null;
  /** 부모 ②#54 검역 상태 — measured/total/pct/threshold_pct/quarantined/note. */
  evidence_coverage?: {
    measured?: number;
    total?: number;
    pct?: number;
    threshold_pct?: number;
    quarantined?: boolean;
    note?: string;
  };
  states?: { mastered?: number; learning?: number; weak?: number; unknown?: number };
  subjects?: KnowledgeSubject[];
  frontier?: KnowledgeFrontier[];
  gaps?: KnowledgeGap[];
  calibration?: KnowledgeCalibration;
}

/** 약점의 근본원인(선수개념) 롤업 — 같은 root_cause가 몇 개 약점의 뿌리인지 내림차순(self·무근원 제외).
   프런티어의 prereq_in('이걸 배우면 N개가 풀린다')의 약점판 미러 — 가장 많은 약점의 뿌리를 먼저 메우면
   상류가 함께 풀린다(지식엔진 설계 B). 이미 페치된 k.gaps만 사용(신규 IO 0). */
export function rootCauseRollup(k: Knowledge | undefined, cap = 5): { cause: string; count: number }[] {
  const m = new Map<string, number>();
  (k?.gaps || []).forEach((g) => {
    const rc = g.root_cause;
    if (!rc || rc === 'self') return;
    m.set(rc, (m.get(rc) || 0) + 1);
  });
  return [...m.entries()]
    .map(([cause, count]) => ({ cause, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, cap);
}

/* ⛔ `frontierNext` 는 지웠다(V081 · 2026-09-01) — **프로덕션 호출부가 0** 이었다(테스트만).
   knip 이 못 본 이유가 요점이다: `knip.jsonc` 가 `test/**` 를 **entry** 로 두므로 테스트에서만
   쓰이는 export 도 «쓰인다»로 세고, 불변식 ⑭는 **모듈** 단위라 소비자 하나 있는 모듈 안의
   죽은 export 는 그물 밖이다. 그리고 그 함수가 읽던 `frontier` 배열은 **생산자째 삭제**됐다
   (2026-08-29) — 즉 되살릴 입력도 없다. 복구: `git show 1813662:web/src/lib/knowledge.ts`. */

/* ⛔⛔ 2026-08-29 — **공급자가 은퇴했다.** 지식상태 산출물을 만들던 `지식엔진.py` 와 그 경계
   스키마가 부모에서 삭제됐다(pipeline 목적 정정: 「전공 교재 → 원자형 노트」만 진다 ·
   숙달도 추정은 범위 밖). 그래서 아래 둘은 **네트워크·디스크를 두드리지 않고 즉시 진다** —
   없는 것을 찾아 헤매는 것보다 이유를 말하고 빨리 지는 편이 정직하다.

   ⚠ **이 모듈이 통째로 죽은 것은 아니다 — 다만 산 것은 하나뿐이다.** `Review` 가
   `rootCauseRollup`(근본원인 롤업)을 부르고, `store/queries.ts` 가 `fetchKnowledgeArtifact` 와
   타입을 쓴다. 그 패널은 데이터가 없으면 조용히 생략하도록 짜여 있다(콜드 축퇴).
   ⛔⛔ **여기 «`Review`·`TodaySignature`·`Subject`·`confidence` 넷»이라 적혀 있었다 — 넷 중 셋이
   거짓이었다**(V080 · 2026-09-01 실측): `TodaySignature`·`Subject` 는 이 모듈을 **참조한 적이
   없고** `lib/confidence.ts` 는 **파일 자체가 없다**. 그 문장의 사본이 `Ledger.tsx` 와 hub 원장에도
   있어 **셋이었고**, 셋 다 «지우면 세 화면이 죽는다»로 **정리를 얼리고 있었다** — 규약 축이 R3 로
   이름 붙인 형태다(**낡은 경고는 낡은 안내보다 나쁘다**: 낡은 안내는 잘못 하게 만들고, 낡은
   경고는 **옳은 일을 못 하게** 만든다).
   ⚠ 세는 법을 여기 적지 마라 — `rg "from '@/lib/knowledge'" src/` 가 답한다.
   **그 패널이 영영 콜드로 남는 것을 어떻게 할지는** hub 원장의 별도 항목이다.
   복구(부모 저장소): 태그 `은퇴/학습층-2026-08-29`. */
const 은퇴사유 = '지식상태 산출물은 은퇴했습니다 — 생산자가 삭제됐고 다시 채워지지 않습니다.';

/** @deprecated 공급자 은퇴(2026-08-29) — 항상 throw. 소비처는 isError 를 콜드로 다룬다. */
export async function fetchKnowledgeArtifact(): Promise<Knowledge> {
  throw new Error(은퇴사유);
}

// ⛔ `loadKnowledgeStateFromVault` 도 함께 사라졌다(소비처가 「숙달도 지도」뿐이었다).
