/* ============================================================
   aiUsage.ts — **로컬 LLM 축의 호출 계기**(I023 · 2026-08-22 발상 축).

   ## 왜 이게 있는가 — 두 각도가 반대 방향으로 도착했다

   발상 축 1회차에서 세 각도가 «로컬 LLM 축의 산 소비처가 **1**»에 독립적으로 도착했다
   (`ollama.rs` 473줄 + 임베딩 + 프롬프트 빌더인데 `build()` 의 `kind` 가 **한 종**). 그런데
   처방이 갈렸다: 복리 각도는 *"인프라가 다 갖춰졌는데 쓰는 곳이 하나"* 라 **키우자**고 했고,
   은퇴·백지 각도는 **지우자**고 했다.

   메인 판정(리포트 §5-A): **인프라의 완비는 수요의 증거가 아니다.** 그러나 지우는 쪽의
   되돌리기 비용도 크다(Rust 473줄 + 임베딩 캐시 + 스트리밍 계약). 두 안의 **같은 최싼검증**이
   *"호출 카운터 1주 — 0이면 은퇴, 0이 아니면 복리"* 라, 그 계기가 이 파일이다.

   ## ⚠⚠ 표를 늘리지 않는다

   관측 원장은 이미 넷이고(`route_visits`·`route_hops`·`day_signals`·`idle_spells`) 같은 회차의
   I032 가 **그것을 줄이자**고 올라와 있다. 한 주짜리 질문에 답하려고 다섯째 표를 파면, 그 표는
   질문이 끝난 뒤에도 남는다 — 이 저장소가 «영원히 유예»라 부르는 형태다. 그래서 기기-로컬
   KV 한 칸이다: **질문이 끝나면 키 하나를 지우면 끝난다.**

   ## ⚠ 분모를 함께 든다 — 0 은 두 가지 뜻이다

   `since` 를 같이 담는 이유는 `visits.visitSample` 과 **정확히 같다**. 계기가 없으면 "안 쓴다"와
   "안 쟀다"가 같은 0 으로 보이고, 이 저장소는 그 혼동으로 탭을 지울 뻔한 전력이 있다. 여기서는
   더 위험하다 — 판정의 결론이 *"Rust 473줄을 지운다"* 이기 때문이다.

   ⚠ **날짜별로 담는다**(합계 하나가 아니라). 합계만 있으면 "예전에 몇 번 써 봤다"와 "이번 주에
   쓴다"가 구분되지 않는데, I023 이 묻는 것은 **지금 이 축이 살아 있는가**다.
============================================================ */
import { storage } from './kv';
import { addDays, iso, parseISO, todayISO } from './utils';

/** 저장 키. **질문이 끝나면 이 키를 지우는 것이 곧 계기 철거다**(머리주석). */
export const AI_USAGE_KEY = 'lh_ai_usage_v1';

/** 보존 창(일). 판정에 필요한 것은 1주지만, 한 주를 통째로 놓치는 경우를 위해 두 배를 든다. */
const KEEP_DAYS = 14;

interface Usage {
  /** 관측을 시작한 날(ISO). **분모** — 이게 없으면 0 이 "안 쓴다"인지 "안 쟀다"인지 모른다. */
  since: string;
  /** 날짜 → 호출 수. 종류를 나누지 않는다(질문이 «이 축이 살아 있나»이지 «어느 kind»가 아니다). */
  days: Record<string, number>;
}

function read(): Usage | null {
  try {
    const raw = storage.getItem(AI_USAGE_KEY);
    if (!raw) return null;
    const o: unknown = JSON.parse(raw);
    if (!o || typeof o !== 'object') return null;
    const { since, days } = o as Partial<Usage>;
    if (typeof since !== 'string' || !days || typeof days !== 'object') return null;
    return { since, days };
  } catch {
    return null; // 손상은 «관측 없음»이다 — 던지면 AI 호출 자체가 죽는다
  }
}

/**
 * 로컬 LLM 호출 1회를 센다. **실패해도 조용히 넘어간다**(`visits.recordVisit` 과 같은 계약) —
 * 계기가 기능을 막으면 계기 때문에 관측 대상이 달라진다.
 *
 * ⚠ 호출부는 `lib/api.ts` 의 전송 분기 **두 곳**뿐이다(`aiCall`·`embedTexts`). 화면마다 부르게
 * 하면 새 소비처가 생길 때 빠뜨리고, 빠진 것은 **0 으로 보인다** — 그리고 그 0 의 결론이
 * "지운다"라서 이 축에서는 누락이 곧 오판이다.
 */
export function recordAiCall(todayDs: string = todayISO()): void {
  try {
    const cur = read() ?? { since: todayDs, days: {} };
    const cutoff = iso(addDays(parseISO(todayDs), -KEEP_DAYS));
    const days: Record<string, number> = {};
    for (const [d, n] of Object.entries(cur.days)) if (d >= cutoff) days[d] = n;
    days[todayDs] = (days[todayDs] ?? 0) + 1;
    storage.setItem(AI_USAGE_KEY, JSON.stringify({ since: cur.since, days }));
  } catch {
    /* 저장 실패는 무시 */
  }
}

/** 판정에 쓰는 요약. `since` 가 `null` 이면 **아직 한 번도 안 쟀다**(0 과 다른 상태다). */
export interface AiUsage {
  since: string | null;
  /** 최근 `days` 일 호출 합. */
  total: number;
  /** 실제로 호출이 있었던 날 수 — "하루 몰아 썼다"와 "매일 쓴다"를 가른다. */
  activeDays: number;
  /** 관측이 돈 날 수(= `since` 이후 경과일 + 1, 창 상한). **분모**. */
  observedDays: number;
}

/** 판정에 필요한 최소 관측(1주). 이 아래면 «0 이라도 지우지 마라». */
export const AI_SAMPLE_MIN_DAYS = 7;

export function aiUsage(days = KEEP_DAYS, todayDs: string = todayISO()): AiUsage {
  const cur = read();
  if (!cur) return { since: null, total: 0, activeDays: 0, observedDays: 0 };
  const from = iso(addDays(parseISO(todayDs), -days));
  let total = 0;
  let activeDays = 0;
  for (const [d, n] of Object.entries(cur.days)) {
    if (d < from) continue;
    total += n;
    if (n > 0) activeDays += 1;
  }
  /* ⚠ 경과일을 **관측일**로 읽는다 — 앱을 안 연 날도 "그 축을 안 썼다"는 관측이다(호출은
     앱 안에서만 일어난다). `route_visits` 의 `COUNT(DISTINCT day)` 와 뜻이 다른 것이 의도다:
     저기는 «앱을 연 날»을 세지만 여기 질문은 «이 축이 필요했던 적이 있나»다. */
  const start = cur.since < from ? from : cur.since;
  const elapsed = Math.round((parseISO(todayDs).getTime() - parseISO(start).getTime()) / 86_400_000);
  return { since: cur.since, total, activeDays, observedDays: Math.max(0, elapsed) + 1 };
}

/** 판정을 내려도 되는가 — 1주를 채웠는가. */
export const aiUsageReady = (u: AiUsage): boolean => u.since !== null && u.observedDays >= AI_SAMPLE_MIN_DAYS;
