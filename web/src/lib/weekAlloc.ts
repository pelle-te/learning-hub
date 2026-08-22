/* ============================================================
   weekAlloc.ts — 주간 배분(재개편 v2 §12) 순수 CRUD.
   모델: weekAlloc[weekMon][sid] = number[7](분, index=wd 0=일..6=토). '이번 주 어느 과목을 어느 요일에 얼마씩'.
   dayPlans 패턴을 주(週) 층으로 일반화 — 무배분 주는 자동(불변), 첫 편집 시 자동 파생 스냅샷을 managed로 승격.
   스케줄러 입력은 아니고(스케줄러는 state.weekAlloc를 직접 읽음 · §12-4), 여긴 보드/스토어가 쓰는 편집 헬퍼.
   ⚠ state 변형 함수(ensure/set/copy/reset)는 store.mutate(immer draft) 안에서만 호출한다.
============================================================ */
import { keySid } from './domainKeys';
import { addDays, dayDiff, iso, mondayOf, parseISO } from './utils';
import { completionMin } from './persistence';
import type { AppState, Item, ScheduleResult } from './types';

/** 7요일 0벡터(분) — index=wd(0=일..6=토). */
export function zeroVec(): number[] {
  return [0, 0, 0, 0, 0, 0, 0];
}

/** 방치 배지(ID-7) 임계 — 이 일수 이상 손 안 댄 과목에 '방치' 신호. */
export const NEGLECT_DAYS = 7;

/** 과목별 '마지막 완료(손 댄) 날 → 오늘로부터 경과일'(ID-7). 완료(done) 세션만 — 계획만 있고
 *  안 한 건 '손 댐'이 아니다. 예산 상태(배분량 vs 예산)와 **직교한 최근성** 신호라, 배분 보드에서
 *  "이번 주 배분했지만 며칠째 실제로는 안 함"이라는 계획↔실행 괴리를 드러낸다. 완료 이력 없는
 *  과목은 키 없음(신규 과목을 '방치'로 몰아세우지 않는다 — 기준 날짜가 없다). */
export function neglectDaysBySid(state: AppState, todayIso: string): Record<string, number> {
  const comp = state.completions || {};
  const lastDs: Record<string, string> = {};
  for (const ds of Object.keys(comp)) {
    if (ds > todayIso) continue; // 미래 완료 무시
    for (const k of Object.keys(comp[ds] || {})) {
      if (!comp[ds]![k]?.done) continue;
      const sid = keySid(k);
      if (!sid) continue;
      if (!lastDs[sid] || ds > lastDs[sid]!) lastDs[sid] = ds;
    }
  }
  const out: Record<string, number> = {};
  for (const sid of Object.keys(lastDs)) out[sid] = dayDiff(lastDs[sid]!, todayIso);
  return out;
}

/** 그 날짜(또는 주 아무 날)가 속한 주의 월요일(ISO) = weekAlloc 키. */
export function weekMonOf(ds: string): string {
  return iso(mondayOf(parseISO(ds)));
}

/** 스케줄 산출에서 그 주의 new 블록 분을 (sid → 7요일[분])으로 집계 = 자동 분배 스냅샷.
 *  managed 승격 전 보드가 보여줄 시작점이자, ensureWeekAlloc가 심는 값. */
export function deriveAutoAlloc(res: ScheduleResult, wk: string): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const d of res.days) {
    if (weekMonOf(d.ds) !== wk) continue;
    for (const it of d.items) {
      if (it.type !== 'new') continue;
      const vec = (out[it.sid] ||= zeroVec());
      vec[d.wd] = (vec[d.wd] || 0) + it.min;
    }
  }
  return out;
}

