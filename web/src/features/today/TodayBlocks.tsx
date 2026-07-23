/* TodayBlocks — 오늘 배치된 블록 + 블록별 4단계 흐름/방법론 액션.
   파생 스케줄(useSchedule)에서 오늘 Day를 찾고 layoutDay로 시각을 배정해 표시.
   스타일: 공유는 ds.module(card/blk/donechk/swatch/muted/tiny/foot/empty), today 전용은 Tailwind 유틸(C-7). */
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/useApp';
import { useSchedule } from '@/store/selectors';
import { usePrefill } from '@/store/prefill';
import { ui } from '@/shell';
import { layoutDay, sessionTimeMap } from '@/lib/scheduler';
import { isDone } from '@/lib/persistence';
import { blankResultFor, clearBlankResult } from '@/lib/methodology';
import { toHM, hLabel, fmt, todayISO } from '@/lib/utils';
import { Button, Pill } from '@/components/ui';
import ds from '@/styles/ds.module.css';
import type { ScheduleItem } from '@/lib/types';
import { BLOCK_STAGES } from './consts';

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
            <span className="max-w-full truncate text-xs leading-[1.6] font-semibold">{st.name}</span>
            <span className="text-2xs text-mut tabular-nums">~{mins}m</span>
          </div>
        );
      })}
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
  // '오늘 학습' 블록 → 기록 탭으로 과목 사전선택 + 이동.
  const prefill = (form: 'sum' | 'cbms' | 'bl', sid: string) => {
    requestPrefill(form, sid);
    navigate('/journal');
  };

  const ds2 = todayISO(state); // '오늘' 단일 출처(_today 시드 존중).
  const day = (res.days || []).find((d) => d.ds === ds2);
  const items = day ? day.items : [];

  if (!items.length) {
    return (
      <div className={ds.card} id="today-blocks">
        <h2>오늘의 블록</h2>
        <div className={ds.empty}>
          오늘 배치된 블록이 없어요. <b>학습 항목</b>·<b>일과</b> 탭에서 과목/가용시간을 설정하면 여기에 블록이
          나타납니다.
        </div>
      </div>
    );
  }

  // 시각 배정(빈 시간 기준) — sid|type → {start,end}. 포맷은 아래 호출부에서 toHM으로.
  const L = layoutDay(state, day!);
  const timeBy = sessionTimeMap(L.sessions);

  const ML = state.moduleLen || 120;

  // 블록 완료 순간 작은 보상 — 마지막 블록이면 큰 축하, 아니면 진행을 가볍게 짚어준다(동기 설계).
  const onToggle = (it: ScheduleItem, on: boolean) => {
    toggleDone(ds2, it.sid, it.type, it.min, on);
    if (!on) return;
    // state는 토글 전 스냅샷 → 이 블록을 제외한 완료 수 + 1 = 토글 후 완료 수.
    const doneNow = items.filter((x) => isDone(state, ds2, x.sid, x.type)).length + 1;
    // 마지막 블록의 축하 토스트는 TodaySignature의 allDone 이펙트가 단독 소유(이중 토스트 방지).
    // 여기선 중간 진행만 가볍게 짚는다.
    if (doneNow < items.length) ui.toast(`좋아요 — ${doneNow}/${items.length} 블록 완료`, 'info');
  };

  const blankPass = (sid: string, name: string) => setBlankResult(ds2, sid, name, true, '', '');
  const blankBlocked = async (it: ScheduleItem) => {
    const note = await ui.prompt('어느 구간에서 막혔나요? (이 메모는 CBMS 개념(C) 오답으로 자동 연결됩니다)', {
      title: '백지 복습 — 막힘 기록',
      placeholder: '예) 파동방정식 유도에서 막힘',
    });
    if (note === null) return; // 취소
    // 빈 메모여도 CBMS 맥락이 남도록 챕터명으로 폴백(무맥락 '막힘' 방지).
    const finalNote = note.trim() || (it.chapters || []).join(', ') || '구간 미기재';
    setBlankResult(ds2, it.sid, it.name, false, finalNote, (it.chapters || []).join(', '));
    ui.toast('막힘 기록됨 — CBMS(C 개념)로 연결했어요.', 'ok');
  };
  const clearBlank = (sid: string) => mutate((st) => clearBlankResult(st, ds2, sid));

  return (
    <div className={ds.card} id="today-blocks">
      <h2>
        오늘의 블록 <span className={`${ds.muted} ${ds.tiny}`}>{fmt(new Date(ds2 + 'T00:00:00'))}</span>
      </h2>
      {/* 70% 룰 안내는 카드 상단에 한 번만(블록마다 반복하면 노이즈). 자세한 단계는 아래 흐름 가이드로. */}
      <div className={ds.foot} style={{ margin: '-2px 0 12px' }}>
        막히면 <b>70% 룰</b> — 10~15분만 씨름하고, 힌트는 한 조각씩. 자세한 흐름은 아래 ‘학습 원칙’에 있어요.
      </div>

      {items.map((it, idx) => {
        const key = it.sid + '|' + it.type + '|' + idx;
        const tb = timeBy[it.sid + '|' + it.type];
        const tm = tb && tb.start != null && tb.end != null ? toHM(tb.start) + '–' + toHM(tb.end) : '';
        const done = isDone(state, ds2, it.sid, it.type);
        const head = (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="checkbox"
              className={ds.donechk}
              checked={done}
              onChange={(e) => onToggle(it, e.target.checked)}
              title="완료 표시"
              aria-label={`${it.name} 완료`}
            />
            {/* 모의(mock)는 과목이 없어 색을 파생할 수 없다 → 타입 토큰(--bad)으로.
                DayPlanner `.mock`·WeekCalendar `.mock`과 같은 어휘라 세 뷰의 모의 색이 일치한다
                (옛 scheduler의 저장 리터럴 '#b794f6' 제거에 따른 정합 — 절대규칙 3). */}
            <span
              className={ds.swatch}
              style={{ background: it.type === 'mock' ? 'var(--bad)' : it.color || '#6ea8fe' }}
            />
            <b className={done ? 'line-through opacity-60' : ''}>{it.name}</b>
            {it.chapters && it.chapters.length > 0 && (
              <span className={`${ds.muted} ${ds.tiny}`}> · {it.chapters.join(', ')}</span>
            )}
            <span className={`ml-auto ${ds.muted} ${ds.tiny}`}>
              {tm ? tm + ' · ' : ''}
              {hLabel(it.min)}
            </span>
          </div>
        );

        if (it.type === 'new') {
          return (
            <div key={key} className={ds.blk}>
              {head}
              <StageBar ml={ML} />
              <div className="mt-2.25 flex flex-wrap gap-1.5">
                <Button sm onClick={() => prefill('sum', it.sid)}>
                  ✍ 3문장 요약
                </Button>
                <Button sm onClick={() => prefill('cbms', it.sid)}>
                  ✗ 오답 기록
                </Button>
                <Button sm variant="ghost" onClick={() => prefill('bl', it.sid)}>
                  🏷 보충 필요
                </Button>
              </div>
            </div>
          );
        }

        if (it.type === 'blank') {
          const res2 = blankResultFor(state, ds2, it.sid);
          return (
            <div key={key} className={ds.blk}>
              {head}
              <div className={`mt-1.75 leading-[1.5] ${ds.tiny} ${ds.muted}`}>
                📝 백지 복습 — 아무것도 안 보고 통째로 재구성: 뼈대 마인드맵 → 도식+결론식 → 막힌 구간 체크.
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {res2 ? (
                  <>
                    {res2.passed ? (
                      <Pill tone="good">✅ 통과 기록됨</Pill>
                    ) : (
                      <Pill tone="warn">
                        ⚠ 막힘 기록됨{res2.note ? ' · ' + res2.note : ''}{' '}
                        <span className={`${ds.muted} ${ds.tiny}`}>→ CBMS(C) 연결</span>
                      </Pill>
                    )}{' '}
                    <Button sm variant="ghost" onClick={() => clearBlank(it.sid)} title="기록 지우기">
                      기록 지우기
                    </Button>
                  </>
                ) : (
                  <>
                    <Button sm onClick={() => blankPass(it.sid, it.name)}>
                      ✅ 통과
                    </Button>
                    <Button sm onClick={() => blankBlocked(it)}>
                      ⚠ 막힘(→CBMS)
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        }

        const note =
          it.type === 'rev'
            ? '🔁 간격 복습 — Anki 카드 인출. 막히면 그 구간을 CBMS로 분류.'
            : it.type === 'anki'
              ? '🃏 자동 생성 카드 30초 큐레이션 — 쓰레기 버리고 ≤5장, 한두 장은 "왜?/응용"형으로.'
              : it.type === 'mock'
                ? '🧪 모의시험 — 타이머 ON · 노트 닫기 · 혼합/누적 · 끝까지 깔끔히. 끝나면 CBMS(+시간부족 T)로 분류.'
                : '';
        // rev·anki 블록은 설명만 있던 액션 데드엔드였다 → Anki(연동 탭) 바로가기로 실행 가능하게.
        const ankiLinked = it.type === 'rev' || it.type === 'anki';
        // PL-3: mock도 설명만 있던 데드엔드였다 → 시험 후 오답·시간부족을 CBMS로 바로 분류(모의→CBMS 회고 루프 폐합).
        const isMock = it.type === 'mock';
        return (
          <div key={key} className={ds.blk}>
            {head}
            {note && <div className={`mt-1.75 leading-[1.5] ${ds.tiny} ${ds.muted}`}>{note}</div>}
            {ankiLinked && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Button sm variant="ghost" onClick={() => navigate('/integrations')}>
                  🃏 Anki 열기 →
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
