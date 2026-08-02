/* ============================================================
   Trellis — **T-23 작은 배수**(같은 척도의 격자).

   ## 왜 필요한가

   밀도 표면은 셀마다 다른 인코딩을 쓴다(어떤 칸은 시간, 어떤 칸은 비율, 어떤 칸은 색). 그래서
   "이 과목이 저 과목보다 많나"를 눈으로 **환산**해야 했다. 작은 배수는 그 환산을 없앤다 —
   같은 자로 잰 같은 모양을 나열하면 이상치가 *튀어나온다*(읽는 것이 아니라 보인다).

   ## ⚠⚠ 공유 척도가 아니면 작은 배수가 아니다

   계열마다 자기 최댓값으로 정규화하면 격자는 예뻐지지만 **모든 칸이 천장에 닿아 비교가
   불가능해진다**. 그러면 그건 작은 배수가 아니라 그냥 작은 차트 여러 개다. 척도는
   `lib/series.sharedMax` 하나가 정하고, 이 컴포넌트는 그것을 **모든 칸에 강제로** 넘긴다.

   ## ⚠ 그릴 수 없는 칸은 **비운다**

   점이 모자란 계열은 `Spark` 가 `null` 을 돌려준다. 그 칸에 0 짜리 평선을 그리면 "안 했다"로
   읽히는데 사실은 "모른다"이다 — 대신 짧은 글자로 왜 비었는지 말한다.
============================================================ */
import Spark from './Spark';
import { sharedMax } from '@/lib/series';

export interface TrellisRow {
  key: string;
  label: string;
  series: number[] | null;
  /** 오른쪽에 붙는 현재값(사람이 읽는 문자열). 없으면 생략. */
  value?: string;
}

export default function Trellis({ rows, caption }: { rows: TrellisRow[]; caption?: string }) {
  if (!rows.length) return null;
  // ⚠ 척도는 **한 번** 정하고 모든 행에 같은 값을 넘긴다(머리주석 §공유 척도).
  const max = sharedMax(rows.map((r) => r.series));
  const drawable = rows.filter((r) => r.series);

  return (
    <div>
      {caption && (
        <div className="ds-caps mb-1.5">
          {caption}
          {/* 척도를 화면에 적는다 — 공유 척도의 값은 "같은 자로 쟀다"는 사실이 보일 때 나온다. */}
          <span className="ml-1.5 font-normal text-mut">공통 척도 {max.toFixed(1)}</span>
        </div>
      )}
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-2 text-md">
            <span className="min-w-0 flex-1 truncate">{r.label}</span>
            {r.series ? (
              <Spark series={r.series} max={max} label={r.label} />
            ) : (
              /* 0 짜리 평선을 그리면 "안 했다"로 읽힌다 — 사실은 "모른다"다. */
              <span className="ds-tiny w-5 text-center text-mut">·</span>
            )}
            {r.value && <b className="w-14 flex-none text-right tabular-nums">{r.value}</b>}
          </li>
        ))}
      </ul>
      {drawable.length < rows.length && (
        <p className="ds-tiny mt-1.5 text-mut">
          점이 모자란 {rows.length - drawable.length}개는 추세를 안 그렸어요 — 몇 주 더 쌓이면 채워집니다.
        </p>
      )}
    </div>
  );
}
