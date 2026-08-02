/* ============================================================
   PhaseBoard — **학기의 경계**를 그리는 한 판(T-4 국면 전환 · T-15 개강 리허설 · T-16 부하 시뮬).

   ## 왜 여기(졸업 계획 탭)인가

   셋 다 **학기 날짜**를 입력으로 쓰고, 그 날짜를 넣는 화면이 여기다. 오늘 탭에 두면 학기 밖
   364일 중 350일 동안 "지금은 그 국면이 아니에요"만 그리게 된다 — 오늘 탭은 *오늘*의 화면이지
   *올해*의 화면이 아니다(각도 3 이 짚은 "시그니처 7종이 전부 지금 상태"의 반대편 함정).

   ## 국면마다 다른 것을 그린다 — 빈 카드를 그리지 않는다

   - `pre`(개강 전): 램프(하루 N분이면 밀림 0) + D-14 안쪽이면 리허설 + 부하 시뮬
   - `in`(학기 중): 이 판은 **자기를 접는다.** 학기 중 처방은 계획이 소유하고(두 벌 금지),
     여기 남는 것은 종강 D-day 한 줄뿐이다.
   - `off`(학기 미정): 지금이 그 상태다 — 수를 지어내지 않고 **무엇을 넣어야 수가 나오는지**를
     말한다. 이 화면이 그 입력을 가진 자리라 처방과 조치가 한 화면에 있다.

   ⚠ **판정은 전부 lib 이 한다**(`lib/phaseRamp` · `lib/semesterEntry`). 여기는 그리기만 —
   문구조차 `advice` 로 받는다(화면마다 문구를 새로 지으면 같은 상태를 다르게 말하게 된다).
============================================================ */
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/useApp';
import { phaseRamp, staleSemesterLinks } from '@/lib/phaseRamp';
import { rehearsalSteps, simulateSemester } from '@/lib/semesterEntry';
import { hNum, todayISO } from '@/lib/utils';
import { useSchedule } from '@/store/selectors';
import StrataStrip from '@/components/StrataStrip';
import { Button, Pill } from '@/components/ui';

/** 부하 비율의 어휘. **1.0 이 벽이 아니라 0.85 가 벽이다** — 계획은 늘 100% 로 차지 않는다. */
function loadTone(ratio: number): { tone: 'good' | 'warn' | 'bad'; label: string } {
  if (!Number.isFinite(ratio)) return { tone: 'bad', label: '가용 시간 0' };
  if (ratio > 1) return { tone: 'bad', label: '주당 시간이 모자라요' };
  if (ratio > 0.85) return { tone: 'warn', label: '빠듯해요' };
  return { tone: 'good', label: '감당 돼요' };
}

