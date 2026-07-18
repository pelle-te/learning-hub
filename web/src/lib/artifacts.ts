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
import { ARTIFACT_SCHEMAS, EXPECTED_SCHEMA_VERSION, type ArtifactName } from './artifacts.gen';
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

/** ARTIFACT_SCHEMAS 에 스키마가 있는 이름(= 부모 JSON Schema 에서 생성된 것). */
type ParsableName = ArtifactName & keyof typeof ARTIFACT_SCHEMAS;

/* ── 경계 파싱(2026-07-19 플랫폼 감사 ③) ──────────────────────────────────
   `checkSchemaVersion` 은 **버전 숫자 하나**만 봤다. 그런데 이 파일 서두가 적은 실제 실패
   모드는 "생산자가 필드명 하나 바꾸면 탭이 조용히 깨진다" — 그건 버전이 그대로인 채로 일어나므로
   버전 대조로는 절대 안 잡힌다. 정작 필요한 모양 검증은 `artifacts.gen.ts` 가 부모 스키마에서
   이미 생성해뒀는데("소비처 선택 사용") 아무도 선택하지 않아, 소비처는 전부 `as T` 캐스팅이었다.

   설계 계약:
   - **비차단.** 검증 실패해도 원본을 그대로 돌려준다 → 최악의 경우 오늘과 똑같이 동작하고,
     달라지는 건 "조용히 깨진다"가 "시끄럽게 경고하고 깨진다"가 되는 것뿐이다. 탭을 빈 화면으로
     만들지 않는다(persistence.ts:255 가 경계한 '정상 레코드 오폭 삭제'와 같은 이유).
   - **부모 스키마 파생이라 신뢰할 수 있다.** 손유지 AppStateSchema 와 달리 이건 생성물이라
     실데이터와 대조된 적 없는 스키마가 아니다.
   - 스키마가 passthrough 라 미지 필드는 보존된다(생산자가 필드를 *추가*하는 건 깨짐이 아니다).
──────────────────────────────────────────────────────────────────────── */
export function parseArtifact<N extends ParsableName>(name: N, data: unknown): unknown {
  checkSchemaVersion(name, data);
  const r = ARTIFACT_SCHEMAS[name].safeParse(data);
  if (r.success) return r.data;
  // 상위 5개만 — 필드 하나가 어긋나면 하위 이슈가 수십 개 딸려 나와 콘솔이 쓸려나간다.
  const issues = r.error.issues
    .slice(0, 5)
    .map((i) => `  · ${i.path.join('.') || '(루트)'}: ${i.message}`)
    .join('\n');
  const more = r.error.issues.length > 5 ? `\n  … 외 ${r.error.issues.length - 5}건` : '';
  console.warn(
    `[artifact:${name}] 모양이 계약과 다릅니다 — parent(pipeline)가 필드를 바꿨을 수 있어요.\n${issues}${more}\n` +
      `원본을 그대로 사용합니다(비차단). 계약 정본 = parent 의 knowledge/_meta/contract/schemas/.`,
  );
  return data;
}
