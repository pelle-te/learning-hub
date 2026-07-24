/* ============================================================
   FocusChip — 전역 집중 세션 표시(TopBar 상주). useFocus 세션의 단일 감시자:
   ① 남은 시간 칩(어느 탭에서든 보임, 클릭 → 오늘 탭) ② 문서 제목 미러(탭 전환해도 보임)
   ③ 종료 감지 — 시스템 알림 + '블록 완료로 표시' 액션 토스트(한 번만).
============================================================ */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFocus } from '@/store/useFocus';
import { useApp } from '@/store/useApp';
import { touchReview } from '@/lib/persistence';
import { mmss } from '@/lib/utils';
import { toast } from '@/shell/toast';
import { confirm } from '@/shell/modal';
import { routeTitle } from './docTitle';

/* ── C-7 셸 티어 5/5 이식(Tailwind) ─────────────────────────────────────────────
   TopBar 상주 칩 — 네온 헤어라인 + 라이브 펄스 + 모노 숫자. 색은 전부 --acc/--glow 파생
   토큰(절대규칙 #3). ⚠ 두 버튼은 raw `<button>` 이라 언레이어드 전역 `button{}` 을 상대한다
   (배경·보더·radius·padding·font 계열에 `!`). 자손(`b`·`span`)은 버튼의 UA `line-height:normal`
   을 상속하던 자리라 내장 크기명(text-lg/text-sm)에 `leading-[normal]` 을 함께 박는다(규약 6-b).
   펄스 키프레임은 tw.css 로 옮겼다(CSS Module 스코프 밖이어야 유틸에서 부를 수 있다).
   `FocusChip.module.css` 삭제. */
const CHIP =
  'inline-flex items-stretch self-center overflow-hidden rounded-chip border border-line-acc-pill bg-tint-acc-9 shadow-focus-chip';
const BODY =
  'inline-flex min-h-8.5 items-center gap-2 border-0! bg-transparent! px-3! py-0! text-ink! hover:bg-tint-acc-14! focus-visible:outline-2 focus-visible:outline-acc focus-visible:-outline-offset-2';
const PULSE =
  'size-1.75 rounded-full bg-acc shadow-focus-dot animate-[focus-pulse_1.6s_ease-in-out_infinite] motion-reduce:animate-none';
const TIME = 'text-lg leading-[normal] font-extrabold tracking-topbar-sub text-acc tabular-nums text-shadow-focus-time';
const NAME =
  'max-w-30 overflow-hidden text-ellipsis whitespace-nowrap text-sm leading-[normal] font-bold text-mut max-mobile:hidden';
const STOP =
  // ⚠ radius·padding 은 **건드리지 않는다** — 원본 `.stopBtn`/`.body` 가 그 속성을 선언하지 않아
  //    언레이어드 전역 `button{}`(radius 7px · padding 8/13px)을 그대로 받고 있었다. 유틸로 0 을
  //    박으면 '이식'이 아니라 변경이다(칩은 overflow-hidden 이라 radius 차이가 눈엔 거의 안 보인다).
  'inline-flex w-7.5 items-center justify-center border-0! border-l! border-l-line-acc! bg-transparent! text-2xs! leading-[normal] text-mut! hover:bg-tint-acc-8! hover:text-bad! focus-visible:outline-2 focus-visible:outline-acc focus-visible:-outline-offset-2';

const fmt = mmss; // 표기 규약은 lib/utils 가 단일 원천(CT-S3)

