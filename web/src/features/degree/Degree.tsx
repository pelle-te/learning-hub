/* ============================================================
   Degree — 탭: 🎓 졸업 (Phase 4 · 앱상태/Zustand)
   세그먼트 토글로 두 뷰를 한 탭에 통합(옛 degreeReq 탭 병합):
   · 졸업 계획(DegreePlan) — 학기별 수강·학점/요건 추적·GPA 인사이트(앱상태)
   · 졸업요건 정리(DegreeReq) — 요람 기준 정적 요건표(읽기전용)
   학기·과목 타입과 집계는 lib/degree(DegreeSemester·semesterStat 등)를 단일 출처로 공유한다.
   스타일: 공유 디자인 시스템은 styles/ds.css(`ds-*` 전역), 요소·토큰은 전역 base.
============================================================ */
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { tabByKey, viewValueOf, viewsOfHost } from '@/shell/tabs';
import State from '@/components/State';
import { useApp } from '@/store/useApp';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { commitUndoable, toast, toastUndoable } from '@/shell';
import { colorForId, rid, makeItem } from '@/lib/utils';
import { investedBySubject, semesterFingerprint } from '@/lib/semesterFingerprint';
import { linkableItems } from '@/lib/semester';
import { useCountUp } from '@/hooks/interactions';
import { useStripUnknownView } from '@/hooks/useStripUnknownView';
import { Button, NumberField } from '@/components/ui';
import { ProgressRing } from '@/components/ProgressRing';
import type { AppState, Degree as DegreeT } from '@/lib/types';
import {
  CATS,
  STATUSES,
  GRADE_KEYS,
  categoryReq,
  degreeStats,
  progressPct,
  semesterGpa,
  semesterStat,
  gpaForecast,
  type DegreeSemester,
  type DegreeCourse,
} from '@/lib/degree';
import DegreeReq from './DegreeReq';
import SeasonRoadmap from './SeasonRoadmap';
import PhaseBoard from './PhaseBoard';
import SemesterGoals from './SemesterGoals';
import { Icon } from '@/components/Icon';

/** 학기·과목 타입은 lib/degree가 SSOT(DegreeSemester/DegreeCourse). d.semesters가 이미 그 타입. */
const sems = (d: DegreeT): DegreeSemester[] => d.semesters;

type DegKey = 'targetTotal' | 'reqMajorReq' | 'reqMajorSel' | 'reqLiberal' | 'targetGpa';

