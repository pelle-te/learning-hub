/* ============================================================
   SubjectDefinition — 과목 객체 화면(`/subject/:id`)의 **정의 컬럼**(W12 · 2026-07-31).

   여기서 한 과목에 대해 **정의(주당 목표·챕터·마감)와 이번 주 배분(요일 분배)을 함께** 결정한다.
   배분은 lib/weekAlloc의 allocView/setAllocCell을 그대로 호출 → 배치 탭의 배분 보드와 같은 데이터의
   두 입구(미러). 흡수가 아니다: 요일 열 합계·전 과목 교차 조망은 보드가 계속 소유하고,
   여기선 그 과목의 '한 행'만 + 요일별 여유 힌트로 최소 맥락을 준다.

   ⚠⚠ **이 파일은 `SubjectSheet`(중앙 오버레이 시트)였다 — W12 에서 오버레이를 걷고 페이지의
   한 컬럼이 됐다.** 시트였던 이유("카드가 제자리에서 펼쳐지면 뒤 카드가 밀린다")는 여전히 옳지만,
   그 해법이 **객체에 URL 을 주지 않는다**는 더 큰 문제를 만들었다: ⌘K 는 과목·챕터를 이미
   객체 6종으로 인덱싱하는데(`actions.ts` `contentSearch`) 착지할 화면이 없어 4개 탭으로 흩뿌렸고,
   _"회로이론 지금 어떤가?"_ 가 **7클릭·6화면**이었다. 함께 사라진 것: DetailDrawer 오버레이·
   포커스 트랩·`morph` prop·`Items` 의 `?focus=` 1회소비+하이라이트+`CSS.escape` 장치 통째. */
import { useCallback, type CSSProperties } from 'react';
import { useApp } from '@/store/useApp';
import { useSchedule, useStudyMinByWeekday } from '@/store/selectors';
import { allocView, colSumMin, rowSumMin, setAllocCell, isWeekManaged, weekMonOf } from '@/lib/weekAlloc';
import { DOW_MON, addDays, iso, parseISO, dayDiff, ddayInfo, round1, hNum } from '@/lib/utils';
import { useTodayISO } from '@/hooks/useTodayISO';
import { dayStudyMin } from '@/lib/scheduler';
import { Button, NumberField, Pill, type PillTone } from '@/components/ui';
import { EXAM_LABEL, courseOfItem, examsOf, isSoftSubject } from '@/lib/semester';
import type { AppState, ExamKind, Item, SubjectKind } from '@/lib/types';
import { ChapterEditor } from './ChapterEditor';

/** 시험 칸의 순서·이름. **이 배열이 곧 "과목당 2개" 상한의 UI 쪽 표현**이다(추가 버튼이 없는 이유). */
const EXAM_SLOTS: { kind: ExamKind; label: string }[] = [
  { kind: 'mid', label: `${EXAM_LABEL.mid}고사` },
  { kind: 'final', label: `${EXAM_LABEL.final}고사` },
];

type Mutate = (recipe: (st: AppState) => void) => void;

// SubjectSheet.module.css → Tailwind 이식(C-7). 상태로 갈리는 것만 정적 맵으로(§15).
const SEC_TITLE = 'mb-0! ds-caps leading-text';
const MODE_BASE = 'rounded-full px-1.75 py-0.5 text-2xs font-extrabold tracking-mode-sub';
const MODE_AUTO = 'text-mut shadow-inset-line2';
const MODE_MANUAL = 'text-acc shadow-inset-acc-mid';
const DAY_BASE =
  'flex! flex-col items-center gap-1 m-0! cursor-pointer rounded-sm bg-panel px-1 py-2 max-mobile:px-0.5 max-mobile:py-1.5';
// 정보 노트 — AllocRow(완료 안내)·시트(매일 과목 안내) 공유.
const NOTE_INFO =
  'rounded-md bg-tint-acc-faint px-2.75 py-2.25 text-note-info text-mut shadow-inset-acc-faint leading-body';

