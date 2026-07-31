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
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFocus } from '@/store/useFocus';
import { mmss } from '@/lib/utils';
import { exitMini } from '@/lib/miniMode';
import { useFocusTrap } from '@/hooks/useFocusTrap';

const WRAP = 'fixed inset-0 z-[var(--z-modal)] flex items-center gap-3 border border-line-acc-pill bg-bg px-3.5 py-2.5';
const PULSE =
  'size-2 shrink-0 rounded-full bg-acc shadow-focus-dot animate-[live-breathe_var(--tempo)_var(--ease-live)_infinite] motion-reduce:animate-none';
const TIME = 'text-4xl leading-none font-extrabold tracking-topbar-sub text-acc tabular-nums text-shadow-focus-time';
const NAME = 'min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-bold text-mut';
const BTN =
  'inline-flex size-8 shrink-0 items-center justify-center rounded-sm! border! border-line! bg-transparent! p-0! text-sm! leading-auto text-mut! hover:border-line-acc! hover:text-ink! focus-visible:outline-2 focus-visible:outline-acc focus-visible:-outline-offset-2';

export default function MiniHud() {
  const session = useFocus((s) => s.session);
  const stop = useFocus((s) => s.stop);
  const navigate = useNavigate();
  const [now, setNow] = useState(() => Date.now());
  const wrapRef = useRef<HTMLDivElement | null>(null);

  /* ⚠⚠ **포커스를 이 알약 안에 묶는다(H11 · 2026-07-30 `/감사 근본`).**

     이 화면은 `fixed inset-0` 로 셸을 덮지만 셸을 **언마운트하지 않는다**(위 머리주석 — 세션 종료
     감시자를 살려 두려는 것이고 그 판단은 옳다). 그런데 배경에 `inert`·트랩이 없어서, 창이
     320×92 로 줄어든 상태에서 Tab 을 누르면 포커스가 **뷰포트 밖 셸 컨트롤**(스킵링크·레일 7개·
     TopBar 액션·본문 전부)로 이동했다. 아무것도 보이지 않는 채 Enter 를 누르면 임의의 탭 이동·
     테마 전환·`전체 초기화…` 확인창이 뜬다. 그리고 `/mini` 는 axe 로스터 밖이라 아무도 안 잡았다.
     (전 저장소에 `inert` 사용이 **0건**이었다 — 오버레이 계약에 그 도구가 아예 없었다.)

     `useFocusTrap` 은 Esc·복원까지 이미 소유한 훅이라 계약을 새로 만들지 않는다.
     ⚠ 남는 것: 스크린리더 **가상 커서**는 트랩이 막지 못한다(배경을 읽을 수 있다). 그건 `inert`
       가 필요한데, 그러려면 셸 컨테이너에 그 속성을 심어야 하고 이 파일 밖의 변경이다 —
       실害가 "보이지 않는 것을 조작한다"에서 "보이지 않는 것을 읽는다"로 줄었으므로 여기서 멈춘다. */
  useFocusTrap(true, wrapRef);

  // 1초 틱 — FocusChip 과 같은 관용구. 두 곳이 같은 스토어를 읽을 뿐이라 타이머가 갈리지 않는다.
  /* ⚠ 세션이 없으면 돌리지 않는다(H24). `FocusChip` 은 같은 가드를 갖고 있었는데 여기만 빠져서,
     미니 창을 띄운 채 세션이 끝나면('세션 종료' 표시) 1초마다 무의미한 리렌더가 무기한 이어졌다. */
  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [session]);

  const leftSec = session ? Math.max(0, Math.round((session.endsAt - now) / 1000)) : 0;
  const expand = async (): Promise<void> => navigate(await exitMini(), { replace: true });

  return (
    <div className={WRAP} data-mini="1" ref={wrapRef} tabIndex={-1}>
      <i className={PULSE} aria-hidden="true" />
      {/* ⚠ `<b>` 는 **제네릭 롤**이라 `aria-label` 이 조용히 무시된다(H11 부수 · 2026-07-30).
          그래서 스크린리더는 맥락 없이 "12:34" 만 읽었다 — 그 숫자가 남은 시간인지 알 수 없다.
          `role="img"` 을 주면 라벨이 유효해진다(같은 저장소가 `NextActions`·`Discovery` 에서
          이미 쓰는 관용구). 시각 표현은 한 글자도 안 바뀐다. */}
      <b className={TIME} role="img" aria-label={`남은 시간 ${mmss(leftSec)}`}>
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
