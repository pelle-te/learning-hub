/* ============================================================
   SeasonRoadmap — 졸업 로드맵(졸업 시그니처). 학기를 가로 진행 트랙(시즌 캘린더 결)으로,
   학점 진행을 네온 바로. 완료=발광 노드, 수강중=펄스, 예정=뮤트. 노드 클릭 → 그 학기 펼침.
   순수 표현: 화면 모델(DegreeSemester[])을 받아 lib/degree.semesterStat로 집계해 그린다.
============================================================ */
import { semesterGpa, semesterStat, type DegreeSemester } from '@/lib/degree';
import s from './SeasonRoadmap.module.css';

export default function SeasonRoadmap({
  list,
  targetTotal,
  earned,
  openIds,
  onToggle,
}: {
  list: DegreeSemester[];
  targetTotal: number;
  earned: number;
  openIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  const pct = targetTotal > 0 ? Math.min(100, Math.round((earned / targetTotal) * 100)) : 0;
  // 진행 노드 비율 — 완료 학기까지 스파인을 채움(시각적 "어디까지 왔나").
  const doneCount = list.filter((sm) => semesterStat(sm).phase === 'done').length;
  const fillPct = list.length > 1 ? (doneCount / (list.length - 1)) * 100 : doneCount ? 100 : 0;

  return (
    <div className={s.board}>
      <div className={s.head}>
        <span className={s.title}>졸업 로드맵 — ROADMAP</span>
        <span className={s.overall}>
          <b>{earned}</b>
          <span className={s.slash}>/ {targetTotal}</span>
          <span className={s.pct}>{pct}%</span>
        </span>
      </div>

      {list.length === 0 ? (
        <div className={s.empty}>
          아직 학기가 없어요. 아래 <b>＋ 학기 추가</b>로 첫 시즌을 열면 여기에 진행 트랙이 그려집니다.
        </div>
      ) : (
        <div className={s.strip}>
          <span className={s.spine} aria-hidden="true">
            <i className={s.spineFill} style={{ width: `${fillPct}%` }} />
          </span>
          {list.map((sm) => {
            const { tot, done, inprog, phase, pct: spct } = semesterStat(sm);
            const open = openIds.has(sm.id);
            // PL-8 — 학기 GPA(완료·점수 성적만). null이면 병기 생략(성적 없는 학기).
            const g = semesterGpa(sm);
            return (
              <button
                key={sm.id}
                type="button"
                className={`${s.station} ${s[phase]}${open ? ' ' + s.open : ''}`}
                aria-expanded={open}
                aria-label={`${sm.name || '이름 없는 학기'} · ${done}/${tot}학점${inprog ? ` · 수강중 ${inprog}` : ''}${g != null ? ` · GPA ${g.toFixed(1)}` : ''}`}
                onClick={() => onToggle(sm.id)}
              >
                <span className={s.dot} />
                <span className={s.term}>{sm.name || '(이름 없음)'}</span>
                <span className={s.bar}>
                  <i style={{ width: `${spct}%` }} />
                </span>
                <span className={s.cr}>
                  {done}
                  <span className={s.crtot}>/{tot}</span>
                  {g != null && <span className={s.gpa}>· {g.toFixed(1)}</span>}
                </span>
                <span className={s.tag}>{phase === 'done' ? '완료' : phase === 'current' ? '수강중' : '예정'}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