/** +/- 스텝퍼 — 분/시간 직관 입력(0 미만 방지·소수 첫째자리 반올림). 옛 ItemCard에서 승계. */
function Stepper({
  id,
  value,
  step,
  unit,
  what,
  onChange,
}: {
  id?: string; // 바깥 <label htmlFor>와 잇기 위한 통로(감싸는 래퍼라 id가 안쪽까지 내려와야 한다)
  value: number;
  step: number;
  unit: string;
  /** 무엇의 스텝퍼인가 — 버튼 접근명에 들어간다.
   *  ⚠⚠ **단위만으로는 부족하다**(N-1 이 그 자리에서 실증했다). 주당 과제 칸이 생기며 같은
   *  화면에 `h 늘리기` 버튼이 **둘**이 됐고, 스크린리더 사용자는 어느 것이 진도이고 어느 것이
   *  과제인지 구분할 방법이 없다(테스트도 같은 이유로 즉시 깨졌다 — 그게 이 결함의 관측이다). */
  what?: string;
  onChange: (v: number) => void;
}) {
  const of = (verb: string): string => `${what ? `${what} ` : ''}${unit} ${verb}`;
  const clamp = (v: number) => Math.max(0, round1(v));
  const bump = (d: number) => onChange(clamp(value + d));
  return (
    <div className="ds-row" style={{ gap: 4, alignItems: 'center', maxWidth: 170 }}>
      <Button sm onClick={() => bump(-step)} aria-label={of('줄이기')}>
        –
      </Button>
      {/* ⚠⚠ **`emptyValue` 를 주지 않는다**(H25 · 2026-07-30 `/감사 근본`). 이 스텝퍼는 주당 목표
          시간·매일 학습(분)을 받는데, 값을 고쳐 치려고 칸을 비우고 떠나면 `emptyValue={0}` 은
          **0 을 확정한다.** 그 결과가 특히 나쁜 이유는 표시가 따라오지 않기 때문이다 —
          호출부가 `item.weeklyHours || 3` 이라 저장값 0 을 화면은 계속 "3h" 로 보여주고,
          스케줄러는 `|| 0` 로 읽어 그 과목의 예산을 0 으로 잡는다(**화면과 정본이 갈린다**).
          `Settings` 의 같은 이름 스텝퍼는 이미 이 사고를 겪고 주석으로 못박아 뒀는데, 이쪽
          사본에만 살아 있었다. 비우고 떠나면 **직전 값이 되살아난다**(NumberField 기본).
          ⚠ 아래 요일 칸의 `emptyValue={0}` 은 그대로 둔다 — 거기서 0 은 "이 요일엔 배분 안 함"
          이라는 **의미 있는 값**이다(같은 기본값이 두 자리에서 뜻이 다르다). */}
      <NumberField
        id={id}
        step={step}
        min={0}
        value={value}
        onCommit={(v) => onChange(clamp(v))}
        style={{ textAlign: 'center' }}
      />
      <Button sm onClick={() => bump(step)} aria-label={of('늘리기')}>
        +
      </Button>
      <span className="ds-tiny text-mut">{unit}</span>
    </div>
  );
}

