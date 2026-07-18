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
import { SubjectSelect, usePrefillForm, nameOf } from './shared';
import ds from '@/styles/ds.module.css';
import j from './Journal.module.css';
import type { CbmsCode } from '@/lib/types';

/* ── CBMS 오답 분류(방법론 6절) ── */
export default function CbmsCard({ ds: dsKey }: { ds: string }) {
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
  };
  return (
    <div className={`${ds.card} ${ds.glow}`}>
      <h2>
        오답 분류 CBMS <span className={`${ds.muted} ${ds.tiny}`}>— 틀린 이유별로 처방이 다르다</span>
      </h2>
      <div className={ds.fieldgrid}>
        <div className={ds.fld}>
          <label htmlFor={`${uid}-sid`}>과목</label>
          <SubjectSelect id={`${uid}-sid`} value={sid} onChange={setSid} />
        </div>
        <div className={ds.fld}>
          <label htmlFor={`${uid}-ch`}>챕터/문제</label>
          <input
            id={`${uid}-ch`}
            ref={chRef}
            type="text"
            value={chapter}
            onChange={(e) => setChapter(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="예) 3장 변위전류"
          />
        </div>
        <div className={ds.fld}>
          <label htmlFor={`${uid}-code`}>유형</label>
          <select id={`${uid}-code`} value={code} onChange={(e) => setCode(e.target.value as CbmsCode)}>
            {CBMS_CODES.map((c) => (
              <option key={c} value={c}>
                {c} — {CBMS_INFO[c].label}
              </option>
            ))}
          </select>
        </div>
        <div className={`${ds.fld} ${ds.wide}`}>
          <label htmlFor={`${uid}-note`}>
            메모 <span className={`${ds.muted} ${ds.tiny}`}>(어디서 왜 막혔나)</span>
          </label>
          <input
            id={`${uid}-note`}
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="예) 경계조건에서 법선성분 연속을 빠뜨림"
          />
        </div>
      </div>
      <label className={ds.tiny} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
        <input type="checkbox" checked={conf} onChange={(e) => setConf(e.target.checked)} /> 🎯{' '}
        <b>찍어서 맞음/확신 없었음</b> <span className={ds.muted}>— 맞아도 다시 점검 대상(확신도 보정)</span>
      </label>
      <div style={{ marginTop: 10 }}>
        <Button variant="primary" onClick={submit}>
          오답 추가
        </Button>
        <span className={`${ds.muted} ${ds.tiny}`} style={{ marginLeft: 8 }}>
          C 개념 · B 경계 · M 수학 · S 실수 · T 시간부족(모의시험)
        </span>
      </div>
      <hr />
      {today.length ? (
        today.map((e) => {
          const inf = CBMS_INFO[e.code] || { label: '?', tip: '', color: '#888' };
          if (editId === e.id) {
            return (
              <div key={e.id} className={`${ds.rec} ${j.editRec}`}>
                <div className={ds.fieldgrid}>
                  <div className={ds.fld}>
                    <label htmlFor={`cb-edit-ch-${e.id}`}>챕터/문제</label>
                    <input
                      id={`cb-edit-ch-${e.id}`}
                      type="text"
                      value={edraft.chapter}
                      onChange={(ev) => setEdraft((d) => ({ ...d, chapter: ev.target.value }))}
                      placeholder="예) 3장 변위전류"
                    />
                  </div>
                  <div className={ds.fld}>
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
                  <div className={`${ds.fld} ${ds.wide}`}>
                    <label htmlFor={`cb-edit-note-${e.id}`}>메모</label>
                    <input
                      id={`cb-edit-note-${e.id}`}
                      type="text"
                      value={edraft.note}
                      onChange={(ev) => setEdraft((d) => ({ ...d, note: ev.target.value }))}
                      onKeyDown={(ev) => ev.key === 'Enter' && saveEdit()}
                      placeholder="어디서 왜 막혔나"
                    />
                  </div>
                </div>
                <label
                  className={ds.tiny}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6 }}
                >
                  <input
                    type="checkbox"
                    checked={edraft.conf}
                    onChange={(ev) => setEdraft((d) => ({ ...d, conf: ev.target.checked }))}
                  />{' '}
                  🎯 찍어서 맞음/확신 없었음
                </label>
                <div className={j.editActions}>
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
            <div key={e.id} className={ds.rec}>
              <div className={ds.recHead}>
                <span className={ds.cbmsChip} style={{ '--c': inf.color } as React.CSSProperties}>
                  {e.code} {inf.label}
                </span>
                {e.conf && (
                  <span
                    className={ds.cbmsChip}
                    style={{ '--c': '#888' } as React.CSSProperties}
                    title="확신 없이 맞힘 — 다시 점검 대상"
                  >
                    🎯 확신없음
                  </span>
                )}
                <b>{e.name || ''}</b>
                {e.chapter && <span className={`${ds.muted} ${ds.tiny}`}> · {e.chapter}</span>}
                <Button sm variant="ghost" style={{ marginLeft: 'auto' }} onClick={() => startEdit(e)} title="수정">
                  ✎
                </Button>
                <Button sm variant="ghost" danger onClick={() => del(e.id)} title="삭제">
                  ✕
                </Button>
              </div>
              {e.note && <div className={ds.tiny}>{e.note}</div>}
              <div className={`${ds.tiny} ${ds.muted}`}>처방: {inf.tip}</div>
            </div>
          );
        })
      ) : (
        <div className={`${ds.empty} ${ds.tiny}`}>
          오늘 기록한 오답이 없어요. '찍어서 맞은' 문제도 오답으로(확신 없으면 기록).
        </div>
      )}
    </div>
  );
}
