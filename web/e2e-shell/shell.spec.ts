/* ============================================================
   shell.spec.ts — 트랙 B 스모크.

   ## 여기 남는 기준 (2026-07-20 층 재배치)

   **"WebView2 안에서만 존재하는 것"만 남긴다.** 그 밖은 전부 `cargo test` 로 내려갔다.

   내려간 이유를 정확히 적어 둔다. 옛 케이스들의 주석은 하나같이 "유닛 테스트는 내가 만든
   임시 폴더를 읽으니 못 잡는다"고 논증했는데, 그 논증이 정당화하는 것은 **실물(진짜 워크스페이스·
   진짜 DB)을 상대하는 통합 테스트**지 *앱 창을 띄우는 것*이 아니었다. 창을 테스트 하네스로 쓰고
   있었고, 대가로 케이스마다 exe 를 띄웠다 내려 회당 기동이 19번이었다(앞에 릴리스 빌드가 붙었다).

   지금 그것들은 `src-tauri/src/` 각 모듈의 `#[cfg(test)]` 안에서 **초 단위**로 돈다:
   · 산출물 경로       → `artifact.rs` (실 워크스페이스)
   · 파이썬 도구       → `tools.rs`    (실 cwd·인코딩·파이프)
   · 볼트 읽기·감시    → `vault.rs`    (실 볼트 + notify 실발화)
   · ⚠ 'Anki 덱 스캔'(`anki_scan.rs`)은 2026-09-01 에 사라졌다 — 부모가 Anki 축을 은퇴하며
     그 스캔이 읽던 두 원천(`_index.json.anki`·`anki/*.txt`)이 모두 없어졌다(C072).
   · ⚠ '탐구 잡 이력·중단'(`research.rs`)은 P10 W4 에서 사라졌다 — 그 모듈이 `survey/` 로 갔다.
   · 서버·WAL 동시성   → `server.rs`   (진짜 소켓 + 쓰기 풀 보유 중 읽기)
   · 실 DB 스탬프      → `db.rs`       (updated_at=0 검사)
   근거와 공용 헬퍼는 `src-tauri/src/testkit.rs` 머리주석.

   ## 여기 남은 것

   창이 뜨는가 · 라우팅 · IPC 왕복(Channel 포함) · 종료 시 flush · 커맨드 등록.
   전부 **트랙 A 도 `cargo test` 도 원리적으로 못 보는 것**이다 — A 는 Chromium 으로
   `vite preview` 를 찍어 WebView2·CSP·Tauri IPC 가 존재하지도 않고, cargo 는 프런트가 없다.

   스냅샷은 안 찍는다(픽셀 회귀는 트랙 A 의 몫 — 베이스라인 두 벌 방지).
============================================================ */
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  closeShell,
  closeSharedShell,
  e2eDataDir,
  ensureNoStrayShell,
  launchShell,
  sharedShell,
  type Shell,
} from './shellApp';
import { 계단인가, 기준선기록 } from '../e2e/_perfBaseline';

test.afterAll(async () => {
  await closeSharedShell();
  await ensureNoStrayShell();
});

/** 웹뷰 안에서 커맨드를 부른다 — 던지면 봉투로 받아 단언에 쓴다. */
const ipc = (shell: Shell, cmd: string, args: unknown = {}) =>
  shell.page.evaluate(
    async ([c, a]) => {
      const w = window as unknown as {
        __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<unknown> };
      };
      try {
        return { threw: false, out: await w.__TAURI_INTERNALS__.invoke(c as string, a) };
      } catch (e) {
        return { threw: true, err: String((e as Error)?.message || e) };
      }
    },
    [cmd, args] as const,
  );

/* ── 공유 셸을 쓰는 케이스들 ───────────────────────────────────────────────
   아래 넷은 앱 상태를 되돌릴 수 없게 바꾸지 않으므로 **창 하나를 함께 쓴다**. */

test('창이 뜨고 WebView2 가 앱을 렌더한다', async () => {
  const shell = await sharedShell();
  // 백지(JS 에러로 부팅 실패)가 아니라 실제 셸 크롬이 그려졌는가.
  await expect(shell.page.locator('nav, [role="navigation"]').first()).toBeVisible();
  await expect(shell.page).toHaveTitle(/러닝허브/);
});

