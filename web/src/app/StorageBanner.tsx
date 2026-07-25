/* ============================================================
   StorageBanner.tsx — 정본 저장소 실패의 **지속** 표시(C1 · 2026-07-26 감사).

   왜 토스트가 아니라 배너인가: 저장 실패 안내는 30초 스로틀 토스트였고(`useApp.warnSaveFailure`),
   그건 자리를 비운 사이 통째로 놓친다. 그런데 이 사건의 성질은 "잠깐 알리면 되는 것"이 아니라
   **"복구할 때까지 계속 참인 상태"**다 — 그동안의 편집은 임시 사본에만 있고, 사용자가 해야 할
   일(내보내기 백업)은 미룰수록 나빠진다. 상태는 상태로 표시한다.

   두 화면을 한 컴포넌트가 그린다(같은 사건의 현재/과거):
   ① **지금 임시 저장 중**(`isSaveFallback`) — 방금 한 편집이 정본에 못 갔다. 즉시 백업 요구.
   ② **지난 세션의 임시 사본**(`dbFallbackAt`) — DB 는 회복됐는데 그 세션 편집이 임시 사본에만
      있다. 부팅은 DB 를 정본으로 삼으므로 그 편집은 화면에 없다 → 파일 회수 경로를 준다.
      ⚠ 자동 병합하지 않는 이유는 `lib/db/fallback.ts` 머리주석이 SSOT.

   ⚠ ①의 조건이 "DB 연결 실패"가 **아니라** "저장이 실제로 임시본으로 떨어졌다"인 이유도
   그 파일이 소유한다(트랙 A 가 그 차이를 즉시 드러냈다 · 편집이 없으면 잃을 것도 없다).
============================================================ */
import { useCallback, useState, useSyncExternalStore } from 'react';
import { clearDbFallback, dbFallbackAt, isSaveFallback, onSaveFallback } from '@/lib/db/fallback';
import { Button } from '@/components/ui/Button';
import { io } from '@/shell';

const fmt = (ms: number): string =>
  new Date(ms).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function StorageBanner() {
  const broken = useSyncExternalStore(onSaveFallback, isSaveFallback, () => false);
  // 마커는 부팅 시점 값이면 충분하다(쓰기는 이 세션에서만 일어나고, 그땐 위 `broken` 이 참이라
  // ①이 이긴다). 사용자의 "확인함"만 이 지역 상태를 되돌린다.
  const [fallbackAt, setFallbackAt] = useState<number | null>(dbFallbackAt);

  const dismiss = useCallback(() => {
    clearDbFallback();
    setFallbackAt(null);
  }, []);

  if (broken) {
    return (
      <div className="ds-warnbox ds-bad mx-6.5 mt-3 mb-0 flex flex-wrap items-center gap-2" role="alert">
        <b>저장소에 연결하지 못했어요</b>
        <span className="min-w-0 flex-1">
          이번 세션의 편집은 <b>임시 저장</b>만 됩니다 — 지금 내보내기로 백업하세요.
        </span>
        <Button sm variant="primary" onClick={() => io.exportJSON()}>
          내보내기
        </Button>
      </div>
    );
  }

  if (fallbackAt != null) {
    return (
      <div className="ds-warnbox mx-6.5 mt-3 mb-0 flex flex-wrap items-center gap-2" role="status">
        <b>임시 저장본이 있어요</b>
        <span className="min-w-0 flex-1">
          {fmt(fallbackAt)}에 저장소 연결이 끊겨 임시로만 저장된 편집이 있습니다. 파일로 회수해 확인하세요(가져오기로
          되살릴 수 있어요).
        </span>
        <Button sm onClick={() => io.downloadFallbackSnapshot()}>
          내려받기
        </Button>
        <Button sm variant="ghost" onClick={dismiss}>
          확인함
        </Button>
      </div>
    );
  }

  return null;
}
