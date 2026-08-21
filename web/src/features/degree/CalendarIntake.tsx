/* ============================================================
   CalendarIntake — **`.ics` 인입구**(I008 · 2026-08-22 발상 축). 학교가 이미 가진 것을 받아 적는다.

   ## 이 화면이 없앨 마찰

   실 DB 실측(2026-08-22): 일과의 수업 블록 넷이 **전부 이름이 그냥 「수업」** 이고 주 10시간을
   먹는데 앱은 어느 과목인지 모른다(자습 목표 합은 주 3시간이다 — 즉 앱이 세는 것보다 세 배 큰
   덩어리가 이름 없이 앉아 있다). 그것을 손으로 네 번 치는 것보다 **학교가 주는 파일 하나**를
   주는 편이 싸다.

   ## ⚠ 왜 `integrations` 가 아니라 여기인가 (원장 처방과 갈린 점)

   원장 I008 은 표면을 _"`integrations` 한 줄"_ 이라 적었다. 그 탭이 지는 것은 **바깥 도구와의
   연결**(Anki · 볼트)이고, `.ics` 는 도구가 아니라 **학사 입력**이다 — 강의계획서 붙여넣기와
   정확히 같은 질문(«학교에서 받은 것을 어디에 넣나»)에 답한다. 둘을 갈라 두면 그 질문의 답이
   두 탭에 나뉘고, 그게 이 저장소가 «흩어져 있다»로 반복해 잡아 온 형태다.

   ## ⚠ 규율은 이웃(`SyllabusIntake`)과 같다

   자동 반영하지 않는다(체크박스) · 못 읽은 것을 센다 · 판정은 전부 lib(`lib/icsParse`).
   ⚠⚠ **시험은 여기서 반영하지 않는다.** 학사일정의 「중간고사 기간」은 학교 전체의 것이라
   *어느 과목의* 시험인지 파일이 말하지 않는다. 과목을 하나 골라 꽂으면 나머지 과목의 시험이
   조용히 비고, 사용자는 앱이 다 안다고 믿는다. 그래서 **읽었다는 사실만 보여 주고 어디로
   가야 하는지 말한다** — 이것이 규율 2(못 읽은 것을 센다)의 짝이다.
============================================================ */
import { useMemo, useState } from 'react';
import { useApp } from '@/store/useApp';
import { toast } from '@/shell';
import { Button, Pill } from '@/components/ui';
import { icsDraftIsEmpty, lectureToBlock, matchLectureSid, parseIcs, type IcsDraft } from '@/lib/icsParse';
import { MARK_LABEL } from '@/lib/syllabusIntake';
import { activeSemester, linkableItems } from '@/lib/semester';
import { BLOCK_CLASS, rid, todayISO } from '@/lib/utils';
import type { AcademicMark } from '@/lib/types';

const WD = ['일', '월', '화', '수', '목', '금', '토'];
const allOf = (n: number): Set<number> => new Set(Array.from({ length: n }, (_, i) => i));
const EMPTY: IcsDraft = { lectures: [], marks: [], exams: [], unparsed: 0, events: 0 };

type Picks = { lectures: Set<number>; marks: Set<number> };

