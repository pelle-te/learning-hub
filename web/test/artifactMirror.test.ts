// @vitest-environment jsdom
/* ============================================================
   artifactMirror.test.ts — PC → 폰 산출물 미러(설계 §13-8 잔여).

   잠그는 계약은 셋이고 전부 **조용히 틀리는** 종류다:
   ① 무변경이면 쓰지 않는다 — `docSet` 은 새 스탬프를 찍고 그 행이 아웃박스에 실린다.
      무조건 쓰면 5분마다 60KB 를 다시 밀어 올린다(요금·한도가 걸린 축이다).
   ② 읽기 실패는 '없음'이지 예외가 아니다 — 산출물 하나가 미생성이라고 동기화가 멈추면 안 된다.
   ③ 미러 키는 `docs` 키 공간 안에 있어야 한다 — 밖이면 `docGet/docSet` 이 localStorage 로
      새고, 그러면 아웃박스에 안 걸려 **폰까지 영원히 안 간다**(C-6 이 경고한 실패 모드).
============================================================ */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getArtifact } = vi.hoisted(() => ({ getArtifact: vi.fn() }));
vi.mock('@/lib/api', () => ({ getArtifact }));

import { mirrorArtifacts, mirrorKey, readMirrored, MIRRORED_ARTIFACTS } from '@/lib/artifactMirror';
import { DOC_KEYS, MIRROR_DOC_KEYS, _resetDocs, docGet, docSet } from '@/lib/db/docs';

beforeEach(() => {
  localStorage.clear();
  _resetDocs();
  getArtifact.mockReset();
});

/** 브라우저 경로(=`_cache` null)에서는 docGet/docSet 이 localStorage 를 쓴다 — 여기선 그걸로 충분하다.
 *  잠그려는 것은 저장 매체가 아니라 **미러의 판단**(쓸지 말지·없음 처리)이기 때문. */
const ok = (data: unknown) => ({ ok: true, data });

describe('키 공간', () => {
  it('미러 키가 DOC_KEYS 안에 있다 — 밖이면 localStorage 로 새어 폰까지 안 간다', () => {
    for (const k of MIRROR_DOC_KEYS) expect(DOC_KEYS).toContain(k);
  });
  it('미러 대상과 키가 1:1 로 대응한다(둘 중 하나만 늘리는 실수 방지)', () => {
    expect(MIRRORED_ARTIFACTS.map(mirrorKey)).toEqual([...MIRROR_DOC_KEYS]);
  });
});

describe('mirrorArtifacts — 무변경이면 쓰지 않는다', () => {
  it('처음엔 쓰고, 같은 내용이면 두 번째엔 안 쓴다', async () => {
    getArtifact.mockImplementation((n: string) => Promise.resolve(ok({ n })));

    const first = await mirrorArtifacts();
    expect(first.updated).toEqual([...MIRRORED_ARTIFACTS]);
    expect(first.missing).toEqual([]);

    const second = await mirrorArtifacts();
    expect(second.updated, '내용이 같은데 다시 썼다 — 매 동기화마다 60KB 가 재전송된다').toEqual([]);
  });

  it('내용이 바뀌면 다시 쓴다', async () => {
    getArtifact.mockImplementation(() => Promise.resolve(ok({ v: 1 })));
    await mirrorArtifacts();
    getArtifact.mockImplementation(() => Promise.resolve(ok({ v: 2 })));
    const r = await mirrorArtifacts();
    expect(r.updated).toEqual([...MIRRORED_ARTIFACTS]);
    expect(readMirrored<{ v: number }>('reads')?.v).toBe(2);
  });
});

describe('읽기 실패는 예외가 아니라 "없음"', () => {
  it('던져도 missing 으로 흡수하고 나머지는 계속 처리한다', async () => {
    getArtifact.mockImplementation((n: string) =>
      n === 'reads' ? Promise.reject(new Error('HTTP 404')) : Promise.resolve(ok({ n })),
    );
    const r = await mirrorArtifacts();
    expect(r.missing).toEqual(['reads']);
    expect(r.updated).toEqual(['markets']); // 하나가 없다고 다른 하나를 포기하지 않는다
  });

  it('ok:false(미생성·손상)도 missing 이다 — 빈 값을 정답으로 굳히지 않는다', async () => {
    getArtifact.mockImplementation(() => Promise.resolve({ ok: false, error: 'HTTP 404' }));
    const r = await mirrorArtifacts();
    expect(r.missing).toEqual([...MIRRORED_ARTIFACTS]);
    expect(r.updated).toEqual([]);
    expect(readMirrored('reads')).toBeNull();
  });
});

describe('readMirrored', () => {
  it('없으면 null', () => {
    expect(readMirrored('reads')).toBeNull();
  });
  it('손상된 JSON 은 null — 다음 미러가 덮는다(던지지 않는다)', () => {
    docSet(mirrorKey('reads'), '{깨진');
    expect(docGet(mirrorKey('reads'))).toBe('{깨진'); // 저장은 됐고
    expect(readMirrored('reads')).toBeNull(); // 읽기가 흡수한다
  });
});
