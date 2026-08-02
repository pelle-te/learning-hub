/* ============================================================
   Spark — **T-14 데이터워드**(워드스케일 스파크라인). 글자 높이의 인라인 그래픽.

   ## 왜 필요한가

   밀도 표면(과목 표·배분 보드·원장)의 셀은 전부 **지금 값 하나**만 말한다. 추세를 보려면
   통계 탭으로 화면을 옮겨야 했고, 그 왕복이 "행 하나의 추세"라는 작은 질문에 비해 비쌌다.
   데이터워드는 그 답을 **문장 안**에 둔다 — 옮기지 않고 곁눈으로 읽는 크기.

   ## ⚠⚠ 점이 모자라면 **아무것도 안 그린다**

   판정은 `lib/series` 가 소유한다(`MIN_POINTS`). 두 점을 이은 선은 추세처럼 보이지만 추세가
   아니고, 사용자는 그 차이를 픽셀에서 구분할 수 없다. 그래서 이 컴포넌트의 첫 줄이 `null`
   반환이고, 그게 이 기능의 정직성 전부다.

   ## 규격

   · 폭 20px · 높이 = 글자 높이(1em 언저리). 로드맵의 검증 조건이 _"폭 20px 에서 방향이
     판별되나"_ 였다 — 그 폭이 곧 "문장 안에 들어간다"의 정의다.
   · 색은 **한 가지**(현재 글자색 상속). 데이터워드는 강조가 아니라 **부연**이라, 액센트를
     쓰면 문장의 위계가 뒤집힌다.
   · `aria-hidden` 이다 — 스크린리더에는 옆의 수가 이미 값을 말한다. 스파크는 그 수의 *모양*
     이라 따로 읽으면 같은 사실을 두 번 말하는 것이 된다. 대신 `title` 로 추세 한 단어를 준다.
============================================================ */

/** 워드스케일 규격 — 이 둘이 "문장 안에 들어간다"의 정의다(머리주석). */
const W = 20;
const H = 10;

/** 추세 한 단어 — 마지막 점이 첫 점보다 큰가. `title` 로만 쓰인다(시각은 선이 말한다). */
function trendWord(xs: number[]): string {
  const a = xs[0] ?? 0;
  const b = xs[xs.length - 1] ?? 0;
  if (b > a * 1.1) return '오르는 중';
  if (b < a * 0.9) return '내리는 중';
  return '비슷함';
}

/**
 * 워드스케일 스파크라인. `series` 가 `null`(점 부족)이면 **아무것도 안 그린다**.
 *
 * `max` 를 주면 그 값을 천장으로 쓴다 — **작은 배수(T-23)의 공유 척도**가 그 통로다.
 * 안 주면 자기 최댓값으로 정규화한다(단독 셀).
 */
export default function Spark({ series, max, label }: { series: number[] | null; max?: number; label?: string }) {
  if (!series || series.length < 2) return null;
  const top = max && max > 0 ? max : Math.max(...series, 1);
  const step = W / (series.length - 1);
  const d = series
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(H - (v / top) * H).toFixed(1)}`)
    .join(' ');
  return (
    <svg
      /* ⚠ `align-[-0.1em]`(임의값)은 린트가 막는다 — `align-text-bottom` 이 같은 일을 하고
       **글자 축에 붙는다**는 이 컴포넌트의 요지를 이름으로 말한다. */
      className="ml-1 inline-block align-text-bottom"
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      aria-hidden="true"
      role="presentation"
    >
      <title>{`${label ? label + ' — ' : ''}${trendWord(series)}`}</title>
      {/* 색은 상속(currentColor) — 데이터워드는 강조가 아니라 부연이다(머리주석). */}
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" opacity="0.7" />
    </svg>
  );
}
