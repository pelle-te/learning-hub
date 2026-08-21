/* ============================================================
   CutCard — **"못 끝내요" 경고의 잘린 반대편 가지**(P-9 · 2026-08-01).

   ## 왜 이것이 존재하는가

   `engine.ts` 는 마감까지의 부족분을 **이미 계산하고 있었다.** 그런데 그 앎의 유일한 표면이
   `Schedule.tsx` 의 회색 텍스트 한 줄이었고, 유일한 처방이 `주당 시간↑` 이었다 — **사용자가 할
   수 없는 것**이다(하루는 24시간이고 그 배분은 이미 꽉 차 있다). 즉 앱은 부족분을 알면서
   사용자를 labor-in-vain 쪽으로 밀고 있었다: 어려운 항목에 시간을 크게 더 써도 회상 확률은 거의
   오르지 않으므로, 학습시간 배분은 "무엇을 공부할까"뿐 아니라 **"공부를 할까 말까"의 결정**을
   포함해야 한다(Metcalfe 2002 · 확인 2026-08-01).

   ## 이것은 없는 결정을 새로 만드는 게 아니다

   ⚠⚠ **앱은 이미 조용히 버리고 있다.** EDF 로 채우다 마감 창이 끝나면 뒤쪽 챕터가 그냥 안
   배치된다 — 기준이 "순서가 뒤"라서, 사용자가 무엇을 포기했는지 모르는 채 포기당한다. 이 카드는
   **이미 내려지고 있는 결정을 사용자에게 돌려주는 것**이다. 그래서 이름이 '추가 기능'이 아니라
   '반대편 가지'다.

   ## 세 가지 설계 조건 — 어기면 이 화면은 해롭다

   1. **삭제가 아니라 "이번 범위에서 제외"다.** 삭제로 만들면 아무도 안 누른다(로드맵이 이걸
      설계 조건으로 못박았다). 챕터는 목록에 남고 스케줄러만 이번 회차에서 뺀다 → `deferred`.
   2. **컷 순서를 학습과학으로 정당화하지 않는다.** 트리아지 문헌은 _"아는 것을 건너뛰라"_ 고
      하고(Iowa) 깊이-넓이 문헌은 반대를 시사한다(Schwartz 2009) — **두 근거가 정면으로 갈린다.**
      그래서 v1 의 규칙은 방어 가능한 산술 하나(`남은 시간 큰 것부터`)이고, **그 규칙을 화면에
      적어 사용자가 뒤집게** 한다. 근거 없이 똑똑한 척하는 순위가 이 축에서 가장 위험하다.
   3. **초과하는 날에만 존재한다.** "버려라"를 매일 말하면 그게 새 죄책감 더미가 된다(alert
      fatigue). 문구도 실패가 아니라 처방으로 쓴다.

   ⚠ 로드맵 목업의 푸터는 _"빠진 챕터는 마감 뒤로 밀립니다"_ 였는데 **그렇게 안 적었다.** 엔진의
     `_dlIdx` 가 마감 이후 날짜에는 그 과목의 블록을 아예 안 만들어서, 지금 코드로는 그 문장이
     참이 아니다(별개의 선존 결함이고 이 항목의 범위 밖이다). 화면에는 실제로 참인 것만 적는다 —
     "이번 계획에서 빠지고, 챕터 목록에서 되돌릴 수 있다".
============================================================ */
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui';
import { round1 } from '@/lib/utils';
import { shortfallDelta, simulate } from '@/lib/scheduler';
import type { AppState, Shortfall } from '@/lib/types';

type Mutate = (recipe: (st: AppState) => void) => void;

/** 접힘 애니 길이(ms) — CSS `.ds-shedding`(= `shed-row` · `--dur-fast`)와 짝.
 *  ⚠ 토스트가 쓰는 것과 같은 패턴이다: 애니를 CSS 가 그리고 언마운트만 여기서 미룬다. */
const SHED_MS = 120;

/** ⚠⚠ **`hNum` 을 쓰지 않는다 — 그건 *분*을 받는다**(실렌더로 잡았다 · §15-4).
 *  `Shortfall` 의 값은 전부 **시간(h)** 이라(엔진이 `round1(_scopeH)` 로 낸다) `h(22)` 는
 *  `0.4` 를 그린다. 첫 판이 정확히 그랬고 — 타입은 둘 다 `number` 라 통과하고, 유닛 테스트는
 *  엔진만 보므로 통과하고, 스냅샷은 그 상을 정답으로 굳혔을 것이다. 눈으로 보기 전엔 못 잡는다. */
const h = (v: number): string => String(round1(v));

