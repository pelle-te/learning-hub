import type { ReactNode } from 'react';

/** 박스형 표 래퍼. <thead>/<tbody>를 children으로 그대로 넣는다(셀 커스텀 자유).
 *  룩은 전역 `ds-table` 이 소유한다 — `<th>`·`<td>` 를 소비처가 만들기 때문에 자손 셀렉터가
 *  불가피하고(§15-10), 그러면 CSS Module 로 둘 이유가 없다(`ds.css` 머리주석). */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={className ? `ds-table ${className}` : 'ds-table'}>
      <table>{children}</table>
    </div>
  );
}
