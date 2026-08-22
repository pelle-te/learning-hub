/* ============================================================
   importAnkiDeck.test.ts — **입구가 둘인 규칙은 함수가 하나여야 한다**(C037 · 2026-08-22).

   ## 무엇이 틀렸었나

   `features/integrations/AnkiPanel.tsx` 와 `features/items/VaultImport.tsx` 가 11줄짜리
   `addAnki` 를 **각자** 들고 있었다(`diff` 결과 차이는 람다 인자 이름 한 글자뿐 · 테스트 0건).
   바로 위 형제는 이미 고쳐져 있었다 — 볼트 임포트는 H22 가 `shell/importVaultSubject` 로 모으며
   *"입구가 둘이지만 규칙은 하나다"* 를 못박았는데, 같은 자리의 Anki 쪽만 남아 있었다.

   ## 왜 이 파일이 필요한가 — 사본이 갈리면 무엇이 깨지나

   중복 판정이 `items.some(x => x.name === 'Anki: ' + name)` 이다. 접두를 떼거나
   `source:'Anki'` 기준으로 바꾸는 변경이 오면 **고친 화면 하나만** 바뀐다 → 과목 탭에서 덱을
   넣은 뒤 연동 탭에서 같은 덱을 넣으면 판정이 빗나가 `mode:'daily'` 항목이 **둘** 생기고,
   스케줄러가 그 `dailyMin` 을 **두 번 예산에 넣는다**(매일 배정 시간이 조용히 두 배).
   타입·린트·번들이 전부 통과한다 — 그래서 여기가 그 유일한 그물이다.

   ⚠ 화면을 렌더하지 않는다. 규칙이 `shell/` 로 내려온 것이 이 항목의 처방이고, 그래서
   **렌더 없이 도달 가능**해졌다는 것 자체가 검증 대상이다(근본 원인 R3 의 반대 방향).
============================================================ */
import { beforeEach, describe, expect, it } from 'vitest';
import { importAnkiDeck } from '@/shell/actions';
import { useApp } from '@/store/useApp';

const 항목들 = () => useApp.getState().state.items;
const 이름들 = () => 항목들().map((i) => i.name);

beforeEach(() => {
  useApp.getState().mutate((st) => {
    st.items.length = 0;
  });
});

describe('importAnkiDeck — 두 입구가 공유하는 한 규칙', () => {
  it('덱을 매일 복습 항목으로 들인다 — 이름에 `Anki: ` 접두가 붙는다', () => {
    expect(importAnkiDeck('전자기학', 20)).toBe(true);
    expect(이름들()).toEqual(['Anki: 전자기학']);
    const it0 = 항목들()[0]!;
    expect(it0.mode).toBe('daily');
    expect(it0.dailyMin).toBe(20);
    expect(it0.source).toBe('Anki');
  });

  it('⚠⚠ 같은 덱을 두 번 들이지 않는다 — 두 입구를 오가면 dailyMin 이 두 번 예산에 든다', () => {
    importAnkiDeck('전자기학', 20); // 과목 탭에서
    expect(importAnkiDeck('전자기학', 30), '두 번째 입구에서 중복 판정이 빗나갔다').toBe(false);
    expect(항목들(), '같은 덱이 두 항목이 됐다 — 매일 배정 시간이 두 배가 된다').toHaveLength(1);
    expect(항목들()[0]!.dailyMin, '두 번째 호출이 값을 덮어써도 안 된다').toBe(20);
  });

  it('다른 덱은 각각 들어간다 — 중복 판정이 과하게 넓지 않다', () => {
    importAnkiDeck('전자기학', 20);
    importAnkiDeck('회로이론', 15);
    expect(이름들()).toEqual(['Anki: 전자기학', 'Anki: 회로이론']);
  });

  it('접두가 규칙의 일부다 — 접두 없는 동명 항목과 충돌하지 않는다', () => {
    useApp.getState().mutate((st) => {
      st.items.push({ id: 'x', name: '전자기학', mode: 'weekly', weeklyHours: 3, chapters: [] } as never);
    });
    expect(importAnkiDeck('전자기학', 20), '볼트 과목과 Anki 덱은 다른 항목이다').toBe(true);
    expect(이름들()).toEqual(['전자기학', 'Anki: 전자기학']);
  });
});