export function CutCard({
  sf,
  mutate,
  state,
  before,
}: {
  sf: Shortfall;
  mutate: Mutate;
  /** I018 — 시뮬레이션 입력. 화면이 상태를 바꾸지 않는다(`simulate` 가 가지만 복제한다). */
  state: AppState;
  /** 패치 **전**의 부족분 전량 — 부수 피해(다른 과목이 새로 열림)를 판정하는 분모. */
  before: readonly Shortfall[];
}) {
  // 기본 선택 = 엔진이 규칙대로 고른 최소 접두. 사용자가 그대로 두든 뒤집든 **화면에 규칙이 적혀
  // 있으므로** 결과를 보고 이야기를 지어낼 여지가 없다.
  const [picked, setPicked] = useState<Set<string>>(() => new Set(sf.suggest));
  const [shedding, setShedding] = useState(false);

  const pickedH = sf.candidates.filter((c) => picked.has(c.id)).reduce((t, c) => t + c.hours, 0);
  /* ⚠⚠ **`pickedH >= gapH` 는 근사였다**(I018 · 2026-08-22). 배치는 합이 아니다 — 하루 상한 ·
     복습 예산 · 다른 과목과의 경쟁이 있어서 같은 시간을 빼도 안 닫히거나, 닫히는 대신 **다른
     과목의 부족분이 새로 열린다.** 엔진이 그 답을 이미 알고 있고 아무도 두 번째로 묻지
     않았을 뿐이다. 근거 전문은 `lib/scheduler/simulate.ts` 머리주석. */
  const sim = useMemo(
    () =>
      picked.size
        ? shortfallDelta(before, simulate(state, { defer: { sid: sf.sid, chapterIds: picked } }).shortfalls, sf)
        : null,
    [state, before, sf, picked],
  );
  const covers = sim?.closed ?? false;

  const toggle = (id: string): void =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  /** 확정 — 고른 챕터에 `deferred` 를 찍는다. 카드는 자기 자리째 접히며 사라진다(`shed`):
   *  부족분이 닫혔다는 사실 자체가 피드백이므로 토스트 문구가 그걸 혼자 지지 않아도 된다. */
  const commit = (): void => {
    setShedding(true);
    const ids = new Set(picked);
    window.setTimeout(() => {
      mutate((st) => {
        const it = st.items.find((x) => x.id === sf.sid);
        if (!it) return;
        it.chapters.forEach((c) => {
          if (ids.has(c.id)) c.deferred = true;
        });
      });
    }, SHED_MS);
  };

  return (
    <section
      /* ⚠ **상한과 `flex-none` 이 필요하다**(실렌더로 잡았다). 이 카드는 fill 프레임(`h-full`)
         위에 끼어드는 인터럽트라, 상한이 없으면 아래 주간 캘린더의 몫을 그대로 먹어 **격자가
         잘린 채** 렌더된다(후보가 20장이면 캘린더가 통째로 사라진다). 결정을 요구하는 카드가
         결정의 근거인 화면을 지우면 안 된다 — 목록만 스크롤시켜 카드 높이를 고정한다. */
      className={`ds-board mt-3 flex flex-none flex-col gap-2 ${shedding ? 'ds-shedding' : ''}`}
      aria-label={`${sf.name} 범위 조정`}
      style={{ borderColor: 'color-mix(in srgb, var(--warn) 34%, var(--line))' }}
    >
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span aria-hidden="true" className="size-2 rounded-full" style={{ background: sf.color || 'var(--warn)' }} />
        <b className="text-sm font-extrabold text-ink">{sf.name}</b>
        <span className="text-xs text-mut">
          마감 {sf.deadline} · {sf.scoped ? '시험 범위' : '남은 챕터'} {h(sf.needH)}h / 가능 {h(sf.fitH)}h
        </span>
        <b className="ml-auto text-sm font-extrabold text-warn">{h(sf.gapH)}h 부족</b>
      </header>

      {/* 규칙을 결과보다 먼저 적는다 — 2주 뒤에 숫자를 보고 이야기를 지어내지 않기 위해서(P-4 가
          `markets` 판정에 쓴 것과 같은 규율). */}
      <p className="m-0! text-xs leading-body text-mut">
        이번 범위에서 빼면 들어와요 — 규칙: <b className="font-bold text-txt">남은 시간 큰 것부터</b>. 직접 골라도 돼요.
      </p>

      <ul className="m-0! flex max-h-36 [scrollbar-width:thin] list-none flex-col gap-0 overflow-y-auto p-0!">
        {sf.candidates.map((c) => {
          const on = picked.has(c.id);
          return (
            <li key={c.id} className="m-0!">
              <label className="flex! cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 hover:bg-panel">
                <input type="checkbox" checked={on} onChange={() => toggle(c.id)} />
                <span className={`flex-1 truncate text-xs ${on ? 'ds-shed' : 'text-txt'}`}>{c.name}</span>
                <span className={`text-xs tabular-nums ${on ? 'ds-shed' : 'text-mut'}`}>{h(c.hours)}h</span>
              </label>
            </li>
          );
        })}
      </ul>

      <footer className="flex flex-wrap items-center gap-2">
        <Button sm variant="primary" disabled={picked.size === 0} onClick={commit}>
          이번 범위에서 빼기
        </Button>
        {/* ⚠ 남은 부족분을 **엔진이 낸 수**(`sim.gapH`)로 말한다. 종전엔 `gapH - pickedH` 라
            산술이 답했고, 그 둘은 자주 다르다. */}
        <span className="text-xs text-mut">
          {picked.size === 0
            ? '뺄 챕터를 고르세요'
            : covers
              ? `고른 ${h(pickedH)}h 로 부족분이 닫혀요`
              : `고른 ${h(pickedH)}h — 다시 짜 보면 ${h(sim?.gapH ?? sf.gapH)}h 가 남아요`}
        </span>
        {/* ⚠⚠ 부수 피해를 **먼저** 말한다. 안 그러면 사용자는 챕터를 뺀 다음 다른 카드가 새로
            뜨는 것을 자기 탓으로 읽는다(그건 이 카드가 만들려던 것의 정반대다). */}
        {sim && sim.collateral.length > 0 && (
          <span className="w-full text-xs text-warn">
            대신 {sim.collateral.map((c) => `${c.name}(${c.examLabel}) +${h(c.addedH)}h`).join(' · ')} 가 부족해져요
          </span>
        )}
        <span className="ml-auto text-2xs text-mut">삭제가 아니에요 · 챕터 목록에서 되돌릴 수 있어요</span>
      </footer>
    </section>
  );
}
