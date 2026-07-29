/* ============================================================
   SeasonRoadmap — 졸업 로드맵(졸업 시그니처). 학기를 가로 진행 트랙(시즌 캘린더 결)으로,
   학점 진행을 네온 바로. 완료=발광 노드, 수강중=펄스, 예정=뮤트. 노드 클릭 → 그 학기 펼침.
   순수 표현: 화면 모델(DegreeSemester[])을 받아 lib/degree.semesterStat로 집계해 그린다.

   ── C-7 이식(degree) — Tailwind ──────────────────────────────────────────────
   보드 껍데기는 전역 `ds-board` 를 유지하고 델타(하단 패딩·마진)만 `!` 로 얹는다.
   phase(done/current/future) 별 자식 규칙(`.done .dot` 등)은 **정적 클래스 맵**으로 자식에
   직접 준다(규약 4 · 동적 조립 금지). 노드 펄스(sr-pulse)·발광 shadow 는 tw.css/토큰으로 옮겼다.
   ⚠ station 은 <button> 이라 전역 button 규칙을 `!` 로 이긴다(bg/border/radius/padding). 원본의
   `.station:hover{background:panel2}` 를 그대로 이식한다 — 전역 button:hover 가 명세보다 높은
   특이도로 이를 덮던 잠재 버그가 있었다(리포트 참조). open 상태는 hover 를 빼 acc-soft 를 유지한다.
============================================================ */
import { semesterGpa, semesterStat, type DegreeSemester } from '@/lib/degree';

// phase 별 정적 클래스 맵(§15 부칙 · 동적 조립 금지). 노드/바채움/태그의 색·발광만 상태로 가른다.
type Phase = 'done' | 'current' | 'future';
const DOT: Record<Phase, string> = {
  done: 'bg-acc shadow-node',
  current: 'bg-acc shadow-node-cur animate-[sr-pulse_1.8s_infinite] motion-reduce:animate-none',
  future: 'bg-bg shadow-dot-ring',
};
const BAR_FILL: Record<Phase, string> = {
  done: 'bg-acc shadow-dot',
  current: 'bg-acc',
  future: 'bg-track-fill-season',
};
const TAG: Record<Phase, string> = {
  done: 'text-acc',
  current: 'text-txt',
  future: 'text-mut',
};

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
  /* ⚠ 클램프를 뗐다 — 여기만 100% 로 잘라 상단 리드아웃·요건 탭이 108% 를 말할 때 혼자
     "다 됐다"고 했다. 이 값은 스파인 채움이 아니라 **텍스트**다(채움은 아래 `fillPct`). */
  const pct = targetTotal > 0 ? Math.round((earned / targetTotal) * 100) : 0;
  // 진행 노드 비율 — 완료 학기까지 스파인을 채움(시각적 "어디까지 왔나").
  const doneCount = list.filter((sm) => semesterStat(sm).phase === 'done').length;
  const fillPct = list.length > 1 ? (doneCount / (list.length - 1)) * 100 : doneCount ? 100 : 0;

  return (
    <div className="ds-board mb-4! pb-3.5!">
      <div className="mb-4 flex items-baseline justify-between">
        <span className="text-xs font-extrabold tracking-caps text-mut uppercase">졸업 로드맵 — ROADMAP</span>
        <span className="flex items-baseline gap-1.5 tabular-nums">
          <b className="text-2xl font-extrabold text-acc">{earned}</b>
          <span className="text-sm text-mut">/ {targetTotal}</span>
          <span className="ml-1 text-xs font-bold text-txt">{pct}%</span>
        </span>
      </div>

      {list.length === 0 ? (
        <div className="px-1 pt-3.5 pb-2 text-sm leading-[1.6] text-mut">
          아직 학기가 없어요. 아래 <b>＋ 학기 추가</b>로 첫 시즌을 열면 여기에 진행 트랙이 그려집니다.
        </div>
      ) : (
        <div className="relative flex [scrollbar-width:thin] gap-2 overflow-x-auto px-0.5 pt-1 pb-0.5">
          <span className="absolute top-3.25 right-2 left-2 h-0.5 rounded-xs bg-line" aria-hidden="true">
            <i
              className="absolute top-0 left-0 h-full rounded-xs bg-acc shadow-spine transition-[width] duration-[0.4s] ease-[var(--ease)]"
              style={{ width: `${fillPct}%` }}
            />
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
                className={`relative z-[1] flex max-w-45 min-w-29 shrink-0 grow basis-29 flex-col items-start gap-1.75 rounded-md! pt-1.5! pr-2! pb-2.25! pl-2! text-left focus-visible:-outline-offset-2! ${
                  open ? 'border-line-acc-focus! bg-acc-soft!' : 'border-transparent! bg-transparent! hover:bg-panel2!'
                }`}
                aria-expanded={open}
                aria-label={`${sm.name || '이름 없는 학기'} · ${done}/${tot}학점${inprog ? ` · 수강중 ${inprog}` : ''}${g != null ? ` · GPA ${g.toFixed(1)}` : ''}`}
                onClick={() => onToggle(sm.id)}
              >
                <span className={`size-3.25 rounded-full ${DOT[phase]}`} />
                <span className="max-w-full truncate text-md leading-[1.2] font-extrabold">
                  {sm.name || '(이름 없음)'}
                </span>
                <span className="block h-1 w-full overflow-hidden rounded-xs bg-track-season">
                  <i className={`block h-full rounded-xs ${BAR_FILL[phase]}`} style={{ width: `${spct}%` }} />
                </span>
                <span className="text-lg leading-none font-extrabold tabular-nums">
                  {done}
                  <span className="text-xs font-bold text-mut">/{tot}</span>
                  {g != null && <span className="ml-1.25 text-xs font-bold text-mut">· {g.toFixed(1)}</span>}
                </span>
                <span className={`text-2xs font-extrabold tracking-widest uppercase ${TAG[phase]}`}>
                  {phase === 'done' ? '완료' : phase === 'current' ? '수강중' : '예정'}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
