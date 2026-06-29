/* ============================================================
   DegreeReq — 탭: 졸업요건 정리 (Phase 3 첫 React 조각 · 정적/읽기전용)
   레거시 ui-degree-req.js의 innerHTML 렌더를 공용 컴포넌트 + JSX로 이전.
   상태(state)를 건드리지 않는 순수 표시 — 데이터는 ./data.ts.
============================================================ */
import { Card, KpiGrid, Kpi, Pill, ProgressBar, Table, type PillTone, type KpiTone } from '@/components/ui';
import {
  DR_OVERVIEW,
  DR_KPI,
  DR_REQUIRED,
  DR_RETAKE,
  DR_REMAINING,
  DR_CHECKLIST,
  DR_PROGRESS,
  type Tone,
  type Done,
} from './data';
import styles from './DegreeReq.module.css';

/** 총괄/분류 상태(ok·warn·bad)를 Pill 톤으로 — ok는 good으로 매핑. */
function pillTone(t: Exclude<Tone, ''>): PillTone {
  return t === 'ok' ? 'good' : t;
}

/** 인증필수 이수 현황 셀(✓ 이수 · ↻ 재수강 · ★ 미수강). */
function DoneCell({ grade, done }: { grade: string; done: Done }) {
  if (done === 'done')
    return (
      <Pill tone="good" tiny>
        ✓ {grade}
      </Pill>
    );
  if (done === 'redo')
    return (
      <Pill tone="bad" tiny>
        ↻ {grade}
      </Pill>
    );
  return (
    <Pill tone="warn" tiny>
      ★ {grade}
    </Pill>
  );
}

