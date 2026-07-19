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

/* 2단계-D — SQLite 경로가 **진짜 WebView2 안에서** JSON 정본과 일치하는가.

   왜 여기서만 검증 가능한가: `dbRows.test.ts` 는 매퍼 왕복을 순수 함수로 잠갔지만, 그 사이의
   SQL 층(타입 강제 변환·NULL 처리·트랜잭션·마이그레이션 적용)은 **실제 디스크를 왕복해야만**
   드러난다. `cargo check` 도 `tauri build` 도 이걸 원리적으로 못 잡는다 — 1단계에서 "빌드
   녹색인데 앱이 죽어 있던" 결함 3건이 나온 것과 정확히 같은 자리다. */
test('2단계-D — SQLite 경로가 JSON 정본과 일치한다(양방향 대조)', async () => {
  const shell = await launchShell();
  try {
    // 편집을 한 번 일으켜 flush → mirrorAndVerify 를 태운다(테마 토글 = 실제 사용자 제스처).
    await shell.page.getByRole('button', { name: /테마 전환/ }).click();
    await shell.page.waitForTimeout(1200); // 디바운스 400ms + SQL 왕복

    // 프런트가 들고 있는 상태를 SQLite 가 그대로 되돌려주는지 **DB 를 직접 읽어** 확인한다.
    const parity = await shell.page.evaluate(async () => {
      const w = window as unknown as {
        __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<unknown> };
      };
      const sel = (query: string) =>
        w.__TAURI_INTERNALS__.invoke('plugin:sql|select', { db: 'sqlite:learning-hub.db', query, values: [] });
      const settings = (await sel('SELECT key, value FROM settings')) as { key: string; value: string }[];
      const meta = (await sel('SELECT key, value FROM meta')) as { key: string; value: string }[];
      const live = JSON.parse(localStorage.getItem('study_planner_v3') || '{}') as Record<string, unknown>;
      const theme = settings.find((r) => r.key === 'theme');
      return {
        rows: settings.length,
        present: meta.length,
        themeMatches: !!theme && JSON.parse(theme.value) === live.theme,
        // 행 슬라이스로 안 간 스칼라들이 실제로 settings 에 있는가(스키마가 붙었다는 증거).
        hasStartDate: settings.some((r) => r.key === 'startDate'),
      };
    });

    expect(parity.rows, 'settings 행이 0 = 마이그레이션이나 쓰기가 안 돌았다').toBeGreaterThan(0);
    expect(parity.present, "meta['present'] 이 없으면 빈 슬라이스 구분이 깨진다").toBeGreaterThan(0);
    expect(parity.hasStartDate).toBe(true);
    expect(parity.themeMatches, 'SQLite 의 theme 이 localStorage 정본과 다르다').toBe(true);

    // 원복 — 이 테스트는 실제 앱 저장소를 쓴다.
    await shell.page.getByRole('button', { name: /테마 전환/ }).click();
    await shell.page.waitForTimeout(700);
  } finally {
    await closeShell(shell);
  }
});

/* 2단계-C 측정 — **비동기 쓰기가 창 닫기에서 살아남는가.**

   설계 §8 은 "flush 가 비동기(invoke)가 되면 `pagehide` 는 동기 핸들러만 보장하므로 await 가
   잘린다"며 `onCloseRequested` 훅 + `core:window:allow-destroy` 를 요구한다. 그건 **명세의
   진술**이지 관측이 아니다 — 1단계에서 똑같은 형태의 추론("pagehide 발화가 보장되지 않는다")이
   실측에서 뒤집혀 훅 하나를 만들었다가 되돌린 이력이 있다. 그때 그 훅은 창이 영영 안 닫히는
   실패 경로를 실제로 만들었다.

   그래서 훅을 짓기 **전에** 잰다. 지금은 정본이 아직 localStorage 라 이 테스트가 빨간불이어도
   사용자 데이터는 안전하다 — 측정하기에 정확히 좋은 시점이고, 2단계-E 에서 정본이 뒤집히면
   이 계약이 곧 데이터 보존 계약이 된다. */
test('2단계-C — 디바운스 대기 중 창을 닫아도 비동기 SQL 쓰기가 살아남는가', async () => {
  let shell: Shell = await launchShell();
  const readSqlTheme = (s: Shell) =>
    s.page.evaluate(async () => {
      const w = window as unknown as {
        __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<unknown> };
      };
      // ⚠ 먼저 연결을 연다 — `getDb()` 는 지연 로드라 편집이 한 번도 없던 세션에선 DB 가
      // 아직 안 열려 있고, 그 상태로 select 하면 "database not loaded" 로 죽는다.
      // (2단계-E 에서 부팅 읽기 경로가 생기면 앱이 이걸 먼저 하게 된다.)
      await w.__TAURI_INTERNALS__.invoke('plugin:sql|load', { db: 'sqlite:learning-hub.db' });
      const rows = (await w.__TAURI_INTERNALS__.invoke('plugin:sql|select', {
        db: 'sqlite:learning-hub.db',
        query: "SELECT value FROM settings WHERE key = 'theme'",
        values: [],
      })) as { value: string }[];
      const ls = JSON.parse(localStorage.getItem('study_planner_v3') || '{}') as { theme?: string };
      return { sql: rows[0] ? (JSON.parse(rows[0].value) as string) : undefined, ls: ls.theme };
    });

  try {
    const before = await readSqlTheme(shell);
    await shell.page.getByRole('button', { name: /테마 전환/ }).click();
    // 디바운스(400ms)가 끝나기 전에 닫는다 — 이게 이 측정의 전부다.
    await closeShell(shell);

    shell = await launchShell();
    const after = await readSqlTheme(shell);
    // localStorage 를 함께 보는 이유: 둘 다 안 바뀌었으면 flush 자체가 안 돈 것이고,
    // localStorage 만 바뀌었으면 **비동기 SQL 쓰기만** 잘린 것이다. 원인이 갈린다.
    expect(after.ls, '동기 localStorage 조차 안 저장됐다 — flush 경로가 아예 안 돌았다').not.toBe(before.ls);
    expect(after.sql, '비동기 SQL 쓰기가 창 닫기에서 잘렸다 → 닫기 가드가 안 걸렸다').not.toBe(before.sql);

    // 원복.
    await shell.page.getByRole('button', { name: /테마 전환/ }).click();
    await shell.page.waitForTimeout(900);
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
