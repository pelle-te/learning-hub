import { useEffect, useState } from 'react';

/* OnlineStatus — 네트워크 오프라인일 때 고정 배지 표시.
   로컬-퍼스트라 학습 데이터는 오프라인에서도 동작하지만, 외부 연동(제어판·볼트·Anki)은
   서버가 필요하므로 상태를 알려준다(혼란 방지). 온라인 복귀 시 자동으로 사라짐.

   ── C-7 컴포넌트 티어 이식(Tailwind) ────────────────────────────────────────
   키프레임은 `styles/tw.css` 전역에 있다 — CSS Modules 는 keyframe 이름을 스코프하므로
   유틸리티에서 이름으로 부를 수 없다(review `enter-rise` 이 세운 관용구).
   `motion-reduce:animate-none` 이 원본의 `@media (prefers-reduced-motion)` 자리다.
   ⚠ E24: 옛 전용 키프레임 `os-slide-up` 은 `enter-rise` 로 흡수됐다. `--rise-x: -50%` 는 방향이
     아니라 **위치 보정**이다 — 이 배지는 `-translate-x-1/2` 로 중앙 정렬돼 있고 애니메이션의
     transform 이 그것을 덮어쓴다(그래서 X 성분을 애니 안에 들고 있어야 한다). */
const BADGE =
  'fixed bottom-4.5 left-1/2 z-[var(--z-toast)] inline-flex max-w-online-badge -translate-x-1/2 items-center gap-2.25 rounded-full border border-warn bg-panel px-4 py-2.25 text-md text-txt shadow-float [--rise-x:-50%] [--rise-y:12px] animate-[enter-rise_var(--dur)_var(--ease)_both] motion-reduce:animate-none';
const DOT = 'size-2 flex-none rounded-full bg-warn';

export default function OnlineStatus() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  if (online) return null;
  return (
    <div className={BADGE} role="status" aria-live="polite">
      <span className={DOT} aria-hidden="true" />
      오프라인 · 학습 기록은 계속 저장돼요(외부 연동만 일시 중단)
    </div>
  );
}
