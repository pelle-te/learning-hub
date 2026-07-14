/* ============================================================
   discovery.ts — 발견 triage 큐 데이터 레이어 (P9 Phase 6 · D5 사람=승격).
   원천: serve.js GET /api/artifact/discovery (state/_발견큐.json · 승격.py 산출).
   콜드(수집·발견 미가동)면 파일 부재 → serve.js 404 → fetch throw → 호출부가 빈 inbox 우아 안내.
   타입은 부모 스키마에서 생성(artifacts.gen · discoveryArtifactSchema) — 손유지 파서 0.
   승인/기각(사람 결정)은 serve.js /api/run 으로 승격.py 를 호출(쓰기 경로는 Wave④).
============================================================ */
import { getArtifact } from './api';
import { checkSchemaVersion } from './artifacts';
import type { DiscoveryArtifact } from './artifacts.gen';

export type { DiscoveryArtifact };
/** 발견 후보 1건 — 생성 스키마에서 파생(손유지 아님). */
export type DiscoveryEntry = DiscoveryArtifact['entries'][number];
export type DiscoveryKind = DiscoveryEntry['kind'];
export type DiscoveryStatus = DiscoveryEntry['status'];

/** kind 표시 메타 — 라벨·힌트(색은 소비처가 디자인시스템 변수로). SSOT = 승격.py KINDS. */
export const DISCOVERY_KIND_META: Record<DiscoveryKind, { label: string; hint: string }> = {
  uncovered: { label: '미개척', hint: '내 목표 근접하나 아직 노트 없는 개념(surface)' },
  bridge: { label: '다리개념', hint: '둘 이상 활성 하위목표를 잇는 개념(매개중심성 · 다목적)' },
  survey_context: { label: '수집맥락', hint: '핵심 학습 옆에 붙일 수집 개론 섹션(핵심↔수집 양방향)' },
  capability: { label: '가능신호', hint: '프로젝트 필요지식이 임계 도달 — 이제 할 수 있음(D10)' },
};

export async function fetchDiscoveryArtifact(): Promise<DiscoveryArtifact> {
  const j = await getArtifact<DiscoveryArtifact>('discovery');
  if (!j || !j.ok || !j.data) throw new Error('발견 큐가 아직 비어 있어요(수집·발견 미가동).');
  checkSchemaVersion('discovery', j.data); // P7 Bet 1: 버전 드리프트 경고
  return j.data;
}

/** status 버킷별 개수 — 승격.py 요약과 동형(pending/promoted/dismissed). 빈/undefined=0맵. */
export function discoveryStatusCounts(d: DiscoveryArtifact | null | undefined): Record<DiscoveryStatus, number> {
  const c: Record<DiscoveryStatus, number> = { pending: 0, promoted: 0, dismissed: 0 };
  for (const e of d?.entries ?? []) {
    if (e.status in c) c[e.status] += 1;
  }
  return c;
}

/** 미결(pending) 후보만 score 내림차순 — inbox 상단 표시(동률=입력순 보존 안정정렬). */
export function pendingEntries(d: DiscoveryArtifact | null | undefined): DiscoveryEntry[] {
  return (d?.entries ?? [])
    .filter((e) => e.status === 'pending')
    .map((e, i) => [e, i] as const)
    .sort((a, b) => b[0].score - a[0].score || a[1] - b[1])
    .map(([e]) => e);
}

/** capability-unlock 가능신호(kind='capability')만 — 미결 우선순위순. 프로젝트 필요지식이 임계 도달해
    "이제 이 프로젝트 가능"으로 surface 된 후보(D10 · 발견.py). 내 길 지도의 프로젝트 섹션이 양방향으로 참조.
    (승격/기각 사람 결정은 발견 큐에서 · 여기선 읽기만.) */
export function capabilitySignals(d: DiscoveryArtifact | null | undefined): DiscoveryEntry[] {
  return pendingEntries(d).filter((e) => e.kind === 'capability');
}

/** 후보 표시 제목 — detail.title(승격.py enqueue 가 심음) 우선, 없으면 id(kind::key)로 폴백(빈 화면 방지). */
export function entryTitle(e: DiscoveryEntry): string {
  const t = (e.detail as { title?: unknown } | null | undefined)?.title;
  return typeof t === 'string' && t.trim() ? t.trim() : e.id;
}

/** bridge 후보가 잇는 활성 하위목표 id들(detail.goals · 다목적 다리개념일수록 여럿). 없으면 빈 배열. */
export function entryGoals(e: DiscoveryEntry): string[] {
  const g = (e.detail as { goals?: unknown } | null | undefined)?.goals;
  return Array.isArray(g) ? g.filter((x): x is string => typeof x === 'string') : [];
}

/** 사람 결정 → serve.js /api/run 도구 키(SSOT = serve.js TOOLS discovery-promote/dismiss). */
export const DISCOVERY_DECISION_TOOL = { promote: 'discovery-promote', dismiss: 'discovery-dismiss' } as const;
export type DiscoveryDecision = keyof typeof DISCOVERY_DECISION_TOOL;
