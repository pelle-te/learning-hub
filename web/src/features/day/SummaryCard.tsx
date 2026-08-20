/* ============================================================
   SummaryCard — 3문장 요약(학습방법론 3절). 그날 배운 것을 What&Why / How / Result로 압축.
   (867줄짜리 Journal.tsx에서 카드 단위로 분리 — 세 카드가 각각 draft state + 편집 폼 + 목록을
    가진 독립 단위였다.)
============================================================ */
import { useId, useRef, useState } from 'react';
import { useApp } from '@/store/useApp';
import { exportAnkiCards, exportSummaryNotes, toast } from '@/shell';
import { useRecordEditor } from '@/shell/useRecordEditor';
import { summariesFor, addSummary, editSummary, delSummary, cbmsBetween } from '@/lib/methodology';
import { itemById, todayISO } from '@/lib/utils';
import { Button } from '@/components/ui';
import { commit } from '@/lib/motion';
import { useFormSubmit } from '@/hooks/useFormSubmit';
import { MOD_ENTER_LABEL } from '@/lib/platform';
import { SubjectSelect, usePrefillForm, nameOf } from './shared';
import { Icon } from '@/components/Icon';

/**
 * Q-20 — 같은 폼 안의 **다음 textarea** 로 포커스를 옮긴다. 마지막 칸이면 `false`.
 *
 * ⚠ `false` 를 정직하게 돌려주는 것이 계약의 절반이다 — 마지막 칸에서 `true` 를 주면 Enter 가
 * 그 칸에서만 아무것도 안 하는 죽은 키가 된다(`useFormSubmit` 의 `advance` 주석).
 */
function advanceField(from: HTMLElement): boolean {
  const form = from.closest('.ds-rule, form') ?? from.parentElement;
  if (!form) return false;
  const fields = [...form.querySelectorAll<HTMLTextAreaElement>('textarea')];
  const next = fields[fields.indexOf(from as HTMLTextAreaElement) + 1];
  if (!next) return false;
  next.focus();
  next.setSelectionRange(next.value.length, next.value.length);
  return true;
}

