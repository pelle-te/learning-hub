/* ============================================================
   phone/PhoneApp.tsx — 폰 앱의 셸(C-6).

   데스크톱 셸(`app/App.tsx` + TopBar + RailSidebar + SubTabs + 라우터)을 안 쓴다. 폰은
   탭이 둘(일·주)뿐이라 라우터를 들일 이유가 없고, `react-router-dom` 을 안 끌면 번들에서
   그만큼이 빠진다 — 예산이 데스크톱과 합산되므로(§ `scripts/bundle-budget.mjs`) 이건
   취향이 아니라 제약이다.
============================================================ */
import { useEffect, useState } from 'react';
import { addDays, iso, parseISO, todayISO } from '@/lib/utils';
import { useApp } from '@/store/useApp';
import { isDurable } from '@/lib/db/browserDb';
import DayView from './DayView';
import WeekView from './WeekView';
import { sync } from './sync';

type View = 'day' | 'week';

export default function PhoneApp(): React.JSX.Element {
  const today = useApp((s) => todayISO(s.state));
  const [ds, setDs] = useState(today);
  const [view, setView] = useState<View>('day');
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    void sync().then((r) => {
      if (r.status === 'failed') setStatus(r.error ?? '동기화 실패');
      else setStatus(null);
    });
  }, []);

  const shift = (n: number): void => setDs((d) => iso(addDays(parseISO(d), n)));

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-line bg-bg">
        <div className="flex items-center justify-between px-2 py-2">
          <button
            type="button"
            aria-label="이전"
            onClick={() => shift(view === 'day' ? -1 : -7)}
            className="min-h-11 px-3"
          >
            ‹
          </button>
          <div className="flex gap-1" role="tablist">
            {(['day', 'week'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={`min-h-11 rounded-md px-4 text-sm ${view === v ? 'bg-acc text-on-acc' : 'text-mut'}`}
              >
                {v === 'day' ? '일' : '주'}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label="다음"
            onClick={() => shift(view === 'day' ? 1 : 7)}
            className="min-h-11 px-3"
          >
            ›
          </button>
        </div>

        {/* ⚠ 영속 실패는 말한다 — OPFS 를 못 잡으면 새로고침 한 번에 오프라인 캐시가 증발한다.
            조용히 두면 "저장되는 것처럼 보이면서 아무것도 안 쓰는" 상태가 된다. */}
        {!isDurable() ? (
          <p role="status" className="px-3 pb-2 text-xs text-warn">
            이 브라우저에선 오프라인 저장을 못 써요 — 새로고침하면 캐시가 사라집니다.
          </p>
        ) : null}
        {status ? (
          <p role="status" className="px-3 pb-2 text-xs text-bad">
            {status}
          </p>
        ) : null}
      </header>

      {view === 'day' ? (
        <DayView ds={ds} />
      ) : (
        <WeekView
          ds={ds}
          onPick={(d) => {
            setDs(d);
            setView('day');
          }}
        />
      )}
    </div>
  );
}
