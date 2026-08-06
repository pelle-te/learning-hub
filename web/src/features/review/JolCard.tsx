/* ============================================================
   JolCard — **T-9 지연 JOL**(하루 한 문항). 주간 리뷰의 조건부 한 줄.

   ## 왜 여기(주간 리뷰)인가

   러너(`review-run`)는 안 된다 — 거기서 물으면 **묻고 바로 푸는** 것이라 즉시 JOL 이고,
   그건 이미 있다(`ID-11`). 지연 JOL 의 값은 *판단과 인출 사이에 거리가 있다*는 것 하나에서
   나온다. 리뷰는 인출 화면이 아니면서 매주 열리는 곳이라 그 거리를 공짜로 준다.

   ## ⚠ 이 카드는 **대개 안 그려진다**

   물을 것이 없거나(지연 조건 미달) 오늘 이미 물었거나 미해소 예측이 남아 있으면 `null` 이다.
   조건부라는 것이 곧 "하루 한 문항"의 시각적 표현이고, 항상 떠 있으면 그건 설문이다.

   판정은 전부 `lib/delayedJol` 이 한다 — 특히 **해소를 여기서 계산하지 않는다**(그 파일이
   `blankResults` 에서 파생한다 · 그래야 예측이 인출을 오염시키지 않는다).
============================================================ */
import { useApp } from '@/store/useApp';
import { askToday, jolAccuracy, pendingAsks, recordAsk } from '@/lib/delayedJol';
import { rid } from '@/lib/utils';
import { useTodayISO } from '@/hooks/useTodayISO';
import { Button, Pill } from '@/components/ui';

export default function JolCard() {
  const state = useApp((s) => s.state);
  const mutate = useApp((s) => s.mutate);
  /* ⚠ **`todayISO` 가 아니라 `useTodayISO` 다**(H-17 · 2026-08-06 감사). 이 카드는 렌더에서
     `ds` 를 캡처하고 **핸들러가 그 값으로 쓴다**(`recordAsk(... ds ...)`) — 주간 리뷰를 열어 둔
     채 자정을 넘겨 답하면 **어제 날짜에 기록**되고, 그러면 `askToday` 가 "오늘 이미 물었다"로
     읽어 오늘 문항이 조용히 사라진다. `RitualCard` 가 물렸던 것과 **같은 형태**이고, 그때
     처방으로 만든 훅이 여기엔 안 붙어 있었다(채택 5/34). */
  const ds = useTodayISO(state);
  const ask = askToday(state, ds);
  const pending = pendingAsks(state);
  const acc = jolAccuracy(state);
  const sidName = (sid: string): string => state.items.find((i) => i.id === sid)?.name ?? '(지워진 과목)';

  // 물을 것도, 기다리는 것도, 말할 정확도도 없으면 **아무것도 안 그린다**.
  if (!ask && !pending.length && !acc) return null;

  return (
    <div className="ds-rule">
      <h3 className="ds-caps mb-2!">기억 예측</h3>

      {ask && (
        <>
          <p className="m-0 text-md leading-body">
            <b>{sidName(ask.sid)}</b> · {ask.chapter} — {ask.daysSince}일 전에 봤어요. 지금 떠올릴 수 있을까요?
          </p>
          <div className="mt-2.5 flex gap-2">
            {[true, false].map((yes) => (
              <Button
                key={String(yes)}
                sm
                variant={yes ? 'primary' : 'ghost'}
                onClick={() =>
                  mutate((st) => {
                    recordAsk(st, { id: rid(), ds, sid: ask.sid, chapter: ask.chapter, predicted: yes });
                  })
                }
              >
                {yes ? '떠오를 것 같다' : '아마 못 할 것 같다'}
              </Button>
            ))}
          </div>
          {/* 왜 채점이 지금 안 나오는지 말한다 — 안 적으면 "눌렀는데 아무 일도 안 났다"가 된다. */}
          <p className="ds-tiny mt-2 text-mut">
            채점은 <b>다음에 이 챕터를 실제로 인출할 때</b> 자동으로 붙어요.
          </p>
        </>
      )}

      {!ask && pending.length > 0 && (
        <p className="m-0 text-md leading-body">
          <b>{sidName(pending[0]!.sid)}</b> · {pending[0]!.chapter} 예측이 채점을 기다리는 중이에요 — 그 챕터를 한 번
          인출하면 결과가 붙습니다.
        </p>
      )}

      {acc && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Pill tiny tone={acc.hit * 2 >= acc.n ? 'good' : 'warn'}>
            {acc.hit}/{acc.n} 적중
          </Pill>
          {/* ⚠ 과신을 **1급으로** 말한다 — 즉시 JOL 이 체계적으로 만드는 방향이 이쪽이라,
              같은 크기로 뭉뚱그리면 이 기능이 재려던 것이 안 보인다. */}
          {acc.over > 0 && (
            <Pill tiny tone="bad">
              된다고 했는데 안 된 것 {acc.over}
            </Pill>
          )}
          {acc.under > 0 && <span className="ds-tiny text-mut">안 된다고 했는데 된 것 {acc.under}</span>}
        </div>
      )}
    </div>
  );
}
