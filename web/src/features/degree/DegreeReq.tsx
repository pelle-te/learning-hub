/* ============================================================
   DegreeReq — 졸업 탭의 '졸업요건 정리' 세그먼트 뷰(읽기전용 분석).
   SD-2: 옛 전자공학과 2020 하드코딩 샘플을 폐기하고 내 실제 state.degree(졸업 계획 탭의
   학기·과목·성적)로 구동한다. '요건 대비 얼마나 충족했나'와 '재수강 후보'를 자동 계산 —
   편성/편집은 '졸업 계획' 뷰, 여기는 요건 충족도 진단에 집중(역할 분담).
   집계 로직은 lib/degree(순수·테스트 대상)가 단일 출처.
============================================================ */
import { useApp } from '@/store/useApp';
import { Card, KpiGrid, Kpi, Pill, ProgressBar, Table } from '@/components/ui';
import EmptyState from '@/components/EmptyState';
import { degreeStats, progressPct, requirementRows, retakeCandidates } from '@/lib/degree';

export default function DegreeReq() {
  const d = useApp((s) => s.state.degree);
  const stats = degreeStats(d);
  const rows = requirementRows(d);
  const retakes = retakeCandidates(d);
  const totalCourses = d.semesters.reduce((n, s) => n + s.courses.length, 0);

  const earned = stats.earned;
  const remain = Math.max(0, d.targetTotal - earned);
  const pct = progressPct(d);
  const unmet = rows.filter((r) => r.req && !r.met).length;
  const mustRetake = retakes.some((r) => r.mandatory);

  // 과목이 하나도 없으면 계산할 게 없다 — 졸업 계획 탭으로 안내(1급 빈 상태).
  if (totalCourses === 0) {
    return (
      <EmptyState
        glyph="🎓"
        title="아직 등록된 과목이 없어요"
        desc={
          <>
            <b>졸업 계획</b> 뷰에서 학기·과목·성적을 입력하면, 여기서 <b>요건 대비 충족도</b>와 <b>재수강 후보</b>를
            자동으로 정리해 드려요.
          </>
        }
        /* 뷰 전환을 이 컴포넌트가 소유하지 않는다(부모의 세그먼트다) → 버튼 대신 위치를 가리킨다.
           소유하지 않은 상태를 억지로 조작하는 CTA 는 결국 prop 사슬을 하나 더 만든다. */
        next={{ terminal: '↑ 졸업 계획 뷰에서 학기·과목을 먼저 입력하세요.' }}
      />
    );
  }

  return (
    <>
      <Card title="졸업요건 충족 현황">
        <div className="text-sm leading-[1.6] text-mut">
          내 <b>졸업 계획</b> 데이터로 계산한 요건 대비 이수 현황입니다. 학기·과목·성적을 수정하면 즉시 반영돼요.
        </div>
        <div className="mt-3.5 mb-1">
          <ProgressBar pct={pct} color="var(--good)" />
        </div>
        <div className="mt-1.5 text-sm text-mut">
          이수 {earned} / 졸업 {d.targetTotal}학점 ({pct}%) · 남은 {remain}학점
          {stats.gpa != null ? ` · 평점 ${stats.gpa.toFixed(2)}` : ''}
        </div>
      </Card>

      <KpiGrid>
        <Kpi value={remain} label="남은 졸업학점" tone={remain > 0 ? 'warn' : 'good'} />
        <Kpi value={stats.gpa != null ? stats.gpa.toFixed(2) : '—'} label="평점(GPA)" />
        <Kpi value={unmet} label="미충족 요건" tone={unmet > 0 ? 'warn' : 'good'} />
        <Kpi value={retakes.length} label="재수강 후보" tone={mustRetake ? 'bad' : retakes.length ? 'warn' : 'good'} />
      </KpiGrid>

      <Card title="1 · 카테고리별 요건 충족">
        <Table>
          <thead>
            <tr>
              <th style={{ width: '26%' }}>구분</th>
              <th>요건</th>
              <th>이수</th>
              <th>남은</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.cat}>
                <td style={{ fontWeight: 600 }}>{r.cat}</td>
                <td className="text-sm text-mut">{r.req ? `${r.req}학점` : '—'}</td>
                <td className="text-sm">{r.have}학점</td>
                <td className="text-sm">{r.req ? (r.gap > 0 ? `${r.gap}학점` : '충족') : '—'}</td>
                <td>
                  {r.req ? (
                    <Pill tone={r.met ? 'good' : 'warn'} tiny>
                      {r.met ? '충족' : `부족 ${r.gap}`}
                    </Pill>
                  ) : (
                    <span className="text-sm text-mut">요건 없음</span>
                  )}
                </td>
              </tr>
            ))}
            <tr>
              <td style={{ fontWeight: 700 }}>총 졸업학점</td>
              <td className="text-sm text-mut">{d.targetTotal}학점</td>
              <td className="text-sm">{earned}학점</td>
              <td className="text-sm">{remain > 0 ? `${remain}학점` : '충족'}</td>
              <td>
                {earned >= d.targetTotal ? (
                  <Pill tone="good" tiny>
                    충족
                  </Pill>
                ) : (
                  <Pill tone="warn" tiny>
                    부족 {remain}
                  </Pill>
                )}
              </td>
            </tr>
          </tbody>
        </Table>
        {unmet > 0 && (
          <div className="mt-2 text-sm leading-[1.6] text-mut">
            부족한 카테고리는 <b>졸업 계획</b>에서 해당 구분 과목을 더 이수하세요. (요건 학점은 졸업 계획 → 졸업 요건
            설정에서 조정)
          </div>
        )}
      </Card>

      <Card title="2 · 재수강 후보 (C+ 이하)">
        {retakes.length ? (
          <>
            <div className="mt-2 text-sm leading-[1.6] text-mut">
              성적 C+ 이하 이수 과목. <b>F</b>는 학점 미취득 → <b>졸업 위해 재수강 필수</b>. 그 외는 평점 향상용 선택
              재수강.
            </div>
            <Table>
              <thead>
                <tr>
                  <th style={{ width: '38%' }}>과목</th>
                  <th>성적</th>
                  <th>학점</th>
                  <th>구분</th>
                  <th>학기</th>
                </tr>
              </thead>
              <tbody>
                {retakes.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.name}{' '}
                      {r.mandatory && (
                        <Pill tone="bad" tiny>
                          재수강 필수
                        </Pill>
                      )}
                    </td>
                    <td>
                      {r.grade === 'F' ? (
                        <Pill tone="bad" tiny>
                          F
                        </Pill>
                      ) : (
                        <span className="text-sm">{r.grade}</span>
                      )}
                    </td>
                    <td className="text-sm">{r.credit}</td>
                    <td className="text-sm text-mut">{r.category}</td>
                    <td className="text-sm text-mut">{r.semester}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </>
        ) : (
          <div className="text-sm leading-[1.6] text-mut">
            재수강 후보가 없어요 — 이수한 과목이 모두 <b>C+ 초과</b>입니다. 👍
          </div>
        )}
      </Card>

      <div className="mt-1.5 text-sm text-mut">
        수강중 {stats.inprog}학점 · 예정 {stats.planned}학점 · 완료 학기 {stats.semDone}개
        {stats.earned > 0 && stats.gradedCr < stats.earned
          ? ` · 성적 미입력 ${stats.earned - stats.gradedCr}학점(GPA 제외)`
          : ''}
      </div>
    </>
  );
}