/** 그 주가 managed(사용자 배분 확정)인가 — **배분 계약의 단일 술어**.
 *  ⚠ `weekAlloc[wk] = {}`(과목 키가 하나도 없는 빈 주 객체)는 **managed가 아니다**.
 *  왜: 빈 객체도 truthy라 예전 `!!state.weekAlloc?.[wk]`는 스케줄러(§12-4 managed 분기)에서
 *  "전 과목 0분 배분"으로 해석돼 그 주 new 블록이 통째로 사라졌다(무음 전멸 — 배지는 '내 배분',
 *  토스트는 '복사했어요'로 성공 신호만 떴다). 스케줄러·보드·시트가 **이 함수 하나로** 같은 판정을 쓴다.
 *  단, 과목 키가 있고 값이 전부 0인 주(사용자가 의도적으로 비운 '쉬는 주')는 managed로 존중한다 —
 *  키 유무가 '사용자가 이 주를 손댔다'의 신호이고, 합 0을 auto로 되돌리면 의도를 뒤집는다. */
export function isWeekManaged(state: AppState, wk: string): boolean {
  const map = state.weekAlloc?.[wk];
  return !!map && Object.keys(map).length > 0;
}

/** 그 주 표시용 배분(읽기 전용) — managed면 명시값, 아니면 자동 파생 스냅샷.
 *  판정은 isWeekManaged 하나로 — 빈 주 객체를 '명시값'으로 보면 보드는 텅 비고 엔진은 auto로 도는 괴리가 난다. */
export function allocView(state: AppState, res: ScheduleResult, wk: string): Record<string, number[]> {
  const map = state.weekAlloc?.[wk];
  return isWeekManaged(state, wk) ? map! : deriveAutoAlloc(res, wk);
}

/** managed 승격 — 없으면(또는 빈 주 객체면) 자동 파생을 스냅샷해 weekAlloc[wk]에 심고 반환(dayPlans ensureManual 동형). state 변형. */
export function ensureWeekAlloc(state: AppState, res: ScheduleResult, wk: string): Record<string, number[]> {
  state.weekAlloc = state.weekAlloc || {};
  if (!isWeekManaged(state, wk)) state.weekAlloc[wk] = deriveAutoAlloc(res, wk);
  return state.weekAlloc[wk]!;
}

/** 셀 배분 설정(분) — 승격 후 (sid,wd) 칸을 mins로(음수는 0). state 변형. */
export function setAllocCell(
  state: AppState,
  res: ScheduleResult,
  wk: string,
  sid: string,
  wd: number,
  mins: number,
): void {
  if (wd < 0 || wd > 6) return;
  const map = ensureWeekAlloc(state, res, wk);
  const vec = (map[sid] ||= zeroVec());
  vec[wd] = Math.max(0, Math.round(mins));
}

/* ── I053 「전공 밖」 레인 — **승격 없이 쓰는 칸**(2026-08-22 발상 축) ─────────────────────
   이 셋이 위 `setAllocCell` 과 대칭인데 **`ensureWeekAlloc` 을 안 지난다**. 그것이 요점이다:
   전공 밖 시간을 `weekAlloc` 의 합성 sid 로 두면 칸 하나를 채우는 순간 그 주가 managed 로
   승격돼 배치 전체가 자동에서 수동으로 바뀐다(2026-08-22 착수 전 확인). 저장 자리와 그 근거는
   `schema.ts` 의 `outsideAlloc` 절.
   ⚠ **스케줄러는 이 값을 안 읽는다.** 하는 일은 배분판의 **분모를 정직하게** 만드는 것뿐이고,
     그게 부모 규약의 «교양축과 계약 0»을 지키면서 이 축을 말하는 유일한 형태다. */

/** 그 주의 전공 밖 분(7요일). 없으면 0벡터 — **사본을 준다**(호출부의 제자리 변형 차단). */
export function outsideVec(state: Pick<AppState, 'outsideAlloc'>, wk: string): number[] {
  const v = state.outsideAlloc?.[wk];
  return v && v.length === 7 ? v.slice(0, 7) : zeroVec();
}

