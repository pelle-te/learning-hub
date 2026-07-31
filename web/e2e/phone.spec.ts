/* ============================================================
   phone.spec.ts — 폰 웹앱이 **진짜 브라우저에서 실제로 뜨는가**(C-6).

   ## 왜 이 파일이 필요한가

   C-6a 는 브라우저 SQLite(wasm + OPFS + 워커)를 들였는데, 그 층은 **정적 검사가 원리적으로
   못 본다**: 타입은 맞고 린트도 통과하지만 wasm 로드·워커 기동·OPFS 핸들 획득은 전부
   런타임 사건이다. 이 저장소는 정확히 그 부류에 **네 번** 물렸다(2단계 저장 · C-4 삭제부활 ·
   C-5 CSP · pull 페이지네이션). 매번 "전량 녹색"인 채로.

   ## 무엇을 단언하고 무엇을 안 하는가 (정직하게)

   ✅ 단언한다: 페이지가 뜬다 · 콘솔 오류가 없다 · **OPFS 에 실제로 저장소가 생긴다**
      (= wasm 이 로드됐고 워커가 살았고 SAH 풀을 잡았다는 관측 가능한 증거).
   ❌ 단언 못 한다: 클라우드 왕복. 그건 서버가 필요하고 `server/test/roundtrip.test.ts` 의
      몫이다. 여기서 흉내 내면 둘 다 반쪽이 된다.

   ⚠ 스냅샷은 찍지 않는다 — 트랙 B 와 같은 규율이다(베이스라인 두 벌 방지).
============================================================ */
import { expect, test } from '@playwright/test';

/** OPFS 루트의 최상위 항목 이름들. `installOpfsSAHPoolVfs({name})` 가 여기에 폴더를 만든다. */
async function opfsEntries(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const out: string[] = [];
    // @ts-expect-error — entries() 는 표준이지만 lib.dom 타입이 아직 안 따라온다
    for await (const [name] of root.entries()) out.push(String(name));
    return out;
  });
}

test.describe('폰 웹앱', () => {
  test('뜬다 · 콘솔 오류가 없다 · OPFS 저장소가 실제로 생긴다', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/phone.html');

    /* 연결 전이므로 등록 화면이 정답이다. 이게 보인다는 것은 `initPhoneStore()` 가 끝났고
       `readCloudConfig()` 가 SQLite 를 조회해 null 을 돌려줬다는 뜻이다 — 즉 **DB 가 실제로
       열렸다**(안 열렸으면 `selectDb` 가 null 을 반환해 같은 화면이 나오므로, 그 구분은
       아래 OPFS 단언이 한다). */
    await expect(page.getByRole('heading', { name: '러닝허브' })).toBeVisible();
    await expect(page.getByLabel('등록 코드')).toBeVisible();

    /* ⚠ 여기가 이 파일의 핵심 단언이다. 폴더가 생겼다 = wasm 초기화 → 워커 기동 →
       SAH 풀 확보가 **전부** 성공했다. 하나라도 실패하면 인메모리로 내려가고 이 폴더는 없다. */
    const entries = await opfsEntries(page);
    expect(entries.join(',')).toContain('learning-hub');

    expect(errors, `콘솔 오류:\n${errors.join('\n')}`).toEqual([]);
  });

  test('새로고침해도 OPFS 저장소가 남는다(오프라인 캐시의 전제)', async ({ page }) => {
    await page.goto('/phone.html');
    await expect(page.getByLabel('등록 코드')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('등록 코드')).toBeVisible();
    expect((await opfsEntries(page)).join(',')).toContain('learning-hub');
  });

  test('데스크톱 셸은 브라우저 SQLite 를 켜지 않는다(트랙 A 회귀 방지)', async ({ page }) => {
    /* ⚠ `enableBrowserDb()` 를 폰 진입점만 부른다는 계약을 기계가 지키게 한다. 데스크톱
       엔트리가 이걸 켜면 `npm run dev` 와 트랙 A 시각 베이스라인이 통째로 저장 백엔드를 갈아탄다 —
       조용히 일어나고, 그때는 이미 늦다. */
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect((await opfsEntries(page)).join(',')).not.toContain('learning-hub');
  });
});

/* ============================================================
   D-9 오프라인 껍데기 — **precache 가 폰 그래프를 담고 있는가**.

   종전 `globPatterns: ['phone.html','icon.svg']` 는 껍데기의 절반만 구웠다: 새 `phone.html` 은
   precache 에서 나오는데 그것이 참조하는 **새 해시 청크**는 캐시에 없어, 배포 직후 오프라인
   첫 로드가 흰 화면이었다(데이터는 OPFS 에 멀쩡한데).

   ⚠ 왜 "진짜 오프라인 재현"이 아니라 산출물 단언인가: 트랙 A 는 `serviceWorkers: 'block'` 이라
     SW 를 애초에 못 등록한다(그 설정은 스냅샷 결정성의 전제다 — 여기 하나 때문에 못 바꾼다).
     그래서 **실제로 구워진 sw.js** 를 읽어 계약을 잠근다: 폰 엔트리·앱 청크·wasm 이 들어 있고,
     데스크톱 엔트리는 안 들어 있다. 정적 검사가 원리적으로 못 보는 층이라 여기가 유일한 감시자다.
============================================================ */
test.describe('폰 오프라인 껍데기(D-9)', () => {
  /** HTML 의 module script src(=그 엔트리의 해시 청크). */
  async function entryChunk(request: import('@playwright/test').APIRequestContext, html: string): Promise<string> {
    const body = await (await request.get(html)).text();
    const m = /<script[^>]+type="module"[^>]+src="\/?([^"]+)"/.exec(body);
    expect(m, `${html} 에서 module 엔트리를 못 찾았다`).toBeTruthy();
    return m![1]!;
  }

  test('sw.js precache 가 폰 그래프를 담고 데스크톱 청크는 빼놓는다', async ({ request }) => {
    const sw = await (await request.get('/sw.js')).text();
    const urls = [...sw.matchAll(/url:"([^"]+)"/g)].map((m) => m[1]!);
    expect(urls.length, 'precache 목록이 비었다').toBeGreaterThan(5);

    // ① 폰 엔트리 청크가 들어 있다(옛 설정이 정확히 이걸 빠뜨렸다).
    expect(urls).toContain(await entryChunk(request, '/phone.html'));
    // ② 첫 화면(PhoneApp)은 **동적** import 다 — 정적 그래프만 따라가면 여기서 반쪽이 된다.
    expect(
      urls.some((u) => /PhoneApp-.*\.js$/.test(u)),
      'PhoneApp 청크 없음',
    ).toBe(true);
    // ③ SQLite wasm — 폰은 이게 정본이라 없으면 화면만 뜨고 데이터가 0이다.
    expect(
      urls.some((u) => /sqlite3-.*\.wasm$/.test(u)),
      'sqlite wasm 없음',
    ).toBe(true);
    // ④ 데스크톱 엔트리는 폰에 굽지 않는다(셀룰러 낭비 · 그 판단은 D-9 뒤에도 그대로다).
    expect(urls).not.toContain(await entryChunk(request, '/index.html'));
  });
});
