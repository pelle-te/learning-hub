import { useEffect, useState } from 'react';
import styles from './OnlineStatus.module.css';

/* OnlineStatus — 네트워크 오프라인일 때 고정 배지 표시.
   로컬-퍼스트라 학습 데이터는 오프라인에서도 동작하지만, 외부 연동(제어판·볼트·Anki)은
   서버가 필요하므로 상태를 알려준다(혼란 방지). 온라인 복귀 시 자동으로 사라짐. */
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
    <div className={styles.badge} role="status" aria-live="polite">
      <span className={styles.dot} aria-hidden="true" />
      오프라인 · 학습 기록은 계속 저장돼요(외부 연동만 일시 중단)
    </div>
  );
}
