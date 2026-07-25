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

const WRAP = 'mx-auto flex max-w-empty flex-col items-center gap-2 px-6 py-11 text-center';
// 차분한 네온 글리프 — 1px inset 링은 `--line-acc`(= acc 30% + line) 토큰 그대로.
const GLYPH =
  'mb-1 flex size-16 items-center justify-center rounded-empty-glyph bg-acc-soft text-empty-glyph inset-ring inset-ring-line-acc';
const TITLE = 'text-empty-title font-extrabold tracking-empty-title text-ink';
const DESC = 'text-md leading-[1.65] text-mut';
const ACTIONS = 'mt-2.5 flex flex-wrap justify-center gap-2';

export default function EmptyState({
  glyph,
  title,
  desc,
  actions,
}: {
  glyph?: ReactNode;
  title: ReactNode;
  desc?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className={WRAP}>
      {glyph != null && <div className={GLYPH}>{glyph}</div>}
      <div className={TITLE}>{title}</div>
      {desc != null && <div className={DESC}>{desc}</div>}
      {actions != null && <div className={ACTIONS}>{actions}</div>}
    </div>
  );
}
