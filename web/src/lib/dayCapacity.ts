/* ============================================================
   dayCapacity.ts — "오늘 안에 들어가는가"의 단일 판정(W6 · 2026-07-31 · 순수).

   ## 왜 lib 인가
   판정 자체는 E9 가 이미 오늘 탭 **컴포넌트 안에서** 하고 있었다. 옮긴 이유는 계산이 어려워서가
   아니라 **출력이 세 자리로 쪼개져 있었기** 때문이다:
     ① 리드아웃 `남은 가용 3.2h`(30px · 우상단)  ② 종결 캡 `오늘 밖 2개 · 1h`(11px · 레일 하단)
     ③ 링 분모의 조용한 축소
   셋 다 **양(量)만** 말하고 어느 자리도 "들어가는가"라는 **문장**을 말하지 않아, 사용자가 화면
   대각선으로 눈을 잇고 뺄셈(4.5−3.2)을 직접 했다. 판정을 한 함수로 모으면 문장도 한 곳에서 나온다.

   ⚠⚠ **여유가 있으면 여유를 먼저 말한다.** 매일 "N개는 오늘 밖"만 말하면 E9 가 없앤 실패감을
   히어로 크기로 되살린다. 같은 자리에서 **반대 부호**를 말하는 것이 이 모듈의 절반이다.

   ⚠ 새 계수는 0이다 — 입력은 `freeLeftMin`(남은 창)과 블록의 `min`(계획 분)뿐이고 둘 다 이미
   있던 값이다. 일과 블록은 세지 않는다(내가 하는 학습이 아니라 이미 잡힌 시간이다). 완료 블록도
   안 센다 — 이미 쓴 시간은 `freeLeftMin` 에서 빠져 있다(이중 차감 방지).
============================================================ */
import { hLabel } from './utils';

/** 판정 입력 — 오늘의 학습 블록 하나. `start` 가 null 이면 시각이 없어 순서를 못 매기므로 제외된다. */
export interface CapacityBlock {
  key: string;
  start: number | null;
  min: number;
  done: boolean;
  /** 막대 세그먼트 라벨·툴팁용. 판정에는 안 쓴다. */
  name?: string;
  /** 과목색(파생값 · 절대규칙 #3). 판정에는 안 쓴다. */
  color?: string;
}

/**
 * 막대 한 칸(P-7). **시각 순서 그대로**이고, `beyond` 인 것이 곧 남은 창 밖으로 삐져나온 부분이다.
 *
 * ⚠ 부분 절단을 하지 않는다 — 창 경계에 걸친 블록도 통째로 `beyond` 다. `beyondKeys` 와 **같은
 * 규칙**이어야 막대와 레일이 서로 다른 말을 하지 않는다(한 양 = 한 판정). 경계에 걸친 블록을
 * 반만 칠하면 "반은 오늘 안"이라는 없는 개념이 생기고, 스케줄러엔 그런 개념이 없다.
 */
export interface CapacitySegment {
  key: string;
  min: number;
  beyond: boolean;
  name: string;
  color?: string;
}

export interface DayCapacity {
  /** 남은 창을 넘겨 "오늘 밖"으로 접힌 블록 키. */
  beyondKeys: Set<string>;
  /** 그 블록들의 합(분). */
  beyondMin: number;
  /** 아직 안 한 학습 블록의 합(분) — 접힌 것 포함. */
  remainMin: number;
  /** 한 줄 판정. 오늘 할 것이 없으면 null(말할 것이 없으면 안 그린다 — 레일 신호와 같은 규칙).
   *  ⚠ P-7 이후 이 문자열은 **화면 텍스트가 아니라 막대의 `aria-label`** 이다 — 길이로 옮긴 것을
   *  SR 이 못 읽으면 그건 이전(移轉)이 아니라 손실이다. */
  fitLine: string | null;
  /**
   * **Q-2** — 오늘 남은 창에서 남은 계획을 뺀 값(분). 양수=여유 · 음수=초과 · `null`=할 것이 없음.
   *
   * ⚠ 왜 문자열(`fitLine`)이 있는데 숫자를 따로 내는가: 상단 44px 리드아웃은 **값과 단위를
   * 따로** 조판해야 하고(`Readout` 계약), 문자열을 파싱해 되돌리는 코드는 그 순간부터
   * `fitLine` 문구를 못 바꾸게 만든다. 표시 문자열에서 값을 역산하지 않는다.
   */
  slackMin: number | null;
  /** 막대 칸들(시각 순). */
  segments: CapacitySegment[];
  /**
   * 막대의 가로 축척(분) = `max(남은 창, 남은 계획)`.
   *
   * ⚠⚠ **분모가 창이 아니라 둘 중 큰 값인 것이 이 안의 핵심이다.** 창으로 나누면 초과분이
   * 100% 를 넘어 잘리고, 그러면 **넘쳤다는 사실 자체가 안 보인다** — 지금 앱이 `beyondKeys` 를
   * 조용히 필터로 지우던 것과 같은 실패를 그래픽으로 반복하는 셈이다. 0 이면 그릴 것이 없다.
   */
  scaleMin: number;
  /** 남은 창이 축척에서 차지하는 비율(0~1). 이 지점이 곧 "오늘의 끝" 표시다. */
  windowRatio: number;
}

export function dayCapacity(blocks: readonly CapacityBlock[], freeLeftMin: number): DayCapacity {
  const beyondKeys = new Set<string>();
  const segments: CapacitySegment[] = [];
  let beyondMin = 0;
  let remainMin = 0;
  let acc = 0;
  const pending = blocks.filter((b) => b.start != null && !b.done).sort((a, b) => a.start! - b.start!);
  for (const b of pending) {
    const min = b.min || 0;
    remainMin += min;
    acc += min;
    const beyond = acc > freeLeftMin;
    if (beyond) {
      beyondKeys.add(b.key);
      beyondMin += min;
    }
    segments.push({ key: b.key, min, beyond, name: b.name ?? '', color: b.color });
  }
  const head = `창 ${hLabel(freeLeftMin)} · 남은 계획 ${hLabel(remainMin)}`;
  const fitLine = !pending.length
    ? null
    : beyondKeys.size
      ? `${head} — ${beyondKeys.size}개는 오늘 밖`
      : `${head} — 여유 ${hLabel(Math.max(0, freeLeftMin - remainMin))}`;
  const scaleMin = Math.max(freeLeftMin, remainMin);
  return {
    beyondKeys,
    beyondMin,
    remainMin,
    fitLine,
    // `fitLine` 이 null 인 조건과 **같은 조건**으로 null 이다 — 두 값이 갈리면 화면이 "여유 0"과
    // "말할 것 없음"을 같은 픽셀로 그린다.
    slackMin: pending.length ? freeLeftMin - remainMin : null,
    segments,
    scaleMin,
    windowRatio: scaleMin > 0 ? Math.min(1, freeLeftMin / scaleMin) : 0,
  };
}
