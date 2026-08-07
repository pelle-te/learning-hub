/* ============================================================
   useWeekOffset.ts — 주(週) 네비게이션 단일 기계(스케줄·배분·리뷰 공용).
   `todayOff` 산식 + `useState(todayOff)` + `useWeekNavKeys` + `weekToday` + 오프셋 배지 삼항이
   탭마다 **글자까지 같은 모양**으로 복제돼 있었다(Schedule·Alloc). 규칙이 바뀌면 세 곳을 같이
   고쳐야 하는 형태라 여기로 모은다.

   내부 상태를 '**오늘 기준 상대 주**(rel)'로 잡은 게 핵심이다. 예전엔 `useState(todayOff)`로
   startDate 기준 절대 오프셋을 담아 초기화만 했기 때문에, 탭이 마운트된 채 startDate(또는 _today)가
   바뀌면 화면은 그대로인데 '이번 주' 기준만 어긋났다(배지가 엉뚱한 +n주). rel은 오늘에 붙어 있어
   startDate가 바뀌어도 자동 리베이스된다 — 이펙트로 되받는 캐스케이드 없이 렌더 순수 파생.
============================================================ */
import { useState } from 'react';
import { addDays, dayDiff, iso, mondayOf, parseISO, todayISO } from '@/lib/utils';
import type { AppState } from '@/lib/types';
import { useWeekNavKeys } from './interactions';

export interface WeekOffsetOpts {
  /** 이동 가능한 상대 주 상한(리뷰는 미래가 빈 보드라 0 = 이번 주까지). 미지정=무한. */
  maxRel?: number;
  /** 이동 가능한 상대 주 하한. 미지정=무한. */
  minRel?: number;
  /**
   * **처음 보여 줄 주의 월요일**(ISO) — N-12 명사 주소(`/week/:ws`)의 입구.
   *
   * ⚠⚠ 이 옵션이 없던 동안 "주"는 **주소를 가질 수 없었다**: 오프셋이 이 훅의 `useState` 라
   * 밖에서 세울 방법이 0 이었고, 그래서 특정 주를 링크로 가리키려면 *"배분 탭을 열고 `.` 를
   * 두 번 누르세요"* 라고 말하는 수밖에 없었다. 명사에 주소를 주려면 그 상태의 소유자에게
   * 초기값 입구를 내야 한다 — 쿼리를 화면에서 읽어 `setWeekOffset` 을 이펙트로 부르는 것은
   * 첫 프레임에 **엉뚱한 주를 그렸다가 튀는** 형태라 답이 아니다.
   * ⚠ **초기값일 뿐이다**(마운트 1회). 그 뒤엔 사용자의 `,`/`.` 가 이긴다 — 주소가 상태를
   *   계속 강제하면 화면 안에서 주를 넘길 수 없다.
   * ⚠ 형식이 아니면 무시한다(0 = 이번 주). URL 은 신뢰하지 않는 입력이다.
   */
  startMon?: string;
}

export interface WeekOffsetNav {
  /** startDate의 주 기준 절대 오프셋 — `addDays(mondayOf(startDate), weekOffset*7)` 계약을 쓰는 기존 코드용. */
  weekOffset: number;
  /** 오늘의 주 기준 상대 오프셋(0=이번 주). 배지·클램프의 기준. */
  rel: number;
  /** 절대 오프셋으로 이동(기존 setWeekOffset 자리 그대로). 함수형 업데이터는 prev/next를 쓴다. */
  setWeekOffset: (n: number) => void;
  prev: () => void;
  next: () => void;
  weekToday: () => void;
  isThisWeek: boolean;
  /** '이번 주' / '+2주' / '-1주'. */
  offsetLabel: string;
  /** 현재 주의 월요일. */
  curMon: Date;
  /** 현재 주의 월요일 ISO(weekAlloc 키). */
  weekMon: string;
}

/** 주 네비 상태 + `,`/`.` 단축키 + 라벨. state는 인자로 받는다(hooks는 store를 import할 수 없다 · 레이어 규약). */
export function useWeekOffset(state: AppState, opts: WeekOffsetOpts = {}): WeekOffsetNav {
  /* ⚠ 지연 초기화다 — 인자로 주면 매 렌더 `parseISO` 를 돌리고도 **첫 값만** 쓰인다.
     `state` 를 여기서 읽는 것은 안전하다: 초기화는 마운트 1회이고 `todayISO(state)` 는 순수다. */
  const [rel0, setRel] = useState(() => relOfMon(state, opts.startMon));
  const rel = clampRel(rel0, opts);

  const todayMon = mondayOf(parseISO(todayISO(state)));
  // startDate가 비었거나 깨졌으면 dayDiff가 NaN → 절대 오프셋만 0으로 접는다(상대 주 네비는 그대로 동작).
  const rawOff = Math.round(dayDiff(iso(mondayOf(parseISO(state.startDate))), iso(todayMon)) / 7);
  const todayOff = Number.isFinite(rawOff) ? rawOff : 0;

  const go = (nextRel: number) => setRel(clampRel(nextRel, opts));
  const prev = () => setRel((r) => clampRel(clampRel(r, opts) - 1, opts));
  const next = () => setRel((r) => clampRel(clampRel(r, opts) + 1, opts));
  useWeekNavKeys(prev, next);

  const curMon = addDays(todayMon, rel * 7);
  return {
    weekOffset: todayOff + rel,
    rel,
    setWeekOffset: (n) => go(n - todayOff),
    prev,
    next,
    weekToday: () => go(0),
    isThisWeek: rel === 0,
    offsetLabel: rel === 0 ? '이번 주' : rel > 0 ? `+${rel}주` : `${rel}주`,
    curMon,
    weekMon: iso(curMon),
  };
}

/** 월요일 ISO → 오늘 기준 상대 주. 형식이 아니거나 없으면 0(이번 주) — URL 은 신뢰하지 않는다. */
function relOfMon(state: AppState, mon?: string): number {
  if (!mon || !/^\d{4}-\d{2}-\d{2}$/.test(mon)) return 0;
  const todayMon = mondayOf(parseISO(todayISO(state)));
  // ⚠ 월요일이 아닌 날짜를 줘도 그 주의 월요일로 접는다(주는 하루가 아니라 구간이다).
  const d = Math.round(dayDiff(iso(todayMon), iso(mondayOf(parseISO(mon)))) / 7);
  return Number.isFinite(d) ? d : 0;
}

function clampRel(r: number, opts: WeekOffsetOpts): number {
  let v = r;
  if (opts.maxRel != null) v = Math.min(opts.maxRel, v);
  if (opts.minRel != null) v = Math.max(opts.minRel, v);
  return v;
}
