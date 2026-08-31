import fs from 'node:fs';
import path from 'node:path';
const D = 'docs/리뷰/2026-08-31-ux/스캔';
const read = (p) => fs.readFileSync(p, 'utf8');
const decl = [...new Set(read(D + '/_decl.txt').trim().split(/\r?\n/))];
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(tsx?|css)$/.test(e.name)) files.push(p);
  }
})('src');
const defs = new Set(['src/styles/tokens.css', 'src/styles/tokenBridge.css']);
let text = '';
for (const f of files) {
  const norm = f.split(path.sep).join('/');
  const t = read(f);
  // 정의 파일에서는 «선언 줄» 만 지운다(그 파일 안의 var() 참조는 사용으로 센다)
  text += defs.has(norm) ? t.replace(/^[ \t]*--[a-z0-9-]+[ \t]*:/gm, '') : t;
}
const flat = text.replace(/var\(\s+/g, 'var(');
const NS = {
  '--color-': ['bg', 'text', 'border', 'from', 'via', 'to', 'ring', 'fill', 'stroke', 'shadow', 'decoration', 'outline', 'accent', 'caret', 'divide', 'placeholder'],
  '--fs-': ['text'],
  '--text-': ['text'],
  '--radius-': ['rounded'],
  '--transition-duration-': ['duration'],
  '--ease-': ['ease'],
  '--min-height-': ['min-h'],
  '--max-width-': ['max-w'],
  '--font-weight-': ['font'],
  '--leading-': ['leading'],
  '--tracking-': ['tracking'],
  '--z-': ['z'],
  '--blur-': ['blur', 'backdrop-blur'],
  '--animate-': ['animate'],
  '--shadow-': ['shadow'],
  '--container-': ['max-w', 'w', 'min-w'],
  '--grid-template-columns-': ['grid-cols'],
  '--width-': ['w', 'max-w', 'min-w'],
  '--breakpoint-': [],
  '--brightness-': ['brightness'],
  '--spacing-': ['p', 'px', 'py', 'pt', 'pb', 'pl', 'pr', 'm', 'mx', 'my', 'mt', 'mb', 'ml', 'mr', 'gap', 'w', 'h', 'size', 'inset', 'top', 'left', 'right', 'bottom'],
};
const WORD = /[a-z0-9-]/;
function usedRaw(name) {
  if (flat.includes('var(' + name)) return true;
  let i = -1;
  while ((i = flat.indexOf(name, i + 1)) !== -1) {
    const before = flat[i - 1] ?? ' ';
    const after = flat.slice(i + name.length);
    if (WORD.test(before)) continue; // --acc 가 --accent 의 접두인 경우 등
    if (WORD.test(after[0] ?? ' ')) continue;
    if (/^\s*:/.test(after)) continue; // 선언 줄
    return true;
  }
  return false;
}
function usedUtil(name) {
  for (const [pre, utils] of Object.entries(NS)) {
    if (!name.startsWith(pre)) continue;
    const bare = name.slice(pre.length);
    for (const u of utils) {
      const needle = u + '-' + bare;
      let i = -1;
      while ((i = flat.indexOf(needle, i + 1)) !== -1) {
        const before = flat[i - 1] ?? ' ';
        const after = flat[i + needle.length] ?? ' ';
        if (WORD.test(before) && before !== '-') continue;
        if (WORD.test(after)) continue;
        return true;
      }
    }
  }
  return false;
}
const dead = decl.filter((d) => !usedRaw(d) && !usedUtil(d));
fs.writeFileSync(D + '/죽은토큰.txt', dead.join('\n') + '\n');
console.log('선언', decl.length, '· 어느 경로로도 참조 0:', dead.length);
console.log(dead.join('\n'));
