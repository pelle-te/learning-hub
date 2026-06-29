/* TodayBlocks — 오늘 배치된 블록 + 블록별 4단계 흐름/방법론 액션.
   파생 스케줄(useSchedule)에서 오늘 Day를 찾고 layoutDay로 시각을 배정해 표시.
   스타일: 공유는 ds.module(card/blk/donechk/swatch/muted/tiny/foot/empty), today 전용은 Today.module(t.*). */
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/useApp';
import { useSchedule } from '@/store/selectors';
import { usePrefill } from '@/store/prefill';
import { ui } from '@/shell';
import { layoutDay } from '@/lib/scheduler';
import { isDone } from '@/lib/persistence';
import { blankResultFor, clearBlankResult } from '@/lib/methodology';
import { iso, toHM, hLabel, fmt } from '@/lib/utils';
import { Button, Pill } from '@/components/ui';
import ds from '@/styles/ds.module.css';
import t from './Today.module.css';
import type { ScheduleItem } from '@/lib/types';
import { BLOCK_STAGES } from './consts';

/** 블록 4단계 비중 막대(분 추정 포함). */
function StageBar({ ml }: { ml: number }) {
  return (
    <div className={t.stagebar}>
      {BLOCK_STAGES.map((st) => {
        const w = st.end - st.start;
        const mins = Math.round((ml * w) / 100);
        return (
          <div
            key={st.name}
            className={t.stg}
            style={{ flex: w }}
            data-tip={`${st.name} (~${mins}분) — ${st.action}`}
            role="img"
            aria-label={`${st.name} (~${mins}분) — ${st.action}`}
          >
            <span className={t.stgNm}>{st.name}</span>
            <span className={t.stgMn}>~{mins}m</span>
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

  const ds2 = iso(new Date());
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

  // 시각 배정(빈 시간 기준) — sid|type → "HH:MM–HH:MM".
  const L = layoutDay(state, day!);
  const timeBy: Record<string, string> = {};
  L.sessions.forEach((s) => {
    const k = s.sid + '|' + s.type;
    if (s.start != null && s.end != null && timeBy[k] == null) timeBy[k] = toHM(s.start) + '–' + toHM(s.end);
  });

  const ML = state.moduleLen || 120;

  const blankPass = (sid: string, name: string) => setBlankResult(ds2, sid, name, true, '', '');
  const blankBlocked = async (it: ScheduleItem) => {
    const note = await ui.prompt('어느 구간에서 막혔나요? (이 메모는 CBMS 개념(C) 오답으로 자동 연결됩니다)', {
      title: '백지 복습 — 막힘 기록',
      placeholder: '예) 파동방정식 유도에서 막힘',
    });
    if (note === null) return; // 취소
    setBlankResult(ds2, it.sid, it.name, false, note.trim(), (it.chapters || []).join(', '));
    ui.toast('막힘 기록됨 — CBMS(C 개념)로 연결했어요.', 'ok');
  };
  const clearBlank = (sid: string) => mutate((st) => clearBlankResult(st, ds2, sid));

  return (
    <div className={ds.card} id="today-blocks">
      <h2>
        오늘의 블록 <span className={`${ds.muted} ${ds.tiny}`}>{fmt(new Date(ds2 + 'T00:00:00'))}</span>
      </h2>
      {/* 70% 룰 안내는 카드 상단에 한 번만(블록마다 반복하면 노이즈). */}
      <div className={ds.foot} style={{ margin: '-2px 0 12px' }}>
        막히면 <b>70% 룰</b> — 씨름 10–15분 → 힌트 한 조각(보고 다시 덮기) → 70%서 멈춰 <i>가정·결과식·의미만</i> +{' '}
        <b>보충 필요</b> 라벨 + 요약은 한다. <span className={ds.muted}>단계별 안내는 아래 ‘학습 원칙·블록 흐름’.</span>
      </div>

      {items.map((it, idx) => {
        const key = it.sid + '|' + it.type + '|' + idx;
        const tm = timeBy[it.sid + '|' + it.type] || '';
        const done = isDone(state, ds2, it.sid, it.type);
        const head = (
          <div className={`${t.blkhead}${done ? ' ' + t.rowdone : ''}`}>
            <input
              type="checkbox"
              className={ds.donechk}
              checked={done}
              onChange={(e) => toggleDone(ds2, it.sid, it.type, it.min, e.target.checked)}
              title="완료 표시"
              aria-label={`${it.name} 완료`}
            />
            <span className={ds.swatch} style={{ background: it.color || '#6ea8fe' }} />
            <b>{it.name}</b>
            {it.chapters && it.chapters.length > 0 && (
              <span className={`${ds.muted} ${ds.tiny}`}> · {it.chapters.join(', ')}</span>
            )}
            <span className={`${t.mn} ${ds.muted} ${ds.tiny}`}>
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
              <div className={t.blkActions}>
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
              <div className={`${t.blkNote} ${ds.tiny} ${ds.muted}`}>
                📝 백지 복습 — 아무것도 안 보고 통째로 재구성: 뼈대 마인드맵 → 도식+결론식 → 막힌 구간 체크.
              </div>
              <div className={t.blkActions} style={{ marginTop: 6 }}>
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
        return (
          <div key={key} className={ds.blk}>
            {head}
            {note && <div className={`${t.blkNote} ${ds.tiny} ${ds.muted}`}>{note}</div>}
          </div>
        );
      })}
    </div>
  );
}
