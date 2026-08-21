/* ============================================================
   SyllabusIntake — **N-2 강의계획서 인입구**(W8 · 2026-08-07). 학기 축의 깔때기.

   ## 이 화면이 없앨 마찰

   개강 첫 주에 사람 손에 있는 것은 과목당 PDF 한 장이고, 앱이 요구하는 것은 그 PDF 를 눈으로
   읽어 **시험 날짜 · 주차 진도 · 과제 마감 · 학사 눈금**을 네 화면에 나눠 다시 치는 일이다.
   그래서 T-1 이 만든 학기 그릇이 비어 있는 것이고, 로드맵의 가설은 그 이유가 *값이 없어서*가
   아니라 **입력 비용**이라는 것이다. 여기서는 **붙여넣고 → 고르고 → 한 번 누른다.**

   ## ⚠ 자동 반영하지 않는다 — 고른 것만 들어간다

   강의계획서는 자주 틀린다(작년 날짜가 남아 있고, 중간고사 주가 밀린다). 그리고 이 화면이
   쓰는 곳은 **네 슬라이스**(과목 시험 · 주차 싱크 · 할 일 · 학기 눈금)라 잘못 들어가면
   되돌리는 비용이 크다. 그래서 파서는 *초안*을 만들고 화면은 **체크박스**를 준다.
   ⚠ 못 읽은 줄 수를 **그대로 말한다**(`unparsed`) — 조용한 축소 보고를 막는 유일한 장치.

   ## ⚠ 판정은 전부 lib

   파싱은 `lib/syllabusIntake`, 주차 점 찍기는 `lib/syllabus`(T-17), 시험은 `Item.exams`.
   여기서 하는 일은 **고른 것을 그 뮤테이터에 넘기는 것**뿐이다.
============================================================ */
import { useMemo, useState } from 'react';
import { useApp } from '@/store/useApp';
import { toast } from '@/shell';
import { Button, Pill } from '@/components/ui';
import { MARK_LABEL, dateOfWeek, draftIsEmpty, parseSyllabus } from '@/lib/syllabusIntake';
import { setSyllabusMark } from '@/lib/syllabus';
import { addTask } from '@/lib/tasks';
import { activeSemester, linkableItems } from '@/lib/semester';
import { MAX_EXAMS } from '@/lib/semester';
import { rid, todayISO } from '@/lib/utils';
import type { AcademicMark, AppState, Exam, Item } from '@/lib/types';

/** 선택 상태 — 초안의 각 줄을 받아들일지. 기본은 **전부 받아들임**(고르는 것이 아니라 *빼는* 것). */
type Picks = { weeks: Set<number>; exams: Set<number>; tasks: Set<number>; marks: Set<number> };

const allOf = (n: number): Set<number> => new Set(Array.from({ length: n }, (_, i) => i));

/** 주차 진도 문구 → 챕터 매칭. **양방향 포함**으로 본다(`3장 라플라스` ↔ `라플라스 변환`).
 *  ⚠ 못 찾으면 null 이고, 그 줄은 주차 점을 못 찍는다 — 없는 챕터를 만들지 않는다(챕터 생성은
 *  교재에서 오는 일이고, 계획서의 한 줄로 만들면 목록이 두 벌이 된다). */
function matchChapter(item: Item, topic: string): string | null {
  const t = topic.replace(/\s+/g, '');
  if (!t) return null;
  for (const c of item.chapters || []) {
    const n = c.name.replace(/\s+/g, '');
    if (!n) continue;
    if (t.includes(n) || n.includes(t)) return c.id;
  }
  return null;
}

