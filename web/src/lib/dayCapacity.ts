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
}

export interface DayCapacity {
  /** 남은 창을 넘겨 "오늘 밖"으로 접힌 블록 키. */
  beyondKeys: Set<string>;
  /** 그 블록들의 합(분). */
  beyondMin: number;
  /** 아직 안 한 학습 블록의 합(분) — 접힌 것 포함. */
  remainMin: number;
  /** 한 줄 판정. 오늘 할 것이 없으면 null(말할 것이 없으면 안 그린다 — 레일 신호와 같은 규칙). */
  fitLine: string | null;
}

export function dayCapacity(blocks: readonly CapacityBlock[], freeLeftMin: number): DayCapacity {
  const beyondKeys = new Set<string>();
  let beyondMin = 0;
  let remainMin = 0;
  let acc = 0;
  const pending = blocks.filter((b) => b.start != null && !b.done).sort((a, b) => a.start! - b.start!);
  for (const b of pending) {
    remainMin += b.min || 0;
    acc += b.min || 0;
    if (acc > freeLeftMin) {
      beyondKeys.add(b.key);
      beyondMin += b.min || 0;
    }
  }
  const head = `창 ${hLabel(freeLeftMin)} · 남은 계획 ${hLabel(remainMin)}`;
  const fitLine = !pending.length
    ? null
    : beyondKeys.size
      ? `${head} — ${beyondKeys.size}개는 오늘 밖`
      : `${head} — 여유 ${hLabel(Math.max(0, freeLeftMin - remainMin))}`;
  return { beyondKeys, beyondMin, remainMin, fitLine };
}
