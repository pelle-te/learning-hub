/* ============================================================
   confidence.ts — **숫자가 자기 확신을 함께 말하게** 한다(P-12 · 2026-08-01).

   ## 왜 필요한가 — 상류는 이미 보내고 있었고 소비처가 0건이었다

   `knowledge.ts` 의 타입에는 `measured`(실제 관측이 있는 노트 수) · `n`(전체) ·
   `evidence_coverage.quarantined`(사전분포 검역)가 **이미 있다.** 부모 파이프라인이 그걸 실어
   보내는 이유도 주석에 적혀 있다: _"전부 사전분포라 평균이 사실이 아니다"_. 그런데 앱 전역에서
   그 필드를 읽는 곳이 **한 군데도 없었다.** 배선이 없어서가 아니라 **받을 시각 어휘가 없어서**다.

   그래서 값 표기가 **2진**이었다: 숫자 아니면 `미측정`. 더 나쁜 결과는 `Mastery.tsx` 의
   `k.overall != null &&` 가드다 — 모르면 **페이지의 시그니처 링이 통째로 사라진다.** 사용자는
   "아직 안 불러왔나"와 "불러왔는데 표본이 없다"를 구분할 방법이 없다.

   ## 세 등급 — 표시 방법이 등급마다 다르다

   · `solid`     — 관측이 충분하다. 종전과 똑같이 그린다(카운트업 포함).
   · `tentative` — 값은 있는데 표본이 얇다. **자라는 애니를 생략한다** — 자기 크기까지 자라지
                   않는 것이 곧 "자기 크기를 모른다"이다. 획은 흐리고 캡션이 분모를 말한다.
   · `unknown`   — 검역 중(`quarantined`) 이거나 값이 없다. **사라지지 않는다** — 빈 링과 캡션이
                   "모른다"를 적극적으로 말한다.

   ⚠ **임계를 새로 만들지 않았다.** 상류가 이미 `threshold_pct` 를 싣고 `quarantined` 를 판정해
   보내므로 그 판단을 그대로 쓴다. 앱이 자기 임계를 발명하면 두 곳이 서로 다른 말을 하게 된다
   (이 저장소가 임의 계수에 대해 반복해서 정한 규율).
   ⚠ 상류가 `quarantined` 를 안 보내는 옛 산출물을 위해 **덮개율 폴백** 하나만 둔다 — 값 자체는
   상류의 `threshold_pct` 를 쓰고, 그것도 없을 때만 보수적으로 판단한다.
============================================================ */
import type { Knowledge, KnowledgeSubject } from './knowledge';

export type ConfidenceLevel = 'solid' | 'tentative' | 'unknown';

export interface Confidence {
  level: ConfidenceLevel;
  /** 관측이 있는 노트 수 — 모르면 null. */
  measured: number | null;
  /** 전체 노트 수 — 모르면 null. */
  total: number | null;
  /** `측정 3/40` · 분모를 모르면 `측정 3건` · 둘 다 모르면 ''. 화면이 그대로 쓴다. */
  caption: string;
  /** 스크린리더용 한 마디 — 캡션은 숫자뿐이라 그것만으로는 뜻이 안 선다. */
  speech: string;
}

/** 상류가 `threshold_pct` 를 안 줄 때만 쓰는 보수적 폴백(%). 값을 발명하지 않기 위해 마지막 수단이다. */
const FALLBACK_THRESHOLD_PCT = 60;

function build(level: ConfidenceLevel, measured: number | null, total: number | null): Confidence {
  const caption =
    measured == null ? '' : total != null && total > 0 ? `측정 ${measured}/${total}` : `측정 ${measured}건`;
  const speech =
    level === 'unknown'
      ? '표본이 부족해 값을 내지 않았습니다'
      : level === 'tentative'
        ? `표본이 얇은 잠정값입니다${caption ? ` — ${caption}` : ''}`
        : caption;
  return { level, measured, total, caption, speech };
}

/** 전체(overall) 값의 확신. `k` 가 없으면 `unknown`. */
export function overallConfidence(k: Knowledge | undefined): Confidence {
  if (!k) return build('unknown', null, null);
  const ec = k.evidence_coverage;
  const measured = ec?.measured ?? null;
  const total = ec?.total ?? k.n_notes ?? null;
  // 관측 0건은 임계와 무관하게 unknown — 전부 사전분포라 평균이 *사실이 아니다*(상류 ②#54).
  // ⚠ 이 검사가 아래 임계 판정보다 **먼저**여야 한다. 뒤에 두면 0건이 '잠정'으로 새고,
  //   그러면 화면이 근거 0인 숫자를 흐릿하게나마 주장하게 된다.
  if (k.overall == null || ec?.quarantined || measured === 0) return build('unknown', measured, total);
  // 상류 판단 우선 — 검역은 아닌데 덮개율이 임계 미만이면 잠정으로 본다.
  const pct = ec?.pct ?? (measured != null && total ? (measured / total) * 100 : null);
  const th = ec?.threshold_pct ?? FALLBACK_THRESHOLD_PCT;
  if (pct != null && pct < th) return build('tentative', measured, total);
  return build('solid', measured, total);
}

/** 과목 하나의 확신. 과목엔 `quarantined` 가 없고 `measured`/`n` 만 온다. */
export function subjectConfidence(s: KnowledgeSubject | undefined): Confidence {
  if (!s) return build('unknown', null, null);
  const measured = s.measured ?? null;
  const total = s.n ?? null;
  if (s.mastery == null || measured === 0) return build('unknown', measured, total);
  if (measured == null || total == null) return build('solid', measured, total);
  return build((measured / Math.max(1, total)) * 100 < FALLBACK_THRESHOLD_PCT ? 'tentative' : 'solid', measured, total);
}
