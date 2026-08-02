/* ============================================================
   StrataStrip — **T-21 지층 시그니처**(학기를 그리는 12px 띠).

   ## 왜 필요한가

   각도 3 의 관측: 이 앱의 시그니처 7종이 **전부 지금 상태**를 그리고, 시간축이 수개월인 것이
   **0** 이었다. 그래서 "이번 학기가 어떻게 흘러왔나"를 볼 화면이 없었다 — 통계 탭조차 주 단위
   막대라 학기 전체가 한눈에 안 들어온다.

   지층(strata)은 그 답을 **12px 띠 하나**로 준다. 주마다 세로 한 칸, 과목마다 색 한 층.
   읽는 법이 하나뿐이라 설명이 필요 없다: **두꺼운 주는 많이 한 주, 얇은 주는 적게 한 주.**

   ## ⚠⚠ 6주가 안 되면 안 그린다

   판정은 `lib/series.strata` 가 소유한다. 3주짜리 띠는 지층이 아니라 막대 세 개이고, 그걸
   "학기의 모양"이라 부르면 거짓이다. 로드맵도 이 항목을 _"최소 6주치 — ⚠ 지금은 거짓(방학)"_
   이라 적어 뒀다: **틀은 지금 만들고 판정만 기다린다**(⏳ 재분류의 그 규율).

   ## ⚠ 높이가 12px 인 것이 계약이다

   더 키우면 차트가 되고, 차트가 되면 통계 탭과 같은 일을 하는 두 번째 화면이 된다. 이 띠의
   값은 **히어로 아래 한 줄을 차지하면서 방해하지 않는 크기**에 있다.
============================================================ */
import { strata, type WeekMatrix } from '@/lib/series';
import { colorForId } from '@/lib/utils';

/** 띠 높이(px). **키우지 말 것** — 키우면 차트가 되고 통계 탭과 겹친다(머리주석). */
const H = 12;

export default function StrataStrip({
  matrix,
  keys,
  nameOf,
}: {
  matrix: WeekMatrix;
  /** 층 순서 — 위에서 아래로. 보통 과목 id. */
  keys: string[];
  nameOf: (key: string) => string;
}) {
  const rows = strata(matrix, keys);
  if (!rows) return null; // 6주 미만 — 지층이라 부를 수 없다

  const peak = Math.max(...rows.map((r) => r.total), 1);
  return (
    <div
      className="flex w-full items-end gap-px"
      style={{ height: H }}
      role="img"
      aria-label={`최근 ${rows.length}주 과목별 학습량 지층`}
    >
      {rows.map((r) => (
        <span
          key={r.wk}
          className="flex min-w-0 flex-1 flex-col-reverse justify-start"
          /* 주의 총량이 곧 그 칸의 높이다 — "두꺼운 주 = 많이 한 주"라는 유일한 읽기 규칙. */
          style={{ height: `${(r.total / peak) * 100}%` }}
          title={`${r.wk} · ${r.total.toFixed(1)}h`}
        >
          {r.parts.map((p) => (
            <i
              key={p.key}
              className="block w-full"
              style={{
                height: r.total > 0 ? `${(p.v / r.total) * 100}%` : '0%',
                // 과목 색은 **파생**이다(절대규칙 #3) — 여기서 색을 고르지 않는다.
                background: colorForId(p.key),
              }}
              aria-hidden="true"
              title={`${nameOf(p.key)} ${p.v.toFixed(1)}h`}
            />
          ))}
        </span>
      ))}
    </div>
  );
}
