/* ============================================================
   BacklogCard — '보충 필요' 백로그(학습방법론 5절). 그때 못 메운 구멍을 잊지 않게 쌓아두고
   닫을 때마다 회수한다. 토글은 확인 토스트와 짝(useToggleBacklog · 되돌리기는 전역 ⌘Z).
============================================================ */
import { useId, useRef, useState } from 'react';
import { useApp } from '@/store/useApp';
import { toast } from '@/shell';
import { useToggleBacklog } from '@/shell/useBacklog';
import { useRecordEditor } from '@/shell/useRecordEditor';
import {
  openBacklog,
  addBacklog,
  editBacklog,
  delBacklog,
  untriagedBacklog,
  triageBacklog,
  snoozeBacklog,
} from '@/lib/methodology';
import { addDays, iso, itemById, parseISO, todayISO } from '@/lib/utils';
import { Button } from '@/components/ui';
import { commit } from '@/lib/motion';
import { useFormSubmit } from '@/hooks/useFormSubmit';
import { useListCursor } from '@/hooks/useListCursor';
import { MOD_ENTER_LABEL } from '@/lib/platform';
import { SubjectSelect, usePrefillForm, nameOf } from './shared';

/* ── '보충 필요' 백로그(방법론 5절) ── */
export default function BacklogCard() {
  const cardRef = useRef<HTMLDivElement>(null); // D-7 commit 착지 대상(값이 바뀐 상자)
  const uid = useId(); // label↔입력 연결용 고유 접두
  const state = useApp((s) => s.state);
  const mutate = useApp((s) => s.mutate);
  const toggleUndo = useToggleBacklog();
  const [sid, setSid] = useState('');
  const [topic, setTopic] = useState('');
  const [note, setNote] = useState('');
  const topicRef = useRef<HTMLInputElement>(null);
  // C-10 잔여 — 캡처가 뽑은 챕터를 '막힌 주제'로 받는다(파서가 뽑고 버리던 유일한 필드).
  usePrefillForm('bl', setSid, topicRef, setTopic);

  const open = openBacklog(state);
  /* I042 — **미분류**(캡처가 판정 없이 넣은 것). 별도 목록이 아니라 같은 백로그의 플래그라,
     판정을 건너뛰어도 그 항목은 여기 그대로 있다 — 트리아지가 **새 백로그가 되지 않는** 유일한
     방법이다(근거 전문은 `schema.ts` 의 `BacklogSchema` 주석). */
  const ds = todayISO(state);
  const untriaged = untriagedBacklog(state, ds);
  const later = (b: { id: string }, days: number) =>
    mutate((st) => snoozeBacklog(st, b.id, iso(addDays(parseISO(ds), days))));
  /* W13 — 기록 탭에서 **행동이 있는 목록**이 여기다(`JournalStream` 은 읽기 전용 파생이라
     커서를 얹어도 동사가 0이다 — 어휘를 닫아 두고 빈 화면에 커서만 주면 침묵이 늘 뿐이다). */
  const cursor = useListCursor<(typeof open)[number]>({
    items: open.map((b) => ({ key: b.id, item: b })),
    docTitle: '이 화면 · 보충',
    verbs: { x: (b) => toggleUndo(b.id), e: (b) => startEdit(b), d: (b) => del(b.id) },
  });
  // 인라인 편집 + 삭제 — 공용 SSOT(useRecordEditor). draft를 edraft로 받아 JSX 유지.
  const {
    editId,
    draft: edraft,
    setDraft: setEdraft,
    startEdit,
    cancel,
    saveEdit,
    del,
  } = useRecordEditor<(typeof open)[number], { topic: string; note: string }>({
    emptyDraft: { topic: '', note: '' },
    toDraft: (b) => ({ topic: b.topic, note: b.note }),
    validate: (d) => (!d.topic.trim() ? '막힌 주제는 비울 수 없어요.' : null),
    save: (st, id, d) => editBacklog(st, id, { topic: d.topic.trim(), note: d.note.trim() }),
    remove: (st, id) => delBacklog(st, id),
    deleteLabel: '백로그 삭제됨',
    savedToast: '보충 항목 수정됨',
  });
  const closed = (state.backlog || []).filter((b) => b.done).length;
  /* D-7 commit — 저장이 **값이 바뀐 자리**에서 보이게 한다. 종전 성공 신호는 토스트뿐이라
     화면 구석에서 뜨고 사라졌고, "무엇이" 바뀌었는지는 말하지 못했다(모션 어휘 `commit`). */
  const submit = () => {
    if (!topic.trim()) {
      toast('막힌 주제를 적어주세요.', 'warn');
      return;
    }
    mutate((st) => addBacklog(st, sid, nameOf(st, sid), topic.trim(), note.trim()));
    setTopic('');
    setNote('');
    /* E15 — 성공 토스트를 은퇴시켰다. 바로 아래 `commit()` 이 **값이 바뀐 그 자리**에서
       번쩍이고, 추가된 백로그 은 같은 카드의 목록에 즉시 나타난다 → 토스트는 같은 사실을
       화면 구석에서 한 번 더 말하는 것이었다(되돌리기도 필요 없다 · 예산 두 조건 모두 불해당). */
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
        보충 필요 백로그 <span className="ds-tiny text-mut">— 회수되지 않는 라벨은 "공부했다는 착각"의 온상</span>
      </h2>
      <div className="ds-row" style={{ marginBottom: 6 }}>
        <span className={`ds-pill ${open.length ? 'ds-warn' : 'ds-good'}`}>열림 {open.length}</span>
        <span className="ds-pill ds-good">회수 {closed}</span>
        <span style={{ flex: 1 }} />
      </div>
      {/* ── I042 미분류 — **나가는 길 셋**(지금 배정 · N일 뒤 · 버림) ─────────────────────
          ⚠ 캡처는 세 입구(⌘K·미니 HUD·폰)가 전부 판정 없이 백로그로 직행했다. 그러면
          «지하철에서 떠오른 한 줄»과 «정말 막힌 것»이 같은 무게로 쌓이고, 밖의 표본이 경고하는
          결말이 온다: *"검증 안 된 유입이 쌓여 백로그 전체가 아무도 안 읽는 목록이 된다."*
          ⚠⚠ **없으면 아예 안 그린다.** 매일 「판정할 것 0」을 그리면 그게 새 죄책감 더미이고,
          그건 이 항목이 스스로 경계한 대가(«판정 노동이 의무가 된다») 그대로다. */}
      {untriaged.length > 0 && (
        <div className="ds-note mb-2">
          <div className="ds-tiny mb-1.5">
            <b className="text-txt">미분류 {untriaged.length}</b> — 캡처가 담아 둔 것이에요. 지금 정하거나 미뤄 두세요.
          </div>
          <ul className="m-0! flex list-none flex-col gap-1.5 p-0!">
            {untriaged.map((b) => (
              <li key={b.id} className="m-0! flex flex-wrap items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-xs text-txt">{b.topic || b.note}</span>
                <Button sm variant="ghost" onClick={() => mutate((st) => triageBacklog(st, b.id))}>
                  지금 볼 것
                </Button>
                <Button sm variant="ghost" onClick={() => later(b, 7)}>
                  7일 뒤
                </Button>
                <Button sm variant="ghost" onClick={() => del(b.id)}>
                  버림
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
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
            메모 <span className="ds-tiny text-mut">(가정·결과식·물리적 의미만)</span>
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
        <span className="ds-tiny text-mut" style={{ marginLeft: 8 }}>
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
            /* W13 커서 — 행 하나가 탭 스톱 하나. 어휘는 `useListCursor` 가 7개로 닫는다:
               여기선 `x` 회수 · `e` 수정 · `d` 삭제. 안쪽 컨트롤은 `tabIndex={-1}` 이라 Tab 이 안 든다. */
            <div
              key={b.id}
              ref={cursor.register(b.id)}
              role="group"
              aria-label={b.topic || '보충'}
              tabIndex={cursor.tabStop === b.id ? 0 : -1}
              onFocus={() => cursor.onItemFocus(b.id)}
              aria-current={cursor.cursor === b.id ? true : undefined}
              className={`ds-rec ds-blOpen${cursor.cursor === b.id ? ' rounded-md bg-[var(--tint-ink-5)]' : ''}`}
            >
              <div className="ds-recHead">
                <input
                  type="checkbox"
                  tabIndex={-1}
                  aria-label="회수 완료"
                  checked={false}
                  onChange={() => toggleUndo(b.id)}
                />
                <span className="ds-swatch" style={{ background: itemById(state, b.sid)?.color || 'var(--mut)' }} />
                <b>{b.topic || '(주제 없음)'}</b>
                {b.name && <span className="ds-tiny text-mut"> · {b.name}</span>}
                <span className="ds-tiny text-mut" style={{ marginLeft: 6 }}>
                  {b.ds}
                </span>
                <Button
                  sm
                  variant="ghost"
                  tabIndex={-1}
                  style={{ marginLeft: 'auto' }}
                  onClick={() => startEdit(b)}
                  title="수정"
                >
                  ✎
                </Button>
                <Button sm variant="ghost" danger tabIndex={-1} onClick={() => del(b.id)} title="삭제">
                  ✕
                </Button>
              </div>
              {b.note && <div className="ds-tiny">{b.note}</div>}
            </div>
          ),
        )
      ) : (
        <div className="ds-empty ds-tiny">열린 '보충 필요' 항목이 없어요 — 백로그를 닫아 두는 게 메타인지.</div>
      )}
    </div>
  );
}