test('라우팅 — 탭 이동이 셸 안에서 동작한다(히스토리 라우팅이 tauri 오리진에서 안 깨진다)', async () => {
  const shell = await sharedShell();
  /* URL 은 **문서 안에서** 읽는다 — CDP 연결에선 Playwright 의 page.url() 이 실제 문서를
     따라오지 않는 경우가 있다(`resolveAppPage` 주석 참고). 그 값으로 라우팅을 검증하면
     조용히 거짓 통과한다. */
  const href = () => shell.page.evaluate(() => location.href);
  const before = await href();
  /* 나브 항목은 링크가 아니라 button 이다(RailSidebar renderBtn) — role 을 틀리면 안 잡힌다.
     ⚠⚠ **좌표가 바뀌었다 — 축 접기(2026-08-28).** `통계` 는 접힌 축 안이라 `/today` 에서 보이지
     않는다(종전엔 상시 15줄이라 아무 줄이나 눌러도 됐다). 그 축의 **헤더**를 누르면 얼굴인
     `통계` 로 이동한다 — 아래 `route_visits` 단언이 `via='rail'` 을 그대로 요구하므로, 헤더가
     `go()` 를 안 타고 접기만 하는 형태로 퇴화하면 여기서 즉시 잡힌다. */
  await shell.page
    .getByRole('button', { name: /무엇을 아는가/ })
    .first()
    .click();
  await expect.poll(href, { timeout: 10_000 }).not.toBe(before);
  // 라우팅 후에도 앱이 살아 있는가(라우터 오류로 백지가 되는 것을 잡는다).
  await expect(shell.page.locator('main').first()).toBeVisible();

  /* N-11 방문 원장 — **방금 그 클릭이 실제로 행이 됐는가.**

     이 자리여야 하는 이유: `dbMigrations.test.ts` 는 SQL 을(node:sqlite 로), `visits.test.ts`
     는 분류 규칙을 잠그지만, **배선**(레일 클릭 → markVia → App 이펙트 → SQLite)은 어디에도
     안 걸린다. 브라우저에선 `getDb()` 가 null 이라 트랙 A 가 원리적으로 못 보고, cargo 는
     프런트가 없다. 배선이 끊기면 표는 영원히 비어 있는데 **아무 에러도 안 난다** — 그리고
     이 표의 목적이 "빈 것과 안 센 것을 구분하는 것"이라 그 침묵이 특히 위험하다.

     ⚠ `via` 까지 단언한다. 행 수만 보면 전부 `link` 로 떨어져도 통과하는데, 진입 경로를
     쪼개는 것이 이 표의 존재 이유다(합계는 접근성의 함수라 결정 근거가 못 된다). */
  const visits = () =>
    shell.page.evaluate(async () => {
      const w = (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<unknown> } })
        .__TAURI_INTERNALS__;
      const db = (await w.invoke('db_url_cmd')) as string;
      await w.invoke('plugin:sql|load', { db });
      return (await w.invoke('plugin:sql|select', {
        db,
        query: "SELECT via, n FROM route_visits WHERE key = 'stats'",
        values: [],
      })) as { via: string; n: number }[];
    });
  await expect
    .poll(visits, { timeout: 10_000 })
    .toEqual([expect.objectContaining({ via: 'rail', n: expect.any(Number) })]);
});

/* IPC 왕복 — **커맨드가 등록돼 있고 웹뷰에서 실제로 닿는가.**

   커맨드의 *동작*은 전부 cargo 가 검사한다. 여기서 보는 것은 그 앞단, `generate_handler!`
   등록과 웹뷰↔Rust 다리다. 이게 끊기면 cargo 는 전부 녹색인데 앱은 아무것도 못 한다.

   ⚠ `save_text_file` 을 함께 확인하는 이유는 실사고 때문이다: `<a download>` 는 WebView2 에서
   **예외 없이 클릭되지만 파일이 어디에도 생기지 않았고**, 내보내기 6경로가 그 함수 하나에
   수렴하는데 그중 하나가 백업이라 한동안 조용히 백업이 안 되고 있었다. "호출이 성공했다"가
   아니라 **디스크에 있다**를 봐야 같은 부류를 다시 안 놓친다. */
test('IPC 왕복 — 커맨드가 등록돼 있고 웹뷰에서 실제로 닿는다', async () => {
  const shell = await sharedShell();

  const status = await ipc(shell, 'workspace_status');
  expect(status.threw, `workspace_status 가 안 닿는다: ${status.err}`).toBe(false);
  expect((status.out as { valid: boolean }).valid, '셸이 워크스페이스를 못 찾는다').toBe(true);

  // C-5 후속 — 클라우드 중계. 등록이 끊기면 동기화가 통째로 죽는다(전송이 CSP 에 막혀
  // Rust 중계로 내려온 경로라, 웹뷰에서 닿는지는 여기서만 확인된다).
  const cloud = await ipc(shell, 'cloud_http', {
    url: 'http://example.com/api/health', // 평문 원격 → 거부돼야 한다(거부 로직 자체는 cloud.rs 가 검사)
    method: 'GET',
    headers: {},
    body: null,
  });
  expect(cloud.err ?? '', 'cloud_http 가 등록되지 않았다(배선 회귀)').not.toMatch(/not found|not allowed/i);

  // 내보내기 — 위 ⚠ 참조. 실제로 디스크에 남는지까지 본다.
  const target = path.join(process.env.TEMP ?? '.', `lh-e2e-export-${process.pid}.json`);
  try {
    const saved = await ipc(shell, 'save_text_file', { path: target, contents: '{"과목":"미적분"}' });
    expect(saved.threw, `저장이 거부됐다: ${saved.err}`).toBe(false);
    expect(existsSync(target), '호출은 성공했는데 파일이 없다 — <a download> 와 같은 조용한 실패다').toBe(true);
    expect(readFileSync(target, 'utf8')).toBe('{"과목":"미적분"}');
  } finally {
    if (existsSync(target)) rmSync(target);
  }
});

