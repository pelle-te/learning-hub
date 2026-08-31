/* ============================================================
   lib/motion.ts — **명령형 모션**(WAAPI)의 공유 진입점.

   ## 왜 이 파일이 따로 있는가

   이 앱의 모션 자제(reduced-motion) 방어선은 `styles/global/features.css` 의 전역 백스톱이다 —
   `animation-duration/transition-duration` 을 0.001ms 로 눌러 **CSS 로 표현된 모션 전부**를 죽인다.
   그런데 **Web Animations API 는 그 백스톱이 원리적으로 안 닿는다**: WAAPI 애니메이션은 CSS
   캐스케이드가 아니라 애니메이션 타임라인에 직접 얹히므로, CSS 로는 취소할 수단이 없다.

   즉 "전역 CSS 가 알아서 막아 준다"는 이 저장소의 다른 자리에서 맞는 가정이 여기서만 틀리고,
   틀린 결과가 **조용하다**(모션 민감 사용자의 화면에서만 애니가 남는다 · 정적 검사·스냅샷 어느
   쪽도 못 본다). 그래서 명령형 모션은 전부 이 파일을 거치고, 가드는 여기 한 곳에만 산다.

   ⚠ 키프레임 값에 `var(--토큰)` 을 그대로 싣지 않는다 — WAAPI 의 커스텀 프로퍼티 치환은 엔진마다
     갈려 조용히 무애니가 된다. 색은 **계산값**으로 받는다(호출부가 이미 아는 값이면 그대로 넘긴다).
============================================================ */

/* ── 모션 자제 판정 — **축이 하나다**(H19 · 2026-07-30 `/감사 근본`) ──────────────────

   자제해야 할 이유는 둘인데(OS 의 `prefers-reduced-motion`, 앱 설정의 `발광 효과 줄이기`)
   **판정이 다섯 곳에 흩어져 있었고 그중 둘만 후자를 알았다**(`AmbientCanvas`·`Items`).
   결과가 관측 가능한 거짓말이었다: 설정 라벨이 _"배경 오로라·**발광 펄스 정지**"_ 를 약속하는데
   `commit()` 의 액센트 링 펄스는 계속 돌았다. `data-fx=lite` 의 CSS 백스톱(`global/motion.css`)은
   **WAAPI 에 원리적으로 안 닿기** 때문이다 — 이 파일이 존재하는 이유와 정확히 같은 논거인데
   가드만 절반이었다.

   그래서 두 이유를 여기서 OR 로 합치고, 다른 자리는 전부 이 함수를 부른다. 이유가 셋이 되면
   고칠 곳도 여기 하나다. */

