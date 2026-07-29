/* ============================================================
   EmptyState — 1급 빈 상태(설계도 Phase D). 데이터가 없을 때도 의도적으로 보이게:
   큰 글리프 + 에디토리얼 헤드라인 + 안내 + 행동(CTA). 여러 feature가 공유(중복 제거).

   ── C-7 컴포넌트 티어 이식(Tailwind) ────────────────────────────────────────
   전부 div 라 언레이어드 전역(button/h1~h3/.ic)과 겹치는 지점이 없다 — `!` 불필요.
   19px 제목·30px 글리프·14px 반경은 정수 사다리 밖이라 브리지에 이름을 줬다(규약 2 의 예외
   운용: items `--text-item-name` · schedule `--radius-drag` 선례). 이름이 **커스텀**이라
   동반 line-height 를 방출하지 않으므로(규약 6) 제목은 body 1.6 을 그대로 상속한다 —
   원본과 같다. 반대로 desc 는 원본이 1.65 를 명시했으므로 `leading-[1.65]` 로 못박는다.
============================================================ */
import type { ReactNode } from 'react';

/**
 * 이 빈 상태에서 **다음에 할 일**(E17 · 2026-07-29).
 *
 * ⚠ **필수 prop 이다.** 실측: 소비처 16곳 중 다음 행동을 주는 것은 절반뿐이었고, 나머지는
 * "없어요 + 설명"에서 끝나 사용자를 막다른 곳에 세웠다. 선택 prop 이면 바쁜 날 그냥 빠지고,
 * 빠졌다는 사실은 아무 신호도 내지 않는다(이 저장소가 반복해 물린 "조용한" 부류).
 *
 * ⚠ 그렇다고 **억지 CTA** 를 만들라는 뜻은 아니다 — `discovery` 의 "미결 후보 없음"처럼 정말로
 * 할 일이 없는 정상 상태가 있다. 그때는 `{ terminal: '왜 없는지' }` 를 준다: 행동을 못 적으면
 * **왜 없는지를 쓰게** 강제하는 것이 이 유니온의 목적이다. 둘 중 하나는 반드시 화면에 남는다.
 */
export type EmptyNext = ReactNode | { terminal: string };

/** `{ terminal }` 형태인지 — ReactNode 와 겹치지 않게 키로 판정한다. */
function isTerminal(n: EmptyNext): n is { terminal: string } {
  return typeof n === 'object' && n !== null && 'terminal' in n;
}

const WRAP = 'mx-auto flex max-w-empty flex-col items-center gap-2 px-6 py-11 text-center';
// 차분한 네온 글리프 — 1px inset 링은 `--line-acc`(= acc 30% + line) 토큰 그대로.
const GLYPH =
  'mb-1 flex size-16 items-center justify-center rounded-empty-glyph bg-acc-soft text-empty-glyph inset-ring inset-ring-line-acc';
const TITLE = 'text-empty-title font-extrabold tracking-empty-title text-ink';
const DESC = 'text-md leading-[1.65] text-mut';
const ACTIONS = 'mt-2.5 flex flex-wrap justify-center gap-2';
/** 종착 상태 안내 — 행동이 아니라 **이유**라 톤을 낮춘다(CTA 처럼 보이면 누를 것을 찾게 된다). */
const TERMINAL = 'mt-1.5 text-xs text-mut';

export default function EmptyState({
  glyph,
  title,
  desc,
  next,
}: {
  glyph?: ReactNode;
  title: ReactNode;
  desc?: ReactNode;
  next: EmptyNext;
}) {
  return (
    <div className={WRAP}>
      {glyph != null && <div className={GLYPH}>{glyph}</div>}
      <div className={TITLE}>{title}</div>
      {desc != null && <div className={DESC}>{desc}</div>}
      {isTerminal(next) ? <div className={TERMINAL}>{next.terminal}</div> : <div className={ACTIONS}>{next}</div>}
    </div>
  );
}
