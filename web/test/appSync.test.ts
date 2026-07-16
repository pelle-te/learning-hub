// @vitest-environment jsdom
/* ============================================================
   appSync.test.ts — 멀티탭 동기화 *채택 정책*(useApp 소유) 회귀 — 감사 추가#3.
   sync.test.ts는 전송 계약(pub/sub)만 검증한다 — 여기선 유실 방지의 핵심인
   정책을 검증: ① 다른 탭이 저장·방송하면 그 스냅샷을 채택 ② 단, 내 편집이
   디바운스 대기 중이면 건너뛰고(마지막 편집자 우선) 곧 내 flush가 정본이 된다.
   BroadcastChannel 없는 jsdom에서도 announce(m, alsoLocal=true)의 로컬 emit
   경로로 useApp의 onSync 구독자를 그대로 발화시킨다.
============================================================ */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/idb', () => ({ idbMirror: vi.fn(), idbLoad: vi.fn(async () => null) }));

import { announce } from '@/lib/sync';
import { KEY, defaults, persist } from '@/lib/persistence';
import { useApp } from '@/store/useApp';

const tick = () => new Promise<void>((r) => queueMicrotask(r));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** '다른 탭'이 저장했다고 치는 스냅샷을 localStorage에 심는다(구분 필드: moduleLen). */
function otherTabPersists(moduleLen: number): void {
  persist(localStorage, { ...defaults(), moduleLen });
}

beforeEach(() => {
  localStorage.clear();
});

describe('useApp — 멀티탭 스냅샷 채택 정책(마지막 편집자 우선)', () => {
  it('다른 탭이 저장·방송하면 그 스냅샷을 채택한다(대시보드 모드·상호 덮어쓰기 방지)', async () => {
    otherTabPersists(97);
    announce({ kind: 'app' }, true); // 로컬 emit 경로로 useApp 구독자 발화(BC 대체)
    await tick();
    expect(useApp.getState().state.moduleLen).toBe(97);
  });

  it("kind가 'app'이 아니면 채택하지 않는다(reads 방송은 무관)", async () => {
    const before = useApp.getState().state.moduleLen;
    otherTabPersists(96);
    announce({ kind: 'reads' }, true);
    await tick();
    expect(useApp.getState().state.moduleLen).toBe(before);
  });

  it('내 편집이 디바운스 대기 중이면 외부 스냅샷을 건너뛰고, 곧 내 flush가 정본이 된다', async () => {
    useApp.getState().mutate((s) => {
      s.moduleLen = 55; // 디바운스 타이머(400ms) 시작 — 아직 미저장
    });
    otherTabPersists(98); // 그 사이 다른 탭이 저장·방송
    announce({ kind: 'app' }, true);
    await tick();
    // 낡은 외부 스냅샷이 진행 중인 내 편집을 지우지 않는다.
    expect(useApp.getState().state.moduleLen).toBe(55);
    // 디바운스가 끝나면 내 편집이 저장돼 정본이 된다(마지막 편집자 우선).
    await sleep(500);
    const saved = JSON.parse(localStorage.getItem(KEY)!) as { moduleLen: number };
    expect(saved.moduleLen).toBe(55);
  });

  it('flush 직후(타이머 없음)에는 다시 외부 스냅샷을 채택한다 — 가드는 대기 중에만', async () => {
    useApp.getState().mutate((s) => {
      s.moduleLen = 60;
    });
    await sleep(500); // 디바운스 소진 — 타이머 없음
    otherTabPersists(99);
    announce({ kind: 'app' }, true);
    await tick();
    expect(useApp.getState().state.moduleLen).toBe(99);
  });
});
