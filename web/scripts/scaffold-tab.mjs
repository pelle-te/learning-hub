#!/usr/bin/env node
/* ============================================================
   scaffold-tab.mjs — 새 탭 보일러플레이트를 아키텍처 규약대로 결정적으로 생성.
   ① shell/tabs.ts TABS 등록  ② features/registry.tsx LOADERS 등록
   ③ features/<key>/<Key>.tsx (Tailwind — C-7 이후 *.module.css 는 0개)  ④ test/<key>.test.tsx 스텁
   사용: cd web && node scripts/scaffold-tab.mjs <key> [label] [--group=plan] [--surface=study] [--icon=file] [--dry]
   본 기능 구현·레이아웃은 하지 않는다(스텁만). 이후 protocols/새탭추가.md의 나머지 단계를 사람이 진행.
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
const key = positional[0];
if (!key || !/^[a-z][a-zA-Z0-9]*$/.test(key)) {
  console.error(
    '사용: node scripts/scaffold-tab.mjs <key: camelCase> [label] [--group=plan] [--surface=study] [--icon=file] [--dry]',
  );
  process.exit(1);
}
const label = positional[1] || key;
// group → 기본 surface (tabs.ts GROUP_LABELS·불변식 ③과 정합 — 감사 #24: 옛 do/src/log 택소노미로
// 생성된 탭이 invariants.test를 즉시 깨던 것). settings 그룹만 전역(surface 미지정).
const GROUP_SURFACE = { plan: 'study', train: 'study', collect: 'materials', discover: 'materials', settings: null };
const group = opt('group', 'plan'); // plan | train | collect | discover | settings
if (!(group in GROUP_SURFACE)) {
  console.error(`❌ 잘못된 group: ${group} (plan|train|collect|discover|settings — tabs.ts GROUP_LABELS)`);
  process.exit(1);
}
const surface = group === 'settings' ? null : opt('surface', GROUP_SURFACE[group]); // study | materials
if (surface !== null && surface !== 'study' && surface !== 'materials') {
  console.error(`❌ 잘못된 surface: ${surface} (study|materials — settings 그룹만 생략)`);
  process.exit(1);
}
const icon = opt('icon', 'file');
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
const tabLine = `  { key: '${key}', label: '${label}', group: '${group}',${surface ? ` surface: '${surface}',` : ''} order: ${order}, icon: '${icon}' },`;
changes.push({
  path: 'src/shell/tabs.ts',
  action: `TABS에 등록 (order ${order})`,
  apply: () => writeFileSync(tabsPath, tabs.replace(tabsAnchor, `${tabsAnchor}\n${tabLine}`)),
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
const test = `import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
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
console.log('   아이콘이 없으면 shell/icons.tsx에 추가 필요.');
