/* ============================================================
   Journal — 탭: 📒 학습 기록 (Phase 4 · 앱상태/Zustand)
   레거시 ui-journal.js를 React로 — 공부 뒤 남기는 산출물: 3문장 요약·CBMS 오답·보충 백로그.
   '오늘 학습' 블록의 프리필 버튼이 prefill 스토어로 과목을 미리 채운다.
   스타일: 공유 디자인 시스템은 ds.module(ds.*), 요소·토큰은 전역 base(Phase 9 전환).
============================================================ */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/useApp';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { usePrefill, type PrefillForm } from '@/store/prefill';
import { ui, io } from '@/shell';
import { toastUndo } from '@/shell/toast';
import { useToggleBacklogUndo } from '@/shell/useBacklog';
import {
  summariesFor,
  addSummary,
  editSummary,
  delSummary,
  restoreSummary,
  cbmsBetween,
  editCbms,
  delCbms,
  restoreCbms,
  CBMS_INFO,
  CBMS_CODES,
  openBacklog,
  addBacklog,
  editBacklog,
  delBacklog,
  restoreBacklog,
  activityFeed,
} from '@/lib/methodology';
import { addDays, fmt, iso, itemById, parseISO, todayISO } from '@/lib/utils';
import { Button } from '@/components/ui';
import JournalStream from './JournalStream';
import ds from '@/styles/ds.module.css';
import j from './Journal.module.css';
import type { AppState, CbmsCode } from '@/lib/types';

