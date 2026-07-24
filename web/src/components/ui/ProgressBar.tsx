/* ProgressBar — 진행 막대. 룩은 전역 `ds-bar` + `.ds-bar > i` 가 소유한다.
   ⚠ `m-0!` 의 `!` 가 필수다: `ds-bar` 는 **언레이어드**(ds.css 머리주석)라 유틸리티가 그냥은
   못 이긴다. ds.bar 는 카드 안 배치를 전제로 좌우 여백을 갖는데 이 컴포넌트는 배치를 호출부가
   정하므로 그 마진만 지운다.
   채움(`<i>`)의 기하·전이는 `.ds-bar > i` 가 이미 준다 — 여기선 색만 얹는다. */
export function ProgressBar({ pct, color }: { pct: number; color?: string }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className="ds-bar m-0!" role="progressbar" aria-valuenow={Math.round(w)} aria-valuemin={0} aria-valuemax={100}>
      <i className="bg-acc" style={{ width: `${w}%`, ...(color ? { background: color } : null) }} />
    </div>
  );
}