export default function FocusChip() {
  const session = useFocus((st) => st.session);
  const stop = useFocus((st) => st.stop);
  const clear = useFocus((st) => st.clear);
  const navigate = useNavigate();
  const [now, setNow] = useState(() => Date.now());
  const doneKey = useRef<number | null>(null);

  // 1초 틱(세션 중에만). 백그라운드 스로틀은 브라우저에 맡기고, 복귀·시작 시 즉시 캐치업.
  useEffect(() => {
    if (!session) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 세션 시작/복귀 시 스테일 now 즉시 보정.
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    const onVis = () => setNow(Date.now());
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [session]);

  const leftSec = session ? Math.max(0, Math.round((session.endsAt - now) / 1000)) : 0;

  // 종료 감지 — 세션당 정확히 한 번. 집중: 알림 + 완료 토글 토스트 + 자동 휴식(5분).
  // 휴식: 가벼운 알림 + '다음 블록 시작' 액션(완료 토글·재휴식 없음).
  useEffect(() => {
    if (!session || leftSec > 0) return;
    if (doneKey.current === session.startedAt) return;
    doneKey.current = session.startedAt;
    const { ds, sid, type, name, blockMin, kind, chapter } = session;
    const isBreak = kind === 'break';
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification(isBreak ? '휴식 끝 ☕' : '집중 세션 완료 🎉', {
          body: isBreak ? '재충전 완료 — 다음 블록을 시작해볼까요?' : `${name} — 수고했어요. 블록을 완료로 표시할까요?`,
        });
      } catch {
        /* 알림 실패는 토스트가 커버 */
      }
    }
    if (isBreak) {
      toast('휴식 끝 ☕ — 다음 블록을 시작해볼까요?', 'info', 10_000, {
        label: '▶ 집중 시작',
        onAction: () => useFocus.getState().startOnCurrent(),
      });
    } else {
      toast(`집중 세션 완료 🎉 — ${name}`, 'info', 10_000, {
        label: '블록 완료로 표시',
        onAction: () => {
          const app = useApp.getState();
          app.toggleDone(ds, sid, type, blockMin, true);
          // ReviewRun發 세션은 챕터를 아니까 챕터 터치도 기록 — 위험모델 lastDs 갱신(감사 #22).
          if (chapter) app.mutate((st) => touchReview(st, sid, chapter, ds));
        },
      });
    }
    clear();
    if (!isBreak) useFocus.getState().startBreak(5); // 자동 휴식 — 포모도로 회복 구간
  }, [session, leftSec, clear]);

  // 문서 제목에 남은 시간 미러 — 다른 앱/탭에 가 있어도 세션이 보인다.
  useEffect(() => {
    if (!session) return;
    document.title = `${fmt(leftSec)} ⏱ ${session.name} — 러닝허브`;
    return () => {
      // 모듈로드 스냅샷이 아니라 종료 시점의 *현재* 라우트로 재계산 — App의 제목 이펙트는
      // 라우트 변경에만 발화하므로 여기서 복원하지 않으면 stale 제목이 남는다(X-9).
      document.title = routeTitle();
    };
  }, [session, leftSec]);

  if (!session) return null;
  const isBreak = session.kind === 'break';
  const mmss = fmt(leftSec);
  // 조기중단 confirm — 실수 클릭으로 세션이 날아가는 것 방지(휴식은 부담 없이 즉시 중단).
  const stopAsk = async () => {
    if (isBreak) return stop();
    if (
      await confirm('집중 세션을 중단할까요? 진행 시간은 기록되지 않아요.', {
        title: '집중 중단',
        okLabel: '중단',
        danger: true,
      })
    )
      stop();
  };
  return (
    <div className={CHIP}>
      <button
        type="button"
        className={BODY}
        onClick={() => navigate('/today', { viewTransition: true })}
        title={isBreak ? '휴식 중 — 오늘 탭으로' : '집중 세션 진행 중 — 오늘 탭으로'}
        aria-label={`${isBreak ? '휴식' : `집중 세션 ${session.name}`} 남은 시간 ${mmss} — 오늘 탭으로 이동`}
      >
        <i className={PULSE} aria-hidden="true" />
        <b className={TIME}>{mmss}</b>
        <span className={NAME}>{isBreak ? '☕ 휴식' : session.name}</span>
      </button>
      <button
        type="button"
        className={STOP}
        onClick={() => void stopAsk()}
        title={isBreak ? '휴식 중단' : '집중 중단'}
        aria-label={isBreak ? '휴식 타이머 정지' : '집중 타이머 정지'}
      >
        ■
      </button>
    </div>
  );
}
