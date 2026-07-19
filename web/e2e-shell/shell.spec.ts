/* ============================================================
   shell.spec.ts — 트랙 B 스모크(설계 §4-1단계: "창 뜸 · 라우팅 · IPC 왕복 · 종료 시 flush").

   여기 있는 건 전부 **트랙 A 가 원리적으로 못 잡는 것**이다. A 는 Chromium 으로 `vite preview` 를
   찍으므로 WebView2 렌더·Tauri IPC·창 종료 같은 건 존재하지도 않는다.
============================================================ */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
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
      // 2단계-E 이후 셸에선 localStorage 를 안 쓴다 — 살아 있는 정본은 화면에 반영된 테마다
      // (ThemeProvider 가 data-theme 로 내린다). "저장된 값 = 보이는 값"이 곧 정본 일치.
      const live = document.documentElement.getAttribute('data-theme');
      const theme = settings.find((r) => r.key === 'theme');
      return {
        rows: settings.length,
        present: meta.length,
        themeMatches: !!theme && JSON.parse(theme.value) === live,
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

/* 3단계 — 볼트를 **묻지 않고 읽고**, 파일이 바뀌면 **스스로 갱신되는가.**

   트랙 A 가 원리적으로 못 잡는 것: 브라우저엔 파일 감시(watch)가 없다. 이건 FSA 의 한계라
   폴리필도 없고, 설계 §10 이 OPFS 대안을 탈락시킨 근거이기도 하다. 즉 이 기능의 존재 자체가
   셸에서만 검증 가능하다. */
test('3단계 — 볼트를 폴더 선택 없이 읽고, 파일 변경에 자동 갱신된다', async () => {
  const shell = await launchShell();
  try {
    await shell.page
      .getByRole('button', { name: /통합|연동/ })
      .first()
      .click();

    // ① 폴더를 고르지 않았는데도 스캔 결과가 뜬다 — workspace.rs 가 볼트 위치를 알기 때문.
    const line = shell.page.getByText(/감시 중/);
    await expect(line, '폴더 선택 없이 자동으로 읽지 못했다').toBeVisible({ timeout: 15_000 });

    // 실제 볼트를 읽었는지 — 노트가 0이면 경로만 맞고 내용은 못 읽은 것이다.
    const info = await shell.page.evaluate(async () => {
      const w = window as unknown as {
        __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<unknown> };
      };
      const r = (await w.__TAURI_INTERNALS__.invoke('vault_scan')) as { notes: unknown[]; src: string; path: string };
      return { count: r.notes.length, src: r.src, path: r.path };
    });
    expect(info.count, '볼트에서 노트를 하나도 못 읽었다').toBeGreaterThan(0);
    expect(info.path).toContain('knowledge');

    /* ② 파일이 바뀌면 **버튼을 누르지 않아도** 갱신된다 — 이 단계의 핵심이자, 브라우저에선
       원리적으로 불가능한 동작(FSA 에 watch 가 없다).
       ⚠ 사용자의 실제 볼트를 쓰므로 **내용을 바꾸지 않는다**: 정본 인덱스를 읽어 **같은 바이트로
       다시 쓴다**. mtime 만 갱신돼 notify 가 울고, 데이터는 한 글자도 변하지 않는다. */
    const before = (await line.textContent()) ?? '';
    await new Promise((r) => setTimeout(r, 1100)); // 표시 시각이 '초' 단위라 같은 초면 구분이 안 된다
    const idx = path.join(info.path, '_meta', 'cache', '_index.json');
    writeFileSync(idx, readFileSync(idx)); // 동일 내용 재기록 = 무해한 변경 이벤트

    await expect.poll(async () => (await line.textContent()) ?? '', { timeout: 20_000 }).not.toBe(before);
  } finally {
    await closeShell(shell);
  }
});

/* 2단계-C — **비동기 쓰기가 창 닫기에서 살아남는가.**

   ▶ 이 케이스가 1단계의 "종료 시 flush" 테스트를 **대체**한다. 그쪽은 같은 계약("디바운스 대기 중
   창을 닫아도 마지막 편집이 산다")을 localStorage 에서 확인했는데, 2단계-E 로 정본이 SQLite 가
   되면서 확인 대상도 여기로 옮겨졌다. 둘을 다 두면 같은 계약을 두 벌로 재는 것이라 합쳤다.

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
      return rows[0] ? (JSON.parse(rows[0].value) as string) : undefined;
    });

  try {
    const before = await readSqlTheme(shell);
    await shell.page.getByRole('button', { name: /테마 전환/ }).click();
    // 편집 직후 곧바로 닫는다 — 저장이 아직 진행 중일 때 창이 죽는 상황을 만든다.
    await closeShell(shell);

    /* ⚠ "저장이 아직 진행 중이었다"를 **관측으로는 증명하지 않는다.** 두 시도 다 실패했다:
       ① 닫기 직전에 저장소를 읽으면 그 읽기(플러그인 로드 + select)가 디바운스보다 오래 걸려
          *관측 행위가 관측 대상을 바꾼다*. ② 클릭→닫기 경과를 재 봤더니 `closeShell` 자체가
          400ms 를 넘어 항상 실패한다. 애초에 취약 구간은 디바운스가 아니라 **SQL 쓰기 소요시간**이라
          시간으로 가둘 대상이 아니었다.
       대신 이 테스트의 판별력은 **경험적으로 확인됐다**: 닫기 가드가 없던 빌드에서 이 케이스는
       실제로 빨간불이었고(비동기 쓰기가 잘렸다), 가드를 넣자 녹색이 됐다. 다시 빨간불이 되면
       그건 가드가 깨졌다는 뜻이다. */

    shell = await launchShell();
    const after = await readSqlTheme(shell);
    expect(after, '비동기 SQL 쓰기가 창 닫기에서 잘렸다 → 닫기 가드가 안 걸렸다').not.toBe(before);

    // 원복.
    await shell.page.getByRole('button', { name: /테마 전환/ }).click();
    await shell.page.waitForTimeout(900);
  } finally {
    await closeShell(shell);
  }
});