export default function PhaseBoard() {
  const state = useApp((s) => s.state);
  const navigate = useNavigate();
  const res = useSchedule();
  const ds = todayISO(state);
  const ramp = phaseRamp(state, ds);
  const stale = staleSemesterLinks(state, ds);
  const steps = rehearsalSteps(state, ds);
  const sim = ramp.semester && ramp.kind !== 'off' ? simulateSemester(state, ramp.semester, ds) : null;
  const open = steps.filter((s) => !s.done);

  return (
    <div className="ds-board mb-4! pb-3.5!">
      <div className="mb-3.5 flex items-baseline justify-between gap-3">
        <span className="ds-caps">국면 — PHASE</span>
        <Pill tiny tone={ramp.kind === 'in' ? 'good' : ramp.kind === 'pre' ? 'warn' : undefined}>
          {ramp.kind === 'in' ? '학기 중' : ramp.kind === 'pre' ? `개강 D-${ramp.daysToStart}` : '학기 미정'}
        </Pill>
      </div>

      {/* T-4 — 처방 한 줄. `off` 에서도 **빈 화면이 아니다**(무엇을 넣으면 수가 나오는지 말한다). */}
      <p className="m-0 text-md leading-body">{ramp.advice}</p>
      {ramp.perDayMin !== null && ramp.perDayMin > 0 && (
        <div className="mt-2 flex items-baseline gap-2">
          <b className="text-3xl font-extrabold text-acc tabular-nums">{ramp.perDayMin}</b>
          <span className="text-sm text-mut">분 / 일 · 남은 {hNum(ramp.remainingMin)} h</span>
        </div>
      )}
      {ramp.kind === 'off' && (
        <Button sm variant="primary" className="mt-2.5" onClick={() => navigate('/degree')}>
          아래에서 학기 날짜 넣기
        </Button>
      )}

      {/* T-21 지층 — **학기가 어떻게 흘러왔나**를 12px 한 줄로. 이 앱의 시그니처 7종이 전부
          *지금 상태*였고 시간축이 수개월인 것이 0 이었다(각도 3). 6주 미만이면 스스로 사라진다
          (`lib/series.strata` — 3주짜리 띠는 지층이 아니라 막대 세 개다). */}
      <div className="mt-3">
        <StrataStrip
          matrix={res.weekHours}
          keys={state.items.map((i) => i.id)}
          nameOf={(id) => state.items.find((i) => i.id === id)?.name ?? id}
        />
      </div>

      {/* T-16 — 감당 되나. 근거(`basis`)를 함께 말한다: 근거 없는 수는 믿을지 판단할 수 없다. */}
      {sim && sim.rows.length > 0 && (
        <div className="mt-3.5 border-t border-line pt-3">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <span className="ds-caps">{sim.semester.name || '학기'} 부하</span>
            <Pill tiny tone={loadTone(sim.ratio).tone}>
              {loadTone(sim.ratio).label}
            </Pill>
          </div>
          <div className="flex items-baseline gap-2 text-md">
            <b className="tabular-nums">주 {sim.weeklyH}h</b>
            <span className="text-mut">/ 가용 {sim.capacityH}h</span>
            <span className="ds-tiny text-mut">
              · 총 {sim.totalH}h / {sim.weeks}주
            </span>
          </div>
          <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
            {sim.rows.map((r) => (
              <li key={r.course.id} className="flex items-center gap-2 text-md">
                <span className="min-w-0 flex-1 truncate">{r.course.name || '(이름 없음)'}</span>
                <span className="tabular-nums">{r.estH}h</span>
                {/* 챕터에서 나온 수와 학점 환산은 신뢰도가 다르다 — 같은 픽셀로 그리지 않는다. */}
                <span className="ds-tiny w-11 flex-none text-right text-mut">
                  {r.basis === 'chapters' ? '챕터' : '학점'}
                </span>
              </li>
            ))}
          </ul>
          {sim.rate.basis === 'default' && (
            <p className="ds-tiny mt-1.5 text-mut">
              학점 환산은 기본값({sim.rate.hoursPerCredit}h/학점)이에요 — 한 학기를 끝내면 실투입에서 배웁니다.
            </p>
          )}
        </div>
      )}

      {/* T-15 — 개강 리허설. **줄어드는 것이 정상**이고, 다 하면 이 절이 사라진다. */}
      {open.length > 0 && (
        <div className="mt-3.5 border-t border-line pt-3">
          <div className="ds-caps mb-2">개강 리허설 — 지금 할 수 있는 것</div>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {open.map((s) => (
              <li key={s.id} className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-md font-bold">{s.label}</div>
                  <div className="ds-tiny text-mut">{s.why}</div>
                </div>
                {s.to && (
                  <Button sm variant="ghost" onClick={() => navigate(s.to!)}>
                    →
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* T-4 학기 처분 — 끝난 학기가 아직 분모에 들어 있으면 밀림이 실제보다 커 보인다.
          ⚠ 여기서 아무것도 안 지운다. 결정은 사용자 것이고, **결정할 것이 있다는 사실**만 말한다. */}
      {stale.length > 0 && (
        <div className="mt-3.5 border-t border-line pt-3">
          <div className="ds-caps mb-2">지난 학기 처분 대기</div>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {stale.map((s) => (
              <li key={`${s.semester.id}-${s.item.id}`} className="flex items-center gap-2 text-md">
                <span className="min-w-0 flex-1 truncate">{s.item.name}</span>
                <span className="ds-tiny text-mut">{s.semester.name}</span>
                <Pill tiny tone={s.openChapters ? 'warn' : 'good'}>
                  {s.openChapters ? `${s.openChapters}챕터 남음` : '끝냄'}
                </Pill>
                <Button sm variant="ghost" onClick={() => navigate(`/subject/${s.item.id}`)}>
                  →
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