function SemCard({
  sem,
  open,
  onToggle,
  itemOpts,
}: {
  sem: DegreeSemester;
  open: boolean;
  onToggle: (id: string) => void;
  /** T-1 연결 셀렉트의 선택지. ⚠ **부모가 한 번 구독해 내려준다** — 카드마다 `items` 를 구독하면
   *  무관한 항목 편집에 전 학기 카드가 재렌더된다(PL-15 가 피하려던 바로 그 형태). */
  itemOpts: { id: string; name: string }[];
}) {
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
    mutate((st) => {
      const s = findSem(st, sem.id);
      if (s) s.courses = s.courses.filter((c) => c.id !== cid);
    });
    toastUndoable(`"${name || '과목'}" 삭제됨`);
  };
  const updCourse = (cid: string, k: keyof DegreeCourse, v: string | number) =>
    mutate((st) => {
      const c = findSem(st, sem.id)?.courses.find((x) => x.id === cid);
      if (c) (c as unknown as Record<string, string | number>)[k] = v;
    });
  /* Q-13 ①단 — 확인창을 뗐다. `mutate` 는 ⌘Z 스택에 pre-image 를 남기므로 이미 되돌릴 수
     있었는데, 종전엔 **확인창을 띄우고 나서** "⌘Z 로 되돌리기"를 알렸다(같은 안전장치 이중 과금).
     사다리 SSOT 는 `shell/destructive.ts`. */
  const delSem = () =>
    commitUndoable('학기 삭제됨 (소속 과목도 함께)', () => {
      mutate((st) => {
        st.degree.semesters = sems(st.degree).filter((s) => s.id !== sem.id);
      });
    });
  /**
   * 수강 과목 → 학습 항목. ⚠⚠ **T-1 이전엔 이 버튼이 다리를 놓고 그 다리를 버렸다** — 항목을
   * 만들기만 하고 `itemId` 를 안 남겨서, 만들어진 순간부터 두 과목은 이름만 같은 남남이었다.
   * 같은 과목 상태가 6화면에 흩어진 근본 원인이 이 한 줄의 부재였다. 이제 **만들면서 잇는다.**
   */
  const courseToItem = (cid: string, name: string) => {
    // PL-15 — items를 구독하지 않고 핸들러 시점에 스냅샷 조회(무관한 items 편집에 카드 재렌더 방지).
    /* ⚠ 후보 목록과 **같은 렌즈**로 찾는다(P10 D6) — 여기만 전체 `items` 를 보면 이름이 같은
       소양 과목에 학기 과목이 붙어 버리고, 셀렉트에는 그 항목이 안 보여 되돌릴 수도 없다. */
    const existing = linkableItems(useApp.getState().state.items).find((s) => s.name === name);
    if (existing) {
      // 이미 있으면 만들지 말고 **잇기만** 한다 — 종전엔 그냥 경고만 하고 끝나서, 이름이 같은
      // 항목이 이미 있는 흔한 경우에 링크가 영영 안 생겼다.
      mutate((st) => {
        const c = findSem(st, sem.id)?.courses.find((x) => x.id === cid);
        if (c) c.itemId = existing.id;
      });
      toast(`"${name}" 이미 있는 학습 항목과 연결했어요.`, 'ok');
      return;
    }
    const created = makeItem({ source: '수강', name });
    mutate((st) => {
      st.items.push(created);
      const c = findSem(st, sem.id)?.courses.find((x) => x.id === cid);
      if (c) c.itemId = created.id;
    });
    toast(`"${name}" 학습 항목에 추가·연결됨 — 주당 시간·챕터·시험을 설정하세요.`, 'ok');
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
      className="ds-itemhead"
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
      <span className="ds-chev">{open ? '▾' : '▸'}</span>
      <span className="ds-itemname">{sem.name || <span className="text-mut">(이름 없음)</span>}</span>
      <span className="ds-itemmeta">
        <span className="ds-pill ds-tiny">
          {cr}학점 · {sem.courses.length}과목
        </span>
        {doneCr > 0 && <span className="ds-pill ds-tiny ds-good">완료 {doneCr}</span>}
        {inprog > 0 && <span className="ds-pill ds-tiny">수강중 {inprog}</span>}
        {g != null && <span className="ds-pill ds-tiny">GPA {g.toFixed(2)}</span>}
      </span>
    </div>
  );

  if (!open) return <div className="ds-rule ds-itemrow">{header}</div>;

  return (
    <div className="ds-rule ds-itemrow ds-open">
      {header}
      <div className="ds-itembody">
        <div className="ds-fieldgrid" style={{ marginBottom: 10 }}>
          <div className="ds-fld ds-wide">
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
          {/* ── T-1 학기 계약 — 학기에 **날짜**가 생겼다 ─────────────────────────────────
              왜: 종전 `Semester` 는 `id·name·courses` 뿐이라 **날짜가 없었다.** 그래서 앱은
              "지금이 학기 중인가 방학인가"를 원리적으로 알 수 없었고, 모든 화면이 *지금 상태*만
              그렸다(시간축이 수개월인 시그니처 0). 이 두 칸이 국면(`semesterPhase`)·주차·개강
              D-day 의 **유일한 입력**이다 — 비워 두면 그 과목은 국면 판정에 참여하지 않는다. */}
          <div className="ds-fld">
            <label htmlFor={`sem-start-${sem.id}`}>개강일 (선택)</label>
            <input
              id={`sem-start-${sem.id}`}
              type="date"
              value={sem.startDs || ''}
              onChange={(e) => updSem('startDs', e.target.value)}
            />
          </div>
          <div className="ds-fld">
            <label htmlFor={`sem-end-${sem.id}`}>종강일 (선택)</label>
            <input
              id={`sem-end-${sem.id}`}
              type="date"
              value={sem.endDs || ''}
              onChange={(e) => updSem('endDs', e.target.value)}
            />
          </div>
        </div>
        <div className="ds-chaptbl">
          <table>
            <thead>
              <tr>
                <th style={{ width: '34%' }}>과목</th>
                <th>학점</th>
                <th>구분</th>
                <th>상태</th>
                <th>성적</th>
                <th>학습 항목</th>
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
                    <td>
                      {/* T-1. **두 우주를 잇는 칸.** 회계 쪽 과목이 실행 쪽 어느 항목인지 명시한다 —
                          이름이 달라도(수강편람 이름 vs 내가 부르는 이름) 이어지게. 링크가 있어야
                          과목 화면이 학점·성적과 챕터·시험을 한 화면에서 말할 수 있다. */}
                      <select
                        value={c.itemId && itemOpts.some((i) => i.id === c.itemId) ? c.itemId : ''}
                        onChange={(e) => updCourse(c.id, 'itemId', e.target.value)}
                        aria-label="학습 항목 연결"
                        style={{ width: 110 }}
                      >
                        <option value="">연결 안 함</option>
                        {itemOpts.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {!c.itemId && (c.status === '수강중' || c.status === '예정') && (
                        <Button sm variant="ghost" title="학습 항목으로" onClick={() => courseToItem(c.id, c.name)}>
                          <Icon name="inbox" />
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
                  <td colSpan={6} className="ds-empty ds-tiny" style={{ padding: 12 }}>
                    과목이 없어요. 아래에서 추가하세요.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="ds-row" style={{ marginTop: 8 }}>
          <Button sm variant="primary" onClick={addCourse}>
            + 과목 추가
          </Button>
        </div>
        <div className="ds-itemfoot">
          <span className="ds-tiny text-mut">
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
  const pct = progressPct(d); // 정의는 lib 하나 — 세 화면이 같은 답을 말한다
  const shownPct = useCountUp(Math.min(100, pct)); // 링 기하만 클램프(숫자는 진실을 그대로)
  const list = sems(d);
  // T-1. 연결 셀렉트의 선택지 — **여기서 한 번만** 구독한다(PL-15 · 카드마다 구독하면 무관한 항목
  // 편집에 전 학기 카드가 재렌더된다). immer 라 `items` 가 안 바뀐 변경에서는 참조가 유지된다.
  const items = useApp((s) => s.state.items);
  /* ⚠ P10 D6 — **소양 과목은 후보가 아니다.** 학점으로 안 세는 과목을 `Course` 에 이어 붙이면
     이 화면의 모든 집계(이수 학점·GPA·졸업 진척)가 그 과목을 세기 시작한다. 판정은 `lib/semester`
     하나가 소유한다(`linkableItems`) — 화면이 `kind` 를 직접 보면 후보 목록과 잇기 버튼이 갈린다. */
  const itemOpts = useMemo(
    () => linkableItems(items).map((i) => ({ id: i.id, name: i.name || '(이름 없음)' })),
    [items],
  );
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
      toast('졸업 요건 충족 — 축하해요!', 'info');
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
      /* W22/H3 — `primary` 는 **필수 키**다(`store/usePageChrome.ts` 머리주석). 이 화면은 렌즈라
         44px 앵커를 세우지 않는다 — 잊은 것이 아니라 없다고 정한 것이다. */
      primary: null,
      readouts: [
        {
          label: '이수',
          value: (
            <>
              {earned}
              <small className="text-base14 font-bold text-mut"> / {d.targetTotal}</small>
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
      {/* T-4·T-15·T-16 — **학기의 경계**. 로드맵(가로 트랙) 바로 아래가 자리다: 트랙이 "어디까지
          왔나"를 말하고, 이 판이 "지금 국면에서 뭘 하나"를 말한다. */}
      <PhaseBoard />
      {/* N-18(W8) — 목표는 국면 **바로 아래**다: 국면이 "지금 어디쯤"이고 목표가 "그래서 어디로".
          학기가 없으면 스스로 사라진다(담을 그릇이 없다). */}
      <SemesterGoals />
      <SeasonRoadmap list={list} targetTotal={d.targetTotal} earned={earned} openIds={openSems} onToggle={toggle} />

      {/* 졸업 현황 — 진행 링 + 게이지 히어로(이수·평점·남은·예상) + 카테고리 바. */}
      <div className="ds-rule">
        <div className="ds-caps mb-3.5">졸업 현황</div>
        <div className="flex flex-wrap items-center gap-7">
          <div
            className={`relative size-23 flex-none${celeFlash ? ' animate-[commit-cele_var(--dur-cele)_var(--ease)] motion-reduce:animate-none' : ''}`}
            role="img"
            aria-label={`졸업 진행 ${pct}%`}
          >
            {/* 카운트업은 다른 링(Stats·Mastery)과 일관 — reduced-motion이면 즉시 최종값. */}
            <ProgressRing
              size={80}
              r={34}
              pct={shownPct}
              className="size-full -rotate-90"
              trackClassName="fill-none stroke-line2 [stroke-width:7]"
              arcClassName="fill-none stroke-good [stroke-width:7] [stroke-linecap:round] [filter:var(--filter-good-glow)] transition-[stroke-dashoffset] duration-draw ease-[var(--ease)]"
            />
            <div className="absolute inset-0 flex items-center justify-center text-2xl font-extrabold tracking-tight text-txt tabular-nums">
              {Math.round(shownPct)}
              <small className="text-sm font-bold text-mut">%</small>
            </div>
          </div>
          <div className="grid min-w-0 flex-1 grid-cols-degree-gauges gap-x-5 gap-y-4">
            <div className="flex flex-col gap-0.75">
              <span className="text-2xl leading-none font-extrabold tracking-tight text-txt tabular-nums">
                {earned}
                <small className="text-sm font-bold text-mut"> / {d.targetTotal}</small>
              </span>
              <span className="text-xs font-semibold text-mut">이수 학점</span>
            </div>
            <div className="flex flex-col gap-0.75">
              <span className="text-2xl leading-none font-extrabold tracking-tight text-txt tabular-nums">
                {gpa != null ? gpa.toFixed(2) : '—'}
                <small className="text-sm font-bold text-mut"> / 4.5</small>
              </span>
              <span className="text-xs font-semibold text-mut">평점(GPA)</span>
            </div>
            <div className="flex flex-col gap-0.75">
              <span className="text-2xl leading-none font-extrabold tracking-tight text-txt tabular-nums">
                {remain}
              </span>
              <span className="text-xs font-semibold text-mut">남은 학점</span>
            </div>
            <div className="flex flex-col gap-0.75">
              <span className="text-2xl leading-none font-extrabold tracking-tight text-txt tabular-nums">
                {projSem != null ? `~${projSem}` : '—'}
              </span>
              <span className="text-xs font-semibold text-mut">예상 잔여 학기</span>
            </div>
          </div>
        </div>
        <div className="mt-3.5 border-t border-line2 pt-3 text-sm text-mut">
          수강중 {inprog} · 예정 {planned}
          {gradedCr > 0 && gradedCr < earned ? ` · 성적 입력 ${gradedCr}/${earned}학점` : ''}
          {earned > 0 && gradedCr === 0 ? (
            <span style={{ color: 'var(--warn)' }}> · 성적을 입력하면 GPA가 계산돼요</span>
          ) : null}
        </div>

        {/* PL-17 — 목표 GPA 역산 계산기: 남은 학점을 평균 몇 점으로 채워야 목표에 닿는지. */}
        <div className="mt-3.5 flex flex-wrap items-center gap-3.5 border-t border-line2 pt-3">
          <div className="flex items-center gap-2">
            <label htmlFor="deg-target-gpa" className="text-xs font-bold tracking-wider text-mut uppercase">
              목표 평점
            </label>
            {/* 클램프는 NumberField가 min/max로 수행 — 비운 채 떠나면 직전 목표가 살아남는다
                (예전엔 '3.5'를 고쳐 치는 도중 빈값이 목표 평점 0으로 확정됐다). */}
            <NumberField
              id="deg-target-gpa"
              min={0}
              max={4.5}
              step={0.1}
              value={targetGpa}
              onCommit={(v) => setDeg('targetGpa', v)}
              className="w-18! tabular-nums"
            />
            <span className="text-sm font-bold text-mut">/ 4.5</span>
          </div>
          <div className="text-md text-txt tabular-nums">
            {gpa == null ? (
              <span className="text-mut">성적을 입력하면 목표까지 필요한 평점을 계산해요.</span>
            ) : fc.alreadyMet ? (
              <span style={{ color: 'var(--good)' }}>이미 목표 달성 ✓</span>
            ) : fc.neededAvg == null ? (
              <span className="text-mut">남은 과목이 없어요.</span>
            ) : (
              <>
                남은 <b className="font-extrabold">{fc.futureCr}</b>학점을 평균{' '}
                <b className="font-extrabold" style={{ color: fc.feasible ? 'var(--good)' : 'var(--bad)' }}>
                  {fc.neededAvg.toFixed(2)}
                </b>
                점으로 이수하면 목표 달성
                {!fc.feasible && <span style={{ color: 'var(--bad)' }}> · 만점으로도 도달 어려움</span>}
              </>
            )}
          </div>
        </div>

        <div className="mt-4 mb-3.5 grid grid-cols-degree-cats gap-3.5">
          {CATS.map((cat) => {
            // ⚠ 삼항 사슬을 여기 다시 쓰지 말 것 — 라벨→요건 매핑의 정본은 `lib/degree.categoryReq`
            //   하나다(M-8). 종전엔 이 자리에 사본이 있었고 타입이 안 잡아 줬다.
            const req = categoryReq(d, cat);
            const have = byCat[cat] || 0;
            // PL-6 — 요건 없는 카테고리(req=0, '기타')는 진행바를 채우지 않는다: 학점이 있어도
            // 100%로 가득 차 '충족'처럼 오도되던 문제 제거 → 중립 트랙 + '요건 없음' 라벨.
            const met = req > 0 && have >= req;
            const cpct = req > 0 ? Math.min(100, Math.round((have / req) * 100)) : 0;
            return (
              <div key={cat} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-bold text-mut">{cat}</span>
                  <span className="text-lg font-extrabold tabular-nums">
                    {have}
                    {req > 0 ? (
                      <small className="text-xs font-bold text-mut"> / {req}</small>
                    ) : (
                      <small className="text-xs font-semibold text-mut"> · 요건 없음</small>
                    )}
                    {/* SD-2 requirementRows().met과 동일 의미 — 충족 시 ✓(var(--good)). */}
                    {met && (
                      <span className="font-extrabold text-good" aria-label="충족">
                        {' '}
                        ✓
                      </span>
                    )}
                  </span>
                </div>
                <div className="h-1.75 overflow-hidden rounded-full bg-track-cat">
                  {req > 0 && (
                    <i
                      style={{ width: `${cpct}%` }}
                      className={
                        met
                          ? 'block h-full rounded-full bg-acc shadow-node'
                          : 'block h-full rounded-full bg-track-fill-cat'
                      }
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <details className="mt-3.5 border-t border-line2 pt-3">
          <summary className="text-sm! font-bold text-mut! hover:text-acc!">졸업 요건 설정</summary>
          <div className="ds-row" style={{ marginTop: 10 }}>
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

      <div className="ds-rule">
        <div className="ds-row" style={{ alignItems: 'center' }}>
          <h2 style={{ flex: 1, margin: 0 }}>
            학기별 수강{' '}
            <span className="ds-tiny text-mut" style={{ fontWeight: 400 }}>
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
        <SemCard key={s.id} sem={s} open={openSems.has(s.id)} onToggle={toggle} itemOpts={itemOpts} />
      ))}
    </>
  );
}

/* ⚠⚠ **`goals`(내 길 지도)가 이 탭의 세 번째 뷰가 됐다**(W9 · 2026-08-06 · IA 판정표).
   둘 다 답하는 질문이 **"졸업까지의 길"** 이다 — 여기가 그 길의 *회계*(학점·요건·GPA)이고
   내 길이 그 길의 *이유*(목표 트리·필요 역량)다. 계획 세그먼트 다섯 중 둘이 같은 질문의 두 면
   이었고, 그래서 "멀리 보는 화면"의 착지가 어느 이름을 기억하느냐로 갈렸다.
   ⚠ **lazy** — 목표 트리는 지식엔진 쿼리 셋을 문다(콜드면 안내문). 학점만 보러 온 방문에
     그 코드를 내려받을 이유가 없다(`graph`→`items` 이식과 같은 판단).

   ⚠⚠ **뷰가 URL 에 있다**(종전엔 `useState`). 은퇴한 `goals` 탭의 착지 경로가
   `/degree?view=path` 이므로, 상태가 메모리에만 있으면 그 리다이렉트가 **기본 뷰(졸업 계획)에
   착지**한다 — 화면은 떴는데 찾던 것이 없는, 가장 알아채기 어려운 형태의 도달성 손실이다. */
// ⛔ `const Goals = lazy(() => import('./PathView'))` 가 2026-08-29 에 사라졌다(공급자 은퇴).

/* ⚠⚠ **W8(2026-08-07) — 학기의 입구와 출구가 여기 붙는다**(N-2 인입구 · N-3 결산).
   왜 새 탭이 아닌가: 둘 다 **학기라는 명사**의 두 끝이고, 그 명사의 회계를 쥔 화면이 여기다.
   이 저장소는 "학습 상태 소비 0"인 화면을 새 탭으로 세웠다가 다섯 번 강등한 이력이 있다 —
   뷰로 내리면 도달성(⌘K·딥링크·`?view=`)은 그대로이고 레일 한 칸을 안 쓴다.
   ⚠ 둘 다 **lazy** 다: 인입구는 파서를, 결산은 완료 기록 전수 스캔을 문다. 학점만 보러 온
   방문에 그 코드를 내려받을 이유가 없다(`PathView` 와 같은 판단). */
const Intake = lazy(() => import('./SyllabusIntake'));
/** I008 — `.ics` 인입구. 같은 뷰에 사는 이유는 그 파일 머리주석(«학교에서 받은 것을 어디에 넣나»). */
const CalIntake = lazy(() => import('./CalendarIntake'));
const Close = lazy(() => import('./SemesterClose'));

type DegView = 'plan' | 'req' | 'intake' | 'close';
/* ⚠⚠ **여기 `const VIEWS` 5칸이 손으로 적혀 있었다 — 로스터에서 파생한다**(I025 · 2026-08-22).
   D-4 가 «갈 수 있는 곳의 열거 다섯 벌»을 하나로 만들었는데, W9 이 탭 셋을 뷰로 접자 같은 바가
   이 파일 안에서 **다시 자랐다.** 그리고 실제로 갈려 있었다: 이 배열의 넷(`intake`·`close`·
   `req`·`path`)이 `shell/tabs.ts` 로스터에는 **아예 없어서**, 그 화면들은 아나운서 이름도 ⌘K 도
   자기 방문 집계도 갖지 못했다(H-12·I034 가 각각 이름 축·관측 축에서 고친 그 결함이 여기 남아
   있었다). 이제 로스터 한 곳이 넷 다 준다.
   ⚠ 기본 뷰(`plan`)만 여기 남는다 — 그건 뷰가 아니라 **탭 자신**이라 로스터의 `degree` 가 진다. */
const HOST_VIEWS = viewsOfHost('degree');
const VIEWS: { key: DegView; label: string }[] = [
  { key: 'plan', label: tabByKey('degree')?.label ?? '졸업 계획' },
  ...HOST_VIEWS.map((t) => ({ key: viewValueOf(t) as DegView, label: t.segLabel ?? t.label })),
];

/** 졸업 탭 — 계획(편집)·요건 정리(읽기전용)·내 길(목표 트리)을 세그먼트로 전환. 기본은 '졸업 계획'. */
/**
 * **학기 지문**(N-22 · W6) — 그리지 않고 **자란다**.
 *
 * 학기가 끝나면 남는 시각 자산이 0이었다. 여기 도형은 전부 그 학기의 실제 값에서 나온다:
 * 가지 수 = 과목 수 · 길이 = 실제 투입 시간 · 각도 = id 해시(색과 **같은 파생 키**).
 * 즉 균등하게 한 학기와 한 과목에 몰린 학기는 **다르게 생긴다** — 그 명제가 이 안의 유일한
 * 검증이고 `test/semesterFingerprint.test.ts` 가 잠근다.
 *
 * ⚠ 자리를 **크게 안 준다**(28px). 이건 조망이 아니라 *표식*이고, 크게 그리면 그 순간
 *   "숫자를 읽는 화면"과 겨룬다(원칙 ⑤ 단일 포커스).
 * ⚠ 색은 `colorForId` — 여기서 정하지 않는다(절대규칙 #3).
 * ⚠ 과목이 없으면 **아무것도 안 그린다**: 빈 지문은 장식이고, 장식은 이 항목이 거부한 것이다.
 */
function SemesterFingerprint() {
  const state = useApp((s) => s.state);
  const branches = useMemo(() => semesterFingerprint(investedBySubject(state)), [state]);
  if (!branches.length) return null;
  return (
    <svg viewBox="0 0 100 100" className="size-7 shrink-0 opacity-70" role="img" aria-label="이번 학기 지문">
      {branches.map((b) => (
        <path key={b.id} d={b.d} fill="none" stroke={colorForId(b.id)} strokeWidth={5} strokeLinecap="round" />
      ))}
    </svg>
  );
}

export default function Degree() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('view');
  const view: DegView = VIEWS.some((v) => v.key === raw) ? (raw as DegView) : 'plan';
  /* 모르는 뷰(은퇴한 `path` · 오타 · 옛 북마크)는 **주소에서 걷는다** — 근거는 훅 머리주석. */
  useStripUnknownView(params, setParams, HOST_VIEWS.map(viewValueOf));
  return (
    <div className="min-w-0">
      <div className="mb-4 flex items-center gap-3.5">
        <h2 className="ds-caps mb-0! flex items-center gap-1.5">
          <Icon name="cap" /> 졸업
        </h2>
        <SemesterFingerprint />
        <div className="ds-seg ml-auto">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              aria-pressed={view === v.key}
              className={view === v.key ? 'ds-on' : ''}
              onClick={() => {
                const p = new URLSearchParams(params);
                if (v.key === 'plan') p.delete('view');
                else p.set('view', v.key);
                setParams(p, { replace: true });
              }}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>
      {/* ⛔ `path`(내 길 지도) 분기가 2026-08-29 에 사라졌다 — 부모 goals 계약이 생산자째 삭제됐다
          (pipeline 목적 정정). 로스터 행도 함께 나갔다.
          ⚠ 종전 이 줄은 *"이 뷰로 오는 경로 자체가 없다"* 고 적었는데 **거짓이었다**(U048) —
          북마크·브라우저 이력·e2e 로스터·⌘K 최근이 `?view=path` 를 들고 있다. 위
          `useStripUnknownView` 가 그 주소를 정직하게 만든다(화면과 주소가 같은 말을 한다). */}
      {view === 'intake' ? (
        <Suspense fallback={<State kind="loading" title="인입구 여는 중…" shape="frame" />}>
          <CalIntake />
          <Intake />
        </Suspense>
      ) : view === 'close' ? (
        <Suspense fallback={<State kind="loading" title="결산 여는 중…" shape="frame" />}>
          <Close />
        </Suspense>
      ) : view === 'req' ? (
        <DegreeReq />
      ) : (
        <DegreePlan />
      )}
    </div>
  );
}
