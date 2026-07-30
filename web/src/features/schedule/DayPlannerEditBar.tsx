/* ============================================================
   DayPlannerEditBar — 일 뷰 하단 **인라인 편집 바**(§6-2).

   타임박스 카드를 고르면 시작·길이(그리고 할 일이면 마감)를 정밀 입력한다. 드래그·키보드
   조작의 대안 경로이자, **일정(events)에는 유일한 시각/길이 편집 경로**다(§6-4 가 일정에는
   드래그를 안 붙였다).

   ## 왜 파일이 갈렸나

   `DayPlanner.tsx` 가 `max-lines` 래칫(745)을 넘겨서다 — `Task.deadline` 배선으로 12줄이
   늘자 752 가 됐다. 임계를 올리는 선택지는 없다: 그 래칫은 같은 날 844→745 로 **조인 것**이고
   (선언과 실측이 102줄 벌어져 있었다), 넘겼다고 다시 올리면 래칫이 아니라 눈금자가 된다.
   래칫이 "넘으면 쪼개라"는 뜻이라고 적어 놓고 안 쪼개면 그 문장도 거짓이 된다.

   ⚠ props 가 **18개**(⚠ 2026-07-30 감사 실측 — 이 주석은 11 이라 적고 있었다. 그중 `cls`·`fieldInput`·`numField`(클래스 문자열)·`mutate`·`updateEvent`·`updateTask`(lib 함수) **6개는 순수 우회**다: features→store/lib 이 허용이므로 자식이 직접 import 할 수 있다. 이 컴포넌트가 갈린 이유가 응집이 아니라 `max-lines` 래칫이었다는 사실도 함께 적어 둔다 — 절단면을 줄 수가 골랐다)인 것은 **의도한 비용**이다. 이 바는 세 종류(블록·할 일·일정)를 한 자리에서
   다루는데 그 판정은 호출부가 이미 갖고 있다 — 여기서 다시 계산하면 "선택된 것이 무엇인가"의
   답이 두 곳에 생긴다(이 저장소가 반복해 물린 정의 이중화). 계산은 호출부, 표시만 여기.
============================================================ */
import type { Dispatch, SetStateAction } from 'react';
import { toHM } from '@/lib/utils';
import { Button, NumberField } from '@/components/ui';
import type { AppState, PlacedBlock, Task } from '@/lib/types';
import type { PlanEvent } from '@/lib/types';

type Mutate = (recipe: (st: AppState) => void) => void;

export function DayPlannerEditBar({
  cls,
  barId,
  fieldInput,
  numField,
  selBlock,
  selTask,
  selEvent,
  selStart,
  selMin,
  setSelStart,
  setSelMin,
  onClose,
  titleDraft,
  setTitleDraft,
  mutate,
  updateEvent,
  updateTask,
}: {
  cls: { editBar: string; editTitle: string; editName: string; editField: string };
  barId: string;
  fieldInput: string;
  numField: string;
  selBlock?: PlacedBlock;
  selTask?: Task;
  selEvent?: PlanEvent;
  selStart: number;
  selMin: number;
  setSelStart: (m: number) => void;
  setSelMin: (m: number) => void;
  onClose: () => void;
  titleDraft: string | null;
  setTitleDraft: Dispatch<SetStateAction<string | null>>;
  mutate: Mutate;
  updateEvent: (st: AppState, id: string, patch: Partial<PlanEvent>) => void;
  updateTask: (st: AppState, id: string, patch: Partial<Task>) => void;
}) {
  if (!selBlock && !selTask && !selEvent) return null;
  return (
    <div className={cls.editBar} id={barId}>
      {selEvent ? (
        // 일정만 제목을 여기서 고친다(공부 블록=과목 파생, 할 일=트레이에서 다룸). 오타 수정 경로.
        <input
          className={cls.editTitle}
          /* ⚠ 초안이 있으면 초안을, 없으면 정본을 보여준다. 선택이 바뀌면 아래 커밋에서
             초안을 비우므로 **다른 일정의 초안이 새 선택에 새지 않는다**. */
          value={titleDraft ?? selEvent.title}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={() => {
            const t = titleDraft;
            setTitleDraft(null);
            if (t != null && t !== selEvent.title) mutate((st) => updateEvent(st, selEvent.id, { title: t }));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          aria-label="일정 제목"
        />
      ) : (
        <span className={cls.editName}>{selBlock ? selBlock.name : selTask!.title}</span>
      )}
      <label className={cls.editField}>
        시작
        <input
          type="time"
          className={fieldInput}
          value={toHM(selStart)}
          onChange={(e) => {
            const [h, m] = e.target.value.split(':').map(Number);
            if (Number.isFinite(h) && Number.isFinite(m)) setSelStart(h! * 60 + m!);
          }}
          aria-label="시작 시각"
        />
      </label>
      <label className={cls.editField}>
        길이
        {/* emptyValue 없음 — 비우면 길이 0분 블록이 확정돼 그 블록이 사실상 사라진다. 직전 값 유지. */}
        <NumberField
          className={numField}
          min={15}
          step={15}
          value={selMin}
          onCommit={setSelMin}
          aria-label="길이(분)"
        />
        분
      </label>
      {/* 마감은 **할 일에만** 있다 — 공부 블록의 마감은 과목(`Item.deadline`)이 소유하고,
          일정은 그 자체가 시각이다. 쓰는 자리가 없으면 읽는 자리도 영원히 빈다. */}
      {selTask && (
        <label className={cls.editField}>
          마감
          <input
            type="date"
            className={fieldInput}
            value={selTask.deadline || ''}
            onChange={(e) => mutate((st) => updateTask(st, selTask.id, { deadline: e.target.value }))}
            aria-label="할 일 마감일"
          />
        </label>
      )}
      <Button sm variant="ghost" onClick={onClose}>
        닫기
      </Button>
    </div>
  );
}