/* 전역 캡처 단축키(E20) — **등록이 실제로 됐는가, 그리고 실패가 프런트까지 오는가.**

   여기여야 하는 이유: 전역 단축키는 **OS 에 등록**되므로 `cargo test` 가 원리적으로 못 본다
   (유닛은 상태 해석만 잰다 — `hotkey.rs` 의 테스트 주석). 그리고 트랙 A 에는 Tauri 가 없으니
   `capabilities` 자체가 없다. 즉 이 배선이 살았는지 물어볼 수 있는 곳이 **여기 하나**다.

   ⚠ **`hotkeyError` 라는 이름을 문자로 확인하는 것이 이 케이스의 절반이다.** Rust 필드는
   `hotkey_error`(snake) 이고 구조체엔 `rename_all` 이 없다 → `#[serde(rename)]` 을 빠뜨리면 JSON 은
   `hotkey_error` 인데 프런트는 `hotkeyError` 를 읽어 **영원히 `undefined`** 가 된다. 타입·빌드·
   스냅샷 전부 통과하고 화면은 "실패 없음"으로 보인다 — 그 조용한 형태를 이름으로 잠근다.
   ⚠ `hotkey === true` 를 단언하지 **않는다**: CI·개발기에서 다른 앱이 조합을 선점하고 있을 수 있고,
   그건 우리 결함이 아니다. 잠그는 것은 **필드가 존재하고 실패면 사유가 함께 온다**는 계약이다. */
test('전역 단축키 — 등록 상태가 capabilities 로 관측된다(실패도 사유와 함께)', async () => {
  const shell = await sharedShell();
  const cap = await ipc(shell, 'capabilities');
  expect(cap.threw, `capabilities 가 안 닿는다: ${cap.err}`).toBe(false);
  const out = cap.out as { hotkey?: boolean; hotkeyError?: string | null };

  // 필드가 존재한다 — 없으면 프런트의 HOTKEY 채널이 통째로 안 그려진다(관측 0으로 되돌아간다).
  expect(typeof out.hotkey, `capabilities.hotkey 가 없다 — 직렬화 회귀`).toBe('boolean');
  // 이름이 camelCase 로 나온다(위 ⚠). `null` 이어도 키는 있어야 한다.
  expect(Object.keys(out), 'hotkeyError 키가 camelCase 로 안 나온다').toContain('hotkeyError');

  /* 성공/실패는 환경에 달렸지만 **둘 사이의 계약**은 불변이다:
     등록됐으면 사유가 없고, 사유가 있으면 등록되지 않았다. 이 대칭이 깨지면 UI 가 거짓말한다. */
  if (out.hotkey) expect(out.hotkeyError ?? null, '등록됐는데 실패 사유가 있다').toBeNull();
  else if (out.hotkeyError) expect(out.hotkey, '사유가 있는데 등록됐다고 한다').toBe(false);
});

/* 데이터 폴더 격리(SD-6) — **이 하네스가 사용자의 실 DB 를 안 건드린다.**

   왜 여기여야 하나: `paths.rs` 유닛은 "환경변수가 있으면 이런 문자열을 만든다"까지만 잰다.
   실제로 걸렸는가는 **앱이 그 값으로 DB 를 열었는가**이고, 그건 부팅한 프로세스 안에서만
   관측된다. 이게 없으면 격리는 검증되지 않은 주장이고, 어느 날 조용히 풀려 있어도 모른다
   (env 오타 하나면 충분하다 — 그리고 실패 증상은 "테스트가 잘 돈다"이다).

   ⚠ 단언을 **경로 문자열 비교로** 한다. "임시 폴더에 파일이 있다"만 보면 앱이 두 DB 를 다
   열었어도 통과한다. */
test('데이터 폴더 격리 — 앱이 하네스가 준 폴더의 DB 를 연다(실 AppData 아님)', async () => {
  const shell = await sharedShell();
  const url = await ipc(shell, 'db_url_cmd');
  expect(url.threw, `db_url_cmd 가 안 닿는다: ${url.err}`).toBe(false);

  const dir = e2eDataDir();
  const expected = `sqlite:${path.join(dir, 'learning-hub.db')}`;
  expect(url.out, '앱이 격리 폴더가 아닌 곳의 DB 를 열고 있다 — 실 사용자 데이터가 노출된다').toBe(expected);

  // 그리고 실제로 그 자리에 생겼는가(마이그레이션이 override 경로에 적용됐다는 증거).
  await expect.poll(() => existsSync(path.join(dir, 'learning-hub.db')), { timeout: 15_000 }).toBe(true);
});

