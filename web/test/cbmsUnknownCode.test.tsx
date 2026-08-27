// @vitest-environment jsdom
/* ============================================================
   cbmsUnknownCode.test.tsx — **열거 밖 `cbms[].code` 가 화면을 죽이지 않는다**(P043 · 2026-08-28).

   ## 왜 이 케이스가 있나

   `cbms[].code` 의 타입은 `CbmsCode` 인데 **런타임에 아무도 그걸 강제하지 않는다**:
   `AppStateSchema` 는 한 번도 `.parse` 되지 않고(`persistence.ts` 머리주석), 열거를 거르는
   `sanitizeCbms` 는 **가져오기 경로에서만** 돈다. 그래서 정본(localStorage/SQLite)에 열거 밖
   코드가 있으면 그대로 렌더까지 오고, 종전엔 `CBMS_INFO[code].tip` 이
   **`TypeError: Cannot read properties of undefined`** 로 탭을 통째로 죽였다(재현 완료).

   ⚠ 그리고 이건 «있을 수 없는 값»이 아니다. **더 새 버전이 여섯 번째 코드를 만들면** 구버전이
   그 데이터를 여는 순간이 정확히 이것이다 — 클라우드 동기화가 있는 앱의 정상 시나리오다.

   ## 무엇을 단언하나 — «안 죽는다» 만이 아니다

   ⚠⚠ **레코드가 살아남는 것**까지 본다. 처방으로 «부팅에서 걸러라»가 자연스러워 보이지만 그건
   정본에서 사용자 기록을 **지우는** 것이라 더 나쁘다(`methodology.cbmsInfo` 머리주석이 그 근거를
   진다). 그래서 이 케이스는 «화면이 뜬다»가 아니라 **«모르는 코드의 기록도 화면에 남아 있다»**를
   묻는다 — 그게 지금 처방과 기각한 처방을 가르는 단언이다.
============================================================ */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import Mistakes from '@/features/mistakes/Mistakes';
import { cbmsInfo, CBMS_CODES } from '@/lib/methodology';
import { useApp } from '@/store/useApp';
import type { Cbms } from '@/lib/types';

afterEach(() => cleanup());

const 미지 = {
  id: 'x1',
  ds: '2026-06-01',
  sid: 'unknown-subject',
  name: '미지코드과목',
  chapter: '1장',
  code: 'X', // ⚠ 열거 밖 — 더 새 버전이 만든 여섯 번째 코드를 흉내낸다
  note: '',
} as unknown as Cbms;

describe('cbmsInfo — 총함수', () => {
  it('아는 코드는 표 그대로다', () => {
    for (const c of CBMS_CODES) expect(cbmsInfo(c).label).not.toBe('미분류');
  });

  it('모르는 코드에도 **값을 준다**(undefined 가 아니다)', () => {
    const inf = cbmsInfo('X');
    expect(inf.label).toBe('미분류');
    expect(inf.tip, '처방 문구가 비면 소비처가 빈 줄을 그린다').not.toBe('');
    expect(inf.color, '색이 없으면 style 에 undefined 가 들어간다').toBeTruthy();
  });

  it('빈 문자열·기괴한 값에도 던지지 않는다', () => {
    for (const bad of ['', ' ', 'CC', 'c', '__proto__', 'toString']) {
      expect(() => cbmsInfo(bad), `cbmsInfo(${JSON.stringify(bad)})`).not.toThrow();
      expect(typeof cbmsInfo(bad).label).toBe('string');
    }
  });
});

describe('열거 밖 코드 · 화면', () => {
  it('mistakes 탭이 죽지 않고 **그 기록을 지우지도 않는다**', () => {
    useApp.setState((s) => ({ state: { ...s.state, cbms: [미지] } }) as never);
    render(
      <MemoryRouter>
        <Mistakes />
      </MemoryRouter>,
    );
    // 렌더가 됐다 = 종전의 TypeError 가 없다.
    expect(screen.getAllByText(/미지코드과목/).length, '모르는 코드의 기록이 화면에서 사라졌다').toBeGreaterThan(0);
  });
});
