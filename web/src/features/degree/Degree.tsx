/* ============================================================
   Degree — 탭: 🎓 졸업 계획 (Phase 4 · 앱상태/Zustand)
   레거시 ui-degree.js를 React로 — 학기별 수강·학점/요건 추적·GPA 인사이트.
   courses는 스키마가 느슨(passthrough)해 로컬 Course 타입으로 좁혀 다룬다.
   스타일: 공유 디자인 시스템은 styles/ds.module.css(ds.*), 요소·토큰은 전역 base(Phase 9 전환).
============================================================ */
import { useState } from 'react';
import { useApp } from '@/store/useApp';
import { ui } from '@/shell';
import { rid, PALETTE } from '@/lib/utils';
import { Button } from '@/components/ui';
import ds from '@/styles/ds.module.css';
import type { AppState, Degree as DegreeT } from '@/lib/types';

const CATS = ['전공필수', '전공선택', '교양', '기타'];
const STATUSES = ['예정', '수강중', '완료'];
const GRADE_POINTS: Record<string, number> = {
  'A+': 4.5,
  A0: 4.0,
  A: 4.0,
  'A-': 3.7,
  'B+': 3.5,
  B0: 3.0,
  B: 3.0,
  'B-': 2.7,
  'C+': 2.5,
  C0: 2.0,
  C: 2.0,
  'C-': 1.7,
  'D+': 1.5,
  D0: 1.0,
  D: 1.0,
  'D-': 0.7,
  F: 0,
};

interface Course {
  id: string;
  name: string;
  credits: number;
  category: string;
  status: string;
  grade?: string;
}
type Semester = { id: string; name: string; courses: Course[] };
/** 느슨한 스키마(courses: {})를 화면 모델로 좁힘. */
const sems = (d: DegreeT) => d.semesters as unknown as Semester[];

type DegKey = 'targetTotal' | 'reqMajorReq' | 'reqMajorSel' | 'reqLiberal';

/** 완료 과목 기준 추정 — GPA · 이수/남은 학점 · 예상 잔여 학기. */
function DegreeInsight({ d }: { d: DegreeT }) {
  let pts = 0;
  let gradedCr = 0;
  let doneCr = 0;
  let semDone = 0;
  sems(d).forEach((s) => {
    let hasDone = false;
    s.courses.forEach((c) => {
      if (c.status !== '완료') return;
      const cr = +c.credits || 0;
      doneCr += cr;
      hasDone = true;
      const g = (c.grade || '').toUpperCase().trim();
      if (g in GRADE_POINTS) {
        pts += GRADE_POINTS[g]! * cr;
        gradedCr += cr;
      }
    });
    if (hasDone) semDone++;
  });
  if (!doneCr) return null;
  const gpa = gradedCr ? pts / gradedCr : null;
  const remain = Math.max(0, d.targetTotal - doneCr);
  const avgPerSem = semDone ? doneCr / semDone : 0;
  const projSem = avgPerSem > 0 ? Math.ceil(remain / avgPerSem) : null;
  return (
    <div className={ds.card}>
      <h2>
        졸업 인사이트 <span className={`${ds.muted} ${ds.tiny}`}>— 완료 과목 기준 추정</span>
      </h2>
      <div className={ds.kpis} style={{ marginBottom: 0 }}>
        <div className={ds.kpi}>
          <div className={ds.v}>
            {gpa != null ? gpa.toFixed(2) : '—'}
            <span className={`${ds.muted} ${ds.tiny}`}> / 4.5</span>
          </div>
          <div className={ds.l}>평점(GPA){gradedCr < doneCr ? ` · 성적 ${gradedCr}/${doneCr}학점` : ''}</div>
        </div>
        <div className={ds.kpi}>
          <div className={ds.v}>{doneCr}</div>
          <div className={ds.l}>이수 학점</div>
        </div>
        <div className={ds.kpi}>
          <div className={ds.v}>{remain}</div>
          <div className={ds.l}>남은 학점</div>
        </div>
        <div className={ds.kpi}>
          <div className={ds.v}>{projSem != null ? `~${projSem}학기` : '—'}</div>
          <div className={ds.l}>{avgPerSem ? `현 페이스(학기당 ${Math.round(avgPerSem)}학점)` : '예상 잔여'}</div>
        </div>
      </div>
    </div>
  );
}

