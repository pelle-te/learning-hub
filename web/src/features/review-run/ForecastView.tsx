/* ============================================================
   Forecast — 탭: 📈 복습 부하 예보 (ID-1 · N-9 가용선 · fill 대시보드)
   학습 루프에서 유일하게 비어 있던 시제를 메운다: 오늘탭이 '밀린 것'(overdue backlog)이라면
   여기선 '다가오는 복습 파도'를 앞 14일 날짜별로 조망한다. 볼트 챕터를 '마지막 만진 날' +
   간격반복 오프셋으로 미래에 투영해, 어느 날 복습이 몰릴지를 그린다.

   ⚠ N-9: 막대 단위는 **개수가 아니라 복습 블록**이고 날짜마다 **가용선**(점선)이 함께 선다.
   개수 막대는 "언젠가 몰린다"까지만 말할 수 있었다 — 비교 대상이 없으면 3개가 많은지 적은지
   화면 안에서 판정이 불가능하고, 그래서 예전 부제는 '정확 예측이 아니라 부하의 형태'라는
   면책으로 끝났다. 부하와 가용이 같은 단위가 된 지금은 그 문장이 필요 없다(비교가 답을 준다).
   환산 규칙과 그 안전장치(임의 계수 0 · rev 이중계상 금지)는 `lib/spacedReview` 가 소유한다.

   ⚠ Anki(FSRS) 는 미래 due 를 앱이 아닌 Anki 가 소유하므로 막대는 볼트 챕터만 그리고,
   Anki 는 '오늘 기준 due' 를 별도 컨텍스트로만 정직하게 얹는다(예보 정밀 비대칭 · ID-1).
   데이터는 store(useApp·useSchedule) / 로직은 lib.

   [a11y] 막대는 `role="img" + aria-label + data-tip + tabIndex={0}` 규약(StatsDetail 선례)을
   따른다. tabIndex 목적은 **툴팁 도달성**(components/Tooltip 이 전역 focusin 으로 `[data-tip]`
   에 툴팁을 띄운다) — 없으면 호버 정보가 키보드 사용자에게만 사라진다(SR 은 같은 문자열
   aria-label 로 이미 받음). no-noninteractive-tabindex 는 이 '툴팁 타깃' 예외를 표현 못 해
   파일 단위로 끈다 — 이 파일은 차트 전용이라 여기 생길 tabIndex 는 전부 같은 패턴이다.
============================================================ */
/* eslint-disable jsx-a11y/no-noninteractive-tabindex */
import { weakKey } from '@/lib/domainKeys';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/useApp';
import { useRuntime } from '@/store/useRuntime';
import { useSchedule } from '@/store/selectors';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { heldReviews, releaseReview } from '@/lib/reviewHold';
import { dueForecast, pullForwardCandidates, FORECAST_HORIZON, type ForecastDay } from '@/lib/spacedReview';
import { loadCurve, CURVE_HORIZON, TRADEOFF } from '@/lib/loadCurve';
import { addOrMergeBlock } from '@/lib/dayPlans';
import { toast } from '@/shell';
import { totalDue, dueBySubject, ankiFreshness } from '@/lib/anki';
import { todayISO, fmtShort, reviewBlockMin, DOW } from '@/lib/utils';
import State from '@/components/State';
import { Button } from '@/components/ui';
import { Icon } from '@/components/Icon';

const WRAP = 'flex h-full flex-col gap-4 p-6';
const CHART = 'flex min-h-0 flex-1 items-end gap-1.5';
/* 한 날 = 세로 컬럼(막대 + 라벨). 주말은 살짝 죽여 평일 파도와 시각적으로 가른다. */
const COL = 'flex min-w-0 flex-1 flex-col items-center gap-1.5';
/** 컬럼의 세로 무대 — 막대는 바닥에, 가용선은 그 위 절대 좌표에 선다(둘이 같은 축을 쓴다). */
const STAGE = 'relative w-full';
const BAR_TRACK = 'absolute inset-x-0 bottom-0 flex flex-col-reverse overflow-hidden rounded-t-sm';
/** 가용선 — 그날 복습에 쓸 수 있는 블록 수. 축 밖(여유 충분)이면 맨 위에 옅게 눕는다.
 *  ⚠ 색은 여기 안 굳힌다 — 초과일 때 `border-bad` 를 덧붙이면 같은 특이도라 소스 순서가 승자를
 *  정해(유틸리티 두 개가 같은 속성) 조용히 어느 한쪽이 이긴다. 호출부가 **하나만** 고른다. */