export default function DegreeReq() {
  const { earned, total } = DR_PROGRESS;
  const remain = total - earned;
  const pct = Math.round((earned / total) * 100);

  return (
    <>
      <Card title="전자공학과 졸업요건 정리">
        <div className={styles.intro}>
          2020학년도 요람 · 공학인증(ABEEK) <b>인증과정</b> 기준. 졸업에 꼭 재수강할 과목은 <b>반도체공학1(F)</b> 하나뿐
          — 나머지 C+ 이하는 평점용 선택 재수강.
        </div>
        <div className={styles.barWrap}>
          <ProgressBar pct={pct} color="var(--good)" />
        </div>
        <div className={styles.meta}>
          이수 {earned} / 졸업 {total}학점 ({pct}%) · 남은 {remain}학점
        </div>
      </Card>

      <KpiGrid>
        {DR_KPI.map((k) => (
          <Kpi key={k.label} value={k.value} label={k.label} tone={(k.tone || undefined) as KpiTone | undefined} />
        ))}
      </KpiGrid>

      <Card title="1 · 졸업요건 총괄">
        <Table>
          <thead>
            <tr>
              <th style={{ width: '24%' }}>항목</th>
              <th>요건</th>
              <th>내 현황</th>
            </tr>
          </thead>
          <tbody>
            {DR_OVERVIEW.map((r) => (
              <tr key={r.item}>
                <td style={{ fontWeight: 600 }}>{r.item}</td>
                <td className={`${styles.tiny} ${styles.muted}`}>{r.req}</td>
                <td>
                  {r.tone ? (
                    <Pill tone={pillTone(r.tone)} tiny>
                      {r.cur}
                    </Pill>
                  ) : (
                    <span className={styles.tiny}>{r.cur}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card title="2 · 남은 졸업학점 = 34학점">
        <div className={styles.split}>
          <div className={styles.inset}>
            <div className={styles.v}>26</div>
            <div className={styles.l}>전공 (인증필수 11 + 인증선택 15)</div>
          </div>
          <div className={styles.inset}>
            <div className={styles.v}>8</div>
            <div className={styles.l}>비전공 (영역별교양 보충 + 자유선택)</div>
          </div>
        </div>
        <div className={styles.splitNote}>
          자유선택 9학점 중 심리학개론 3 사용 → 앞으로 약 6학점 자유. 영역별교양 1과목을 더 들어야 하면 그만큼 빠져{' '}
          <b>실제 자유 채움은 5~6학점 수준</b>.
        </div>
      </Card>

      <Card title="3 · 전공 인증필수 41학점">
        <div className={styles.legend}>
          ✓ 이수 · ↻ 재수강 · ★ 미수강 &nbsp;|&nbsp; 캡스톤은 융합전자연구 또는 융합캡스톤디자인 한 세트만(1→2 순서).
        </div>
        <Table>
          <thead>
            <tr>
              <th style={{ width: '42%' }}>과목</th>
              <th>학점</th>
              <th>개설학기</th>
              <th>이수현황</th>
            </tr>
          </thead>
          <tbody>
            {DR_REQUIRED.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td className={styles.tiny}>{r.credit}</td>
                <td className={`${styles.tiny} ${styles.muted}`}>{r.term}</td>
                <td>
                  <DoneCell grade={r.grade} done={r.done} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card title="4 · 인증선택 27학점">
        <div className={styles.group4}>
          <div>
            <b>1그룹</b> (택1 이상) — 확률및랜덤변수로{' '}
            <Pill tone="good" tiny>
              충족
            </Pill>{' '}
            <span className={styles.muted}>
              / 통신시스템·자동제어·디지털시스템설계·컴퓨터네트워크·전파공학(1학기), 반도체공학2(2학기)
            </span>
          </div>
          <div>
            <b>2그룹 실험</b> (택1 필수, 전부 2학기){' '}
            <span className={styles.muted}>— 자동제어·전파·통신·임베디드·반도체실험</span>
          </div>
          <div>
            <b>그 외</b>{' '}
            <span className={styles.muted}>
              1·2학기 다수 개설 (컴퓨터구조·임베디드·VLSI·아날로그IC·RF회로·로봇공학 등). 졸업요건_정리.md 4절 목록
              참고.
            </span>
          </div>
        </div>
      </Card>

      <Card title="5 · 앞으로 더 들어야 할 전공 26학점">
        <Table>
          <thead>
            <tr>
              <th style={{ width: '18%' }}>분류</th>
              <th>과목</th>
              <th>학점</th>
              <th>개설학기</th>
            </tr>
          </thead>
          <tbody>
            {DR_REMAINING.map((r) => (
              <tr key={r.name}>
                <td>
                  <Pill tone={r.cat === '인증필수' ? 'bad' : 'warn'} tiny>
                    {r.cat}
                  </Pill>
                </td>
                <td>{r.name}</td>
                <td className={styles.tiny}>{r.credit}</td>
                <td className={`${styles.tiny} ${styles.muted}`}>{r.term}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card title="6 · 재수강 대상 (C+ 이하) — 17과목 · 50학점">
        <div className={styles.tiny + ' ' + styles.muted}>
          졸업엔 반도체공학1(F)만 필수. 나머지는 학점 인정됨 → 평점 향상 목적 선택 재수강.
        </div>
      </Card>

      {DR_RETAKE.map((g) => (
        <Card key={g.title}>
          <div className={styles.cardHead}>
            <h3>{g.title}</h3>
            <span className={`${styles.tiny} ${styles.muted}`}>{g.sub}</span>
          </div>
          <Table>
            <thead>
              <tr>
                <th>과목</th>
                <th>성적</th>
                <th>학점</th>
                <th>개설학기</th>
                <th>비고</th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td>
                    {r.grade === 'F' ? (
                      <Pill tone="bad" tiny>
                        {r.grade}
                      </Pill>
                    ) : (
                      <span className={styles.tiny}>{r.grade}</span>
                    )}
                  </td>
                  <td className={styles.tiny}>{r.credit}</td>
                  <td className={`${styles.tiny} ${styles.muted}`}>{r.term}</td>
                  <td className={styles.tiny}>
                    {r.note ? (
                      r.note.includes('필수') ? (
                        <Pill tone="bad" tiny>
                          {r.note}
                        </Pill>
                      ) : (
                        <span className={styles.muted}>{r.note}</span>
                      )
                    ) : (
                      ''
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ))}

      <Card title="7 · 추가 확인 필요">
        <ul className={styles.checklist}>
          {DR_CHECKLIST.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </Card>
    </>
  );
}
