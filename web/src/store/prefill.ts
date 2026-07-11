/* ============================================================
   prefill.ts — '오늘 학습' 블록의 [✍요약/✗오답/🏷보충] 버튼이 기록 탭으로
   넘기는 프리필 요청(과목 사전선택). Phase 3까진 레거시 DOM 조작이었으나
   기록 탭이 React화되며(Phase 4) 이 작은 스토어로 대체 — store 레이어라
   today·journal 양쪽 feature가 (features→store 허용) 공유한다.
   영속되지 않는 일시 상태라 useApp(앱상태)과 분리.
============================================================ */
import { create } from 'zustand';

export type PrefillForm = 'sum' | 'cbms' | 'bl';

interface PrefillStore {
  form: PrefillForm | null;
  sid: string;
  /** C-10: 빠른 캡처가 파싱한 날짜('YYYY-MM-DD') — 기록 탭이 그 날짜로 이동해 백필. 없으면 ''(오늘 유지). */
  ds: string;
  /** 매 요청마다 증가 — 같은 (form,sid) 재요청도 effect가 감지하게. */
  nonce: number;
  request: (form: PrefillForm, sid: string, ds?: string) => void;
  /** 해당 폼이 소비 완료(중복 적용 방지). */
  consume: (form: PrefillForm) => void;
}

export const usePrefill = create<PrefillStore>((set) => ({
  form: null,
  sid: '',
  ds: '',
  nonce: 0,
  request: (form, sid, ds = '') => set((s) => ({ form, sid, ds, nonce: s.nonce + 1 })),
  consume: (form) => set((s) => (s.form === form ? { form: null } : {})),
}));
