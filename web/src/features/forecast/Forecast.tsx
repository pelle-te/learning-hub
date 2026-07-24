/* ============================================================
   Forecast — 탭: 📈 복습 부하 예보 (ID-1 · fill 대시보드)
   학습 루프에서 유일하게 비어 있던 시제를 메운다: 오늘탭이 '밀린 것'(overdue backlog)이라면
   여기선 '다가오는 복습 파도'를 앞 14일 날짜별로 조망한다. 볼트 챕터를 '마지막 만진 날' +
   간격반복 오프셋으로 미래에 투영해, 어느 날 복습이 몰릴지를 '부하의 형태'로 그린다.

   ⚠ 정확 예측이 아니라 형태다 — Anki(FSRS) 는 미래 due 를 앱이 아닌 Anki 가 소유하므로
   막대는 볼트 챕터만 그리고, Anki 는 '오늘 기준 due' 를 별도 컨텍스트로만 정직하게 얹는다
   (예보 정밀 비대칭 · 로드맵 ID-1). 데이터는 store(useApp·useSchedule) / 로직은 lib.

   [a11y] 막대는 `role="img" + aria-label + data-tip + tabIndex={0}` 규약(StatsDetail 선례)을
   따른다. tabIndex 목적은 **툴팁 도달성**(components/Tooltip 이 전역 focusin 으로 `[data-tip]`
   에 툴팁을 띄운다) — 없으면 호버 정보가 키보드 사용자에게만 사라진다(SR 은 같은 문자열
   aria-label 로 이미 받음). no-noninteractive-tabindex 는 이 '툴팁 타깃' 예외를 표현 못 해
   파일 단위로 끈다 — 이 파일은 차트 전용이라 여기 생길 tabIndex 는 전부 같은 패턴이다.
============================================================ */
/* eslint-disable jsx-a11y/no-noninteractive-tabindex */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/useApp';
import { useRuntime } from '@/store/useRuntime';
import { useSchedule } from '@/store/selectors';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { dueForecast, FORECAST_HORIZON, type ForecastDay } from '@/lib/spacedReview';
import { totalDue } from '@/lib/anki';
import { todayISO, fmtShort, DOW } from '@/lib/utils';
import EmptyState from '@/components/EmptyState';
import { Button } from '@/components/ui';

const WRAP = 'flex h-full flex-col gap-4 p-6';
const CHART = 'flex min-h-0 flex-1 items-end gap-1.5';
/* 한 날 = 세로 컬럼(막대 + 라벨). 주말은 살짝 죽여 평일 파도와 시각적으로 가른다. */
const COL = 'flex min-w-0 flex-1 flex-col items-center gap-1.5';
const BAR_TRACK = 'flex w-full flex-col-reverse overflow-hidden rounded-t-sm';
const LEGEND = 'flex flex-wrap items-center gap-x-4 gap-y-1.5';

/** 막대 영역 최대 높이(px) — fill 프레임 안에서 flex-1 이 실제 높이를 정하되, 세그먼트 비율의
 *  기준 높이다. 인라인 style 로 세그먼트별 height 를 주는 건 StatsDetail 스파크바와 같은 관용구. */
const BAR_MAX = 200;

function DayColumn({ d, max }: { d: ForecastDay; max: number }) {
  const weekend = d.wd === 0 || d.wd === 6;
  const label =
    d.chapters === 0
      ? `${fmtShort(new Date(d.ds + 'T00:00:00'))} 복습 없음`
      : `${fmtShort(new Date(d.ds + 'T00:00:00'))} (${DOW[d.wd]}) 복습 ${d.chapters}개 — ` +
        d.subjects.map((s) => `${s.subject} ${s.count}`).join(', ');
  return (
    <div className={COL}>
      <div
        className={BAR_TRACK}
        style={{ height: max ? Math.round((d.chapters / max) * BAR_MAX) : 0 }}
        role="img"
        aria-label={label}
        data-tip={label}
        tabIndex={0}
      >
        {d.subjects.map((s) => (
          <div
            key={s.sid}
            style={{
              height: `${(s.count / Math.max(1, d.chapters)) * 100}%`,
              background: s.color || 'var(--acc)',
            }}
            aria-hidden="true"
          />
        ))}
      </div>
      <div className={`ds-tiny leading-none ${weekend ? 'text-mut' : 'text-txt'}`} aria-hidden="true">
        {d.offset}
      </div>
      <div className="ds-tiny leading-none text-mut" aria-hidden="true">
        {DOW[d.wd]}
      </div>
    </div>
  );
}

