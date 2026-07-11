/* ============================================================
   prefill.ts — '오늘 학습' 블록의 [✍요약/✗오답/🏷보충] 버튼이 기록 탭으로
   넘기는 프리필 요청(과목 사전선택). Phase 3까진 레거시 DOM 조작이었으나
   기록 탭이 React화되며(Phase 4) 이 작은 스토어로 대체 — store 레이어라
   today·journal 양쪽 feature가 (features→store 허용) 공유한다.
   영속되지 않는 일시 상태라 useApp(앱상태)과 분리.
============================================================ */
import { create } from 'zustand';

export type PrefillForm = 'sum' | 'cbms' | 'bl';

/** 프리필 1건. form/sid/ds 3필드는 항상 큐의 head를 투영 — 단건 소비 계약을 하위호환으로 보존. */
export interface PrefillReq {
  form: PrefillForm;
  sid: string;
  ds: string;
}

interface PrefillStore {
  form: PrefillForm | null;
  sid: string;
  /** C-10: 빠른 캡처가 파싱한 날짜('YYYY-MM-DD') — 기록 탭이 그 날짜로 이동해 백필. 없으면 ''(오늘 유지). */
  ds: string;
  /** 매 요청마다 증가 — 같은 (form,sid) 재요청도 effect가 감지하게. */
  nonce: number;
  /** I-11: 남은 배치. head가 현재 투영(form/sid/ds). 단건 request는 길이 1 큐. */
  queue: PrefillReq[];
  request: (form: PrefillForm, sid: string, ds?: string) => void;
  /** I-11: 다건 프리필(멀티라인 캡처) — 첫 건을 투영하고 소비마다 다음으로 자동 전진. */
  requestBatch: (reqs: PrefillReq[]) => void;
  /** 해당 폼이 소비 완료 → 큐에 다음이 있으면 그 폼으로 전진(nonce++), 없으면 form=null. */
  consume: (form: PrefillForm) => void;
}

export const usePrefill = create<PrefillStore>((set) => ({
  form: null,
  sid: '',
  ds: '',
  nonce: 0,
  queue: [],
  request: (form, sid, ds = '') => set((s) => ({ queue: [{ form, sid, ds }], form, sid, ds, nonce: s.nonce + 1 })),
  requestBatch: (reqs) =>
    set((s) => {
      if (!reqs.length) return {};
      const head = reqs[0]!;
      return { queue: reqs.slice(), form: head.form, sid: head.sid, ds: head.ds, nonce: s.nonce + 1 };
    }),
  consume: (form) =>
    set((s) => {
      if (s.form !== form) return {};
      const rest = s.queue.slice(1);
      const next = rest[0];
      if (next) return { queue: rest, form: next.form, sid: next.sid, ds: next.ds, nonce: s.nonce + 1 };
      return { queue: [], form: null };
    }),
}));
