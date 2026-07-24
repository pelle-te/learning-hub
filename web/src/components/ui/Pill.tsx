import type { ReactNode } from 'react';

export type PillTone = 'neutral' | 'good' | 'warn' | 'bad';

/* Pill — 상태 칩. 룩은 전역 `ds-pill` + `.ds-pill.ds-good|warn|bad` 복합 선택자가 소유한다.
   이 파일이 갖고 있던 tone 3벌은 ds 의 사본이었다(옛 composes 시절의 잔재) → 삭제.
   ⚠ 정적 맵을 쓴다 — `\`ds-${tone}\`` 처럼 조립하면 Tailwind 가 소스에서 그 문자열을 못 보고,
   전역 클래스라 지금은 동작하더라도 부칙(동적 조립 금지)을 어기는 선례가 된다.

   ⚠⚠ **`tiny` 는 지금까지 아무 일도 하지 않았다(보존 · 별도 안건).** 이 파일의 옛 `.tiny`
   (12px)와 ds 의 `.pill`(11px)은 **같은 특이도**라 최종 스타일시트에서 뒤에 온 쪽이 이겼는데,
   번들 실측 결과 `ui-*.css` 안에서 `_tiny_96rvn`(3019) 앞이 아니라 **뒤에 `_pill_12hu2`(6326)**
   가 놓여 ds 의 11px 이 이겼다. 즉 `<Pill tiny>` 는 그냥 `<Pill>` 과 픽셀 동일하게 렌더돼 왔다.
   같은 `pill tiny` 조합을 **직접** 쓰는 곳(ds.css 안에서는 tiny 가 pill 뒤)은 12px 이라 두 경로가
   우연히 서로 달랐다 — 순서가 곧 결과인 구조라 dev/prod 사이에서도 갈릴 수 있었다.
   이식은 관측된 렌더를 재현한다(절대규칙 #4 · I6). 되살리려면 `ds-tiny` 를 붙이면 되지만
   18개 호출부의 칩이 한꺼번에 1px 커지므로 **사용자 결정 사안**이다. */
const TONE: Record<Exclude<PillTone, 'neutral'>, string> = {
  good: 'ds-good',
  warn: 'ds-warn',
  bad: 'ds-bad',
};

/** 상태 칩. tone으로 색. ⚠ `tiny` 는 위 주석대로 **현재 무동작**이다(관측 렌더 재현). */
export function Pill({ tone = 'neutral', tiny, children }: { tone?: PillTone; tiny?: boolean; children: ReactNode }) {
  void tiny;
  const cls = ['ds-pill', 'whitespace-nowrap', tone !== 'neutral' && TONE[tone]].filter(Boolean).join(' ');
  return <span className={cls}>{children}</span>;
}
