/* ============================================================
   today/signatureParts — `TodaySignature` 와 `BeyondStrip` 이 **함께 쓰는** 조각들.

   ⚠ 파일을 판 이유는 순환 import 를 피하기 위해서다. W7 이 '오늘 밖' 스트립을 `BeyondStrip`
   으로 뺐는데(래칫 둘이 그것을 요구했다) 그 조립부가 `S`(클래스 맵)·`AnkiTag`·`tone` 을 쓴다 —
   본체에서 import 하면 두 모듈이 서로를 부르고, 그건 동작하더라도 다음 사람이 읽을 수 없는
   형태다. 공유물은 **아래 층**에 둔다.
   ⚠ 여기 있는 것은 *공유되는 것만*이다 — 본체 전용 조각을 여기로 옮기지 말 것(그 순간 이
   파일이 "today 의 잡동사니"가 된다).
============================================================ */

export const S = {
  today: 'flex h-full min-w-0 min-h-0 flex-col gap-4 px-5 pt-4.5 pb-3.5 max-wide:px-3.5 max-wide:pt-3.5',
  top: 'grid min-h-0 flex-auto grid-cols-today-top gap-4 max-wide:grid-cols-1',
  /* Q-14 — 노치 HUD 통일. 뗀 것: `rounded-lg`·`border border-line`·`shadow-hero`·그 border 를
     겨냥하던 hover/transition 절. **유지한 것: 이 화면 전용 패딩 토큰**(`--hero-x/y-today`) —
     `ds-frame` 기본값 18/20 으로 덮으면 가장 많이 튜닝된 화면의 기하가 조용히 바뀐다. */
  hero: 'ds-frame mb-0! tint-scope group relative isolate flex flex-col justify-center overflow-hidden bg-[image:var(--bg-hero-today)] px-hero-x-today! py-hero-y-today! transform-3d [transform:var(--tilt-today)] [transition:transform_0.25s_var(--ease)] animate-[enter-fade_var(--dur-slow)_var(--ease)_both] ds-hairline motion-reduce:transform-none motion-reduce:animate-none',
  aura: 'pointer-events-none absolute bottom-[var(--aura-bottom)] left-[var(--aura-left)] z-[-1] h-[var(--aura-h)] w-9/10 bg-[image:var(--bg-aura-today)] [filter:var(--filter-aura)] live-aura animate-[live-breathe_var(--tempo-slow)_var(--ease)_infinite] motion-reduce:animate-none',
  spotlight:
    'pointer-events-none absolute inset-0 z-[-1] bg-[image:var(--bg-spotlight-today)] opacity-0 transition-opacity duration-slow ease-[var(--ease)] group-hover:opacity-100 motion-reduce:transition-none',
  heroFill:
    'absolute bottom-0 left-0 z-[-1] h-0.75 bg-acc shadow-[var(--shadow-fill)] transition-[width] duration-draw ease-[var(--ease-draw)] motion-reduce:transition-none',
  heroHead: 'flex items-baseline justify-between gap-3',
  /* D-6 액센트 예산 — 아이브로는 **분류 라벨**이지 손봐야 할 것이 아니다. 액센트는 행동에만.
     (같은 화면에서 acc 표면이 20곳을 넘었고, 다 강조하면 아무것도 강조가 아니다 · DS §0-5.) */
  eyebrow:
    'inline-flex items-center gap-2 text-xs leading-text font-extrabold tracking-eyebrow-wide text-mut uppercase',
  /* ⚠ W6 용량 **한 줄**(`fit`)이 여기 있었다 — P-7 이 그 판정을 길이로 옮기며 사라졌다.
     스타일이 `DayBar` 로 간 것이 아니라 **문장 자체가 그래픽이 됐다**(문자열은 그 막대의
     `aria-label` 로만 남는다). 되살리려면 먼저 "왜 길이로 부족한가"를 적을 것. */
  live: 'size-1.75 rounded-full bg-acc shadow-load animate-[live-breathe_var(--tempo)_var(--ease)_infinite] motion-reduce:animate-none',
  subj: 'mt-subj-top! mb-0! text-subj! max-wide:text-subj-mobile! font-black! leading-flat tracking-subj! text-balance text-[color:var(--subj-col)]!',
  heroSub: 'mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1.5 text-lg leading-body text-mut',
  chapter: 'font-semibold text-txt',
  // D-5 선택 근거 — 액센트로 한 줄. 크기는 챕터 줄과 같되 무게로만 낮춘다(위계는 색·굵기로).
  // D-5 선택 근거 — 보조 설명이라 조용하게(D-6: 액센트는 행동 하나에만).
  why: 'text-md font-semibold text-mut',
  yesterday: 'mt-3 max-w-[var(--yesterday-max)] text-hint leading-body text-mut',
  momentum: 'inline-flex flex-wrap items-center gap-x-3.5 gap-y-2',
  mChip:
    'inline-flex items-center rounded-full! border-0! bg-[var(--tint-acc-12)]! px-2.75! py-1! text-sm! leading-auto font-extrabold! text-acc! shadow-[var(--shadow-inset-acc-glow)] hover:shadow-[var(--shadow-inset-acc-solid)]',
  actions: 'mt-actions-top flex items-center gap-4',
  cta: 'relative inline-flex cursor-pointer items-baseline gap-2.5 overflow-hidden rounded-base! border-0! px-6.5! py-3.75! font-extrabold! tracking-cta after:pointer-events-none after:absolute after:inset-0 after:bg-[image:var(--bg-cta-shimmer)] after:[transform:var(--cta-shim-off)] after:transition-transform after:duration-slow after:ease-[var(--ease)] hover:after:[transform:var(--cta-shim-on)] focus-visible:[outline-offset:var(--cta-outline-offset)]! motion-reduce:after:transition-none',
  ctaFill:
    'bg-[image:var(--acc-fill)]! text-on-acc! shadow-[var(--shadow-cta)] hover:-translate-y-px hover:brightness-emph hover:shadow-[var(--shadow-cta-hover)]',
  ctaRun:
    'bg-[var(--bg-cta-run)]! text-acc! shadow-[var(--shadow-inset-acc-glow)] hover:shadow-[var(--shadow-inset-acc-solid)]',
  ctaGhost:
    'bg-transparent! text-txt! shadow-[var(--shadow-inset-line)] hover:shadow-[var(--shadow-inset-line-acc-hover)]',
  ctaGo: 'relative z-[1] text-base leading-auto',
  ctaCap: 'relative z-[1] text-sm leading-auto font-bold opacity-72',
  ctaNum: 'relative z-[1] text-cta-num font-extrabold tracking-label tabular-nums',
  clock: 'text-base14 font-bold tracking-tag text-mut tabular-nums',
  presets: 'inline-flex gap-1.5',
  preset:
    'rounded-md! border-0! bg-transparent! px-3! py-2.25! text-mut! font-extrabold! tabular-nums shadow-[var(--shadow-inset-line)] hover:shadow-[var(--shadow-inset-line-acc-pill)]',
  flow: 'flex min-h-0 flex-col rounded-lg border border-line bg-[image:var(--bg-flow-today)] px-4.5 pt-4.5 pb-3 [--rise-y:12px] animate-[enter-rise_var(--dur-slow)_var(--ease)_var(--stagger)_both] hover:border-[color:var(--line-flow-hover)] motion-reduce:animate-none',
  flowHead: 'mb-2.5! flex! items-center gap-3',
  ring: 'relative inline-block size-8.5 flex-none [--ring-w:6]',
  /* ⚠ `ring`(도넛 래퍼)이 여기 있었다 — P-7 에서 **링을** 지웠다(숫자가 아니라 · 근거는 JSX 주석).
     `ringNum` 은 이제 링 *안*이 아니라 흐름 헤더의 첫 칸이라 `absolute` 를 뗀다. */
  ringNum: 'flex-none text-lg leading-text font-extrabold tracking-ringnum text-txt',
  ringNumSmall: 'text-tiny9 font-bold text-mut',
  flowT: 'flex-1 ds-caps',
  // D-6 — '● 09:00 LIVE'는 시계다(내가 손볼 것이 아니다). 살아 있다는 신호는 점 하나로 충분.
  now: 'text-sm leading-text font-extrabold text-mut tabular-nums',
  rail: 'min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]',
  railEmpty: 'px-1 py-3.5 text-hint leading-text text-mut',
  recall:
    'mt-2.5 flex-none rounded-base border border-line2 px-3.5 py-3 animate-[enter-fade_var(--dur-slow)_var(--ease)_both]',
  recallTop: 'mb-1.5 flex items-baseline gap-2',
  recallTag: 'flex-none text-2xs font-extrabold tracking-skel uppercase',
  recallMeta: 'truncate text-xs leading-text font-bold text-mut',
  recallQ: 'text-recall-q leading-snug font-bold text-txt',
  recallBtn:
    'mt-2.5 w-full rounded-blk! border-0! bg-[var(--acc-soft)]! px-3! py-2! text-hint! font-extrabold! text-acc! shadow-[var(--shadow-inset-acc-glow)] hover:shadow-[var(--shadow-inset-acc-solid)]',
  recallA:
    'mt-2 flex flex-col gap-1.25 text-hint leading-body text-mut animate-[enter-fade_var(--dur-slow)_var(--ease)_both]',
  recallReset: 'mt-0.5 self-start border-0! bg-transparent! p-0! text-xs! leading-auto font-bold! text-mut! underline',
  confWrongNote: 'mt-1.5 text-sm leading-body text-mut',
  more: 'mt-3 border-x-0! border-b-0! rounded-none! border-line2! bg-transparent! pt-3.5! text-left text-sm! leading-auto font-bold! text-mut!',
  /* ⚠⚠ **하단 스트립을 은퇴시키고 레일의 '오늘 밖' 구역으로 옮겼다(W18 · 2026-07-31).**
     같은 성격의 신호(마감·Anki·보충 / 밀린 복습)가 화면의 **두 자리**에 있었고, 위계가 뒤집혀
     있었다 — 행동을 바꾸는 것이 11~13px 최하단, 안 바꾸는 것(연속)이 30px 최상단.
     ⚠ **미실행 사유였던 것이 이 구현의 제약이다**: 레일 컬럼은 이미 스크롤이라 블록 많은 날
     이 구역이 스크롤 아래로 밀리면 **지금보다 나빠진다** → `flex-none` 고정 구역이어야 한다
     (`S.rail` 이 `flex-1 overflow-y-auto` 이고 이건 그 형제다 — 스크롤 밖에 있다).
     함께 사라진 것: 라벨 3 + 구분선 2 = 내용 없는 노드 5개(옛 `S.strip`·`S.vline`). */
  beyond: 'mt-2 flex flex-none flex-col gap-2 border-t border-line-soft px-1 pt-2.5',
  reviewCta:
    'inline-flex items-center gap-2 self-start rounded-md! border-0! bg-[var(--tint-warn-faint)]! px-3! py-2! text-hint! font-bold! shadow-[var(--shadow-inset-line2)] hover:shadow-[var(--shadow-inset-acc-glow)]',
  reviewDot: 'size-1.75 flex-none rounded-full bg-warn',
  grp: 'flex flex-wrap items-center gap-3',
  grpL: 'ds-caps',
  tag: 'inline-flex cursor-pointer items-center gap-1.5 border-0! bg-transparent! p-0! font-extrabold!',
  tagMut: 'inline-flex cursor-default items-center gap-1.5 text-md font-semibold text-mut',
  dot: 'size-1.75 flex-none rounded-full',
  /* UX-1 하단 스트립 액센트 위계 — 다섯 그룹의 숫자가 **전부** `text-acc` 볼드라 위계가 0이었다
     (DS §0-5: 다 강조하면 아무것도 강조가 아니다). 액센트를 "지금 손봐야 할 것"에만 예약한다:
     임박 마감 · 밀린 Anki · 열린 보충. 나머지(이번 주 누적 시간 · 의식 체크)는 *상태 보고*라
     `txt` 로 내린다 — 굵기는 그대로라 여전히 읽히고, 색만 조용해진다.
     ⚠ 임계는 보수적으로. 요일마다 색이 튀면 "액센트가 의미를 갖는다"는 신호 자체가 흔들린다
       → 0/미연결은 무조건 cool, 양수일 때만 hot. 새 요소는 0개(조건은 이미 계산돼 있었다). */
  hot: 'text-acc',
  cool: 'text-txt',
} as const;

