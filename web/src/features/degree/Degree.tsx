/* ============================================================
   Degree — 탭: 🎓 졸업 (Phase 4 · 앱상태/Zustand)
   세그먼트 토글로 두 뷰를 한 탭에 통합(옛 degreeReq 탭 병합):
   · 졸업 계획(DegreePlan) — 학기별 수강·학점/요건 추적·GPA 인사이트(앱상태)
   · 졸업요건 정리(DegreeReq) — 요람 기준 정적 요건표(읽기전용)
   학기·과목 타입과 집계는 lib/degree(DegreeSemester·semesterStat 등)를 단일 출처로 공유한다.
   스타일: 공유 디자인 시스템은 styles/ds.module.css(ds.*), 요소·토큰은 전역 base(Phase 9 전환).
============================================================ */
import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/store/useApp';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { ui } from '@/shell';
import { rid, makeItem } from '@/lib/utils';
import { useCountUp } from '@/hooks/interactions';
import { Button, NumberField } from '@/components/ui';
import { ProgressRing } from '@/components/ProgressRing';
import ds from '@/styles/ds.module.css';
import c from './Degree.module.css';
import type { AppState, Degree as DegreeT } from '@/lib/types';
import {
  CATS,
  STATUSES,
  GRADE_KEYS,
  degreeStats,
  semesterGpa,
  semesterStat,
  gpaForecast,
  type DegreeSemester,
  type DegreeCourse,
} from '@/lib/degree';
import DegreeReq from './DegreeReq';
import SeasonRoadmap from './SeasonRoadmap';

/** 학기·과목 타입은 lib/degree가 SSOT(DegreeSemester/DegreeCourse). d.semesters가 이미 그 타입. */
const sems = (d: DegreeT): DegreeSemester[] => d.semesters;

type DegKey = 'targetTotal' | 'reqMajorReq' | 'reqMajorSel' | 'reqLiberal' | 'targetGpa';