/** OS 의 모션 자제 설정. matchMedia 가 없는 환경(테스트·SSR)에서는 '자제 아님'으로 본다. */
function prefersOS(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 앱 설정 '발광 효과 줄이기'(`ThemeProvider` 가 `data-fx="lite"` 로 캐스케이드에 싣는다). */
function fxLite(): boolean {
  return typeof document !== 'undefined' && document.documentElement.getAttribute('data-fx') === 'lite';
}

function reduced(): boolean {
  return prefersOS() || fxLite();
}

/**
 * 모션을 자제해야 하는가 — **OS 설정 또는 앱 설정**(위 절).
 *
 * ⚠ 이 앱에서 "모션 자제"를 판정하는 **유일한 자리**다. 각자 `matchMedia` 를 부르면 그 사본은
 * `data-fx` 를 모르는 채로 남고, 그게 H19 의 형태였다(설정이 약속한 것과 화면이 다름).
 */
export function prefersReducedMotion(): boolean {
  return reduced();
}

/* ── D-7 모션 어휘 — **이 앱의 움직임은 여섯 마디만 말한다**(넷 → 다섯 E24 → 여섯 P-17) ──
   키프레임이 35개였다(fade 9종·pulse 5종·pop 3종·slide 3종이 **같은 일을 이름만 달리**).
   이름이 많다는 것은 문법이 없다는 뜻이고, 문법이 없으면 새 화면마다 새 움직임이 생긴다.

   · **enter**   — 처음 존재하게 됨(없던 것이 생김). 페이드 · 상승 · 슬라이드 · 팝.
   · **commit**  — **내 행동이 반영됨**(아래 `commit()`). 1회 · 액센트 링 · 되돌아옴.
   · **live**    — 시스템이 스스로 변함(지금 진행 중·수신 중). **무한 애니는 여기만 허용**.
   · **transit** — 화면과 화면 사이(뷰 트랜지션 · D-8 이 방향 문법을 준다).
                   ⚠⚠ **키프레임 접두사는 `vt-` 다**(U071 · 2026-08-31). 이 마디만 이름과 접두사가
                   다르다 — 나머지 다섯은 마디 이름이 곧 접두사인데(`enter-…`·`shed-…`) 이것만
                   `@keyframes vt-…` 이고, 집행자(`invariants.test.ts` 불변식 ⑥)도 `vt-` 만 받는다.
                   그 규약이 **SSOT 인 여기 적혀 있지 않아서**, `@keyframes transit-slide` 를 지으면
                   빨개지는데 문서를 다시 읽어도 이유를 알 수 없었다. 이름을 안 바꾸는 이유:
                   `vt` 는 브라우저 API(View Transition)의 이름이라 그 층과 짝이 맞는 편이 낫고,
                   개명은 키프레임·유틸·베이스라인을 함께 움직인다(값 무변경 원칙 밖).
   · **draw**    — **값이 자기 크기까지 자란다**(링 arc · 막대 · 진행 채움). ⚠ E24 가 실측으로
                   찾은 다섯째다. 넷으로 적어 두는 동안 이 부류는 **어휘가 없어서** 700·1000ms
                   리터럴로 흩어져 있었고(`stroke-dashoffset`·`height`·`width` 전이), 로드맵은
                   그 값들을 "무한 애니의 주기"라 오진했다. 사람의 조작 속도가 아니라 "읽을 수
                   있게"가 기준이므로 `--dur-*` 보다 두 배 길다(`--draw`).
   · **shed**    — **사라짐**(끝남 · 이번 회차에서 빠짐 · 퇴장). ⚠ P-17 이 채운 여섯째다. 앞의
                   다섯이 전부 등장·반영·진행·전이·성장이라 **소멸에 문법이 없었고**, `tw.css` 는
                   그 사실을 자백해 뒀다(_"어휘에 `exit` 이 따로 없는 이유는 구성원이 하나이기
                   때문 … 둘째가 생기면 그때 어휘가 된다"_). 대가는 목록 항목의 **0프레임
                   언마운트**였다. 상태는 `.ds-shed`(채도 저하 + 취소선 · **투명도 금지**),
                   전이는 `shed-pop`(완전 퇴장)·`shed-row`(자리째 접힘).
                   ⚠ **퇴장은 진입보다 빠르다**(`--dur-fast`) 그리고 **이징이 반대다**
                   (`--ease-shed` = ease-in · 진입은 ease-out). ease-out 으로 나가면 "떠나는 중"이
                   아니라 "머뭇거리는 중"으로 읽힌다.

   ⚠⚠ **일곱째·여덟째(`shift` A-17 · `deny` A-18)가 은퇴했다**(I027 · 2026-08-22 발상 축).
     둘 다 소비처가 **레일 조립 화면 하나**뿐이었고, 그 화면이 15일 무사용으로 은퇴하면서 어휘에
     발화가 0인 마디 둘이 남았다. **한 번도 말해지지 않는 마디는 어휘가 아니다** — 이 파일이
     세운 논거(_"이름이 많다는 것은 문법이 없다는 뜻"_)가 자기 자신에게 적용된 형태다.
     되살리려면: `git show 5150731:web/src/lib/motion.ts`. 되살릴 조건은 **두 번째 소비처**다
     (그게 `shed` 를 어휘로 만든 기준이기도 하다 — `tw.css` 의 그 자백).

   ⚠ 예외는 **1페이지 1개**까지 — 시그니처 비주얼(오늘 히어로 오로라 등)은 정체성이라 문법
     밖에 둔다. 예외 없는 문법은 원칙 3(시그니처 하나)을 죽인다.
   ⚠ CSS 로 표현된 enter/live/draw 는 키프레임이 소유하고(**SSOT = `styles/tw.css`**), 여기 있는
     것은 **명령형(WAAPI)** 뿐이다 — 이유는 이 파일 머리주석(전역 reduced-motion 백스톱이
     WAAPI 에 안 닿는다).
   ⚠ **길이는 어휘의 일부다.** 값은 `styles/tokens.css` 의 `--dur-fast|--dur|--dur-slow` ·
     `--dur-cele` · `--draw` · `--tempo-*` · `--stagger` 가 갖는다. 리터럴을 쓰지 말 것. */

/** `commit` 의 유일한 길이 — 340ms. 눈이 알아채되 다음 동작을 막지 않는 값.
 *
 * ⚠ **`tokens.css` 의 `--dur-slow` 와 같은 값이어야 한다.** 여기서 `var(--dur-slow)` 를 쓸 수
 *   없는 이유는 이 파일 머리주석의 마지막 경고다(WAAPI 의 커스텀 프로퍼티 치환은 엔진마다
 *   갈려 조용히 무애니가 된다) → 복제가 불가피하고, 드리프트는 `invariants.test.ts` 가
 *   tokens.css 를 실제로 읽어 막는다. */
const COMMIT_MS = 340;

/**
 * **commit** — "내가 한 것이 반영됐다"를 그 자리에서 1회 번쩍인다(안쪽 액센트 링).
 * @param el    대상. `animate` 가 없는 환경(jsdom 등)에서는 아무 일도 안 한다.
 * @param color 계산된 색. 생략·`var(...)` 이면 그 요소에서 `--acc` 를 풀어 쓴다(토큰은 원천에 있다).
 *
 * 무한 반복·펄스가 아니라 **1회**다 — 상시 움직이는 요소는 주의를 계속 훔치고, 이 앱의
 * 넛지 원칙(발광·펄스 남발 금지)에 정면으로 어긋난다.
 *
 * ⚠ **성공 신호가 토스트뿐이면 안 된다.** 토스트는 화면 구석에서 뜨고 사라지므로 "무엇이"
 *   바뀌었는지를 말하지 못한다. 값이 바뀐 자리에서 번쩍이는 것이 그 답이다.
 */

/**
 * **reveal** — 요소를 보이는 곳으로 스크롤한다. 모션 자제면 즉시 점프(H16 · 2026-07-26 감사).
 *
 * `scrollIntoView({behavior:'smooth'})` 는 **인자가 CSS 백스톱을 이긴다** — `scroll-behavior`
 * 를 눌러도 명령형 인자가 그대로 산다. 그래서 이 판정이 호출부마다 복제돼 있었고, 4곳 중
 * 한 곳(`journal/shared.tsx`)만 가드를 빠뜨려 새고 있었다. 판정이 여러 곳에 흩어진 것이
 * 원인이므로 처방은 "그 한 줄을 고치기"가 아니라 **판정을 한 곳으로 모으기**다.
 *
 * ⚠ 이 파일에 두는 이유: WAAPI 와 같은 부류의 결함이다(전역 CSS 백스톱이 원리적으로 안 닿는
 * 명령형 모션). 머리주석의 논거가 그대로 적용된다.
 */
/* ── Q-11 뷰 전이 morph 규약 ─────────────────────────────────────────────────────────────
   목록의 한 카드가 상세 화면의 헤더로 **이어 그려지는** 전환. 종전엔 이 관용구가 **2곳**뿐이었고
   (`items`→`/subject/:id` · `atlas` 카드→상세) 이름도 각자 지었다(`subject-morph`·`atlas-hero`).
   나머지 전 라우트 전환은 root 크로스페이드라, 같은 객체를 따라가는 이동과 완전히 다른 곳으로
   가는 이동이 **같은 픽셀**로 보였다.

   규약: **`vt-<entity>-<id>`**. entity 가 있으면 "무엇을 따라가는가"가 이름에 남고, id 가 있으면
   같은 종류의 카드가 여럿 떠 있어도 짝이 유일하게 정해진다(종전 이름은 id 가 없어, 두 카드가
   동시에 이름을 가지면 브라우저가 짝을 못 짓고 전환이 통째로 죽는다).
   ⚠ id 는 CSS 식별자에 들어가므로 **영숫자·하이픈만 남긴다** — `rid()` 는 안전하지만 과목 이름이
   id 로 쓰이는 경로가 생기면 곧바로 깨진다(그때 조용히 전환만 안 된다).
   ⚠ **이름을 반납하지 않는다** — 라우트 전환이 끝나면 그 요소가 언마운트되면서 자동으로 사라진다.
   손으로 지우면 전환 도중에 지워질 위험이 있다(옛 `subject-morph` 주석이 이미 같은 결론이다). */
export function morphName(entity: string, id: string): string {
  return `vt-${entity}-${String(id).replace(/[^a-zA-Z0-9-]/g, '')}`;
}

/**
 * 요소에 morph 이름을 붙인다. reduced-motion 이면 **아무것도 안 한다**.
 *
 * ⚠ 판정을 호출부에서 다시 OR 하지 말 것 — 이유가 둘(OS·앱 설정)이고 판정은 `prefersReducedMotion`
 * 하나가 소유한다(H19). 호출부마다 조건을 쓰면 한 곳이 곧 갈린다.
 */
export function applyMorph(el: HTMLElement | null | undefined, entity: string, id: string): void {
  if (!el || prefersReducedMotion()) return;
  el.style.viewTransitionName = morphName(entity, id);
}

export function reveal(el: Element | null | undefined, block: ScrollLogicalPosition = 'center'): void {
  el?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block });
}

export function commit(el: HTMLElement | null | undefined, color = 'var(--acc)'): void {
  if (!el || typeof el.animate !== 'function' || reduced()) return;
  const ring = color.startsWith('var(')
    ? getComputedStyle(el).getPropertyValue('--acc').trim() || 'currentColor'
    : color;
  el.animate([{ boxShadow: `inset 0 0 0 2px ${ring}` }, { boxShadow: 'inset 0 0 0 2px transparent' }], {
    duration: COMMIT_MS,
    easing: 'ease-out',
  });
}
