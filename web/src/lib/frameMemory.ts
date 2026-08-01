/* ============================================================
   lib/frameMemory.ts — **로딩 뼈대가 마지막 성공 렌더의 형상을 기억한다**(Q-16 · 2026-08-02).

   W15 는 `SkeletonText`(n줄 골격)를 금지하면서 옳은 진단을 했다: _"골격이 3행을 약속하고 12행이
   오면 그건 로딩이 아니라 오답이다."_ 그래서 `shape='frame'` 은 **행 수를 약속하지 않기로** 했고
   그 결정은 지금도 옳다. 다만 대가가 있었다 — 뼈대가 **아무 말도 안 하게** 됐다. 어느 탭을 열든
   같은 띠 3개 + 큰 칸 1개 + 하단 4칸이 뜬다.

   ## 지어내는 것과 기억하는 것은 다르다

   W15 가 막은 것은 **없는 값을 발명하는 것**이다(`lines = 3` 은 아무 근거가 없다). 이 파일이 하는
   것은 그 반대다 — **직전에 실제로 그렸던 값**을 다시 그린다. 틀릴 수 있지만, 틀리는 방식이
   다르다: 발명은 매번 같은 거짓말이고, 기억은 *그 화면이 지난번에 어땠는지*라는 실측 사전확률이다.

   ⚠⚠ **그래서 무엇을 기억하는지가 이 파일의 전부다.** 데이터에 따라 변하는 것(목록 행 수·카드
   개수)은 **기억하지 않는다** — 그걸 기억하면 W15 가 막은 거짓말을 "작년 데이터로" 다시 하는
   것이다. 기억하는 것은 **화면 구조**뿐이고, 그건 `usePageChrome` 이 이미 값으로 갖고 있다:

   · `readouts` 개수 — 그 화면이 상단에 세우는 컨텍스트 수치의 수. 화면마다 고정이다.
   · `primary` 유무 — 44px 앵커를 세우는 화면인가(원칙 ②의 물리적 표현).

   둘 다 **코드가 정하는 값**이지 데이터가 정하는 값이 아니다. 과목이 0개든 50개든 `today` 의
   리드아웃은 셋이다. 그래서 기억해도 거짓말이 되지 않는다.

   ⚠ 저장은 `storage`(kv)다 — 뼈대가 가장 필요한 순간이 **부팅 직후 첫 진입**이라 메모리 캐시로는
   늦다. 값이 작고(탭당 두 수) 손실돼도 종전 동작(일반 뼈대)으로 떨어질 뿐이라 실패가 안전하다.
   ⚠ `store/` 가 아니라 `lib/` 인 이유: 순수 함수 + IO 이고 React 를 모른다(레이어 단방향).
============================================================ */
import { storage } from './kv';

/** 한 화면의 **구조** — 데이터가 아니라 코드가 정하는 두 수. */
export interface FrameShape {
  /** 상단 컨텍스트 리드아웃 개수. */
  readouts: number;
  /** 44px 앵커(`primary`)를 세우는 화면인가. */
  primary: boolean;
}

const KEY = 'hub.frameShapes.v1';
/** 탭당 두 수라 작지만, 은퇴·개명으로 죽은 키가 영원히 남지 않게 상한을 둔다. */
const MAX_TABS = 40;
/** 리드아웃이 이보다 많으면 그건 리드아웃이 아니라 목록이다 — 기억하지 않는다(방어적 상한). */
const MAX_READOUTS = 6;

type Store = Record<string, FrameShape>;

function read(): Store {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Store = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v !== 'object' || v === null) continue;
      const { readouts, primary } = v as Partial<FrameShape>;
      if (typeof readouts !== 'number' || !Number.isFinite(readouts)) continue;
      if (typeof primary !== 'boolean') continue;
      out[k] = { readouts: clampReadouts(readouts), primary };
    }
    return out;
  } catch {
    /* 손상된 값은 "기억 없음"과 같다 — 뼈대는 일반 형상으로 떨어지고 화면은 계속 뜬다. */
    return {};
  }
}

function clampReadouts(n: number): number {
  return Math.max(0, Math.min(MAX_READOUTS, Math.round(n)));
}

/**
 * 성공 렌더의 형상을 기록한다. **같은 값이면 쓰지 않는다** — 이 함수는 크롬이 주입될 때마다
 * 불리므로(탭 전환·deps 변경) 매번 직렬화하면 조용한 상시 비용이 된다.
 *
 * @returns 실제로 저장했으면 true(테스트가 "안 썼다"를 관측할 수 있게).
 */
export function rememberFrame(tabKey: string, shape: FrameShape): boolean {
  if (!tabKey) return false;
  const next: FrameShape = { readouts: clampReadouts(shape.readouts), primary: shape.primary };
  const all = read();
  const cur = all[tabKey];
  if (cur && cur.readouts === next.readouts && cur.primary === next.primary) return false;
  all[tabKey] = next;
  /* 상한 초과 시 **임의로 자른다** — LRU 를 두려면 접근 시각을 또 써야 하고, 그 쓰기가 위
     "같으면 안 쓴다"를 무력화한다. 잘려도 손실은 뼈대 한 번의 정확도다. */
  const keys = Object.keys(all);
  if (keys.length > MAX_TABS) for (const k of keys.slice(0, keys.length - MAX_TABS)) delete all[k];
  try {
    storage.setItem(KEY, JSON.stringify(all));
    return true;
  } catch {
    return false; // 저장공간이 가득 찼을 뿐이다 — 화면은 계속 뜬다
  }
}

/** 기억이 있으면 그 형상, 없으면 `null`(= 일반 뼈대를 그린다는 뜻). */
export function recallFrame(tabKey: string): FrameShape | null {
  if (!tabKey) return null;
  return read()[tabKey] ?? null;
}

/** 테스트·초기화용. */
export function forgetFrames(): void {
  try {
    storage.removeItem(KEY);
  } catch {
    /* noop */
  }
}
