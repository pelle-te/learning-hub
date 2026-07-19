/* ============================================================
   ledger — 정본 축(과목×챕터 원장)의 웹 소비 레이어. 순수·IO 분리.
   원본: pipeline/_도구/챕터원장.py → knowledge/_meta/cache/_챕터원장.json (산출물 `ledger` /api/artifact/ledger).
   원장은 각 챕터가 5단계 생애(sourced→noted→verified→carded→reviewed)에서 "얼마나 멀리 갔나"를
   집계한다 — 흩어져 있던 볼트 파이프라인 진척을 한 화면에 모으는 단일 출처(통합 4단계).
   이 파일은 타입·페치·순수 파생만. 렌더는 features/ledger가 소유(React 무관).
============================================================ */
import { getArtifact } from './api';
import { parseArtifact } from './artifacts';
// 5단계(furthest 순서)는 부모 ledger 스키마에서 생성 — 손유지 복제 제거(챕터원장.py STAGES와 동일 SSOT).
import { LEDGER_STAGES, type LedgerStage } from './artifacts.gen';
export { LEDGER_STAGES, type LedgerStage };
/** 어떤 마일스톤도 못 밟은 챕터(furthest 없음). */
export type Furthest = LedgerStage | 'planned';

export interface LedgerChapter {
  chapter_id: string;
  arc: string;
  notes: number;
  concept: number;
  status: { verified: number; drafted: number; raw: number; 구버전: number };
  verified_ratio: number;
  carded_notes: number;
  cards: number;
  reps: number;
  reviewed_recent: string | null;
  milestones: Record<LedgerStage, boolean>;
  furthest: Furthest;
}

export interface LedgerSubject {
  slug: string;
  abbr: string;
  domain: string;
  src: string | null;
  src_present: boolean;
  chapters: LedgerChapter[];
}

export interface Ledger {
  generated: string;
  generated_by: string;
  n_chapters: number;
  stage_counts: Record<LedgerStage, number>;
  backlog: { unprocessed_src: string[]; subjects_without_src: string[] };
  subjects: Record<string, LedgerSubject>;
}

/** 단계 표시 메타 — 라벨·글리프·색(토큰). 완성도 순(cool→warm→green)으로 furthest를 색칠. */
export const STAGE_META: Record<LedgerStage, { label: string; glyph: string; color: string; desc: string }> = {
  sourced: { label: '출처', glyph: '📂', color: 'var(--line,#3a3f4b)', desc: '참고자료 폴더 연결' },
  noted: { label: '노트', glyph: '📝', color: 'var(--mut,#9298a4)', desc: '원자 노트 작성' },
  verified: { label: '검증', glyph: '✓', color: 'var(--sky,#5aa9e6)', desc: '개념 노트 검증 통과' },
  carded: { label: '카드', glyph: '🃏', color: 'var(--learning,#d6a72b)', desc: 'Anki 카드 발급' },
  reviewed: { label: '복습', glyph: '🔁', color: 'var(--good,#62d28c)', desc: '최근 인출(복습) 관측' },
};

/** planned(마일스톤 0) 표시 색 — 아직 착수 전. */
export const PLANNED_COLOR = 'var(--panel-2,#2a2d35)';

/** furthest 단계의 색(토큰). planned면 회색. */
export function furthestColor(f: Furthest): string {
  return f === 'planned' ? PLANNED_COLOR : STAGE_META[f].color;
}

/** furthest 단계 인덱스(0..4), planned=-1. 정렬·진척 비교에 사용. */
export function stageIndex(f: Furthest): number {
  return f === 'planned' ? -1 : LEDGER_STAGES.indexOf(f);
}

export interface SubjectRollup {
  subject: string;
  slug: string;
  abbr: string;
  total: number;
  /** 각 단계에 도달한 챕터 수(마일스톤 기준·독립 카운트, 원장 stage_counts와 동일 규칙). */
  reached: Record<LedgerStage, number>;
  /** furthest가 각 값인 챕터 수(planned 포함) — 히트맵 요약. */
  furthestDist: Record<Furthest, number>;
  /** 진척 점수 = Σ stageIndex(furthest)+1 / (total*5) — 0..1. 과목 정렬 키. */
  progress: number;
  srcPresent: boolean;
}

/** 과목 1개의 롤업(정렬·요약용, 순수). */
export function subjectRollup(name: string, s: LedgerSubject): SubjectRollup {
  const reached: Record<LedgerStage, number> = { sourced: 0, noted: 0, verified: 0, carded: 0, reviewed: 0 };
  const furthestDist: Record<Furthest, number> = {
    planned: 0,
    sourced: 0,
    noted: 0,
    verified: 0,
    carded: 0,
    reviewed: 0,
  };
  let scoreSum = 0;
  for (const ch of s.chapters) {
    for (const st of LEDGER_STAGES) if (ch.milestones[st]) reached[st]++;
    furthestDist[ch.furthest]++;
    scoreSum += stageIndex(ch.furthest) + 1; // planned→0, reviewed→5
  }
  const total = s.chapters.length;
  return {
    subject: name,
    slug: s.slug,
    abbr: s.abbr,
    total,
    reached,
    furthestDist,
    progress: total ? scoreSum / (total * 5) : 0,
    srcPresent: s.src_present,
  };
}

/** 전 과목 롤업(진척 낮은 순 — 손볼 곳 먼저). 빈 과목은 뒤로. */
export function subjectRollups(l: Ledger): SubjectRollup[] {
  return Object.entries(l.subjects)
    .map(([name, s]) => subjectRollup(name, s))
    .sort((a, b) => a.progress - b.progress || b.total - a.total);
}

/** 병목 단계 — sourced를 뺀 4단계 중 '직전 단계 도달분 대비 통과율'이 가장 낮은 단계.
 *  "다음에 어디에 손대면 가장 크게 진척하나"를 한 줄로. reached는 독립 카운트라 인접비로 근사. */
export function bottleneckStage(l: Ledger): { stage: LedgerStage; passed: number; from: number } | null {
  const sc = l.stage_counts;
  let worst: { stage: LedgerStage; passed: number; from: number; ratio: number } | null = null;
  for (let i = 1; i < LEDGER_STAGES.length; i++) {
    const stage = LEDGER_STAGES[i]!;
    const prev = LEDGER_STAGES[i - 1]!;
    const from = sc[prev];
    if (from <= 0) continue;
    const ratio = sc[stage] / from;
    if (!worst || ratio < worst.ratio) worst = { stage, passed: sc[stage], from, ratio };
  }
  return worst ? { stage: worst.stage, passed: worst.passed, from: worst.from } : null;
}

/** 서버(/api/artifact/ledger)에서 챕터 원장 페치. 미생성/오프라인이면 throw(우아 안내는 소비처). */
export async function fetchLedgerArtifact(): Promise<Ledger> {
  const j = await getArtifact<Ledger>('ledger');
  if (!j || !j.ok || !j.data) throw new Error('챕터 원장 산출물(ledger)을 찾지 못했어요.');
  parseArtifact('ledger', j.data); // 버전 + 모양 드리프트 경고(비차단)
  return j.data;
}
