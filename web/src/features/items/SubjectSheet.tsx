/* ============================================================
   SubjectSheet — 과목 상세 시트(계획 재개편 v3). 옛 ItemCard 아코디언을 대체한다.
   왜 오버레이인가: 카드가 제자리에서 펼쳐지면 뒤 카드들이 밀려 목록 조망이 깨졌다(과목이 늘수록 악화).
   중앙 시트는 뒤 갤러리를 그대로 둔 채 한 과목만 파고든다 — "탭 프레임보다 작은 새 페이지".

   여기서 한 과목에 대해 **정의(주당 목표·챕터·마감)와 이번 주 배분(요일 분배)을 함께** 결정한다.
   배분은 lib/weekAlloc의 allocView/setAllocCell을 그대로 호출 → 배치 탭의 배분 보드와 같은 데이터의
   두 입구(미러). 흡수가 아니다: 요일 열 합계·전 과목 교차 조망은 보드가 계속 소유하고,
   여기선 그 과목의 '한 행'만 + 요일별 여유 힌트로 최소 맥락을 준다.
============================================================ */
import { useCallback, type CSSProperties } from 'react';
import { useApp } from '@/store/useApp';
import { useSchedule, useStudyMinByWeekday } from '@/store/selectors';
import { allocView, colSumMin, rowSumMin, setAllocCell, isWeekManaged, weekMonOf } from '@/lib/weekAlloc';
import { DOW_MON, addDays, iso, parseISO, todayISO, dayDiff, ddayInfo } from '@/lib/utils';
import { Button, Pill, type PillTone } from '@/components/ui';
import DetailDrawer from '@/components/DetailDrawer';
import ds from '@/styles/ds.module.css';
import c from './SubjectSheet.module.css';
import type { AppState, Item } from '@/lib/types';
import { ChapterEditor } from './ChapterEditor';

type Mutate = (recipe: (st: AppState) => void) => void;