/* 4단계-B — 산출물 8종을 **serve.js 없이** 셸이 직접 읽는가.

   왜 여기서만 검증 가능한가: `artifact.rs` 의 단위 테스트는 임시 폴더에 내가 만든 파일을 읽는다
   — 즉 "코드가 시키는 대로 하는가"만 본다. 정작 이 단계가 고친 결함은 **경로 기준이 파일을 쓰는
   쪽(파이썬)과 갈려 있던 것**이라, 진짜 워크스페이스의 진짜 산출물을 읽어야만 드러난다.
   (serve.js 는 `reads`·`markets` 를 자기 폴더 기준으로 찾아 배포본에서 늘 빈손이었다.) */
test('4단계-B — 산출물을 셸이 직접 읽는다(워크스페이스 기준 경로)', async () => {
  const shell = await launchShell();
  try {
    const read = (name: string) =>
      shell.page.evaluate(async (n) => {
        const w = window as unknown as {
          __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<unknown> };
        };
        try {
          return { ok: true, out: await w.__TAURI_INTERNALS__.invoke('artifact_read', { name: n }) };
        } catch (e) {
          return { ok: false, err: String(e) };
        }
      }, name);

    // 볼트 파생물 — 워크스페이스 기준. serve.js 도 여기는 맞게 보고 있었다.
    const knowledge = await read('knowledge');
    expect(knowledge.ok, `knowledge 읽기 실패: ${knowledge.err}`).toBe(true);
    expect((knowledge.out as { ok: boolean; data?: unknown }).data).toBeTruthy();

    // ⚠ 이 두 줄이 이 케이스의 존재 이유다 — serve.js 기준(자기 폴더)이었으면 배포본에서 빈손이다.
    for (const name of ['reads', 'markets']) {
      const r = await read(name);
      expect(r.ok, `${name} 읽기 실패(경로 기준이 수집기와 갈렸다): ${r.err}`).toBe(true);
      expect((r.out as { ok: boolean; data?: unknown }).data).toBeTruthy();
    }

    // 화이트리스트 밖·미생성은 같은 접두로 거부한다(프런트가 '미생성'으로 분류하는 키).
    const bogus = await read('../../etc/passwd');
    expect(bogus.ok).toBe(false);
    expect(bogus.err).toContain('NOT_FOUND');
  } finally {
    await closeShell(shell);
  }
});

/* 4단계-C — 파이썬 도구를 셸이 직접 spawn 하는가.

   Rust 단위 테스트는 캡·인자 정제·출력 절단 같은 **순수 부분**만 잠근다. 정작 여기서만
   드러나는 것들이 있다: python 이 PATH 에서 잡히는가 · cwd 가 워크스페이스인가(틀리면 도구가
   조용히 빈 결과를 낸다 — 이 앱에서 가장 진단하기 어려운 실패) · PYTHONIOENCODING 이 실제로
   한글 stdout 을 지키는가 · 파이프를 양쪽 다 읽어 교착하지 않는가.

   읽기 전용 도구(`vault-stats`)를 고른 이유는 사용자 볼트를 훼손하지 않기 위해서다. */
test('4단계-C — 파이썬 도구를 셸이 직접 실행한다(cwd·인코딩·파이프)', async () => {
  const shell = await launchShell();
  try {
    const run = (tool: string, subject: string | null = null) =>
      shell.page.evaluate(
        async ([t, s]) => {
          const w = window as unknown as {
            __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<unknown> };
          };
          try {
            return { threw: false, out: await w.__TAURI_INTERNALS__.invoke('run_tool', { tool: t, subject: s }) };
          } catch (e) {
            return { threw: true, err: String(e) };
          }
        },
        [tool, subject] as const,
      );

    const r = await run('vault-stats');
    expect(r.threw, `도구 실행이 거부됐다: ${r.err}`).toBe(false);
    const out = r.out as { ok: boolean; out: string; code: number; label: string };
    expect(out.label).toBe('볼트 통계');
    // cwd 가 워크스페이스가 아니면 python 이 스크립트를 못 찾아 code≠0 + 빈 stdout 이 된다.
    expect(out.code, `도구가 실패했다(cwd 가 워크스페이스가 아닐 수 있다): ${out.out}`).toBe(0);
    expect(out.out.length).toBeGreaterThan(0);
    // PYTHONIOENCODING 이 안 걸리면 한글이 ?/mojibake 로 깨지거나 python 이 UnicodeEncodeError 로 죽는다.
    expect(out.out).not.toContain('�');
    expect(out.out).toMatch(/[가-힣]/);

    // 화이트리스트 밖은 spawn 자체를 안 한다.
    const bogus = await run('rm-rf');
    expect(bogus.threw).toBe(true);
    expect(bogus.err).toContain('알 수 없는 도구');
  } finally {
    await closeShell(shell);
  }
});
