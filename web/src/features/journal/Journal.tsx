/* ============================================================
   Journal — 탭: 📒 학습 기록 (Phase 4 · 앱상태/Zustand)
   레거시 ui-journal.js를 React로 — 공부 뒤 남기는 산출물: 3문장 요약·CBMS 오답·보충 백로그.
   '오늘 학습' 블록의 프리필 버튼이 prefill 스토어로 과목을 미리 채운다.
   스타일: 공유 디자인 시스템은 ds.module(ds.*), 요소·토큰은 전역 base(Phase 9 전환).
============================================================ */
import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/store/useApp';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { usePrefill, type PrefillForm } from '@/store/prefill';
import { ui, io } from '@/shell';
import { toastUndo } from '@/shell/toast';
import {
  summariesFor,
  addSummary,
  delSummary,
  cbmsBetween,
  delCbms,
  CBMS_INFO,
  openBacklog,
  addBacklog,
  toggleBacklog,
  delBacklog,
} from '@/lib/methodology';
import { fmt, itemById, todayISO } from '@/lib/utils';
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
  const firstField = useRef<HTMLTextAreaElement>(null);
  usePrefillForm('sum', setSid, firstField);

  const list = summariesFor(state, dsKey);
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
    // 삭제 전 스냅샷 → 되돌리기 액션으로 복원(파괴적 동작 언두 문화 일관).
    const rec = list.find((x) => x.id === id);
    mutate((st) => delSummary(st, dsKey, id));
    toastUndo('요약 삭제됨', () => {
      if (!rec) return;
      mutate((st) => {
        st.summaries = st.summaries || {};
        (st.summaries[dsKey] = st.summaries[dsKey] || []).push({ ...rec });
      });
    });
  };

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
          title="오늘 요약·오답을 Anki import용 .txt 카드 초안으로"
        >
          🃏 오늘 → Anki 카드(.txt)
        </Button>
        <Button
          sm
          variant="ghost"
          style={{ marginLeft: 6 }}
          onClick={() => io.exportSummaryNotes('today')}
          title="오늘 요약을 옵시디언용 마크다운 노트(.md)로 — 카드(인출)에 이은 연결용"
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
        list.map((x) => (
          <div key={x.id} className={ds.rec}>
            <div className={ds.recHead}>
              <span className={ds.swatch} style={{ background: itemById(state, x.sid)?.color || '#6ea8fe' }} />
              <b>{x.name || '(과목 없음)'}</b>
              <Button sm variant="ghost" danger style={{ marginLeft: 'auto' }} onClick={() => del(x.id)} title="삭제">
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
        ))
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
  const codes = Object.keys(CBMS_INFO) as CbmsCode[];
  const [sid, setSid] = useState('');
  const [chapter, setChapter] = useState('');
  const [code, setCode] = useState<CbmsCode>(codes[0]!);
  const [note, setNote] = useState('');
  const [conf, setConf] = useState(false);
  const chRef = useRef<HTMLInputElement>(null);
  usePrefillForm('cbms', setSid, chRef);

  const today = cbmsBetween(state, dsKey, dsKey);
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
      mutate((st) => {
        st.cbms = st.cbms || [];
        st.cbms.push({ ...rec });
      });
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
            placeholder="예) 3장 변위전류"
          />
        </div>
        <div className={ds.fld}>
          <label>유형</label>
          <select value={code} onChange={(e) => setCode(e.target.value as CbmsCode)}>
            {codes.map((c) => (
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
                <Button sm variant="ghost" danger style={{ marginLeft: 'auto' }} onClick={() => del(e.id)} title="삭제">
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
  const [sid, setSid] = useState('');
  const [topic, setTopic] = useState('');
  const [note, setNote] = useState('');
  const topicRef = useRef<HTMLInputElement>(null);
  usePrefillForm('bl', setSid, topicRef);

  const open = openBacklog(state);
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
  // 회수 체크는 목록에서 즉시 사라진다 — 실수 클릭 대비 되돌리기 토스트.
  const toggle = (id: string) => {
    mutate((st) => toggleBacklog(st, id));
    toastUndo('보충 회수 완료 ✓', () => mutate((st) => toggleBacklog(st, id)));
  };
  const del = (id: string) => {
    const rec = open.find((x) => x.id === id);
    mutate((st) => delBacklog(st, id));
    toastUndo('백로그 삭제됨', () => {
      if (!rec) return;
      mutate((st) => {
        st.backlog = st.backlog || [];
        st.backlog.push({ ...rec });
      });
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
        open.map((b) => (
          <div key={b.id} className={`${ds.rec} ${ds.blOpen}`}>
            <div className={ds.recHead}>
              <input type="checkbox" aria-label="회수 완료" checked={false} onChange={() => toggle(b.id)} />
              <span className={ds.swatch} style={{ background: itemById(state, b.sid)?.color || '#888' }} />
              <b>{b.topic || '(주제 없음)'}</b>
              {b.name && <span className={`${ds.muted} ${ds.tiny}`}> · {b.name}</span>}
              <span className={`${ds.muted} ${ds.tiny}`} style={{ marginLeft: 6 }}>
                {b.ds}
              </span>
              <Button sm variant="ghost" danger style={{ marginLeft: 'auto' }} onClick={() => del(b.id)} title="삭제">
                ✕
              </Button>
            </div>
            {b.note && <div className={ds.tiny}>{b.note}</div>}
          </div>
        ))
      ) : (
        <div className={`${ds.empty} ${ds.tiny}`}>
          열린 '보충 필요' 항목이 없어요. 👍 백로그를 닫아 두는 게 메타인지.
        </div>
      )}
    </div>
  );
}

export default function Journal() {
  const state = useApp((s) => s.state);
  const ds2 = todayISO({ _today: state._today }); // '오늘' 단일 출처 존중
  const sumN = summariesFor(state, ds2).length;
  const cbmsN = cbmsBetween(state, ds2, ds2).length;
  const openN = openBacklog(state).length;

  usePageChromeEffect(
    () => ({
      readouts: [
        { label: '요약', value: sumN, accent: true },
        { label: '오답', value: cbmsN },
        { label: '열린 보충', value: openN },
      ],
      action: { label: '🃏 Anki 카드(.txt)', onClick: () => io.exportAnkiCards('today') },
    }),
    [sumN, cbmsN, openN],
  );

  return (
    <section className={j.wrap} aria-label="학습 기록">
      <div className={j.cols}>
        {/* 좌 — 오늘의 로그(시그니처, fill) */}
        <div className={j.logCol}>
          <JournalStream ds={ds2} fill />
          <div className={j.logHint}>
            공부 뒤 남기는 산출물(오늘 {fmt(new Date(ds2 + 'T00:00:00'))}) — 블록을 끝낼 때마다 하나씩. 누적 추세·약점
            분포는 <b>통계</b>·<b>주간 리뷰</b>에서.
          </div>
        </div>
        {/* 우 — 기록 입력(온화면 패널, 스크롤) */}
        <div className={j.inputCol}>
          <div className={j.inputHead}>기록 입력 — 요약 · 오답 · 보충</div>
          <SummaryCard ds={ds2} />
          <CbmsCard ds={ds2} />
          <BacklogCard />
        </div>
      </div>
    </section>
  );
}
