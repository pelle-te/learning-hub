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
import { useSwipe } from '@/hooks/useSwipe';
import { isDurable } from '@/lib/db/browserDb';
import TodayView from './TodayView';
import DayView from './DayView';
import WeekView from './WeekView';
import ReadsView from './ReadsView';
import ReviewView from './ReviewView';
import { sync } from './sync';

type View = 'today' | 'day' | 'week' | 'review' | 'reads';
const VIEW_LABEL: Record<View, string> = { today: '홈', day: '일', week: '주', review: '복습', reads: '읽기' };
const VIEWS = ['today', 'day', 'week', 'review', 'reads'] as const;
/** 날짜 이동이 의미 있는 뷰 — 홈·복습·읽을거리는 날짜 축이 아니라 '오늘/가장 최근' 하나다. */
const DATED: View[] = ['day', 'week'];

export default function PhoneApp(): React.JSX.Element {
  const today = useApp((s) => todayISO(s.state));
  const [ds, setDs] = useState(today);
  const [view, setView] = useState<View>('today'); // 열면 홈 대시보드가 먼저
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    void sync().then((r) => {
      if (r.status === 'failed') setStatus(r.error ?? '동기화 실패');
      else setStatus(null);
    });
  }, []);

  const shift = (n: number): void => setDs((d) => iso(addDays(parseISO(d), n)));

  /* UX-B3 날짜 좌우 스와이프 — 지금까지 날짜 이동은 상단 ‹› 뿐이었다. 폰에서 그 두 버튼은
     화면 최상단 양 끝(엄지가 가장 못 닿는 곳)이라, 날짜를 훑는 동작이 매번 손을 고쳐 쥐게 했다.
     ⚠ 화살표는 그대로 둔다 — 스와이프는 어포던스가 숨어 있고 키보드·SR 에는 닿지 않는다.
     ⚠ 날짜 축이 없는 뷰(홈·복습·읽기)에는 아예 안 건다. 걸어 두면 아무 일도 안 하는 손짓이
       "고장난 스와이프"로 읽힌다(위 ‹› 를 숨기는 것과 같은 판단). */
  const dated = DATED.includes(view);
  const swipe = useSwipe({
    onSwipeLeft: dated ? () => shift(view === 'day' ? 1 : 7) : undefined,
    onSwipeRight: dated ? () => shift(view === 'day' ? -1 : -7) : undefined,
  });

  return (
    /* ⚠ flex 컬럼 + `flex-1` 본문이 **하단 탭바가 실제로 바닥에 붙는 조건**이다.
       `sticky bottom-0` 만으로는 내용이 짧은 화면(복습 완료·빈 날)에서 탭바가 본문 바로 아래
       중간 높이에 뜬다 — sticky 는 '흐름상 위치가 뷰포트 밖일 때만' 붙잡기 때문이다. */
    <div className="flex min-h-dvh flex-col">
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
          {/* 상단 가운데는 이제 '지금 어느 화면인가'만 말한다 — 전환은 하단 탭바(UX-B1)가 갖는다. */}
          <span className="text-sm font-semibold text-txt">{VIEW_LABEL[view]}</span>
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

      {/* ⚠ 스와이프는 **본문에만** 건다(헤더·탭바 제외) — 탭바 위 손짓까지 날짜를 옮기면
          탭을 고르려다 날짜가 바뀐다. */}
      <main {...swipe} className="flex-1">
        {view === 'today' ? <TodayView onGo={setView} /> : null}
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
      </main>

      {/* UX-B1 하단 탭바 — 5탭 스위처가 화면 최상단에 있었다. 폰을 한 손으로 쥐면 거기가
          엄지가 가장 못 닿는 지대다(iOS·안드로이드가 나란히 하단으로 내려간 이유). "지하철에서
          5분" 이 이 앱 폰 화면의 전제라, 가장 자주 누르는 것이 가장 닿기 쉬운 곳에 있어야 한다.
          ⚠ role/aria 는 그대로 group + aria-pressed 다 — 위치만 옮기고 계약은 안 건드린다.
          ⚠ 안전영역은 `pb-safe-b` 토큰(= 기본 패딩 + env(safe-area-inset-bottom)). */}
      <nav
        className="sticky bottom-0 z-10 flex justify-around border-t border-line bg-bg px-2 pt-2 pb-safe-b"
        role="group"
        aria-label="화면 전환"
      >
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => setView(v)}
            className={`min-h-11 flex-1 rounded-md px-2 text-sm ${view === v ? 'bg-acc text-on-acc' : 'text-mut'}`}
          >
            {VIEW_LABEL[v]}
          </button>
        ))}
      </nav>
    </div>
  );
}
