/* ============================================================
   SemesterClose — **N-3 학기 결산**(W8 · 2026-08-07). 끝난 학기를 다음 학기의 입력으로 되돌린다.

   ## 이 화면이 답하는 질문은 하나다

   *"이 학기에서 다음 학기가 배울 수 있는 것은 무엇인가."* 성적표가 아니다 — 등급 예측·재수강
   추천·학점 시뮬은 `degree` 의 다른 뷰가 이미 한다. 여기 있는 것은 셋뿐이다:
   ① 학점당 실제 시간(다음 학기 부하 시뮬 `creditRate` 의 표본) ② 추정 대 실측의 배율
   ③ 아직 안 넣은 성적 — **그 학기가 아직 안 닫혔다는 유일한 관측 가능한 신호**.

   ⚠ 성적 입력을 **여기서 한다**(다른 뷰로 보내지 않는다). 로드맵의 가장 싼 검증이
   _"`courses[].grade` 채움률. 0 이면 첫 조각은 성적 입력을 여기서"_ 였고, 실측이 정확히 0 이다.
   ⚠ 판정은 `lib/semesterClose` 가 소유한다 — 이 파일은 그리기와 한 칸 쓰기뿐이다.
============================================================ */
import { useApp } from '@/store/useApp';
import { Pill } from '@/components/ui';
import { GRADE_KEYS } from '@/lib/degree';
import { pendingCloseSemesters, semesterReport } from '@/lib/semesterClose';
import { DEFAULT_HOURS_PER_CREDIT, creditRate } from '@/lib/semesterEntry';
import { todayISO } from '@/lib/utils';

export default function SemesterClose() {
  const state = useApp((s) => s.state);
  const mutate = useApp((s) => s.mutate);
  const ds = todayISO(state);
  /* ⚠ 끝난 학기 **전부**가 아니라 결산할 것이 남은 것만이다(`pendingCloseSemesters`).
     다 닫힌 학기까지 그리면 이 화면은 지워지지 않는 목록이 되고, 그건 리허설이 세운 규율의 반대다. */
  const pending = pendingCloseSemesters(state, ds);
  const rate = creditRate(state, ds);

  const setGrade = (semId: string, courseId: string, grade: string): void =>
    mutate((st) => {
      const c = st.degree.semesters.find((s) => s.id === semId)?.courses.find((x) => x.id === courseId);
      if (c) c.grade = grade;
    });

  return (
    <div className="min-w-0">
      <div className="ds-rule">
        <div className="ds-caps mb-2">다음 학기가 배운 것</div>
        <div className="flex flex-wrap items-baseline gap-3 text-md">
          <span>
            학점당 <b className="tabular-nums">{rate.hoursPerCredit}h</b>
          </span>
          <Pill tiny tone={rate.basis === 'measured' ? 'good' : undefined}>
            {rate.basis === 'measured' ? `실측 ${rate.samples}과목` : `기본값 ${DEFAULT_HOURS_PER_CREDIT}h`}
          </Pill>
          {/* ⚠ 근거를 함께 말하는 것이 `semesterEntry` 규율 1 이다 — 근거 없는 수는 믿을지 판단할 수 없다. */}
          <span className="ds-tiny text-mut">끝난 학기의 실투입에서 배웁니다 · 다음 학기 부하 시뮬의 입력</span>
        </div>
      </div>

      {!pending.length ? (
        <div className="ds-rule">
          <p className="m-0 text-md text-mut">결산할 학기가 없어요 — 끝난 학기의 성적이 모두 들어와 있습니다.</p>
        </div>
      ) : (
        pending.map((sem) => {
          const rep = semesterReport(state, sem, ds);
          return (
            <div key={sem.id} className="ds-rule">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
                <span className="ds-caps">{sem.name || '학기'} 결산</span>
                <span className="flex items-center gap-2">
                  <Pill tiny tone="warn">
                    성적 {rep.missingGrades.length}개 남음
                  </Pill>
                  {rep.gpa != null && <Pill tiny>GPA {rep.gpa.toFixed(2)}</Pill>}
                </span>
              </div>
              <div className="mb-2.5 flex flex-wrap items-baseline gap-3 text-md">
                <span>
                  투입 <b className="tabular-nums">{rep.totalInvestedH}h</b>
                </span>
                <span className="text-mut">/ 계획 {rep.totalPlannedH}h</span>
                {/* ⚠ 배율이 없으면 줄을 안 건다 — `0.00배` 는 "계획을 안 세웠다"와 "안 했다"를 같은 픽셀로 그린다. */}
                {rep.ratio != null && (
                  <Pill tiny tone={rep.ratio > 1.15 ? 'warn' : 'good'}>
                    실측 {rep.ratio.toFixed(2)}배
                  </Pill>
                )}
                {rep.hoursPerCredit != null && (
                  <span className="ds-tiny text-mut">이 학기 학점당 {rep.hoursPerCredit}h</span>
                )}
              </div>
              <div className="ds-chaptbl">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: '34%' }}>과목</th>
                      <th>학점</th>
                      <th>투입</th>
                      <th>계획</th>
                      <th>배율</th>
                      <th>성적</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rep.rows.map((r) => (
                      <tr key={r.course.id}>
                        <td>{r.course.name || '(이름 없음)'}</td>
                        <td className="tabular-nums">{r.course.credits}</td>
                        <td className="tabular-nums">{r.investedH == null ? '—' : `${r.investedH}h`}</td>
                        <td className="tabular-nums">{r.plannedH == null ? '—' : `${r.plannedH}h`}</td>
                        <td className="tabular-nums">{r.ratio == null ? '—' : `${r.ratio.toFixed(2)}×`}</td>
                        <td>
                          <select
                            value={r.course.grade && GRADE_KEYS.includes(r.course.grade) ? r.course.grade : ''}
                            onChange={(e) => setGrade(sem.id, r.course.id, e.target.value)}
                            style={{ width: 68 }}
                            aria-label={`${r.course.name} 성적`}
                          >
                            <option value="">—</option>
                            {GRADE_KEYS.map((g) => (
                              <option key={g} value={g}>
                                {g}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
