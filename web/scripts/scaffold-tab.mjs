#!/usr/bin/env node
/* ============================================================
   scaffold-tab.mjs — 새 탭 보일러플레이트를 아키텍처 규약대로 결정적으로 생성.
   ① shell/tabs.ts TABS 등록  ② features/registry.tsx LOADERS 등록
   ③ features/<key>/<Key>.tsx (Tailwind — C-7 이후 *.module.css 는 0개)  ④ test/<key>.test.tsx 스텁
   사용: cd web && node scripts/scaffold-tab.mjs <key> [label] [--section=plan] [--role=destination] [--icon=file] [--dry]

   ⚠⚠ **그리고 26일간 첫 줄에서 죽어 있었다**(V099 · 2026-09-02 실측 `--dry` → exit 1). 아래 H-8 문단이
   «정본에서 읽는다»고 한 그 앵커(`GROUP_LABELS`)가 N-14(2026-08-07 · `ee92b81`)에서 `TabMeta.group` 과 함께
   **삭제**됐는데 생성기는 그대로였다 — 「생성기가 계약을 안 따라간 형태」를 고쳤다고 적은 자리에서 같은
   형태가 재발했다. 묶음의 정본은 이제 `RAIL_SECTIONS`(섹션의 `tabs` 배열)이고, `destination`·`lens` 는
   **어느 섹션엔가 적혀야** 불변식 ③이 초록이다 — 그래서 이 스크립트가 그 배열에도 한 줄을 넣는다.
   본 기능 구현·레이아웃은 하지 않는다(스텁만). 이후 protocols/새탭추가.md의 나머지 단계를 사람이 진행.

   ⚠⚠ **이 스크립트는 컴파일 안 되는 탭을 만들고 있었다**(H-8 · 2026-08-06 감사). N-6 이 `surface`
   축을 해체하고 D-4 가 `hidden` 을 **필수** `role` 로 바꿨는데, 스캐폴딩은 계속 `surface:` 를 쓰고
   `role` 을 빼고 있었다 — 즉 `/새탭` 을 실행하면 **타입 오류 둘로 시작**하고, 없어진 `collect`
   그룹도 통과시켰다. 코드가 계약을 바꿀 때 **그 계약의 생성기**가 같이 안 움직인 형태다.
   → 이제 세 축(`group`·`role`·`icon`) 전부를 **정본 파일에서 읽어** 검증한다. 손으로 적은 목록을
     두면 같은 드리프트가 다시 시작된다.
============================================================ */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..'); // web/
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const opt = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : def;
};
const positional = args.filter((a) => !a.startsWith('--'));
const USAGE =
  '사용: node scripts/scaffold-tab.mjs <key: camelCase> [label] [--section=plan] [--role=destination] [--icon=file] [--dry]';
const key = positional[0];
if (!key || !/^[a-z][a-zA-Z0-9]*$/.test(key)) {
  console.error(USAGE);
  process.exit(1);
}
const label = positional[1] || key;

/* ── 세 축을 **정본에서 읽는다**(손목록 금지 · H-8) ─────────────────────────────
   묶음은 `RAIL_SECTIONS` 의 섹션 키다(N-14 이후 · 옛 `GROUP_LABELS`·`TabMeta.group` 은 없다).
   `role` 은 `TabRole` 유니온에서 읽는다. `IconName` 은 `lib/iconPaths.ts` 의 키 유니온이고, 오타는
   종전에 **아이콘 없는 탭**으로 조용히 렌더됐다(H22 — 그래서 tabs.ts 가 타입을 좁혔다). 생성기도
   같은 검사를 해야 한다. */
const 정본 = (rel) => readFileSync(join(root, rel), 'utf8');
/** 정본 파일에서 한 덩어리를 잘라 `re키` 로 키를 뽑는다. 못 찾으면 **빈 배열이 아니라 실패**다 —
 *  조용히 통과하면 이 스크립트가 다시 "검증하는 척"이 된다(그게 H-8 의 형태였다). */