/** 이 과목의 이번 주 요일 분배 — 배분 보드 한 행의 드릴다운 판. */
function AllocRow({ item, mutate }: { item: Item; mutate: Mutate }) {
  const state = useApp((s) => s.state);
  const res = useSchedule();
  const capWd = useStudyMinByWeekday(); // 요일 기본값 — 날짜별 실제 가용은 아래 dayStudyMin이 유도(보드와 동일)
  const todayIso = useTodayISO(state);
  const wk = weekMonOf(todayIso);
  const alloc = allocView(state, res, wk);
  const managed = isWeekManaged(state, wk);
  const vec = alloc[item.id];
  const monday = parseISO(wk);

  // 고아 방어 — 삭제된 과목의 잔여 배분이 요일 '여유' 계산을 오염시키지 않게 유효 sid만 센다
  // (정상 경로 청소는 removeSidFromAlloc가 하지만, 이미 오염된 저장본에 대한 표시 단계 방어선).
  const validSids = new Set(state.items.map((it) => it.id));

  const budgetMin = Math.round((item.weeklyHours || 0) * 60);
  const usedMin = rowSumMin(vec);
  const diff = usedMin - budgetMin;
  const rowTone: PillTone = budgetMin === 0 ? 'neutral' : diff === 0 ? 'good' : diff > 0 ? 'bad' : 'warn';
  const rowLabel =
    budgetMin === 0
      ? `${hNum(usedMin)}h 배분`
      : diff === 0
        ? `✓ 예산 ${hNum(budgetMin)}h 딱 맞음`
        : diff > 0
          ? `초과 +${hNum(diff)}h`
          : `부족 ${hNum(-diff)}h`;

  const setCell = (wd: number, hours: number) =>
    mutate((st) => setAllocCell(st, res, wk, item.id, wd, Math.max(0, Math.round(hours * 60))));

  // 계획상 챕터를 다 배우게 된 과목엔 배분해도 '새 학습'이 더 안 생긴다(보드와 같은 안내).
  const finished = res.itemStat.find((st) => st.id === item.id)?.finished;

  return (
    <div className="flex flex-col gap-2.5 rounded-md bg-panel2 p-3.5 shadow-inset-line2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className={SEC_TITLE}>이번 주 요일 배분</h3>
        <span className={`${MODE_BASE} ${managed ? MODE_MANUAL : MODE_AUTO}`}>{managed ? '내 배분' : '자동 제안'}</span>
        <Pill tiny tone={rowTone}>
          {rowLabel}
        </Pill>
      </div>

      {/* 요일 배분 그리드 — **시트 폭**에 반응(뷰포트 아님 · 컨테이너 쿼리). 좁은 시트(폰 전폭)에선
          7칸이 눌리므로 4칸 2줄로 접고, 시트가 넓으면(데스크톱) 7칸 한 줄. 배치 보드에 재사용돼도
          그 컨테이너 폭에 맞춰 스스로 접힌다 — 미디어쿼리(560/700/900)로는 표현 못 하는 국소 반응. */}
      <div className="@container">
        <div className="grid grid-cols-4 gap-1.5 @sm:grid-cols-7">
          {DOW_MON.map((lab, i) => {
            const date = addDays(monday, i);
            const wd = date.getDay();
            const mine = vec?.[wd] || 0;
            // 보드 열과 같은 출처여야 한다 — capWd(요일 기본값)가 아니라 그 날짜의 실제 가용.
            // 드릴다운인데 상위 보드와 다른 수를 보이면 "여기선 여유 있다는데 보드는 초과"가 된다.
            const capMin = dayStudyMin(state, iso(date), wd, capWd);
            // 그 요일 '남은 여유' = 가용 − (전 과목 배분). 내 칸을 늘릴 여지를 여기서 읽는다(열 맥락 최소 이식).
            const freeMin = capMin - colSumMin(alloc, wd, validSids);
            const over = capMin > 0 && freeMin < 0;
            const today = iso(date) === todayIso;
            return (
              <label key={i} className={`${DAY_BASE} ${today ? 'shadow-inset-acc' : 'shadow-inset-line2'}`}>
                <span className={`text-xs leading-text font-extrabold ${today ? 'text-acc' : 'text-mut'}`}>{lab}</span>
                <NumberField
                  className="min-w-0 text-center font-bold tabular-nums"
                  step={0.5}
                  min={0}
                  value={mine / 60 || 0}
                  emptyValue={0} // 비우기 = 그 요일 배분 없음
                  onCommit={(v) => setCell(wd, v)}
                  aria-label={`${lab}요일 배분 시간`}
                />
                <span
                  className={`text-day-free whitespace-nowrap tabular-nums max-mobile:hidden ${over ? 'font-extrabold text-bad' : 'text-mut'}`}
                >
                  {capMin === 0 ? '가용 0' : over ? `초과 ${hNum(-freeMin)}h` : `여유 ${hNum(freeMin)}h`}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {finished && usedMin > 0 && (
        <div className={NOTE_INFO}>
          계획상 챕터를 다 배우게 돼 있어 <b className="font-bold text-txt">새 학습</b>은 더 안 생겨요 — 복습·Anki만
          자동으로 얹혀요.
        </div>
      )}
      <div className="text-xs leading-body text-mut">
        요일 칸은 <b className="font-bold text-txt">새 학습</b> 분배예요(복습·Anki는 엔진이 자동으로 얹어요). 전 과목을
        요일별로 견주려면 <b className="font-bold text-txt">배치 › 배분 보드</b>에서.
      </div>
    </div>
  );
}

export function SubjectDefinition({
  item,
  mutate,
  onDelete,
}: {
  item: Item;
  mutate: Mutate;
  onDelete: (id: string) => void;
}) {
  const id = item.id;
  // 마감 D-day도 앱 정본 '오늘'에서 — 벽시계 new Date()를 쓰면 `_today` 시드 주입 시 값이 갈렸다.
  // ⚠ 훅으로 읽는다(H20) — 자정을 넘긴 채 열려 있으면 D-day 가 하루 틀린 채로 남았다.
  const seed = useApp((s) => s.state._today);
  const todayIso = useTodayISO({ _today: seed });
  const daily = item.mode === 'daily';
  /* P10 D6 — 소양 과목이면 **학기 회계 칸만** 접는다(시험 2칸). 챕터·배분·복습은 그대로다. */
  const soft = isSoftSubject(item);
  /* ⚠ 이미 학기 과목(`Course`)에 이어져 있으면 소양으로 못 바꾼다. 바꾸면 그 링크가 **살아 있는 채로
     안 보이게** 된다 — 졸업요건 탭의 셀렉트는 소양을 후보에서 빼므로 빈 칸으로 그려지고(연결은
     그대로 학점을 센다), 사용자에게는 되돌릴 손잡이가 없다. 막는 자리는 노브가 있는 여기다.
     ⚠ 셀렉터가 **문자열**을 돌려주게 한다 — 객체를 돌려주면 매 렌더가 새 참조라 재렌더가 돈다. */
  const linkedCourse = useApp((s) => courseOfItem(s.state, id)?.course.name ?? null);
  const chs = item.chapters || [];
  const totalH = chs.reduce((t, ch) => t + (+ch.hours || 0), 0);

  /** 이 과목만 변형. */
  const upd = useCallback(
    (fn: (it: Item) => void) =>
      mutate((st) => {
        const it = st.items.find((x) => x.id === id);
        if (it) fn(it);
      }),
    [mutate, id],
  );

  /** 이 과목의 시험들 — 읽기는 언제나 `examsOf`(옛 `deadline` 은 여기서 승격된다). */
  const exams = examsOf(item);
  /**
   * 시험 한 칸을 쓴다. `patch === null` 이면 그 시험을 지운다.
   *
   * ⚠ 여기가 **옛 두 필드를 흡수하는 유일한 지점**이다: 쓰는 순간 `exams` 가 정본이 되고
   * `deadline`/`deadlineThru` 를 지운다. 남겨 두면 두 원천이 갈려 화면마다 다른 마감을 그린다.
   * ⚠ 마지막 시험을 지우면 `exams: []` 가 아니라 **`undefined`** 로 되돌린다 — 빈 배열을 남기면
   * "시험을 안 쓰는 과목"과 "시험을 지운 과목"이 저장에서 구분되지 않는다.
   */
  const writeExam = useCallback(
    (kind: ExamKind, patch: { date?: string; thru?: string } | null) =>
      upd((it) => {
        const cur = examsOf(it);
        const next = cur.filter((e) => e.kind !== kind);
        if (patch) {
          const prev = cur.find((e) => e.kind === kind);
          const date = patch.date ?? prev?.date ?? '';
          if (date)
            next.push({
              id: prev?.id || `${kind}-${date}`,
              kind,
              date,
              thru: 'thru' in patch ? patch.thru : prev?.thru,
            });
        }
        it.exams = next.length ? next.sort((a, b) => (a.date < b.date ? -1 : 1)) : undefined;
        delete it.deadline;
        delete it.deadlineThru;
      }),
    [upd],
  );

  return (
    <div
      className="relative flex flex-col gap-4.5 pl-3"
      style={item.color ? ({ ['--tint']: item.color } as CSSProperties) : undefined}
    >
      <span
        className="absolute top-0.5 bottom-0.5 left-0 w-0.75 rounded-cell opacity-90"
        style={{ background: item.color || 'var(--acc)' }}
        aria-hidden="true"
      />

      <div className="ds-fieldgrid">
        <div className="ds-fld ds-wide">
          <label htmlFor={`it-name-${id}`}>과목 이름</label>
          <input
            id={`it-name-${id}`}
            type="text"
            value={item.name}
            onChange={(e) => upd((it) => void (it.name = e.target.value))}
            style={{ fontWeight: 600 }}
            placeholder="과목 이름"
          />
        </div>
        {/* ── P10 D6 · 과목 구분 ──────────────────────────────────────────────────────────
            언어처럼 **학점으로 세지 않는 과목**을 표현할 자리가 없어서, 그런 과목은 시험 칸·주차
            싱크·학기 연결이 전부 빈 채로 남았다. 노브는 이것 **하나**이고 가르는 것은 오직 학기
            회계다 — 챕터·복습 주기·주간 배분은 소양도 똑같이 돈다(그게 D6 이 언어를 hub 에
            남긴 이유다). ⚠ 저장은 전공일 때 **`undefined`** 다(옛 저장과 바이트 동일). */}
        <div className="ds-fld">
          <label htmlFor={`it-kind-${id}`}>구분</label>
          <select
            id={`it-kind-${id}`}
            value={soft ? 'soft' : 'major'}
            onChange={(e) =>
              upd((it) => void (it.kind = (e.target.value as SubjectKind) === 'soft' ? 'soft' : undefined))
            }
          >
            <option value="major">전공 (학기 과목)</option>
            <option value="soft" disabled={!!linkedCourse}>
              소양 (학점 밖)
            </option>
          </select>
          {linkedCourse && (
            <span className="ds-tiny text-mut" style={{ marginTop: 4 }}>
              학기 과목 「{linkedCourse}」에 연결돼 있어요 — 소양으로 바꾸려면 졸업요건 탭에서 연결을 먼저 푸세요.
            </span>
          )}
        </div>
        <div className="ds-fld">
          <label htmlFor={`it-mode-${id}`}>유형</label>
          <select
            id={`it-mode-${id}`}
            value={item.mode}
            onChange={(e) => upd((it) => void (it.mode = e.target.value as Item['mode']))}
          >
            <option value="weekly">주당 시간</option>
            <option value="daily">매일(Anki)</option>
          </select>
        </div>
        <div className="ds-fld">
          <label htmlFor={`it-amount-${id}`}>{daily ? '매일 학습 (분)' : '주당 목표 시간'}</label>
          {daily ? (
            <Stepper
              id={`it-amount-${id}`}
              value={item.dailyMin || 30}
              step={5}
              unit="분"
              onChange={(v) => upd((it) => void (it.dailyMin = v))}
            />
          ) : (
            <Stepper
              id={`it-amount-${id}`}
              value={item.weeklyHours || 3}
              step={0.5}
              unit="h"
              onChange={(v) => upd((it) => void (it.weeklyHours = v))}
            />
          )}
        </div>
        {/* ── N-1(W8) — **주당 과제 시간**. 진도 예산 바로 옆이 자리다(두 단이 나란해야 비교가 된다).
            ⚠ 왜 `weeklyHours` 에 합치지 않나: 챕터를 나가는 시간과 제출물을 만드는 시간을 한 통에
            담으면 과제가 많은 주에 **진도가 조용히 밀린다** — 그게 지금 상태이고, 밀린 이유가
            앱 어디에도 안 적힌다. 소비처는 학기 부하 시뮬(`simulateSemester`)이다.
            ⚠ 날짜가 정해진 과제는 여기가 아니라 **할 일**이 갖는다(그건 특정일의 소비이고 이건
            매주 반복되는 경상비다 · `schema.ts` 의 이 필드 주석이 SSOT). */}
        <div className="ds-fld">
          <label htmlFor={`it-chore-${id}`}>주당 과제 (h)</label>
          <Stepper
            id={`it-chore-${id}`}
            value={item.choreWeeklyH || 0}
            step={0.5}
            unit="h"
            what="주당 과제"
            onChange={(v) => upd((it) => void (it.choreWeeklyH = v))}
          />
        </div>
        {/* ── T-1 학기 계약 — 마감 1칸이 **시험 2칸**이 됐다 ────────────────────────────────
            왜: 중간·기말은 날짜도 범위도 다른 **두 사건**인데 옛 모델은 과목당 마감 1개뿐이라
            그 사실을 표현할 방법이 없었다. 그래서 사용자는 중간을 넣으면 기말이 사라지거나,
            과목을 둘로 쪼개 우회해야 했다.
            ⚠ 여기서 **쓰기는 `exams` 하나로만** 한다 — 옛 `deadline`/`deadlineThru` 는 첫 편집에
            흡수돼 사라진다(읽기는 `examsOf` 가 승격시키므로 그 전까지도 정상 동작).
            ⚠ 시험은 **최대 2개**다(`MAX_EXAMS`). 이 상한이 가중치·과제·출석으로 미끄러지는 것을
            막는 방벽이고, 근거는 `schema.ts` 의 `ExamSchema` 머리주석에 있다. */}
        {/* ⚠ 소양 과목은 시험 칸이 없다 — 그리고 **저장값도 안 지운다**: `examsOf` 가 소양이면 빈
            배열을 돌려주므로 엔진·달력도 함께 조용해지고, 구분을 되돌리면 그대로 살아난다
            (근거는 `lib/semester.ts` 의 `examsOf` 머리주석). */}
        {!soft &&
          EXAM_SLOTS.map(({ kind, label }) => {
            const exam = exams.find((e) => e.kind === kind);
            const thruOk = exam?.thru && chs.some((c) => c.id === exam.thru);
            return (
              <div className="ds-fld" key={kind}>
                <label htmlFor={`it-exam-${kind}-${id}`}>{label} (선택)</label>
                <input
                  id={`it-exam-${kind}-${id}`}
                  type="date"
                  value={exam?.date || ''}
                  onChange={(e) => writeExam(kind, e.target.value ? { date: e.target.value } : null)}
                />
                {exam && (
                  <span className="ds-tiny text-mut" style={{ marginTop: 4 }}>
                    {ddayInfo(dayDiff(todayIso, exam.date)).lab}
                  </span>
                )}
                {/* 범위(P-10 계승) — 값은 **챕터 id**다(인덱스 아님). 챕터를 삽입·재정렬해도 안 밀린다.
                  기말의 범위를 비우면 "중간 다음부터 끝까지"라 대개 그대로 두면 된다. */}
                {!daily && exam && chs.length > 0 && (
                  <select
                    className="mt-1"
                    aria-label={`${label} 범위`}
                    value={thruOk ? exam.thru : ''}
                    onChange={(e) => writeExam(kind, { thru: e.target.value || undefined })}
                  >
                    <option value="">{kind === 'mid' ? '전 챕터' : '중간 다음부터 끝까지'}</option>
                    {chs.map((c, i) => (
                      <option key={c.id} value={c.id}>
                        {i + 1}. {c.name} 까지
                      </option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
      </div>

      {/* 배분은 주간(new) 과목만 — 매일(Anki) 과목은 엔진이 매일 자동으로 얹는다(보드 행에도 없음). */}
      {daily ? (
        <div className={NOTE_INFO}>
          <b className="font-bold text-txt">매일(Anki)</b> 과목은 요일 배분 없이 매일 자동으로 잡혀요. 요일별로 나눠
          넣으려면 유형을 <b className="font-bold text-txt">주당 시간</b>
          으로 바꾸세요.
        </div>
      ) : (
        <AllocRow item={item} mutate={mutate} />
      )}

      {/* ChapterEditor가 자체 헤더('📘 챕터 N개 · 약 Nh')를 갖고 있어 제목을 덧대지 않는다(중복). */}
      {!daily && (
        <div className="flex flex-col gap-2">
          <ChapterEditor item={item} mutate={mutate} />
        </div>
      )}

      <div className="ds-itemfoot">
        <span className="ds-tiny text-mut">
          출처 {item.source || '직접'}
          {!daily && chs.length ? ` · ${chs.length}챕터 · 약 ${totalH}h` : ''}
        </span>
        <Button sm variant="ghost" danger onClick={() => onDelete(id)}>
          과목 삭제
        </Button>
      </div>
    </div>
  );
}