export default function SyllabusIntake() {
  const state = useApp((s) => s.state);
  const mutate = useApp((s) => s.mutate);
  const ds = todayISO(state);
  const sem = activeSemester(state, ds);
  const items = useMemo(() => linkableItems(state.items).filter((i) => i.name), [state.items]);
  const [sid, setSid] = useState<string>(() => items[0]?.id ?? '');
  const [text, setText] = useState('');
  const [picks, setPicks] = useState<Picks | null>(null);

  const draft = useMemo(() => parseSyllabus(text, { startDs: sem?.startDs }), [text, sem?.startDs]);
  const item = items.find((i) => i.id === sid) ?? null;
  const p: Picks = picks ?? {
    weeks: allOf(draft.weeks.length),
    exams: allOf(draft.exams.length),
    tasks: allOf(draft.tasks.length),
    marks: allOf(draft.marks.length),
  };
  const toggle = (kind: keyof Picks, i: number): void =>
    setPicks(() => {
      const next: Picks = {
        weeks: new Set(p.weeks),
        exams: new Set(p.exams),
        tasks: new Set(p.tasks),
        marks: new Set(p.marks),
      };
      if (next[kind].has(i)) next[kind].delete(i);
      else next[kind].add(i);
      return next;
    });

  /** 고른 것을 네 슬라이스에 넣는다. ⚠ 한 번의 `mutate` — ⌘Z 한 번으로 통째로 되돌아간다. */
  const apply = (): void => {
    /* ⚠⚠ **종전엔 여기서 과목 없이 통째로 돌아갔다**(`if (!item) return`) — 그래서 «4/6 휴강»
       한 줄을 붙여도 아무 일이 안 일어났다. 눈금은 **학기의 속성**이지 과목의 것이 아닌데
       (`lib/semester` 의 N-19 절), 과목 게이트가 그 위에 얹혀 있었던 것이다.
       학기 중 인입(I010 · 2026-08-22)에서 오는 것은 계획서 한 장이 아니라 **공지 한 줄**이고,
       그 대부분이 눈금이다 — 즉 이 한 줄이 상시 인입구를 막고 있었다. */
    /* ⚠ 카운터를 **객체 필드**로 둔다 — `let n = 0` + `n++` 는 콜백 안에서 잡히는 순간
       React Compiler 가 바일아웃한다(`compiler-ratchet` 이 그 자리에서 잡았다). 같은 수를
       세면서 최적화를 끄지 않는다. */
    const n = { week: 0, exam: 0, task: 0, mark: 0 };
    mutate((st) => {
      const it = item ? st.items.find((x) => x.id === item.id) : null;
      if (it) applySubjectParts(st, it);
      // ④ 학사 눈금 → 학기(N-19). 같은 날·같은 종류가 이미 있으면 안 넣는다(두 과목 계획서에 같은 눈금).
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

    /** 과목이 있어야 성립하는 셋(주차 · 시험 · 과제). 눈금과 갈라 둔 이유는 위 ⚠⚠. */
    function applySubjectParts(st: AppState, it: Item): void {
      // ① 주차 진도 → T-17 주차 싱크(챕터를 못 찾은 줄은 조용히 건너뛴다 — 위 matchChapter ⚠).
      draft.weeks.forEach((w, i) => {
        if (!p.weeks.has(i)) return;
        const chId = matchChapter(it, w.topic);
        if (!chId) return;
        setSyllabusMark(it, w.week, chId);
        n.week += 1;
      });
      // ② 시험 → `Item.exams`(최대 2 · 같은 종류는 덮어쓴다).
      const exams: Exam[] = [...(it.exams || [])];
      draft.exams.forEach((e, i) => {
        if (!p.exams.has(i)) return;
        const date = e.date ?? (e.week ? dateOfWeek(e.week, sem?.startDs) : null);
        if (!date) return;
        const at = exams.findIndex((x) => x.kind === e.kind);
        const next: Exam = {
          id: at >= 0 ? exams[at]!.id : rid(),
          kind: e.kind,
          date,
          thru: at >= 0 ? exams[at]!.thru : undefined,
        };
        if (at >= 0) exams[at] = next;
        else exams.push(next);
        n.exam += 1;
      });
      if (n.exam) {
        it.exams = exams.slice(0, MAX_EXAMS);
        /* ⚠ 옛 단일 마감을 남겨 두면 `examsOf` 는 `exams` 를 쓰지만 옛 필드를 직접 읽는 코드가
           생길 때 두 원천이 갈린다 — `SubjectDefinition` 이 시험을 편집할 때 하는 것과 같다. */
        delete it.deadline;
        delete it.deadlineThru;
      }
      // ③ 과제 → 할 일(N-1 이 이걸 시간 예산으로 읽는다). ⚠ **소요는 안 지어낸다**(창을 못 깎는다).
      draft.tasks.forEach((t, i) => {
        if (!p.tasks.has(i)) return;
        addTask(st, { title: `${it.name} — ${t.title}`, sid: it.id, ds: t.deadline, deadline: t.deadline });
        n.task += 1;
      });
    }
    toast(`주차 ${n.week} · 시험 ${n.exam} · 과제 ${n.task} · 눈금 ${n.mark} 반영됨 — ⌘Z 로 되돌릴 수 있어요.`, 'ok');
    setText('');
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
        <span className="ds-caps">계획서·공지 붙여넣기</span>
        {sem ? (
          <Pill tiny>{sem.name || '학기'}</Pill>
        ) : (
          <Pill tiny tone="warn">
            학기 날짜 없음 — 연도 없는 날짜(3/2)는 못 읽어요
          </Pill>
        )}
      </div>

      {
        <>
          {/* ⚠ 과목이 없어도 화면을 닫지 않는다(I010) — 학사 눈금은 학기의 것이라 과목 0 에서도
              들어간다. 종전엔 여기서 통째로 «먼저 과목을 만드세요» 로 끝나 «휴강» 한 줄이
              들어갈 길이 없었다. */}
          <div className="ds-row mb-2.5">
            <div>
              <label htmlFor="intake-sid">어느 과목</label>
              <select id="intake-sid" value={sid} onChange={(e) => setSid(e.target.value)} disabled={!items.length}>
                {items.length ? (
                  items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))
                ) : (
                  <option value="">과목 없음 — 학사일정만 들어가요</option>
                )}
              </select>
            </div>
          </div>
          <label htmlFor="intake-text" className="ds-tiny mb-1 block text-mut">
            개강 첫 주엔 <b>계획서를 통째로</b>, 학기 중엔 <b>공지 한 줄</b>을 그대로 붙여 넣으세요 —{' '}
            <code>4/6 휴강</code> 처럼 날짜와 낱말만 있으면 읽습니다.
          </label>
          <textarea
            id="intake-text"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setPicks(null); // 텍스트가 바뀌면 인덱스가 달라진다 — 옛 선택을 이어 쓰면 엉뚱한 줄이 선택된다.
            }}
            rows={8}
            className="w-full font-mono text-sm"
            placeholder={'1주차  오리엔테이션\n8주차 4/20 중간고사\n과제 1 제출 4/27\n4/6 휴강 (개교기념일)'}
          />

          {text.trim() && (
            <div className="mt-3 border-t border-line2 pt-3">
              {draftIsEmpty(draft) ? (
                <p className="m-0 text-md text-warn">
                  한 줄도 못 읽었어요 — 날짜(3/2 · 2026-03-02)나 주차(1주차) 표기가 있는 줄이 필요해요.
                </p>
              ) : (
                <div className="grid gap-3.5 md:grid-cols-2">
                  {draft.weeks.length > 0 && (
                    <div>
                      <div className="ds-caps mb-1">주차 진도 {draft.weeks.length}</div>
                      <ul className="m-0 list-none p-0">
                        {draft.weeks.map((w, i) =>
                          row(
                            'weeks',
                            i,
                            w.topic,
                            item && matchChapter(item, w.topic) ? `${w.week}주 ✓` : `${w.week}주 · 챕터 못 찾음`,
                          ),
                        )}
                      </ul>
                    </div>
                  )}
                  {draft.exams.length > 0 && (
                    <div>
                      <div className="ds-caps mb-1">시험 {draft.exams.length}</div>
                      <ul className="m-0 list-none p-0">
                        {draft.exams.map((e, i) =>
                          row(
                            'exams',
                            i,
                            e.kind === 'mid' ? '중간고사' : '기말고사',
                            e.date ?? (e.week ? (dateOfWeek(e.week, sem?.startDs) ?? `${e.week}주`) : '날짜 모름'),
                          ),
                        )}
                      </ul>
                    </div>
                  )}
                  {draft.tasks.length > 0 && (
                    <div>
                      <div className="ds-caps mb-1">과제 {draft.tasks.length}</div>
                      <ul className="m-0 list-none p-0">
                        {draft.tasks.map((t, i) => row('tasks', i, t.title, t.deadline))}
                      </ul>
                    </div>
                  )}
                  {draft.marks.length > 0 && (
                    <div>
                      <div className="ds-caps mb-1">학사일정 {draft.marks.length}</div>
                      <ul className="m-0 list-none p-0">
                        {draft.marks.map((m, i) => row('marks', i, MARK_LABEL[m.kind], m.ds))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {/* ⚠ 과목은 **주차·시험·과제**에만 필요하다 — 눈금만 골랐으면 과목 없이 넣는다(I010). */}
                <Button
                  variant="primary"
                  onClick={apply}
                  disabled={draftIsEmpty(draft) || (!item && p.marks.size === 0)}
                >
                  고른 것 반영
                </Button>
                {/* 규율 2 — 못 읽은 줄을 숨기지 않는다. */}
                <span className="ds-tiny text-mut">
                  {draft.unparsed > 0 ? `못 읽은 줄 ${draft.unparsed}개는 그대로 남습니다` : '모든 줄을 읽었어요'}
                </span>
              </div>
            </div>
          )}
        </>
      }
    </div>
  );
}
