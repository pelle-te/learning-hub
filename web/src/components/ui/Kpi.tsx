import type { ReactNode } from 'react';

export type KpiTone = 'warn' | 'bad' | 'good';

/* KPI — 핵심 숫자 카드 그리드.
   ── C-7 마지막 티어 ────────────────────────────────────────────────────────
   기하·룩은 전역 `ds-kpis`/`ds-kpi`/`ds-v`/`ds-l` 이 소유한다(옛 composes 4건).
   ⚠ 후손 규칙 `.ds-kpi .ds-v` / `.ds-kpi .ds-l` 가 성립하려면 **부모와 자식 양쪽에** 그 클래스가
   있어야 한다 — 옛 주석이 경고하던 암묵 결합이고, 빠뜨리면 컴파일 에러 없이 스타일만 빠진다.
   tone 별 값 색만 이 컴포넌트 고유라 `data-[tone=…]` 변형으로 얹는다(속성 셀렉터의 정공법).
   ⚠ `.ds-kpi .ds-v` 가 line-height 1.15 를 세우므로 자손 span 은 그 값을 상속한다 → suffix 에
   내장 크기명을 쓸 땐 `leading-[1.15]` 로 못박는다(규약 6). */
const V = 'ds-v data-[tone=warn]:text-warn data-[tone=bad]:text-bad data-[tone=good]:text-good';
const SUF = 'ml-0.75 text-sm leading-[1.15] font-semibold text-mut';

/** KPI 4열 그리드 컨테이너. */
export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="ds-kpis">{children}</div>;
}

/** 큰 숫자 + 라벨. tone으로 숫자 색(경고/위험/성공). suffix는 값 뒤 작은 단위. */
export function Kpi({
  value,
  label,
  tone,
  suffix,
}: {
  value: ReactNode;
  label: ReactNode;
  tone?: KpiTone;
  suffix?: ReactNode;
}) {
  return (
    <div className="ds-kpi">
      <div className={V} data-tone={tone}>
        {value}
        {suffix != null && <span className={SUF}>{suffix}</span>}
      </div>
      <div className="ds-l">{label}</div>
    </div>
  );
}
