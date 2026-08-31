/* ============================================================
   artifactsGen.test.ts — 생성물(artifacts.gen.ts)이 부모 스키마 사실을 정확히 담는지 회귀(Vitest).
   생성기(scripts/gen-artifacts.mjs)가 knowledge/_meta/contract/schemas/*.schema.json 에서 뽑아낸
   경계 SSOT(버전·STAGES·zod shape)를 검증한다. 이 파일이 초록이면 "손유지 복제 제거"가 성립.
   (게이트는 별도로 `codegen:check` 로 커밋본이 스키마와 정합인지도 확인한다.)
============================================================ */
import { describe, expect, it } from 'vitest';
import { EXPECTED_SCHEMA_VERSION, LEDGER_STAGES, ARTIFACT_SCHEMAS, ledgerArtifactSchema } from '@/lib/artifacts.gen';

describe('artifacts.gen — 생성 상수', () => {
  /* ⚠ **9 → 6**(P10 W4 · 2026-08-07). `reads`·`markets`·`discovery` 가 빠졌다 — 그 셋을 읽던
     화면이 `survey/` 필러로 갔다. 이 단언이 곧 불변식 I-4("hub 이 읽는 아티팩트는 6종 이하 ·
     교양 도메인이 늘어도 안 는다")의 집행자다 — 부모 스키마 파일 자체는 남아 있으므로
     `gen-artifacts.mjs` 의 목록에 한 줄만 되돌리면 조용히 7종이 된다. 여기서 시끄럽게 깨진다. */
  /* ⛔⛔ 2026-08-29 — `knowledge`·`anki`·`goals` 셋이 빠지고 `curriculum` 이 v5 가 됐다.
     부모(pipeline)가 목적을 「전공 교재 → 원자형 노트」로 좁히며 그 **스키마 파일 자체를 지웠다**
     (숙달도 추정·복습 신호·삶-연관성 배분 = 범위 밖). curriculum v5 는 단계③④ 제거분.
     ⚠ 위 주석의 «부모 스키마 파일 자체는 남아 있으므로 한 줄만 되돌리면» 은 그 셋에 대해
       **더는 참이 아니다** — 되돌리려면 부모 태그 `은퇴/학습층-2026-08-29` 에서 꺼내야 한다. */
  it('EXPECTED_SCHEMA_VERSION 은 3 아티팩트(부모 스키마 const 파생 · curriculum v5=단계③④ 제거)', () => {
    expect(EXPECTED_SCHEMA_VERSION).toEqual({
      index: 1,
      ledger: 1,
      curriculum: 5,
    });
  });

  /* ⛔ 2026-08-29 — `reviewed` 가 빠져 4단계다(복습 관측 = 범위 밖 · 부모 ledger 스키마 파생). */
  it('LEDGER_STAGES 는 챕터 생애 4단계(순서 = furthest 진척)', () => {
    expect([...LEDGER_STAGES]).toEqual(['sourced', 'noted', 'verified', 'carded']);
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

  /* ⚠ 종전 이 단언은 `goalsArtifactSchema` 로 관대함을 쟀다. 그 아티팩트가 2026-08-29 에
     은퇴해 `ledger` 로 옮겼다 — 재는 것은 **계약 밖 키의 보존**이지 어느 아티팩트냐가 아니므로
     증명력은 같다. */
  it('관대함: 계약 밖 추가 키는 보존(passthrough) — 생산자 확장 무회귀', () => {
    const extra = {
      _schemaVersion: 1,
      generated: 'x',
      n_chapters: 0,
      stage_counts: {},
      subjects: {},
      future_field: 'ok',
    };
    const r = ledgerArtifactSchema.safeParse(extra);
    expect(r.success).toBe(true);
  });
});
