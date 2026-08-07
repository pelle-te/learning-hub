/* ============================================================
   lib/semesterFingerprint.ts — **학기 지문**(N-22 · W6 · 발산 6회차).

   ## 무엇이 없었나

   학기가 끝나면 남는 시각 자산이 **0**이다. 이 앱은 한 학기 동안 과목·챕터·시간을 전부 알지만,
   그 학기가 *어떤 모양이었는지*를 한 장으로 말하지 않는다 — 통계 화면은 있지만 그건 *숫자를
   보는 곳*이지 *남는 것*이 아니다.

   ## ⚠⚠ 그리지 않고 **자라게** 한다

   이 항목이 로드맵에서 "시그니처를 그리지 말고 자라게"라 적힌 이유가 핵심이다. 시각 자산을
   손으로 그리면 그건 **장식**이고, 장식은 학기가 달라도 같다. 여기서 나오는 도형은 전부
   그 학기의 **실제 값**에서 나온다:
   · 가지 수     = 과목 수
   · 가지 길이   = 그 과목에 실제로 들어간 시간(상대)
   · 가지 각도   = 과목 id 해시(색과 **같은 파생 키** — `colorForId` 와 같은 규율)

   즉 균등하게 한 학기와 한 과목에 몰린 학기는 **다르게 생겨야 한다.** 그 명제가 이 파일의
   유일한 검증이고(`test/semesterFingerprint.test.ts`), 통과 못 하면 이 안은 값이 0이다.

   ⚠ **색을 안 정한다** — path 만 낸다. 색은 `colorForId` 가 이미 소유하고(절대규칙 #3),
     여기서 또 정하면 액센트 교체 때 따라오지 않는 색이 하나 생긴다.
   ⚠ **DOM 을 안 만든다** — 순수 기하다. 렌더는 소비처가 `<svg>` 로 하고, 그래야 이 규칙이
     유닛으로 잠긴다(그리기와 판정을 가르는 이 저장소의 규율 그대로).
   ⚠ 좌표계는 `0 0 100 100` 고정 — 소비처가 `viewBox` 로 어디에나 얹는다.
============================================================ */

/** 지문 한 가지(과목 하나). */
export interface FingerprintBranch {
  /** 과목 id — 소비처가 `colorForId(id)` 로 색을 붙인다(색은 여기서 안 정한다). */
  id: string;
  /** SVG `path` 의 `d`. 중심에서 뻗는 곡선 하나. */
  d: string;
}

/** 지문의 입력 — **그 학기가 실제로 무엇이었나**. */
export interface FingerprintInput {
  id: string;
  /** 그 과목에 들어간 시간(분). 0 이하면 가지가 최소 길이로 남는다(없던 일이 아니라 *안 한 일*이다). */
  minutes: number;
}

const CENTER = 50;
/** 가장 짧은 가지 — 0분이어도 **점이 아니라 가지**다(등록했다는 사실 자체가 그 학기의 일부다). */
const MIN_LEN = 12;
const MAX_LEN = 44;

/** id → 0~1. `lib/utils.colorForId` 와 **같은 성질**을 쓴다: 위치가 아니라 정체성에서 파생. */
function hash01(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/**
 * 학기 하나 → 지문 가지들.
 *
 * ⚠ 길이는 **최댓값 대비 상대**다. 절대 분으로 하면 가벼운 학기가 통째로 점이 되고, 그러면
 * "이 학기가 어떤 모양이었나"가 아니라 "이 학기가 바빴나"만 남는다(그건 이미 숫자가 말한다).
 * ⚠ 각도는 균등 분배 **+ 해시 흔들림**이다: 균등만 쓰면 과목 수가 같은 두 학기가 똑같이
 * 생기고, 해시만 쓰면 겹쳐서 뭉친다. 둘 다 필요하다.
 */
export function semesterFingerprint(items: readonly FingerprintInput[]): FingerprintBranch[] {
  if (!items.length) return [];
  const max = Math.max(...items.map((i) => Math.max(0, i.minutes)), 1);
  const step = 360 / items.length;
  return items.map((it, i) => {
    const t = Math.min(1, Math.max(0, it.minutes) / max);
    const len = MIN_LEN + t * (MAX_LEN - MIN_LEN);
    /* 흔들림을 한 칸의 ±35% 로 묶는다 — 더 풀면 가지가 서로를 넘어가 **순서가 뜻을 잃는다**
       (같은 학기를 두 번 그리면 같아야 한다는 성질은 해시가 결정적이라 유지된다). */
    const deg = i * step + (hash01(it.id) - 0.5) * step * 0.7;
    const rad = (deg * Math.PI) / 180;
    const x = CENTER + Math.cos(rad) * len;
    const y = CENTER + Math.sin(rad) * len;
    /* 곡선의 휨도 값에서 나온다 — 길수록 더 휜다(짧은 가지가 과하게 휘면 노이즈로 보인다).
       제어점은 중심-끝의 중간을 법선 방향으로 민다. */
    const bend = t * 18;
    const cx = CENTER + Math.cos(rad) * (len / 2) - Math.sin(rad) * bend;
    const cy = CENTER + Math.sin(rad) * (len / 2) + Math.cos(rad) * bend;
    return { id: it.id, d: `M${CENTER} ${CENTER}Q${round(cx)} ${round(cy)} ${round(x)} ${round(y)}` };
  });
}

/**
 * 앱 상태 → 지문 입력(과목별 **실제 투입 분**).
 *
 * ⚠ 계획 시간(`weeklyHours`)이 아니라 **완료 기록**을 쓴다 — 이 도형이 말하려는 것은 *어떻게
 * 하려 했나*가 아니라 *어떻게 됐나*다. 계획으로 그리면 모든 학기가 계획표처럼 예쁘게 생긴다.
 * ⚠ 등록됐지만 한 번도 안 한 과목도 **목록에 남는다**(0분 가지) — 그 사실이 그 학기의 일부다.
 */
export function investedBySubject(state: {
  items: readonly { id: string }[];
  completions?: Record<string, Record<string, { min?: number }>>;
}): FingerprintInput[] {
  const min = new Map<string, number>();
  for (const day of Object.values(state.completions ?? {}))
    for (const [key, v] of Object.entries(day)) {
      const sid = key.split('|')[0]!;
      min.set(sid, (min.get(sid) ?? 0) + (Number(v?.min) || 0));
    }
  return state.items.map((it) => ({ id: it.id, minutes: min.get(it.id) ?? 0 }));
}

/** 소수점 두 자리 — 그 이상은 SVG 에서 보이지 않고 스냅샷만 시끄러워진다. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}
