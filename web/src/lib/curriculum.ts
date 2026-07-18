/* ============================================================
   curriculum.ts — 커리큘럼 프론티어(_커리큘럼.json) 소비 — 서버/외부 데이터(프레임워크 무관).
   원천: serve.js GET /api/artifact/curriculum (pipeline 커리큘럼.py 산출 · P7 Bet 2).
   숙달도 지도의 '다음 학습 순서'로 단계③ 적응형 시퀀싱(sequencing 배열)을 렌더한다 —
   선수 게이트·약점큐·ZPD·레버리지를 결합해 커리큘럼.py 가 이미 랭크해 둔 arc 순서.
   TanStack Query가 캐시/로딩/에러를 소유(설계도 §1-B). 서버 JSON이라 필드는 느슨(경계 계약과 정합).
============================================================ */
import { getArtifact } from './api';
import { parseArtifact } from './artifacts';

/** 시퀀싱 항목의 우선 버킷 — SSOT = 커리큘럼.py build_sequencing(remediate>zpd>frontier). */
export type SeqReason = 'remediate' | 'zpd' | 'frontier';

/** 삶-연관 목표 깊이(#7 복습 강도) — SSOT = note_schema.VALID_깊이(숙련/활용/인지). */
export type Depth = '숙련' | '활용' | '인지';
/** 삶-연관 주역할(내 길에서의 쓸모) — SSOT = note_schema.VALID_역할. 운전석 배지 축. */
export type Role = '중심' | '보조' | '맥락' | '소양' | '지평';

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
  // ── P9 Phase 4·6(단계④·Wave③) 삶-연관성 배분 필드(v4 additive · 콜드=0/null) ──
  /** 삶-연관성 0~1(결정론·설명가능 · 콜드=0). goals: 링크·개념그래프 홉거리로 계산(연관성.py). */
  relevance?: number;
  /** 목표 깊이(숙련/활용/인지 · 연관성 없으면 null) — 최댓값 노트 유효깊이 롤업. */
  target_depth?: Depth | string | null;
  /** 연관성 × gap(목표깊이−숙달) 배분 그래디언트(예산 순위 근거). */
  priority?: number;
  /** 이 arc 를 당기는 목표 id(설명가능 · null=콜드/flat). */
  goal?: string | null;
  /** 삶-연관 역할(중심/보조/맥락/소양/지평 · Wave③ 운전석 배지 · null=콜드) — 최댓값 노트 주역할. */
  역할?: Role | string | null;
  /** 추정 소요(시간 · 목표깊이 기본 + 약점 보강 부담). */
  est_effort?: number;
  /** 주당 시간 예산(#2) 내 배분 여부 — false = 이번 주기 미룸. */
  allocated?: boolean;
  /** 미룸 사유(budget|quota · allocated=true 면 null) — "A 깊이 파려면 B 미룸" 트레이드오프. */
  defer_reason?: string | null;
}
export interface CurriculumOverall {
  planned_arcs?: number;
  atomized_arcs?: number;
  coverage?: number;
  next_up?: number;
  sequencing?: number;
  // ── 단계④ 배분 요약(v4) ──
  /** 연관성 앵커(노트 goals: 링크) 존재 여부. false=콜드(핵심 노트에 목표 링크 달면 가동). */
  relevance_active?: boolean;
  /** 주당 학습 시간 예산(#2 · 이 상한 안에서 배분). */
  time_budget_hours?: number;
  /** 예산 내 배분된 arc 수. */
  allocated_arcs?: number;
  /** 예산·quota 초과로 미룬 arc 수. */
  deferred_arcs?: number;
  /** 배분 소요 합(시간). */
  allocated_hours?: number;
}
/** 연관성 3분위(상/중/하) 회고 버킷 — n(노트 수)·평균 유효숙달(신호 없으면 null=콜드). */
export interface EngineHealthBucket {
  n: number;
  mean_mastery: number | null;
}
/** 엔진 건강 지표(D11 · 준-필수 R4) — "연관성↑ 노트가 실제 더 숙달됐나"의 최소 회고.
    SSOT = 커리큘럼.py engine_health. status:cold = 라이브 인출 신호 0(P8 콜드) → 유효성 *판정 유예*
    (스캐폴드만 켜고 데이터 도착 즉시 측정 · Wave F 패턴 · 과설계 금지). */
export interface EngineHealth {
  status: 'cold' | 'ok' | string;
  /** 인출 증거가 있는 노트 수(0 = 콜드). */
  evidenced_notes: number;
  by_relevance: {
    high: EngineHealthBucket;
    mid: EngineHealthBucket;
    low: EngineHealthBucket;
  };
}
export interface Curriculum {
  generated?: string;
  overall?: CurriculumOverall;
  sequencing?: CurriculumSeqItem[];
  /** 엔진 건강 회고(D11 · v4 additive · 콜드=status:cold) — 숙달도 지도가 소비. */
  engine_health?: EngineHealth;
}

