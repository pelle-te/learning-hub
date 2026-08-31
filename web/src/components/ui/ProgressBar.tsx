/* ProgressBar — 진행 막대. 룩은 전역 `ds-bar` + `.ds-bar > i` 가 소유한다.
   ⚠ `m-0!` 의 `!` 가 필수다: `ds-bar` 는 **언레이어드**(ds.css 머리주석)라 유틸리티가 그냥은
   못 이긴다. ds.bar 는 카드 안 배치를 전제로 좌우 여백을 갖는데 이 컴포넌트는 배치를 호출부가
   정하므로 그 마진만 지운다.
   채움(`<i>`)의 기하·전이는 `.ds-bar > i` 가 이미 준다 — 여기선 색만 얹는다.

   ⚠⚠ **`label` 은 필수다**(U066 · 2026-08-31). `role="progressbar"` 는 접근 이름이 없으면
   스크린리더에서 «2 퍼센트»만 읽히고 **무엇의 2%인지 말할 수 없다**(axe `aria-progressbar-name` ·
   serious). 타입으로 강제하는 이유는 이 저장소의 `State.next` 와 같다 — 선택적으로 두면 새
   호출부가 조용히 빠뜨리고, 그 화면은 아무도 안 볼 수 있다.
   ⭐ **발견 경위가 요점이다**: 이 위반은 `/degree?view=req` 에 있었고 그 화면은 **두 커버리지
   로스터 어디에도 없었다**(U066). 로스터에 넣자마자 나왔다 — 「a11y 위반 0」이 분모의 함수라는
   실측 사례다. */
export function ProgressBar({ pct, color, label }: { pct: number; color?: string; label: string }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div
      className="ds-bar m-0!"
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(w)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <i className="bg-acc" style={{ width: `${w}%`, ...(color ? { background: color } : null) }} />
    </div>
  );
}
