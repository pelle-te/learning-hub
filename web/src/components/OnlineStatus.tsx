import { useEffect, useRef, useState } from 'react';
import LiveRegion from './LiveRegion';

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
/** 보이는 배지와 공지가 **같은 문장**을 쓴다(둘이 갈리면 화면과 낭독이 다른 말을 한다). */
const OFFLINE_TEXT = '오프라인 · 학습 기록은 계속 저장돼요(외부 연동만 일시 중단)';

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

  /* ⚠⚠ **복귀가 영구 무음이었다**(H22 · 2026-07-30). 종전엔 배지 노드에 `role="status"` 가
     붙어 있어 ① 오프라인 전환은 리전과 텍스트가 동시에 삽입돼 씹히고(`shell/toast` 머리주석의
     그 함정) ② **온라인 복귀는 노드가 사라질 뿐이라 알릴 자리가 아예 없었다.** 로컬-퍼스트라
     오프라인이 치명적이지 않은 만큼, "돌아왔다"를 모르면 외부 연동을 계속 안 쓰게 된다.
     → 보이는 배지는 그대로 두고 **항상 서 있는 리전**이 두 방향을 다 말한다.
     ⚠ 첫 마운트에는 아무 말도 안 한다 — 페이지를 열자마자 "온라인입니다"를 읽는 건 소음이다. */
  const first = useRef(true);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setNotice(online ? '온라인으로 돌아왔어요 — 외부 연동을 다시 쓸 수 있어요' : OFFLINE_TEXT);
  }, [online]);

  return (
    <>
      <LiveRegion message={notice} />
      {online ? null : (
        <div className={BADGE}>
          <span className={DOT} aria-hidden="true" />
          {OFFLINE_TEXT}
        </div>
      )}
    </>
  );
}
