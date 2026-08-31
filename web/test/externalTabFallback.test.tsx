// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { renderApp } from './_render';

/* ============================================================
   externalTabFallback — **백엔드가 없을 때 외부 데이터 탭이 우아하게 안내하는가.**

   ⚠ 옛 이름은 `phase5.test.tsx` 였다(2026-08-20 리뷰 m-19). 시점 라벨은 *무엇을 지키는지*를
   이름이 말하지 못하고, 실제로 이 파일의 전제 둘이 사문화돼 있었다:
   · *"jsdom엔 serve.js(/api)가 없으므로"* — `serve.js` 는 **4단계에서 삭제됐다.** 지금 없는 것은
     그 프로세스가 아니라 **Rust 커맨드**다(브라우저엔 `invoke` 가 없다). 결과는 같지만 이유가 다르고,
     틀린 이유는 다음 사람을 삭제된 파일로 보낸다.
   · *"서버/외부 탭(integrations·**mastery**)"* — `mastery` 는 A-19(2026-08-07)에 `role:'view'`(옛 `retired`) 가
     됐다(`shell/tabs.ts`). 이 파일은 여전히 그 경로를 렌더하는데, 그건 라우트가 `<Navigate>` 로
     살아 있기 때문이지 그 탭이 현역이어서가 아니다.

   잠그는 명제: **백엔드가 없어도 흰 화면이 아니라 안내가 뜬다.** Query 는 isError 로 떨어지고
   화면은 셋업 카드로 폴백한다(`components/State` 의 `kind='error'|'empty'`).
============================================================ */

afterEach(() => cleanup());

/* ⛔⛔ 2026-08-29 — `mastery` 케이스가 사라졌다. 그 화면이 읽던 지식상태 산출물이 **생산자째**
   삭제됐고(부모 pipeline 목적 정정: 「전공 교재 → 원자형 노트」만 진다) 화면·로스터 행도 함께
   은퇴했다. 즉 «백엔드가 없어서 콜드»가 아니라 **영원히 안 채워진다** — 이 파일이 잠그는
   계약(서버 없이도 우아하게 안내)의 대상이 아니게 됐다.
   ⚠ `control`(탐구 수집)이 P10 W4 에서 같은 형태로 빠졌다(2026-08-07 · 화면이 `survey/` 로 갔다).
   그래서 이제 이 계약을 지는 것은 **`integrations` 하나**다. */
test('integrations: 볼트·Anki 두 패널이 렌더된다(#page 미사용)', async () => {
  await renderApp('/integrations');
  await waitFor(() => expect(screen.getByRole('heading', { name: '옵시디언 볼트 현황' })).toBeInTheDocument());
  expect(screen.getByRole('heading', { name: 'Anki 현황' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /AnkiConnect 실시간 due/ })).toBeInTheDocument();
  expect(document.getElementById('page')).toBeNull();
});
