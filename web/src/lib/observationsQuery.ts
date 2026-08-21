/* ============================================================
   observationsQuery.ts — **관측이 결정을 바꾸는 자리**(I031 · 2026-08-22 발상 축).

   ## 원장은 넷인데, 읽는 곳이 「살아 있음을 보여 주는 화면」뿐이었다

   이 앱은 `route_visits`·`route_hops`·`day_signals`·`idle_spells` 넷을 쌓는다. 각 원장의
   머리주석은 **자기가 막고 있던 결정**을 정확히 적어 뒀다(탭 은퇴 · 두 페인 · 조명 상수성 ·
   저녁 시제 · 재수신성 트리거 · 폰 뷰 사용). 그런데 실측하면 그 값을 읽는 곳은 설정의
   리드아웃 하나뿐이고 — **행동을 바꾸는 곳이 0**이다. 즉 «관측이 쌓이면 판정한다»가
   판정하는 쪽 없이 몇 달째 돌고 있었다.

   여기서 하는 일은 한 가지다: **질문마다 「지금 답할 수 있는가」를 말한다.**

   ## ⚠⚠ 답을 여기서 내지 않는다 — 답할 수 있는지만 말한다

   판정(«이 탭을 지운다»)은 사람의 일이고, 그 판단에 필요한 것은 수가 아니라 **그 수를 믿어도
   되는가**다. 이 저장소는 그 구분에서 이미 한 번 물렸다: `tabs.ts` 의 은퇴 규칙이 분자만 보고
   *"미만이면 삭제"* 라 적었고, 실측 `route_visits` 는 **2행 · 키 1개 · 날짜 1일**이었다 —
   그 0 은 «안 쓴다»가 아니라 «앱이 두 번 열렸을 뿐»이었다.

   ⚠ **문턱을 여기서 새로 짓지 않는다.** 각 질문의 문턱은 그 원장이 이미 소유한다
   (`visits.SAMPLE_MIN` · `idleLedger.idleVerdict`). 사본을 두면 화면이 말하는 충족과 규칙이
   쓰는 충족이 갈리고, 그건 조용하다.
   ⚠ 브라우저(dev·트랙 A)에선 원장이 통째로 없다 — 그때는 «못 쟀다» 이고 «부족하다»가 아니다.
     둘을 같은 문장으로 접으면 이 파일이 막으려는 그 혼동을 스스로 저지른다.
============================================================ */
import { hasSample, hourHistogram, roundTrips, visitSample, SAMPLE_MIN } from './visits';
import { idleSample, idleSummary, idleVerdict } from './idleLedger';
import { isDbAvailable } from './db/sqlite';
import { todayISO } from './utils';

/** 관측이 막고 있던 결정들. 각 항목의 근거는 그 원장의 머리주석이 소유한다. */
export type ObsQuestion =
  /** 이 탭을 지워도 되는가(`tabs.ts` 은퇴 규칙 ①단계와 **같은 문턱**). */
  | 'tab-retire'
  /** 두 페인을 만들 이유가 있는가 — `A→B→A` 왕복이 실재하나. */
  | 'two-pane'
  /** 하루의 국면을 화면에 실을 이유가 있는가 — 여는 시각이 흩어져 있나. */
  | 'day-phase'
  /** 재수신성 트리거를 만들 이유가 있는가 — 자리를 비우는 구간이 실재하나. */
  | 'idle-trigger';

export interface ObsAnswer {
  /** 판정해도 되는가. `false` 면 **그 수로 결정하지 마라**. */
  ready: boolean;
  /** 왜 그렇게 판정했나 — 화면이 이 문장을 그대로 쓴다(판정 문장을 화면이 조립하지 않는다). */
  why: string;
  /** 관측이 아예 없는가(브라우저·첫 실행). `ready:false` 와 **다른 상태**다. */
  unavailable: boolean;
}

const 못잼 = (what: string): ObsAnswer => ({
  ready: false,
  unavailable: true,
  why: `${what} 원장을 읽을 수 없어요 — 이 환경엔 관측이 없습니다(부족한 것이 아닙니다).`,
});

/**
 * 이 질문을 지금 답해도 되는가.
 *
 * ⚠ 각 갈래가 **자기 원장만** 본다. 하나로 합친 «전체 표본» 같은 수를 만들지 않는 이유:
 * 질문마다 필요한 관측이 다르고(방문 수 ↔ 왕복쌍 ↔ 시각 분포 ↔ 부재 구간), 합치면 한쪽이
 * 충분하다는 이유로 다른 쪽을 판정하게 된다.
 */
export async function observationsReady(q: ObsQuestion, todayDs: string = todayISO()): Promise<ObsAnswer> {
  if (!(await isDbAvailable())) return 못잼('관측');
  if (q === 'tab-retire') {
    const s = await visitSample(14, todayDs);
    if (!s.days && !s.total) return 못잼('방문');
    return hasSample(s)
      ? { ready: true, unavailable: false, why: `관측 ${s.days}일 · ${s.total}회 — 탭 은퇴를 판정할 수 있어요.` }
      : {
          ready: false,
          unavailable: false,
          why: `관측 ${s.days}일 · ${s.total}회 — 기준(${SAMPLE_MIN.days}일 · ${SAMPLE_MIN.total}회) 미달이에요. 이 수치로 탭을 지우지 마세요.`,
        };
  }
  if (q === 'two-pane') {
    const t = await roundTrips(14, todayDs);
    /* ⚠ 왕복쌍이 0인 것은 **답이 나온 것**이다(«두 페인은 만들 이유가 없다»). 미달이 아니다 —
       그 구분이 이 질문의 전부다: 여기서 «부족»이라 말하면 영원히 답이 안 난다. */
    return {
      ready: true,
      unavailable: false,
      why: t.length
        ? `왕복쌍 ${t.length}종(최다 ${t[0]!.a}↔${t[0]!.b} ${t[0]!.n}회) — 두 페인이 덜 마찰을 실제로 갖고 있어요.`
        : '양방향 왕복이 한 쌍도 없어요 — 두 페인은 만들 이유가 없습니다(이것이 답이지 표본 부족이 아닙니다).',
    };
  }
  if (q === 'day-phase') {
    const h = await hourHistogram(14, todayDs);
    const total = h.reduce((t, n) => t + n, 0);
    if (!total) return 못잼('시각');
    const used = h.filter((n) => n > 0).length;
    /* ⚠ 문턱이 «몇 시간대에 흩어졌나» 인 이유: 이 질문은 «앱이 하루의 어디쯤에 있나»를 화면에
       실을 값이 있는가이고, 한 시각에 몰려 있으면 그 값은 **상수**라 실을 것이 없다. */
    return used >= 3
      ? { ready: true, unavailable: false, why: `${used}개 시간대에 걸쳐 열려요 — 하루의 국면이 상수가 아닙니다.` }
      : {
          ready: false,
          unavailable: false,
          why: `${used}개 시간대뿐이에요 — 아직 상수인지 표본이 적은 것인지 가를 수 없습니다.`,
        };
  }
  const [rows, s] = await Promise.all([idleSummary(14, todayDs), idleSample(14, todayDs)]);
  /* ⚠ 판정 문장을 여기서 조립하지 않는다 — `idleVerdict` 가 그 판정의 소유자다(그 파일이
     «관측 0일»과 «부재 0회»를 같은 회색 문장으로 만들지 않으려고 세운 규율). */
  const v = idleVerdict(rows, s);
  return { ready: v.ok, unavailable: !s.days, why: v.text };
}
