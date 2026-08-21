/* ============================================================
   phone/PhoneApp.tsx — 폰 앱의 셸(C-6).

   데스크톱 셸(`app/App.tsx` + TopBar + RailSidebar + SubTabs + 라우터)을 안 쓴다. 폰은
   탭이 둘(일·주)뿐이라 라우터를 들일 이유가 없고, `react-router-dom` 을 안 끌면 번들에서
   그만큼이 빠진다 — 예산이 데스크톱과 합산되므로(§ `scripts/bundle-budget.mjs`) 이건
   취향이 아니라 제약이다.
============================================================ */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { addDays, iso, parseISO, todayISO } from '@/lib/utils';
import { useApp } from '@/store/useApp';
import { useSwipe } from '@/hooks/useSwipe';
import { isDurable } from '@/lib/db/browserDb';
import { isSaveFallback, onSaveFallback } from '@/lib/db/fallback';
import { recordVisit } from '@/lib/visits';
import TodayView from './TodayView';
import DayView from './DayView';
import WeekView from './WeekView';
import ReviewView from './ReviewView';
import LiveRegion from '@/components/LiveRegion';
import SyncLedger from '@/components/SyncLedger';
import ConflictsView from './ConflictsView';
import { useSyncLedger } from '@/store/useSyncLedger';
import CaptureBar from './CaptureBar';
import ExportBackup from './ExportBackup';
import { sync } from './sync';

/* ⚠ **`reads`(읽기) 뷰가 P10 W4 에서 빠졌다**(2026-08-07 · 다섯 → 넷). 폰이 데스크톱 6탭 중
   유일하게 데려간 것이 그 화면이었는데(옛 `tabs.ts` 머리주석), 그건 폰에서 읽기가 자연스러워서지
   그게 *학습 상태*여서가 아니었다 — 지금 그 화면은 `survey/` 사이트에 있다. */
type View = 'today' | 'day' | 'week' | 'review';
const VIEW_LABEL: Record<View, string> = { today: '홈', day: '일', week: '주', review: '복습' };
const VIEWS = ['today', 'day', 'week', 'review'] as const;
/** 날짜 이동이 의미 있는 뷰 — 홈·복습·읽을거리는 날짜 축이 아니라 '오늘/가장 최근' 하나다. */
const DATED: View[] = ['day', 'week'];

/** 폰 상단 — 날짜 화살표 · 화면 이름 · **실패 배너 셋**(정본 연결 · 영속 · 동기화) · 원장.
 *  ⚠ 컴포넌트로 뺀 이유(2026-08-20): `PhoneApp` 인지복잡도의 절반이 이 헤더의 조건부 렌더
 *  일곱이었다. **같은 `<header>` 엘리먼트를 그대로 반환**하므로 렌더 트리는 한 노드도 안 바뀐다
 *  (래퍼를 하나라도 더 두면 그 순간 스냅샷이 안전망이 아니라 공범이 된다 · §15-4). */
function PhoneHeader({
  view,
  status,
  dbBroken,
  ledger,
  shift,
}: {
  view: View;
  status: string | null;
  dbBroken: boolean;
  ledger: ReturnType<typeof useSyncLedger>;
  shift: (n: number) => void;
}): React.JSX.Element {
  return (
    <header className="sticky top-0 z-[var(--z-nav)] border-b border-line bg-bg">
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

      {/* ⚠ 정본 연결 실패도 말한다(C1 · 2026-07-26 감사) — 폰도 SQLite 가 정본이라, 워커가
          죽으면 편집이 아웃박스에 안 걸려 **영원히 동기화되지 않는다**. 데스크톱은 배너
          (`app/StorageBanner`)가 같은 사실을 말한다 — 화면은 갈라도 규칙은 하나다. */}
      {/* ⚠ 리전은 **상시 마운트**한다(H19) — 조건부로 넣으면 리전과 텍스트가 동시에 삽입돼 AT 에 따라 공지가 씹힌다(`SyncLedger` 와 같은 관용구: 보이는 줄은 조건부, 알리는 일만 갈라낸다). */}
      <LiveRegion
        message={dbBroken ? '저장소에 연결하지 못했어요 — 지금 한 편집은 이 기기에만 남고 동기화되지 않습니다.' : ''}
        assertive
      />
      {dbBroken ? (
        <p className="px-3 pb-2 text-xs text-bad">
          저장소에 연결하지 못했어요 — 지금 한 편집은 이 기기에만 남고 동기화되지 않습니다.
        </p>
      ) : null}
      {/* ⚠ 영속 실패는 말한다 — OPFS 를 못 잡으면 새로고침 한 번에 오프라인 캐시가 증발한다.
          조용히 두면 "저장되는 것처럼 보이면서 아무것도 안 쓰는" 상태가 된다. */}
      {!isDurable() ? (
        <p role="status" className="px-3 pb-2 text-xs text-warn">
          이 브라우저에선 오프라인 저장을 못 써요 — 새로고침하면 캐시가 사라집니다.
        </p>
      ) : null}
      <LiveRegion message={status ?? ''} />
      {status ? <p className="px-3 pb-2 text-xs text-bad">{status}</p> : null}
      {/* ⚠ 여기까지는 전부 **실패했을 때만** 말한다(UX-B4 가 지적한 그 비대칭). 성공·오프라인·
          대기 중이 전부 침묵이면 "폰에서 체크한 게 올라갔나?"에 답이 없고, 그 불확실이
          PC 에서의 중복 입력으로 이어진다. 아래 원장이 그 나머지 절반을 상시로 말한다. */}
      <SyncLedger {...ledger} className="px-3 pb-2" />
    </header>
  );
}

