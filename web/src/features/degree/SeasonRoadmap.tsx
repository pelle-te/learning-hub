/* ============================================================
   SeasonRoadmap — 졸업 로드맵(졸업 시그니처). 학기를 가로 진행 트랙(시즌 캘린더 결)으로,
   학점 진행을 네온 바로. 완료=발광 노드, 수강중=펄스, 예정=뮤트. 노드 클릭 → 그 학기 펼침.
   순수 표현: 화면 모델(Semester[])과 집계를 받아 그린다.
============================================================ */
import s from './SeasonRoadmap.module.css';

interface Course {
  id: string;
  name: string;
  credits: number;
  category: string;
  status: string;
  grade?: string;
}
interface Sem {
  id: string;
  name: string;
  courses: Course[];
}
type Phase = 'done' | 'current' | 'future';

function stat(sem: Sem): { tot: number; done: number; inprog: number; phase: Phase; pct: number } {
  let tot = 0;
  let done = 0;
  let inprog = 0;
  let planned = 0;
  sem.courses.forEach((c) => {
    const cr = +c.credits || 0;
    tot += cr;
    if (c.status === '완료') done += cr;
    else if (c.status === '수강중') inprog += cr;
    else planned += cr;
  });
  const phase: Phase = inprog > 0 ? 'current' : done > 0 && planned === 0 ? 'done' : 'future';
  return { tot, done, inprog, phase, pct: tot > 0 ? Math.round((done / tot) * 100) : 0 };
}

export default function SeasonRoadmap({
  list,
  targetTotal,
  earned,
  openIds,
  onToggle,
}: {
  list: Sem[];
  targetTotal: number;
  earned: number;
  openIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  const pct = targetTotal > 0 ? Math.min(100, Math.round((earned / targetTotal) * 100)) : 0;
  // 진행 노드 비율 — 완료 학기까지 스파인을 채움(시각적 "어디까지 왔나").
  const doneCount = list.filter((sm) => stat(sm).phase === 'done').length;
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
            const { tot, done, inprog, phase, pct: spct } = stat(sm);
            const open = openIds.has(sm.id);
            return (
              <button
                key={sm.id}
                type="button"
                className={`${s.station} ${s[phase]}${open ? ' ' + s.open : ''}`}
                aria-expanded={open}
                aria-label={`${sm.name || '이름 없는 학기'} · ${done}/${tot}학점${inprog ? ` · 수강중 ${inprog}` : ''}`}
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
