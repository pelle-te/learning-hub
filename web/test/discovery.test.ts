/* ============================================================
   discovery.test.ts — 발견 triage 큐 소비 순수 헬퍼 회귀(Vitest · P9 Phase 6).
   승격.py 발견큐(무결성=승격.py validate_queue 소유)를 hub inbox 가 집계·정렬하는 순수
   변환을 못박는다. 쓰기(승인/기각)는 serve.js /api/run 경로라 대상 아님(Wave④).
============================================================ */
import { describe, expect, it } from 'vitest';
import {
  discoveryStatusCounts,
  pendingEntries,
  entryTitle,
  entryGoals,
  DISCOVERY_KIND_META,
  DISCOVERY_DECISION_TOOL,
  type DiscoveryArtifact,
  type DiscoveryEntry,
  type DiscoveryKind,
  type DiscoveryStatus,
} from '@/lib/discovery';

const e = (
  id: string,
  kind: DiscoveryKind,
  score: number,
  status: DiscoveryStatus,
  detail: Record<string, unknown> = {},
): DiscoveryEntry => ({
  id,
  kind,
  source: 'test',
  score,
  status,
  detail,
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

// ── Wave④ triage 렌더/쓰기 헬퍼 ──
describe('discovery — entryTitle/entryGoals (Wave④ 표시)', () => {
  it('detail.title 우선, 없으면 id 폴백(빈 화면 방지)', () => {
    expect(entryTitle(e('uncovered::ofdm', 'uncovered', 1, 'pending', { title: 'OFDM 대칭성' }))).toBe('OFDM 대칭성');
    expect(entryTitle(e('bridge::x', 'bridge', 1, 'pending'))).toBe('bridge::x');
    expect(entryTitle(e('bridge::y', 'bridge', 1, 'pending', { title: '   ' }))).toBe('bridge::y'); // 공백=폴백
  });
  it('bridge detail.goals → 잇는 목표 id 배열(비-문자열/부재는 빈 배열)', () => {
    expect(entryGoals(e('bridge::a', 'bridge', 1, 'pending', { goals: ['g1', 'g2'] }))).toEqual(['g1', 'g2']);
    expect(entryGoals(e('bridge::b', 'bridge', 1, 'pending', { goals: ['g1', 3, null] }))).toEqual(['g1']);
    expect(entryGoals(e('uncovered::c', 'uncovered', 1, 'pending'))).toEqual([]);
  });
});

describe('discovery — DISCOVERY_DECISION_TOOL (serve.js SSOT)', () => {
  it('promote/dismiss → serve.js TOOLS 키', () => {
    expect(DISCOVERY_DECISION_TOOL.promote).toBe('discovery-promote');
    expect(DISCOVERY_DECISION_TOOL.dismiss).toBe('discovery-dismiss');
  });
});