export default function PhoneApp(): React.JSX.Element {
  const ledger = useSyncLedger();
  const today = useApp((s) => todayISO(s.state));
  const [ds, setDs] = useState(today);
  /* N-9 — 아이콘 바로가기(`?view=review`)는 그 뷰로 바로 착지한다. 그 외엔 종전대로 홈.
     ⚠ 값 검증을 `VIEWS` 로 한다 — 임의 문자열이 `View` 로 들어오면 탭바가 아무것도 활성으로
     못 그리고, 그 상태는 화면상 "빈 앱"과 구분되지 않는다. */
  const [view, setView] = useState<View>(() => {
    const v = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('view') : null;
    return (VIEWS as readonly string[]).includes(v || '') ? (v as View) : 'today';
  });
  const [status, setStatus] = useState<string | null>(null);
  const dbBroken = useSyncExternalStore(onSaveFallback, isSaveFallback, () => false);

  useEffect(() => {
    void sync().then((r) => {
      if (r.status === 'failed') setStatus(r.error ?? '동기화 실패');
      else setStatus(null);
    });
  }, []);

  /* ⚠ 폰 뷰 방문을 기록한다(H23 · 2026-07-26 감사). `route_visits` 의 존재 이유 셋 중 하나가
     **"폰 뷰 사용 여부"** 인데, 계수기는 `app/App.tsx` 에만 있었고 폰은 `app/` 을 안 쓴다 —
     즉 그 질문에 계측이 도달하지 않은 채 원장만 쌓이고 있었다. 2주 뒤의 0 을 "폰 안 씀"으로
     읽었다면, 이 저장소가 반복해 물린 **"없는 데이터 vs 안 센 데이터"** 를 데이터가 있다는
     이유로 더 자신 있게 틀리는 형태였다. */
  useEffect(() => {
    void recordVisit(view, 'phone');
  }, [view]);

  const shift = (n: number): void => setDs((d) => iso(addDays(parseISO(d), n)));

  /* 뷰를 고르는 **단일 창구**. 뷰만 바꾸는 것이 아니라 그 뷰의 **시작점**까지 정한다 —
     시작점이 뷰 밖에 흩어져 있으면 "어디서 왔느냐"에 따라 화면이 조용히 달라진다.
     ⚠ 홈의 '오늘 일정'은 반드시 **오늘**로 간다. `ds` 는 주·일 뷰 스와이프로 움직이는데
       버튼이 `setView` 만 하면 마지막으로 훑던 다음 주 어느 날이 열리고, 헤더 라벨은 '일'
       이라 날짜를 말하지 않아 본문 제목을 읽기 전엔 알아채지도 못한다.
     ⚠ 이어하기는 **착지 인덱스**를 함께 넘긴다(N-7). 데스크톱이 내비 state 로 하는 일을
       폰은 props 로 한다(라우터가 없다) — 값은 같고 전달 수단만 화면 문법을 따른다.
     ⚠ 탭바로 온 복습은 언제나 0 이다. 안 그러면 한 번 이어한 뒤로는 탭을 눌러도 계속
       중간에서 열려, 이어하기가 *의도*가 아니라 앱의 기본값이 된다. */
  const [reviewStart, setReviewStart] = useState(0);
  /** 탭바 — 뷰만 바꾼다(날짜 축은 사용자가 훑던 자리에 둔다). */
  const goTab = (v: View): void => {
    setReviewStart(0);
    setView(v);
  };
  /** 홈의 다음 행동 — 날짜·시작점까지 정한다. */
  const goFromHome = (v: 'day' | 'review', resumeAt = 0): void => {
    if (v === 'day') setDs(today);
    setReviewStart(v === 'review' ? resumeAt : 0);
    setView(v);
  };

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
      <PhoneHeader view={view} status={status} dbBroken={dbBroken} ledger={ledger} shift={shift} />

      {/* ⚠ **진 편집을 폰에서도 보고 되살린다**(H20 · 2026-07-30). 그림자는 폰에서도 정상
          적재되는데 읽는 화면이 데스크톱에만 있었다 — 하필 폰이 더 자주 지는 쪽이다(짧게 켜고
          끄므로 마지막 저장이 PC 일 확률이 높다). 헤더 **밖**에 두는 것이 의도다: 헤더는
          sticky 라 목록이 길어지면 본문을 덮는다. 충돌이 없으면 아무것도 안 그린다. */}
      {/* ⚠ **폰은 화면·날짜 전환을 한 번도 알리지 않았다**(H22 · 2026-07-30). 데스크톱은 라우트
          아나운서가 그 일을 하는데(SPA a11y 의 어려운 부분은 이미 손으로 해 뒀다) 폰은 라우터가
          없어 `view`·`ds` 가 **상태**로만 바뀐다 — 즉 탭을 누르거나 스와이프해도 스크린리더에는
          아무 일도 안 일어난 것이 된다. 하필 스와이프는 시각적 피드백이 화면 전체라 더 그렇다.
          날짜가 있는 화면은 날짜까지 함께 말한다("주 · 6/15" — 어디로 갔는지가 곧 그 둘이다). */}
      <LiveRegion message={`${VIEW_LABEL[view]}${DATED.includes(view) ? ` · ${ds.slice(5).replace('-', '/')}` : ''}`} />
      <ConflictsView />

      {/* ⚠ 스와이프는 **본문에만** 건다(헤더·탭바 제외) — 탭바 위 손짓까지 날짜를 옮기면
          탭을 고르려다 날짜가 바뀐다. */}
      <main {...swipe} className="flex-1">
        {view === 'today' ? <TodayView onGo={goFromHome} /> : null}
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
        {view === 'review' ? <ReviewView startAt={reviewStart} /> : null}
      </main>

      {/* E14 캡처 바 — 탭바 **위**(엄지 도달권 안, 그러나 내비게이션보다 아래). 이 화면의
          다섯 뷰가 전부 읽기·체크뿐이라 "지하철 5분"에 떠오른 것을 받을 곳이 0이었다. */}
      <CaptureBar />

      {/* I033 — 폰 원장이 밖으로 나가는 유일한 문. **홈에서만** 그린다: 다섯 뷰 전부에 두면
          매 화면 바닥에 「내보내기」가 붙어 읽기 화면의 마지막 줄을 차지한다. 근거는
          `ExportBackup` 머리주석(폰 관측이 판정자에게 도달하지 않는다). */}
      {view === 'today' ? <ExportBackup /> : null}

      {/* UX-B1 하단 탭바 — 5탭 스위처가 화면 최상단에 있었다. 폰을 한 손으로 쥐면 거기가
          엄지가 가장 못 닿는 지대다(iOS·안드로이드가 나란히 하단으로 내려간 이유). "지하철에서
          5분" 이 이 앱 폰 화면의 전제라, 가장 자주 누르는 것이 가장 닿기 쉬운 곳에 있어야 한다.
          ⚠ role/aria 는 그대로 group + aria-pressed 다 — 위치만 옮기고 계약은 안 건드린다.
          ⚠ 안전영역은 `pb-safe-b` 토큰(= 기본 패딩 + env(safe-area-inset-bottom)). */}
      <nav
        className="sticky bottom-0 z-[var(--z-nav)] flex justify-around border-t border-line bg-bg px-2 pt-2 pb-safe-b"
        role="group"
        aria-label="화면 전환"
      >
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => goTab(v)}
            className={`min-h-11 flex-1 rounded-md px-2 text-sm ${view === v ? 'bg-acc text-on-acc' : 'text-mut'}`}
          >
            {VIEW_LABEL[v]}
          </button>
        ))}
      </nav>
    </div>
  );
}
