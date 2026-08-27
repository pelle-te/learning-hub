/* 폰트 두 페이스 생성 — `fonts-src/PretendardVariable.woff2` → `public/fonts/*.woff2` (P029 · 2026-08-27).

   ⚠⚠ **왜 가르나.** 원본은 2,009 KB 이고 그중 **한글 음절(U+AC00-D7A3) 11,172자가 1,697 KB**다.
   `vite.config.ts` 의 workbox 설정이 이미 «첫 방문이 셀룰러일 수 있는데 껍데기 하나 받자고 2MB 를
   선불하는 것은 값이 안 맞는다»고 판단해 폰트를 precache 에서 뺐는데, `phone.html` 은 같은 2MB 를
   `<link rel=preload>` 로 **최우선 대역에 선불하고 있었다** — 한쪽만 고쳐진 짝이었다.
   가른 뒤 폰은 **base 만 preload** 한다: 첫 화면의 라틴·숫자·기호가 즉시 맞는 폰트로 뜨고,
   한글은 `font-display: swap` 이 시스템 폴백으로 그리다 도착하면 바꾼다.

   ⭐ **경계는 「한글 음절이냐 아니냐」 하나다 — 이것이 계약이다.**
   리포트의 처방은 base 를 «라틴 + 구두점 + 자모» 로 좁혔는데, 그러면 **앱이 실제로 렌더하는 글자
   50종이 빠진다**(→ ↑ ↓ ≤ ≥ − ✓ ⌘ ① ▸ ● ○ …). 실측으로 확인했고(`docs/판례.md` 2026-08-27),
   그 형태였으면 화살표·체크·기호가 전부 시스템 폰트로 떨어져 UI 전역에 시각 불일치가 났다.
   **글자를 세어 넣는 목록은 반드시 낡는다** — 그래서 여기 목록이 없고, 여집합만 있다.

   ⚠ 원본을 `public/` 이 아니라 `fonts-src/` 에 두는 이유: `public/` 은 빌드 입력이라 거기 두면
   2MB 가 **데스크톱 번들에도 폰 dist 에도** 그대로 실린다(`release-assets/` 와 같은 사유).

   실행: `npm run font:subset` · 산출물은 **커밋한다**(빌드가 파이썬에 의존하지 않게).
   선행: fontTools + brotli. 이 머신에선 시스템 파이썬에 있다(venv 가 아니다 — `CLAUDE.md`). */
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(web, 'fonts-src/PretendardVariable.woff2');
const OUT = join(web, 'public/fonts');
const PY = process.env.FONT_PYTHON ?? 'C:/Users/a1g2a/AppData/Local/Programs/Python/Python314/python.exe';
const HANGUL = 'U+AC00-D7A3';

/* base 의 유니코드 목록은 **원본 cmap 에서 뽑는다**(손으로 적은 범위가 아니라). 그래야
   업스트림이 글자를 더하면 자동으로 따라오고, 「빠뜨린 블록」이라는 실패가 불가능해진다. */
const restRanges = execFileSync(
  PY,
  [
    '-c',
    `import sys
from fontTools.ttLib import TTFont
f = TTFont(sys.argv[1]); cps=set()
for t in f['cmap'].tables: cps |= set(t.cmap.keys())
rest = sorted(c for c in cps if not (0xAC00 <= c <= 0xD7A3))
seg=[]
for c in rest:
    if seg and c == seg[-1][1]+1: seg[-1][1]=c
    else: seg.append([c,c])
sys.stdout.write(','.join(f'U+{a:04X}' if a==b else f'U+{a:04X}-{b:04X}' for a,b in seg))`,
    SRC,
  ],
  { encoding: 'utf8' },
);

const subset = (unicodes, out) =>
  execFileSync(PY, ['-m', 'fontTools.subset', SRC, '--flavor=woff2', '--layout-features=*', `--unicodes=${unicodes}`, `--output-file=${out}`], {
    stdio: 'inherit',
  });

subset(restRanges, join(OUT, 'Pretendard-base.woff2'));
subset(HANGUL, join(OUT, 'Pretendard-hangul.woff2'));

/* ⭐ 생성 직후 **글리프 손실 0** 을 단언한다 — 이 스크립트의 실패 모드가 «조용히 글자를 잃는 것»
   하나뿐이라, 그것을 재지 않으면 스크립트가 스스로를 검증하지 않는 것이 된다. */
const cover = execFileSync(
  PY,
  [
    '-c',
    `import sys
from fontTools.ttLib import TTFont
def cm(p):
    f=TTFont(p); s=set()
    for t in f['cmap'].tables: s |= set(t.cmap.keys())
    return s
o, a, b = cm(sys.argv[1]), cm(sys.argv[2]), cm(sys.argv[3])
lost, dup = len(o - (a|b)), len(a & b)
print(f'{len(o)} {len(a)} {len(b)} {lost} {dup}')`,
    SRC,
    join(OUT, 'Pretendard-base.woff2'),
    join(OUT, 'Pretendard-hangul.woff2'),
  ],
  { encoding: 'utf8' },
).trim();
const [total, base, han, lost, dup] = cover.split(' ').map(Number);
const kb = (p) => `${(statSync(p).size / 1024).toFixed(1)} KB`;
console.log(
  `[font] base ${base}자 ${kb(join(OUT, 'Pretendard-base.woff2'))} · hangul ${han}자 ${kb(join(OUT, 'Pretendard-hangul.woff2'))} · 원본 ${total}자 ${kb(SRC)}`,
);
if (lost || dup) {
  console.error(`[font] 손실 ${lost}자 · 겹침 ${dup}자 — 두 페이스가 원본을 덮지 못한다.`);
  process.exit(1);
}
console.log('[font] 글리프 손실 0 · 겹침 0');