/* ============================================================
   Degree — 탭: 🎓 졸업 (Phase 4 · 앱상태/Zustand)
   세그먼트 토글로 두 뷰를 한 탭에 통합(옛 degreeReq 탭 병합):
   · 졸업 계획(DegreePlan) — 학기별 수강·학점/요건 추적·GPA 인사이트(앱상태)
   · 졸업요건 정리(DegreeReq) — 요람 기준 정적 요건표(읽기전용)
   courses는 스키마가 느슨(passthrough)해 로컬 Course 타입으로 좁혀 다룬다.
   스타일: 공유 디자인 시스템은 styles/ds.module.css(ds.*), 요소·토큰은 전역 base(Phase 9 전환).
============================================================ */
import { useState } from 'react';
import { useApp } from '@/store/useApp';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { ui } from '@/shell';
import { rid, makeItem } from '@/lib/utils';
import { useCountUp } from '@/lib/interactions';
import { Button } from '@/components/ui';
import { ProgressRing } from '@/components/ProgressRing';
import ds from '@/styles/ds.module.css';
import c from './Degree.module.css';
import type { AppState, Degree as DegreeT } from '@/lib/types';
import DegreeReq from '@/features/degreeReq/DegreeReq';
import SeasonRoadmap from './SeasonRoadmap';

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
// 성적 드롭다운 순서(정규 키) — P(이수)는 GRADE_POINTS에 없어 GPA에서 자동 제외(Pass/Fail).
const GRADE_KEYS = ['A+', 'A0', 'A-', 'B+', 'B0', 'B-', 'C+', 'C0', 'C-', 'D+', 'D0', 'D-', 'F', 'P'];

interface Course {
  id: string;
  name: string;
  credits: number;
  category: string;
  status: string;
  grade?: string;
}
type Semester = { id: string; name: string; courses: Course[] };
/** CourseSchema가 실제 필드로 정밀화돼 d.semesters가 이미 Semester[]로 타입됨(구버전 캐스팅 제거). */
const sems = (d: DegreeT): Semester[] => d.semesters;

type DegKey = 'targetTotal' | 'reqMajorReq' | 'reqMajorSel' | 'reqLiberal';

