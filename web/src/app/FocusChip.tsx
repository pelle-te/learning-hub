/* ============================================================
   FocusChip — 전역 집중 세션 표시(TopBar 상주). useFocus 세션의 단일 감시자:
   ① 남은 시간 칩(어느 탭에서든 보임, 클릭 → 오늘 탭) ② 문서 제목 미러(탭 전환해도 보임)
   ③ 종료 감지 — 시스템 알림 + '블록 완료로 표시' 액션 토스트(한 번만).
============================================================ */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFocus } from '@/store/useFocus';
import { useApp } from '@/store/useApp';
import { toast } from '@/shell/toast';
import { confirm } from '@/shell/modal';
import { routeTitle } from './docTitle';
import s from './FocusChip.module.css';

function fmt(sec: number): string {
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

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
    const { ds, sid, type, name, blockMin, kind } = session;
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
        onAction: () => useApp.getState().toggleDone(ds, sid, type, blockMin, true),
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
    <div className={s.chip}>
      <button
        type="button"
        className={s.body}
        onClick={() => navigate('/today', { viewTransition: true })}
        title={isBreak ? '휴식 중 — 오늘 탭으로' : '집중 세션 진행 중 — 오늘 탭으로'}
        aria-label={`${isBreak ? '휴식' : `집중 세션 ${session.name}`} 남은 시간 ${mmss} — 오늘 탭으로 이동`}
      >
        <i className={s.pulse} aria-hidden="true" />
        <b className={s.time}>{mmss}</b>
        <span className={s.name}>{isBreak ? '☕ 휴식' : session.name}</span>
      </button>
      <button
        type="button"
        className={s.stopBtn}
        onClick={() => void stopAsk()}
        title={isBreak ? '휴식 중단' : '집중 중단'}
        aria-label={isBreak ? '휴식 타이머 정지' : '집중 타이머 정지'}
      >
        ■
      </button>
    </div>
  );
}
