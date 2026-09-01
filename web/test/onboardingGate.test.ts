/* ============================================================
   onboardingGate.test.ts — 온보딩 완료 판정이 **자기 자신으로 충족되지 않는다**(W1 · H20).

   ## 왜 이 파일이 따로 있나

   이 결함은 두 번 나왔고 두 번 다 "코드가 틀렸다"기보다 **계약이 한 군데에만 적혀 있었다**:

   · W1(2026-07-31 발산) — `makeItem` 기본 `weeklyHours: 3` 때문에 `+ 첫 과목 추가` 한 번에
     온보딩 3단계 중 2단계가 동시에 켜지고 스크림이 영구히 걷혔다. 시각적으로 지배적인 primary
     버튼이 곧 막다른 길이었고, 실 사용자 DB 가 정확히 그 지문을 갖고 있었다(과목 1 · 챕터 0 ·
     `weeklyHours: 3` · 활동 표 전부 0행).
   · H20(2026-07-31 `/감사 근본`) — 그 수정이 **`Items.addItem` 한 호출부에만** 들어가, `Degree`
     로 수강 과목을 먼저 추가하는 경로에는 팬텀 3h/주가 그대로 붙어 같은 결함이 살아 있었다.

   즉 진짜 계약은 **"생성부는 사용자가 정하지 않은 목표를 만들지 않는다"** 이고, 그건 호출부가
   아니라 `makeItem` 의 성질이다. 여기가 그 집행자다 — 기본값이 다시 올라가면 빨개진다.

   ⚠ 판정식(`setupComplete`)은 **일부러 안 비튼다**: 비틀면 "3시간을 직접 고른 사용자"까지
   미완으로 읽는다. 고칠 자리는 생성부라는 것이 이 파일의 요지다.
============================================================ */
import { describe, expect, it } from 'vitest';
import { makeItem } from '@/lib/utils';
import { setupComplete } from '@/features/today/SetupGuide';
import type { AppState } from '@/lib/schema';

const items = (...xs: ReturnType<typeof makeItem>[]): AppState['items'] => xs as AppState['items'];

describe('생성부는 사용자가 정하지 않은 목표를 만들지 않는다', () => {
  it('⚠ `makeItem` 기본은 `weeklyHours: 0` — 3 이면 과목 생성이 곧 목표 설정이 된다', () => {
    expect(makeItem({ name: '새 과목' }).weeklyHours).toBe(0);
  });

  it('과목만 하나 만들면 온보딩은 **미완**이다(그래야 임포트 안내가 계속 보인다)', () => {
    expect(setupComplete(items(makeItem({ name: '새 과목' })))).toBe(false);
  });

  it('⚠ 학위(수강) 경로도 마찬가지다 — H20 이 정확히 이 문이었다', () => {
    // `Degree.tsx` 는 partial 에 목표를 안 싣는다 → 기본값이 그대로 판정에 들어간다.
    expect(setupComplete(items(makeItem({ source: '수강', name: '선형대수' })))).toBe(false);
  });

  it('사용자가 실제로 정하면 완료된다 — 판정식은 그대로다', () => {
    expect(setupComplete(items(makeItem({ name: '미적분', weeklyHours: 3 })))).toBe(true);
  });

  it('일일 과목(Anki)은 `dailyMin` 이 사용자가 고른 값이라 완료로 친다', () => {
    expect(setupComplete(items(makeItem({ source: 'Anki', name: '단어', mode: 'daily', dailyMin: 20 })))).toBe(true);
  });

  it('볼트 임포트는 챕터가 곧 목표다 — 그 경로는 막히면 안 된다', () => {
    expect(
      setupComplete(
        items(makeItem({ source: '볼트', name: '회로이론', chapters: [{ id: 'c1', name: '1장' } as never] })),
      ),
    ).toBe(true);
  });
});