export default function Forecast() {
  const state = useApp((s) => s.state);
  const res = useSchedule();
  const nav = useNavigate();
  const today = todayISO(state);
  const ankiLive = useRuntime((s) => s.cache._ankiLive);
  const ankiDue = ankiLive?.decks ? totalDue(ankiLive.decks) : null;

  const forecast = useMemo(() => dueForecast(state, res.days || [], today), [state, res.days, today]);

  const total = forecast.reduce((t, d) => t + d.chapters, 0);
  const max = forecast.reduce((m, d) => Math.max(m, d.chapters), 0);
  // 가장 몰리는 날(peak) — 여러 날이 같으면 가장 이른 날.
  const peak = max > 0 ? forecast.find((d) => d.chapters === max)! : null;

  // 예보에 등장하는 과목(색 범례) — 첫 등장 순, 중복 제거.
  const legend = useMemo(() => {
    const seen = new Map<string, { subject: string; color?: string }>();
    for (const d of forecast) for (const s of d.subjects) if (!seen.has(s.sid)) seen.set(s.sid, s);
    return [...seen.values()];
  }, [forecast]);

  usePageChromeEffect(
    () => ({
      readouts: [
        { label: `앞 ${FORECAST_HORIZON}일 복습`, value: total, accent: total > 0 },
        { label: '가장 몰리는 날', value: peak ? `+${peak.offset}일 · ${peak.chapters}개` : '—' },
        { label: 'Anki 오늘 due', value: ankiDue == null ? '—' : ankiDue },
      ],
      action: { label: '복습 실행', onClick: () => nav('/review-run') },
    }),
    [total, peak?.offset, peak?.chapters, ankiDue],
  );

  if (total === 0) {
    return (
      <section className={WRAP} aria-label="복습 부하 예보">
        <EmptyState
          glyph="📈"
          title="다가오는 복습 파도가 아직 없어요"
          desc={
            <>
              완료한 학습 챕터가 간격반복 사다리(1·3·7·16일)를 타면 여기에 앞 {FORECAST_HORIZON}일치 복습 부하가
              그려집니다. 오늘 학습을 마치면 곧 첫 파도가 나타나요.
            </>
          }
          actions={<Button onClick={() => nav('/today')}>오늘 학습으로</Button>}
        />
      </section>
    );
  }

  return (
    <div className={WRAP}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0">
          복습 부하 예보{' '}
          <span className="ds-muted ds-tiny">
            — 앞 {FORECAST_HORIZON}일 볼트 챕터. 정확 예측이 아니라 '부하의 형태'
          </span>
        </h2>
        {ankiDue != null && (
          <span className="ds-tiny text-mut">Anki 미래 due 는 Anki 가 소유 — 여기 막대는 볼트 챕터만</span>
        )}
      </div>

      <div className={CHART}>
        {forecast.map((d) => (
          <DayColumn key={d.ds} d={d} max={max} />
        ))}
      </div>

      {legend.length > 0 && (
        <div className={LEGEND}>
          {legend.map((s) => (
            <span key={s.subject} className="ds-tiny flex items-center gap-1.5 text-mut">
              <span
                className="inline-block size-2.5 rounded-full"
                style={{ background: s.color || 'var(--acc)' }}
                aria-hidden="true"
              />
              {s.subject}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