/* Channel 스트리밍 — **vitest 가 원리적으로 못 보는 자리.**

   유닛 테스트는 Channel 을 스텁으로 대체하므로 "실제 IPC 채널이 붙는가"는 검사 대상이 아니다.
   여기가 끊기면 생성은 성공하는데 **미리보기만 조용히 비는** 형태가 된다. */
test('Ollama Channel 배선 — 델타가 실제 IPC 채널로 흘러온다', async () => {
  test.setTimeout(180_000); // 8B 콜드 로드까지 감안
  const shell = await sharedShell();

  const r = await shell.page.evaluate(async () => {
    const w = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (c: string, a?: unknown) => Promise<unknown>;
          transformCallback: (cb: (m: unknown) => void, once?: boolean) => number;
        };
      }
    ).__TAURI_INTERNALS__;

    // Channel 을 손으로 만든다 — @tauri-apps/api 의 Channel 은 결국
    // `__CHANNEL__:{transformCallback id}` 로 직렬화된다(core.js SERIALIZE_TO_IPC_FN).
    const deltas: string[] = [];
    const id = w.transformCallback((raw) => {
      const m = raw as { message?: { d?: string } };
      if (m?.message?.d) deltas.push(m.message.d);
    });

    const out = (await w.invoke('ollama_run', {
      /* ⚠ 옛 `reads/coach` 가 P10 W4 에서 사라졌다(2026-08-07) — 읽을거리 화면과 함께 갔다.
         `review/coach` 로 갈았다: 이 케이스가 잠그는 것은 특정 프롬프트가 아니라 **IPC Channel
         배선**(증분이 실제로 흘러오는가)이고, 그건 남은 AI 경로 하나로도 그대로 물어진다. */
      kind: 'review/coach',
      body: { facts: ['이번 주 복습을 세 번 했다.'], weakSpots: ['전자기학 맥스웰 방정식'] },
      requestId: 'e2e-ollama-1',
      onDelta: `__CHANNEL__:${id}`,
    })) as { ok: boolean; error?: string; coach?: unknown };

    return { out, deltaCount: deltas.length };
  });

  // 연결 실패도 **봉투**여야 한다 — throw 로 새면 소비처의 .ok 분기가 통째로 죽는다.
  expect(typeof r.out.ok, '실패가 봉투가 아니다').toBe('boolean');
  test.skip(
    !r.out.ok && (r.out.error ?? '').includes('연결 실패'),
    'Ollama 가 꺼져 있음 — 생성 단언은 건너뛴다(연결 실패가 봉투로 온 것은 위에서 확인)',
  );

  expect(r.out.ok, `생성 실패: ${r.out.error}`).toBe(true);
  expect(r.out.coach, '봉투의 coach 키가 비었다 — wrap 키가 틀리면 화면이 조용히 빈다').toBeTruthy();
  // Channel 이 안 붙었으면 여기가 0 이 된다.
  expect(r.deltaCount, 'Channel 로 델타가 하나도 안 왔다 — 스트리밍 배선이 끊겼다').toBeGreaterThan(0);
});

/* ── 자기 셸을 쓰는 케이스 ─────────────────────────────────────────────────
   ⚠ 여기부터는 **창을 닫는 것 자체가 검사 대상**이라 공유 셸을 먼저 내려야 한다.
   안 내리면 `launchShell()` 의 `ensureNoStrayShell()` 이 공유 셸을 죽여 뒤 케이스가 헛돈다. */

/* 창 닫기 flush 가드 + SQLite 정본 일치 — **2단계-C·D 를 하나로 합쳤다.**

   둘을 나눠 두면 앱을 두 번 더 껐다 켜는데, 실제로는 같은 계약의 앞뒤다: "편집이 SQLite 에
   도달하는가"와 "그 도달이 창 닫기에서 살아남는가". 한 번의 껐다 켬으로 둘 다 관측된다.

   ⚠ 이 케이스가 GUI 여야 하는 이유는 **프런트 라이프사이클**이다. 설계 §8 은 flush 가 비동기
   (invoke)가 되면 `pagehide` 로는 await 가 잘린다고 봤고, 그래서 `onCloseRequested` 훅 +
   `core:window:allow-destroy` 가 있다. 그 훅이 실제로 도는지는 진짜 창을 닫아야만 드러난다.
   판별력은 경험적으로 확인됐다: 가드가 없던 빌드에서 이 케이스는 실제로 빨간불이었다. */
