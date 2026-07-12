/* ============================================================
   useRecordEditor — 인라인 편집 + 삭제-되돌리기 CRUD 기계의 SSOT.
   Journal의 3개 레코드 카드(요약·CBMS·백로그)가 각자 editId/draft/startEdit/saveEdit/del을
   복붙하던 것을 하나로. 삭제-언두의 위치 스냅샷(idx) 미묘함이 한 곳에만 있게 한다.

   레이어: shell(경계 밖 인프라). store(useApp.mutate)·shell(toast)를 소비하므로 lib이 아니라 여기.
   feature가 호출한다. 카드별로 다른 draft 형태·검증·저장/복원 함수는 opts로 주입.
============================================================ */
import { useState } from 'react';
import { useApp } from '@/store/useApp';
import { toast, toastUndo } from './toast';
import type { AppState } from '@/lib/types';

export interface RecordEditor<D> {
  editId: string | null;
  draft: D;
  setDraft: React.Dispatch<React.SetStateAction<D>>;
  startEdit: (rec: { id: string } & Record<string, unknown>) => void;
  cancel: () => void;
  saveEdit: () => void;
  del: (id: string) => void;
}

export function useRecordEditor<T extends { id: string }, D>(opts: {
  /** 삭제 스냅샷(rec·위치)을 뜨는 원본 목록. */
  list: T[];
  /** 편집 시작 시 레코드 → 초안. */
  toDraft: (rec: T) => D;
  /** 편집 안 할 때의 초안 초기값(카드별). */
  emptyDraft: D;
  /** 저장 뮤테이션(트림·파생필드 포함). */
  save: (st: AppState, id: string, draft: D) => void;
  /** 저장 전 검증 — 오류 메시지 반환 시 warn 토스트 후 중단(null이면 통과). */
  validate?: (draft: D) => string | null;
  /** 삭제 뮤테이션. */
  remove: (st: AppState, id: string) => void;
  /** 되돌리기 — 스냅샷 rec를 원래 위치(idx)로 복원(idx 불필요한 카드는 무시). */
  restore: (st: AppState, rec: T, idx: number) => void;
  /** 삭제 토스트 문구. */
  deleteLabel: string;
  /** 저장 성공 토스트(선택). */
  savedToast?: string;
}): RecordEditor<D> {
  const mutate = useApp((s) => s.mutate);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<D>(opts.emptyDraft);

  const startEdit = (rec: { id: string } & Record<string, unknown>) => {
    setEditId(rec.id);
    setDraft(opts.toDraft(rec as unknown as T));
  };
  const cancel = () => setEditId(null);

  const saveEdit = () => {
    if (editId == null) return;
    if (opts.validate) {
      const err = opts.validate(draft);
      if (err) {
        toast(err, 'warn');
        return;
      }
    }
    const id = editId;
    mutate((st) => opts.save(st, id, draft));
    setEditId(null);
    if (opts.savedToast) toast(opts.savedToast, 'ok');
  };

  const del = (id: string) => {
    // 삭제 전 스냅샷 + 원래 위치 → 되돌리기 시 끝이 아니라 제자리로 복원.
    const rec = opts.list.find((x) => x.id === id);
    const idx = opts.list.findIndex((x) => x.id === id);
    mutate((st) => opts.remove(st, id));
    toastUndo(opts.deleteLabel, () => {
      if (rec) mutate((st) => opts.restore(st, rec, idx));
    });
  };

  return { editId, draft, setDraft, startEdit, cancel, saveEdit, del };
}