interface DegreeStats {
  earned: number; // 완료(이수) 학점
  inprog: number;
  planned: number;
  byCat: Record<string, number>;
  gpa: number | null;
  gradedCr: number;
  semDone: number;
}
/** 학기·과목 전체를 한 번만 순회해 모든 집계를 낸다(요건 요약·졸업 인사이트 공유 · 이중순회 제거). */
function degreeStats(d: DegreeT): DegreeStats {
  let earned = 0;
  let inprog = 0;
  let planned = 0;
  let pts = 0;
  let gradedCr = 0;
  let semDone = 0;
  const byCat: Record<string, number> = {};
  CATS.forEach((c) => (byCat[c] = 0));
  sems(d).forEach((s) => {
    let hasDone = false;
    s.courses.forEach((c) => {
      const cr = +c.credits || 0;
      if (c.status === '완료') {
        earned += cr;
        byCat[c.category] = (byCat[c.category] || 0) + cr;
        hasDone = true;
        const g = (c.grade || '').toUpperCase().trim();
        if (g in GRADE_POINTS) {
          pts += GRADE_POINTS[g]! * cr;
          gradedCr += cr;
        }
      } else if (c.status === '수강중') inprog += cr;
      else planned += cr;
    });
    if (hasDone) semDone++;
  });
  return { earned, inprog, planned, byCat, gpa: gradedCr ? pts / gradedCr : null, gradedCr, semDone };
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
      st.degree.semesters = sems(st.degree).filter((s) => s.id !== sem.id);
    });
    ui.toast('학기 삭제됨', 'info');
  };
  const courseToItem = (name: string) => {
    if (items.some((s) => s.name === name)) {
      ui.toast('이미 학습 항목에 있어요.', 'warn');
      return;
    }
    mutate((st) => {
      st.items.push(makeItem(st.items.length, { source: '수강', name }));
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
                      {/* 자유입력은 오타(P/S 등)가 GPA에서 조용히 누락됐다 → GRADE_POINTS 키 선택으로 고정. */}
                      <select
                        value={c.grade && GRADE_KEYS.includes(c.grade) ? c.grade : ''}
                        onChange={(e) => updCourse(c.id, 'grade', e.target.value)}
                        style={{ width: 68 }}
                        aria-label="성적"
                      >
                        <option value="">—</option>
                        {GRADE_KEYS.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {(c.status === '수강중' || c.status === '예정') && (
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

function DegreePlan() {
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
    // 이름 자동 증가 — 직전 학기가 'YYYY-N학기'면 같은 해 다음 학기(1→2) 또는 다음 해 1학기로 제안(수기 개명 감소).
    const suggestName = (): string => {
      const last = d.semesters[d.semesters.length - 1]?.name || '';
      const mm = last.match(/(\d{4})\s*-\s*([12])\s*학기/);
      if (!mm) return '새 학기';
      const yr = +mm[1]!;
      const term = +mm[2]!;
      return term === 1 ? `${yr}-2학기` : `${yr + 1}-1학기`;
    };
    const name = suggestName();
    mutate((st) => {
      st.degree.semesters.push({ id, name, courses: [] });
    });
    setOpenSems((prev) => new Set(prev).add(id));
  };

  const stats = degreeStats(d);
  const { earned, inprog, planned, byCat, gpa, gradedCr, semDone } = stats;
  const remain = Math.max(0, d.targetTotal - earned);
  const pct = d.targetTotal > 0 ? Math.round((earned / d.targetTotal) * 100) : 0;
  const shownPct = useCountUp(Math.min(100, pct));
  const list = sems(d);
  const avgPerSem = semDone ? earned / semDone : 0;
  const projSem = earned && avgPerSem > 0 ? Math.ceil(remain / avgPerSem) : null;

  usePageChromeEffect(
    () => ({
      readouts: [
        {
          label: '이수',
          value: (
            <>
              {earned}
              <small> / {d.targetTotal}</small>
            </>
          ),
          accent: true,
        },
        { label: '진행', value: `${pct}%` },
        { label: 'GPA', value: gpa != null ? gpa.toFixed(2) : '—' },
      ],
    }),
    [earned, d.targetTotal, pct, gpa],
  );

  return (
    <>
      <SeasonRoadmap list={list} targetTotal={d.targetTotal} earned={earned} openIds={openSems} onToggle={toggle} />

      {/* 졸업 현황 — 진행 링 + 게이지 히어로(이수·평점·남은·예상) + 카테고리 바. */}
      <div className={`${ds.card} ${c.statusCard}`}>
        <div className={c.statusEyebrow}>졸업 현황</div>
        <div className={c.statusHero}>
          <div className={c.gradeRing} role="img" aria-label={`졸업 진행 ${pct}%`}>
            {/* 카운트업은 다른 링(Stats·Mastery)과 일관 — reduced-motion이면 즉시 최종값. */}
            <ProgressRing size={80} r={34} pct={shownPct} trackClassName={c.grRingTrack} arcClassName={c.grRingArc} />
            <div className={c.grRingNum}>
              {Math.round(shownPct)}
              <small>%</small>
            </div>
          </div>
          <div className={c.gauges}>
            <div className={c.g}>
              <span className={c.gV}>
                {earned}
                <small> / {d.targetTotal}</small>
              </span>
              <span className={c.gL}>이수 학점</span>
            </div>
            <div className={c.g}>
              <span className={c.gV}>
                {gpa != null ? gpa.toFixed(2) : '—'}
                <small> / 4.5</small>
              </span>
              <span className={c.gL}>평점(GPA)</span>
            </div>
            <div className={c.g}>
              <span className={c.gV}>{remain}</span>
              <span className={c.gL}>남은 학점</span>
            </div>
            <div className={c.g}>
              <span className={c.gV}>{projSem != null ? `~${projSem}` : '—'}</span>
              <span className={c.gL}>예상 잔여 학기</span>
            </div>
          </div>
        </div>
        <div className={c.statusMeta}>
          수강중 {inprog} · 예정 {planned}
          {gradedCr > 0 && gradedCr < earned ? ` · 성적 입력 ${gradedCr}/${earned}학점` : ''}
          {earned > 0 && gradedCr === 0 ? (
            <span style={{ color: 'var(--warn)' }}> · 성적을 입력하면 GPA가 계산돼요</span>
          ) : null}
        </div>

        <div className={c.cats}>
          {CATS.map((cat) => {
            const req =
              cat === '전공필수'
                ? d.reqMajorReq
                : cat === '전공선택'
                  ? d.reqMajorSel
                  : cat === '교양'
                    ? d.reqLiberal
                    : 0;
            const have = byCat[cat] || 0;
            const cpct = req ? Math.min(100, Math.round((have / req) * 100)) : have ? 100 : 0;
            return (
              <div key={cat} className={c.cat}>
                <div className={c.catTop}>
                  <span className={c.catLab}>{cat}</span>
                  <span className={c.catVal}>
                    {have}
                    {req ? <small> / {req}</small> : null}
                  </span>
                </div>
                <div className={c.catTrack}>
                  <i style={{ width: `${cpct}%` }} className={req && have >= req ? c.catDone : undefined} />
                </div>
              </div>
            );
          })}
        </div>

        <details className={c.reqDetails}>
          <summary>졸업 요건 설정</summary>
          <div className={ds.row} style={{ marginTop: 10 }}>
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
        </details>
      </div>

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

/** 졸업 탭 — 계획(편집)과 요건 정리(읽기전용)를 세그먼트로 전환. 기본은 자주 보는 '졸업 계획'. */
export default function Degree() {
  const [view, setView] = useState<'plan' | 'req'>('plan');
  return (
    <div className={c.wrap}>
      <div className={c.header}>
        <h2 className={c.eyebrow}>🎓 졸업</h2>
        <div className={`${ds.seg} ${c.viewSeg}`}>
          <button
            type="button"
            aria-pressed={view === 'plan'}
            className={view === 'plan' ? ds.on : ''}
            onClick={() => setView('plan')}
          >
            졸업 계획
          </button>
          <button
            type="button"
            aria-pressed={view === 'req'}
            className={view === 'req' ? ds.on : ''}
            onClick={() => setView('req')}
          >
            졸업요건 정리
          </button>
        </div>
      </div>
      {view === 'plan' ? <DegreePlan /> : <DegreeReq />}
    </div>
  );
}