/** +/- 스텝퍼 — 분/시간 직관 입력(0 미만 방지·소수 첫째자리 반올림). 옛 ItemCard에서 승계. */
function Stepper({
  value,
  step,
  unit,
  onChange,
}: {
  value: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  const clamp = (v: number) => Math.max(0, Math.round(v * 10) / 10);
  const bump = (d: number) => onChange(clamp(value + d));
  return (
    <div className={ds.row} style={{ gap: 4, alignItems: 'center', maxWidth: 170 }}>
      <Button sm onClick={() => bump(-step)} aria-label={`${unit} 줄이기`}>
        –
      </Button>
      <input
        type="number"
        step={step}
        min={0}
        value={value}
        onChange={(e) => onChange(clamp(+e.target.value || 0))}
        style={{ textAlign: 'center' }}
      />
      <Button sm onClick={() => bump(step)} aria-label={`${unit} 늘리기`}>
        +
      </Button>
      <span className={`${ds.muted} ${ds.tiny}`}>{unit}</span>
    </div>
  );
}

/** 분 → 시간 표시(정수는 소수 없이). 배분 보드 toH와 같은 규칙. */
function toH(min: number): string {
  const h = min / 60;
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
}

/** 이 과목의 이번 주 요일 분배 — 배분 보드 한 행의 드릴다운 판. */
function AllocRow({ item, mutate }: { item: Item; mutate: Mutate }) {
  const state = useApp((s) => s.state);
  const res = useSchedule();
  const capWd = useStudyMinByWeekday(); // 요일별 가용 학습분 — 보드 열 상한과 같은 출처
  const wk = weekMonOf(todayISO(state));
  const alloc = allocView(state, res, wk);
  const managed = isWeekManaged(state, wk);
  const vec = alloc[item.id];
  const monday = parseISO(wk);
  const todayIso = todayISO(state);

  // 고아 방어 — 삭제된 과목의 잔여 배분이 요일 '여유' 계산을 오염시키지 않게 유효 sid만 센다
  // (정상 경로 청소는 removeSidFromAlloc가 하지만, 이미 오염된 저장본에 대한 표시 단계 방어선).
  const validSids = new Set(state.items.map((it) => it.id));

  const budgetMin = Math.round((item.weeklyHours || 0) * 60);
  const usedMin = rowSumMin(vec);
  const diff = usedMin - budgetMin;
  const rowTone: PillTone = budgetMin === 0 ? 'neutral' : diff === 0 ? 'good' : diff > 0 ? 'bad' : 'warn';
  const rowLabel =
    budgetMin === 0
      ? `${toH(usedMin)}h 배분`
      : diff === 0
        ? `✓ 예산 ${toH(budgetMin)}h 딱 맞음`
        : diff > 0
          ? `초과 +${toH(diff)}h`
          : `부족 ${toH(-diff)}h`;

  const setCell = (wd: number, hours: number) =>
    mutate((st) => setAllocCell(st, res, wk, item.id, wd, Math.max(0, Math.round(hours * 60))));

  // 계획상 챕터를 다 배우게 된 과목엔 배분해도 '새 학습'이 더 안 생긴다(보드와 같은 안내).
  const finished = res.itemStat.find((st) => st.id === item.id)?.finished;

  return (
    <div className={c.alloc}>
      <div className={c.allocHead}>
        <h3 className={c.secTitle}>이번 주 요일 배분</h3>
        <span className={`${c.mode}${managed ? ' ' + c.modeManual : ''}`}>{managed ? '내 배분' : '자동 제안'}</span>
        <Pill tiny tone={rowTone}>
          {rowLabel}
        </Pill>
      </div>

      <div className={c.days}>
        {DOW_MON.map((lab, i) => {
          const date = addDays(monday, i);
          const wd = date.getDay();
          const mine = vec?.[wd] || 0;
          const capMin = capWd[wd] || 0;
          // 그 요일 '남은 여유' = 가용 − (전 과목 배분). 내 칸을 늘릴 여지를 여기서 읽는다(열 맥락 최소 이식).
          const freeMin = capMin - colSumMin(alloc, wd, validSids);
          const over = capMin > 0 && freeMin < 0;
          return (
            <label key={i} className={`${c.day}${iso(date) === todayIso ? ' ' + c.dayToday : ''}`}>
              <span className={c.dayDow}>{lab}</span>
              <input
                type="number"
                className={c.dayInput}
                step={0.5}
                min={0}
                value={mine / 60 || 0}
                onChange={(e) => setCell(wd, +e.target.value || 0)}
                aria-label={`${lab}요일 배분 시간`}
              />
              <span className={`${c.dayFree}${over ? ' ' + c.dayFreeOver : ''}`}>
                {capMin === 0 ? '가용 0' : over ? `초과 ${toH(-freeMin)}h` : `여유 ${toH(freeMin)}h`}
              </span>
            </label>
          );
        })}
      </div>

      {finished && usedMin > 0 && (
        <div className={c.noteInfo}>
          계획상 챕터를 다 배우게 돼 있어 <b>새 학습</b>은 더 안 생겨요 — 복습·Anki만 자동으로 얹혀요.
        </div>
      )}
      <div className={c.allocFoot}>
        요일 칸은 <b>새 학습</b> 분배예요(복습·Anki는 엔진이 자동으로 얹어요). 전 과목을 요일별로 견주려면{' '}
        <b>배치 › 배분 보드</b>에서.
      </div>
    </div>
  );
}

export function SubjectSheet({
  item,
  mutate,
  onClose,
  onDelete,
}: {
  item: Item;
  mutate: Mutate;
  onClose: () => void;
  onDelete: (id: string) => void;
}) {
  const id = item.id;
  // 마감 D-day도 앱 정본 '오늘'에서 — 벽시계 new Date()를 쓰면 `_today` 시드 주입 시 값이 갈렸다.
  const todayIso = useApp((s) => todayISO(s.state));
  const daily = item.mode === 'daily';
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

  return (
    <DetailDrawer open onClose={onClose} title={item.name || '(이름 없음)'} placement="center">
      <div className={c.body} style={item.color ? ({ ['--tint']: item.color } as CSSProperties) : undefined}>
        <span className={c.rail} style={{ background: item.color || 'var(--acc)' }} aria-hidden="true" />

        <div className={ds.fieldgrid}>
          <div className={`${ds.fld} ${ds.wide}`}>
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
          <div className={ds.fld}>
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
          <div className={ds.fld}>
            <label>{daily ? '매일 학습 (분)' : '주당 목표 시간'}</label>
            {daily ? (
              <Stepper
                value={item.dailyMin || 30}
                step={5}
                unit="분"
                onChange={(v) => upd((it) => void (it.dailyMin = v))}
              />
            ) : (
              <Stepper
                value={item.weeklyHours || 3}
                step={0.5}
                unit="h"
                onChange={(v) => upd((it) => void (it.weeklyHours = v))}
              />
            )}
          </div>
          <div className={ds.fld}>
            <label htmlFor={`it-dl-${id}`}>마감일 (선택)</label>
            <input
              id={`it-dl-${id}`}
              type="date"
              value={item.deadline || ''}
              onChange={(e) => upd((it) => void (it.deadline = e.target.value))}
            />
            {item.deadline && (
              <span className={`${ds.tiny} ${ds.muted}`} style={{ marginTop: 4 }}>
                {ddayInfo(dayDiff(todayIso, item.deadline)).lab}
              </span>
            )}
          </div>
        </div>

        {/* 배분은 주간(new) 과목만 — 매일(Anki) 과목은 엔진이 매일 자동으로 얹는다(보드 행에도 없음). */}
        {daily ? (
          <div className={c.noteInfo}>
            <b>매일(Anki)</b> 과목은 요일 배분 없이 매일 자동으로 잡혀요. 요일별로 나눠 넣으려면 유형을 <b>주당 시간</b>
            으로 바꾸세요.
          </div>
        ) : (
          <AllocRow item={item} mutate={mutate} />
        )}

        {/* ChapterEditor가 자체 헤더('📘 챕터 N개 · 약 Nh')를 갖고 있어 제목을 덧대지 않는다(중복). */}
        {!daily && (
          <div className={c.chapters}>
            <ChapterEditor item={item} mutate={mutate} />
          </div>
        )}

        <div className={ds.itemfoot}>
          <span className={`${ds.tiny} ${ds.muted}`}>
            출처 {item.source || '직접'}
            {!daily && chs.length ? ` · ${chs.length}챕터 · 약 ${totalH}h` : ''}
          </span>
          <Button sm variant="ghost" danger onClick={() => onDelete(id)}>
            과목 삭제
          </Button>
        </div>
      </div>
    </DetailDrawer>
  );
}
