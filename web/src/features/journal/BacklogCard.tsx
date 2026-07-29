/* ============================================================
   BacklogCard — '보충 필요' 백로그(학습방법론 5절). 그때 못 메운 구멍을 잊지 않게 쌓아두고
   닫을 때마다 회수한다. 토글은 되돌리기 토스트와 짝(useToggleBacklogUndo).
============================================================ */
import { useId, useRef, useState } from 'react';
import { useApp } from '@/store/useApp';
import { ui } from '@/shell';
import { useToggleBacklogUndo } from '@/shell/useBacklog';
import { useRecordEditor } from '@/shell/useRecordEditor';
import { openBacklog, addBacklog, editBacklog, delBacklog, restoreBacklog } from '@/lib/methodology';
import { itemById } from '@/lib/utils';
import { Button } from '@/components/ui';
import { commit } from '@/lib/motion';
import { useFormSubmit } from '@/hooks/useFormSubmit';
import { MOD_ENTER_LABEL } from '@/lib/platform';
import { SubjectSelect, usePrefillForm, nameOf } from './shared';

/* ── '보충 필요' 백로그(방법론 5절) ── */
export default function BacklogCard() {
  const cardRef = useRef<HTMLDivElement>(null); // D-7 commit 착지 대상(값이 바뀐 상자)
  const uid = useId(); // label↔입력 연결용 고유 접두
  const state = useApp((s) => s.state);
  const mutate = useApp((s) => s.mutate);
  const toggleUndo = useToggleBacklogUndo();
  const [sid, setSid] = useState('');
  const [topic, setTopic] = useState('');
  const [note, setNote] = useState('');
  const topicRef = useRef<HTMLInputElement>(null);
  // C-10 잔여 — 캡처가 뽑은 챕터를 '막힌 주제'로 받는다(파서가 뽑고 버리던 유일한 필드).
  usePrefillForm('bl', setSid, topicRef, setTopic);

  const open = openBacklog(state);
  // 인라인 편집 + 삭제-되돌리기 — 공용 SSOT(useRecordEditor). draft를 edraft로 받아 JSX 유지.
  const {
    editId,
    draft: edraft,
    setDraft: setEdraft,
    startEdit,
    cancel,
    saveEdit,
    del,
  } = useRecordEditor({
    list: open,
    emptyDraft: { topic: '', note: '' },
    toDraft: (b) => ({ topic: b.topic, note: b.note }),
    validate: (d) => (!d.topic.trim() ? '막힌 주제는 비울 수 없어요.' : null),
    save: (st, id, d) => editBacklog(st, id, { topic: d.topic.trim(), note: d.note.trim() }),
    remove: (st, id) => delBacklog(st, id),
    restore: (st, rec) => restoreBacklog(st, rec),
    deleteLabel: '백로그 삭제됨',
    savedToast: '보충 항목 수정됨',
  });
  const closed = (state.backlog || []).filter((b) => b.done).length;
  /* D-7 commit — 저장이 **값이 바뀐 자리**에서 보이게 한다. 종전 성공 신호는 토스트뿐이라
     화면 구석에서 뜨고 사라졌고, "무엇이" 바뀌었는지는 말하지 못했다(모션 어휘 `commit`). */
  const submit = () => {
    if (!topic.trim()) {
      ui.toast('막힌 주제를 적어주세요.', 'warn');
      return;
    }
    mutate((st) => addBacklog(st, sid, nameOf(st, sid), topic.trim(), note.trim()));
    setTopic('');
    setNote('');
    ui.toast('백로그 추가됨', 'ok');
    commit(cardRef.current); // D-7 — 값이 바뀐 **그 자리**에서 1회 착지(토스트만으로는 어디가 바뀐지 모른다)
  };

  /* N-17 폼 키 계약 — ⌘Enter 는 어디서나 제출 · 맨 Enter 는 한 줄 칸에서만 · Esc 는 편집 취소.
     ⚠ 새 항목 폼엔 `cancel` 을 안 넘긴다: 거기서 Esc 가 입력을 날리면 그게 더 놀랍다.
     ⚠ 옛 인라인 핸들러엔 IME 조합 가드가 없어 **한글 확정 Enter 에 덜 친 내용이 제출**됐다
        (선재 결함 · 근거는 `useFormSubmit` 머리주석). */
  const addKeys = useFormSubmit(submit);
  const editKeys = useFormSubmit(saveEdit, cancel);
  return (
    <div ref={cardRef} className="ds-well">
      <h2>
        보충 필요 백로그 <span className="ds-muted ds-tiny">— 회수되지 않는 라벨은 "공부했다는 착각"의 온상</span>
      </h2>
      <div className="ds-row" style={{ marginBottom: 6 }}>
        <span className={`ds-pill ${open.length ? 'ds-warn' : 'ds-good'}`}>열림 {open.length}</span>
        <span className="ds-pill ds-good">회수 {closed}</span>
        <span style={{ flex: 1 }} />
      </div>
      <div className="ds-fieldgrid">
        <div className="ds-fld">
          <label htmlFor={`${uid}-sid`}>과목</label>
          <SubjectSelect id={`${uid}-sid`} value={sid} onChange={setSid} />
        </div>
        <div className="ds-fld ds-wide">
          <label htmlFor={`${uid}-topic`}>막힌 주제</label>
          <input
            id={`${uid}-topic`}
            ref={topicRef}
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            {...addKeys}
            placeholder="예) 3장 변위전류 유도 막힘"
          />
        </div>
        <div className="ds-fld ds-wide">
          <label htmlFor={`${uid}-note`}>
            메모 <span className="ds-muted ds-tiny">(가정·결과식·물리적 의미만)</span>
          </label>
          <input
            id={`${uid}-note`}
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            {...addKeys}
            placeholder="예) ∇×H=J+∂D/∂t 까지는 갔는데 파동방정식 유도에서 막힘"
          />
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <Button variant="primary" onClick={submit} title={`백로그 추가 (Enter · ${MOD_ENTER_LABEL})`}>
          백로그 추가
        </Button>
        <span className="ds-muted ds-tiny" style={{ marginLeft: 8 }}>
          회수처: 컨디션 좋은 오전 블록 / 백지 복습 / 질문 목록
        </span>
      </div>
      <hr />
      {open.length ? (
        open.map((b) =>
          editId === b.id ? (
            <div key={b.id} className="ds-rec ds-blOpen border-line-acc-hover! bg-tint-acc-faint!">
              <div className="ds-fld">
                <label htmlFor={`bl-edit-topic-${b.id}`}>막힌 주제</label>
                <input
                  id={`bl-edit-topic-${b.id}`}
                  type="text"
                  value={edraft.topic}
                  onChange={(e) => setEdraft((d) => ({ ...d, topic: e.target.value }))}
                  {...editKeys}
                />
              </div>
              <div className="ds-fld ds-wide">
                <label htmlFor={`bl-edit-note-${b.id}`}>메모</label>
                <input
                  id={`bl-edit-note-${b.id}`}
                  type="text"
                  value={edraft.note}
                  onChange={(e) => setEdraft((d) => ({ ...d, note: e.target.value }))}
                  {...editKeys}
                />
              </div>
              <div className="mt-2 flex gap-2">
                <Button sm variant="primary" onClick={saveEdit}>
                  저장
                </Button>
                <Button sm variant="ghost" onClick={cancel}>
                  취소
                </Button>
              </div>
            </div>
          ) : (
            <div key={b.id} className="ds-rec ds-blOpen">
              <div className="ds-recHead">
                <input type="checkbox" aria-label="회수 완료" checked={false} onChange={() => toggleUndo(b.id)} />
                <span className="ds-swatch" style={{ background: itemById(state, b.sid)?.color || 'var(--mut)' }} />
                <b>{b.topic || '(주제 없음)'}</b>
                {b.name && <span className="ds-muted ds-tiny"> · {b.name}</span>}
                <span className="ds-muted ds-tiny" style={{ marginLeft: 6 }}>
                  {b.ds}
                </span>
                <Button sm variant="ghost" style={{ marginLeft: 'auto' }} onClick={() => startEdit(b)} title="수정">
                  ✎
                </Button>
                <Button sm variant="ghost" danger onClick={() => del(b.id)} title="삭제">
                  ✕
                </Button>
              </div>
              {b.note && <div className="ds-tiny">{b.note}</div>}
            </div>
          ),
        )
      ) : (
        <div className="ds-empty ds-tiny">열린 '보충 필요' 항목이 없어요. 👍 백로그를 닫아 두는 게 메타인지.</div>
      )}
    </div>
  );
}
