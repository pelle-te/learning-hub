/* ============================================================
   examSheet.test.ts — T-18 시험 전날 한 장.

   픽스처는 **실제 볼트 노트에서 그대로 떠 온 것**이다(회로이론 CIRC 05). 손으로 지어낸
   마크업으로 파서를 잠그면 "우리가 상상한 볼트"를 검사하게 된다 — 이 항목의 전제가 바로
   *실제 마크업이 일관한가* 였으므로 그건 검사가 아니라 순환이다.

   잠그는 것 셋:
   ① 실제 콜아웃 문법에서 정의·정리·함정·요약이 **전부** 접힌다.
   ② **못 찾은 것과 없는 것을 가른다**(`parsed`) — 마크업이 다른 노트를 "정리 0개"로 그리지 않게.
   ③ 예제·증명은 **안 담는다**(한 장은 길이가 계약이다).
============================================================ */
import { describe, expect, it } from 'vitest';
import { buildSheet, countByKind, parseNote, readableMath } from '@/lib/examSheet';

const NOTE = `---
title: CIRC 05 - Power and Energy
status: verified
---

# CIRC 05 - Power and Energy

> [!info] 이 모듈에서
> **전력 $p = dw/dt = vi$ — 요소가 에너지를 공급/수취하는 시간율.**
> *직관 — 전압 × 전류 = 초당 에너지.*

## 2. 전력

> [!abstract] 정의 — 전력 (power)
> 에너지를 공급하거나 수취하는 **시간율**.
> $$p = \\frac{dw}{dt} \\tag{1.5-1}$$
> ($p$: 전력 [W])

> [!info] 정리 — 전력은 전압 × 전류
> 요소 양단 전압 × 요소를 지나는 전류가 그 요소의 전력.
> $$p = v \\cdot i \\tag{1.5-2}$$

> [!note]- 증명 — (1.5-2)는 왜 이렇게 되나
> **아이디어:** 연쇄율로 가른다.

> [!warning] ⚡ 함정 — 전력과 에너지는 다른 양
> 전력은 **율**(W = J/s), 에너지는 **양**(J).

> [!example]- 예제 — Example 1.5-1
> $v = 8$ V, $i = 25$ mA.
`;

describe('실제 볼트 마크업을 접는다', () => {
  const { items, parsed } = parseNote(NOTE);

  it('요약·정의·정리·함정 넷이 잡힌다', () => {
    expect(parsed).toBe(true);
    expect(items.map((i) => i.kind)).toEqual(['요약', '정의', '정리', '함정']);
  });

  it('⚠ 예제·증명은 한 장에 안 담는다 — 길이가 계약이다', () => {
    expect(items.some((i) => i.title.includes('Example'))).toBe(false);
    expect(items.some((i) => i.title.includes('왜 이렇게'))).toBe(false);
  });

  it('헤더의 ` — ` 뒤가 제목이다', () => {
    expect(items[1]!.title).toBe('전력 (power)');
    expect(items[0]!.title).toBe(''); // `이 모듈에서` 는 제목이 없는 콜아웃
  });

  it('디스플레이 수식을 읽을 수 있게 다듬어 담는다', () => {
    expect(items[1]!.formulas).toEqual(['p = dw/dt (1.5-1)']);
    expect(items[2]!.formulas).toEqual(['p = v · i (1.5-2)']);
  });

  it('요지는 강조 마크업을 벗긴 첫 문장이다', () => {
    expect(items[3]!.gist).toBe('전력은 율(W = J/s), 에너지는 양(J).');
  });
});

describe('⚠⚠ 못 찾은 것과 없는 것을 가른다', () => {
  it('콜아웃이 아예 없는 노트는 parsed=false — "정리 0개"가 아니라 "규약이 다르다"', () => {
    const r = parseNote('# 제목\n\n그냥 줄글 노트입니다.\n');
    expect(r.parsed).toBe(false);
    expect(r.items).toHaveLength(0);
  });

  it('콜아웃은 있는데 우리가 담는 종류가 없으면 parsed=true, items=0', () => {
    const r = parseNote('> [!example] 예제 — 하나\n> 본문\n');
    expect(r.parsed).toBe(true);
    expect(r.items).toHaveLength(0);
  });

  it('빈 노트도 시트에서 사라지지 않는다 — 무엇이 안 접혔는지가 화면의 정보다', () => {
    const sheet = buildSheet([
      { folder: 'A/01', title: '있음', text: NOTE },
      { folder: 'A/01', title: '없음', text: '줄글' },
    ]);
    expect(sheet).toHaveLength(2);
    expect(sheet[1]!.parsed).toBe(false);
    expect(countByKind(sheet)).toEqual({ 요약: 1, 정의: 1, 정리: 1, 함정: 1 });
  });
});

describe('수식 다듬기는 의미를 바꾸지 않는 치환만', () => {
  it('분수·곱·적분·태그', () => {
    expect(readableMath('w = \\int_{0}^{t} p\\,d\\tau \\tag{1.5-5}')).toBe('w = ∫_{0}^{t} p d\\tau (1.5-5)');
  });

  it('모르는 명령은 **지우지 않고 남긴다** — 조용히 틀린 식을 만드는 것보다 낫다', () => {
    expect(readableMath('\\nabla \\cdot E')).toBe('\\nabla · E');
  });
});
