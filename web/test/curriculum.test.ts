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
  type SeqReason,
  type Curriculum,
  type CurriculumSeqItem,
} from '@/lib/curriculum';

const item = (arc_id: string, reason: SeqReason, score: number): CurriculumSeqItem => ({ arc_id, reason, score });

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
