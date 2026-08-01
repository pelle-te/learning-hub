/* ============================================================
   useBacklog — 보충 백로그 상호작용 SSOT. Journal·Review가 글자단위로 복붙하던
   '회수 토글 + 확인 토스트'를 한 훅으로(문구까지 단일 출처).

   ⚠ **역연산 언두가 사라졌다**(근본① · 2026-08-01). 6.5초 창 안에서만 유효한 사본이었고,
   토글은 애초에 **같은 자리를 다시 누르면 되는** 동작이라 창의 값이 가장 작은 부류였다.
   되돌리기 자체는 전역 ⌘Z 가 행 단위로 덮는다.
============================================================ */
import { useApp } from '@/store/useApp';
import { toggleBacklog } from '@/lib/methodology';
import { toastUndoable } from './toast';

/** 보충 백로그 회수 토글 + 확인 토스트(⌘Z 힌트 포함). */
export function useToggleBacklog(): (id: string) => void {
  const mutate = useApp((s) => s.mutate);
  return (id: string) => {
    mutate((st) => toggleBacklog(st, id));
    toastUndoable('보충 회수 완료');
  };
}
