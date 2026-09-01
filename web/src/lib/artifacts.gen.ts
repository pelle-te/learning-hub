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
  ledger: 1,
  curriculum: 5,
} as const;

export type ArtifactName = keyof typeof EXPECTED_SCHEMA_VERSION;

/** 챕터 생애 5단계(ledger 스키마 stage_counts.propertyNames.enum 파생 · 챕터원장.py STAGES 와 동일 SSOT). */
export const LEDGER_STAGES = ['sourced', 'noted', 'verified'] as const;
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
      reviewed: z.optional(z.nullable(z.string())),
      tier: z.optional(z.nullable(z.string())),
      prereq_in: z.number(),
      tier_hint: z.optional(z.nullable(z.string())),
      refactor_method: z.optional(z.nullable(z.string())),
      flags: z.array(z.unknown()),
    }),
  ),
});
export type IndexArtifact = z.infer<typeof indexArtifactSchema>;

/** `ledger.schema.json` 경계 shape(생성). 스키마가 관대하므로 loose 한 곳은 타입도 loose. */
export const ledgerArtifactSchema = z.looseObject({
  _schemaVersion: z.literal(1),
  generated: z.string(),
  generated_by: z.optional(z.string()),
  n_chapters: z.number(),
  stage_counts: z.record(z.enum(['sourced', 'noted', 'verified']), z.unknown()),
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

/** `curriculum.schema.json` 경계 shape(생성). 스키마가 관대하므로 loose 한 곳은 타입도 loose. */
export const curriculumArtifactSchema = z.looseObject({
  _schemaVersion: z.literal(5),
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

/** 이름 → 경계 zod 스키마(런타임 검증·소비처 선택 사용). */
export const ARTIFACT_SCHEMAS = {
  index: indexArtifactSchema,
  ledger: ledgerArtifactSchema,
  curriculum: curriculumArtifactSchema,
} as const;