/** 전공 밖 칸 설정(분). `weekAlloc` 을 건드리지 않는다(위 ⚠). state 변형. */
export function setOutsideCell(state: AppState, wk: string, wd: number, mins: number): void {
  if (wd < 0 || wd > 6) return;
  state.outsideAlloc = state.outsideAlloc || {};
  const vec = (state.outsideAlloc[wk] ||= zeroVec());
  vec[wd] = Math.max(0, Math.round(mins));
  /* ⚠ 전부 0이면 **키를 지운다** — 안 지우면 «손댔다»의 흔적이 영원히 남아 백업·동기화가
     빈 주를 계속 나른다(`copyPrevWeekAlloc` 이 빈 managed 주를 안 만드는 것과 같은 규율). */
  if (vec.every((m) => !m)) delete state.outsideAlloc[wk];
}

/** 이전 주 배분(명시 or 자동)을 이 주로 스냅샷 복사 — per-week지만 되풀이 편의(§12-2). state 변형.
 *  @returns 복사한 과목 수(0 = **아무것도 쓰지 않음**). 호출부는 0이면 실패 신호를 줘야 한다.
 *  왜 no-op 경로가 필요한가: 계획 **첫 주**에서 누르면 이전 주는 지평 밖이라 allocView가 `{}`를 준다.
 *  예전엔 그 `{}`를 그대로 써서 그 주를 '빈 managed'로 만들었고 → 스케줄러가 전 과목 0분으로 돌아
 *  그 주 new 블록이 조용히 사라졌다. 복사할 게 없으면 **기존 상태를 손대지 않는다**. */
export function copyPrevWeekAlloc(state: AppState, res: ScheduleResult, wk: string): number {
  const prev = iso(addDays(parseISO(wk), -7)); // wk=월요일 → -7일 = 지난 주 월요일
  const src = allocView(state, res, prev);
  const copy: Record<string, number[]> = {};
  for (const sid in src) copy[sid] = (src[sid] || zeroVec()).slice(0, 7);
  const n = Object.keys(copy).length;
  if (n === 0) return 0; // 소스가 비었다 → 쓰지 않는다(빈 managed 주 생성 금지).
  state.weekAlloc = state.weekAlloc || {};
  state.weekAlloc[wk] = copy;
  return n;
}

/** 두 배분 스냅샷 사이에서 **값이 실제로 달라진 칸**의 키(`${sid}:${wd}`)를 행·요일 순서로.
 *  보드 툴바 액션('지난 주 복사'·'자동으로')의 결과를 그 칸들만 훑어 보여주는 데 쓴다(UX-A4).
 *  ⚠ `sids` 는 **보이는 과목**만 넘긴다 — 삭제된 과목의 고아 배분이 바뀌어도 가리킬 칸이 화면에
 *    없다(colSumMin 의 validSids 방어선과 같은 이유).
 *  왜 액션별 반환 확장이 아니라 전후 비교인가: 두 액션이 같은 답을 필요로 하는데 lib 쪽 반환을
 *  액션마다 넓히면 그만큼 계약이 갈린다. 비교는 순수하고, 한 함수가 두 경로를 덮는다. */
export function changedAllocCells(
  before: Record<string, number[]>,
  after: Record<string, number[]>,
  sids: readonly string[],
): string[] {
  const keys: string[] = [];
  for (const sid of sids) {
    const b = before[sid] || zeroVec();
    const a = after[sid] || zeroVec();
    for (let wd = 0; wd < 7; wd++) if ((b[wd] || 0) !== (a[wd] || 0)) keys.push(`${sid}:${wd}`);
  }
  return keys;
}

/** 그 주를 자동으로 되돌리기 — weekAlloc[wk] 삭제(auto 복귀). state 변형. */
export function resetWeekAlloc(state: AppState, wk: string): void {
  if (state.weekAlloc) delete state.weekAlloc[wk];
}

/** 과목 행 합(분) — 그 과목 주간 배분 총합. */
export function rowSumMin(vec: number[] | undefined): number {
  return (vec || []).reduce((t, m) => t + (m || 0), 0);
}

