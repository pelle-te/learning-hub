/* ============================================================
   artifacts.gen.ts — 생성물. 직접 편집 금지.
   원천: parent(pipeline) knowledge/_meta/contract/schemas/*.schema.json
   재생성: cd web && npm run codegen   (게이트: npm run codegen:check)
   생성기: scripts/gen-artifacts.mjs · P7 Bet 1 후속(repo 경계 드리프트 소멸).
============================================================ */
import * as z from 'zod/mini';

/** 각 아티팩트가 기대하는 `_schemaVersion`(부모 스키마 const 파생). 불일치는 artifacts.ts 가 경고. */
export const EXPECTED_SCHEMA_VERSION = {
  index: 1,
  knowledge: 2,
  ledger: 1,
  anki: 1,
  reads: 1,
  markets: 1,
  curriculum: 4,
  goals: 1,
  discovery: 1,
} as const;

export type ArtifactName = keyof typeof EXPECTED_SCHEMA_VERSION;

/** 챕터 생애 5단계(ledger 스키마 stage_counts.propertyNames.enum 파생 · 챕터원장.py STAGES 와 동일 SSOT). */
export const LEDGER_STAGES = ['sourced', 'noted', 'verified', 'carded', 'reviewed'] as const;
export type LedgerStage = (typeof LEDGER_STAGES)[number];

/** 졸업요건 임계(전자공학 2020 요람·ABEEK) — 부모 goals.json 'degree-requirement' 노드
 *  `degree_req` 파생(감사 2026-07-16 #7 · 3중화 해소). 숫자 변경은 goals.json 한 곳 → npm run codegen. */
export const DEGREE_REQ = {
  targetTotal: 128,
  reqMajorReq: 41,
  reqMajorSel: 27,
  reqLiberal: 51,
} as const;

/** `index.schema.json` 경계 shape(생성). 스키마가 관대하므로 loose 한 곳은 타입도 loose. */
export const indexArtifactSchema = z.looseObject({
  _schemaVersion: z.literal(1),
  generated: z.string(),
  n_notes: z.number(),
  n_flags: z.optional(z.number()),
  n_tier_hint: z.optional(z.number()),
  anki_cards: z.optional(z.number()),
  anki: z.array(z.looseObject({ file: z.string(), cards: z.number() })),
  notes: z.array(
    z.looseObject({
      path: z.string(),
      subject: z.string(),
      folder: z.optional(z.string()),
      title: z.optional(z.string()),
      name: z.string(),
      status: z.nullable(z.string()),
      type: z.optional(z.nullable(z.string())),
      role: z.optional(z.nullable(z.string())),
      kind: z.string(),
      anki_exported: z.optional(z.nullable(z.string())),
      reviewed: z.optional(z.nullable(z.string())),
      anki_state: z.string(),
      tier: z.optional(z.nullable(z.string())),
      prereq_in: z.number(),
      tier_hint: z.optional(z.nullable(z.string())),
      refactor_method: z.optional(z.nullable(z.string())),
      flags: z.array(z.unknown()),
    }),
  ),
});
export type IndexArtifact = z.infer<typeof indexArtifactSchema>;

/** `knowledge.schema.json` 경계 shape(생성). 스키마가 관대하므로 loose 한 곳은 타입도 loose. */
export const knowledgeArtifactSchema = z.looseObject({
  _schemaVersion: z.literal(2),
  generated: z.string(),
  n_notes: z.number(),
  overall: z.nullable(z.number()),
  states: z.optional(z.record(z.string(), z.unknown())),
  calibration: z.optional(z.record(z.string(), z.unknown())),
  model: z.optional(z.record(z.string(), z.unknown())),
  gaps: z.optional(z.array(z.unknown())),
  subjects: z.array(
    z.looseObject({
      subject: z.string(),
      n: z.number(),
      mastery: z.nullable(z.number()),
      weak: z.optional(z.number()),
      unknown: z.optional(z.number()),
      mastered: z.optional(z.number()),
      concepts: z.optional(z.array(z.unknown())),
      measured: z.optional(z.number()),
    }),
  ),
  frontier: z.array(
    z.looseObject({
      basename: z.string(),
      title: z.optional(z.string()),
      subject: z.string(),
      p_eff: z.number(),
      prereq_in: z.optional(z.number()),
    }),
  ),
  evidence_coverage: z.optional(z.record(z.string(), z.unknown())),
});
export type KnowledgeArtifact = z.infer<typeof knowledgeArtifactSchema>;

