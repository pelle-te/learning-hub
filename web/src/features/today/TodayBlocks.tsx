/* TodayBlocks — 오늘 배치된 블록 + 블록별 4단계 흐름/방법론 액션.
   파생 스케줄(useSchedule)에서 오늘 Day를 찾고 layoutDay로 시각을 배정해 표시.
   스타일: 공유는 전역 `ds-*`(card/blk/donechk/swatch/muted/tiny/foot/empty), today 전용은 Tailwind 유틸(C-7). */
import { completionKey } from '@/lib/domainKeys';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/useApp';
import { useSchedule } from '@/store/selectors';
import { usePrefill } from '@/store/prefill';
import { useUI } from '@/store/useUI';
import { toast } from '@/shell';
import { layoutDay, sessionTimeMap } from '@/lib/scheduler';
import { isDone } from '@/lib/persistence';
import { addSummary, blankResultFor, clearBlankResult } from '@/lib/methodology';
import { toHM, hLabel, fmt, todayISO, blockColor } from '@/lib/utils';
import { Button, Pill } from '@/components/ui';
import type { ScheduleItem } from '@/lib/types';
import { BLOCK_STAGES } from './consts';

/** 세 문장의 뜻을 칸이 스스로 말한다 — 라벨 3줄을 더하면 이 조각이 카드가 되어 버린다. */
const SUMMARY_PLACEHOLDERS = ['무엇을 배웠나', '왜 그런가', '어디에 쓰나'];
import { Icon } from '@/components/Icon';

/** 블록 4단계 비중 막대(분 추정 포함). */
function StageBar({ ml }: { ml: number }) {
  return (
    <div className="mt-2.25 flex h-10.5 gap-0.75">
      {BLOCK_STAGES.map((st, i) => {
        const w = st.end - st.start;
        const mins = Math.round((ml * w) / 100);
        // 2단계(예제·풀이)만 acc2 톤으로 강조(원본 .stg:nth-child(2)) — 나머지는 acc 베이스.
        const tint =
          i === 1 ? 'border-[color:var(--stg-border2)] bg-[var(--stg-bg2)]' : 'border-line bg-[var(--stg-bg)]';
        return (
          <div
            key={st.name}
            className={`flex min-w-0 flex-col items-center justify-center gap-0.25 overflow-hidden rounded-sm border px-1 py-0.75 text-center ${tint}`}
            style={{ flex: w }}
            data-tip={`${st.name} (~${mins}분) — ${st.action}`}
            role="img"
            aria-label={`${st.name} (~${mins}분) — ${st.action}`}
          >
            <span className="max-w-full truncate text-xs leading-text font-semibold">{st.name}</span>
            <span className="text-2xs text-mut tabular-nums">~{mins}m</span>
          </div>
        );
      })}
    </div>
  );
}

/** W8 인라인 '막힌 구간' 한 줄 — 모달이 아니다. 기록은 이미 커밋됐고 이건 정밀도만 올린다.
 *  ⚠ 그래서 취소 경로가 없다: 안 적고 떠나도 잃는 것이 없는 것이 이 위젯의 존재 이유다. */
function BlankNoteField({ initial, onSave }: { initial: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(initial);
  /* 마운트 포커스 — 이 컴포넌트는 **열릴 때만** 마운트되므로 이펙트 1회가 곧 "열자마자 커서".
     `autoFocus` 속성은 쓰지 않는다(jsx-a11y 금지 · 그쪽은 페이지 로드 시 튀는 포커스를 겨냥한 룰). */
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <span className="mt-1.5 flex w-full items-center gap-1.5">
      <input
        ref={ref}
        type="text"
        className="min-w-0 flex-1"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSave(v);
        }}
        placeholder="어느 구간에서 막혔나요? 예) 파동방정식 유도"
        aria-label="막힌 구간 메모"
      />
      <Button sm onClick={() => onSave(v)}>
        저장
      </Button>
    </span>
  );
}

/**
 * **Q-6 인라인 3문장 요약** — 블록을 막 끝낸 자리에서 바로 쓴다.
 *
 * ⚠ W8 인라인 메모·Q-1 진도 커밋과 **같은 관용구**다: 모달이 아니라 행 안의 한 조각이라
 * Esc·포커스 트랩이 필요 없다(안 쓰고 떠나도 잃는 것이 없다). 저장하면 스스로 닫힌다.
 * ⚠ 세 칸을 다 채우게 강제하지 않는다 — 한 문장만 남기는 날도 아무것도 안 남기는 날보다 낫다.
 *   다만 **전부 비어 있으면** 저장 자체를 막는다(빈 기록이 원장을 늘리면 나중에 세기만 어려워진다).
 */
