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
       엔트리가 이걸 켜면 `npm run dev` 와 스냅샷 59장이 통째로 저장 백엔드를 갈아탄다 —
       조용히 일어나고, 그때는 이미 늦다. */
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect((await opfsEntries(page)).join(',')).not.toContain('learning-hub');
  });
});