test('창 닫기 — 디바운스 대기 중 닫아도 비동기 SQL 쓰기가 살아남는다', async () => {
  const readTheme = (s: Shell) =>
    s.page.evaluate(async () => {
      const w = (
        window as unknown as {
          __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<unknown> };
        }
      ).__TAURI_INTERNALS__;
      /* ⚠ DB 를 **앱에게 물어서** 연다(SD-6). 예전엔 `'sqlite:learning-hub.db'` 를 여기 박아
         뒀는데, 격리 이후 그 상대경로는 플러그인이 **실제 app_config_dir 기준**으로 풀어
         하네스가 사용자의 진짜 DB 를 여는 결과가 된다 — 정확히 없애려던 그 접촉이다. */
      const db = (await w.invoke('db_url_cmd')) as string;
      // ⚠ 먼저 연결을 연다 — `getDb()` 는 지연 로드라 편집이 없던 세션에선 DB 가 안 열려 있다.
      await w.invoke('plugin:sql|load', { db });
      const rows = (await w.invoke('plugin:sql|select', {
        db,
        query: "SELECT value FROM settings WHERE key = 'theme'",
        values: [],
      })) as { value: string }[];
      return rows[0] ? (JSON.parse(rows[0].value) as string) : undefined;
    });

  /* 부팅 하이드레이션이 화면까지 닿기를 기다린다.

     ⚠ 이게 없으면 **토글이 조용히 무효가 된다**: `toggleTheme`(actions.ts:264)은
     `st().state.theme || 'dark'` 로 다음 값을 계산하는데, SQLite 부팅 읽기가 끝나기 전엔
     저장값이 아니라 **기본값에서** 계산한다. 저장값이 이미 그 결과와 같으면 아무 변화가 없고,
     테스트는 "flush 가 안 됐다"로 잘못 실패한다(원본 케이스에도 있던 잠재 flaky 다 —
     저장값이 dark 일 때만 우연히 통과했다).

     저장값으로 폴링하는 것으로 충분하다: 기본값과 저장값이 **다르면** 진짜로 기다리고,
     **같으면** 어느 쪽에서 계산해도 토글 결과가 같아 즉시 통과해도 안전하다. */
  const awaitHydration = async (s: Shell, stored: string | undefined) => {
    await expect
      .poll(() => s.page.evaluate(() => document.documentElement.getAttribute('data-theme')), { timeout: 15_000 })
      .toBe(stored);
  };

  /* ⚠ **공유 셸을 그대로 쓴다** — 닫는 것이 검사 대상이므로 이 케이스가 공유 셸의 수명을
     끝낸다. 앞의 넷이 이미 쓰고 난 창이라 여기서 새로 띄울 이유가 없다(그래서 이 파일
     전체의 기동이 3 → **2** 가 된다). 뒤에 케이스를 추가해도 안전하다: `sharedShell()` 이
     다시 불리면 새로 띄운다 — 느려질 뿐 틀리지 않는다. */
  let shell: Shell = await sharedShell();
  try {
    const before = await readTheme(shell);
    /* ⚠ 격리 폴더는 **빈 DB 로 시작**하므로 `settings` 에 theme 행이 아직 없을 수 있다
       (`undefined`). 그때 화면에 내려오는 값은 `defaults().theme` = 'dark' 다
       (`ThemeProvider:14` 의 `theme || 'dark'`). 이 폴백이 없으면 첫 실행에서
       "data-theme 이 undefined 가 되기를" 영원히 기다린다. */
    await awaitHydration(shell, before ?? 'dark');
    // 편집을 일으키고 **곧바로** 닫는다 — 저장이 아직 진행 중일 때 창이 죽는 상황을 만든다.
    await shell.page.getByRole('button', { name: /테마 전환/ }).click();
    await closeSharedShell();

    /* 다시 띄우는 이유는 **재시작을 넘어 살아남았는지**를 보기 위해서다. 예전엔 여기에
       "원복" 이라는 두 번째 목적이 붙어 있었다 — 하네스가 사용자의 진짜 DB 를 만졌으니
       테마를 돌려놔야 했다. SD-6 로 데이터 폴더가 격리되면서 **그 이유가 사라졌다**
       (임시 폴더라 OS 가 치운다). 아래 원복 단계도 함께 없앴다. */
    shell = await launchShell();
    const after = await readTheme(shell);
    expect(after, '비동기 SQL 쓰기가 창 닫기에서 잘렸다 → 닫기 가드가 안 걸렸다').not.toBe(before);

    /* **정본 일치**(2단계-D 의 몫) — 저장된 값이 화면에 실제로 내려오는가.
       셸에선 localStorage 를 안 쓰므로 살아 있는 정본은 ThemeProvider 가 내린 `data-theme` 다.

       ⚠ **폴링이 필수다.** 부팅 읽기가 비동기라 하이드레이션 전에는 `ThemeProvider:14` 의
       `theme || 'dark'` 가 **기본값 dark 를 먼저 내린다.** 그 순간을 재면 조용히 틀린 결과가
       나온다(이 케이스를 쓰면서 실제로 두 번 물렸다 — 둘 다 앱이 아니라 테스트 결함이었다).
       수렴을 기다리는 형태로 쓰면 "부팅 읽기가 화면까지 도달한다"까지 함께 잠긴다. */
    await awaitHydration(shell, after);
  } finally {
    await closeShell(shell);
  }
});