export const tone = (hot: boolean): string => (hot ? S.hot : S.cool);
/** Anki 는 **미연결(null)이 hot 이 아니다** — 설정 문제라 매일 뜨고, 매일 뜨는 액센트는 소음이 된다. */
const ankiTone = (due: number | null | undefined): string => tone(due != null && due > 0);

/**
 * 하단 스트립의 Anki 대기 칸.
 *
 * ⚠⚠ **이 숫자는 `runtime` 테이블에 남은 캐시라 어제 것일 수 있다.** `AnkiPanel` 을 열어야만
 * 갱신되는데(그 컴포넌트의 이펙트가 유일한 갱신 경로다) 오늘 탭은 그 사실을 말하지 않고
 * 오늘 값과 똑같이 그렸다. Anki due 는 날이 바뀌면 통째로 갈리므로 어제 숫자는 **틀린 숫자**다.
 * → 낡았으면 액센트를 빼고 title·aria 가 언제 것인지 말한다. 판정은 `lib/anki.ankiFreshness`.
 *
 * ⚠ 컴포넌트로 뗀 이유는 스타일이 아니라 **분기**다 — `TodaySignature` 는 인지복잡도 래칫(77)
 * 바로 아래라 조건부 JSX 를 더 쌓으면 게이트가 막는다(N-5 가 같은 이유로 조각을 뗀 선례).
 * 래칫이 "더 나빠지지 않는다"만 보장한다는 뜻이 정확히 이것이다: 새 분기는 새 이름을 갖는다.
 */
