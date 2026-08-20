/* ============================================================
   DayPlannerTrayAdder — 일 뷰 트레이의 **추가 컴포저**(자유 할 일 · 공부 블록 · 일정).

   ## 왜 파일이 갈렸나 (F5 재설계 · 2026-08-01)

   `DayPlannerEditBar` 와 같은 부류지만 이유는 한 겹 다르다. 저기는 `max-lines` 래칫이 절단면을
   골랐고(그 파일 머리주석이 그 사실을 정직하게 적었다), 여기는 **응집이 골랐다**: 컴포저가 쓰는
   상태 아홉(`draft`·`taskSid`·`repeatMode`·`blockSid`·`blockType`·`evOpen`·`evTitle`·`evStart`·
   `evMin`)이 전부 이 JSX 밖에서 한 번도 안 읽혔다. 즉 부모가 들고 있을 이유가 없는 상태를
   부모가 들고 있었고, 그 아홉이 `DayPlanner` 본문 복잡도의 큰 몫이었다.

   ⚠ **`cls` 를 props 로 받는 것은 형제(`DayPlannerEditBar`)와 맞춘 것**이다. 그 파일이
   *"클래스 문자열·lib 함수를 넘기는 것은 순수 우회"* 라고 적어 뒀는데 맞는 지적이고, 다만 여기서
   같이 고치면 절단면 하나에 관심사 둘이 섞인다 — 클래스 SSOT(`DP`)를 옮기는 것은 별건이다.
   나머지(`mutate`·lib 함수)는 이 파일이 **직접 import** 한다.

   ⚠ 일정(events)은 **시각이 필수**다(시각이 없으면 그건 그냥 할 일이다) → 트레이(미지정)를
   거치지 않고 곧장 타임라인에 꽂힌다. 그래서 여기만 시각·길이 입력을 갖는다.
============================================================ */
import { useState } from 'react';
import { addBlock, blockMinPresets } from '@/lib/dayPlans';
import { addTask } from '@/lib/tasks';
import { addEvent } from '@/lib/events';
import { hLabel, toMin } from '@/lib/utils';
import { toast } from '@/shell';
import { useApp } from '@/store/useApp';
import type { Item, ScheduleResult, SessionType } from '@/lib/types';
import { Icon } from '@/components/Icon';

const EV_FORM_ID = 'dayPlannerEventForm'; // '+ 일정'이 aria-controls로 가리키는 온디맨드 컴포저.

/** 일정 길이 프리셋 — 자유 입력 대신 셀렉트로 받는다(340px 트레이에서 숫자 입력 하나를 더 끼우면
 *  제목이 뭉개진다). 세밀 조정은 추가 후 편집 바(분 단위)에서 한다 — 추가는 빠르게, 정밀은 온디맨드. */
const EVENT_MINS = [30, 60, 90, 120, 180, 240] as const;

/* ⚠ 라벨은 `scheduleView.SESSION_TYPE_META` 와 **의도적으로 다르다**(new: 여기 '집중' vs 저기
   '학습'). 저기는 스케줄 표의 유형 태그, 여기는 "지금 뭘 추가할까" 버튼이라 어휘가 갈린다.

   ⚠⚠ **이름이 `BLOCK_TYPES` 였다**(2026-08-20 리뷰 m-24). 그건 `lib/utils` 의 *일과 유형 →
   CSS 토큰* 표와 **글자까지 같은 이름인데 도메인이 다르다** — 둘 다 "하루 계획" 코드에 살고 같은
   화면군(`features/schedule`)에서 쓰여서, 코드를 옮기다 `BLOCK_TYPES[b.type]` 을 그대로 가져오면
   한쪽에선 색이 나오고 한쪽에선 `undefined` 가 나온다(하나는 `Record`, 하나는 배열이다).

   ⚠ 그리고 집합이 `SessionType` 에 **안 묶여 있었다** — 짝인 `SESSION_TYPE_META` 는
   `Record<SessionType, …>` 라 타입이 강제하는데 여기만 사람 규율("바꿀 땐 둘을 함께 볼 것")에
   맡겨져 있었다. 아래 `_EXHAUSTIVE` 가 그 비대칭을 없앤다: 유형이 하나 늘면 컴파일이 막는다. */