/* 미니 HUD 창 모드(N-8) — **창 크기·항상 위는 WebView2 밖의 사실**이라 여기서만 관측된다.
   트랙 A 는 `vite preview` 를 Chromium 으로 찍어 창 자체가 없고, cargo 는 프런트가 없어
   "접기 버튼이 실제로 창을 줄이는가"를 못 본다. 그리고 이 배선이 끊기면 증상이 조용하다 —
   버튼은 눌리고 라우트도 바뀌는데 창만 그대로여서, 알약이 전체 화면을 덮은 채로 남는다.

   ⚠ 복귀 크기가 **진입 전 실측값**인지도 함께 본다(상수 폴백으로 조용히 떨어지면 사용자가
   키워 둔 창이 매번 되돌려진다). 그래서 진입 전에 크기를 일부러 바꿔 두고 그 값으로 돌아오는지
   확인한다 — 폴백(1440×900)과 구분되는 값을 골라야 검사가 의미를 갖는다. */
test('미니 HUD — 접기가 창을 알약으로 줄이고, 펼치기가 원래 크기로 되돌린다', async () => {
  const shell = await sharedShell();
  const size = () => shell.page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const href = () => shell.page.evaluate(() => location.href);

  /* 폴백(1440×900)과 구분되는 크기로 맞춰 둔다 — 이 값으로 돌아와야 '실측 복귀'가 증명된다.
     ⚠ 번들된 앱 문서라 `import('@tauri-apps/api/window')` 는 **베어 스펙파이어라 해석되지
     않는다**(하네스가 실제로 물렸다). 다른 케이스들처럼 IPC 내부 진입점을 직접 부른다. */
  await shell.page.evaluate(async () => {
    const w = (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<unknown> } })
      .__TAURI_INTERNALS__;
    await w.invoke('plugin:window|set_size', { label: 'main', value: { Logical: { width: 1100, height: 720 } } });
  });
  await expect.poll(async () => (await size()).w, { timeout: 10_000 }).toBeLessThan(1200);
  const before = await size();

  // 즉석 집중 25분 — 팔레트로 세션을 만든다(FocusChip 은 세션이 있어야 뜬다).
  await shell.page.keyboard.press('Control+k');
  await shell.page.getByPlaceholder(/명령·탭 검색/).fill('즉석 집중 25');
  await shell.page.keyboard.press('Enter');
  await expect(shell.page.getByRole('button', { name: '미니 타이머로 접기' })).toBeVisible({ timeout: 10_000 });

  await shell.page.getByRole('button', { name: '미니 타이머로 접기' }).click();
  await expect.poll(async () => (await size()).w, { timeout: 10_000 }).toBeLessThan(400);
  expect(await href()).toContain('/mini');
  await expect(shell.page.getByRole('button', { name: '앱 창으로 펼치기' })).toBeVisible();

  await shell.page.getByRole('button', { name: '앱 창으로 펼치기' }).click();
  await expect.poll(async () => (await size()).w, { timeout: 10_000 }).toBeGreaterThan(1000);
  const after = await size();
  expect(Math.abs(after.w - before.w), '복귀 크기가 실측값이 아니다(상수 폴백으로 떨어졌다)').toBeLessThan(30);
  expect(await href()).not.toContain('/mini');

  /* 세션은 접기 전 상태 그대로 살아 있어야 한다 — 창 모드가 타이머를 건드리면 안 된다.
     ⚠ 같은 aria-label 을 오늘 탭 히어로 CTA 도 쓴다 → 상단 칩으로 좁힌다(`.first()` 는
     문서 순서상 TopBar 다). 안 좁히면 strict mode 위반으로 **기능과 무관하게** 빨개진다. */
  const stopChip = shell.page.getByRole('button', { name: '집중 타이머 정지' }).first();
  await expect(stopChip).toBeVisible();
  await stopChip.click();
  await shell.page.getByRole('button', { name: '중단' }).click(); // 조기중단 confirm
});

/* ============================================================
   부팅 계량 — **WebView2 에서 재야 하는 이유**(2026-08-02).

   감사의 검증사각 표가 성능 264ms 의 닫는 법을 *"릴리스 exe + 트랙B 하네스에 Performance 트레이스"*
   라 처방했다. 그 처방을 처음엔 지키지 않았다 — 원인 특정도 A/B 도 **Chromium(`vite preview`)** 에서
   했고, 그건 트랙 A 다. 트랙 A/B 를 나눈 이유가 정확히 *"무효화되는 도구로 무효화되지 않았음을
   증명"* 하지 않기 위해서인데, 그 규율을 성능에만 적용하지 않고 있었다.

   ⚠ 여기서만 참인 것들: WebView2 는 **다른 엔진**(Chromium 계열이지만 버전·플래그가 다르다) ·
   오리진이 `tauri://` 라 청크가 **네트워크가 아니라 로컬 파일**로 온다 · `modulepreload` 의 타이밍이
   다를 수 있다. 그중 어느 하나만 달라도 `React.lazy` 의 첫 렌더 throw → Suspense 억제 경로가
   다르게 나타날 수 있다.

   ⚠ **임계는 대기(gap)에만 건다.** 절대 부팅 시간은 러너·디스크·콜드캐시에 좌우되지만, 이 결함이
   만든 것은 **아무것도 안 하면서 기다리는 시간**이라 그 축은 하드웨어에 둔감하다.
   ⚠⚠ **여기 있던 「고친 뒤 0ms 대 · 5배 이상 이격」은 2026-08-01 Chrome 실측이고 WebView2 에서
   거짓이었다**(P050 · 2026-08-27). 실 셸 9회가 39~72.5ms(중앙 46)로 임계 50 을 걸치고
   있었고, 전량 실행에서 실제로 빨간불이 떴다. 원인은 노이즈가 아니라 **진입점**이었다 —
   셸은 `/` 로 뜨는데 `/` 가 `<Navigate>` 라 첫 커밋에 탭이 없었다(P028). `main.tsx` 가 렌더 전에
   주소를 정규화하면서 그 한 커밋이 사라졌고, **그러고 나서야 이 임계가 의미를 갖는다.**
   ⚠ 마크가 없으면 **통과로 읽지 않는다** — 계량이 죽은 것과 회귀가 없는 것은 다르다. */