function InlineSummary({ sid, name, ds, onDone }: { sid: string; name: string; ds: string; onDone: () => void }) {
  const mutate = useApp((s) => s.mutate);
  const [v, setV] = useState(['', '', '']);
  const empty = v.every((x) => !x.trim());
  const save = () => {
    if (empty) return;
    mutate((st) => addSummary(st, ds, sid, name, v[0]!.trim(), v[1]!.trim(), v[2]!.trim()));
    toast('요약 저장됨', 'ok');
    onDone();
  };
  return (
    <div className="mt-2 flex flex-col gap-1.5 rounded-md bg-panel2 px-2.5 py-2 shadow-inset-line2">
      <span className="ds-tiny text-mut">{name} — 세 문장으로</span>
      {SUMMARY_PLACEHOLDERS.map((ph, i) => (
        <input
          key={i}
          type="text"
          value={v[i]}
          aria-label={`요약 ${i + 1}번째 문장`}
          placeholder={ph}
          onChange={(e) => setV((prev) => prev.map((x, k) => (k === i ? e.target.value : x)))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) save();
          }}
        />
      ))}
      <div className="flex gap-1.5">
        <Button sm variant="primary" disabled={empty} onClick={save}>
          저장
        </Button>
        <Button sm variant="ghost" onClick={onDone}>
          닫기
        </Button>
      </div>
    </div>
  );
}