function SemCard({ sem, open, onToggle }: { sem: Semester; open: boolean; onToggle: (id: string) => void }) {
  const mutate = useApp((s) => s.mutate);
  const items = useApp((s) => s.state.items);

  const findSem = (st: AppState, id: string) => sems(st.degree).find((x) => x.id === id);
  const updSem = (k: keyof Semester, v: string) =>
    mutate((st) => void (((findSem(st, sem.id) as Semester)[k] as string) = v));
  const addCourse = () =>
    mutate((st) => {
      findSem(st, sem.id)?.courses.push({
        id: rid(),
        name: '새 과목',
        credits: 3,
        category: '전공선택',
        status: '예정',
        grade: '',
      });
    });
  const delCourse = (cid: string) =>
    mutate((st) => {
      const s = findSem(st, sem.id);
      if (s) s.courses = s.courses.filter((c) => c.id !== cid);
    });
  const updCourse = (cid: string, k: keyof Course, v: string | number) =>
    mutate((st) => {
      const c = findSem(st, sem.id)?.courses.find((x) => x.id === cid);
      if (c) (c as unknown as Record<string, string | number>)[k] = v;
    });
  const delSem = async () => {
    if (
      !(await ui.confirm('이 학기를 삭제할까요? (소속 과목도 함께 삭제됩니다)', {
        title: '학기 삭제',
        okLabel: '삭제',
        danger: true,
      }))
    )
      return;
    mutate((st) => {
      st.degree.semesters = sems(st.degree).filter((s) => s.id !== sem.id) as unknown as DegreeT['semesters'];
    });
    ui.toast('학기 삭제됨', 'info');
  };
  const courseToItem = (name: string) => {
    if (items.some((s) => s.name === name)) {
      ui.toast('이미 학습 항목에 있어요.', 'warn');
      return;
    }
    mutate((st) => {
      st.items.push({
        id: rid(),
        source: '수강',
        name,
        color: PALETTE[st.items.length % PALETTE.length],
        mode: 'weekly',
        weeklyHours: 3,
        dailyMin: 30,
        deadline: '',
        chapters: [],
      });
    });
    ui.toast(`"${name}" 학습 항목에 추가됨 — 학습 항목 탭에서 주당 시간·챕터를 설정하세요.`, 'ok');
  };

  const cr = sem.courses.reduce((t, c) => t + (+c.credits || 0), 0);
  const doneCr = sem.courses.filter((c) => c.status === '완료').reduce((t, c) => t + (+c.credits || 0), 0);
  const inprog = sem.courses.filter((c) => c.status === '수강중').length;

  const header = (
    <div
      className={ds.itemhead}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onClick={() => onToggle(sem.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle(sem.id);
        }
      }}
    >
      <span className={ds.chev}>{open ? '▾' : '▸'}</span>
      <span className={ds.itemname}>{sem.name || <span className={ds.muted}>(이름 없음)</span>}</span>
      <span className={ds.itemmeta}>
        <span className={`${ds.pill} ${ds.tiny}`}>
          {cr}학점 · {sem.courses.length}과목
        </span>
        {doneCr > 0 && <span className={`${ds.pill} ${ds.tiny} ${ds.good}`}>완료 {doneCr}</span>}
        {inprog > 0 && <span className={`${ds.pill} ${ds.tiny}`}>수강중 {inprog}</span>}
      </span>
    </div>
  );

  if (!open) return <div className={`${ds.card} ${ds.itemrow}`}>{header}</div>;

  return (
    <div className={`${ds.card} ${ds.itemrow} ${ds.open}`}>
      {header}
      <div className={ds.itembody}>
        <div className={ds.fieldgrid} style={{ marginBottom: 10 }}>
          <div className={`${ds.fld} ${ds.wide}`}>
            <label htmlFor={`sem-name-${sem.id}`}>학기 이름</label>
            <input
              id={`sem-name-${sem.id}`}
              type="text"
              value={sem.name}
              onChange={(e) => updSem('name', e.target.value)}
              style={{ fontWeight: 600 }}
              placeholder="예: 2026-1학기"
            />
          </div>
        </div>
        <div className={ds.chaptbl}>
          <table>
            <thead>
              <tr>
                <th style={{ width: '34%' }}>과목</th>
                <th>학점</th>
                <th>구분</th>
                <th>상태</th>
                <th>성적</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sem.courses.length ? (
                sem.courses.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <input
                        type="text"
                        value={c.name}
                        onChange={(e) => updCourse(c.id, 'name', e.target.value)}
                        aria-label="과목 이름"
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        value={c.credits}
                        onChange={(e) => updCourse(c.id, 'credits', +e.target.value)}
                        style={{ width: 60 }}
                        aria-label="학점"
                      />
                    </td>
                    <td>
                      <select
                        value={c.category}
                        onChange={(e) => updCourse(c.id, 'category', e.target.value)}
                        aria-label="구분"
                      >
                        {CATS.map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        value={c.status}
                        onChange={(e) => updCourse(c.id, 'status', e.target.value)}
                        aria-label="상태"
                      >
                        {STATUSES.map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="text"
                        value={c.grade || ''}
                        placeholder="A+"
                        onChange={(e) => updCourse(c.id, 'grade', e.target.value)}
                        style={{ width: 60 }}
                        aria-label="성적"
                      />
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {c.status === '수강중' && (
                        <Button sm variant="ghost" title="학습 항목으로" onClick={() => courseToItem(c.name)}>
                          📥
                        </Button>
                      )}
                      <Button sm variant="ghost" danger onClick={() => delCourse(c.id)} aria-label="과목 삭제">
                        ✕
                      </Button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className={`${ds.empty} ${ds.tiny}`} style={{ padding: 12 }}>
                    과목이 없어요. 아래에서 추가하세요.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className={ds.row} style={{ marginTop: 8 }}>
          <Button sm variant="primary" onClick={addCourse}>
            + 과목 추가
          </Button>
        </div>
        <div className={ds.itemfoot}>
          <span className={`${ds.tiny} ${ds.muted}`}>
            {cr}학점 · {sem.courses.length}과목{doneCr > 0 ? ` · 완료 ${doneCr}학점` : ''}
          </span>
          <Button sm variant="ghost" danger onClick={delSem}>
            학기 삭제
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function Degree() {
  const d = useApp((s) => s.state.degree);
  const mutate = useApp((s) => s.mutate);
  const [openSems, setOpenSems] = useState<Set<string>>(() => new Set());

  const toggle = (id: string) =>
    setOpenSems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const setDeg = (k: DegKey, v: number) => mutate((st) => void (st.degree[k] = v));
  const addSemester = () => {
    const id = rid();
    mutate((st) => {
      st.degree.semesters.push({ id, name: '새 학기', courses: [] } as unknown as DegreeT['semesters'][number]);
    });
    setOpenSems((prev) => new Set(prev).add(id));
  };

  let earned = 0;
  let inprog = 0;
  let planned = 0;
  const byCat: Record<string, number> = {};
  CATS.forEach((c) => (byCat[c] = 0));
  sems(d).forEach((s) =>
    s.courses.forEach((c) => {
      const cr = +c.credits || 0;
      if (c.status === '완료') {
        earned += cr;
        byCat[c.category] = (byCat[c.category] || 0) + cr;
      } else if (c.status === '수강중') inprog += cr;
      else planned += cr;
    }),
  );
  const remain = Math.max(0, d.targetTotal - earned);
  const pct = Math.round((earned / d.targetTotal) * 100);
  const list = sems(d);

  return (
    <>
      <div className={ds.card}>
        <h2>졸업 요건</h2>
        <div className={ds.row}>
          <div>
            <label htmlFor="deg-total">졸업 총 학점</label>
            <input
              id="deg-total"
              type="number"
              value={d.targetTotal}
              onChange={(e) => setDeg('targetTotal', +e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="deg-req">전공필수</label>
            <input
              id="deg-req"
              type="number"
              value={d.reqMajorReq}
              onChange={(e) => setDeg('reqMajorReq', +e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="deg-sel">전공선택</label>
            <input
              id="deg-sel"
              type="number"
              value={d.reqMajorSel}
              onChange={(e) => setDeg('reqMajorSel', +e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="deg-lib">교양</label>
            <input
              id="deg-lib"
              type="number"
              value={d.reqLiberal}
              onChange={(e) => setDeg('reqLiberal', +e.target.value)}
            />
          </div>
        </div>
        <div className={ds.bar} style={{ margin: '12px 0 4px' }}>
          <i style={{ width: `${Math.min(100, pct)}%`, background: 'var(--good)' }} />
        </div>
        <div className={`${ds.tiny} ${ds.muted}`}>
          이수 {earned} / 목표 {d.targetTotal} 학점 ({pct}%) · 수강중 {inprog} · 예정 {planned} · 남은 {remain}
        </div>
      </div>

      <div className={ds.kpis}>
        {CATS.map((c) => {
          const req =
            c === '전공필수' ? d.reqMajorReq : c === '전공선택' ? d.reqMajorSel : c === '교양' ? d.reqLiberal : 0;
          return (
            <div key={c} className={ds.kpi}>
              <div className={ds.v}>
                {byCat[c] || 0}
                {req ? <span className={`${ds.muted} ${ds.tiny}`}> / {req}</span> : null}
              </div>
              <div className={ds.l}>{c}</div>
            </div>
          );
        })}
      </div>

      {earned > 0 && <DegreeInsight d={d} />}

      <div className={ds.card}>
        <div className={ds.row} style={{ alignItems: 'center' }}>
          <h2 style={{ flex: 1, margin: 0 }}>
            학기별 수강{' '}
            <span className={`${ds.muted} ${ds.tiny}`} style={{ fontWeight: 400 }}>
              {list.length ? `(${list.length})` : ''}
            </span>
          </h2>
          {list.length > 1 && (
            <>
              <Button sm variant="ghost" onClick={() => setOpenSems(new Set(list.map((s) => s.id)))}>
                모두 펼치기
              </Button>
              <Button sm variant="ghost" onClick={() => setOpenSems(new Set())}>
                모두 접기
              </Button>
            </>
          )}
          <Button sm variant="primary" onClick={addSemester}>
            + 학기 추가
          </Button>
        </div>
      </div>

      {list.map((s) => (
        <SemCard key={s.id} sem={s} open={openSems.has(s.id)} onToggle={toggle} />
      ))}
    </>
  );
}
