#!/usr/bin/env node
/* ============================================================
   gen-artifacts.mjs — parent(pipeline) 경계 아티팩트 JSON Schema → hub 타입/zod 생성.
   (P7 Bet 1 후속 · 드리프트 원천 소멸)

   왜: pipeline↔hub 는 별도 repo 로 JSON 아티팩트를 주고받는다. hub 소비 파서가 그 shape 을
   *손으로* 1:1 복제하면 부모가 스키마를 바꿀 때 조용히 드리프트한다. 부모의 버전드 JSON Schema
   (knowledge/_meta/contract/schemas/*.schema.json)를 **단일 진리**로 삼아 이 스크립트가
   `src/lib/artifacts.gen.ts`(zod 스키마 + 추론 타입 + 상수)를 생성한다 → 손유지 복제 제거.

   생성물이 소유하는 SSOT(부모 스키마에서 파생):
     · EXPECTED_SCHEMA_VERSION  ← 각 스키마 `_schemaVersion.const`
     · LEDGER_STAGES            ← ledger `stage_counts.propertyNames.enum`
     · <name>ArtifactSchema/type ← 경계 shape(관대 — 스키마가 loose 하면 타입도 loose)

   주의: 스키마는 *경계 계약*(required=hub 소비 키, additionalProperties 관대)이라 의도적으로 느슨하다.
   hub 의 풍부한 소비 타입(예: ledger.ts LedgerChapter)은 여기서 대체하지 않는다 — 스키마가 담지 않는
   부분이므로 손유지가 옳다. 이 파일은 *경계*와 *스키마가 담은 사실*만 생성한다.

   사용: cd web && node scripts/gen-artifacts.mjs [--check] [--schemas=<dir>]
     (기본)   생성/갱신 (변경 있을 때만 write).
     --check  스테일 검사(게이트용) — 커밋본과 재생성본 불일치면 exit 1. 스키마 디렉터리
              부재(hub 단독 클론)면 경고 후 skip(exit 0 · ruff/pyright 무설치-건너뜀과 동형).
============================================================ */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

const root = join(dirname(fileURLToPath(import.meta.url)), '..'); // web/
const args = process.argv.slice(2);
const check = args.includes('--check');
const schemasArg = args.find((a) => a.startsWith('--schemas='))?.split('=')[1];
// 기본: 워크스페이스 레이아웃 atelier/{hub/web, knowledge}. web → ../../knowledge.
const schemasDir = schemasArg
  ? join(root, schemasArg)
  : join(root, '..', '..', 'knowledge', '_meta', 'contract', 'schemas');
const outPath = join(root, 'src', 'lib', 'artifacts.gen.ts');

// 아티팩트 이름 → 스키마 파일. 순서는 부모 artifact_schema.py ARTIFACTS 와 동일(결정론).
const ARTIFACTS = [
  ['index', 'index.schema.json'],
  ['knowledge', 'knowledge.schema.json'],
  ['ledger', 'ledger.schema.json'],
  ['anki', 'anki.schema.json'],
  ['reads', 'reads.schema.json'],
  ['markets', 'markets.schema.json'],
];

function die(msg) {
  console.error(`✗ gen-artifacts: ${msg}`);
  process.exit(1);
}

if (!existsSync(schemasDir)) {
  const msg = `스키마 디렉터리 없음(${schemasDir})`;
  if (check) {
    console.warn(`  · gen-artifacts --check 건너뜀 — ${msg}. (부모 볼트 없는 단독 클론?)`);
    process.exit(0);
  }
  die(`${msg} — 생성 불가. 워크스페이스(atelier/knowledge)에서 실행하거나 --schemas=<dir> 지정.`);
}

const upper = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** JSON Schema(draft-07 부분집합) 노드 → zod 표현식 문자열. 스키마가 loose 하면 표현식도 loose. */
function zodExpr(node) {
  if (!node || typeof node !== 'object') return 'z.unknown()';
  if ('const' in node) return `z.literal(${JSON.stringify(node.const)})`;
  if (Array.isArray(node.enum)) {
    const allStr = node.enum.every((v) => typeof v === 'string');
    return allStr
      ? `z.enum([${node.enum.map((v) => JSON.stringify(v)).join(', ')}])`
      : `z.union([${node.enum.map((v) => `z.literal(${JSON.stringify(v)})`).join(', ')}])`;
  }
  let t = node.type;
  if (Array.isArray(t)) {
    // 널러블 유니언: ["string","null"] → z.string().nullable()
    const nonNull = t.filter((x) => x !== 'null');
    const nullable = t.includes('null');
    const inner =
      nonNull.length === 1
        ? zodExpr({ ...node, type: nonNull[0] })
        : `z.union([${nonNull.map((x) => zodExpr({ ...node, type: x })).join(', ')}])`;
    return nullable ? `${inner}.nullable()` : inner;
  }
  switch (t) {
    case 'string':
      return 'z.string()';
    case 'integer':
    case 'number':
      return 'z.number()';
    case 'boolean':
      return 'z.boolean()';
    case 'null':
      return 'z.null()';
    case 'array':
      return `z.array(${node.items ? zodExpr(node.items) : 'z.unknown()'})`;
    case 'object': {
      const props = node.properties || {};
      const keys = Object.keys(props);
      const addl = node.additionalProperties;
      const pnEnum = node.propertyNames?.enum;
      // 순수 map(속성 선언 없음): additionalProperties=스키마 또는 propertyNames 만 → z.record.
      if (keys.length === 0 && (addl === undefined || typeof addl === 'object' || pnEnum)) {
        const keyT = Array.isArray(pnEnum)
          ? `z.enum([${pnEnum.map((v) => JSON.stringify(v)).join(', ')}])`
          : 'z.string()';
        const valT = typeof addl === 'object' ? zodExpr(addl) : 'z.unknown()';
        return `z.record(${keyT}, ${valT})`;
      }
      const required = new Set(node.required || []);
      const lines = keys.map((k) => {
        let e = zodExpr(props[k]);
        if (!required.has(k)) e += '.optional()';
        return `${JSON.stringify(k)}: ${e}`;
      });
      const obj = `z.object({ ${lines.join(', ')} })`;
      // additionalProperties=false 만 strict, 그 외(기본 true·loose 계약)는 passthrough.
      return addl === false ? `${obj}.strict()` : `${obj}.passthrough()`;
    }
    default:
      return 'z.unknown()';
  }
}

