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
  goalsArtifactSchema,
} from '@/lib/artifacts.gen';

describe('artifacts.gen — 생성 상수', () => {
  /* ⚠ **9 → 6**(P10 W4 · 2026-08-07). `reads`·`markets`·`discovery` 가 빠졌다 — 그 셋을 읽던
     화면이 `survey/` 필러로 갔다. 이 단언이 곧 불변식 I-4("hub 이 읽는 아티팩트는 6종 이하 ·
     교양 도메인이 늘어도 안 는다")의 집행자다 — 부모 스키마 파일 자체는 남아 있으므로
     `gen-artifacts.mjs` 의 목록에 한 줄만 되돌리면 조용히 7종이 된다. 여기서 시끄럽게 깨진다. */
  it('EXPECTED_SCHEMA_VERSION 은 6 아티팩트(부모 스키마 const 파생 · curriculum v4=P9 Phase4 연관성 · knowledge v2=②#54 사전분포 검역)', () => {
    expect(EXPECTED_SCHEMA_VERSION).toEqual({
      index: 1,
      knowledge: 2,
      ledger: 1,
      anki: 1,
      curriculum: 4,
      goals: 1,
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
      nodes: [],
      future_field: 'ok',
    };
    const r = goalsArtifactSchema.safeParse(extra);
    expect(r.success).toBe(true);
  });
});