export default function SummaryCard({ ds: dsKey }: { ds: string }) {
  const cardRef = useRef<HTMLDivElement>(null); // D-7 commit 착지 대상(값이 바뀐 상자)
  const uid = useId(); // label↔입력 연결용 고유 접두(폼이 여러 개 떠도 id 충돌 없음)
  const state = useApp((s) => s.state);
  const mutate = useApp((s) => s.mutate);
  const [sid, setSid] = useState('');
  const [s1, setS1] = useState('');
  const [s2, setS2] = useState('');
  const [s3, setS3] = useState('');
  const firstField = useRef<HTMLTextAreaElement>(null);
  usePrefillForm('sum', setSid, firstField);

  const list = summariesFor(state, dsKey);
  // 인라인 편집 + 삭제 — 공용 SSOT(useRecordEditor). 되돌리기는 전역 ⌘Z 가 행 단위로 덮는다(근본①).
  const { editId, draft, setDraft, startEdit, cancel, saveEdit, del } = useRecordEditor<
    (typeof list)[number],
    { sid: string; s1: string; s2: string; s3: string }
  >({
    emptyDraft: { sid: '', s1: '', s2: '', s3: '' },
    toDraft: (x) => ({ sid: x.sid, s1: x.s1, s2: x.s2, s3: x.s3 }),
    validate: (d) => (!d.s1.trim() && !d.s2.trim() && !d.s3.trim() ? '세 문장 중 최소 하나는 남겨주세요.' : null),
    save: (st, id, d) =>
      editSummary(st, dsKey, id, {
        sid: d.sid,
        name: nameOf(st, d.sid),
        s1: d.s1.trim(),
        s2: d.s2.trim(),
        s3: d.s3.trim(),
      }),
    remove: (st, id) => delSummary(st, dsKey, id),
    deleteLabel: '요약 삭제됨',
    savedToast: '요약 수정됨',
  });
  /* D-7 commit — 저장이 **값이 바뀐 자리**에서 보이게 한다. 종전 성공 신호는 토스트뿐이라
     화면 구석에서 뜨고 사라졌고, "무엇이" 바뀌었는지는 말하지 못했다(모션 어휘 `commit`). */
  const submit = () => {
    if (!s1.trim() && !s2.trim() && !s3.trim()) {
      toast('세 문장 중 최소 하나는 적어주세요.', 'warn');
      return;
    }
    mutate((st) => addSummary(st, dsKey, sid, nameOf(st, sid), s1.trim(), s2.trim(), s3.trim()));
    setS1('');
    setS2('');
    setS3('');
    /* E15 — 성공 토스트를 은퇴시켰다. 바로 아래 `commit()` 이 **값이 바뀐 그 자리**에서
       번쩍이고, 추가된 요약 은 같은 카드의 목록에 즉시 나타난다 → 토스트는 같은 사실을
       화면 구석에서 한 번 더 말하는 것이었다(되돌리기도 필요 없다 · 예산 두 조건 모두 불해당). */
    commit(cardRef.current); // D-7 — 값이 바뀐 **그 자리**에서 1회 착지(토스트만으로는 어디가 바뀐지 모른다)
  };

  /* N-17 폼 키 계약 — ⌘Enter 는 어디서나 제출 · 맨 Enter 는 한 줄 칸에서만 · Esc 는 편집 취소.
     ⚠ 새 항목 폼엔 `cancel` 을 안 넘긴다: 거기서 Esc 가 입력을 날리면 그게 더 놀랍다.
     ⚠ 옛 인라인 핸들러엔 IME 조합 가드가 없어 **한글 확정 Enter 에 덜 친 내용이 제출**됐다
        (선재 결함 · 근거는 `useFormSubmit` 머리주석). */
  /* Q-20 — 세 칸은 `rows={2}` 짜리 **한 문장 그릇**이라 맨 Enter 의 자연스러운 뜻이 줄바꿈이
     아니라 "다 썼다"다. 그래서 다음 칸으로 옮긴다(⌘Enter=제출 · ⇧Enter=줄바꿈은 그대로).
     ⚠ 이동은 **DOM 순서**로 한다 — 칸 id 를 배열로 들고 있으면 순서가 두 곳에 살게 된다. */
  const addKeys = useFormSubmit(submit, undefined, { advance: advanceField });
  const editKeys = useFormSubmit(saveEdit, cancel, { advance: advanceField });
  // 오늘 산출물(요약·오답)이 없으면 내보내기는 빈 파일 = 데드엔드 → 비활성화.
  const todayIso = todayISO({ _today: state._today });
  const canExport = summariesFor(state, todayIso).length > 0 || cbmsBetween(state, todayIso, todayIso).length > 0;

  return (
    <div ref={cardRef} className="ds-well">
      <h2>
        3문장 요약 <span className="ds-tiny text-mut">— 압축이 안 되면 이해한 게 아니다(파인만)</span>
      </h2>
      <div className="ds-fieldgrid">
        <div className="ds-fld">
          <label htmlFor={`${uid}-sid`}>과목</label>
          <SubjectSelect id={`${uid}-sid`} value={sid} onChange={setSid} />
        </div>
      </div>
      {/* label↔textarea를 htmlFor/id로 잇는다 — 예전엔 연결이 없어 스크린리더가 세 칸을 모두
          "편집, 비어 있음"으로만 읽어 1/2/3을 구별할 수 없었다. id는 useId(폼이 여러 개 동시에
          떠도 충돌하지 않게 — 편집 폼이 목록마다 열린다). */}
      <label htmlFor={`${uid}-s1`}>
        1 — What &amp; Why <span className="ds-tiny text-mut">해석하려는 핵심 현상·문제</span>
      </label>
      <textarea
        id={`${uid}-s1`}
        ref={firstField}
        rows={2}
        value={s1}
        onChange={(e) => setS1(e.target.value)}
        {...addKeys}
        placeholder="예) 시변 환경에서 자기장과 전기장이 어떻게 퍼져 나가는지 해석하려고…"
      />
      <label htmlFor={`${uid}-s2`}>
        2 — How <span className="ds-tiny text-mut">도입한 핵심 수식·가정·전개</span>
      </label>
      <textarea
        id={`${uid}-s2`}
        rows={2}
        value={s2}
        onChange={(e) => setS2(e.target.value)}
        {...addKeys}
        placeholder="예) 변위전류가 든 앙페르 법칙과 패러데이 법칙을 연립해 파동방정식을 세웠고…"
      />
      <label htmlFor={`${uid}-s3`}>
        3 — Result &amp; Meaning <span className="ds-tiny text-mut">결과와 물리적 직관</span>
      </label>
      <textarea
        id={`${uid}-s3`}
        rows={2}
        value={s3}
        onChange={(e) => setS3(e.target.value)}
        {...addKeys}
        placeholder="예) 전자기파가 빛의 속도로 전파됨을 증명 — 무선통신의 근거."
      />
      <div style={{ marginTop: 10 }}>
        {/* N-17 — 키 계약의 발견 경로는 치트시트(N-16)가 소유한다. 여기 눈에 보이는 힌트를
            달면 fill 스냅샷을 태우면서 세 카드에 같은 문구가 세 번 생긴다 → title 로만. */}
        <Button variant="primary" onClick={submit} title={`요약 저장 (${MOD_ENTER_LABEL})`}>
          요약 저장
        </Button>
        <Button
          sm
          variant="ghost"
          style={{ marginLeft: 8 }}
          onClick={() => exportAnkiCards('today')}
          disabled={!canExport}
          title={canExport ? '오늘 요약·오답을 Anki import용 .txt 카드 초안으로' : '오늘 기록한 요약·오답이 없어요'}
        >
          <Icon name="cards" /> 오늘 → Anki 카드(.txt)
        </Button>
        <Button
          sm
          variant="ghost"
          style={{ marginLeft: 6 }}
          onClick={() => exportSummaryNotes('today')}
          disabled={!canExport}
          title={
            canExport
              ? '오늘 요약을 옵시디언용 마크다운 노트(.md)로 — 카드(인출)에 이은 연결용'
              : '오늘 기록한 요약이 없어요'
          }
        >
          <Icon name="book" /> 오늘 → 노트(.md)
        </Button>
      </div>
      <div className="ds-foot ds-tiny">
        카드는 <b>초안</b>입니다 — Anki로 가져온 뒤 ≤5장으로 추리고 "왜?/응용"형으로 손질(큐레이션이 학습 이득). 복습
        시점(due)은 FSRS가 소유.
      </div>
      <hr />
      {list.length ? (
        list.map((x) =>
          editId === x.id ? (
            <div key={x.id} className="ds-rec border-line-acc-hover! bg-tint-acc-faint!">
              <div className="ds-fld">
                <label htmlFor={`sum-edit-${x.id}`}>과목</label>
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
                {...editKeys}
                placeholder="1 — 현상·왜"
              />
              <textarea
                rows={2}
                value={draft.s2}
                onChange={(e) => setDraft((d) => ({ ...d, s2: e.target.value }))}
                {...editKeys}
                placeholder="2 — 도구·어떻게"
              />
              <textarea
                rows={2}
                value={draft.s3}
                onChange={(e) => setDraft((d) => ({ ...d, s3: e.target.value }))}
                {...editKeys}
                placeholder="3 — 결과·의미"
              />
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
            <div key={x.id} className="ds-rec">
              <div className="ds-recHead">
                <span className="ds-swatch" style={{ background: itemById(state, x.sid)?.color || 'var(--acc)' }} />
                <b>{x.name || '(과목 없음)'}</b>
                <Button sm variant="ghost" style={{ marginLeft: 'auto' }} onClick={() => startEdit(x)} title="수정">
                  ✎
                </Button>
                <Button sm variant="ghost" danger onClick={() => del(x.id)} title="삭제">
                  ✕
                </Button>
              </div>
              <ol className="ds-rec3">
                <li>
                  <span className="ds-tiny text-mut">현상·왜</span> {x.s1}
                </li>
                <li>
                  <span className="ds-tiny text-mut">도구·어떻게</span> {x.s2}
                </li>
                <li>
                  <span className="ds-tiny text-mut">결과·의미</span> {x.s3}
                </li>
              </ol>
            </div>
          ),
        )
      ) : (
        <div className="ds-empty ds-tiny">오늘 작성한 요약이 없어요. 블록 끝마다 한 개씩.</div>
      )}
    </div>
  );
}