export function TodayBlocks() {
  const state = useApp((s) => s.state);
  const res = useSchedule();
  const toggleDone = useApp((s) => s.toggleDone);
  const setBlankResult = useApp((s) => s.setBlankResult);
  const mutate = useApp((s) => s.mutate);
  const navigate = useNavigate();
  const requestPrefill = usePrefill((s) => s.request);
  // U010 — 빈 상태의 처방이 갈린다("과목이 이미 있나"). 뷰 전환은 보내는 쪽 규약(v4).
  const setSchedView = useUI((st) => st.setSchedView);
  const hasItems = state.items.length > 0;
  // W8 — 인라인 '막힌 구간' 입력이 열린 행(sid). 모달이 아니라 행 안의 한 줄이다.
  const [noteFor, setNoteFor] = useState<string | null>(null);
  // Q-1 — 진도 커밋 줄이 열린 블록(`sid|type`). 완료를 켠 직후에만 열리고, 끄면 닫힌다.
  const [commitFor, setCommitFor] = useState<string | null>(null);
  // Q-6 — 인라인 3문장 요약이 열린 블록(sid).
  const [sumFor, setSumFor] = useState<string | null>(null);
  const setChapterDone = useApp((s) => s.setChapterDone);
  // '오늘 학습' 블록 → 기록 탭으로 과목 사전선택 + 이동.
  const prefill = (form: 'sum' | 'cbms' | 'bl', sid: string) => {
    requestPrefill(form, sid);
    navigate('/day');
  };

  const ds2 = todayISO(state); // '오늘' 단일 출처(_today 시드 존중).
  /** Q-1 — 블록이 가진 것은 챕터 **이름**뿐이라(엔진 계약), 표시용 `done` 은 여기서 되찾는다. */
  const chapterOf = (sid: string, chName: string) =>
    state.items.find((x) => x.id === sid)?.chapters?.find((c) => c.name === chName);
  const day = (res.days || []).find((d) => d.ds === ds2);
  const items = day ? day.items : [];

  if (!items.length) {
    /* ⚠⚠ **이미 한 일을 처방하지 않는다**(U010 · 2026-08-21 ux 축). 종전 문구는 조건 없이
       *"과목/가용시간을 설정하면"* 이라 말했는데, 과목이 이미 있는 사용자에게 그건 모순이고
       그가 할 수 있는 일을 하나도 안 알려 준다 — **PL-1 이 정확히 이 결함을 고쳤지만
       `TodaySignature` 안에서만** 고쳤고, 같은 화면의 이 카드는 안 따라왔다.
       ⚠ 탭 이름도 함께 고쳤다(U009): `학습 항목`·`일과` 는 둘 다 없는 이름이다
       (`shell/tabs.ts` 기준 `과목`·`계획`). */
    const 계획하러 = () => {
      setSchedView('day'); // 보내는 쪽이 뷰를 먼저 세운다(`TodaySignature.goPlanToday` 와 같은 규약).
      navigate(`/schedule?ds=${ds2}`);
    };
    return (
      <div className="ds-rule" id="today-blocks">
        <h2>오늘의 블록</h2>
        <div className="ds-empty">
          {hasItems ? (
            <>
              오늘 배치된 블록이 없어요 — 과목은 있으니 <b>오늘</b>만 비어 있습니다.{' '}
              <Button sm variant="primary" onClick={계획하러}>
                오늘 계획 짜기 →
              </Button>
            </>
          ) : (
            <>
              오늘 배치된 블록이 없어요. <b>과목</b> 탭에서 과목을, <b>계획</b> 탭에서 가용시간을 설정하면 여기에 블록이
              나타납니다.{' '}
              <Button sm variant="primary" onClick={() => navigate('/items')}>
                학습 항목 설정 →
              </Button>
            </>
          )}
        </div>
      </div>
    );
  }

  // 시각 배정(빈 시간 기준) — sid|type → {start,end}. 포맷은 아래 호출부에서 toHM으로.
  const L = layoutDay(state, day!);
  const timeBy = sessionTimeMap(L.sessions);

  const ML = state.moduleLen || 120;

  /* 블록 완료 — 마지막 블록의 축하는 `TodaySignature` 의 allDone 이펙트가 단독 소유한다.
     ⚠ **E15: 중간 진행 토스트를 은퇴시켰다**(`좋아요 — n/m 블록 완료`). 그 토스트가 말하던 사실은
     같은 화면의 진행 링이 이미 갖고 있고, 이제 그 숫자가 `commit` 으로 **스스로 번쩍인다**
     (`useCommitOnChange`). 즉 정보를 지운 것이 아니라 **말하는 자리를 값 옆으로 옮긴** 것이다 —
     화면 구석에서 뜨고 사라지는 문장은 "무엇이" 바뀌었는지를 원리적으로 말하지 못한다.
     ⚠ 되돌리기가 필요한 사건이 아니다(같은 체크박스를 다시 누르면 끝) → 토스트 예산의 두 조건
     ("되돌리기 필요" · "결과가 화면 밖") **둘 다 해당하지 않는다.** */
  const onToggle = (it: ScheduleItem, on: boolean) => {
    toggleDone(ds2, it.sid, it.type, it.min, on);
    /* Q-1 진도 커밋 — 완료를 켜는 순간 **그 행에서** 챕터를 확정할 기회를 연다.
       왜 여기인가: `setDone` 은 `completions` 만 쓰고 **챕터를 안 건드리는데**, 스케줄러의 계획은
       전적으로 `chapters[].done` 에서 나온다. 그래서 계획의 유일한 진짜 입력이 앱에서 가장 비싼
       편집이었다(챕터 표 → `<details>` 펼치기 → Tab 약 150회). 발산 7각도 중 셋이 독립적으로
       이 지점에 도착했다.
       ⚠ W8 인라인 메모와 **같은 패턴**이다: 먼저 커밋(완료는 이미 기록됨) · 정밀도는 나중.
       모달이 아니라 행 안의 한 줄이라 Esc·트랩이 필요 없다 — 안 만지고 떠나도 잃는 것이 없다. */
    setCommitFor(on && it.type === 'new' && it.chapters?.length ? completionKey(it.sid, it.type) : null);
  };

  const blankPass = (sid: string, name: string) => setBlankResult(ds2, sid, name, true, '', '');
  /* ⚠⚠ **순서를 뒤집었다 — 먼저 커밋하고 메모는 나중에(W8 · 2026-07-31).**

     종전엔 `prompt`(포커스 트랩 모달)로 '막힘 메모'를 먼저 받고, 취소하면 `if (note === null)
     return` 이라 **"막혔다"는 사실 자체가 기록되지 않았다.** 즉 모달 하나가 데이터를 먹었다 —
     그리고 그 `prompt` 는 **전 앱 유일한 호출부**였다. 사실은 클릭 한 번으로 확정되고
     (빈 메모 폴백은 이미 코드에 있었다 — 챕터명), 메모는 그 행 아래 인라인 한 줄로 받는다.
     함께 사라짐: `shell/modal` 의 prompt 경로·상태·트랩 1종 통째. */
  const blankBlocked = (it: ScheduleItem) => {
    // 빈 메모여도 CBMS 맥락이 남도록 챕터명으로 폴백(무맥락 '막힘' 방지) — 옛 경로와 같은 규칙.
    const chapter = (it.chapters || []).join(', ');
    setBlankResult(ds2, it.sid, it.name, false, chapter || '구간 미기재', chapter);
    setNoteFor(it.sid); // 인라인 메모 입력을 그 행에 연다(선택 — 안 적어도 기록은 남았다)
    toast('막힘 기록됨 — CBMS(C 개념)로 연결했어요. 구간을 적으면 더 정확해져요.', 'ok');
  };
  /** 인라인 메모 저장 — 이미 커밋된 '막힘' 레코드의 note 만 덮어쓴다. */
  const saveBlankNote = (it: ScheduleItem, note: string) => {
    const chapter = (it.chapters || []).join(', ');
    setBlankResult(ds2, it.sid, it.name, false, note.trim() || chapter || '구간 미기재', chapter);
    setNoteFor(null);
  };
  const clearBlank = (sid: string) => mutate((st) => clearBlankResult(st, ds2, sid));

  return (
    <div className="ds-rule" id="today-blocks">
      <h2>
        오늘의 블록 <span className="ds-tiny text-mut">{fmt(new Date(ds2 + 'T00:00:00'))}</span>
      </h2>
      {/* 70% 룰 안내는 카드 상단에 한 번만(블록마다 반복하면 노이즈). 자세한 단계는 아래 흐름 가이드로. */}
      <div className="ds-foot" style={{ margin: '-2px 0 12px' }}>
        막히면 <b>70% 룰</b> — 10~15분만 씨름하고, 힌트는 한 조각씩. 자세한 흐름은 아래 ‘학습 원칙’에 있어요.
      </div>

      {items.map((it, idx) => {
        const key = completionKey(it.sid, it.type) + '|' + idx;
        const tb = timeBy[completionKey(it.sid, it.type)];
        const tm = tb && tb.start != null && tb.end != null ? toHM(tb.start) + '–' + toHM(tb.end) : '';
        const done = isDone(state, ds2, it.sid, it.type);
        const head = (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="checkbox"
              className="ds-donechk"
              checked={done}
              onChange={(e) => onToggle(it, e.target.checked)}
              title="완료 표시"
              aria-label={`${it.name} 완료`}
            />
            {/* 모의(mock)는 과목이 없어 색을 파생할 수 없다 → 타입 토큰(--bad)으로.
                DayPlanner `.mock`·WeekCalendar `.mock`과 같은 어휘라 세 뷰의 모의 색이 일치한다
                (옛 scheduler의 저장 리터럴 '#b794f6' 제거에 따른 정합 — 절대규칙 3).
                ⚠ 폴백은 **id 해시 파생**이다(H8 · 2026-07-30). 종전 `|| '#6ea8fe'` 는 `colorForId`
                가 원리적으로 만들 수 없는 색이라(OKLCH 고정 L·C 램프 밖) 색이 비는 순간 이 스와치만
                다른 언어로 튄다 — `graph/graphData.ts` 가 같은 이유로 이미 이 형태다(절대규칙 #3). */}
            <span className="ds-swatch" style={{ background: blockColor(it) }} />
            <b className={done ? 'ds-shed' : ''}>{it.name}</b>
            {it.chapters && it.chapters.length > 0 && (
              <span className="ds-tiny text-mut"> · {it.chapters.join(', ')}</span>
            )}
            <span className="ds-tiny ml-auto text-mut">
              {tm ? tm + ' · ' : ''}
              {hLabel(it.min)}
            </span>
          </div>
        );

        if (it.type === 'new') {
          return (
            <div key={key} className="ds-blk">
              {head}
              {/* Q-1 진도 커밋 — 이 블록이 덮은 챕터를 **여기서** 끝냈다고 말한다. 계획의 유일한
                  진짜 입력(`chapters[].done`)이 드디어 그것이 만들어지는 자리에 있다. */}
              {commitFor === completionKey(it.sid, it.type) && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-panel2 px-2.5 py-2 shadow-inset-line2">
                  <span className="ds-tiny text-mut">어디까지 끝냈나요?</span>
                  {(it.chapters || []).map((chName) => {
                    const ch = chapterOf(it.sid, chName);
                    return (
                      <label key={chName} className="flex! cursor-pointer items-center gap-1.25 text-md">
                        <input
                          type="checkbox"
                          checked={!!ch?.done}
                          onChange={(e) => setChapterDone(it.sid, chName, e.target.checked, ds2)}
                        />
                        <span className={ch?.done ? 'ds-shed' : ''}>{chName}</span>
                      </label>
                    );
                  })}
                  <Button sm variant="ghost" className="ml-auto" onClick={() => setCommitFor(null)}>
                    닫기
                  </Button>
                </div>
              )}
              <StageBar ml={ML} />
              {sumFor === it.sid && (
                <InlineSummary sid={it.sid} name={it.name} ds={ds2} onDone={() => setSumFor(null)} />
              )}
              <div className="mt-2.25 flex flex-wrap gap-1.5">
                {/* Q-6 — 요약을 **이 화면에서** 쓴다. 종전엔 이 버튼이 `/journal` 로 이동시켜
                    화면 2개를 강제했다(prefill → navigate). 블록을 막 끝낸 그 순간이 세 문장이
                    가장 잘 나오는 시점인데, 화면을 옮기는 비용이 그 순간을 잡아먹었다.
                    ⚠ 깊은 편집(수정·삭제·과목 바꾸기·CBMS 연계)은 `/journal` 에 그대로 남는다 —
                    여기 있는 것은 **최초 작성 한 번**뿐이다. 흡수가 아니라 입구를 하나 더 낸 것. */}
                <Button sm onClick={() => setSumFor(sumFor === it.sid ? null : it.sid)}>
                  <Icon name="pencil" /> 3문장 요약
                </Button>
                <Button sm onClick={() => prefill('cbms', it.sid)}>
                  ✗ 오답 기록
                </Button>
                <Button sm variant="ghost" onClick={() => prefill('bl', it.sid)}>
                  <Icon name="tag" /> 보충 필요
                </Button>
              </div>
            </div>
          );
        }

        if (it.type === 'blank') {
          const res2 = blankResultFor(state, ds2, it.sid);
          return (
            <div key={key} className="ds-blk">
              {head}
              <div className="ds-tiny mt-1.75 leading-body text-mut">
                <Icon name="pencil" /> 백지 복습 — 아무것도 안 보고 통째로 재구성: 뼈대 마인드맵 → 도식+결론식 → 막힌
                구간 체크.
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {res2 ? (
                  <>
                    {res2.passed ? (
                      <Pill tone="good">
                        <Icon name="check" /> 통과 기록됨
                      </Pill>
                    ) : (
                      <Pill tone="warn">
                        <Icon name="alert" /> 막힘 기록됨{res2.note ? ' · ' + res2.note : ''}{' '}
                        <span className="ds-tiny text-mut">→ CBMS(C) 연결</span>
                      </Pill>
                    )}{' '}
                    {!res2.passed && noteFor !== it.sid && (
                      <Button sm variant="ghost" onClick={() => setNoteFor(it.sid)}>
                        구간 적기
                      </Button>
                    )}
                    <Button sm variant="ghost" onClick={() => clearBlank(it.sid)} title="기록 지우기">
                      기록 지우기
                    </Button>
                    {/* W8 인라인 메모 — 기록은 **이미 남았고** 이건 정밀도만 올린다. 그래서
                        Esc·닫기·트랩이 필요 없다: 안 적고 떠나도 잃는 것이 없다. */}
                    {!res2.passed && noteFor === it.sid && (
                      <BlankNoteField initial={res2.note || ''} onSave={(v) => saveBlankNote(it, v)} />
                    )}
                  </>
                ) : (
                  <>
                    <Button sm onClick={() => blankPass(it.sid, it.name)}>
                      <Icon name="check" /> 통과
                    </Button>
                    <Button sm onClick={() => blankBlocked(it)}>
                      <Icon name="alert" /> 막힘(→CBMS)
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        }

        const note =
          it.type === 'rev'
            ? '간격 복습 — Anki 카드 인출. 막히면 그 구간을 CBMS로 분류.'
            : it.type === 'anki'
              ? '자동 생성 카드 30초 큐레이션 — 쓰레기 버리고 ≤5장, 한두 장은 "왜?/응용"형으로.'
              : it.type === 'mock'
                ? '모의시험 — 타이머 ON · 노트 닫기 · 혼합/누적 · 끝까지 깔끔히. 끝나면 CBMS(+시간부족 T)로 분류.'
                : '';
        // rev·anki 블록은 설명만 있던 액션 데드엔드였다 → Anki(연동 탭) 바로가기로 실행 가능하게.
        const ankiLinked = it.type === 'rev' || it.type === 'anki';
        // PL-3: mock도 설명만 있던 데드엔드였다 → 시험 후 오답·시간부족을 CBMS로 바로 분류(모의→CBMS 회고 루프 폐합).
        const isMock = it.type === 'mock';
        return (
          <div key={key} className="ds-blk">
            {head}
            {note && <div className="ds-tiny mt-1.75 leading-body text-mut">{note}</div>}
            {ankiLinked && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Button sm variant="ghost" onClick={() => navigate('/integrations')}>
                  <Icon name="cards" /> Anki 열기 →
                </Button>
              </div>
            )}
            {isMock && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Button sm onClick={() => prefill('cbms', it.sid)}>
                  ✗ 오답/시간부족 기록 →
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