const SESSION_ADD_BUTTONS: readonly { t: SessionType; label: string }[] = [
  { t: 'new', label: '집중' },
  { t: 'rev', label: '복습' },
  { t: 'anki', label: 'Anki' },
  { t: 'blank', label: '백지' },
  { t: 'mock', label: '모의' },
] as const;
/** 집합 누락을 **컴파일에서** 잡는다 — 값은 쓰지 않는다(존재가 곧 검사다). */
const _EXHAUSTIVE: Record<SessionType, true> = Object.fromEntries(
  SESSION_ADD_BUTTONS.map((x) => [x.t, true]),
) as Record<SessionType, true>;
void _EXHAUSTIVE;

const REPEAT_NEXT = { none: 'daily', daily: 'weekly', weekly: 'none' } as const;
/** 반복 토글 라벨 — 아이콘 뒤에 붙는 **접미사**다(아이콘은 아래 렌더가 그린다). */
const REPEAT_LABEL = { none: '', daily: '일', weekly: '주' } as const;
const REPEAT_TITLE = {
  none: '반복 없음 — 눌러 매일',
  daily: '매일 반복 — 눌러 매주',
  weekly: '매주 반복 — 눌러 끔',
} as const;
const REPEAT_ARIA = { none: '없음', daily: '매일', weekly: '매주' } as const;

