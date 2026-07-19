/* ============================================================
   shell.spec.ts — 트랙 B 스모크(설계 §4-1단계: "창 뜸 · 라우팅 · IPC 왕복 · 종료 시 flush").

   여기 있는 건 전부 **트랙 A 가 원리적으로 못 잡는 것**이다. A 는 Chromium 으로 `vite preview` 를
   찍으므로 WebView2 렌더·Tauri IPC·창 종료 같은 건 존재하지도 않는다.
============================================================ */
import { expect, test } from '@playwright/test';
import { closeShell, ensureNoStrayShell, launchShell, sidecarAlive, type Shell } from './shellApp';

test.afterAll(async () => {
  await ensureNoStrayShell();
});

test('창이 뜨고 WebView2 가 앱을 렌더한다', async () => {
  const shell = await launchShell();
  try {
    // 백지(JS 에러로 부팅 실패)가 아니라 실제 셸 크롬이 그려졌는가.
    await expect(shell.page.locator('nav, [role="navigation"]').first()).toBeVisible();
    await expect(shell.page).toHaveTitle(/러닝허브/);
    // sidecar 가 실제로 떴는가 — .bat 의 헬스체크 폴링을 Rust 가 승계한 자리.
    expect(sidecarAlive()).toBe(true);
  } finally {
    await closeShell(shell);
  }
});

test('IPC 왕복 — workspace_status 가 유효한 워크스페이스를 돌려준다', async () => {
  const shell = await launchShell();
  try {
    // `lib/tauri.ts` 가 부르는 것과 같은 커맨드. 이게 깨지면 파이썬 도구 11종의 cwd 가 틀어진다.
    const status = await shell.page.evaluate(async () => {
      const w = window as unknown as {
        __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<unknown> };
      };
      return (await w.__TAURI_INTERNALS__.invoke('workspace_status')) as {
        path: string | null;
        valid: boolean;
      };
    });
    expect(status.valid).toBe(true);
    // 표지(knowledge/·pipeline/)를 가진 폴더여야 한다 — workspace.rs 의 계약.
    expect(status.path).toBeTruthy();
  } finally {
    await closeShell(shell);
  }
});

test('라우팅 — 탭 이동이 셸 안에서 동작한다(해시/히스토리 라우팅이 file 오리진에서 깨지지 않는다)', async () => {
  const shell = await launchShell();
  try {
    // URL 은 **문서 안에서** 읽는다 — CDP 연결에선 Playwright 의 page.url() 이 실제 문서를 따라오지
    // 않는 경우가 있다(resolveAppPage 주석 참고). 라우팅 검증에 그 값을 쓰면 조용히 거짓 통과한다.
    const href = () => shell.page.evaluate(() => location.href);
    const before = await href();
    // 나브 항목은 링크가 아니라 button 이다(RailSidebar renderBtn) — role 을 틀리면 안 잡힌다.
    await shell.page.getByRole('button', { name: /통계/ }).first().click();
    await expect.poll(href, { timeout: 10_000 }).not.toBe(before);
    // 라우팅 후에도 앱이 살아 있는가(라우터 오류로 백지가 되는 것을 잡는다).
    await expect(shell.page.locator('main').first()).toBeVisible();
  } finally {
    await closeShell(shell);
  }
});

/* 이 파일의 핵심 — 설계 §8 "동기 flush 계약 파괴"가 가리키던 자리.

   설계는 "Tauri 창 닫기에서 `pagehide` 발화가 보장되지 않아 `useApp` 언로드 안전망이 안 걸린다"고
   봤지만, 실측하니 WebView2 는 창 닫기에서 4개 이벤트를 **전부** 쏜다 → 기존 안전망이 그대로 산다
   (그래서 셸 전용 훅은 넣었다가 되돌렸다 · `lib/tauri.ts` 주석).

   그렇다고 이 테스트가 무의미한 건 아니다. **메커니즘이 아니라 계약을 잠근다** — "디바운스 대기 중
   창을 닫아도 마지막 편집이 살아남는다". 그 계약이 어느 이벤트로 지켜지는지는 구현 자유고,
   2단계에서 flush 가 비동기가 되면 `pagehide` 로는 못 지켜져 여기서 **빨간불이 켜져야 한다**.
   그때 이 테스트가 "훅이 이제 필요하다"를 알려주는 신호가 된다. */
test('종료 시 flush — 디바운스 대기 중 창을 닫아도 마지막 편집이 살아남는다', async () => {
  let shell: Shell = await launchShell();
  const KEY = 'study_planner_v3';

  const readTheme = async (s: Shell) =>
    s.page.evaluate((k) => {
      const raw = localStorage.getItem(k);
      return raw ? (JSON.parse(raw) as { theme?: string }).theme : undefined;
    }, KEY);

  // 편집은 **실제 사용자 제스처**로 만든다 — 테스트용 훅을 프로덕션에 심으면 그 훅이 곧
  // 검사 대상과 다른 경로가 된다. 테마 토글은 useApp.mutate → 400ms 디바운스를 그대로 탄다.
  const toggleTheme = (s: Shell) => s.page.getByRole('button', { name: /테마 전환/ }).click();

  try {
    const before = await readTheme(shell);
    await toggleTheme(shell);

    // 저장 전인지 확인 — 이미 영속됐다면 이 테스트는 안전망이 없어도 통과해 의미가 없다.
    const midflight = await shell.page.evaluate((k) => {
      const raw = localStorage.getItem(k);
      return raw ? (JSON.parse(raw) as { theme?: string }).theme : undefined;
    }, KEY);
    expect(midflight, '토글 직후엔 아직 디바운스 대기 중이어야 한다').toBe(before);

    // ⚠ 디바운스가 끝나기 전에 닫아야 이 테스트가 의미가 있다.
    await closeShell(shell);

    // 다시 띄워서 디스크에 남았는지 확인 — 안전망이 없으면 여기서 `before` 가 나온다.
    shell = await launchShell();
    const after = await readTheme(shell);
    expect(after, '창 닫기에서 flush 되지 않아 마지막 편집이 유실됐다').not.toBe(before);

    // 사용자 데이터를 건드렸으니 되돌린다(이 테스트는 실제 앱 저장소를 쓴다).
    await toggleTheme(shell);
    await shell.page.waitForTimeout(700); // 디바운스 소진까지 대기
    expect(await readTheme(shell)).toBe(before);
  } finally {
    await closeShell(shell);
  }
});