/** `ledger.schema.json` 경계 shape(생성). 스키마가 관대하므로 loose 한 곳은 타입도 loose. */
export const ledgerArtifactSchema = z.looseObject({
  _schemaVersion: z.literal(1),
  generated: z.string(),
  generated_by: z.optional(z.string()),
  n_chapters: z.number(),
  stage_counts: z.record(z.enum(['sourced', 'noted', 'verified', 'carded', 'reviewed']), z.unknown()),
  backlog: z.optional(z.record(z.string(), z.unknown())),
  subjects: z.record(
    z.string(),
    z.looseObject({
      slug: z.nullable(z.string()),
      abbr: z.optional(z.nullable(z.string())),
      domain: z.optional(z.nullable(z.string())),
      src: z.optional(z.nullable(z.string())),
      src_present: z.optional(z.boolean()),
      chapters: z.array(z.unknown()),
    }),
  ),
});
export type LedgerArtifact = z.infer<typeof ledgerArtifactSchema>;

/** `anki.schema.json` 경계 shape(생성). 스키마가 관대하므로 loose 한 곳은 타입도 loose. */
export const ankiArtifactSchema = z.looseObject({
  _schemaVersion: z.literal(1),
  generated_by: z.string(),
  lapse_th: z.optional(z.number()),
  n_cards: z.number(),
  n_orphan: z.number(),
  orphan_rate: z.optional(z.number()),
  vault_uid_coverage: z.optional(z.number()),
  top_orphan: z.optional(z.array(z.looseObject({ prefix: z.string(), cards: z.number() }))),
  notes: z.record(
    z.string(),
    z.looseObject({
      cards: z.number(),
      max_lapse: z.optional(z.number()),
      lapses: z.optional(z.number()),
      trap_cards: z.optional(z.number()),
      trap_lapses: z.optional(z.number()),
      misconception: z.optional(z.nullable(z.string())),
    }),
  ),
});
export type AnkiArtifact = z.infer<typeof ankiArtifactSchema>;

/** `reads.schema.json` 경계 shape(생성). 스키마가 관대하므로 loose 한 곳은 타입도 loose. */
export const readsArtifactSchema = z.looseObject({
  _schemaVersion: z.literal(1),
  at: z.string(),
  date: z.string(),
  articles: z.array(
    z.looseObject({
      id: z.string(),
      lang: z.optional(z.string()),
      field: z.optional(z.string()),
      source: z.optional(z.string()),
      title: z.string(),
      url: z.string(),
      published: z.optional(z.nullable(z.string())),
      words: z.optional(z.number()),
      text: z.optional(z.string()),
    }),
  ),
});
export type ReadsArtifact = z.infer<typeof readsArtifactSchema>;

/** `markets.schema.json` 경계 shape(생성). 스키마가 관대하므로 loose 한 곳은 타입도 loose. */
export const marketsArtifactSchema = z.looseObject({
  _schemaVersion: z.literal(1),
  at: z.string(),
  date: z.string(),
  indices: z.array(
    z.looseObject({
      symbol: z.string(),
      name: z.string(),
      region: z.optional(z.string()),
      currency: z.optional(z.string()),
      price: z.nullable(z.number()),
      prevClose: z.optional(z.nullable(z.number())),
      change: z.optional(z.nullable(z.number())),
      changePct: z.optional(z.nullable(z.number())),
      spark: z.optional(z.array(z.unknown())),
    }),
  ),
  news: z.array(
    z.looseObject({
      id: z.string(),
      source: z.optional(z.string()),
      field: z.optional(z.string()),
      title: z.string(),
      url: z.string(),
      published: z.optional(z.nullable(z.string())),
      summary: z.optional(z.string()),
    }),
  ),
});
export type MarketsArtifact = z.infer<typeof marketsArtifactSchema>;

