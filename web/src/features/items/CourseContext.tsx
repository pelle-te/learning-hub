/* ============================================================
   CourseContext — 과목 화면의 **맥락 카드 둘**: 주차 싱크(T-17) · 선수 관계(T-27).

   ## 왜 한 파일인가

   둘 다 _"이 과목이 다른 것과 어떻게 맞물리나"_ 를 묻는다 — 하나는 **시간축**(교수 진도가
   지금 어디), 하나는 **의존축**(무엇이 먼저여야 하나). 정의(`SubjectDefinition`)는 이 과목
   *자체*를 정하는 자리라 성격이 다르고, 거기 얹으면 이미 745줄인 파일이 더 커진다.

   ## 규율

   - **판정은 lib 이 소유한다**(`lib/syllabus` · `lib/prereq`). 여기는 그리기만 한다 — 이 저장소가
     반복해 세운 경계(판정=lib · 그리기=components/features)를 그대로 따른다.
   - **학기 밖에서는 주차 싱크를 안 그린다.** 주차는 학기 시작일에서 나오는 값이라(T-1) 날짜가
     없으면 "몇 주차"라는 질문 자체가 성립하지 않는다. 그때는 **왜 못 그리는지와 어디서 채우는지**
     를 말한다 — 빈 카드는 고장과 구분되지 않는다.
   - ⚠ **자동으로 시험 범위를 채우지 않는다.** 범위는 교수가 말하는 것이고 앱은 그 자리에 없었다.
     제안을 보여 주고 버튼을 누르게 한다(`suggestExamThru` 머리주석).
============================================================ */
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/useApp';
import { isSoftSubject, semesterPhase } from '@/lib/semester';
import { clearSyllabusMark, setSyllabusMark, syllabusOf, syncGap } from '@/lib/syllabus';
import { addPrereq, prereqChain, prereqGaps, removePrereq } from '@/lib/prereq';
import { todayISO } from '@/lib/utils';
import { Button, Pill } from '@/components/ui';
import type { AppState, Item } from '@/lib/types';

type Mutate = (recipe: (st: AppState) => void) => void;

const CARD_T = 'mb-2! ds-caps';

/** 어긋남 한 줄 — **앞섬도 어긋남이다.** 부호로 어휘를 가르되 앞선 것을 경고로 부르지 않는다. */
function GapLine({ gap }: { gap: number }) {
  if (gap === 0)
    return (
      <Pill tiny tone="good">
        수업과 나란함
      </Pill>
    );
  if (gap > 0)
    return (
      <Pill tiny tone={gap >= 3 ? 'bad' : 'warn'}>
        수업이 {gap}챕터 앞서요
      </Pill>
    );
  return (
    <Pill tiny tone="good">
      내가 {-gap}챕터 앞서요
    </Pill>
  );
}

