/* ============================================================
   planCommand.ts — **T-12 명령줄이 계획을 쓴다**. 순수 파서 · React 무관.

   ## 무엇이 없었나

   계획 편집의 유일한 빠른 길이 **마우스**였다: 표를 열고 셀을 찾아 드래그한다(Q-9 가 배분 보드에
   키보드 격자를 놓았지만, 그건 *그 화면 안에서*의 이동이다). 그런데 실제 편집 대부분은
   _"회로 +1h"_ 같은 **한 문장의 소량 변경**이다 — 문장으로 되는 일에 화면 이동을 요구하고 있었다.

   ⌘K 는 이미 열려 있고 이미 과목을 인덱싱한다. 없던 것은 **문장을 계획 변경으로 읽는 층**뿐이다.

   ## ⚠⚠ 못 알아들었을 때 **조용히 실패하지 않는다**

   이 항목의 반나절 검증이 _"사흘간 종이에 한 문장씩 → 15개로 파서 적중률"_ 이었다. 적중률을
   재려면 **빗나간 것이 보여야** 한다 — `null` 만 돌려주면 사용자는 자기가 뭘 잘못 썼는지도,
   앱이 무엇을 아는지도 모른다. 그래서 결과가 셋이다: `ok` · `unknown-subject`(과목을 못 찾음
   — 후보를 함께 준다) · `no-match`(문법이 아님 — 아는 형태를 함께 준다).

   ## ⚠ 문법을 작게 유지한다

   지금 아는 것은 **주당 시간 증감** 하나다. `쉼`·`몰아서`·`내일로` 같은 동사를 지금 넣으면
   각각이 다른 저장 축을 건드리고(주간 배분·일일 오버라이드·미루기), 파서가 그 셋을 헷갈리기
   시작한다. 하나가 실제로 쓰이는 것을 본 뒤에 늘린다 — 이 파일이 그 관측 장치다.
============================================================ */

/** 증감 한 건. `deltaH` 는 **시간 단위**(분 입력도 여기서 시간으로 환산된다). */
export interface PlanBump {
  kind: 'bump';
  sid: string;
  name: string;
  deltaH: number;
}

export type PlanCommand =
  | { kind: 'ok'; cmd: PlanBump; echo: string }
  /** 과목을 못 찾았다 — **후보를 함께 준다**(사용자가 뭘 쳐야 하는지 알 수 있게). */
  | { kind: 'unknown-subject'; typed: string; candidates: string[] }
  /** 문법이 아니다 — 아는 형태를 함께 준다. */
  | { kind: 'no-match' };

/** 지금 아는 형태. 화면이 이 배열을 그대로 보여 준다(문구를 화면마다 새로 지으면 갈린다). */
export const PLAN_GRAMMAR = ['<과목> +1h', '<과목> -30m', '<과목> +90분'] as const;

/** `+1h` · `-30m` · `+90분` · `+1.5시간` → 시간(부호 포함). 형식이 아니면 null. */
export function parseDelta(token: string): number | null {
  const m = /^([+-])\s*(\d+(?:\.\d+)?)\s*(h|시간|m|min|분)$/i.exec(token.trim());
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const n = Number(m[2]);
  if (!Number.isFinite(n) || n === 0) return null;
  const unit = (m[3] || '').toLowerCase();
  const hours = unit === 'h' || unit === '시간' ? n : n / 60;
  return sign * hours;
}

/** 과목 이름 매칭 — **접두 우선, 없으면 부분 일치**. 여러 개면 매칭 실패로 다룬다(모호함은 실패다). */
function matchSubject(
  typed: string,
  items: readonly { id: string; name: string }[],
): { id: string; name: string } | null {
  const q = typed.trim().toLowerCase();
  if (!q) return null;
  const pre = items.filter((i) => i.name.toLowerCase().startsWith(q));
  const pool = pre.length ? pre : items.filter((i) => i.name.toLowerCase().includes(q));
  /* ⚠ 여럿이면 **고르지 않는다.** 아무거나 고르면 사용자가 안 본 사이에 다른 과목의 계획이
     바뀌고, 그 편집은 되돌리기 전까지 눈에 안 띈다. */
  return pool.length === 1 ? pool[0]! : null;
}

/**
 * 한 문장을 계획 변경으로 읽는다. **마지막 토큰이 증감**이고 앞이 과목 이름이다.
 *
 * ⚠ 과목 이름에 공백이 있을 수 있어 앞쪽을 통째로 이름으로 본다(`선형 대수 +1h`).
 */
export function parsePlanCommand(text: string, items: readonly { id: string; name: string }[]): PlanCommand {
  const parts = text.trim().split(/\s+/);
  if (parts.length < 2) return { kind: 'no-match' };
  const delta = parseDelta(parts[parts.length - 1]!);
  if (delta === null) return { kind: 'no-match' };
  const typed = parts.slice(0, -1).join(' ');
  const hit = matchSubject(typed, items);
  if (!hit)
    return {
      kind: 'unknown-subject',
      typed,
      // 후보는 짧게 — 전체 목록을 뿌리면 그건 도움이 아니라 소음이다.
      candidates: items.slice(0, 5).map((i) => i.name),
    };
  const rounded = Math.round(delta * 10) / 10;
  return {
    kind: 'ok',
    cmd: { kind: 'bump', sid: hit.id, name: hit.name, deltaH: rounded },
    echo: `${hit.name} 주당 ${rounded > 0 ? '+' : ''}${rounded}h`,
  };
}
