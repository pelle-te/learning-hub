/* ============================================================
   journal/shared.tsx — 기록 탭 카드 3종(요약·CBMS·백로그)이 함께 쓰는 조각.

   왜 features 안에 남는가: SubjectSelect·usePrefillForm 둘 다 store를 읽으므로
   components/·hooks/로 올릴 수 없다(레이어 규약: 그 둘은 lib만 import 가능).
   같은 feature 안의 공유물이라 여기가 제자리다.
============================================================ */
import { useEffect } from 'react';
import { useApp } from '@/store/useApp';
import { usePrefill, type PrefillForm } from '@/store/prefill';
import { itemById } from '@/lib/utils';
import type { AppState } from '@/lib/types';

/** 과목 선택 <option> — 이름 있는 항목만. */
export function SubjectSelect({
  id,
  value,
  onChange,
  refEl,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  refEl?: React.Ref<HTMLSelectElement>;
}) {
  const items = useApp((s) => s.state.items);
  return (
    <select id={id} ref={refEl} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">(과목 선택)</option>
      {items
        .filter((i) => i.name)
        .map((i) => (
          <option key={i.id} value={i.id}>
            {i.name}
          </option>
        ))}
    </select>
  );
}

/** prefill 요청을 구독해 해당 폼의 과목을 채우고 스크롤/포커스. */
export function usePrefillForm(
  form: PrefillForm,
  setSid: (sid: string) => void,
  focusEl: React.RefObject<HTMLElement | null>,
) {
  const nonce = usePrefill((s) => s.nonce);
  const reqForm = usePrefill((s) => s.form);
  const reqSid = usePrefill((s) => s.sid);
  const consume = usePrefill((s) => s.consume);
  useEffect(() => {
    if (reqForm !== form) return;
    setSid(reqSid);
    consume(form);
    const el = focusEl.current;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => el.focus(), 300);
    }
    // nonce가 바뀔 때만 반응(같은 과목 재요청도 감지). setSid/consume/focusEl은 안정 참조, reqSid는
    // nonce 변화 시점 값만 쓰므로 의도적으로 제외(전체 포함 시 무관 변경에 재발화).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, reqForm]);
}

export const nameOf = (state: AppState, sid: string) => itemById(state, sid)?.name || '';
