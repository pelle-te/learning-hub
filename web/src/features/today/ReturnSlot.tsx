/* ============================================================
   ReturnSlot — 복귀 자리 **하나**(P-1 · 2026-08-01).

   종전엔 이 자리에 `ResumeChip` 만 있었고, 그건 TTL 6시간짜리라 **대부분의 시간엔 비어
   있었다** — 그리고 정작 "며칠 만에 열었다"는 복귀에는 정의상 존재하지 않았다.
   그래서 자리를 지우지 않고 **상위집합으로 승격**한다:

     부재 브리핑(며칠 비었나 · 그 사이 무엇이 늘었나)  ▸ 있으면 이것
     이어하기 칩(다른 기기의 살아 있는 커서)          ▸ 아니면 이것
     아무것도                                          ▸ 둘 다 없으면 노드 자체가 없다

   ⚠ 둘을 **동시에 그리지 않는다.** 형상이 같은 칩 둘이 한 구석에 겹치면 그건 칩이 아니라
   목록이고, 두 문장은 시제가 다르다(며칠 전 / 여섯 시간 안). 브리핑이 이기는 이유는
   **부재가 더 긴 시제**라서다 — 4일 만에 열었는데 6시간 커서가 살아 있을 수는 없다
   (겹치는 경우가 원리적으로 거의 없고, 겹치면 더 큰 사실이 이긴다).

   ⚠ 판정·문장은 전부 `lib/absence` 가 소유한다(판정=lib · 그리기=components 규율).
   여기서 하는 일은 **원장 읽기 한 번**과 지금 값 조립뿐이다.
============================================================ */
import { useEffect, useState } from 'react';
import { useApp } from '@/store/useApp';
import { useSchedule, selectRiskSummary } from '@/store/selectors';
import { isDone } from '@/lib/persistence';
import { deadlineDdays } from '@/lib/scheduleView';
import { todayISO } from '@/lib/utils';
import {
  loadAbsence,
  loadOutside,
  missedSince,
  returnBriefing,
  type AbsenceOutside,
  type AbsenceSnapshot,
  type PlannedBlock,
} from '@/lib/absence';
import ResumeChip from './ResumeChip';
import { Icon } from '@/components/Icon';

const BRIEF =
  'inline-flex max-w-[var(--brief-max)] items-center gap-2 rounded-chip border border-line-acc-pill bg-tint-acc-9 px-3 py-1.5 text-sm leading-auto font-bold text-ink';

export default function ReturnSlot() {
  const state = useApp((s) => s.state);
  const res = useSchedule();
  const ds = todayISO(state);
  const [snap, setSnap] = useState<AbsenceSnapshot | null>(null);
  const [outside, setOutside] = useState<AbsenceOutside | null>(null);
  /* 원장 읽기는 **마운트 1회**다 — 부재 길이는 하루 안에 안 변하고, 이 화면은 집중 세션 중
     초당 리렌더한다(`useAdaptiveTick`). 매 렌더에 두 쿼리를 쏘면 관측이 관측 대상보다 비싸진다. */
  useEffect(() => {
    let live = true;
    void loadAbsence(ds).then((s) => {
      if (!live) return;
      setSnap(s);
      /* T-11 — 밖에서 일어난 일은 **부재가 확정된 뒤에만** 묻는다. 볼트 순회와 AnkiConnect 는
         둘 다 앱 밖으로 나가는 호출이라, 어제 앱을 연 사람에게까지 쏘면 매일 부팅마다 값 없는
         IO 가 된다(브리핑 자체가 안 그려지는 경우다). */
      if (s.lastDs)
        void loadOutside(s.lastDs, ds).then((o) => {
          if (live) setOutside(o);
        });
    });
    return () => {
      live = false;
    };
  }, [ds]);

  if (!snap?.lastDs) return <ResumeChip />;

  const blocks: PlannedBlock[] = res.days.flatMap((d) =>
    d.items.map((it) => ({ ds: d.ds, done: isDone(state, d.ds, it.sid, it.type) })),
  );
  const risk = selectRiskSummary(state);
  const nearest = deadlineDdays(res.itemStat, ds)[0] ?? null;
  const brief = returnBriefing(
    snap,
    {
      review: risk.overdue + risk.due,
      missed: missedSince(blocks, snap.lastDs, ds),
      deadline: nearest ? { name: nearest.name, dday: nearest.dday } : null,
    },
    ds,
    outside,
  );
  if (!brief) return <ResumeChip />;
  return (
    <p role="status" className={BRIEF} title={brief.aria}>
      <Icon name="arrowReturn" />
      <span aria-hidden="true">{brief.line}</span>
      {/* Q-29 — 숫자 뒤에 **하라는 말**. 강조 색을 주는 이유: 이 칩에서 유일하게 *행동*인 조각이
          숫자들 사이에 끼면 다시 나열의 일부로 읽힌다. */}
      <b aria-hidden="true" className="text-acc">
        {brief.advice}
      </b>
      <span className="sr-only">{brief.aria}</span>
    </p>
  );
}
