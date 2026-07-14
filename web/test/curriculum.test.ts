/* ============================================================
   curriculum.test.ts — 커리큘럼 시퀀싱 소비 순수 헬퍼 회귀(Vitest).
   커리큘럼.py 단계③(build_sequencing)이 랭크한 sequencing 배열을 숙달도 지도가 소비할 때
   쓰는 표시 헬퍼(버킷 카운트·상위 슬라이스·버킷 메타)를 못박는다. IO(fetch)는 대상 아님(경계는
   artifactsGen.test 가 zod 로 커버) — 여기선 순수 변환만.
============================================================ */
import { describe, expect, it } from 'vitest';
import {
  seqReasonCounts,
  topSequencing,
  SEQ_REASON_META,
  DEPTH_META,
  ROLE_META,
  depthMeta,
  roleMeta,
  engineHealthTiers,
  isHealthCold,
  isRelevanceMonotone,
  type SeqReason,
  type Curriculum,
  type CurriculumSeqItem,
  type EngineHealth,
} from '@/lib/curriculum';

const item = (arc_id: string, reason: SeqReason, score: number): CurriculumSeqItem => ({ arc_id, reason, score });

const health = (
  status: string,
  evidenced: number,
  hi: number | null,
  mid: number | null,
  lo: number | null,
): EngineHealth => ({
  status,
  evidenced_notes: evidenced,
  by_relevance: {
    high: { n: hi == null ? 0 : 3, mean_mastery: hi },
    mid: { n: mid == null ? 0 : 3, mean_mastery: mid },
    low: { n: lo == null ? 0 : 3, mean_mastery: lo },
  },
});

describe('curriculum — seqReasonCounts', () => {
  it('버킷별 개수 집계(remediate/zpd/frontier)', () => {
    const items = [
      item('a-1', 'remediate', 5),
      item('a-2', 'zpd', 2),
      item('a-3', 'zpd', 1),
      item('a-4', 'frontier', 1),
    ];
    expect(seqReasonCounts(items)).toEqual({ remediate: 1, zpd: 2, frontier: 1 });
  });
  it('빈/undefined 입력은 0맵(콜드스타트·부재 graceful)', () => {
    expect(seqReasonCounts(undefined)).toEqual({ remediate: 0, zpd: 0, frontier: 0 });
    expect(seqReasonCounts([])).toEqual({ remediate: 0, zpd: 0, frontier: 0 });
  });
});

describe('curriculum — topSequencing', () => {
  const cur: Curriculum = {
    sequencing: [item('a-1', 'remediate', 5), item('a-2', 'zpd', 2), item('a-3', 'frontier', 1)],
  };
  it('상위 N 슬라이스 — 커리큘럼.py 정렬 순서 보존', () => {
    expect(topSequencing(cur, 2).map((i) => i.arc_id)).toEqual(['a-1', 'a-2']);
  });
  it('데이터 없음/빈 sequencing → 빈 배열(패널 조용히 생략)', () => {
    expect(topSequencing(null)).toEqual([]);
    expect(topSequencing(undefined)).toEqual([]);
    expect(topSequencing({})).toEqual([]);
  });
});

describe('curriculum — SEQ_REASON_META', () => {
  it('세 버킷 전부 라벨·아이콘·힌트 보유', () => {
    for (const r of ['remediate', 'zpd', 'frontier'] as const) {
      expect(SEQ_REASON_META[r].label).toBeTruthy();
      expect(SEQ_REASON_META[r].icon).toBeTruthy();
      expect(SEQ_REASON_META[r].hint).toBeTruthy();
    }
  });
});

// ── P9 Wave③ 운전석 역할/깊이 배지 헬퍼 ──
describe('curriculum — depthMeta/roleMeta (Wave③ 배지)', () => {
  it('유효 깊이/역할 → 라벨·힌트 반환(파생 기본 중심·숙련 포함)', () => {
    expect(depthMeta('숙련')).toBe(DEPTH_META.숙련);
    expect(depthMeta('인지')?.label).toBe('인지');
    expect(roleMeta('중심')).toBe(ROLE_META.중심);
    expect(roleMeta('소양')?.label).toBe('소양');
    // 다섯 역할·세 깊이 전부 힌트 보유(비-vacuous)
    for (const r of ['중심', '보조', '맥락', '소양', '지평'] as const) expect(ROLE_META[r].hint).toBeTruthy();
    for (const d of ['숙련', '활용', '인지'] as const) expect(DEPTH_META[d].hint).toBeTruthy();
  });
  it('콜드(null)·미상 값 → undefined(배지 생략 = 노이즈 방지)', () => {
    expect(depthMeta(null)).toBeUndefined();
    expect(depthMeta(undefined)).toBeUndefined();
    expect(depthMeta('없는깊이')).toBeUndefined();
    expect(roleMeta(null)).toBeUndefined();
    expect(roleMeta('없는역할')).toBeUndefined();
  });
});

// ── P9 Wave⑤ 엔진 건강 지표(D11) 헬퍼 ──
describe('curriculum — engineHealthTiers', () => {
  it('by_relevance 를 상→하 순서 tier 행으로(라벨·힌트·버킷)', () => {
    const t = engineHealthTiers(health('ok', 9, 0.8, 0.6, 0.4));
    expect(t?.map((x) => x.label)).toEqual(['상', '중', '하']);
    expect(t?.map((x) => x.bucket.mean_mastery)).toEqual([0.8, 0.6, 0.4]);
    for (const row of t!) expect(row.hint).toBeTruthy(); // 비-vacuous
  });
  it('by_relevance 없으면 null(패널 접음)', () => {
    expect(engineHealthTiers(null)).toBeNull();
    expect(engineHealthTiers(undefined)).toBeNull();
  });
});

describe('curriculum — isHealthCold', () => {
  it('status:cold 또는 증거 노트 0 → 콜드(판정 유예)', () => {
    expect(isHealthCold(health('cold', 0, null, null, null))).toBe(true);
    expect(isHealthCold(health('ok', 0, 0.8, 0.6, 0.4))).toBe(true); // 증거 0
    expect(isHealthCold(null)).toBe(true);
    expect(isHealthCold(undefined)).toBe(true);
  });
  it('status!=cold & 증거>0 → 콜드 아님(라이브)', () => {
    expect(isHealthCold(health('ok', 9, 0.8, 0.6, 0.4))).toBe(false);
  });
});

describe('curriculum — isRelevanceMonotone', () => {
  it('상≥중≥하 평균숙달 → true(연관성↑→숙달↑ 성립)', () => {
    expect(isRelevanceMonotone(health('ok', 9, 0.8, 0.6, 0.4))).toBe(true);
    expect(isRelevanceMonotone(health('ok', 9, 0.6, 0.6, 0.6))).toBe(true); // 동률 허용(≥)
  });
  it('하위 분위가 더 높으면 false(단조 아님)', () => {
    expect(isRelevanceMonotone(health('ok', 9, 0.4, 0.6, 0.8))).toBe(false);
  });
  it('콜드(비교값 2개 미만) → null(판정 불가 · 정직 유예)', () => {
    expect(isRelevanceMonotone(health('cold', 0, null, null, null))).toBeNull();
    expect(isRelevanceMonotone(health('ok', 3, 0.7, null, null))).toBeNull(); // 값 1개
    expect(isRelevanceMonotone(null)).toBeNull();
  });
});