/** 과목 선택 <option> — 이름 있는 항목만. */
function SubjectSelect({
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
function usePrefillForm(
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

const nameOf = (state: AppState, sid: string) => itemById(state, sid)?.name || '';

/* ── 3문장 요약(방법론 3절) ── */
function SummaryCard({ ds: dsKey }: { ds: string }) {
  const state = useApp((s) => s.state);
  const mutate = useApp((s) => s.mutate);
  const [sid, setSid] = useState('');
  const [s1, setS1] = useState('');
  const [s2, setS2] = useState('');
  const [s3, setS3] = useState('');
  // 인라인 편집 — 저장된 요약을 삭제-재작성 없이 제자리에서 고친다.
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ sid: '', s1: '', s2: '', s3: '' });
  const firstField = useRef<HTMLTextAreaElement>(null);
  usePrefillForm('sum', setSid, firstField);

  const list = summariesFor(state, dsKey);
  const startEdit = (x: { id: string; sid: string; s1: string; s2: string; s3: string }) => {
    setEditId(x.id);
    setDraft({ sid: x.sid, s1: x.s1, s2: x.s2, s3: x.s3 });
  };
  const saveEdit = () => {
    if (!editId) return;
    if (!draft.s1.trim() && !draft.s2.trim() && !draft.s3.trim()) {
      ui.toast('세 문장 중 최소 하나는 남겨주세요.', 'warn');
      return;
    }
    const id = editId;
    mutate((st) =>
      editSummary(st, dsKey, id, {
        sid: draft.sid,
        name: nameOf(st, draft.sid),
        s1: draft.s1.trim(),
        s2: draft.s2.trim(),
        s3: draft.s3.trim(),
      }),
    );
    setEditId(null);
    ui.toast('요약 수정됨', 'ok');
  };
  const submit = () => {
    if (!s1.trim() && !s2.trim() && !s3.trim()) {
      ui.toast('세 문장 중 최소 하나는 적어주세요.', 'warn');
      return;
    }
    mutate((st) => addSummary(st, dsKey, sid, nameOf(st, sid), s1.trim(), s2.trim(), s3.trim()));
    setS1('');
    setS2('');
    setS3('');
    ui.toast('요약 저장됨', 'ok');
  };
  const del = (id: string) => {
    // 삭제 전 스냅샷 + 원래 위치 → 되돌리기 시 끝이 아니라 제자리로 복원.
    const rec = list.find((x) => x.id === id);
    const idx = list.findIndex((x) => x.id === id);
    mutate((st) => delSummary(st, dsKey, id));
    toastUndo('요약 삭제됨', () => {
      if (!rec) return;
      mutate((st) => restoreSummary(st, dsKey, idx, rec));
    });
  };
  // 오늘 산출물(요약·오답)이 없으면 내보내기는 빈 파일 = 데드엔드 → 비활성화.
  const todayIso = todayISO({ _today: state._today });
  const canExport = summariesFor(state, todayIso).length > 0 || cbmsBetween(state, todayIso, todayIso).length > 0;

  return (
    <div className={`${ds.card} ${ds.glow}`}>
      <h2>
        3문장 요약 <span className={`${ds.muted} ${ds.tiny}`}>— 압축이 안 되면 이해한 게 아니다(파인만)</span>
      </h2>
      <div className={ds.fieldgrid}>
        <div className={ds.fld}>
          <label>과목</label>
          <SubjectSelect id="sum-sid" value={sid} onChange={setSid} />
        </div>
      </div>
      <label>
        1 — What &amp; Why <span className={`${ds.muted} ${ds.tiny}`}>해석하려는 핵심 현상·문제</span>
      </label>
      <textarea
        ref={firstField}
        rows={2}
        value={s1}
        onChange={(e) => setS1(e.target.value)}
        placeholder="예) 시변 환경에서 자기장과 전기장이 어떻게 퍼져 나가는지 해석하려고…"
      />
      <label>
        2 — How <span className={`${ds.muted} ${ds.tiny}`}>도입한 핵심 수식·가정·전개</span>
      </label>
      <textarea
        rows={2}
        value={s2}
        onChange={(e) => setS2(e.target.value)}
        placeholder="예) 변위전류가 든 앙페르 법칙과 패러데이 법칙을 연립해 파동방정식을 세웠고…"
      />
      <label>
        3 — Result &amp; Meaning <span className={`${ds.muted} ${ds.tiny}`}>결과와 물리적 직관</span>
      </label>
      <textarea
        rows={2}
        value={s3}
        onChange={(e) => setS3(e.target.value)}
        placeholder="예) 전자기파가 빛의 속도로 전파됨을 증명 — 무선통신의 근거."
      />
      <div style={{ marginTop: 10 }}>
        <Button variant="primary" onClick={submit}>
          요약 저장
        </Button>
        <Button
          sm
          variant="ghost"
          style={{ marginLeft: 8 }}
          onClick={() => io.exportAnkiCards('today')}
          disabled={!canExport}
          title={canExport ? '오늘 요약·오답을 Anki import용 .txt 카드 초안으로' : '오늘 기록한 요약·오답이 없어요'}
        >
          🃏 오늘 → Anki 카드(.txt)
        </Button>
        <Button
          sm
          variant="ghost"
          style={{ marginLeft: 6 }}
          onClick={() => io.exportSummaryNotes('today')}
          disabled={!canExport}
          title={
            canExport
              ? '오늘 요약을 옵시디언용 마크다운 노트(.md)로 — 카드(인출)에 이은 연결용'
              : '오늘 기록한 요약이 없어요'
          }
        >
          📓 오늘 → 노트(.md)
        </Button>
      </div>
      <div className={`${ds.foot} ${ds.tiny}`}>
        카드는 <b>초안</b>입니다 — Anki로 가져온 뒤 ≤5장으로 추리고 "왜?/응용"형으로 손질(큐레이션이 학습 이득). 복습
        시점(due)은 FSRS가 소유.
      </div>
      <hr />
      {list.length ? (
        list.map((x) =>
          editId === x.id ? (
            <div key={x.id} className={`${ds.rec} ${j.editRec}`}>
              <div className={ds.fld}>
                <label>과목</label>
                <SubjectSelect
                  id={`sum-edit-${x.id}`}
                  value={draft.sid}
                  onChange={(v) => setDraft((d) => ({ ...d, sid: v }))}
                />
              </div>
              <textarea
                rows={2}
                value={draft.s1}
                onChange={(e) => setDraft((d) => ({ ...d, s1: e.target.value }))}
                placeholder="1 — 현상·왜"
              />
              <textarea
                rows={2}
                value={draft.s2}
                onChange={(e) => setDraft((d) => ({ ...d, s2: e.target.value }))}
                placeholder="2 — 도구·어떻게"
              />
              <textarea
                rows={2}
                value={draft.s3}
                onChange={(e) => setDraft((d) => ({ ...d, s3: e.target.value }))}
                placeholder="3 — 결과·의미"
              />
              <div className={j.editActions}>
                <Button sm variant="primary" onClick={saveEdit}>
                  저장
                </Button>
                <Button sm variant="ghost" onClick={() => setEditId(null)}>
                  취소
                </Button>
              </div>
            </div>
          ) : (
            <div key={x.id} className={ds.rec}>
              <div className={ds.recHead}>
                <span className={ds.swatch} style={{ background: itemById(state, x.sid)?.color || 'var(--acc)' }} />
                <b>{x.name || '(과목 없음)'}</b>
                <Button sm variant="ghost" style={{ marginLeft: 'auto' }} onClick={() => startEdit(x)} title="수정">
                  ✎
                </Button>
                <Button sm variant="ghost" danger onClick={() => del(x.id)} title="삭제">
                  ✕
                </Button>
              </div>
              <ol className={ds.rec3}>
                <li>
                  <span className={`${ds.muted} ${ds.tiny}`}>현상·왜</span> {x.s1}
                </li>
                <li>
                  <span className={`${ds.muted} ${ds.tiny}`}>도구·어떻게</span> {x.s2}
                </li>
                <li>
                  <span className={`${ds.muted} ${ds.tiny}`}>결과·의미</span> {x.s3}
                </li>
              </ol>
            </div>
          ),
        )
      ) : (
        <div className={`${ds.empty} ${ds.tiny}`}>오늘 작성한 요약이 없어요. 블록 끝마다 한 개씩.</div>
      )}
    </div>
  );
}

/* ── CBMS 오답 분류(방법론 6절) ── */
function CbmsCard({ ds: dsKey }: { ds: string }) {
  const state = useApp((s) => s.state);
  const addCbms = useApp((s) => s.addCbms);
  const mutate = useApp((s) => s.mutate);
  const [sid, setSid] = useState('');
  const [chapter, setChapter] = useState('');
  const [code, setCode] = useState<CbmsCode>(CBMS_CODES[0]!);
  const [note, setNote] = useState('');
  const [conf, setConf] = useState(false);
  // 인라인 편집 — 저장된 오답의 챕터·유형·메모·확신플래그를 제자리에서 고친다.
  const [editId, setEditId] = useState<string | null>(null);
  const [edraft, setEdraft] = useState<{ chapter: string; code: CbmsCode; note: string; conf: boolean }>({
    chapter: '',
    code: CBMS_CODES[0]!,
    note: '',
    conf: false,
  });
  const chRef = useRef<HTMLInputElement>(null);
  usePrefillForm('cbms', setSid, chRef);

  const today = cbmsBetween(state, dsKey, dsKey);
  const startEdit = (e: { id: string; chapter: string; code: CbmsCode; note: string; conf?: boolean }) => {
    setEditId(e.id);
    setEdraft({ chapter: e.chapter, code: e.code, note: e.note, conf: !!e.conf });
  };
  const saveEdit = () => {
    if (!editId) return;
    const id = editId;
    mutate((st) =>
      editCbms(st, id, {
        chapter: edraft.chapter.trim(),
        code: edraft.code,
        note: edraft.note.trim(),
        conf: edraft.conf,
      }),
    );
    setEditId(null);
    ui.toast('오답 수정됨', 'ok');
  };
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
  const del = (id: string) => {
    const rec = today.find((x) => x.id === id);
    mutate((st) => delCbms(st, id));
    toastUndo('오답 삭제됨', () => {
      if (!rec) return;
      mutate((st) => restoreCbms(st, rec));
    });
  };

  return (
    <div className={`${ds.card} ${ds.glow}`}>
      <h2>
        오답 분류 CBMS <span className={`${ds.muted} ${ds.tiny}`}>— 틀린 이유별로 처방이 다르다</span>
      </h2>
      <div className={ds.fieldgrid}>
        <div className={ds.fld}>
          <label>과목</label>
          <SubjectSelect id="cb-sid" value={sid} onChange={setSid} />
        </div>
        <div className={ds.fld}>
          <label>챕터/문제</label>
          <input
            ref={chRef}
            type="text"
            value={chapter}
            onChange={(e) => setChapter(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="예) 3장 변위전류"
          />
        </div>
        <div className={ds.fld}>
          <label>유형</label>
          <select value={code} onChange={(e) => setCode(e.target.value as CbmsCode)}>
            {CBMS_CODES.map((c) => (
              <option key={c} value={c}>
                {c} — {CBMS_INFO[c].label}
              </option>
            ))}
          </select>
        </div>
        <div className={`${ds.fld} ${ds.wide}`}>
          <label>
            메모 <span className={`${ds.muted} ${ds.tiny}`}>(어디서 왜 막혔나)</span>
          </label>
          <input
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
                    <label>챕터/문제</label>
                    <input
                      type="text"
                      value={edraft.chapter}
                      onChange={(ev) => setEdraft((d) => ({ ...d, chapter: ev.target.value }))}
                      placeholder="예) 3장 변위전류"
                    />
                  </div>
                  <div className={ds.fld}>
                    <label>유형</label>
                    <select
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
                    <label>메모</label>
                    <input
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
                  <Button sm variant="ghost" onClick={() => setEditId(null)}>
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

/* ── '보충 필요' 백로그(방법론 5절) ── */
function BacklogCard() {
  const state = useApp((s) => s.state);
  const mutate = useApp((s) => s.mutate);
  const toggleUndo = useToggleBacklogUndo();
  const [sid, setSid] = useState('');
  const [topic, setTopic] = useState('');
  const [note, setNote] = useState('');
  // 인라인 편집 — 저장된 보충 항목의 주제·메모를 제자리에서 고친다.
  const [editId, setEditId] = useState<string | null>(null);
  const [edraft, setEdraft] = useState({ topic: '', note: '' });
  const topicRef = useRef<HTMLInputElement>(null);
  usePrefillForm('bl', setSid, topicRef);

  const open = openBacklog(state);
  const startEdit = (b: { id: string; topic: string; note: string }) => {
    setEditId(b.id);
    setEdraft({ topic: b.topic, note: b.note });
  };
  const saveEdit = () => {
    if (!editId) return;
    if (!edraft.topic.trim()) {
      ui.toast('막힌 주제는 비울 수 없어요.', 'warn');
      return;
    }
    const id = editId;
    mutate((st) => editBacklog(st, id, { topic: edraft.topic.trim(), note: edraft.note.trim() }));
    setEditId(null);
    ui.toast('보충 항목 수정됨', 'ok');
  };
  const closed = (state.backlog || []).filter((b) => b.done).length;
  const submit = () => {
    if (!topic.trim()) {
      ui.toast('막힌 주제를 적어주세요.', 'warn');
      return;
    }
    mutate((st) => addBacklog(st, sid, nameOf(st, sid), topic.trim(), note.trim()));
    setTopic('');
    setNote('');
    ui.toast('백로그 추가됨', 'ok');
  };
  const del = (id: string) => {
    const rec = open.find((x) => x.id === id);
    mutate((st) => delBacklog(st, id));
    toastUndo('백로그 삭제됨', () => {
      if (!rec) return;
      mutate((st) => restoreBacklog(st, rec));
    });
  };

  return (
    <div className={`${ds.card} ${ds.glow}`}>
      <h2>
        보충 필요 백로그{' '}
        <span className={`${ds.muted} ${ds.tiny}`}>— 회수되지 않는 라벨은 "공부했다는 착각"의 온상</span>
      </h2>
      <div className={ds.row} style={{ marginBottom: 6 }}>
        <span className={`${ds.pill} ${open.length ? ds.warn : ds.good}`}>열림 {open.length}</span>
        <span className={`${ds.pill} ${ds.good}`}>회수 {closed}</span>
        <span style={{ flex: 1 }} />
      </div>
      <div className={ds.fieldgrid}>
        <div className={ds.fld}>
          <label>과목</label>
          <SubjectSelect id="bl-sid" value={sid} onChange={setSid} />
        </div>
        <div className={`${ds.fld} ${ds.wide}`}>
          <label>막힌 주제</label>
          <input
            ref={topicRef}
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="예) 3장 변위전류 유도 막힘"
          />
        </div>
        <div className={`${ds.fld} ${ds.wide}`}>
          <label>
            메모 <span className={`${ds.muted} ${ds.tiny}`}>(가정·결과식·물리적 의미만)</span>
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="예) ∇×H=J+∂D/∂t 까지는 갔는데 파동방정식 유도에서 막힘"
          />
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <Button variant="primary" onClick={submit}>
          백로그 추가
        </Button>
        <span className={`${ds.muted} ${ds.tiny}`} style={{ marginLeft: 8 }}>
          회수처: 컨디션 좋은 오전 블록 / 백지 복습 / 질문 목록
        </span>
      </div>
      <hr />
      {open.length ? (
        open.map((b) =>
          editId === b.id ? (
            <div key={b.id} className={`${ds.rec} ${ds.blOpen} ${j.editRec}`}>
              <div className={ds.fld}>
                <label>막힌 주제</label>
                <input
                  type="text"
                  value={edraft.topic}
                  onChange={(e) => setEdraft((d) => ({ ...d, topic: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                />
              </div>
              <div className={`${ds.fld} ${ds.wide}`}>
                <label>메모</label>
                <input
                  type="text"
                  value={edraft.note}
                  onChange={(e) => setEdraft((d) => ({ ...d, note: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                />
              </div>
              <div className={j.editActions}>
                <Button sm variant="primary" onClick={saveEdit}>
                  저장
                </Button>
                <Button sm variant="ghost" onClick={() => setEditId(null)}>
                  취소
                </Button>
              </div>
            </div>
          ) : (
            <div key={b.id} className={`${ds.rec} ${ds.blOpen}`}>
              <div className={ds.recHead}>
                <input type="checkbox" aria-label="회수 완료" checked={false} onChange={() => toggleUndo(b.id)} />
                <span className={ds.swatch} style={{ background: itemById(state, b.sid)?.color || 'var(--mut)' }} />
                <b>{b.topic || '(주제 없음)'}</b>
                {b.name && <span className={`${ds.muted} ${ds.tiny}`}> · {b.name}</span>}
                <span className={`${ds.muted} ${ds.tiny}`} style={{ marginLeft: 6 }}>
                  {b.ds}
                </span>
                <Button sm variant="ghost" style={{ marginLeft: 'auto' }} onClick={() => startEdit(b)} title="수정">
                  ✎
                </Button>
                <Button sm variant="ghost" danger onClick={() => del(b.id)} title="삭제">
                  ✕
                </Button>
              </div>
              {b.note && <div className={ds.tiny}>{b.note}</div>}
            </div>
          ),
        )
      ) : (
        <div className={`${ds.empty} ${ds.tiny}`}>
          열린 '보충 필요' 항목이 없어요. 👍 백로그를 닫아 두는 게 메타인지.
        </div>
      )}
    </div>
  );
}

/** 최근 활동(7일) — 완료·요약·오답·보충·백지를 시간역순 단일 피드로(온디맨드 <details>). */
function ActivityFeed({ ds2 }: { ds2: string }) {
  const state = useApp((s) => s.state);
  const feed = activityFeed(state, iso(addDays(parseISO(ds2), -6)), ds2);
  // 접힌 <details> 안 목록을 항상 렌더하지 않고 열렸을 때만(onToggle로 open 추적) 렌더 — lazy.
  const [open, setOpen] = useState(false);
  return (
    <details className={j.feed} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className={j.feedSum}>최근 활동 · 7일{feed.length ? ` (${feed.length})` : ''}</summary>
      {!open ? null : feed.length ? (
        <ol className={j.feedList}>
          {feed.map((e, i) => (
            <li key={i} className={j.feedRow}>
              <span className={j.feedDs}>{e.ds.slice(5).replace('-', '/')}</span>
              <span className={j.feedKind} data-kind={e.kind}>
                {e.label}
              </span>
              <span className={j.feedDetail}>{e.detail}</span>
            </li>
          ))}
        </ol>
      ) : (
        <div className={j.feedEmpty}>최근 7일 기록이 없어요 — 오늘 첫 발자취를 남겨보세요.</div>
      )}
    </details>
  );
}

export default function Journal() {
  const state = useApp((s) => s.state);
  const navigate = useNavigate();
  const today = todayISO({ _today: state._today }); // '오늘' 단일 출처 존중
  // 기록 대상 날짜 — 기본 오늘, 과거로 이동해 어제 놓친 블록을 백필할 수 있다(미래로는 못 감).
  const [ds2, setDs2] = useState(today);
  const isToday = ds2 === today;
  const stepDay = (d: number) => {
    const next = iso(addDays(parseISO(ds2), d));
    if (next > today) return; // 미래 금지
    setDs2(next);
  };
  const sumN = summariesFor(state, today).length;
  const cbmsN = cbmsBetween(state, today, today).length;
  const openN = openBacklog(state).length;

  usePageChromeEffect(
    () => ({
      readouts: [
        { label: '요약', value: sumN, accent: true },
        { label: '오답', value: cbmsN },
        { label: '열린 보충', value: openN },
      ],
      // 무데이터면 빈 파일 데드엔드 → 상단바 액션 자체를 미노출(카드 내부 버튼은 canExport로 별도 가드).
      action: sumN || cbmsN ? { label: '🃏 Anki 카드(.txt)', onClick: () => io.exportAnkiCards('today') } : undefined,
    }),
    [sumN, cbmsN, openN],
  );

  return (
    <section className={j.wrap} aria-label="학습 기록">
      <div className={j.cols}>
        {/* 좌 — 로그(시그니처, fill) + 최근 활동(온디맨드). 선택 날짜를 따라간다. */}
        <div className={j.logCol}>
          <JournalStream ds={ds2} isToday={isToday} fill />
          <ActivityFeed ds2={ds2} />
          <div className={j.logHint}>
            공부 뒤 남기는 산출물({fmt(new Date(ds2 + 'T00:00:00'))}) — 블록을 끝낼 때마다 하나씩. 누적 추세·약점 분포는{' '}
            <button type="button" className={j.inlineLink} onClick={() => navigate('/stats', { viewTransition: true })}>
              통계
            </button>
            ·
            <button
              type="button"
              className={j.inlineLink}
              onClick={() => navigate('/review', { viewTransition: true })}
            >
              주간 리뷰
            </button>
            에서.
          </div>
        </div>
        {/* 우 — 기록 입력(온화면 패널, 스크롤) */}
        <div className={j.inputCol}>
          <div className={j.inputHead}>기록 입력 — 요약 · 오답 · 보충</div>
          {/* 날짜 스테퍼 — 과거 보충 진입점. 오늘이면 담백하게, 과거면 강조 배너. */}
          <div className={`${j.dateNav}${isToday ? '' : ' ' + j.dateNavPast}`}>
            <Button sm variant="ghost" onClick={() => stepDay(-1)} aria-label="이전 날">
              ◀
            </Button>
            <span className={j.dateLabel}>
              {fmt(new Date(ds2 + 'T00:00:00'))}
              {isToday ? <span className={`${ds.muted} ${ds.tiny}`}> · 오늘</span> : <b> · 과거 보충</b>}
            </span>
            <Button sm variant="ghost" onClick={() => stepDay(1)} disabled={isToday} aria-label="다음 날">
              ▶
            </Button>
            {!isToday && (
              <Button sm variant="ghost" onClick={() => setDs2(today)} style={{ marginLeft: 'auto' }}>
                오늘로
              </Button>
            )}
          </div>
          <SummaryCard ds={ds2} />
          <CbmsCard ds={ds2} />
          <BacklogCard />
        </div>
      </div>
    </section>
  );
}
