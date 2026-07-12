/* ============================================================
   artifacts.gen.ts — 생성물. 직접 편집 금지.
   원천: parent(pipeline) knowledge/_meta/contract/schemas/*.schema.json
   재생성: cd web && npm run codegen   (게이트: npm run codegen:check)
   생성기: scripts/gen-artifacts.mjs · P7 Bet 1 후속(repo 경계 드리프트 소멸).
============================================================ */
import { z } from 'zod';

/** 각 아티팩트가 기대하는 `_schemaVersion`(부모 스키마 const 파생). 불일치는 artifacts.ts 가 경고. */
export const EXPECTED_SCHEMA_VERSION = {
  index: 1,
  knowledge: 1,
  ledger: 1,
  anki: 1,
  reads: 1,
  markets: 1,
  curriculum: 3,
} as const;

export type ArtifactName = keyof typeof EXPECTED_SCHEMA_VERSION;

/** 챕터 생애 5단계(ledger 스키마 stage_counts.propertyNames.enum 파생 · 챕터원장.py STAGES 와 동일 SSOT). */
export const LEDGER_STAGES = ['sourced', 'noted', 'verified', 'carded', 'reviewed'] as const;
export type LedgerStage = (typeof LEDGER_STAGES)[number];

/** `index.schema.json` 경계 shape(생성). 스키마가 관대하므로 loose 한 곳은 타입도 loose. */
export const indexArtifactSchema = z
  .object({
    _schemaVersion: z.literal(1),
    generated: z.string(),
    n_notes: z.number(),
    n_flags: z.number().optional(),
    n_tier_hint: z.number().optional(),
    anki_cards: z.number().optional(),
    anki: z.array(z.object({ file: z.string(), cards: z.number() }).passthrough()),
    notes: z.array(
      z
        .object({
          path: z.string(),
          subject: z.string(),
          folder: z.string().optional(),
          title: z.string().optional(),
          name: z.string(),
          status: z.string().nullable(),
          type: z.string().nullable().optional(),
          role: z.string().nullable().optional(),
          kind: z.string(),
          anki_exported: z.string().nullable().optional(),
          reviewed: z.string().nullable().optional(),
          anki_state: z.string(),
          tier: z.string().nullable().optional(),
          prereq_in: z.number(),
          tier_hint: z.string().nullable().optional(),
          refactor_method: z.string().nullable().optional(),
          flags: z.array(z.unknown()),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export type IndexArtifact = z.infer<typeof indexArtifactSchema>;

/** `knowledge.schema.json` 경계 shape(생성). 스키마가 관대하므로 loose 한 곳은 타입도 loose. */
export const knowledgeArtifactSchema = z
  .object({
    _schemaVersion: z.literal(1),
    generated: z.string(),
    n_notes: z.number(),
    overall: z.number(),
    states: z.record(z.string(), z.unknown()).optional(),
    calibration: z.record(z.string(), z.unknown()).optional(),
    model: z.record(z.string(), z.unknown()).optional(),
    gaps: z.array(z.unknown()).optional(),
    subjects: z.array(
      z
        .object({
          subject: z.string(),
          n: z.number(),
          mastery: z.number(),
          weak: z.number().optional(),
          unknown: z.number().optional(),
          mastered: z.number().optional(),
          concepts: z.array(z.unknown()).optional(),
        })
        .passthrough(),
    ),
    frontier: z.array(
      z
        .object({
          basename: z.string(),
          title: z.string().optional(),
          subject: z.string(),
          p_eff: z.number(),
          prereq_in: z.number().optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export type KnowledgeArtifact = z.infer<typeof knowledgeArtifactSchema>;

/** `ledger.schema.json` 경계 shape(생성). 스키마가 관대하므로 loose 한 곳은 타입도 loose. */
export const ledgerArtifactSchema = z
  .object({
    _schemaVersion: z.literal(1),
    generated: z.string(),
    generated_by: z.string().optional(),
    n_chapters: z.number(),
    stage_counts: z.record(z.enum(['sourced', 'noted', 'verified', 'carded', 'reviewed']), z.unknown()),
    backlog: z.record(z.string(), z.unknown()).optional(),
    subjects: z.record(
      z.string(),
      z
        .object({
          slug: z.string().nullable(),
          abbr: z.string().nullable().optional(),
          domain: z.string().nullable().optional(),
          src: z.string().nullable().optional(),
          src_present: z.boolean().optional(),
          chapters: z.array(z.unknown()),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export type LedgerArtifact = z.infer<typeof ledgerArtifactSchema>;

/** `anki.schema.json` 경계 shape(생성). 스키마가 관대하므로 loose 한 곳은 타입도 loose. */
export const ankiArtifactSchema = z
  .object({
    _schemaVersion: z.literal(1),
    generated_by: z.string(),
    lapse_th: z.number().optional(),
    n_cards: z.number(),
    n_orphan: z.number(),
    orphan_rate: z.number().optional(),
    vault_uid_coverage: z.number().optional(),
    top_orphan: z.array(z.object({ prefix: z.string(), cards: z.number() }).passthrough()).optional(),
    notes: z.record(
      z.string(),
      z
        .object({
          cards: z.number(),
          max_lapse: z.number().optional(),
          lapses: z.number().optional(),
          trap_cards: z.number().optional(),
          trap_lapses: z.number().optional(),
          misconception: z.string().nullable().optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export type AnkiArtifact = z.infer<typeof ankiArtifactSchema>;

/** `reads.schema.json` 경계 shape(생성). 스키마가 관대하므로 loose 한 곳은 타입도 loose. */
export const readsArtifactSchema = z
  .object({
    _schemaVersion: z.literal(1),
    at: z.string(),
    date: z.string(),
    articles: z.array(
      z
        .object({
          id: z.string(),
          lang: z.string().optional(),
          field: z.string().optional(),
          source: z.string().optional(),
          title: z.string(),
          url: z.string(),
          published: z.string().nullable().optional(),
          words: z.number().optional(),
          text: z.string().optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export type ReadsArtifact = z.infer<typeof readsArtifactSchema>;

/** `markets.schema.json` 경계 shape(생성). 스키마가 관대하므로 loose 한 곳은 타입도 loose. */
export const marketsArtifactSchema = z
  .object({
    _schemaVersion: z.literal(1),
    at: z.string(),
    date: z.string(),
    indices: z.array(
      z
        .object({
          symbol: z.string(),
          name: z.string(),
          region: z.string().optional(),
          currency: z.string().optional(),
          price: z.number().nullable(),
          prevClose: z.number().nullable().optional(),
          change: z.number().nullable().optional(),
          changePct: z.number().nullable().optional(),
          spark: z.array(z.unknown()).optional(),
        })
        .passthrough(),
    ),
    news: z.array(
      z
        .object({
          id: z.string(),
          source: z.string().optional(),
          field: z.string().optional(),
          title: z.string(),
          url: z.string(),
          published: z.string().nullable().optional(),
          summary: z.string().optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export type MarketsArtifact = z.infer<typeof marketsArtifactSchema>;

/** `curriculum.schema.json` 경계 shape(생성). 스키마가 관대하므로 loose 한 곳은 타입도 loose. */
export const curriculumArtifactSchema = z
  .object({
    _schemaVersion: z.literal(3),
    generated: z.string(),
    generated_by: z.string().optional(),
    overall: z
      .object({
        planned_arcs: z.number(),
        atomized_arcs: z.number(),
        coverage: z.number(),
        legacy_arcs: z.number().optional(),
        in_progress_arcs: z.number().optional(),
        todo_arcs: z.number().optional(),
        authored_edges: z.number().optional(),
        suggested_edges: z.number().optional(),
        next_up: z.number().optional(),
        sequencing: z.number().optional(),
      })
      .passthrough(),
    backlog: z
      .object({ unprocessed_src: z.array(z.string()).optional(), subjects_without_src: z.array(z.string()).optional() })
      .passthrough()
      .optional(),
    edges: z
      .array(z.object({ from: z.string(), to: z.string(), reason: z.string().optional() }).passthrough())
      .optional(),
    suggested_edges: z
      .array(z.object({ from: z.string(), to: z.string(), weight: z.number() }).passthrough())
      .optional(),
    next_up: z
      .array(
        z
          .object({ arc_id: z.string(), slug: z.string().optional(), arc: z.string().optional(), status: z.string() })
          .passthrough(),
      )
      .optional(),
    sequencing: z
      .array(
        z
          .object({
            arc_id: z.string(),
            slug: z.string().optional(),
            arc: z.string().optional(),
            status: z.string().optional(),
            reason: z.enum(['remediate', 'zpd', 'frontier']),
            score: z.number(),
            mastery: z.number().nullable().optional(),
            weak_notes: z.number().optional(),
            zpd_notes: z.number().optional(),
            note_count: z.number().optional(),
            unlocks: z.number().optional(),
          })
          .passthrough(),
      )
      .optional(),
    subjects: z.array(
      z
        .object({
          slug: z.string().nullable(),
          folder: z.string().optional(),
          abbr: z.string().nullable().optional(),
          domain: z.string().nullable().optional(),
          src: z.string().nullable().optional(),
          src_present: z.boolean().optional(),
          planned_arcs: z.number(),
          atomized_arcs: z.number(),
          legacy_arcs: z.number().optional(),
          in_progress_arcs: z.number().optional(),
          todo_arcs: z.number().optional(),
          coverage: z.number(),
          arcs: z.array(
            z
              .object({
                arc: z.string(),
                arc_no: z.string().optional(),
                arc_id: z.string().optional(),
                status: z.enum(['done', 'legacy', 'in_progress', 'todo']),
                chapter_id: z.string().nullable().optional(),
                furthest: z.string().nullable().optional(),
                notes: z.number().optional(),
                verified_ratio: z.number().optional(),
                prereqs: z.array(z.string()).optional(),
                prereqs_met: z.boolean().optional(),
              })
              .passthrough(),
          ),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export type CurriculumArtifact = z.infer<typeof curriculumArtifactSchema>;

/** 이름 → 경계 zod 스키마(런타임 검증·소비처 선택 사용). */
export const ARTIFACT_SCHEMAS = {
  index: indexArtifactSchema,
  knowledge: knowledgeArtifactSchema,
  ledger: ledgerArtifactSchema,
  anki: ankiArtifactSchema,
  reads: readsArtifactSchema,
  markets: marketsArtifactSchema,
  curriculum: curriculumArtifactSchema,
} as const;