export default function CalendarIntake() {
  const state = useApp((s) => s.state);
  const mutate = useApp((s) => s.mutate);
  const sem = activeSemester(state, todayISO(state));
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [picks, setPicks] = useState<Picks | null>(null);

  const draft = useMemo(() => (text ? parseIcs(text) : EMPTY), [text]);
  /* I013 — 강의명이 어느 과목인가. **여기서 미리 맞춰 두는 이유**는 화면이 「몇 개가 붙었나」를
     반영 *전에* 말해야 하기 때문이다(붙은 뒤에 말하면 안 붙은 것을 사용자가 못 고른다). */
  const items = useMemo(() => linkableItems(state.items).filter((i) => i.name), [state.items]);
  const sidOf = useMemo(
    () => new Map(draft.lectures.map((l) => [l.name, matchLectureSid(l.name, items)])),
    [draft, items],
  );
  const linked = draft.lectures.filter((l) => sidOf.get(l.name)).length;
  const p: Picks = picks ?? { lectures: allOf(draft.lectures.length), marks: allOf(draft.marks.length) };
  const toggle = (kind: keyof Picks, i: number): void =>
    setPicks(() => {
      const next: Picks = { lectures: new Set(p.lectures), marks: new Set(p.marks) };
      if (next[kind].has(i)) next[kind].delete(i);
      else next[kind].add(i);
      return next;
    });

  const read = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setText(await file.text());
    setName(file.name);
    setPicks(null);
  };

  /** 고른 것을 두 슬라이스에 넣는다. ⚠ 한 번의 `mutate` — ⌘Z 한 번으로 통째로 되돌아간다. */
  const apply = (): void => {
    /* ⚠ 카운터를 **객체 필드**로 둔다 — 콜백 안에서 잡힌 `let n = 0` 은 React Compiler 를
       바일아웃시킨다(`SyllabusIntake` 가 같은 자리에서 물린 것). */
    const n = { lecture: 0, mark: 0 };
    mutate((st) => {
      draft.lectures.forEach((l, i) => {
        if (!p.lectures.has(i)) return;
        /* ⚠ **같은 블록을 두 번 넣지 않는다.** 학기 중에 파일을 다시 받는 것이 정상 사용이고
           (I010 — 시간표는 바뀐다), 그때마다 쌓이면 가용시간이 실제보다 적어진다. */
        const dup = st.routine.some(
          (b) => b.name === l.name && b.start === l.start && b.end === l.end && b.days.join() === l.days.join(),
        );
        if (dup) return;
        st.routine.push(lectureToBlock(l, BLOCK_CLASS, sidOf.get(l.name)));
        n.lecture += 1;
      });
      const target = st.degree.semesters.find((s) => s.id === sem?.id);
      if (target) {
        const marks: AcademicMark[] = target.marks || [];
        draft.marks.forEach((m, i) => {
          if (!p.marks.has(i)) return;
          if (marks.some((x) => x.ds === m.ds && x.kind === m.kind)) return;
          marks.push({ id: rid(), kind: m.kind, ds: m.ds, label: m.label });
          n.mark += 1;
        });
        if (marks.length) target.marks = marks;
      }
    });
    toast(`수업 ${n.lecture} · 학사일정 ${n.mark} 반영됨 — ⌘Z 로 되돌릴 수 있어요.`, 'ok');
    setText('');
    setName('');
    setPicks(null);
  };

  const row = (kind: keyof Picks, i: number, main: string, meta: string) => (
    <li key={`${kind}-${i}`} className="flex items-center gap-2 py-0.5 text-md">
      <input
        type="checkbox"
        checked={p[kind].has(i)}
        onChange={() => toggle(kind, i)}
        aria-label={`${main} 반영`}
        className="shrink-0"
      />
      <span className="min-w-0 flex-1 truncate">{main}</span>
      <span className="ds-tiny shrink-0 text-mut tabular-nums">{meta}</span>
    </li>
  );

  return (
    <div className="ds-rule">
      <div className="mb-3 flex flex-wrap items-baseline gap-3">
        <span className="ds-caps">시간표·학사일정 파일(.ics)</span>
        {name ? <Pill tiny>{name}</Pill> : null}
        {!sem && draft.marks.length > 0 ? (
          <Pill tiny tone="warn">
            학기가 없어 학사일정은 못 넣어요
          </Pill>
        ) : null}
      </div>

      <label htmlFor="ics-file" className="ds-tiny mb-1 block text-mut">
        학교 포털에서 받은 <code>.ics</code> 를 고르세요 — 매주 반복하는 수업은 <b>일과</b>로, 날짜 하나짜리 학사일정은
        <b> 학기 눈금</b>으로 들어갑니다.
      </label>
      <input
        id="ics-file"
        type="file"
        accept=".ics,text/calendar"
        onChange={(e) => {
          void read(e.target.files?.[0]);
        }}
      />

      {text.trim() && (
        <div className="mt-3 border-t border-line2 pt-3">
          {icsDraftIsEmpty(draft) ? (
            <p className="m-0 text-md text-warn">
              쓸 수 있는 일정이 없어요 — 이벤트 {draft.events}개 중 매주 반복하는 수업도, 아는 학사일정 낱말(휴강 · 수강
              정정 · 보강)도 없었습니다.
            </p>
          ) : (
            <div className="grid gap-3.5 md:grid-cols-2">
              {draft.lectures.length > 0 && (
                <div>
                  <div className="ds-caps mb-1">
                    수업 {draft.lectures.length}
                    {/* I013 — 조용한 축소 보고 금지. 안 붙는 것이 정상이므로 **분모와 함께** 말한다. */}
                    <span className="ds-tiny ml-1 font-normal text-mut">과목 연결 {linked}</span>
                  </div>
                  <ul className="m-0 list-none p-0">
                    {draft.lectures.map((l, i) =>
                      row(
                        'lectures',
                        i,
                        l.where ? `${l.name} · ${l.where}` : l.name,
                        `${l.days.map((d) => WD[d]).join('')} ${l.start}–${l.end}${sidOf.get(l.name) ? ' · 연결됨' : ''}`,
                      ),
                    )}
                  </ul>
                </div>
              )}
              {draft.marks.length > 0 && (
                <div>
                  <div className="ds-caps mb-1">학사일정 {draft.marks.length}</div>
                  <ul className="m-0 list-none p-0">
                    {draft.marks.map((m, i) => row('marks', i, m.label || MARK_LABEL[m.kind], m.ds))}
                  </ul>
                </div>
              )}
            </div>
          )}
          {/* ⚠ 읽었지만 **안 넣는** 것을 숨기지 않는다 — 머리주석의 그 이유. */}
          {draft.exams.length > 0 && (
            <p className="ds-tiny mt-2 mb-0 text-mut">
              시험 {draft.exams.length}건({draft.exams.map((e) => e.date).join(' · ')})도 읽었지만 넣지 않았어요 — 이
              파일은 <b>어느 과목의</b> 시험인지 말해 주지 않습니다. 과목 시험은 아래 강의계획서 붙여넣기에서 들어가요.
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={apply} disabled={icsDraftIsEmpty(draft)}>
              고른 것 반영
            </Button>
            {/* 규율 2 — 못 읽은 것을 숨기지 않는다. 분모를 함께 말한다. */}
            <span className="ds-tiny text-mut">
              {draft.unparsed > 0
                ? `이벤트 ${draft.events}개 중 ${draft.unparsed}개는 뜻을 못 붙였어요`
                : `이벤트 ${draft.events}개를 모두 읽었어요`}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