/** 요일 열 합(분) — 그 wd의 전 과목 배분 합.
 *  validSids를 주면 **그 집합에 있는 sid만** 센다 — 삭제된 과목의 고아 배분이 열 합·초과 경고를
 *  부풀리는 것을 호출부에서 방어할 수 있게(옵셔널이라 기존 호출부는 무변경). 정상 경로의 청소는
 *  pruneAlloc/removeSidFromAlloc가 담당하고, 이건 이미 오염된 저장본에 대한 표시 단계 방어선이다. */
export function colSumMin(map: Record<string, number[]>, wd: number, validSids?: ReadonlySet<string>): number {
  let t = 0;
  for (const sid in map) {
    if (validSids && !validSids.has(sid)) continue;
    t += map[sid]?.[wd] || 0;
  }
  return t;
}

/* ── 고아 배분 청소 ──────────────────────────────────────────────────────
   과목을 지워도 weekAlloc[wk][sid]는 전 주에 남는다(참조 무결성 없는 맵). 그 잔재는
   colSumMin(열 합)·가용 초과 경고를 부풀려 "보이는 행 합 1h인데 푸터는 4h" 같은 유령을 만든다.
   삭제 경로에서 removeSidFromAlloc를, 부팅/복구 같은 일괄 지점에선 pruneAlloc를 부른다. */

/** 한 과목의 배분을 전 주에서 제거 — 과목 삭제 경로 전용. 빈 주 객체는 키째 지운다(auto 복귀).
 *  @returns 실제로 지운 (주, 과목) 쌍 수. state 변형. */
export function removeSidFromAlloc(state: AppState, sid: string): number {
  const all = state.weekAlloc;
  if (!all) return 0;
  let n = 0;
  for (const wk in all) {
    const map = all[wk];
    if (!map || !(sid in map)) continue;
    delete map[sid];
    n++;
    if (Object.keys(map).length === 0) delete all[wk]; // 빈 주는 managed가 아니다 → 키 자체를 정리.
  }
  return n;
}

/** 유효 sid 집합에 없는 모든 배분을 제거(일괄 청소·복구용). @returns 지운 (주, 과목) 쌍 수. state 변형. */
export function pruneAlloc(state: AppState, validSids: Iterable<string>): number {
  const keep = validSids instanceof Set ? (validSids as Set<string>) : new Set(validSids);
  const all = state.weekAlloc;
  if (!all) return 0;
  let n = 0;
  for (const wk in all) {
    const map = all[wk];
    if (!map) continue;
    for (const sid in map) {
      if (keep.has(sid)) continue;
      delete map[sid];
      n++;
    }
    if (Object.keys(map).length === 0) delete all[wk];
  }
  return n;
}

/* ── 배분 대상 과목·집계 단일화 ───────────────────────────────────────────
   `it.name && it.mode !== 'daily'` 파생이 Alloc·AllocBoard 3곳에 복붙돼 있었고, 리드아웃의
   분자(배분 합)와 분모(예산 합)가 각자 필터를 굴려 집합이 어긋날 수 있었다(주당 0h 과목이
   분자엔 들어가고 분모엔 안 들어가 "4.0 / 2.0h · 200%"). 술어와 집계를 여기 한 곳에 둔다. */

/** 배분 보드에 행으로 서는 과목(=주간 과목). daily(Anki)와 이름 없는 자리표시자는 제외. */
export function weeklyItems(state: AppState): Item[] {
  return (state.items || []).filter((it) => it.name && it.mode !== 'daily');
}

/** 배분해도 엔진이 **새 학습(new) 블록을 만들지 않는** 과목인가 — 주당 목표시간이 0/미입력.
 *  scheduler의 weeklyRaw 필터(`mode!=='daily' && weeklyHours>0`)와 같은 판정이다. 보드는 이걸로
 *  "배분해도 안 굴러가요" 배지를 띄우고, 아래 집계들은 이 과목을 분자·분모 **양쪽에서 함께** 뺀다. */
