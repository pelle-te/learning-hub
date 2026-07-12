/* ============================================================
   artifactsGen.test.ts — 생성물(artifacts.gen.ts)이 부모 스키마 사실을 정확히 담는지 회귀(Vitest).
   생성기(scripts/gen-artifacts.mjs)가 knowledge/_meta/contract/schemas/*.schema.json 에서 뽑아낸
   경계 SSOT(버전·STAGES·zod shape)를 검증한다. 이 파일이 초록이면 "손유지 복제 제거"가 성립.
   (게이트는 별도로 `codegen:check` 로 커밋본이 스키마와 정합인지도 확인한다.)
============================================================ */
import { describe, expect, it } from 'vitest';
import {
  EXPECTED_SCHEMA_VERSION,
  LEDGER_STAGES,
  ARTIFACT_SCHEMAS,
  ledgerArtifactSchema,
  marketsArtifactSchema,
} from '@/lib/artifacts.gen';

describe('artifacts.gen — 생성 상수', () => {
  it('EXPECTED_SCHEMA_VERSION 은 7 아티팩트(부모 스키마 const 파생 · curriculum v3=단계①②③)', () => {
    expect(EXPECTED_SCHEMA_VERSION).toEqual({
      index: 1,
      knowledge: 1,
      ledger: 1,
      anki: 1,
      reads: 1,
      markets: 1,
      curriculum: 3,
    });
  });

  it('LEDGER_STAGES 는 챕터 생애 5단계(순서 = furthest 진척)', () => {
    expect([...LEDGER_STAGES]).toEqual(['sourced', 'noted', 'verified', 'carded', 'reviewed']);
  });

  it('ARTIFACT_SCHEMAS 레지스트리가 모든 아티팩트 이름을 덮는다', () => {
    expect(Object.keys(ARTIFACT_SCHEMAS).sort()).toEqual(Object.keys(EXPECTED_SCHEMA_VERSION).sort());
  });
});

describe('artifacts.gen — zod 경계 스키마', () => {
  it('최소 유효 ledger 인스턴스를 통과시킨다', () => {
    const minimal = {
      _schemaVersion: 1,
      generated: '2026-07-12',
      n_chapters: 0,
      stage_counts: {},
      subjects: {},
    };
    expect(ledgerArtifactSchema.safeParse(minimal).success).toBe(true);
  });

  it('_schemaVersion 불일치(literal)는 거부한다 — repo 경계 버전 가드', () => {
    const wrong = { _schemaVersion: 2, generated: 'x', n_chapters: 0, stage_counts: {}, subjects: {} };
    expect(ledgerArtifactSchema.safeParse(wrong).success).toBe(false);
  });

  it('stage_counts 의 미지 키는 거부한다(propertyNames enum 파생)', () => {
    const badStage = {
      _schemaVersion: 1,
      generated: 'x',
      n_chapters: 0,
      stage_counts: { bogus: 1 },
      subjects: {},
    };
    expect(ledgerArtifactSchema.safeParse(badStage).success).toBe(false);
  });

  it('관대함: 계약 밖 추가 키는 보존(passthrough) — 생산자 확장 무회귀', () => {
    const extra = {
      _schemaVersion: 1,
      at: 'x',
      date: 'x',
      indices: [],
      news: [],
      future_field: 'ok',
    };
    const r = marketsArtifactSchema.safeParse(extra);
    expect(r.success).toBe(true);
  });
});