const 키뽑기 = (rel, re, re키 = /^\s{2}([a-zA-Z0-9]+):/gm) => {
  const blk = 정본(rel).match(re);
  if (!blk) {
    console.error(`❌ ${rel} 에서 정본 목록을 못 찾았다 — 그 파일이 바뀌었다면 이 스크립트의 앵커를 고칠 것.`);
    process.exit(1);
  }
  const keys = [...blk[1].matchAll(re키)].map((m) => m[1]);
  if (!keys.length) {
    console.error(`❌ ${rel} 의 정본 덩어리는 찾았는데 키가 0개다 — 키 정규식이 낡았다.`);
    process.exit(1);
  }
  return keys;
};
const SECTION_KEYS = 키뽑기(
  'src/shell/tabs.ts',
  /export const RAIL_SECTIONS: RailSection\[\] = \[([\s\S]*?)\n\];/,
  /\{\s*key:\s*'([a-z]+)'/g,
);
const ROLE_KEYS = 키뽑기('src/shell/tabs.ts', /export type TabRole = ([^;]+);/, /'([a-z]+)'/g);
const ICON_KEYS = 키뽑기('src/lib/iconPaths.ts', /ICON_PATHS = \{([\s\S]*?)\n\} as const/);

// `--group` 은 옛 이름 — 받아 주되 뜻은 섹션이다(문서·명령이 그 이름으로 남아 있을 수 있다).
const section = opt('section', opt('group', 'plan'));
if (!SECTION_KEYS.includes(section)) {
  console.error(`❌ 잘못된 section: ${section} (${SECTION_KEYS.join('|')} — tabs.ts RAIL_SECTIONS 가 정본)`);
  process.exit(1);
}
/* `role` 은 tabs.ts 에서 **필수 필드**다(D-4) — 기본값을 주면 새 탭이 자기도 모르게 한쪽에
   들어가고, 그 순간 "갈 수 있는 곳"의 다섯 열거가 다시 갈리기 시작한다.

   ⚠⚠ **기본이 `lens` 인 것은 겁이 아니라 실측이다**(2026-08-06). `destination` 으로 스캐폴딩해 보니
   typecheck 는 통과하는데 **불변식 셋이 즉시 깨졌다**: ③-b `seq` 고유성(첫 글자 충돌) · ③-c
   `primary` 앵커 · ③ 시그니처 표면. 셋 다 *본 구현*이 채우는 것이라 스텁이 만들 수 없다.
   즉 destination 기본값은 "게이트를 빨갛게 만든 채 시작한다"를 뜻했다 — 그건 H-8 이 고치려는
   바로 그 형태(생성기가 규약을 모른다)의 다른 판이다. lens 는 그 셋의 적용 대상이 아니라
   **녹색으로 시작**하고, 승격은 아래 체크리스트를 보고 사람이 한다. `view`(호스트 안 뷰 · `to` 필요)·
   `object`(명사 주소 · `route` 필요)는 스텁이 그 주소를 지어낼 수 없어 받지 않는다 — 손으로 붙인다. */
const role = opt('role', 'lens');
if (!ROLE_KEYS.includes(role)) {
  console.error(`❌ 없는 role: ${role} (${ROLE_KEYS.join('|')} — tabs.ts TabRole 이 정본)`);
  process.exit(1);
}
if (role !== 'destination' && role !== 'lens') {
  console.error(
    `❌ role=${role} 은 스캐폴딩 대상이 아니다(destination|lens) — 'view' 는 to, 'object' 는 route 를 손으로 붙인다.`,
  );
  process.exit(1);
}
const icon = opt('icon', 'file');
if (ICON_KEYS.length && !ICON_KEYS.includes(icon)) {
  console.error(`❌ 없는 icon: ${icon} — lib/iconPaths.ts 의 ICON_PATHS 키여야 한다(${ICON_KEYS.length}종).`);
  console.error(`   예: ${ICON_KEYS.slice(0, 12).join(' · ')} …`);
  process.exit(1);
}
const Comp = key[0].toUpperCase() + key.slice(1);

const changes = []; // {path, action, apply()}

// ── ① tabs.ts ────────────────────────────────────────────
const tabsPath = join(root, 'src/shell/tabs.ts');
let tabs = readFileSync(tabsPath, 'utf8');
if (new RegExp(`key:\\s*['"]${key}['"]`).test(tabs)) {
  console.error(`❌ 이미 존재하는 탭 key: ${key} (tabs.ts)`);
  process.exit(1);
}
const orders = [...tabs.matchAll(/order:\s*(\d+)/g)].map((m) => Number(m[1]));
const order = (orders.length ? Math.max(...orders) : 0) + 10;
const tabsAnchor = 'export const TABS: TabMeta[] = [';
if (!tabs.includes(tabsAnchor)) {
  console.error('❌ tabs.ts 앵커를 못 찾음 — 수동 등록 필요.');
  process.exit(1);
}
const tabLine = `  { key: '${key}', label: '${label}', order: ${order}, role: '${role}', icon: '${icon}' },`;
/* 섹션의 `tabs` 배열 끝에 key 를 붙인다 — `destination`·`lens` 는 어느 섹션엔가 적혀야 불변식 ③이
   초록이다(안 적으면 레일 맨 끝 「섹션 미지정」으로 밀려나 조용히 이름을 잃는다). */
const sectionRe = new RegExp(`(\\{\\s*key:\\s*'${section}',[^\\]]*?tabs:\\s*\\[)([^\\]]*)(\\])`);
const sectionHit = tabs.match(sectionRe);
if (!sectionHit) {
  console.error(`❌ tabs.ts 의 RAIL_SECTIONS 에서 섹션 '${section}' 의 tabs 배열을 못 찾음 — 앵커를 고칠 것.`);
  process.exit(1);
}
/* 불변식 ㉜ — 한 축의 줄 수 상한(레일이 화면 수와 함께 자라지 않는다). 상한은 그 테스트가 정본이라 거기서
   읽는다(손으로 6 이라 적으면 낡는다). 실측(2026-09-02 프로브): 여섯 줄인 `know` 에 넣자 게이트가 즉시 빨갰다 —
   생성기가 그걸 미리 말해야 «상한을 올리는» 오답 대신 «호스트로 접거나 축을 쪼개는» 정답으로 간다. */
const 상한 = 정본('test/invariants.test.ts').match(
  /한 축이 여섯 줄을 넘지 않는다[\s\S]*?toBeLessThanOrEqual\((\d+)\)/,
)?.[1];
if (!상한) {
  console.error(
    '❌ test/invariants.test.ts 에서 불변식 ㉜의 상한을 못 읽었다 — 케이스 제목이 바뀌었으면 이 앵커를 고칠 것.',
  );
  process.exit(1);
}
const 현재줄 = (sectionHit[2].match(/'[^']+'/g) ?? []).length;
if (현재줄 >= Number(상한)) {
  console.error(
    `❌ 섹션 '${section}' 은 이미 ${현재줄}줄이다(상한 ${상한} · 불변식 ㉜) — 상한을 올리지 말고 호스트 안 role:'view' 로 접거나 축을 쪼개라(=새 질문). 다른 섹션이면 --section=<${SECTION_KEYS.join('|')}>.`,
  );
  process.exit(1);
}
changes.push({
  path: 'src/shell/tabs.ts',
  action: `TABS 등록 + 섹션 '${section}' (order ${order} · role ${role})`,
  apply: () =>
    writeFileSync(
      tabsPath,
      tabs
        .replace(tabsAnchor, `${tabsAnchor}\n${tabLine}`)
        .replace(sectionRe, (_, a, body, c) => `${a}${body.trim() ? `${body}, '${key}'` : `'${key}'`}${c}`),
    ),
});

// ── ② registry.tsx ───────────────────────────────────────
const regPath = join(root, 'src/features/registry.tsx');
let reg = readFileSync(regPath, 'utf8');
const regAnchor = 'ComponentType }>> = {';
if (!reg.includes(regAnchor)) {
  console.error('❌ registry.tsx 앵커를 못 찾음 — 수동 등록 필요.');
  process.exit(1);
}
const regLine = `  ${key}: () => import('./${key}/${Comp}'),`;
changes.push({
  path: 'src/features/registry.tsx',
  action: 'LOADERS에 등록',
  apply: () => writeFileSync(regPath, reg.replace(regAnchor, `${regAnchor}\n${regLine}`)),
});

// ── ③ feature 파일 ───────────────────────────────────────
const featDir = join(root, 'src/features', key);
const tsxPath = join(featDir, `${Comp}.tsx`);
/* ⚠ C-7 이후 스타일은 **Tailwind 유틸리티 + 공유 `ds-*`(styles/ds.css)** 뿐이다 — `*.module.css` 는
   0개다. 스텁도 그 규약으로 낸다(생 CSS 파일·`import styles` 없음). 토큰 색은 tokenBridge 유틸
   (`text-txt`·`text-mut`·`text-acc` 등)로 쓴다. 임의값(`w-[137px]`)은 금지(no-restricted-classes). */
const tsx = `/* ${label} 탭 — 스캐폴딩 스텁. protocols/새탭추가.md 사상으로 본 구현을 채운다.
   레이어 규약: store(useApp/queries)·lib 순수함수만 소비. app/다른 feature import 금지.
   스타일: Tailwind 유틸리티 + 공유 ds-*(styles/ds.css). *.module.css 신설 금지(C-7). */
export default function ${Comp}() {
  return (
    <section className="flex flex-col gap-4 p-4">
      <h1 className="text-xl font-bold text-txt">${label}</h1>
    </section>
  );
}
`;
changes.push({
  path: `src/features/${key}/${Comp}.tsx`,
  action: existsSync(tsxPath) ? '이미 있음(건너뜀)' : '생성',
  apply: () => {
    if (!existsSync(featDir)) mkdirSync(featDir, { recursive: true });
    if (!existsSync(tsxPath)) writeFileSync(tsxPath, tsx);
  },
});

// ── ④ 테스트 스텁 ────────────────────────────────────────
const testPath = join(root, 'test', `${key}.test.tsx`);
/* ⚠ `// @vitest-environment jsdom` 이 첫 줄이어야 한다(V099 · 2026-09-02 실측 — 없으면 `document is not defined`
   로 스텁이 첫 실행에서 죽는다). 이 저장소의 vitest 기본 환경은 node 이고 렌더 테스트는 파일 단위로 켠다. */
const test = `// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import ${Comp} from '@/features/${key}/${Comp}';

describe('${Comp}', () => {
  it('렌더된다', () => {
    render(<${Comp} />);
    expect(screen.getByText('${label}')).toBeInTheDocument();
  });
});
`;
changes.push({
  path: `test/${key}.test.tsx`,
  action: existsSync(testPath) ? '이미 있음(건너뜀)' : '생성',
  apply: () => {
    if (!existsSync(testPath)) writeFileSync(testPath, test);
  },
});

// ── 실행/출력 ────────────────────────────────────────────
console.log(`=== SCAFFOLD TAB: ${key} (${label}) ===`);
for (const c of changes) console.log(`  ${dry ? '[dry] ' : ''}${c.action.padEnd(18)} ${c.path}`);
if (dry) {
  console.log('\n(dry-run — 파일 미변경. 실제 적용은 --dry 없이 재실행)');
  process.exit(0);
}
for (const c of changes) c.apply();
console.log('\n✅ 스캐폴딩 완료. 다음: protocols/새탭추가.md 4~6단계(본 구현·스타일·e2e·게이트).');
/* 실측(2026-09-02 프로브): 스텁 그대로 두면 `V077`(도달 가능한 탭은 검증망이 한 번은 연다)이 즉시 빨개진다 —
   이 스크립트는 그 줄을 **일부러** 안 만든다(`ready` 셀렉터는 본 구현이 정한다). 안 적으면 다음 사람이
   «게이트가 왜 빨갛지»부터 시작한다. */
console.log(
  `⚠ 검증망 로스터는 손으로: e2e/_fixtures.ts 의 TABS(또는 A11Y_EXTRA)에 '${key}' 항목 — 없으면 V077 이 빨갛다.`,
);
console.log(`   아이콘 정본은 lib/iconPaths.ts 의 ICON_PATHS 다(현재 ${ICON_KEYS.length}종 · 없으면 거기 추가).`);
console.log(`   role='${role}' — destination 은 레일·[ ]링·g키에 서고, lens 는 세그먼트·⌘K·딥링크로만 간다.`);
if (role === 'destination') {
  /* 실측으로 확인된 세 의무(위 role 주석) — 안 적으면 `npm run verify` 가 이유 셋을 한꺼번에 던진다. */
  console.log('\n⚠ destination 은 **불변식 셋을 더 채워야** 게이트가 녹색이 된다(스텁이 못 채운다):');
  console.log(`   ① seq 고유성 — g키 첫 글자가 이미 쓰였으면 shell/shortcuts.ts 의 SEQ_OVERRIDE 에 명시(③-b)`);
  console.log(`   ② primary 앵커 — usePageChromeEffect(() => ({ readouts, primary: {...} }))(③-c)`);
  console.log(`   ③ 시그니처 표면 — ds-frame 또는 --bg-sig-*/--bg-hero- 베이크 면(원칙 ③)`);
  console.log('   셋 다 면제 표가 있다(test/invariants.test.ts) — 사유 없이 넣지 말 것.');
}
