/* ============================================================
   artifacts.ts — parent(pipeline) 아티팩트의 _schemaVersion 소비 (P7 Bet 1 · repo 경계 계약).

   왜: pipeline↔hub 는 별도 git repo 인데 JSON 아티팩트를 주고받으며 공유 스키마가 0이었다 —
   생산자가 필드명 하나 바꾸면 이 앱 탭이 *조용히* 깨졌다. P7 Bet 1 이 부모에 버전드 JSON Schema
   (knowledge/_meta/contract/schemas/*)를 세우고 각 아티팩트에 `_schemaVersion` 을 주입한다. hub 는
   read 시 기대 버전과 대조해 불일치면 콘솔 경고를 낸다(조용한 깨짐 → 시끄러운 경고).

   버전 진화(INV-2): 부모가 파괴적 스키마 변경으로 버전을 올리면 스키마 `_schemaVersion.const` 을
   올린다 → `npm run codegen` 이 아래 EXPECTED_SCHEMA_VERSION 을 재생성한다(손유지 아님). 미스매치
   경고가 "서브모듈/재빌드 동기가 필요하다"를 개발자에게 알린다.
   (SSOT = 부모 JSON Schema. artifacts.gen.ts 가 그로부터 생성 · 여기선 재노출만.)
============================================================ */

// 버전 상수·이름 타입은 부모 스키마에서 생성된다(artifacts.gen). 하위호환 위해 여기서 재노출 —
// 기존 소비처(`from './artifacts'`)를 안 건드린다.
import { EXPECTED_SCHEMA_VERSION, type ArtifactName } from './artifacts.gen';
export { EXPECTED_SCHEMA_VERSION, type ArtifactName };

/** 아티팩트의 `_schemaVersion` 을 기대치와 대조 — 불일치/부재면 콘솔 경고(비차단 · 소비는 계속). */
export function checkSchemaVersion(name: ArtifactName, data: unknown): void {
  const v = (data as { _schemaVersion?: number } | null | undefined)?._schemaVersion;
  const exp = EXPECTED_SCHEMA_VERSION[name];
  if (v !== exp) {
    console.warn(
      `[artifact:${name}] _schemaVersion ${v ?? '(없음)'} ≠ 기대 ${exp} — parent↔hub 스키마 드리프트. ` +
        `parent 재빌드 또는 hub 서브모듈 동기가 필요할 수 있어요(P7 Bet 1).`,
    );
  }
}