function SemCard({ sem, open, onToggle }: { sem: DegreeSemester; open: boolean; onToggle: (id: string) => void }) {
  const mutate = useApp((s) => s.mutate);

  const findSem = (st: AppState, id: string) => sems(st.degree).find((x) => x.id === id);
  const updSem = (k: keyof DegreeSemester, v: string) =>
    mutate((st) => void (((findSem(st, sem.id) as DegreeSemester)[k] as string) = v));
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
  const delCourse = (cid: string, name: string) => {
    ui.backupNow(); // 되돌리기용 1단계 백업 — 형제 삭제(학기·수업·블록)와 동일한 안전장치
    mutate((st) => {
      const s = findSem(st, sem.id);
      if (s) s.courses = s.courses.filter((c) => c.id !== cid);
    });
    ui.toastUndo(`"${name || '과목'}" 삭제됨`);
  };
  const updCourse = (cid: string, k: keyof DegreeCourse, v: string | number) =>
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
    // PL-15 — items를 구독하지 않고 핸들러 시점에 스냅샷 조회(무관한 items 편집에 카드 재렌더 방지).
    if (useApp.getState().state.items.some((s) => s.name === name)) {
      ui.toast('이미 학습 항목에 있어요.', 'warn');
      return;
    }
    mutate((st) => {
      st.items.push(makeItem({ source: '수강', name }));
    });
    ui.toast(`"${name}" 학습 항목에 추가됨 — 학습 항목 탭에서 주당 시간·챕터를 설정하세요.`, 'ok');
  };

  // PL-14 — 학기 집계는 lib/degree.semesterStat 단일 출처. cr=총학점·doneCr=완료학점·inprog=수강중 과목 수.
  const st = semesterStat(sem);
  const cr = st.tot;
  const doneCr = st.done;
  const inprog = st.inprogCount;
  // PL-8 — 학기 GPA(완료·점수 성적만). 성적 없는 학기는 null → pill 미표시(노이즈 방지).
  const g = semesterGpa(sem);

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
        {g != null && <span className={`${ds.pill} ${ds.tiny}`}>GPA {g.toFixed(2)}</span>}
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
                      <NumberField
                        min={0}
                        value={c.credits}
                        emptyValue={0} // 학점을 비우면 0학점(청강 등) — 의미 있는 값
                        onCommit={(v) => updCourse(c.id, 'credits', v)}
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
                      <Button sm variant="ghost" danger onClick={() => delCourse(c.id, c.name)} aria-label="과목 삭제">
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
  const degreeCele = useApp((s) => s.state._degreeCele);
  const [openSems, setOpenSems] = useState<Set<string>>(() => new Set());
  const [celeFlash, setCeleFlash] = useState(false);
  const celebrated = useRef(false);

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
  // PL-17 — 목표 GPA 역산. 기본값은 현재 GPA를 0.5 단위 올림(없으면 4.0). 저장은 d.targetGpa(옵셔널).
  const defaultTargetGpa = gpa != null ? Math.min(4.5, Math.ceil(gpa * 2) / 2) : 4.0;
  const targetGpa = d.targetGpa ?? defaultTargetGpa;
  const fc = gpaForecast(d, targetGpa);

  // PL-10 — 졸업 요건 100% 최초 충족 축하(1회). 영속 마커 _degreeCele로 재로드 재발화 방지.
  // 재하락(pct<100)해도 마커는 리셋하지 않는다(1회성 모먼트). 링은 짧게 발광 플래시(≤1.4s, reduced-motion 백스톱).
  useEffect(() => {
    if (pct >= 100 && !degreeCele && !celebrated.current) {
      celebrated.current = true; // 마운트당 1회 가드(TodaySignature wasDone 패턴).
      ui.toast('🎓 졸업 요건 충족 — 축하해요!', 'info');
      mutate((st) => {
        st._degreeCele = true;
      });
      // 플래시 on/off는 setTimeout으로 비동기 발화 — 이펙트 본문 동기 setState 캐스케이드를 회피.
      const on = setTimeout(() => setCeleFlash(true), 0);
      const off = setTimeout(() => setCeleFlash(false), 1400);
      return () => {
        clearTimeout(on);
        clearTimeout(off);
      };
    }
  }, [pct, degreeCele, mutate]);

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
          <div
            className={`${c.gradeRing}${celeFlash ? ' ' + c.ringCele : ''}`}
            role="img"
            aria-label={`졸업 진행 ${pct}%`}
          >
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

        {/* PL-17 — 목표 GPA 역산 계산기: 남은 학점을 평균 몇 점으로 채워야 목표에 닿는지. */}
        <div className={c.gpaGoal}>
          <div className={c.ggHead}>
            <label htmlFor="deg-target-gpa">목표 평점</label>
            {/* 클램프는 NumberField가 min/max로 수행 — 비운 채 떠나면 직전 목표가 살아남는다
                (예전엔 '3.5'를 고쳐 치는 도중 빈값이 목표 평점 0으로 확정됐다). */}
            <NumberField
              id="deg-target-gpa"
              min={0}
              max={4.5}
              step={0.1}
              value={targetGpa}
              onCommit={(v) => setDeg('targetGpa', v)}
            />
            <span className={c.ggSlash}>/ 4.5</span>
          </div>
          <div className={c.ggReadout}>
            {gpa == null ? (
              <span className={ds.muted}>성적을 입력하면 목표까지 필요한 평점을 계산해요.</span>
            ) : fc.alreadyMet ? (
              <span style={{ color: 'var(--good)' }}>이미 목표 달성 ✓</span>
            ) : fc.neededAvg == null ? (
              <span className={ds.muted}>남은 과목이 없어요.</span>
            ) : (
              <>
                남은 <b>{fc.futureCr}</b>학점을 평균{' '}
                <b style={{ color: fc.feasible ? 'var(--good)' : 'var(--bad)' }}>{fc.neededAvg.toFixed(2)}</b>
                점으로 이수하면 목표 달성
                {!fc.feasible && <span style={{ color: 'var(--bad)' }}> · 만점으로도 도달 어려움</span>}
              </>
            )}
          </div>
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
            // PL-6 — 요건 없는 카테고리(req=0, '기타')는 진행바를 채우지 않는다: 학점이 있어도
            // 100%로 가득 차 '충족'처럼 오도되던 문제 제거 → 중립 트랙 + '요건 없음' 라벨.
            const met = req > 0 && have >= req;
            const cpct = req > 0 ? Math.min(100, Math.round((have / req) * 100)) : 0;
            return (
              <div key={cat} className={c.cat}>
                <div className={c.catTop}>
                  <span className={c.catLab}>{cat}</span>
                  <span className={c.catVal}>
                    {have}
                    {req > 0 ? <small> / {req}</small> : <small className={c.catNoreq}> · 요건 없음</small>}
                    {/* SD-2 requirementRows().met과 동일 의미 — 충족 시 ✓(var(--good)). */}
                    {met && (
                      <span className={c.catMet} aria-label="충족">
                        {' '}
                        ✓
                      </span>
                    )}
                  </span>
                </div>
                <div className={c.catTrack}>
                  {req > 0 && <i style={{ width: `${cpct}%` }} className={met ? c.catDone : undefined} />}
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
              <NumberField id="deg-total" min={0} value={d.targetTotal} onCommit={(v) => setDeg('targetTotal', v)} />
            </div>
            <div>
              <label htmlFor="deg-req">전공필수</label>
              <NumberField id="deg-req" min={0} value={d.reqMajorReq} onCommit={(v) => setDeg('reqMajorReq', v)} />
            </div>
            <div>
              <label htmlFor="deg-sel">전공선택</label>
              <NumberField id="deg-sel" min={0} value={d.reqMajorSel} onCommit={(v) => setDeg('reqMajorSel', v)} />
            </div>
            <div>
              <label htmlFor="deg-lib">교양</label>
              <NumberField id="deg-lib" min={0} value={d.reqLiberal} onCommit={(v) => setDeg('reqLiberal', v)} />
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
