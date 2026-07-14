/* ============================================================
   discovery.test.ts — 발견 triage 큐 소비 순수 헬퍼 회귀(Vitest · P9 Phase 6).
   승격.py 발견큐(무결성=승격.py validate_queue 소유)를 hub inbox 가 집계·정렬하는 순수
   변환을 못박는다. 쓰기(승인/기각)는 serve.js /api/run 경로라 대상 아님(Wave④).
============================================================ */
import { describe, expect, it } from 'vitest';
import {
  discoveryStatusCounts,
  pendingEntries,
  DISCOVERY_KIND_META,
  type DiscoveryArtifact,
  type DiscoveryEntry,
  type DiscoveryKind,
  type DiscoveryStatus,
} from '@/lib/discovery';

const e = (id: string, kind: DiscoveryKind, score: number, status: DiscoveryStatus): DiscoveryEntry => ({
  id,
  kind,
  source: 'test',
  score,
  status,
  detail: {},
});

const artifact = (entries: DiscoveryEntry[]): DiscoveryArtifact => ({ _schemaVersion: 1, entries });

describe('discovery — discoveryStatusCounts', () => {
  it('status 버킷별 개수(pending/promoted/dismissed)', () => {
    const a = artifact([
      e('uncovered::a', 'uncovered', 3, 'pending'),
      e('bridge::b', 'bridge', 2, 'pending'),
      e('uncovered::c', 'uncovered', 1, 'promoted'),
      e('uncovered::d', 'uncovered', 1, 'dismissed'),
    ]);
    expect(discoveryStatusCounts(a)).toEqual({ pending: 2, promoted: 1, dismissed: 1 });
  });
  it('빈/undefined → 0맵(콜드 graceful)', () => {
    expect(discoveryStatusCounts(undefined)).toEqual({ pending: 0, promoted: 0, dismissed: 0 });
    expect(discoveryStatusCounts(artifact([]))).toEqual({ pending: 0, promoted: 0, dismissed: 0 });
  });
});

describe('discovery — pendingEntries', () => {
  it('pending 만 score 내림차순(동률=입력순 안정정렬)', () => {
    const a = artifact([
      e('uncovered::a', 'uncovered', 1, 'pending'),
      e('bridge::b', 'bridge', 5, 'pending'),
      e('uncovered::c', 'uncovered', 5, 'pending'),
      e('uncovered::d', 'uncovered', 9, 'promoted'), // 제외
    ]);
    expect(pendingEntries(a).map((x) => x.id)).toEqual(['bridge::b', 'uncovered::c', 'uncovered::a']);
  });
  it('빈 입력 → 빈 배열', () => {
    expect(pendingEntries(null)).toEqual([]);
  });
});

describe('discovery — DISCOVERY_KIND_META', () => {
  it('네 kind 전부 라벨·힌트 보유(승격.py KINDS 동형)', () => {
    for (const k of ['uncovered', 'bridge', 'survey_context', 'capability'] as const) {
      expect(DISCOVERY_KIND_META[k].label).toBeTruthy();
      expect(DISCOVERY_KIND_META[k].hint).toBeTruthy();
    }
  });
});