test('부팅 계량 — 실 WebView2 에서도 첫 라우트가 Suspense 폴백을 안 거친다', async () => {
  const shell = await sharedShell();
  // 공유 셸은 이미 부팅을 마쳤다 — 마크는 그 부팅의 것이다(다시 띄우지 않는다).
  const wave = await shell.page.evaluate(() => {
    const at = (n: string) => performance.getEntriesByName(n, 'mark')[0]?.startTime ?? null;
    return { entry: at('hub:entry'), app: at('hub:app'), data: at('hub:first-data') };
  });

  expect(wave.entry, '`hub:entry` 가 없다 — 계량이 죽었다(부팅 웨이브를 아무도 안 재고 있다)').not.toBeNull();
  expect(wave.app, '`hub:app` 이 없다 — App 이 마운트되지 않았거나 마크가 빠졌다').not.toBeNull();
  expect(wave.data, '`hub:first-data` 가 없다 — 첫 탭이 데이터로 그려진 적이 없다').not.toBeNull();

  const gap = wave.data! - wave.app!;
  const total = wave.data! - wave.entry!;
  const entryToApp = wave.app! - wave.entry!;
  console.log(
    `[boot] entry→app ${entryToApp.toFixed(1)}ms · app→first-data ${gap.toFixed(1)}ms · total ${total.toFixed(1)}ms`,
  );

  /* ⭐ **웹 층 앞의 구간도 잰다**(P035 · 2026-08-27). 위 셋은 전부 `performance.timeOrigin`
     안쪽이고 그 원점은 WebView2 문서가 시작된 **뒤**다 — 실측 중앙으로 총 881 ms 중 508 ms(58%)가
     그 앞이었다. `boot::stamp()` 가 `run()` 첫 줄에서 epoch ms 를 찍고 여기서 그 축을 확인한다.
     ⚠ 절대 임계가 아니라 **자릿수와 부호**를 본다: 0 보다 크고 10초보다 작으면 「같은 축에서
     제대로 뺐다」는 뜻이고, 단조 시계를 잘못 주면 이 단언이 즉시 깨진다(수십 년 ms 가 나온다). */
  const native = await shell.page.evaluate(async () => {
    const w = (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string) => Promise<unknown> } })
      .__TAURI_INTERNALS__;
    const start = (await w.invoke('boot_process_start_ms')) as number | null;
    return start == null ? null : performance.timeOrigin - start;
  });
  expect(native, '`boot_process_start_ms` 가 null 이다 — 계량이 죽었다(P035 의 관측 지점)').not.toBeNull();
  console.log(`[boot] native→origin ${native!.toFixed(1)}ms`);
  expect(native!, 'epoch ms 축이 아니다 — 단조 시계를 준 것 같다(boot.rs 계약)').toBeGreaterThan(0);
  expect(native!, `native→origin ${native!.toFixed(0)}ms — 자릿수가 틀렸다`).toBeLessThan(10_000);

  /* ⭐ **재고 버리지 않는다**(P033 · 2026-08-27). 종전엔 위 한 줄이 전부라 다음 회차가 그 수를
     읽을 방법이 없었다 — `entry→app` 이 200ms 늘어도 아무 술어도 위반하지 않았다.
     ⚠ 절대 임계는 여전히 안 건다(위 문단의 판단 그대로). 여기서 잡는 것은 **계단**이다. */
  const 이전 = 기준선기록('shell-boot', { nativeToOrigin: native!, entryToApp, gap, total });
  if (이전)
    expect(
      계단인가(entryToApp, 이전.entryToApp),
      `entry→app ${entryToApp.toFixed(1)}ms — 직전 회차 ${이전.entryToApp.toFixed(1)}ms 대비 계단식 증가다. ` +
        '하드웨어 잡음은 이 폭에 안 닿는다(docs/성능/기준선.json).',
    ).toBe(false);
  expect(gap, 'React Suspense 억제(≈248ms)가 WebView2 에서 살아 있다 — `registry.warmTab` 머리주석 참조').toBeLessThan(
    50,
  );
});

