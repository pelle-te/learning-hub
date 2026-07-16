/* ============================================================
   BootRecovery.tsx — 부팅 복구 안내(1회성 · UI 없음).
   부팅이 기본값으로 떨어졌고(localStorage 소실/손상) IDB 미러에 살릴 수 있는
   스냅샷이 있으면 "복구하기" 액션 토스트를 띄운다. 정상 부팅에선 절대 안 뜨고,
   의도적 초기화도 유효한 기본값이 즉시 저장되므로 다음 부팅에서 안 뜬다.
   스냅샷은 여기서 캡처해 넘긴다 — 안내가 떠 있는 사이 flush가 미러를 덮어도 안전.
============================================================ */
import { useEffect } from 'react';
import { consumeBootFallback, parseState } from '@/lib/persistence';
import { idbLoad, idbPreserveBackup } from '@/lib/idb';
import { ui, io } from '@/shell';

export default function BootRecovery() {
  useEffect(() => {
    // 마커는 1회 소비(읽으면 지워짐) — StrictMode 이중 이펙트에도 안내는 한 번만.
    if (!consumeBootFallback()) return;
    idbLoad()
      .then((json) => {
        if (!json) return; // 미러 없음(진짜 첫 방문) — 조용히 기본값 사용
        // 첫 flush가 유일한 미러를 defaults로 덮기 전에 세대 백업으로 보존(감사 #21) —
        // 토스트(12초)를 놓쳐도 설정/⌘K '복구'가 이 보존본을 살린다. 손상 미러도 보존(수동 복구 여지).
        void idbPreserveBackup(json);
        if (!parseState(json)) return; // 미러도 손상 — 안내해봐야 복구 불가
        ui.toast('저장된 백업(IDB)을 찾았어요 — 이전 데이터를 복구할까요?', 'warn', 12000, {
          label: '복구하기',
          onAction: () => void io.restoreFromIDB(json),
        });
      })
      .catch(() => {
        /* IDB 접근 불가 — 복구 불가, 조용히 넘어감 */
      });
  }, []);
  return null;
}