export function AnkiTag({
  due,
  fresh,
  onGo,
}: {
  due: number | null;
  fresh: { stale: boolean; label: string } | null;
  onGo: () => void;
}) {
  const stale = due != null && fresh?.stale === true;
  const body = due == null ? '미연결 — 연동 탭에서 실시간 연결' : `복습 대기 ${due}장`;
  const note = stale ? ` — ${fresh.label}. 연동 탭에서 새로고침` : '';
  return (
    <div className={S.grp}>
      <span className={S.grpL}>Anki 대기</span>
      <button
        type="button"
        className={S.tag}
        onClick={onGo}
        title={`${body}${note}`}
        aria-label={`Anki ${body}${note} — 연동 탭으로`}
      >
        {/* ⚠ 낡은 값은 **액센트만 뺀다**(숫자는 지우지 않는다). 지우면 '연결 필요'와 구분이
            사라져 이미 연결한 사용자가 다시 연결하려 들고, 그대로 강조하면 어제 숫자를 오늘
            것으로 읽는다 — 톤을 낮추는 것이 "이건 오늘 것이 아니다"의 시각 표현이다. */}
        <b className={stale ? tone(false) : ankiTone(due)}>{due == null ? '연결' : due}</b>{' '}
        {due == null ? '필요' : '장'}
      </button>
    </div>
  );
}