/** `curriculum.schema.json` 경계 shape(생성). 스키마가 관대하므로 loose 한 곳은 타입도 loose. */
export const curriculumArtifactSchema = z.looseObject({
  _schemaVersion: z.literal(4),
  generated: z.string(),
  generated_by: z.optional(z.string()),
  overall: z.looseObject({
    planned_arcs: z.number(),
    atomized_arcs: z.number(),
    coverage: z.number(),
    legacy_arcs: z.optional(z.number()),
    in_progress_arcs: z.optional(z.number()),
    todo_arcs: z.optional(z.number()),
    authored_edges: z.optional(z.number()),
    suggested_edges: z.optional(z.number()),
    next_up: z.optional(z.number()),
    sequencing: z.optional(z.number()),
    relevance_active: z.optional(z.boolean()),
    time_budget_hours: z.optional(z.number()),
    allocated_arcs: z.optional(z.number()),
    deferred_arcs: z.optional(z.number()),
    allocated_hours: z.optional(z.number()),
  }),
  backlog: z.optional(
    z.looseObject({
      unprocessed_src: z.optional(z.array(z.string())),
      subjects_without_src: z.optional(z.array(z.string())),
    }),
  ),
  mapping_drift: z.optional(z.array(z.string())),
  edges: z.optional(z.array(z.looseObject({ from: z.string(), to: z.string(), reason: z.optional(z.string()) }))),
  suggested_edges: z.optional(z.array(z.looseObject({ from: z.string(), to: z.string(), weight: z.number() }))),
  next_up: z.optional(
    z.array(
      z.looseObject({
        arc_id: z.string(),
        slug: z.optional(z.string()),
        arc: z.optional(z.string()),
        status: z.string(),
      }),
    ),
  ),
  sequencing: z.optional(
    z.array(
      z.looseObject({
        arc_id: z.string(),
        slug: z.optional(z.string()),
        arc: z.optional(z.string()),
        status: z.optional(z.string()),
        reason: z.enum(['remediate', 'zpd', 'frontier']),
        score: z.number(),
        mastery: z.optional(z.nullable(z.number())),
        weak_notes: z.optional(z.number()),
        zpd_notes: z.optional(z.number()),
        note_count: z.optional(z.number()),
        unlocks: z.optional(z.number()),
        relevance: z.optional(z.number()),
        target_depth: z.optional(z.nullable(z.string())),
        priority: z.optional(z.number()),
        goal: z.optional(z.nullable(z.string())),
        역할: z.optional(z.nullable(z.string())),
        est_effort: z.optional(z.number()),
        allocated: z.optional(z.boolean()),
        defer_reason: z.optional(z.nullable(z.string())),
      }),
    ),
  ),
  engine_health: z.optional(
    z.looseObject({
      status: z.enum(['cold', 'measuring']),
      evidenced_notes: z.optional(z.number()),
      by_relevance: z.optional(
        z.record(
          z.string(),
          z.looseObject({ n: z.optional(z.number()), mean_mastery: z.optional(z.nullable(z.number())) }),
        ),
      ),
    }),
  ),
  subjects: z.array(
    z.looseObject({
      slug: z.nullable(z.string()),
      folder: z.optional(z.string()),
      abbr: z.optional(z.nullable(z.string())),
      domain: z.optional(z.nullable(z.string())),
      src: z.optional(z.nullable(z.string())),
      src_present: z.optional(z.boolean()),
      planned_arcs: z.number(),
      atomized_arcs: z.number(),
      legacy_arcs: z.optional(z.number()),
      in_progress_arcs: z.optional(z.number()),
      todo_arcs: z.optional(z.number()),
      coverage: z.number(),
      arcs: z.array(
        z.looseObject({
          arc: z.string(),
          arc_no: z.optional(z.string()),
          arc_id: z.optional(z.string()),
          status: z.enum(['done', 'legacy', 'in_progress', 'todo']),
          chapter_id: z.optional(z.nullable(z.string())),
          furthest: z.optional(z.nullable(z.string())),
          notes: z.optional(z.number()),
          verified_ratio: z.optional(z.number()),
          prereqs: z.optional(z.array(z.string())),
          prereqs_met: z.optional(z.boolean()),
        }),
      ),
    }),
  ),
});
export type CurriculumArtifact = z.infer<typeof curriculumArtifactSchema>;

/** `goals.schema.json` 경계 shape(생성). 스키마가 관대하므로 loose 한 곳은 타입도 loose. */
export const goalsArtifactSchema = z.looseObject({
  _schemaVersion: z.literal(1),
  nodes: z.array(
    z.looseObject({
      id: z.string(),
      kind: z.enum(['goal', 'project']),
      title: z.string(),
      weight: z.number(),
      active: z.boolean(),
      parent: z.nullable(z.string()),
      degree_req: z.optional(
        z.looseObject({
          targetTotal: z.optional(z.number()),
          reqMajorReq: z.optional(z.number()),
          reqMajorSel: z.optional(z.number()),
          reqLiberal: z.optional(z.number()),
        }),
      ),
      분야: z.optional(z.string()),
      산출물: z.optional(z.string()),
      필요지식: z.optional(z.array(z.string())),
      capability임계: z.optional(z.number()),
    }),
  ),
});
export type GoalsArtifact = z.infer<typeof goalsArtifactSchema>;

/** `discovery.schema.json` 경계 shape(생성). 스키마가 관대하므로 loose 한 곳은 타입도 loose. */
export const discoveryArtifactSchema = z.looseObject({
  _schemaVersion: z.literal(1),
  entries: z.array(
    z.looseObject({
      id: z.string(),
      kind: z.enum(['uncovered', 'bridge', 'survey_context', 'capability']),
      source: z.string(),
      score: z.number(),
      status: z.enum(['pending', 'promoted', 'dismissed']),
      detail: z.record(z.string(), z.unknown()),
    }),
  ),
});
export type DiscoveryArtifact = z.infer<typeof discoveryArtifactSchema>;

/** 이름 → 경계 zod 스키마(런타임 검증·소비처 선택 사용). */
export const ARTIFACT_SCHEMAS = {
  index: indexArtifactSchema,
  knowledge: knowledgeArtifactSchema,
  ledger: ledgerArtifactSchema,
  anki: ankiArtifactSchema,
  reads: readsArtifactSchema,
  markets: marketsArtifactSchema,
  curriculum: curriculumArtifactSchema,
  goals: goalsArtifactSchema,
  discovery: discoveryArtifactSchema,
} as const;