/* ============================================================
   ⭐ **프런트 실패가 디스크에 남는가**(O007 · 2026-08-22 운영 축)

   ## 왜 여기여야만 하나 (이 파일의 남는 기준 그대로)

   이 다리는 **WebView2 안에서만 존재한다**: `isTauri()` 가 참이어야 걸리고, Rust 파일 싱크에
   닿으려면 `@tauri-apps/plugin-log` 의 IPC 와 `capabilities` 의 `log:default` ACL 이 **둘 다**
   살아 있어야 한다. 트랙 A(Chromium + `vite preview`)에는 그 셋이 전부 없고 `cargo test` 에는
   프런트가 없다 — 즉 **다른 어느 층도 원리적으로 못 본다.**

   ## 무엇이 없어서 이 케이스가 생겼나

   실측(2026-08-22): 프런트 `console.error` **38곳/15파일**이 릴리스에서 **증발**했다. Rust 는
   `LevelFilter::Warn` + 파일 싱크를 이미 갖고 있었고 프런트에서 거기 닿는 경로가 셋 다 없었다
   (플러그인 미설치 · ACL 없음 · devtools 0). 사용자가 "저장이 안 돼요" 라 할 때 첨부할
   `learning-hub.log` 에 **프런트 줄이 0** 이었다.

   ⚠ **정적 검사로는 이 셋 중 어느 것도 못 잡는다** — 플러그인을 지워도 `import()` 가 실패를
   삼키고(그게 의도다: 로그가 앱을 멈추면 처방이 병보다 나쁘다), ACL 을 빼도 호출이 조용히
   거부된다. **둘 다 화면상 정상**이다. 그래서 「파일이 자랐는가」를 직접 본다.
   ⚠ 로그 폴더는 SD-6 override 를 탄다(`paths.rs::log_dir`) — 이 케이스는 **사용자의 실제
   로그를 만지지 않는다.** 그 라우팅을 O007 이 함께 넣은 이유가 이것이다.
============================================================ */
test('프런트 `console.error` 가 로그 **파일**까지 간다(O007)', async () => {
  const shell = await sharedShell();
  /* ⚠⚠ **파일 이름을 짐작하지 마라.** `TargetKind::Folder { file_name: None }` 의 기본값은
     DB 이름이 아니라 **`productName`** 이라 실물은 `러닝허브.log` 다(첫 판이 `learning-hub.log`
     로 찾다가 «다리가 죽었다»고 잘못 신고했다 — 다리는 멀쩡했다). 폴더에서 **찾는다**. */
  const 로그찾기 = (): string | null => {
    const d = e2eDataDir();
    if (!existsSync(d)) return null;
    const f = readdirSync(d).find((n) => n.toLowerCase().endsWith('.log'));
    return f ? path.join(d, f) : null;
  };

  /* ⚠ 마커에 난수를 안 쓴다 — 실패 메시지가 재현 가능해야 한다. 대신 이 케이스만 쓰는 문구라
     다른 줄과 안 섞인다. */
  const 마커 = 'O007-트랙B-마커: 프런트에서 낸 오류';
  await shell.page.evaluate((m) => console.error(m), 마커);

  /* 싱크는 비동기(IPC 왕복 + 파일 쓰기)라 잠깐 기다린다. ⚠ 고정 sleep 이 아니라 **폴링**이다 —
     느린 러너에서 고정값은 flaky 의 근원이고, 이 저장소가 이미 그것으로 물렸다(a11y 30초). */
  let 본문 = '';
  let 로그: string | null = null;
  for (let i = 0; i < 40; i++) {
    로그 = 로그찾기();
    본문 = 로그 ? readFileSync(로그, 'utf8') : '';
    if (본문.includes(마커)) break;
    await new Promise((r) => setTimeout(r, 250));
  }

  expect(
    본문,
    `프런트 오류가 로그 파일에 안 남았다(${로그 ?? e2eDataDir() + ' 안에 .log 없음'}) — 셋 중 하나가 죽었다: ` +
      '`@tauri-apps/plugin-log` 설치 · `capabilities` 의 `log:default` · `main.tsx` 의 `bridgeConsole()`. ' +
      '⚠ 셋 다 **실패를 조용히 삼키므로** 화면상으로는 정상으로 보인다.',
  ).toContain(마커);

  /* ⚠ 짝: 원본 콘솔이 살아 있어야 한다 — 다리가 출력을 **가로채고 끝내면** devtools·트랙 A 에서
     오류가 사라진다(관측이 관측 대상을 해친다). 여기서는 함수가 여전히 호출 가능한지만 본다. */
  const 살아있음 = await shell.page.evaluate(() => typeof console.error === 'function');
  expect(살아있음, '`console.error` 가 함수가 아니게 됐다 — 다리가 콘솔을 망가뜨렸다').toBe(true);
});
