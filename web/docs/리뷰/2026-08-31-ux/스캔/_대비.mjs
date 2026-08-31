/* 메인 검산 — 라이트 테마에서 «틴트 위의 자기 색 글자» 대비비.
   토큰 정의를 파싱해 계산한다(눈대중 금지 · 커널 §증거등급 [측정]). */
import fs from 'node:fs';
const css = fs.readFileSync('src/styles/tokens.css', 'utf8');

/** `:root[data-theme='light']` 블록만 뽑는다(없으면 전체에서 마지막 정의가 이긴다). */
function block(sel) {
  const i = css.indexOf(sel);
  if (i < 0) return '';
  const s = css.indexOf('{', i);
  let d = 0;
  for (let j = s; j < css.length; j++) {
    if (css[j] === '{') d++;
    else if (css[j] === '}' && --d === 0) return css.slice(s + 1, j);
  }
  return '';
}
const root = block(':root {');
const light = block(":root[data-theme='light']") || block(':root[data-theme="light"]');

function decls(text) {
  const m = {};
  for (const [, k, v] of text.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) m[k] = v.trim();
  return m;
}
const D = { ...decls(root), ...decls(light) };

const hex = (h) => {
  h = h.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
};
/** color-mix(in srgb, A p%, B) 를 근사 — sRGB 공간 선형 혼합(브라우저 동작과 같다). */
function resolve(v, depth = 0) {
  if (depth > 8) return null;
  v = v.trim();
  if (v.startsWith('#')) return hex(v);
  let m = v.match(/^var\(\s*(--[a-z0-9-]+)/);
  if (m) return D[m[1]] ? resolve(D[m[1]], depth + 1) : null;
  m = v.match(/^color-mix\(\s*in\s+srgb\s*,\s*(.+)\)$/i);
  if (m) {
    // 콤마 분리(중첩 괄호 고려)
    const parts = [];
    let d = 0,
      cur = '';
    for (const ch of m[1]) {
      if (ch === '(') d++;
      if (ch === ')') d--;
      if (ch === ',' && d === 0) {
        parts.push(cur);
        cur = '';
      } else cur += ch;
    }
    parts.push(cur);
    const one = (p) => {
      const mm = p.trim().match(/^(.*?)\s+([\d.]+)%$/);
      return mm ? { c: resolve(mm[1], depth + 1), p: parseFloat(mm[2]) / 100 } : { c: resolve(p, depth + 1), p: null };
    };
    const a = one(parts[0]),
      b = one(parts[1]);
    if (!a.c || !b.c) return null;
    const pa = a.p ?? (b.p != null ? 1 - b.p : 0.5);
    return [0, 1, 2].map((i) => a.c[i] * pa + b.c[i] * (1 - pa));
  }
  return null;
}
const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const L = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
/** 반투명 배경을 면 위에 얹는다. */
const over = (fg, bg) => fg.map((c, i) => c); // 이미 color-mix 로 불투명화됨
function ratio(a, b) {
  const [x, y] = [L(a), L(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const 면 = ['--panel2', '--panel', '--bg'];
const 짝 = [
  ['--warn', '--tint-warn'],
  ['--warn', '--tint-warn-soft'],
  ['--bad', '--tint-bad'],
  ['--acc', '--tint-acc'],
  ['--good', '--tint-good'],
];
console.log('라이트 테마 · 틴트 위의 자기 색 글자');
for (const [f, b] of 짝) {
  const fg = resolve(`var(${f})`);
  const bgv = D[b] ? resolve(D[b]) : null;
  if (!fg || !bgv) {
    console.log(`${f} on ${b}: 토큰 해석 실패(${D[b] ? '전경' : '배경 미정의'})`);
    continue;
  }
  const row = 면.map((s) => {
    const base = resolve(`var(${s})`);
    if (!base) return '?';
    // 틴트가 반투명이면 color-mix 가 이미 면을 품는다 — 여기선 해석된 값을 그대로 쓴다.
    return ratio(fg, bgv).toFixed(2);
  });
  console.log(`${f.padEnd(12)} on ${b.padEnd(18)} → ${row[0]}`);
}
