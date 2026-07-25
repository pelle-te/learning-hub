/* ============================================================
   lib/visits.ts — 방문 원장(N-11). 이 앱이 **자기 사용을 관측하지 못하던** 공백을 메운다.

   25탭 중 무엇을 실제로 여는지 앱은 모른다(`shell/recent.ts` 는 팔레트 명령 LRU 뿐이고
   `lib/telemetry.ts` 는 에러만 보낸다). 2026-07-25 발산에서 **세 각도가 독립적으로
   "관측이 없어 결정 불가"에서 멈췄다** — 탭 은퇴 근거·폰 뷰 사용 여부·all-clear 빈도.
   여기서 세는 것은 그 결정들의 입력이지 그 자체로 화면이 되는 값이 아니다(UI 는 뒤에).

   ## ⚠ 진입 경로(`Via`)를 반드시 쪼갠다

   방문 수는 **가치가 아니라 접근성의 함수**다 — 레일에 있으니 눌린다. 합계만 세면
   _숨겨서 안 쓰이게 만든 것을 안 쓰인다고 지우는_ 순환에 빠지고, 그 순환은 데이터가
   있다는 이유로 **더 자신 있게** 틀린다. 레일을 지웠을 때 ⌘K·딥링크 방문이 남는지가
   "이 목적지가 필요한가"의 진짜 신호다.

   ## 왜 호출부가 `markVia` 로 알려 주는가

   내비게이션은 22곳에서 일어나고 그중 대부분은 `navigate('/x')` 한 줄이다. 각 자리에서
   기록 함수를 부르게 하면 새 링크가 생길 때마다 빠뜨리고, 빠진 것은 **0 으로 보인다**
   (없는 데이터와 안 센 데이터가 구분되지 않는다 — 이 저장소가 반복해서 물린 형태).
   그래서 계수는 **App 의 pathname 이펙트 한 곳**이 하고, 호출부는 "내가 눌렀다"는
   힌트만 남긴다. 힌트가 없으면 `link`(본문 안 링크)로 떨어지므로 **누락이 곧 오분류이지
   유실이 아니다.**

   ⚠ 힌트에 유효기간을 둔다. `markVia` 후 내비게이션이 실제로 일어나지 않으면(막힌 링크·
   같은 경로 클릭) 그 값이 남아 **다음 내비게이션을 오염**시킨다. 1초를 넘기면 버린다.

   ⚠ 브라우저(dev·트랙 A)에선 `getDb()` 가 null 이라 통째로 무동작이다 — 스냅샷 59장과
   개발 경로는 이 파일이 없는 것과 똑같이 돈다.
============================================================ */
import { execDb, isSqlitePrimary } from './db/sqlite';
import { addDays, iso, parseISO, todayISO } from './utils';

/** 목적지에 **어떻게 도달했는가**. 합쳐서 세면 안 되는 이유는 머리주석. */
export type Via =
  /** 레일 사이드바(상시 노출 = 가장 싼 경로) */
  | 'rail'
  /** 호스트 상단 세그먼트(SubTabs) */
  | 'seg'
  /** ⌘K 팔레트 — 이름을 알고 찾아간 것 */
  | 'palette'
  /** `g`+키 · `[`/`]` 링 — 손가락이 외운 것 */
  | 'key'
  /** 본문 안 링크·칩·버튼(힌트 없는 내비게이션의 기본값) */
  | 'link'
  /** 앱을 열었을 때의 첫 착지(= 딥링크이거나 그냥 기본 경로) */
  | 'boot';

/** 힌트 유효 시간(ms) — 이걸 넘긴 `markVia` 는 버린다(머리주석). */
const HINT_TTL = 1000;

/** 보존기간(일). 어떤 IA 결정도 석 달이면 충분하고, 이 표는 무한 성장할 이유가 없다. */
const KEEP_DAYS = 90;

let _hint: { via: Via; at: number } | null = null;
let _pruned = false;

/**
 * "지금부터 일어날 내비게이션은 이 경로로 들어간 것" — 호출 직후 {@link HINT_TTL} 안에만 유효.
 *
 * ⚠ `now` 를 **양쪽 다** 인자로 뺀 것이 의도다. 한쪽만 주입하면 테스트가 두 시계를 섞어
 * 쓰게 되고(마크는 실시계·소비는 가짜), TTL 검사가 조용히 무의미해진다 — 실제로 이 파일의
 * 첫 판이 그렇게 통과했다.
 */
export function markVia(via: Via, now: number = Date.now()): void {
  _hint = { via, at: now };
}

/** 힌트를 소비한다(1회용). 없거나 낡았으면 `fallback`. */
export function takeVia(fallback: Via, now: number = Date.now()): Via {
  const h = _hint;
  _hint = null;
  if (!h || now - h.at > HINT_TTL) return fallback;
  return h.via;
}

/** 테스트 격리용 — 모듈 전역 힌트를 비운다. */
export function resetVia(): void {
  _hint = null;
  _pruned = false;
}

/**
 * 방문 1회를 기록한다. **실패해도 조용히 넘어간다** — 관측이 앱 동작을 막으면 안 된다.
 *
 * ⚠ `await` 하지 않는 호출을 전제로 만들었다(내비게이션은 사용자 입력 경로다).
 * 반환 Promise 는 테스트가 쓴다.
 */
export async function recordVisit(key: string, via: Via, todayDs: string = todayISO()): Promise<void> {
  if (!isSqlitePrimary()) return;
  await execDb(
    `INSERT INTO route_visits (key, day, via, n) VALUES (?, ?, ?, 1)
     ON CONFLICT(key, day, via) DO UPDATE SET n = n + 1`,
    [key, todayDs, via],
  );
  // 청소는 세션당 1회로 족하다 — 매 내비게이션마다 DELETE 를 쏘면 관측이 관측 대상보다 비싸진다.
  if (!_pruned) {
    _pruned = true;
    await execDb(`DELETE FROM route_visits WHERE day < ?`, [iso(addDays(parseISO(todayDs), -KEEP_DAYS))]);
  }
}
