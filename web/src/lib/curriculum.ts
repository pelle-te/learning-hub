/* ============================================================
   curriculum.ts — 커리큘럼 프론티어(_커리큘럼.json) 소비 — 서버/외부 데이터(프레임워크 무관).
   원천: serve.js GET /api/artifact/curriculum (pipeline 커리큘럼.py 산출 · P7 Bet 2).
   숙달도 지도의 '다음 학습 순서'로 단계③ 적응형 시퀀싱(sequencing 배열)을 렌더한다 —
   선수 게이트·약점큐·ZPD·레버리지를 결합해 커리큘럼.py 가 이미 랭크해 둔 arc 순서.
   TanStack Query가 캐시/로딩/에러를 소유(설계도 §1-B). 서버 JSON이라 필드는 느슨(경계 계약과 정합).
============================================================ */
import { getArtifact } from './api';
import { checkSchemaVersion } from './artifacts';

/** 시퀀싱 항목의 우선 버킷 — SSOT = 커리큘럼.py build_sequencing(remediate>zpd>frontier). */
export type SeqReason = 'remediate' | 'zpd' | 'frontier';

export interface CurriculumSeqItem {
  arc_id: string;
  slug?: string;
  arc?: string;
  status?: string;
  reason: SeqReason;
  score: number;
  /** arc 노트들의 평균 유효숙달(지식엔진 p_eff 롤업). 지식신호 없으면 null(콜드스타트). */
  mastery?: number | null;
  weak_notes?: number;
  zpd_notes?: number;
  note_count?: number;
  /** 이 arc 를 선수로 삼는 downstream arc 수(레버리지 — 먼저 익히면 N개가 풀린다). */
  unlocks?: number;
}
export interface CurriculumOverall {
  planned_arcs?: number;
  atomized_arcs?: number;
  coverage?: number;
  next_up?: number;
  sequencing?: number;
}
export interface Curriculum {
  generated?: string;
  overall?: CurriculumOverall;
  sequencing?: CurriculumSeqItem[];
}

/** 시퀀싱 버킷 표시 메타 — 라벨·아이콘·힌트(색은 소비처가 디자인시스템 변수로). reason SSOT 는 커리큘럼.py. */
export const SEQ_REASON_META: Record<SeqReason, { label: string; icon: string; hint: string }> = {
  remediate: { label: '보강', icon: '✗', hint: '이미 학습했으나 인출 실패(약점·회귀) — 먼저 메운다' },
  zpd: { label: 'ZPD', icon: '⬡', hint: '선수 충족 · 지금 배울 준비됨' },
  frontier: { label: '프론티어', icon: '○', hint: '선수 충족 미완 arc(커버리지 프론티어)' },
};

/** reason 버킷별 개수 — 커리큘럼.py 요약과 동형(remediate/zpd/frontier). 빈/undefined 입력은 0맵. */
export function seqReasonCounts(items: CurriculumSeqItem[] | undefined): Record<SeqReason, number> {
  const c: Record<SeqReason, number> = { remediate: 0, zpd: 0, frontier: 0 };
  for (const it of items || []) {
    if (it.reason in c) c[it.reason] += 1;
  }
  return c;
}

/** 표시용 상위 N — 커리큘럼.py 가 이미 (버킷, score, arc_id) 로 정렬해 두었으므로 순서 보존 슬라이스. */
export function topSequencing(cur: Curriculum | null | undefined, n = 8): CurriculumSeqItem[] {
  return (cur?.sequencing || []).slice(0, n);
}

export async function fetchCurriculumArtifact(): Promise<Curriculum> {
  const j = await getArtifact<Curriculum>('curriculum');
  if (!j || !j.ok || !j.data) throw new Error('커리큘럼 산출물(curriculum)을 찾지 못했어요.');
  checkSchemaVersion('curriculum', j.data); // P7 Bet 1: 버전 드리프트 경고
  return j.data;
}