const CAP_LINE = 'absolute inset-x-0 border-t border-dashed';
const LEGEND = 'flex flex-wrap items-center gap-x-4 gap-y-1.5';
const OVER_STRIP =
  'flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-sm border border-line-bad bg-tint-bad-faint px-3 py-2';

/** 막대 영역 최대 높이(px) — fill 프레임 안에서 flex-1 이 실제 높이를 정하되, 세그먼트 비율의
 *  기준 높이다. 인라인 style 로 세그먼트별 height 를 주는 건 StatsDetail 스파크바와 같은 관용구. */
const BAR_MAX = 200;

const short = (ds: string): string => fmtShort(new Date(ds + 'T00:00:00'));
/** 앞당길 후보 칩 — 텍스트였던 것이 버튼이 됐다(A10). 조밀한 스트립 안이라 최소 높이만 잡는다. */
const PULL_CHIP =
  'cursor-pointer rounded-full border! border-line! bg-none! px-2! py-0.5! text-2xs! text-mut! enabled:hover:border-acc! enabled:hover:text-txt!';

function DayColumn({ d, axisMax }: { d: ForecastDay; axisMax: number }) {
  const weekend = d.wd === 0 || d.wd === 6;
  const cap = d.capBlocks;
  // 가용선이 축 위로 벗어나면(=파도보다 한참 여유) 맨 위에 눕히고 옅게 — 좌표를 잃되 존재는 남긴다.
  const capClamped = cap != null && cap > axisMax;
  const capH = cap == null ? null : Math.round((Math.min(cap, axisMax) / axisMax) * BAR_MAX);
  const capTxt = cap == null ? '' : ` — 가용 ${cap}블록`;
  const label =
    d.chapters === 0
      ? `${short(d.ds)} 복습 없음${capTxt}`
      : `${short(d.ds)} (${DOW[d.wd]}) 복습 ${d.blocks}블록 · 챕터 ${d.chapters}개${capTxt}` +
        (d.over ? ' · 가용 초과' : '') +
        ' — ' +
        d.subjects.map((s) => `${s.subject} ${s.count}`).join(', ');
  return (
    <div className={COL}>
      <div className={STAGE} style={{ height: BAR_MAX }} role="img" aria-label={label} data-tip={label} tabIndex={0}>
        <div
          className={`${BAR_TRACK} ${d.over ? 'ring-1 ring-bad' : ''}`}
          style={{ height: Math.round((d.blocks / axisMax) * BAR_MAX) }}
          aria-hidden="true"
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
        {capH != null && (
          <div
            className={`${CAP_LINE} ${d.over ? 'border-bad' : 'border-line'} ${capClamped ? 'opacity-45' : ''}`}
            style={{ bottom: capH }}
            aria-hidden="true"
          />
        )}
      </div>
      <div
        className={`ds-tiny leading-none ${d.over ? 'text-bad' : weekend ? 'text-mut' : 'text-txt'}`}
        aria-hidden="true"
      >
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
  const mutate = useApp((s) => s.mutate);
  const res = useSchedule();
  const nav = useNavigate();
  const today = todayISO(state);
  const ankiLive = useRuntime((s) => s.cache._ankiLive);
  const ankiDue = ankiLive?.decks ? totalDue(ankiLive.decks) : null;
  const ankiFresh = ankiFreshness(ankiLive, today);
  /* E18 — 덱 due 를 **과목에** 붙인다. 종전엔 `totalDue()` 한 숫자뿐이라 "Anki 340장"을 보고
     어느 과목이 밀렸는지 알려면 Anki 를 직접 열어야 했다(앱 밖 왕복).
     ⚠ 이 탭이 그 자리인 이유(E13): 여기가 **볼트 due 와 Anki due 를 한 화면에 쥔** 유일한
     화면이고, 인출 축의 호스트다. 연동 탭은 "붙었나"만 말한다. */
  const ankiBy = ankiLive?.decks ? dueBySubject(ankiLive.decks, state.items) : null;

  const held = heldReviews(state);

  const forecast = useMemo(() => dueForecast(state, res.days || [], today), [state, res.days, today]);
  /* I019 — **노브를 돌리기 전에 곡선을 본다**(2026-08-22 발상 축). 근거 전문은 `lib/loadCurve`
     머리주석. 여기가 자리인 이유: 이 화면이 이미 «앞으로 얼마나 오나»를 묻는 화면이고,
     그 질문의 다음 칸이 «사다리를 바꾸면 어떻게 되나»다. */
  const curve = useMemo(() => loadCurve(state, res.days || [], today), [state, res.days, today]);

  const total = forecast.reduce((t, d) => t + d.chapters, 0);
  const max = forecast.reduce((m, d) => Math.max(m, d.blocks), 0);
  /* 축 = 파도 최댓값에 앵커한다. 가용선까지 축에 넣으면(가용은 '안 자고 안 수업인 모든 시간'이라
     보통 파도의 몇 배다) 막대가 통째로 납작해져 정작 부하의 형태를 잃는다 — 그런 날의 가용선은
     맨 위에 옅게 눕혀(capClamped) '천장이 높다'만 말하게 한다. 넘는 날은 정의상 축 안이라 안 잘린다.
     여유가 있는 날에도 선이 보이도록 파도 위 1블록(축 자신의 눈금)만 머리 공간을 준다. */
  const axisMax = Math.max(1, max + (forecast.some((d) => d.capBlocks != null && d.capBlocks > max) ? 1 : 0));
  // 가장 몰리는 날(peak) — 여러 날이 같으면 가장 이른 날.
  const peak = max > 0 ? forecast.find((d) => d.blocks === max)! : null;
  const revMin = reviewBlockMin(state.moduleLen);
  // 개입 — 가용선을 넘는 첫 날(가장 이른 = 가장 먼저 손쓸 수 있는 날) 하나만 말한다.
  const overDays = forecast.filter((d) => d.over);
  const firstOver = overDays[0] ?? null;
  // firstOver 는 memo 된 forecast 의 원소 참조라 forecast 가 그대로면 참조도 그대로다(deps 안전).
  const pull = useMemo(
    () => (firstOver ? pullForwardCandidates(forecast, firstOver.offset) : []),
    [forecast, firstOver],
  );
  const toLabel = (off: number | null): string => {
    if (off == null) return '오늘';
    const at = forecast.find((f) => f.offset === off);
    return at ? short(at.ds) : '오늘';
  };

  /* ⚠ **후보를 실제로 꽂는다.** 종전엔 이 줄들이 순수 텍스트였다 — 가용 초과를 알려주고
     해법(어느 챕터를 언제로)까지 계산해 놓고, 옮기는 일은 사용자가 계획 탭에 가서 손으로 했다.
     배관만 없었다: `dayPlans.addOrMergeBlock` 은 같은 `sid|type` 병합(완료 키 충돌 방지)까지
     설계돼 있는데 **소비처가 0곳**이었다(테스트에만 존재).
     ⚠ 단위·분은 새로 짓지 않는다 — `reviewBlockMin(moduleLen)` 은 예보 막대가 쓰는 그 값이다
       (임의 계수 0 · `spacedReview` 가 스스로 못박은 규율).
     ⚠ **부작용을 말한다**: 목적지 날은 `ensureManual` 로 수동 편집 모드가 된다. 조용히
       바꾸면 다음에 그 날 자동 배치가 안 도는 것이 원인 불명의 결함으로 보인다. */
  const pullTo = (p: (typeof pull)[number]): void => {
    const at = p.toOffset == null ? null : forecast.find((f) => f.offset === p.toOffset);
    const ds = at ? at.ds : today;
    mutate((st) => {
      addOrMergeBlock(st, res, ds, {
        sid: p.chapter.sid,
        type: 'rev',
        name: p.chapter.subject,
        min: revMin,
        chapters: [p.chapter.chapter],
      });
    });
    toast(`${short(ds)}에 "${p.chapter.chapter}" 복습 블록을 넣었어요 — 그날은 수동 편집 모드가 됩니다.`, 'ok', 6000);
  };

  // 예보에 등장하는 과목(색 범례) — 첫 등장 순, 중복 제거.
  const legend = useMemo(() => {
    const seen = new Map<string, { subject: string; color?: string }>();
    for (const d of forecast) for (const s of d.subjects) if (!seen.has(s.sid)) seen.set(s.sid, s);
    return [...seen.values()];
  }, [forecast]);

  usePageChromeEffect(
    () => ({
      /* N-15 `primary` — 예보의 결론은 "앞으로 얼마나 오나" 하나다(막대는 그 분포를 그린다).
         ⚠ **0이면 안 그린다.** 44px 짜리 `0개` 는 빈 예보 화면에서 가장 큰 요소가 되는데,
         그때 그 화면이 이미 "다가오는 복습 파도가 아직 없어요" 라고 말하고 있다 — 같은 0을 두 번,
         그것도 제일 크게 외치는 꼴이다(N-13 이 레일 상태 슬롯에서 못박은 규율과 같다:
         매일 0을 외치면 신호가 죽는다). */
      primary: total > 0 ? { value: String(total), unit: '개', label: `앞 ${FORECAST_HORIZON}일 복습` } : null,
      readouts: [
        { label: '가장 몰리는 날', value: peak ? `+${peak.offset}일 · ${peak.blocks}블록` : '—' },
        // 가용 초과가 있으면 그것이 이 탭의 결론이다 — 없을 때만 Anki 컨텍스트가 그 자리를 쓴다.
        overDays.length
          ? { label: '가용 초과', value: `${overDays.length}일`, accent: true }
          : // ⚠ 낡은 캐시를 '오늘 due' 라 부르지 않는다 — Anki due 는 날이 바뀌면 통째로 갈린다.
            { label: ankiFresh?.stale ? 'Anki due · 옛 값' : 'Anki 오늘 due', value: ankiDue == null ? '—' : ankiDue },
      ],
      action: { label: '복습 실행', onClick: () => void nav('/review-run') },
    }),
    [total, peak?.offset, peak?.blocks, overDays.length, ankiDue, ankiFresh?.stale],
  );

  if (total === 0) {
    return (
      <section className={WRAP} aria-label="복습 부하 예보">
        <State
          glyph="trend"
          title="다가오는 복습 파도가 아직 없어요"
          desc={
            <>
              완료한 학습 챕터가 간격반복 사다리(1·3·7·16일)를 타면 여기에 앞 {FORECAST_HORIZON}일치 복습 부하가
              그려집니다. 오늘 학습을 마치면 곧 첫 파도가 나타나요.
            </>
          }
          next={<Button onClick={() => nav('/today')}>오늘 학습으로</Button>}
          /* Q-31 — 예보는 **막대의 모양이 곧 정보**라(어느 날이 무거운가) 문장으로 대체되지 않는다.
             합성 7일치로 그 형상만 보여 준다 — 수는 캡션이 남의 것이라고 말한다. */
          preview={
            <div className="flex h-16 items-end justify-between gap-1.5">
              {[3, 7, 2, 9, 5, 1, 4].map((h, i) => (
                <div
                  key={i}
                  className={`flex-1 rounded-t-xs ${h >= 8 ? 'bg-bad' : 'bg-acc'}`}
                  style={{ height: `${h * 11}%` }}
                />
              ))}
            </div>
          }
        />
      </section>
    );
  }

  return (
    <div className={WRAP}>
      {/* E18 — Anki 가 어느 과목에 밀려 있나. **미연결 덱을 숨기지 않는다**: 합계가 안 맞아야
          조인이 틀렸다는 것을 알 수 있다(E3 계측이 하려던 일을 이 화면이 되돌리지 않게).
          ⚠ 넛지 문장은 두지 않는다 — "이미 밀려 있어요" 가 조언이 되려면 임계가 필요하고 그건
          임의 계수다(`spacedReview` 가 못박은 규율). 분해까지만 한다. */}
      {ankiBy && (ankiBy.rows.length > 0 || ankiBy.unmatchedDecks > 0) && (
        <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-mut">
          <span className="font-bold text-txt">Anki 오늘 due</span>
          {ankiBy.rows.slice(0, 3).map((r) => (
            <span key={r.sid}>
              {r.name} <b className="text-txt">{r.due}</b>
            </span>
          ))}
          {ankiBy.unmatchedDecks > 0 && (
            <span>
              미연결 {ankiBy.unmatchedDecks}덱 <b className="text-txt">{ankiBy.unmatchedDue}</b>
            </span>
          )}
        </p>
      )}
      {/* ── I019 부하 곡선 — **바꾸기 전에 결과를 본다** ────────────────────────────────
          ⚠⚠ 노브가 아니라 **곡선이 먼저**다(밖의 표본이 세운 순서). 그리고 대가를 함께 판다:
          «간격을 늘리면 하루 부하는 줄지만 더 많이 잊는다». 그 문장은 `lib/loadCurve.TRADEOFF`
          가 소유한다 — 화면마다 다르게 말하면 그 경고는 곧 장식이 된다.
          ⚠ **노브는 없다**(아직). 이 화면이 답하는 것은 «바꾸면 어떻게 되나»이고, 바꾸는 것은
          그 답을 보고 사람이 결정할 일이다 — 곡선 없이 노브를 먼저 두는 것이 이 항목이
          막으려는 형태다. ⚠ 두 곡선은 **같은 눈금**이다(`curve.peak`) — 각자 정규화하면
          «늘리면 낮아진다»가 그림에서 사라지고, 그건 이 기능의 전부다. */}
      {curve.peak > 1 && (
        <details className="ds-note m-0! mt-2">
          <summary className="ds-tiny cursor-pointer">복습 간격을 늘리면 — 앞 {CURVE_HORIZON}일 부하</summary>
          <div className="mt-1.5 flex items-end gap-px" aria-hidden="true">
            {curve.now.map((n, i) => (
              <span key={i} className="flex w-1.5 flex-col justify-end" style={{ height: 28 }}>
                <span className="w-full bg-acc" style={{ height: `${Math.round((n / curve.peak) * 28)}px` }} />
              </span>
            ))}
          </div>
          <div className="ds-tiny mt-0.5 text-mut">지금 사다리(1·3·7·16·34)</div>
          <div className="mt-1.5 flex items-end gap-px" aria-hidden="true">
            {curve.stretched.map((n, i) => (
              <span key={i} className="flex w-1.5 flex-col justify-end" style={{ height: 28 }}>
                <span className="w-full bg-mut" style={{ height: `${Math.round((n / curve.peak) * 28)}px` }} />
              </span>
            ))}
          </div>
          <div className="ds-tiny mt-0.5 text-mut">한 칸 늘렸을 때</div>
          <p className="ds-tiny mt-1.5 text-warn">{TRADEOFF.replace(/\*\*/g, '')}</p>
        </details>
      )}
      {/* ── P-11 보류 선반 — **되돌릴 수 있는 유일한 자리** ─────────────────────────────
          러너에서 뺀 챕터는 큐에서 사라지므로, 여기 목록이 없으면 사용자 입장에서 '보류'와
          '조용한 삭제'가 구분되지 않는다. 이 탭인 이유: 복습 부하를 묻는 화면이고, "왜 예보가
          가벼워졌지"의 답이 정확히 이 줄이다.
          ⚠ 자동 만료를 두지 않으므로(P-9 와 같은 규칙) 이 선반은 **비지 않는다** — 그래서
            상시 노출이 아니라 있을 때만 그린다. */}
      {held.length > 0 && (
        <details className="ds-note m-0!">
          <summary className="cursor-pointer text-xs font-bold text-txt">
            복습에서 뺀 챕터 {held.length}개 — 되돌리기
          </summary>
          <ul className="m-0! mt-1.5 flex list-none flex-col gap-1 p-0!">
            {held.map((h) => (
              <li key={`${h.sid}|${h.chapter}`} className="m-0! flex items-center gap-2">
                <span className="ds-shed flex-1 truncate text-xs">
                  {h.name ?? '(없어진 과목)'} · {h.chapter}
                </span>
                <span className="text-2xs text-mut">{h.ds}</span>
                <Button
                  sm
                  variant="ghost"
                  onClick={() =>
                    mutate((st) => {
                      releaseReview(st, h.sid, h.chapter);
                    })
                  }
                >
                  되돌리기
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0">
          복습 부하 예보{' '}
          <span className="ds-tiny text-mut">
            — 앞 {FORECAST_HORIZON}일 볼트 챕터. 막대 = 복습 블록(1블록 {revMin}분) · 점선 = 그날 가용
          </span>
        </h2>
        {ankiDue != null && (
          <span className="ds-tiny text-mut">Anki 미래 due 는 Anki 가 소유 — 여기 막대는 볼트 챕터만</span>
        )}
      </div>

      <div className={CHART}>
        {forecast.map((d) => (
          <DayColumn key={d.ds} d={d} axisMax={axisMax} />
        ))}
      </div>

      {/* 이름 있는 status — 셸에 sr-only status 영역이 상시 둘(App.tsx) 있어 무명이면 구분이 안 된다. */}
      {firstOver && (
        <div className={OVER_STRIP} role="status" aria-label="가용 초과">
          <span className="ds-tiny font-bold text-bad">
            <Icon name="alert" /> {short(firstOver.ds)} ({DOW[firstOver.wd]}) 복습 {firstOver.blocks}블록 · 가용{' '}
            {firstOver.capBlocks}블록
            {overDays.length > 1 && ` · 외 ${overDays.length - 1}일 초과`}
          </span>
          {pull.length > 0 && (
            <span className="ds-tiny flex flex-wrap items-center gap-1.5 text-mut">
              앞당길 후보 —
              {pull.map((p) => (
                <button
                  key={weakKey(p.chapter.sid, p.chapter.chapter)}
                  type="button"
                  className={PULL_CHIP}
                  onClick={() => pullTo(p)}
                  title={`${toLabel(p.toOffset)}에 ${revMin}분 복습 블록으로 넣습니다(그날은 수동 편집 모드가 됩니다)`}
                >
                  {p.chapter.subject} {p.chapter.chapter} → {toLabel(p.toOffset)}
                </button>
              ))}
            </span>
          )}
        </div>
      )}

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
