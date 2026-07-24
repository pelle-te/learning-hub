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
import ReadsView from './ReadsView';
import ReviewView from './ReviewView';
import { sync } from './sync';

type View = 'day' | 'week' | 'review' | 'reads';
const VIEW_LABEL: Record<View, string> = { day: '일', week: '주', review: '복습', reads: '읽기' };
/** 날짜 이동이 의미 있는 뷰 — 복습·읽을거리는 날짜 축이 아니라 '오늘/가장 최근' 하나다. */
const DATED: View[] = ['day', 'week'];

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
        {/* ⚠ 날짜 화살표는 날짜 축이 있는 뷰에서만 **자리를 유지한 채** 비활성이 아니라
            아예 숨긴다 — 읽을거리에는 이전/다음 날이 없고, 눌러도 아무 일이 없는 버튼을
            남기면 "고장난 화살표"가 된다. 가운데 탭 묶음이 밀리지 않게 폭만 예약한다. */}
        <div className="flex items-center justify-between px-2 py-2">
          <span className="w-11">
            {DATED.includes(view) ? (
              <button
                type="button"
                aria-label="이전"
                onClick={() => shift(view === 'day' ? -1 : -7)}
                className="min-h-11 px-3"
              >
                ‹
              </button>
            ) : null}
          </span>
          {/* ⚠ role="tablist"/"tab" 이 **아니다**. 그건 tabpanel 연결(aria-controls)·화살표 이동·
              roving tabindex 까지 약속하는 계약인데 이 스위처는 그중 아무것도 이행하지 않아
              SR 사용자에게 "탭 1/3"이라 읽히고도 갈 패널을 못 찾게 한다(미완성 tab 롤은 순수
              버튼보다 나쁘다). 데스크톱 RailSidebar·Schedule 세그먼트가 같은 이유로 내린 판단
              (group + aria-pressed)을 그대로 쓴다. */}
          <div className="flex gap-1" role="group" aria-label="화면 전환">
            {(['day', 'week', 'review', 'reads'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={`min-h-11 rounded-md px-4 text-sm ${view === v ? 'bg-acc text-on-acc' : 'text-mut'}`}
              >
                {VIEW_LABEL[v]}
              </button>
            ))}
          </div>
          <span className="w-11 text-right">
            {DATED.includes(view) ? (
              <button
                type="button"
                aria-label="다음"
                onClick={() => shift(view === 'day' ? 1 : 7)}
                className="min-h-11 px-3"
              >
                ›
              </button>
            ) : null}
          </span>
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

      {view === 'day' ? <DayView ds={ds} /> : null}
      {view === 'week' ? (
        <WeekView
          ds={ds}
          onPick={(d) => {
            setDs(d);
            setView('day');
          }}
        />
      ) : null}
      {view === 'review' ? <ReviewView /> : null}
      {view === 'reads' ? <ReadsView /> : null}
    </div>
  );
}
