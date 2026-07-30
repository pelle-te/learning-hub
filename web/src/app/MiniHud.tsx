/* ============================================================
   MiniHud — 집중 미니 HUD(N-8). 320×92 알약 창의 유일한 내용.

   ⚠ **셸을 언마운트하지 않는다.** 이 화면은 셸 위에 덮는 오버레이고, 아래에서 `TopBar` 의
   `FocusChip` 이 계속 살아 있다. 그게 설계다: 세션 종료 감지(알림·완료 토스트·자동 휴식)의
   **단일 감시자**가 FocusChip 이라, 미니 모드가 셸을 걷어내면 그 감시가 통째로 멈춘다
   ("집중이 끝났는데 아무 일도 안 일어나는" 무음 회귀 — 창이 작아 눈에도 안 띈다).
   그래서 여기엔 타이머 로직이 없다. 남은 시간은 같은 스토어를 읽어 그리기만 한다.

   ⚠ 창을 되돌리는 책임도 나눠 갖지 않는다: 사용자가 펼치면 여기서, 세션이 끝나면 FocusChip
   에서 `exitMini()` 를 부른다(둘 다 같은 함수 · 복귀 크기 원천은 `miniMode` 하나).
============================================================ */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFocus } from '@/store/useFocus';
import { mmss } from '@/lib/utils';
import { exitMini } from '@/lib/miniMode';

const WRAP = 'fixed inset-0 z-[var(--z-modal)] flex items-center gap-3 border border-line-acc-pill bg-bg px-3.5 py-2.5';
const PULSE =
  'size-2 shrink-0 rounded-full bg-acc shadow-focus-dot animate-[live-breathe_var(--tempo)_ease-in-out_infinite] motion-reduce:animate-none';
const TIME = 'text-4xl leading-none font-extrabold tracking-topbar-sub text-acc tabular-nums text-shadow-focus-time';
const NAME = 'min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-bold text-mut';
const BTN =
  'inline-flex size-8 shrink-0 items-center justify-center rounded-sm! border! border-line! bg-transparent! p-0! text-sm! leading-[normal] text-mut! hover:border-line-acc! hover:text-ink! focus-visible:outline-2 focus-visible:outline-acc focus-visible:-outline-offset-2';

export default function MiniHud() {
  const session = useFocus((s) => s.session);
  const stop = useFocus((s) => s.stop);
  const navigate = useNavigate();
  const [now, setNow] = useState(() => Date.now());

  // 1초 틱 — FocusChip 과 같은 관용구. 두 곳이 같은 스토어를 읽을 뿐이라 타이머가 갈리지 않는다.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const leftSec = session ? Math.max(0, Math.round((session.endsAt - now) / 1000)) : 0;
  const expand = async (): Promise<void> => navigate(await exitMini(), { replace: true });

  return (
    <div className={WRAP} data-mini="1">
      <i className={PULSE} aria-hidden="true" />
      <b className={TIME} aria-label={`남은 시간 ${mmss(leftSec)}`}>
        {mmss(leftSec)}
      </b>
      <span className={NAME}>{session ? session.name : '세션 종료'}</span>
      <button type="button" className={BTN} onClick={() => void expand()} title="펼치기" aria-label="앱 창으로 펼치기">
        ⤢
      </button>
      <button
        type="button"
        className={BTN}
        onClick={() => {
          stop();
          void expand();
        }}
        title="집중 중단"
        aria-label="집중 타이머 정지하고 펼치기"
      >
        ■
      </button>
    </div>
  );
}
