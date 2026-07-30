/* ── C-7 여덟 번째 이식(mastery) — Tailwind 클래스 SSOT ─────────────────────
   mastery 는 3개 컴포넌트(Mastery·KnowledgeMap·NextActions)가 한 스타일시트를 공유했다.
   그 공유를 유지하려 클래스 문자열을 여기 한 곳에 둔다(옛 `Mastery.module.css` 의 자리).
   규약은 §15 + `styles/tokenBridge.css` 머리주석이 SSOT.

   ⚠ `ds.*` 공유 클래스와 런타임 색 주입(숙달 램프·분포 세그·개념 점 = `style={{ background }}`)은
   그대로 둔다(§14-3 · 공유 디자인 시스템은 맨 뒤). 전역 요소(h2/h3·button)는 control 규율대로 `!`.
   시네마틱 패널의 oklab 그래디언트·상단 헤어라인·글로우는 tokens.css 에 이름 주고 참조(§14-3),
   마운트 페이드업은 review 가 tw.css 에 둔 `enter-rise` 키프레임을 재사용한다. */

export const M = {
  wrap: 'flex h-full min-h-0 min-w-0 flex-col gap-3 px-4 pt-4 pb-3',

  // ── 시네마틱 히어로 밴드 ──
  hero: `relative flex flex-none items-center gap-hero-gap rounded-lg border border-line bg-[image:var(--bg-hero-mastery)] px-hero-px py-4 shadow-hero animate-[enter-rise_var(--dur-slow)_var(--ease)_both] ds-hairline motion-reduce:animate-none max-wide:flex-wrap max-wide:gap-x-6 max-wide:gap-y-4`,
  heroLeft: 'flex min-w-0 flex-col gap-0.5',
  eyebrow: 'text-xs font-extrabold tracking-eyebrow text-acc uppercase',
  headTitle: 'mt-0.5! mb-0! text-hero-title! font-black! leading-[1.04] tracking-tight!', // h2 — 전역 h2{} 를 ! 로 이김
  headMeta: 'text-xs text-mut tabular-nums',
  ring: 'relative size-26 flex-none', // --ring-w/--ring-glow-r 는 인라인 style(px 임의값 금지 우회 + 런타임 skeleton 파라미터)
  ringNum:
    'absolute inset-0 flex items-center justify-center text-3xl font-black tracking-tight text-acc tabular-nums [text-shadow:var(--sig-rate-glow)]',
  ringNumSmall: 'ml-px text-md font-extrabold text-mut',
  heroDistWrap: 'flex min-w-45 flex-1 flex-col gap-2',
  distLab: 'text-2xs font-extrabold tracking-caps text-mut uppercase',
  dist: 'flex flex-col gap-2',
  msbar: 'flex h-4 overflow-hidden rounded-full bg-panel2 ring-1 ring-line-soft ring-inset',
  msbarSeg: 'h-full transition-[width] duration-draw ease-[var(--ease)] motion-reduce:transition-none',
  distLegend: 'flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-mut',
  distLegendB: 'text-txt tabular-nums',
  dot: 'mr-1 inline-block size-2.5 rounded-full align-middle',
  heroAction: 'flex flex-none flex-col items-end gap-2 max-wide:items-start',

  // ── 본문 2컬럼 ──
  cols: 'grid min-h-0 flex-1 grid-cols-mastery gap-3 max-wide:grid-cols-1 max-wide:overflow-y-auto',
  mapCol: `relative min-h-0 min-w-0 rounded-lg border border-line bg-[image:var(--bg-map-mastery)] shadow-card animate-[enter-rise_var(--dur-slow)_var(--ease)_var(--stagger)_both] ds-hairline motion-reduce:animate-none max-wide:min-h-90`,
  mapScroll: 'h-full overflow-y-auto px-5 pt-4 pb-5 [scrollbar-width:thin]',
  actionCol: 'min-h-0 min-w-0 overflow-y-auto pr-0.5 [scrollbar-width:thin]',

  // ── 지식맵 ──
  mapHead: 'mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1.5',
  mapTitle: 'text-xs font-extrabold tracking-caps text-mut uppercase',
  mapMeta: 'text-xs text-mut',
  note: 'mb-3 rounded-md border border-line-warn bg-panel-warn-faint px-3 py-2 text-xs leading-snug text-warn',
  mssub: 'mb-4',
  subHead: 'mb-1 flex items-center gap-2',
  subNm: 'flex-1 truncate text-md font-bold text-txt',
  msheat: 'flex flex-wrap gap-1',
  mscell:
    'size-3.5 cursor-default rounded-xs transition-transform hover:z-[1] hover:scale-[1.55] hover:outline-1 hover:outline-txt',
  heatMore: 'h-3.5 self-center rounded-xs! px-1.5! py-0! text-2xs! font-bold! leading-none text-mut! tabular-nums',
  mapFoot: 'mt-1 text-xs text-mut',

  // ── 다음 행동(개념 리스트) ──
  mslist: 'mt-1 flex flex-col gap-0.5',
  msMore: 'mt-2 px-3! py-1! text-sm! font-semibold! text-mut!',
  msrow:
    "group relative flex items-center gap-2 overflow-hidden rounded-sm py-1.5 pr-2 pl-3 transition-[background] before:absolute before:top-1.5 before:bottom-1.5 before:left-0 before:w-0.5 before:scale-y-0 before:rounded-xs before:bg-acc before:shadow-dot before:transition-transform before:content-[''] hover:bg-panel2 hover:before:scale-y-100",
  nm: 'flex-1 truncate text-concept-nm',
  msdot:
    'inline-flex size-4.5 flex-none items-center justify-center rounded-full border border-line bg-panel2 text-msdot text-txt',
  seqbadge:
    'flex-none rounded-sm border border-line bg-panel2 px-1.5 py-0.5 text-msdot leading-none whitespace-nowrap text-mut',
  role: 'border-line-acc-strong! bg-panel-acc-faint! text-acc-on-txt!',
  deferred: 'opacity-55 hover:opacity-85',
  deep: 'inline-flex size-5.5 flex-none items-center justify-center p-0! text-xs! leading-none text-mut! opacity-50 transition-[opacity] group-hover:opacity-85 hover:opacity-100',
  rcLink:
    'm-0! cursor-pointer border-0! bg-transparent! p-0! text-left whitespace-nowrap text-bad! transition-[opacity] hover:underline hover:opacity-80',

  // ── 폴백 패널(셋업·로딩·에러) ──
  offWrap: `relative flex min-h-0 flex-1 overflow-y-auto rounded-lg border border-line bg-[image:var(--bg-map-mastery)] p-5 shadow-card animate-[enter-rise_var(--dur-slow)_var(--ease)_var(--stagger)_both] ds-hairline motion-reduce:animate-none [scrollbar-width:thin]`,
  offChild: 'm-auto max-w-off', // 옛 `.offWrap > *` — 자식에 직접 준다(규약 4)
  stateBody: 'px-1.5 py-2',
  stateH3: 'mt-0! mb-2! text-base! font-extrabold! tracking-tight!', // h3 — 전역 h3{} 를 ! 로 이김
  errBody: 'flex flex-col items-center gap-2 px-1.5 py-2 text-center',
  errH3: 'm-0! text-base! font-extrabold! tracking-tight!',
  errGlyph: 'text-3xl leading-none text-bad opacity-85',
} as const;