/** T-17 주차 싱크 — 교수 진도를 주차마다 한 점씩 찍고, 내 진도와의 어긋남을 본다. */
function SyllabusCard({ item, mutate }: { item: Item; mutate: Mutate }) {
  const state = useApp((s) => s.state);
  const navigate = useNavigate();
  const phase = semesterPhase(state, todayISO(state));
  const chapters = item.chapters || [];
  const marks = syllabusOf(item);

  if (phase.kind !== 'in' || phase.week === null)
    return (
      <div className="ds-rule">
        <h3 className={CARD_T}>수업 진도</h3>
        <p className="ds-tiny text-mut">
          {phase.kind === 'pre' ? '개강 후에 주차가 시작돼요.' : '학기 날짜가 없어 “몇 주차”를 알 수 없어요.'}
        </p>
        <Button sm variant="ghost" className="mt-2.5" onClick={() => navigate('/degree')}>
          학기 날짜 넣기 →
        </Button>
      </div>
    );

  const week = phase.week;
  const g = syncGap(item, week);
  const thisWeek = marks.find((m) => m.week === week);

  return (
    <div className="ds-rule">
      <h3 className={CARD_T}>수업 진도 — {week}주차</h3>
      <div className="mb-2 flex items-center gap-2">
        {g.known ? (
          <GapLine gap={g.gap} />
        ) : (
          <span className="ds-tiny text-mut">아직 기록이 없어요 — 이번 주부터 찍으면 어긋남이 보입니다.</span>
        )}
      </div>
      <div className="ds-fld">
        <label htmlFor={`syl-${item.id}`}>이번 주에 나간 데까지</label>
        <select
          id={`syl-${item.id}`}
          value={thisWeek?.thru || ''}
          onChange={(e) => {
            const v = e.target.value;
            mutate((st) => {
              const it = st.items.find((i) => i.id === item.id);
              if (!it) return;
              if (v) setSyllabusMark(it, week, v);
              else clearSyllabusMark(it, week);
            });
          }}
        >
          <option value="">(기록 없음)</option>
          {chapters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      {marks.length > 0 && (
        <ul className="m-0 mt-2.5 flex list-none flex-col gap-1 p-0">
          {marks.slice(-4).map((m) => (
            <li key={m.week} className="flex items-center gap-2 text-md">
              <span className="w-12 flex-none text-mut tabular-nums">{m.week}주</span>
              <span className="min-w-0 flex-1 truncate">
                {chapters.find((c) => c.id === m.thru)?.name ?? '(지워진 챕터)'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** T-27 선수 관계 — 무엇이 먼저여야 하고, 그중 무엇이 비어 있나. */
function PrereqCard({ item, mutate }: { item: Item; mutate: Mutate }) {
  const state = useApp((s) => s.state);
  const navigate = useNavigate();
  const chain = prereqChain(state, item.id);
  const gaps = prereqGaps(state, item);
  const linked = new Set(item.prereqIds || []);
  const candidates = state.items.filter((i) => i.id !== item.id && !linked.has(i.id));

  return (
    <div className="ds-rule">
      <h3 className={CARD_T}>선수 과목</h3>
      {chain.cycle && (
        /* ⚠ 조용히 멈추지 않는다 — 멈추기만 하면 선행 하나가 왜 빠졌는지 영원히 알 수 없다. */
        <p className="ds-tiny mb-2 text-bad">선수 관계가 서로를 가리켜요(순환) — 한쪽 링크를 지워 주세요.</p>
      )}
      {(item.prereqIds?.length ?? 0) === 0 ? (
        <p className="ds-tiny text-mut">지정된 선수 과목이 없어요.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {(item.prereqIds || []).map((pid) => {
            const p = state.items.find((i) => i.id === pid);
            const gap = gaps.find((x) => x.item.id === pid);
            return (
              <li key={pid} className="flex items-center gap-2 text-md">
                <span className="min-w-0 flex-1 truncate">{p?.name ?? '(지워진 과목)'}</span>
                {gap && (
                  <Pill tiny tone="warn">
                    {gap.missing.length}/{gap.total} 비었음
                  </Pill>
                )}
                {p && (
                  <Button sm variant="ghost" onClick={() => navigate(`/subject/${p.id}`)}>
                    →
                  </Button>
                )}
                <Button
                  sm
                  variant="ghost"
                  aria-label={`${p?.name ?? '선수 과목'} 링크 지우기`}
                  onClick={() =>
                    mutate((st) => {
                      const it = st.items.find((i) => i.id === item.id);
                      if (it) removePrereq(it, pid);
                    })
                  }
                >
                  ✕
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {candidates.length > 0 && (
        <div className="ds-fld mt-2.5">
          <label htmlFor={`pre-${item.id}`}>선수 과목 추가</label>
          <select
            id={`pre-${item.id}`}
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              mutate((st) => {
                const it = st.items.find((i) => i.id === item.id);
                if (it) addPrereq(it, v);
              });
            }}
          >
            <option value="">(고르기)</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {gaps.length > 0 && (
        <p className="ds-tiny mt-2.5 text-mut">
          결손은 <b>안 끝났고 미루지도 않은</b> 챕터만 셉니다 — 미룬 것은 모르는 것이 아니에요.
        </p>
      )}
    </div>
  );
}

export function CourseContext({ item, mutate }: { item: Item; mutate: Mutate }) {
  /* P10 D6 — 소양 과목엔 **주차 싱크를 안 그린다.** 그 카드가 묻는 것은 _"교수가 지금 어디까지
     나갔나"_ 인데 소양엔 교수도 강의 주차도 없다. 위 규율("빈 카드는 고장과 구분되지 않는다")을
     그대로 적용하면 답은 *안내를 다르게 쓰는 것*이 아니라 **안 그리는 것**이다 — 채울 방법이
     아예 없는 칸이라 어디로 보낼 곳도 없다.
     ⚠ 선수 관계는 남긴다: 소양 과목에도 "이게 먼저다"는 성립한다(학기 회계와 무관한 축이다). */
  return (
    <>
      {!isSoftSubject(item) && <SyllabusCard item={item} mutate={mutate} />}
      <PrereqCard item={item} mutate={mutate} />
    </>
  );
}