export function isUnschedulable(it: Item): boolean {
  return it.mode !== 'daily' && +(it.weeklyHours || 0) <= 0;
}

/** 이번 주 예산 합(분) = 스케줄 가능한 주간 과목들의 weeklyHours 합. 리드아웃 분모. */
export function weekBudgetMin(state: AppState): number {
  return weeklyItems(state).reduce(
    (t, it) => (isUnschedulable(it) ? t : t + Math.round((it.weeklyHours || 0) * 60)),
    0,
  );
}

/**
 * 이번 주 **필요 시간**(분) = 매일 과목(dailyMin×7) + 주간 과목(weeklyHours). "가용시간이 이걸
 * 담을 수 있나"를 묻는 쪽의 분자다(H11 · 2026-07-26 감사).
 *
 * ⚠ `weekBudgetMin` 과 **다른 질문이고, 그래서 값이 다르다.** 저기는 *배분 보드가 나눠 담을 수
 * 있는 양*(매일 과목은 엔진이 따로 굴리므로 제외)이고, 여기는 *일주일에 실제로 필요한 총량*이다.
 * 감사가 잡은 결함은 값이 다른 것 자체가 아니라 **두 값이 각각 두 곳에 인라인으로 복제**돼
 * 있었다는 점이다(`AvailRail`·`Items` 가 각자 계산 → 한 화면에서 15.0h 와 18.5h 가 동시에 뜬다).
 * 정의를 하나로 모으고, 이름으로 무엇을 묻는지 구분한다.
 */
export function weekRequiredMin(state: AppState): number {
  return (state.items || []).reduce((t, it) => {
    if (!it.name) return t;
    return t + (it.mode === 'daily' ? (it.dailyMin || 0) * 7 : Math.round((it.weeklyHours || 0) * 60));
  }, 0);
}

/** 그 주 배분 합(분) — 분모(weekBudgetMin)와 **같은 과목 집합**을 순회한다(비율 오염 방지). 리드아웃 분자. */
export function weekAllocTotalMin(state: AppState, res: ScheduleResult, wk: string): number {
  const map = allocView(state, res, wk);
  return weeklyItems(state).reduce((t, it) => (isUnschedulable(it) ? t : t + rowSumMin(map[it.id])), 0);
}

/**
 * 그 주에 **실제로 해낸 새 학습 분**(월~일 7일 합).
 *
 * 왜 필요한가: 배분 보드는 "이번 주 얼마를 배분했나"만 말하고 "지난주엔 그 배분이 얼마나
 * 지켜졌나"를 말하지 않았다 — **다음 주 숫자를 정하는 바로 그 자리에서 유일하게 없는 근거**다.
 *
 * ⚠ **`new` 타입만 센다.** 배분(`weekAlloc`)이 구동하는 것은 새 학습 블록이고, `completions` 는
 * 복습·백지·Anki·모의까지 전 타입의 합이다. 좁히지 않으면 "배분 10h / 실제 14h" 같은 **비교
 * 불가능한 대조**가 나오고, 그건 근거가 아니라 소음이다(이 항목이 Later 로 내려갔던 사유가
 * 정확히 그 의미 어긋남이었다 — 좁힌 첫 조각만 취한다).
 * ⚠ 분은 `completionMin` 이 소유한다(실측 있으면 실측, 없으면 계획 · G-1). 폴백 규칙을 여기서
 * 다시 쓰면 회고가 두 가지 답을 갖게 된다.
 */
export function weekDoneNewMin(state: AppState, wk: string): number {
  let total = 0;
  for (let i = 0; i < 7; i++) {
    const day = state.completions?.[iso(addDays(parseISO(wk), i))];
    if (!day) continue;
    for (const [key, entry] of Object.entries(day)) {
      if (!key.endsWith('|new')) continue;
      if (entry?.done) total += completionMin(entry);
    }
  }
  return total;
}