export function DayPlannerTrayAdder({
  cls,
  ds,
  res,
  namedItems,
  moduleLen,
}: {
  cls: Record<string, string>;
  ds: string;
  res: ScheduleResult;
  /** 이름이 있는 학습 항목 — 없으면 블록 컴포저 자체가 사라진다(일정은 과목과 무관해 남는다). */
  namedItems: Item[];
  moduleLen: number;
}) {
  const mutate = useApp((st) => st.mutate);
  const [draft, setDraft] = useState('');
  const [repeatMode, setRepeatMode] = useState<'none' | 'daily' | 'weekly'>('none'); // +할일 반복 모드
  const [taskSid, setTaskSid] = useState(''); // +할일 과목 링크(선택)
  const [blockSid, setBlockSid] = useState(''); // +블록 대상 과목
  const [blockType, setBlockType] = useState<SessionType>('new');
  // 일정(약속·시험·행사) 컴포저 — 평소엔 접혀 있고 '+ 일정'을 눌러야 펼쳐진다(온디맨드 세부).
  const [evOpen, setEvOpen] = useState(false);
  const [evTitle, setEvTitle] = useState('');
  const [evStart, setEvStart] = useState('09:00');
  const [evMin, setEvMin] = useState<number>(60);

  const BLOCK_MIN = blockMinPresets(moduleLen); // 길이 프리셋은 lib/dayPlans가 소유(도메인 규칙)

  const addFreeTask = () => {
    const title = draft.trim();
    if (!title) return;
    mutate((st) =>
      addTask(st, {
        title,
        ds,
        sid: taskSid || undefined,
        /* ⚠⚠ **색을 저장하지 않는다(H13 · 2026-07-31 `/감사 근본`).** 종전엔 `color: linked?.color`
           로 과목 hex 를 태스크에 굳혔는데, 그러면 절대규칙 #3("색 = 파생물")이 tasks 에 대해
           거짓이 된다 — `refineItemColors` 는 `state.items` 만 다시 파생하므로 **노브(`SUBJECT_L`·
           `SUBJECT_C`) 교체가 이 값에 영원히 도달하지 않는다.** 바로 아래 블록 생성부가
           _"색은 저장하지 않는다"_ 라 적고 있었고, 같은 파일이 자기 규약을 두 줄로 어겼다.
           렌더가 `sid` 로 다시 뽑는다(`segColor`) — 스키마 필드는 남기되 **읽지 않는다**. */
        repeat: repeatMode === 'none' ? undefined : repeatMode,
      }),
    );
    setDraft('');
  };

  const addStudyBlock = () => {
    const isMock = blockType === 'mock';
    const sid = isMock ? 'mock' : blockSid || namedItems[0]?.id;
    if (!isMock && !sid) return;
    const item = namedItems.find((it) => it.id === sid);
    const name = isMock ? '모의시험' : item?.name || '과목';
    mutate((st) =>
      addBlock(st, res, ds, {
        type: blockType,
        sid: sid!,
        name,
        // 색은 저장하지 않는다 — 과목 색은 파생이라 렌더에서 segColor(sid)로 다시 뽑고,
        // 모의처럼 과목이 없는 블록은 CSS 타입 폴백(.mock)이 칠한다(색 리터럴을 상태에 굳히지 않는다).
        min: BLOCK_MIN[blockType]!,
        chapters: [],
      }),
    );
    toast(`${name} · ${SESSION_ADD_BUTTONS.find((x) => x.t === blockType)!.label} 블록 추가`, 'ok');
  };

  const addEventNow = () => {
    const title = evTitle.trim();
    if (!title) return;
    mutate((st) => addEvent(st, { ds, title, start: toMin(evStart), min: evMin }));
    setEvTitle('');
    toast(`${evStart} · ${title} 일정 추가`, 'ok');
  };

  return (
    <div className={cls.addWrap}>
      <div className={cls.addRowTask}>
        <input
          className={`${cls.addInput} flex-1`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addFreeTask()}
          placeholder="+ 할 일 (예: 과제 제출)"
          aria-label="자유 할 일 추가"
        />
        {namedItems.length > 0 && (
          <select
            className={`${cls.addSel} shrink grow-0 basis-21`}
            value={taskSid}
            onChange={(e) => setTaskSid(e.target.value)}
            aria-label="할 일 연결 과목(선택)"
            title="연결 과목(선택) — 색·필터용"
          >
            <option value="">과목—</option>
            {namedItems.map((it) => (
              <option key={it.id} value={it.id}>
                {it.name}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className={`${cls.addBtn} ${repeatMode !== 'none' ? cls.repeatOn : ''}`}
          onClick={() => setRepeatMode((m) => REPEAT_NEXT[m])}
          title={REPEAT_TITLE[repeatMode]}
          aria-label={`반복: ${REPEAT_ARIA[repeatMode]}`}
        >
          <Icon name="refresh" />
          {REPEAT_LABEL[repeatMode]}
        </button>
        <button type="button" className={cls.addBtn} onClick={addFreeTask} aria-label="할 일 추가">
          ＋
        </button>
      </div>
      {namedItems.length > 0 && (
        <div className={cls.addRow}>
          {blockType !== 'mock' && (
            <select
              className={cls.addSel}
              value={blockSid || namedItems[0]!.id}
              onChange={(e) => setBlockSid(e.target.value)}
              aria-label="공부 블록 과목"
            >
              {namedItems.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name}
                </option>
              ))}
            </select>
          )}
          <select
            className={cls.addSel}
            value={blockType}
            onChange={(e) => setBlockType(e.target.value as SessionType)}
            aria-label="공부 블록 유형"
          >
            {SESSION_ADD_BUTTONS.map((x) => (
              <option key={x.t} value={x.t}>
                {x.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {/* 액션 줄 — 전엔 '+ 블록'이 위 격자의 둘째 줄을 전폭으로 먹었다. 같은 자리를 2열로 쪼개
          '+ 일정'을 나란히 두면 **줄 수가 늘지 않는다**(340px 트레이에 셋째 줄을 새로 만들지 않는 이유).
          과목이 없는 날은 '+ 일정'만 남아 전폭이 된다 — 일정은 과목과 무관하므로 과목 없이도 추가돼야 한다. */}
      <div className={cls.addRowBtns}>
        {namedItems.length > 0 && (
          <button type="button" className={cls.addBlockBtn} onClick={addStudyBlock} title="공부 블록 추가(트레이로)">
            + 블록
          </button>
        )}
        <button
          type="button"
          className={`${cls.addBlockBtn} ${evOpen ? cls.addBtnOn : ''}`}
          onClick={() => setEvOpen((v) => !v)}
          title="일정 추가(약속·시험·행사) — 과목과 무관한 단발 사건"
          aria-expanded={evOpen}
          aria-controls={evOpen ? EV_FORM_ID : undefined}
        >
          + 일정
        </button>
      </div>
      {/* 온디맨드 세부 — 시각·길이는 일정을 실제로 만들 때만 필요한 정보라 평소엔 숨긴다. */}
      {evOpen && (
        <div className={cls.evForm} id={EV_FORM_ID}>
          <input
            className={`${cls.addInput} flex-none`}
            value={evTitle}
            onChange={(e) => setEvTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addEventNow()}
            placeholder="일정 (예: 병원 예약)"
            aria-label="일정 제목"
          />
          <div className={cls.evFormRow}>
            <input
              type="time"
              className={cls.evTime}
              value={evStart}
              onChange={(e) => e.target.value && setEvStart(e.target.value)}
              aria-label="일정 시작 시각"
            />
            <select
              className={cls.addSel}
              value={evMin}
              onChange={(e) => setEvMin(Number(e.target.value))}
              aria-label="일정 길이"
            >
              {EVENT_MINS.map((m) => (
                <option key={m} value={m}>
                  {hLabel(m)}
                </option>
              ))}
            </select>
            <button type="button" className={cls.addBtn} onClick={addEventNow} aria-label="일정 추가">
              ＋
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