/** 시퀀싱 버킷 표시 메타 — 라벨·아이콘·힌트(색은 소비처가 디자인시스템 변수로). reason SSOT 는 커리큘럼.py. */
export const SEQ_REASON_META: Record<SeqReason, { label: string; icon: string; hint: string }> = {
  remediate: { label: '보강', icon: '✗', hint: '이미 학습했으나 인출 실패(약점·회귀) — 먼저 메운다' },
  zpd: { label: 'ZPD', icon: '⬡', hint: '선수 충족 · 지금 배울 준비됨' },
  frontier: { label: '프론티어', icon: '○', hint: '선수 충족 미완 arc(커버리지 프론티어)' },
};

/** 목표 깊이 배지 메타 — 라벨·힌트(#7 복습 강도 · 색은 소비처 디자인시스템). SSOT=note_schema.DEPTH_REVIEW. */
export const DEPTH_META: Record<Depth, { label: string; hint: string }> = {
  숙련: { label: '숙련', hint: '씹어 삼킴 — 능동 인출(자유회상·문제풀이)+확장간격+인터리빙' },
  활용: { label: '활용', hint: '쓸 줄 앎 — 단서 인출+응용문제' },
  인지: { label: '인지', hint: '존재 앎 — 간격 재노출(재인 수준)+핵심 1링크' },
};

/** 삶-연관 역할 배지 메타 — 라벨·힌트(내 길에서의 쓸모 · D2 역할분기). SSOT=note_schema.VALID_역할. */
export const ROLE_META: Record<Role, { label: string; hint: string }> = {
  중심: { label: '중심', hint: '내 길의 중심 — 목표 그래디언트로 배분(교재 source 필수)' },
  보조: { label: '보조', hint: '중심을 받치는 보조 — 목표 근접 배분(교재 source 필수)' },
  맥락: { label: '맥락', hint: '중심에 닿는 맥락(산업·동향) — 목표 근접 배분(시사)' },
  소양: { label: '소양', hint: '중심 무관하나 삶에 널리 유용 — flat 베이스라인+quota' },
  지평: { label: '지평', hint: '넓히는 지평 — 가벼운 인지 스텁(flat+quota)' },
};

/** 깊이 문자열 → 배지 메타(미상/콜드 null 은 undefined = 배지 생략). */
export function depthMeta(d: string | null | undefined) {
  return d && d in DEPTH_META ? DEPTH_META[d as Depth] : undefined;
}
/** 역할 문자열 → 배지 메타(미상/콜드 null 은 undefined = 배지 생략). */
export function roleMeta(r: string | null | undefined) {
  return r && r in ROLE_META ? ROLE_META[r as Role] : undefined;
}

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

/** 연관성 분위 표시 메타 — 순서 상→하 고정(회고 렌더용 · 색은 소비처 디자인시스템). */
export const HEALTH_TIER_META = [
  { key: 'high' as const, label: '상', hint: '삶-연관성 상위 1/3 노트' },
  { key: 'mid' as const, label: '중', hint: '삶-연관성 중위 1/3 노트' },
  { key: 'low' as const, label: '하', hint: '삶-연관성 하위 1/3 노트' },
];
export type HealthTier = { label: string; hint: string; bucket: EngineHealthBucket };

/** engine_health 를 상→하 순서 tier 행으로 — 없으면 null(패널 접음). */
export function engineHealthTiers(h: EngineHealth | null | undefined): HealthTier[] | null {
  if (!h?.by_relevance) return null;
  return HEALTH_TIER_META.map((t) => ({ label: t.label, hint: t.hint, bucket: h.by_relevance[t.key] }));
}

/** 콜드 판정 — status==='cold' 또는 증거 노트 0(둘 중 하나면 아직 유효성 미판정 · 정직 배너). */
export function isHealthCold(h: EngineHealth | null | undefined): boolean {
  return !h || h.status === 'cold' || !h.evidenced_notes;
}

/** 연관성↑→숙달↑ 단조성 — 라이브 판정용(상≥중≥하 평균숙달, null 버킷은 건너뜀).
    콜드(null 다수)면 판단 불가라 null 반환(소비처가 '판정 유예'로 정직 표시). */
export function isRelevanceMonotone(h: EngineHealth | null | undefined): boolean | null {
  const t = engineHealthTiers(h);
  if (!t) return null;
  const ms = t.map((x) => x.bucket.mean_mastery).filter((v): v is number => typeof v === 'number');
  if (ms.length < 2) return null; // 비교할 값 2개 미만 = 판정 불가(콜드).
  for (let i = 1; i < ms.length; i++) {
    const prev = ms[i - 1];
    const cur = ms[i];
    if (prev != null && cur != null && prev < cur) return false;
  }
  return true;
}

export async function fetchCurriculumArtifact(): Promise<Curriculum> {
  const j = await getArtifact<Curriculum>('curriculum');
  if (!j || !j.ok || !j.data) throw new Error('커리큘럼 산출물(curriculum)을 찾지 못했어요.');
  parseArtifact('curriculum', j.data); // 버전 + 모양 드리프트 경고(비차단)
  return j.data;
}