/* ── E-4 레버의 SSOT (Q-19 · 2026-08-02) ──────────────────────────────────────
   `Review.tsx` 의 `useWeeklyAllot` 이 반올림까지 포함한 이 계산을 갖고 있었는데, 그건 React 훅
   이라 **화면 안에서만** 부를 수 있었다. ⌘K 가 같은 동사를 갖게 되면서(팔레트는 훅이 아니다)
   같은 식이 두 벌 될 참이었고, 그 파일 자신이 이미 그 위험을 적어 뒀다(_"CoachCard·WorkbenchCard가
   바이트 동일 복붙하던 것 … 반올림 로직 드리프트=실버그 위험"_). 그래서 **식을 여기로 내린다** —
   훅은 이 함수를 부르는 껍데기가 되고, 팔레트도 같은 것을 부른다.

   ⚠ 반올림이 계산의 일부다: `weeklyHours` 는 0.5 단위로 편집되는데 부동소수 누적이 `2.9999…`
   를 만들면 화면에 그대로 샌다. `Number.EPSILON` 보정 후 소수 1자리 — **옮기면서 바꾸지 않았다.**
   ⚠ 하한이 0 인 것도 계약이다. 0 은 "안 함"이 아니라 **이번 주 스케줄 제외**라는 뜻이고
   (`isUnschedulable` 이 그렇게 읽는다), 음수는 그 어휘에 없다. */
export function bumpWeeklyHours(cur: number | undefined, delta: number): number {
  return Math.max(0, Math.round((+(cur || 0) + delta + Number.EPSILON) * 10) / 10);
}

/* ⚠⚠ **레버의 진짜 SSOT 는 산술이 아니라 이 recipe 다**(2026-08-20 리뷰 M-9).

   위 함수를 내리고도 *"과목을 찾아서 그 필드에 쓴다"* 는 부분이 **세 층에 그대로 남아** 있었다
   (`features/review/Review.tsx` 의 훅 · `shell/actions.ts` 의 팔레트 동사 · `app/CommandPalette.tsx`
   의 계획 명령). 셋 다 `mutate(st => { const t = st.items.find(x => x.id === id); … })` 로 문자
   그대로 같았고, 그래서 이 파일과 `Review.tsx` 가 각각 *"팔레트도 같은 것을 부른다"* ·
   *"E-4 레버 SSOT"* 라 적은 문장이 둘 다 사실이 아니었다.

   그리고 네 번째 변종이 이미 계약을 어기고 있었다 — `planVerbs` 의 "이번 주 쉼"이 `setWeekly(0)`
   으로 `bumpWeeklyHours` 를 통째로 건너뛰어, 위 ⚠ 의 *"하한이 0 인 것도 계약이다"* 가 한
   호출부에서만 강제됐다. `{ set }` 가지를 여기 두면 그 어휘가 한 곳으로 돌아온다.

   ⚠ `mode === 'daily'` 가드도 여기가 자리다 — 세 호출부 중 그걸 가진 것은 훅 하나뿐이었다
   (`leverFor`). 레버가 없는 과목에 레버를 거는 것은 어느 입구에서든 틀렸다.

   ⚠ 이 저장소의 관용구를 따른다: 순수 recipe 를 `mutate(s => …)` 안에서 부른다
   (`addBacklog`·`setWeeklyCheck` 와 같은 형태). 스토어를 모르므로 전량 유닛 테스트가 붙는다. */
export function applyWeeklyHours(s: AppState, sid: string, op: { delta: number } | { set: number }): number | null {
  const it = (s.items || []).find((x) => x.id === sid);
  if (!it || it.mode === 'daily') return null;
  it.weeklyHours = 'set' in op ? Math.max(0, op.set) : bumpWeeklyHours(it.weeklyHours, op.delta);
  return it.weeklyHours;
}
