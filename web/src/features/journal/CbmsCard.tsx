/* ============================================================
   CbmsCard — CBMS 오답 분류(학습방법론 6절). 틀린 이유를 개념/경계/수학/실수/시간으로 갈라
   처방까지 잇는다. 색은 lib/methodology의 CBMS_INFO가 소유(의미론 토큰).
============================================================ */
import { useId, useRef, useState } from 'react';
import { useApp } from '@/store/useApp';
import { ui } from '@/shell';
import { useRecordEditor } from '@/shell/useRecordEditor';
import { cbmsBetween, editCbms, delCbms, restoreCbms, CBMS_INFO, CBMS_CODES } from '@/lib/methodology';
import { Button } from '@/components/ui';
import { commit } from '@/lib/motion';
import { useFormSubmit } from '@/hooks/useFormSubmit';
import { MOD_ENTER_LABEL } from '@/lib/platform';
import { SubjectSelect, usePrefillForm, nameOf } from './shared';
import type { CbmsCode } from '@/lib/types';

/* ── CBMS 오답 분류(방법론 6절) ── */
export default function CbmsCard({ ds: dsKey }: { ds: string }) {
  const cardRef = useRef<HTMLDivElement>(null); // D-7 commit 착지 대상(값이 바뀐 상자)
  const uid = useId(); // label↔입력 연결용 고유 접두
  const state = useApp((s) => s.state);
  const addCbms = useApp((s) => s.addCbms);
  const [sid, setSid] = useState('');
  const [chapter, setChapter] = useState('');
  const [code, setCode] = useState<CbmsCode>(CBMS_CODES[0]!);
  const [note, setNote] = useState('');
  const [conf, setConf] = useState(false);
  const chRef = useRef<HTMLInputElement>(null);
  usePrefillForm('cbms', setSid, chRef);

  const today = cbmsBetween(state, dsKey, dsKey);
  // 인라인 편집 + 삭제-되돌리기 — 공용 SSOT(useRecordEditor). draft를 edraft로 받아 JSX 유지.
  const {
    editId,
    draft: edraft,
    setDraft: setEdraft,
    startEdit,
    cancel,
    saveEdit,
    del,
  } = useRecordEditor<(typeof today)[number], { chapter: string; code: CbmsCode; note: string; conf: boolean }>({
    list: today,
    emptyDraft: { chapter: '', code: CBMS_CODES[0]!, note: '', conf: false },
    toDraft: (e) => ({ chapter: e.chapter, code: e.code, note: e.note, conf: !!e.conf }),
    save: (st, id, d) =>
      editCbms(st, id, { chapter: d.chapter.trim(), code: d.code, note: d.note.trim(), conf: d.conf }),
    remove: (st, id) => delCbms(st, id),
    restore: (st, rec) => restoreCbms(st, rec),
    deleteLabel: '오답 삭제됨',
    savedToast: '오답 수정됨',
  });
  /* D-7 commit — 저장이 **값이 바뀐 자리**에서 보이게 한다. 종전 성공 신호는 토스트뿐이라
     화면 구석에서 뜨고 사라졌고, "무엇이" 바뀌었는지는 말하지 못했다(모션 어휘 `commit`). */
  const submit = () => {
    if (!sid && !chapter.trim() && !note.trim()) {
      ui.toast('과목·챕터·메모 중 최소 하나는 입력하세요.', 'warn');
      return;
    }
    addCbms(dsKey, sid, nameOf(state, sid), chapter.trim(), code, note.trim(), conf);
    setChapter('');
    setNote('');
    setConf(false);
    ui.toast('오답 추가됨', 'ok');
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
        오답 분류 CBMS <span className="ds-muted ds-tiny">— 틀린 이유별로 처방이 다르다</span>
      </h2>
      <div className="ds-fieldgrid">
        <div className="ds-fld">
          <label htmlFor={`${uid}-sid`}>과목</label>
          <SubjectSelect id={`${uid}-sid`} value={sid} onChange={setSid} />
        </div>
        <div className="ds-fld">
          <label htmlFor={`${uid}-ch`}>챕터/문제</label>
          <input
            id={`${uid}-ch`}
            ref={chRef}
            type="text"
            value={chapter}
            onChange={(e) => setChapter(e.target.value)}
            {...addKeys}
            placeholder="예) 3장 변위전류"
          />
        </div>
        <div className="ds-fld">
          <label htmlFor={`${uid}-code`}>유형</label>
          <select id={`${uid}-code`} value={code} onChange={(e) => setCode(e.target.value as CbmsCode)}>
            {CBMS_CODES.map((c) => (
              <option key={c} value={c}>
                {c} — {CBMS_INFO[c].label}
              </option>
            ))}
          </select>
        </div>
        <div className="ds-fld ds-wide">
          <label htmlFor={`${uid}-note`}>
            메모 <span className="ds-muted ds-tiny">(어디서 왜 막혔나)</span>
          </label>
          <input
            id={`${uid}-note`}
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            {...addKeys}
            placeholder="예) 경계조건에서 법선성분 연속을 빠뜨림"
          />
        </div>
      </div>
      <label className="ds-tiny" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
        <input type="checkbox" checked={conf} onChange={(e) => setConf(e.target.checked)} /> 🎯{' '}
        <b>찍어서 맞음/확신 없었음</b> <span className="ds-muted">— 맞아도 다시 점검 대상(확신도 보정)</span>
      </label>
      <div style={{ marginTop: 10 }}>
        <Button variant="primary" onClick={submit} title={`오답 추가 (Enter · ${MOD_ENTER_LABEL})`}>
          오답 추가
        </Button>
        <span className="ds-muted ds-tiny" style={{ marginLeft: 8 }}>
          C 개념 · B 경계 · M 수학 · S 실수 · T 시간부족(모의시험)
        </span>
      </div>
      <hr />
      {today.length ? (
        today.map((e) => {
          const inf = CBMS_INFO[e.code] || { label: '?', tip: '', color: '#888' };
          if (editId === e.id) {
            return (
              <div key={e.id} className="ds-rec border-line-acc-hover! bg-tint-acc-faint!">
                <div className="ds-fieldgrid">
                  <div className="ds-fld">
                    <label htmlFor={`cb-edit-ch-${e.id}`}>챕터/문제</label>
                    <input
                      id={`cb-edit-ch-${e.id}`}
                      type="text"
                      value={edraft.chapter}
                      onChange={(ev) => setEdraft((d) => ({ ...d, chapter: ev.target.value }))}
                      {...editKeys}
                      placeholder="예) 3장 변위전류"
                    />
                  </div>
                  <div className="ds-fld">
                    <label htmlFor={`cb-edit-code-${e.id}`}>유형</label>
                    <select
                      id={`cb-edit-code-${e.id}`}
                      value={edraft.code}
                      onChange={(ev) => setEdraft((d) => ({ ...d, code: ev.target.value as CbmsCode }))}
                    >
                      {CBMS_CODES.map((c) => (
                        <option key={c} value={c}>
                          {c} — {CBMS_INFO[c].label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="ds-fld ds-wide">
                    <label htmlFor={`cb-edit-note-${e.id}`}>메모</label>
                    <input
                      id={`cb-edit-note-${e.id}`}
                      type="text"
                      value={edraft.note}
                      onChange={(ev) => setEdraft((d) => ({ ...d, note: ev.target.value }))}
                      {...editKeys}
                      placeholder="어디서 왜 막혔나"
                    />
                  </div>
                </div>
                <label
                  className="ds-tiny"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6 }}
                >
                  <input
                    type="checkbox"
                    checked={edraft.conf}
                    onChange={(ev) => setEdraft((d) => ({ ...d, conf: ev.target.checked }))}
                  />{' '}
                  🎯 찍어서 맞음/확신 없었음
                </label>
                <div className="mt-2 flex gap-2">
                  <Button sm variant="primary" onClick={saveEdit}>
                    저장
                  </Button>
                  <Button sm variant="ghost" onClick={cancel}>
                    취소
                  </Button>
                </div>
              </div>
            );
          }
          return (
            <div key={e.id} className="ds-rec">
              <div className="ds-recHead">
                <span className="ds-cbmsChip" style={{ '--c': inf.color } as React.CSSProperties}>
                  {e.code} {inf.label}
                </span>
                {e.conf && (
                  <span
                    className="ds-cbmsChip"
                    style={{ '--c': '#888' } as React.CSSProperties}
                    title="확신 없이 맞힘 — 다시 점검 대상"
                  >
                    🎯 확신없음
                  </span>
                )}
                <b>{e.name || ''}</b>
                {e.chapter && <span className="ds-muted ds-tiny"> · {e.chapter}</span>}
                <Button sm variant="ghost" style={{ marginLeft: 'auto' }} onClick={() => startEdit(e)} title="수정">
                  ✎
                </Button>
                <Button sm variant="ghost" danger onClick={() => del(e.id)} title="삭제">
                  ✕
                </Button>
              </div>
              {e.note && <div className="ds-tiny">{e.note}</div>}
              <div className="ds-tiny ds-muted">처방: {inf.tip}</div>
            </div>
          );
        })
      ) : (
        <div className="ds-empty ds-tiny">
          오늘 기록한 오답이 없어요. '찍어서 맞은' 문제도 오답으로(확신 없으면 기록).
        </div>
      )}
    </div>
  );
}
