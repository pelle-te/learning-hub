/* ============================================================
   useBacklog — 보충 백로그 상호작용 SSOT. Journal·Review가 글자단위로 복붙하던
   '회수 토글 + 되돌리기 토스트'를 한 훅으로(문구·역연산까지 단일 출처).
============================================================ */
import { useApp } from '@/store/useApp';
import { toggleBacklog } from '@/lib/methodology';
import { toastUndo } from './toast';

/** 보충 백로그 회수 토글 + 되돌리기 토스트 — 실수 클릭 대비 역연산 언두. */
export function useToggleBacklogUndo(): (id: string) => void {
  const mutate = useApp((s) => s.mutate);
  return (id: string) => {
    mutate((st) => toggleBacklog(st, id));
    toastUndo('보충 회수 완료 ✓', () => mutate((st) => toggleBacklog(st, id)));
  };
}
