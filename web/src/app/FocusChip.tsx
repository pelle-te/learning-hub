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
import s from './FocusChip.module.css';

const BASE_TITLE = typeof document !== 'undefined' ? document.title : '러닝허브';

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

  // 종료 감지 — 세션당 정확히 한 번: 시스템 알림(백그라운드에서도 보임) + 완료 토글 액션 토스트.
  useEffect(() => {
    if (!session || leftSec > 0) return;
    if (doneKey.current === session.startedAt) return;
    doneKey.current = session.startedAt;
    const { ds, sid, type, name, blockMin } = session;
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification('집중 세션 완료 🎉', { body: `${name} — 수고했어요. 블록을 완료로 표시할까요?` });
      } catch {
        /* 알림 실패는 토스트가 커버 */
      }
    }
    toast(`집중 세션 완료 🎉 — ${name}`, 'info', 10_000, {
      label: '블록 완료로 표시',
      onAction: () => useApp.getState().toggleDone(ds, sid, type, blockMin, true),
    });
    clear();
  }, [session, leftSec, clear]);

  // 문서 제목에 남은 시간 미러 — 다른 앱/탭에 가 있어도 세션이 보인다.
  useEffect(() => {
    if (!session) return;
    document.title = `${fmt(leftSec)} ⏱ ${session.name} — 러닝허브`;
    return () => {
      document.title = BASE_TITLE;
    };
  }, [session, leftSec]);

  if (!session) return null;
  const mmss = fmt(leftSec);
  return (
    <div className={s.chip}>
      <button
        type="button"
        className={s.body}
        onClick={() => navigate('/today', { viewTransition: true })}
        title="집중 세션 진행 중 — 오늘 탭으로"
        aria-label={`집중 세션 ${session.name} 남은 시간 ${mmss} — 오늘 탭으로 이동`}
      >
        <i className={s.pulse} aria-hidden="true" />
        <b className={s.time}>{mmss}</b>
        <span className={s.name}>{session.name}</span>
      </button>
      <button type="button" className={s.stopBtn} onClick={stop} title="집중 중단" aria-label="집중 타이머 정지">
        ■
      </button>
    </div>
  );
}