// ── 스키마 로드 + 파생 사실 추출 ──────────────────────────────────────────────
const present = readdirSync(schemasDir);
const versions = {};
const zodDecls = [];
let ledgerStages = null;

for (const [name, file] of ARTIFACTS) {
  if (!present.includes(file)) die(`스키마 파일 없음: ${file}`);
  const schema = JSON.parse(readFileSync(join(schemasDir, file), 'utf-8'));
  const vConst = schema.properties?._schemaVersion?.const;
  if (typeof vConst !== 'number') die(`${file}: _schemaVersion.const(정수) 없음 — 부모 스키마 갱신 필요.`);
  versions[name] = vConst;
  if (name === 'ledger') {
    ledgerStages = schema.properties?.stage_counts?.propertyNames?.enum;
    if (!Array.isArray(ledgerStages)) die('ledger.schema.json: stage_counts.propertyNames.enum(STAGES) 없음.');
  }
  const cap = upper(name);
  zodDecls.push(
    `/** \`${file}\` 경계 shape(생성). 스키마가 관대하므로 loose 한 곳은 타입도 loose. */\n` +
      `export const ${name}ArtifactSchema = ${zodExpr(schema)};\n` +
      `export type ${cap}Artifact = z.infer<typeof ${name}ArtifactSchema>;`,
  );
}
if (!ledgerStages) die('ledger 스키마를 처리하지 못함.');

// ── 파일 조립 ────────────────────────────────────────────────────────────────
const versionLines = ARTIFACTS.map(([n]) => `  ${n}: ${versions[n]},`).join('\n');
const registryLines = ARTIFACTS.map(([n]) => `  ${n}: ${n}ArtifactSchema,`).join('\n');

const raw = `/* ============================================================
   artifacts.gen.ts — 생성물. 직접 편집 금지.
   원천: parent(pipeline) knowledge/_meta/contract/schemas/*.schema.json
   재생성: cd web && npm run codegen   (게이트: npm run codegen:check)
   생성기: scripts/gen-artifacts.mjs · P7 Bet 1 후속(repo 경계 드리프트 소멸).
============================================================ */
import { z } from 'zod';

/** 각 아티팩트가 기대하는 \`_schemaVersion\`(부모 스키마 const 파생). 불일치는 artifacts.ts 가 경고. */
export const EXPECTED_SCHEMA_VERSION = {
${versionLines}
} as const;

export type ArtifactName = keyof typeof EXPECTED_SCHEMA_VERSION;

/** 챕터 생애 5단계(ledger 스키마 stage_counts.propertyNames.enum 파생 · 챕터원장.py STAGES 와 동일 SSOT). */
export const LEDGER_STAGES = [${ledgerStages.map((s) => JSON.stringify(s)).join(', ')}] as const;
export type LedgerStage = (typeof LEDGER_STAGES)[number];

${zodDecls.join('\n\n')}

/** 이름 → 경계 zod 스키마(런타임 검증·소비처 선택 사용). */
export const ARTIFACT_SCHEMAS = {
${registryLines}
} as const;
`;

const prettierCfg = (await prettier.resolveConfig(outPath)) || {};
const formatted = await prettier.format(raw, { ...prettierCfg, parser: 'typescript' });

const existing = existsSync(outPath) ? readFileSync(outPath, 'utf-8') : null;

if (check) {
  if (existing !== formatted) {
    die('artifacts.gen.ts 가 스키마와 불일치(스테일). `cd web && npm run codegen` 후 커밋하세요.');
  }
  console.log('✓ artifacts.gen.ts 최신(스키마 정합).');
  process.exit(0);
}

if (existing === formatted) {
  console.log('· artifacts.gen.ts 변경 없음.');
} else {
  writeFileSync(outPath, formatted);
  console.log(`✓ artifacts.gen.ts 생성(${ARTIFACTS.length} 아티팩트 · STAGES ${ledgerStages.length} · 버전 ${Object.values(versions).join('/')}).`);
}
