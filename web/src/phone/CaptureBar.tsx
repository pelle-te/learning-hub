/* ============================================================
   phone/CaptureBar.tsx — 폰 캡처 입구(E14 · 2026-07-29).

   ## 왜 이게 없던 것이 결함인가

   `PhoneApp` 의 다섯 뷰는 **전부 읽기 아니면 체크**였다(홈·일·주·복습·읽기). 폰에서 가능한
   쓰기는 블록 완료 체크와 할일 체크 둘뿐이다. 그런데 이 화면의 전제는 `PhoneApp` 머리주석이
   적어 둔 _"지하철에서 5분"_ 이고, **그 5분에 생기는 유일한 산출물은 생각**이다. 받을 곳이
   없으면 경로는 하나뿐이다 — 메모앱에 적고, 몇 시간 뒤 PC 앞에서 다시 읽고 옮겨 적기.
   옮기지 않으면 유실된다.

   ## 규칙은 lib, 화면만 새로(§9-4)

   파싱·레코드 조립·저장 전부 `lib/quickCapture.fileCapture` — **데스크톱 ⌘Enter 와 같은 함수**다.
   두 화면이 각자 조립하면 어느 기기에서 담았느냐에 따라 레코드 모양이 달라지고, 그 차이는
   목록에서만 뒤늦게 보인다.
   ⚠ **한동안 이 문장이 절반만 참이었다(G7 · 2026-07-31 → H22 · 2026-08-01 수정).** 조립까지는
   같았지만 **저장은 여기가 따로** 갖고 있었다(폰은 `@/shell` 을 못 물어서). 지금은 저장까지
   같은 함수이고, 갈리는 것은 아래 확인 줄(표시)뿐이다.

   ⚠ 착지가 `backlog` 인 것이 배관상 중요하다 — `records` 슬라이스라 아웃박스·D1·pull 계약을
   **한 줄도 안 건드린다**(새 테이블·새 zod·새 마이그레이션 0). 폰이 이미 쓰고 있는 경로다.
   ⚠ 폰엔 토스트 시스템이 없다 → 확인은 **입력 바 자신이** 한 줄로 말하고 스스로 사라진다.
     되돌리기도 그 줄에 붙는다(데스크톱 `toastUndo` 와 같은 역할 · 파싱 오류가 곧 잘못된
     레코드라 짝이 필요하다).
   ⚠ `min-h-11` 은 터치 표적 규약이다(탭바와 같은 값).
============================================================ */
import { useRef, useState } from 'react';
import { useApp } from '@/store/useApp';
import { removeBacklog } from '@/lib/methodology';
import { fileCapture } from '@/lib/quickCapture';
import { Icon } from '@/components/Icon';

/** 확인 줄이 스스로 사라지기까지(ms) — 되돌리기를 누를 시간은 주되 화면에 눌러앉지 않는다. */
const CONFIRM_MS = 6000;

/* ── N-9 공유 시트 착지(발산 6회차 · 2026-08-07) ────────────────────────────
   매니페스트의 `share_target`(GET)이 여기로 온다 — 다른 앱에서 한 문장을 공유하면 **앱을
   "연" 적 없이** 이 바에 채워져 있다. 그리고 아이콘 길게 눌러 나오는 `?capture=1` 도 같은 곳.

   ⚠ **자동 저장하지 않는다.** 공유는 사용자의 *의도*이지 *확정*이 아니고, 자동 커밋하면
   오공유 하나가 조용히 원장에 남는다(되돌릴 자리도 그때는 화면에 없다). 채워만 두고 손가락
   하나를 남긴다 — `fileCapture` 의 파싱 실패도 그 한 걸음에서 보인다.
   ⚠ URL 은 **본문 뒤에 붙인다** — 공유 시트가 제목·본문·URL 을 따로 주는데 셋을 다 버리면
   출처가 사라지고, 앞에 붙이면 파서가 첫 토큰을 과목명으로 읽는다.
   ⚠ **쿼리를 한 번만 읽는다**(마운트 시). 남겨 두면 새로고침마다 같은 것이 다시 채워진다. */
function sharedText(): string {
  if (typeof window === 'undefined') return '';
  const q = new URLSearchParams(window.location.search);
  const parts = [q.get('share_title'), q.get('share_text'), q.get('share_url')].map((s) => (s || '').trim());
  return parts.filter(Boolean).join(' ').trim();
}

export default function CaptureBar(): React.JSX.Element {
  const [text, setText] = useState(sharedText);
  const [done, setDone] = useState<{ id: string; topic: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = (): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const submit = (): void => {
    const raw = text.trim();
    if (!raw) return;
    /* ⚠ 파싱부터 저장까지 **lib 이 소유한다**(`fileCapture`) — 데스크톱 ⌘K·미니 HUD 와 *같은
       함수*다. 종전엔 여기가 조립·저장을 따로 갖고 있었고 그 사실을 `MiniHud` 주석이 덮고
       있었다(G7). 갈리는 것은 아래 **표시**뿐이다(폰엔 토스트 자리가 없어 인라인 확인 줄). */
    let out: { id: string; topic: string } | null = null;
    useApp.getState().mutate((s) => {
      const r = fileCapture(s, raw, new Date());
      if (r) out = { id: r.id, topic: r.rec.topic };
    });
    if (!out) return;
    const { id, topic } = out as { id: string; topic: string };
    setText('');
    setDone({ id, topic });
    clearTimer();
    timer.current = setTimeout(() => setDone(null), CONFIRM_MS);
  };

  const undo = (): void => {
    if (!done) return;
    const { id } = done;
    useApp.getState().mutate((s) => removeBacklog(s, id));
    setDone(null);
    clearTimer();
  };

  return (
    <div className="border-t border-line bg-bg px-3 pt-2">
      {done ? (
        <p role="status" className="m-0 flex items-center justify-between gap-2 pb-2 text-xs text-mut">
          <span className="min-w-0 truncate">
            <Icon name="inbox" /> 보충에 담았어요 — {done.topic}
          </span>
          <button type="button" onClick={undo} className="min-h-8 shrink-0 rounded-md border border-line px-2 text-xs">
            되돌리기
          </button>
        </p>
      ) : null}
      <form
        className="flex items-center gap-2 pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="떠오른 것…"
          aria-label="빠른 캡처"
          className="min-h-11 min-w-0 flex-1 rounded-md border border-line bg-panel px-3 text-sm text-txt"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          className="min-h-11 shrink-0 rounded-md bg-acc px-4 text-sm font-semibold text-on-acc disabled:opacity-40"
        >
          담기
        </button>
      </form>
    </div>
  );
}
