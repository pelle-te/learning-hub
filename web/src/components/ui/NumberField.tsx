/* ============================================================
   NumberField — 숫자 입력의 '중간 타이핑 상태 확정 저장'을 막는 공용 프리미티브.

   왜 필요한가: <input type="number">는 값이 완전한 부동소수가 아니면 `.value`로 **빈 문자열**을 준다.
   그래서 매 키스트로크마다 커밋하는 코드는 사용자가 `1.5`를 치는 도중 이런 순서를 저장한다:
     "1" → 1  ·  "1." → **""(빈값) → 0으로 확정**  ·  "1.5" → 5(앞의 0.을 잃은 값)
   러닝허브에선 이게 단순 오타로 끝나지 않았다 — 배분 셀의 0 저장이 `ensureWeekAlloc`을 타고
   **그 주를 managed로 승격**시켜, 자동 제안이 "내 배분"으로 영구 전환되고 스케줄러가 그 벡터로 굴러갔다.

   계약:
   • 타이핑 중엔 **완성된 숫자일 때만** 커밋한다("", ".", "1.", "-" 같은 미완 상태는 통과 못 함) →
     흔한 경우엔 여전히 실시간으로 반응한다.
   • 미완 상태는 로컬 draft로 화면에만 남는다 → 사용자가 보는 글자와 저장된 값이 어긋나지 않는다.
   • blur/Enter에서 확정한다. 비운 채 떠나면 `emptyValue`(주면 그 값으로 커밋, 안 주면 직전 값 복원).
   • 포커스가 없을 땐 항상 prop `value`를 그대로 비춘다(외부 변경이 즉시 반영).
============================================================ */
import { useState, type InputHTMLAttributes } from 'react';

/** 완성된 십진수인가 — "", ".", "1.", "-", "1e" 같은 미완/부분 입력을 걸러낸다. */
function isCompleteNumber(raw: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(raw.trim());
}

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  /** 현재 확정값. 포커스가 없으면 이 값이 그대로 보인다. */
  value: number;
  /** 확정된 값 변경만 전달된다(미완 상태는 오지 않는다). */
  onCommit: (v: number) => void;
  /** 비운 채 blur했을 때 커밋할 값. 생략하면 직전 값으로 되돌린다(지우기=0이 아닌 필드용). */
  emptyValue?: number;
  min?: number;
  max?: number;
};

export function NumberField({ value, onCommit, emptyValue, min, max, step, ...rest }: Props) {
  // null = 편집 중 아님(prop을 그대로 표시). 문자열 = 편집 중 draft.
  const [draft, setDraft] = useState<string | null>(null);

  const clamp = (v: number) => {
    let out = v;
    if (typeof min === 'number' && out < min) out = min;
    if (typeof max === 'number' && out > max) out = max;
    return out;
  };

  const commitIfChanged = (v: number) => {
    const c = clamp(v);
    if (c !== value) onCommit(c);
  };

  /** blur/Enter — draft를 해석해 확정하고 편집 모드를 벗어난다. */
  const settle = () => {
    if (draft === null) return;
    const raw = draft.trim();
    if (raw === '') {
      if (emptyValue !== undefined) commitIfChanged(emptyValue);
      // emptyValue가 없으면 아무것도 커밋하지 않는다 → draft를 버려 직전 값이 되살아난다.
    } else {
      const n = parseFloat(raw);
      if (Number.isFinite(n)) commitIfChanged(n);
      // 해석 불가면 마찬가지로 draft만 버린다(쓰레기 값을 저장하지 않는다).
    }
    setDraft(null);
  };

  return (
    <input
      {...rest}
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft ?? (value || value === 0 ? String(value) : '')}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        // 완성된 숫자만 즉시 반영 — 미완 상태는 draft로만 남아 저장을 오염시키지 않는다.
        if (isCompleteNumber(raw)) commitIfChanged(parseFloat(raw));
      }}
      onBlur={(e) => {
        settle();
        rest.onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') settle();
        rest.onKeyDown?.(e);
      }}
    />
  );
}
