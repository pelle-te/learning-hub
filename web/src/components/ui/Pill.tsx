import type { ReactNode } from 'react';

export type PillTone = 'neutral' | 'good' | 'warn' | 'bad';

/* Pill — 상태 칩. 룩은 전역 `ds-pill` + `.ds-pill.ds-good|warn|bad` 복합 선택자가 소유한다.
   이 파일이 갖고 있던 tone 3벌은 ds 의 사본이었다(옛 composes 시절의 잔재) → 삭제.
   ⚠ 정적 맵을 쓴다 — `\`ds-${tone}\`` 처럼 조립하면 Tailwind 가 소스에서 그 문자열을 못 보고,
   전역 클래스라 지금은 동작하더라도 부칙(동적 조립 금지)을 어기는 선례가 된다.

   ⚠⚠ **`tiny` 는 지금까지 무동작이었고, 2026-07-24 에 되살렸다(사용자 결정).** 이 파일의 옛
   `.tiny`(12px)와 ds 의 `.pill`(11px)은 **같은 특이도**라 최종 스타일시트에서 뒤에 온 쪽이
   이겼는데, 번들 실측 결과 `ui-*.css` 안에서 `_tiny_96rvn`(3019) **뒤에** `_pill_12hu2`(6326)가
   놓여 ds 의 11px 이 이기고 있었다 — 즉 `<Pill tiny>` 가 `<Pill>` 과 픽셀 동일했다. 반면 같은
   조합을 **직접** 쓰는 곳은 ds.css 안에서 tiny 가 pill 뒤라 12px 이었다. 두 경로가 우연히 서로
   달랐고, 순서가 곧 결과인 구조라 dev/prod 사이에서도 갈릴 수 있었다.
   이제 `ds-tiny` 를 붙여 **두 경로를 12px 로 통일**한다(전역 `ds-*` 는 정의 순서가 계약이라
   결과가 결정적이다). 대가는 칩 18곳이 1px 커지는 것이고, 그게 원래 프롭의 의미였다. */
const TONE: Record<Exclude<PillTone, 'neutral'>, string> = {
  good: 'ds-good',
  warn: 'ds-warn',
  bad: 'ds-bad',
};

/** 상태 칩. tone으로 색, tiny로 한 칸 큰 글자(11→12px). */
export function Pill({ tone = 'neutral', tiny, children }: { tone?: PillTone; tiny?: boolean; children: ReactNode }) {
  const cls = ['ds-pill', 'whitespace-nowrap', tiny && 'ds-tiny', tone !== 'neutral' && TONE[tone]]
    .filter(Boolean)
    .join(' ');
  return <span className={cls}>{children}</span>;
}
