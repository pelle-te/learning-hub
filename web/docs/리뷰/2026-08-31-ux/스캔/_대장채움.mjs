/* 읽음 대장 채우기 — 하위축 넷의 「읽은 파일」 + 메인 직독을 합쳐 상태 열을 세운다.
   ⚠ 손으로 표를 베끼지 않는다(이 저장소의 1급 규율). 목록은 아래 상수가 정본이고,
   대장의 행은 파일 시스템에서 나온다 — 둘이 어긋나면 `[미열람]` 으로 남는다. */
import fs from 'node:fs';
import path from 'node:path';

const R = 'docs/리뷰/2026-08-31-ux';
const 읽음 = JSON.parse(fs.readFileSync(R + '/스캔/읽음.json', 'utf8'));

const files = [];
for (const root of ['src/app', 'src/components', 'src/features', 'src/shell', 'src/styles', 'src/phone', 'src/hooks']) {
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name).split(path.sep).join('/');
      if (e.isDirectory()) walk(p);
      else files.push(p);
    }
  })(root);
}
for (const f of fs.readdirSync('e2e')) if (f.endsWith('.ts')) files.push('e2e/' + f);

const 역할 = (p) => {
  if (p.startsWith('src/app/')) return '셸 크롬';
  if (p.startsWith('src/features/')) return '화면 · ' + p.split('/')[2];
  if (p.startsWith('src/components/')) return '프리미티브';
  if (p.startsWith('src/shell/')) return '탭·팔레트·단축키';
  if (p.startsWith('src/styles/')) return '시각 언어 정의';
  if (p.startsWith('src/phone/')) return '폰 웹앱';
  if (p.startsWith('src/hooks/')) return '공유 훅';
  return '검증망';
};
const 표시 = (p) => {
  const hits = Object.entries(읽음)
    .filter(([, list]) => list.some((q) => p.endsWith(q) || q.endsWith(p)))
    .map(([k]) => k);
  return hits.length ? hits.join('·') : '[미열람]';
};

const rows = files.sort().map((p) => {
  const n = fs.readFileSync(p, 'utf8').split('\n').length;
  return `| \`${p}\` | ${n} | ${역할(p)} | ${표시(p)} |`;
});
const 미열람 = rows.filter((r) => r.includes('[미열람]')).length;
const head = `# 읽음 대장 — 2026-08-31 · ux 축

> 범위: **ux 표면 전량**(화면·크롬·프리미티브·시각언어 정의·폰·검증망).
> \`lib/\`·\`store/\`·\`src-tauri/\`·\`server/\` 는 이 축의 대상이 아니다 — 단 판정에 필요한 곳은
> 열었고 그 사실은 리포트 §커버리지에 적었다.
>
> 상태 열: \`M\`=메인 직독 · \`A1\`=흐름 · \`A2\`=상태 · \`A3\`=시각언어 · \`A4\`=a11y · \`[미열람]\`.
> **총 ${rows.length}파일 중 \`[미열람]\` ${미열람}.**
> ⚠ 이 표는 손으로 적지 않았다 — \`스캔/_대장채움.mjs\` 가 파일 시스템과 각 하위축의 보고를
> 대조해 만든다. 목록이 어긋나면 조용히 채워지지 않고 \`[미열람]\` 으로 남는다.

| 경로 | 줄 | 역할 | 읽음 |
| --- | --- | --- | --- |`;
fs.writeFileSync(R + '/대장.md', head + '\n' + rows.join('\n') + '\n');
console.log('행', rows.length, '· 미열람', 미열람);
