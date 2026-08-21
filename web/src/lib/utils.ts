/* ============================================================
   utils.ts — 상수 & 순수 유틸 (프레임워크 무관). 레거시 js/utils.js 이식.
   전역 state를 읽던 헬퍼(todayISO·itemById)는 state를 인자로 받게 파라미터화.
   DOM/FS 의존(pageEl·loadVaultIndex 등)은 이식하지 않음(각각 app/features·Phase 5).
============================================================ */
import type { AppState, Item } from './types';

export const DOW = ['일', '월', '화', '수', '목', '금', '토'];
export const DOW_MON = ['월', '화', '수', '목', '금', '토', '일']; // 주간뷰(월요일 시작)
export const REVIEW_OFFSETS = [1, 3, 7, 16]; // 간격반복 복습(일)
/** 백지복습 최근 실패 과목의 단축 사다리(감사 2026-07-16 ②#23) — 성과 무반응 고정 사다리 해소. */
export const REVIEW_OFFSETS_WEAK = [1, 2, 4, 8, 16];
/** 백지복습 최근 통과 과목의 꼬리 복습(②#23) — 16일 종결 후 엔진이 영영 복습을 안 만들던 것을
 *  32~35일 창의 1회 꼬리로 연장(spacedReview overdue 표식·수동 ReviewRun 의존 완화). */
export const REVIEW_TAIL_OFFSET = 34;
/** 복습 1블록의 분 — 엔진이 학습 1모듈(ML분)당 예약하는 복습 시간(engine `pushReviewTasks`).
 *  같은 식이 세 곳(engine·dayPlanOverride·dayPlans)에 복제돼 있던 것을 사다리 상수들 옆으로 모은다:
 *  "복습 1블록 ↔ 학습 1모듈"은 부하 환산(N-9 예보 가용선)이 기대는 도메인 규칙이라, 사본이 갈리면
 *  예보의 블록과 계획의 블록이 조용히 다른 것을 세게 된다. */
/* ⚠ 이 함수 안의 세 숫자에 이름을 준다(2026-08-20 리뷰 m-22). 특히 `120` 은
   `persistence.defaults()` 와 `scheduler/engine.ts` 에도 리터럴로 있어 **세 벌**이었다 —
   위 문단이 경고하는 "사본이 갈리면 조용히 다른 것을 센다"가 이 함수 자신에게 적용된 형태다. */
/** 학습 1모듈의 기본 길이(분) — `state.moduleLen` 미설정 시. 세 소비처가 이 상수를 쓴다. */
export const DEFAULT_MODULE_MIN = 120;
/** 복습 1블록이 학습 1모듈에서 차지하는 비율. */
const REVIEW_BLOCK_RATIO = 0.25;
/** 복습 블록의 하한(분) — 이보다 짧으면 인출 자체가 성립하지 않는다. */
const REVIEW_BLOCK_MIN = 15;
export function reviewBlockMin(moduleLen: number): number {
  return Math.max(REVIEW_BLOCK_MIN, Math.round((moduleLen || DEFAULT_MODULE_MIN) * REVIEW_BLOCK_RATIO));
}
/* 과목 색 파생 = **OKLCH 생성**(2026-07-24 · 옛 8색 라임 가족 배열 대체).
   id 해시 → **색상(hue)만** 뽑고 명도(L)·채도(C)는 고정해, 딥블랙 캔버스에서 균질하게 밝고 채도
   있는 색을 **무제한으로** 만든다. 색상환 전체에 고르게 흩어지므로 과목이 5개든 50개든 서로
   또렷이 구분된다 — 옛 8색은 5과목에서 두 과목이 같은 색일 확률이 ~80%(생일 문제)였다.

   ⚠ 절대규칙 #3 그대로: 색은 **저장값이 아니라 파생물**이고 파생 지점은 `colorForId` 1곳,
   파생 키는 위치가 아니라 **정체성**(id)이라 삭제·재정렬에 불변이다. '팔레트 한 줄'이 하던
   "한 곳만 바꾸면 전 탭 반영"의 자리를 아래 `SUBJECT_L`·`SUBJECT_C` 두 노브가 잇는다(두 값을
   바꾸면 전 과목 색조가 한 번에 이동). 바뀐 건 '무엇으로부터 파생하는가'(고정 배열 → OKLCH)뿐.
   출력은 여전히 **hex** 라 모든 소비처(SVG fill·border·인라인 style)가 그대로 받는다. */
const SUBJECT_L = 0.72; // OKLCH 명도 — 딥블랙 위 가독 + 라이트 테마에서도 너무 옅지 않게(두 테마 공용 hex)
const SUBJECT_C = 0.15; // OKLCH 채도 — 생생하되, sRGB 게멋 밖 hue 는 oklchToHex 가 채도만 줄여 맞춘다

/** OKLCH → sRGB hex(Björn Ottosson 변환). sRGB 게멋 밖이면 **채도만 줄여**(명도·색상 보존) 유효한
 *  hex 를 보장한다 — 고채도 파랑/보라 등이 클리핑으로 탁해지는 것을 막는다. */
export function oklchToHex(L: number, C0: number, hDeg: number): string {
  const hr = (hDeg * Math.PI) / 180;
  const toLinear = (C: number): [number, number, number] => {
    const a = C * Math.cos(hr);
    const b = C * Math.sin(hr);
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.291485548 * b;
    const l = l_ ** 3;
    const m = m_ ** 3;
    const s = s_ ** 3;
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
  };
  let C = C0;
  let rgb = toLinear(C);
  for (let i = 0; i < 16 && rgb.some((v) => v < -0.0001 || v > 1.0001); i++) {
    C *= 0.92; // 게멋 밖 → 채도만 축소 후 재시도
    rgb = toLinear(C);
  }
  const gamma = (c: number): number => {
    const x = Math.max(0, Math.min(1, c));
    return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  };
  return `#${rgb
    .map((c) =>
      Math.round(gamma(c) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/**
 * FNV-1a 32비트 — **이 저장소의 유일한 결정적 해시**.
 *
 * 짧고 결정적이며 `rid()` 같은 짧은 문자열에서도 분포가 고르다. `>>> 0` 으로 부호 없는
 * 32비트를 유지한다(자바스크립트 비트연산은 부호 있는 32비트라 음수가 나온다).
 *
 * ⚠ **정체성에서 값을 파생할 때는 이걸 쓴다.** 소비처가 둘이고 둘 다 같은 성질을 산다 —
 * *같은 입력엔 언제나 같은 값, 저장하지 않아도 재현됨*: 과목 색(`colorForId`)과 복습 due
 * 흔들기(`spacedReview.chapterFuzz` · I020). 새 해시를 또 만들면 «저장값처럼 다루지 말 것»
 * 이라는 규율(절대규칙 #3)이 파생마다 다른 근거를 갖게 된다.
 */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  const t = String(s || '');
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function colorForId(id: string): string {
  return oklchToHex(SUBJECT_L, SUBJECT_C, hash32(id) % 360); // 해시 → 색상환 각도(0~359)
}

/** 과목 색은 '저장값'이 아니라 파생물 — 부팅마다 id 해시 → OKLCH 로 다시 유도한다(colorForId).
 *  (수동 색 선택 UI가 없으므로 안전.) 이 덕에 SUBJECT_L·C 만 바꾸면 어떤 저장 데이터든 다음 부팅에 전부 갱신된다
 *  — 옛 색을 hex로 일일이 매핑하던 리맵의 사각지대(저장값이 목록에 없으면 안 바뀜)를 원천 제거. */
export function refineItemColors(state: AppState): AppState {
  // 비객체 원소(null·문자열 등) 방어 — 손상 백업 한 건이 부팅 자체를 throw시켜 앱을 영구 백지로
  // 만들던 경로였다(store 초기화는 렌더 밖이라 어떤 ErrorBoundary도 못 잡는다). 여기서 걸러낸 뒤
  // 색을 파생해야 인덱스도 연속이 된다.
  if (Array.isArray(state.items)) {
    state.items = state.items.filter((it): it is (typeof state.items)[number] => !!it && typeof it === 'object');
    state.items.forEach((it) => {
      it.color = colorForId(it.id);
    });
  }
  return state;
}

/** 새 학습 항목 생성 — items/degree/anki/vault의 6개 중복 골격 단일화.
 *  기본은 주간 과목; partial로 source/mode/weeklyHours/dailyMin/chapters 등을 덮어쓴다.
 *  ⚠ 색은 인자로 받지 않는다(0단계-G) — id의 파생물이라 **병합 후** 유도해야 한다.
 *  호출부가 partial.id로 id를 지정하는 경우가 있어(Items.tsx: 시트를 바로 열려고 id를 미리 만든다)
 *  spread 뒤의 최종 id로 계산하지 않으면 저장 색과 부팅 시 재유도 색이 어긋난다.
 *
 *  ⚠⚠ **목표(`weeklyHours`)의 기본값은 0 이다(H20 · 2026-07-31 `/감사 근본`).**
 *  종전 기본이 `3` 이었고, 그것 때문에 **과목을 만드는 행위 자체가 온보딩 2단계(목표 설정)를
 *  충족**시켜 `Today` 의 셋업 스크림이 영구히 걷혔다(W1). W1 은 그 결함을 `Items.addItem`
 *  **한 호출부에서만** 고쳤는데, 판정식(`SetupGuide.setupComplete`)의 계약은
 *  _"사용자가 정한 것만 본다"_ 라 호출부가 아니라 **생성부의 성질**이다 — 그래서
 *  `Degree.tsx` 로 수강 과목을 먼저 추가하는 경로에는 팬텀 3h/주가 그대로 붙어 같은 결함이
 *  살아 있었다. 기본을 0 으로 내리면 **모든 문**이 한 번에 닫히고, 값이 필요한 호출부는
 *  자기가 명시한다(`VaultPanel` 의 `weeklyHours: 2` 처럼).
 *  ⚠ 판정식은 건드리지 않는다 — 비틀면 "3을 직접 고른 사용자"까지 미완으로 읽는다. */
export function makeItem(partial: Partial<Item> & { name: string }): Item {
  const merged = {
    id: rid(),
    source: '직접',
    mode: 'weekly',
    weeklyHours: 0,
    dailyMin: 30,
    deadline: '',
    chapters: [],
    ...partial,
  } as Item;
  merged.color = colorForId(merged.id);
  return merged;
}
/** 고정 일과 블록 유형(색). '공부' 개념은 폐지 — 가용시간은 '깨어있는 시간 − 블록'으로 자동 계산. */
/** 일과 블록 색 — 과목 팔레트와 같은 더스티 계열로 통일(타임라인에선 옅은 틴트로 깔림). */
/** 일과 블록도 종류별 고유색 — 단 '조용한 슬레이트·뉴트럴' 키로(과거 코랄·mauve 등 따뜻한 색 폐기).
 *  학습=녹색 가족 / 일과=차분한 슬레이트 / 액센트=라임 → 3티어가 hue로 갈려 한눈에 구분된다.
 *  타임라인에선 .muted로 발광 없이 깔리므로, 색을 가져도 학습 세그(발광)와 위계가 또렷이 갈린다.
 *
 *  ⚠⚠ **값이 hex 가 아니라 토큰 참조다**(H21 · 2026-08-01). 종전엔 생 hex 5개였고 그게 **실제
 *  렌더 색**이었다 — `scheduler/layout.ts` 가 `color` 로 싣고 `WeekCalendar` 가 인라인 `--seg` 로
 *  주입해 `tw.css` 의 `seg-scope` 파생 전부가 거기서 나왔다. 즉 색 규율(절대규칙 #3) 밖에 있는
 *  5색이었고, 바로 위 줄이 *"딥블랙과 조화"* 라고 **다크 전용**임을 자백하는데 라이트에서도
 *  그대로 쓰였다. 값·테마별 재정의는 `styles/tokens.css` 가 소유한다.
 *  ⚠ 문자열이 `var(--…)` 형태여야 `scripts/check-tokens.mjs` 의 검사 범위에 들어온다(hex 는
 *  stylelint 도 check-tokens 도 원리적으로 못 본다 — 그게 이 결함이 살아남은 이유다). */
/* ⚠⚠ **`'수면'` 은 라벨이 아니라 스케줄 전체의 입력이다**(2026-08-20 리뷰 m-13).
   `scheduler/windows.awakeBounds` 가 이 문자열 하나로 하루의 깨어있는 창을 정한다 — 라벨을
   다듬으면(`'수면'` → `'취침'`) 어떤 검사도 울지 않고 창이 `[0, 1440]` 이 돼 **새벽 3시에 공부가
   배정된다**(그 함수 주석이 옛 구현에서 겪은 증상으로 적어 둔 바로 그것). 리터럴을 코드에서
   떼어 이름을 주면 비교 6곳이 한 상수를 가리키고, 오타는 컴파일 에러가 된다. */
export const BLOCK_SLEEP = '수면';
export const BLOCK_CLASS = '수업';
export const BLOCK_TYPES = {
  [BLOCK_SLEEP]: 'var(--block-sleep)',
  식사: 'var(--block-meal)',
  취미: 'var(--block-hobby)',
  [BLOCK_CLASS]: 'var(--block-class)',
  기타: 'var(--block-etc)',
} as const satisfies Record<string, string>;
/** 일과 블록 유형. ⚠ `RoutineBlock.type` 은 옛 저장 호환을 위해 `z.string()` 이다 — 새 코드가
 *  비교·분기할 때 이 타입을 쓰면 오타가 컴파일에서 걸린다. */
export type BlockType = keyof typeof BLOCK_TYPES;

/** **일과 블록 유형**의 색 토큰. 모르는 유형은 중립 선색 — 저장값이 `z.string()` 이라 표에 없는
 *  유형이 올 수 있고(옛 백업·손편집), `undefined` 를 인라인 style 에 넣으면 브라우저마다 다르게
 *  떨어진다. 폴백에 이름을 주는 것이 이 함수의 전부다.
 *
 *  ⚠⚠ 이름이 `blockColor` 가 **아닌** 이유: 이 파일 아래쪽에 이미 그 이름이 있고 그건 *계획
 *  블록*(세션)의 색이다 — m-24 가 지적한 "같은 이름 다른 도메인"이 실제로 여기서 한 번 더
 *  일어날 뻔했다. `routine` 접두가 어느 축인지 말한다. */
export function routineBlockColor(type: string): string {
  return (BLOCK_TYPES as Record<string, string>)[type] ?? 'var(--line2)';
}

/** 볼트 순회에서 통째로 건너뛸 폴더명.
 *  ⚠⚠ **`src-tauri/src/vault.rs` 의 `SKIP` 과 같은 목록이어야 한다** — 셸은 Rust 경로로,
 *  브라우저 `npm run dev` 는 File System Access 경로로 **각자 자기 목록을 쓴다**(두 목록이
 *  동시에 살아 있다). 갈리면 같은 볼트에서 노트 수·검증%가 실행 경로에 따라 달라지고, 그 차이가
 *  `vaultAnchors` 를 타고 복습 사다리까지 간다 — 화면 어디에도 안 적힌다.
 *  집행자는 `vault.rs` 의 `스킵_목록이_프런트와_같다` 테스트다(주석이 아니라 그쪽이 규약을 지킨다). */
export const SKIP = new Set(['attachments', 'images', '_assets', '.obsidian', '.trash', '_복습시스템', '_인터랙티브']);

export function rid(): string {
  return Math.random().toString(36).slice(2, 9);
}

/* 날짜/시간 */
/** iso(): 반드시 '로컬' 날짜로 포맷. toISOString()은 UTC라 KST 등에서 하루가 밀린다. */
export function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** todayISO(): '오늘'의 단일 출처. state._today가 있으면 그 값(테스트/시뮬레이션 시드). */
export function todayISO(state?: Pick<AppState, '_today'> | null): string {
  if (state && state._today) return state._today;
  return iso(new Date());
}
/**
 * 지금의 **하루 중 시각**(`HH:MM`, 로컬) — T-8 시각 원장의 유일한 시계.
 *
 * ⚠ `_nowHm` 시드를 존중한다(`todayISO` 가 `_today` 를 존중하는 것과 **같은 규약**). 시드가 없으면
 * 벽시계다. 이게 없으면 e2e·유닛이 이 필드를 결정적으로 검사할 방법이 없고, 그러면 "썼다고
 * 믿지만 아무도 안 재는" 필드가 된다.
 */
export function nowHm(state?: (Pick<AppState, '_today'> & { _nowHm?: string }) | null): string {
  if (state && state._nowHm) return state._nowHm;
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function parseISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}
export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
/** 그 날의 자정(시분 절삭) — 상대·절대 날짜 비교의 기준점. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
export function fmt(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()} (${DOW[d.getDay()]})`;
}
export function fmtShort(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
export function dayDiff(a: string, b: string): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86400000);
}
export function toMin(t: string): number {
  const [h, m] = t.split(':').map(Number) as [number, number?];
  // 시(hour)가 비거나 비수치("":30`)면 NaN 전파를 막는다 — 옛 `toMinLocal` 의 `(h||0)` 흡수와 동치.
  return (Number.isFinite(h) ? h : 0) * 60 + (m || 0);
}
export function toHM(m: number): string {
  m = Math.round(m);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
/* ── 시각 포매터 (CT-S3) ──────────────────────────────────────────────────────
   `const p = (n) => String(n).padStart(2,'0')` 가 feature 안에서 **네 번** 다시 태어나고
   있었다(Control×2 · AnkiPanel · JournalStream) + `MM:SS` 조립이 두 곳(FocusChip ·
   TodaySignature)에 글자단위로 복제돼 있었다. 개별로는 사소하지만 같은 표기 규약이
   여섯 군데에 흩어져 있으면 하나만 고쳐지는 날이 온다. */

/** 한 자리 수를 0 으로 채운다('7' → '07'). */
export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Date → 로컬 'HH:MM'. (분 수 → 'HH:MM' 은 `toHM`.) */
export function hhmm(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 초 → 'MM:SS'(양쪽 0 채움). 60분을 넘으면 분이 세 자리로 늘어난다(타이머 표기 그대로). */
export function mmss(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
}

export function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}
/** jsq(): JS 문자열 리터럴용 — 따옴표·백슬래시·개행 차단. */
export function jsq(s: unknown): string {
  return (s ?? '').toString().replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' ').replace(/\r/g, '');
}
/** 소수 한 자리 반올림. `Math.round(x*10)/10` 이 engine·Review·Today·Items·StatsDetail 등
 *  여덟 곳에 인라인으로 흩어져 있었다(pad2/mmss 를 통합한 것과 같은 이유로 이름을 준다). */
export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * 분 → **단위 없는** 시간 수치 문자열(`180`→`"3"` · `210`→`"3.5"`).
 *
 * ⚠ 이 규칙이 앱 안에서 **네 가지**로 갈려 있었다(2026-07-29 수렴):
 * ① `hLabel`(정본 · `3h`·`3.5h`) ② 인라인 `(min/60).toFixed(1)` **13곳**(항상 `3.0h`)
 * ③ `ItemCard` 의 손으로 다시 쓴 `hLabel` 규칙 ④ `AllocBoard`·`SubjectSheet` 의 `toH` 2벌
 * (뒤엣것은 주석이 _"배분 보드 toH와 같은 규칙"_ 이라 **복제임을 스스로 적어 두었다** — 한쪽
 * 반올림만 바뀌면 주석은 계속 "같다"고 말하는 채로 값이 갈린다).
 * 계획·과목·캘린더·복습이 한 화면에 섞여 보이는 수치라 표기 불일치가 매일 눈에 띄던 자리다.
 *
 * ⚠⚠ **그 수렴이 `src/phone/` 을 건너뛰었다(H26 · 2026-07-31 `/감사 근본`).** 데스크톱 잔여는
 * 0 인데 폰에 ②와 그 사촌이 그대로 남아 있었다(`TodayView` 의 `.toFixed(1)}h` · `DayView` 의
 * `Math.round(min/6)/10}h`) → 4시간이 데스크톱 `4h`·폰 `4.0h`. **위 주석이 "이름으로 지목해
 * 고쳤다"고 적는 동안 한 엔트리가 통째로 범위 밖이었다** — 설계서 §9-4 의 "화면은 갈라도 규칙은
 * lib 하나"가 폰에서 부분 이행이던 자리들 중 하나다.
 */
export function hNum(min: number): string {
  return String(round1(min / 60));
}

/** 시간(시간 단위) 표시 — 분으로 안 다루도록. `hNum` + 단위. */
export function hLabel(min: number): string {
  return hNum(min) + 'h';
}

/**
 * 계획 블록의 표시 색 — **파생 지점은 하나다**(절대규칙 #3 · H26 · 2026-07-31 `/감사 근본`).
 *
 * ⚠ 폴백 규칙이 두 벌이라 같은 데이터가 두 색으로 그려지고 있었다: 데스크톱은 모의 블록을
 * `var(--bad)` 로 칠하는데(`sid === 'mock'` 이라 과목이 없다) 폰 `DayView` 는 `colorForId(it.sid)`
 * 를 무조건 불러 **`colorForId('mock')` 의 임의 hue** 를 칠했다. 색은 저장값이 아니라 파생물이고
 * (절대규칙 #3) 파생이 두 곳이면 그 순간 규칙이 둘이 된다 — `graphData.ts` 가 같은 이유로 이미
 * 이 형태다.
 */
export function blockColor(it: { type?: string; sid: string; color?: string }): string {
  return it.type === 'mock' ? 'var(--bad)' : it.color || colorForId(it.sid);
}

/** 0~1 비율 → `"42%"`. `ledger`·`mastery` 3파일에 4벌로 복제돼 있던 것(가드 유무만 달랐다).
 *  `null` → `"미측정"`: 부모의 사전분포 검역(②#54)이 "근거가 없어 총계를 내지 않는다"를 뜻하므로
 *  0%로 바꿔 그리면 **"측정했는데 0"으로 거짓 표시**된다. 없는 것과 0인 것은 다르다.
 *  `undefined`(아직 안 불러옴)는 종전대로 0% — 로딩 상태와 검역 상태를 섞지 않는다. */
export function pctLabel(x?: number | null): string {
  return x === null ? '미측정' : `${Math.round((x || 0) * 100)}%`;
}

/**
 * epoch ms → 짧은 상대표기("방금 · 3분 전 · 2시간 전 · 어제 · 3일 전 · M/D").
 *
 * `markets.fmtPublished`(뉴스 발행시각)에만 있던 규칙을 여기로 올린다 — 두 번째 소비처가
 * 생겼기 때문이다(⋯ 메뉴의 "되돌리기"가 **언제 것인지** 말해야 한다). 도메인 모듈에 두면
 * 앱 크롬이 뉴스 모듈을 청크로 끌고, 두 번째 사본이 생기면 표기가 갈린다.
 * ⚠ `now` 주입 가능 — 렌더 중 `Date.now()` 는 순수성 린트가 막고, 테스트도 그래야 결정적이다.
 * ⚠ 미래 시각(시계 오차)은 '방금'으로 접는다 — "-3분 전"은 결함으로 읽힌다.
 */
/** **시각**(epoch ms) → 상대 시각 라벨.
 *  ⚠ 짝이던 `daysAgoLabel`(*며칠 전인가* · 정수 일수)이 P10 W4 에서 빠졌다(2026-08-07) — 소비처가
 *  `atlas`·`discovery` 였다. H16 이 그 둘의 **이름을 가른** 이유는 지금도 유효하다: 둘 다 `number`
 *  하나를 받아 문자열을 주므로 타입이 혼동을 못 막는다(`agoLabel(3)` → "56년 전"). 일수 축이
 *  다시 필요해지면 **같은 이름을 재사용하지 말고** 그때도 이름을 갈라라. */
export function agoLabel(t: number, now: number): string {
  const mins = Math.round((now - t) / 60000);
  if (mins < 1) return '방금';
  if (mins < 60) return `${mins}분 전`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}시간 전`;
  const days = Math.round(hrs / 24);
  if (days === 1) return '어제';
  if (days < 7) return `${days}일 전`;
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** Date → 자정부터의 분(`h*60+m`). interactions·Today·useFocus·ics 에 인라인으로 흩어져 있었다. */
export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** Obsidian 볼트 검색 딥링크 — `obsidian://search` 스킴·인코딩을 한 곳으로 모은다(7곳 인라인 수렴).
 *  볼트명 없이도 동작한다(설치돼 있으면). 링크 형식이 바뀌어도 여기 한 곳만 고친다. */
export function vaultSearchUrl(query: string): string {
  return `obsidian://search?query=${encodeURIComponent(query)}`;
}

/**
 * 과목·챕터 → **볼트 검색 질의**. 둘 다 있으면 공백으로 잇고, 하나만 있으면 그것만.
 *
 * ⚠⚠ **이게 5벌이었고 서로 달랐다**(H14 · 2026-08-01):
 * `actions.ts` `[subject, chapter].filter(Boolean).join(' ')` · `Review.tsx` `subject+' '+chapter`
 * (챕터가 없으면 **끝에 공백**이 붙는다) · `Mistakes.tsx` `chapter || subject`(**과목을 아예 뺀다**)
 * · `ReviewRun.tsx` 두 벌. 같은 버튼("볼트에서 열기")이 화면마다 다른 것을 검색했다.
 *
 * ⚠ 그리고 `actions.ts` 의 주석이 그 사실을 **거꾸로** 적고 있었다 — *"`Mistakes.tsx` 가 같은
 * 폴백을 쓴다"* 라고 했는데 그쪽은 `chapter || subject` 라 **정반대**다(챕터가 있으면 과목을
 * 버린다). 사본이 갈리는 것보다 나쁜 것은 **주석이 사본들을 같다고 말하는 것**이다.
 */
export function vaultQuery(subject?: string, chapter?: string): string {
  return [subject, chapter].filter(Boolean).join(' ');
}

/** 볼트 검색을 새 창으로 연다(대부분의 호출부 형태). URL 만 필요하면 `vaultSearchUrl`.
 *  ⚠ `window` 가드 — 이 파일은 헤더대로 **프레임워크·DOM 무관**이어야 한다. 서버(Worker)가
 *  `cloud/contract` → `db/rows` → 여기를 타입 그래프로 끌어오는데, 거기엔 `window` 가 없다. */
export function openVaultSearch(query: string): void {
  // `globalThis.open`(=브라우저 window.open) — `window` 이름을 직접 안 써야 서버 타입그래프에서 안전하다.
  const g = globalThis as { open?: (url?: string | URL, target?: string) => unknown };
  if (typeof g.open === 'function') g.open(vaultSearchUrl(query));
}

/* 주(週) 헬퍼 — 월요일 시작 */
export function mondayOf(d: Date): Date {
  const x = new Date(d);
  const k = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - k);
  x.setHours(0, 0, 0, 0);
  return x;
}
export function weekLabel(monDate: Date): string {
  const end = addDays(monDate, 6);
  return `${fmtShort(monDate)} ~ ${fmtShort(end)}`;
}

/** 학습 항목 id로 항목 찾기 (오늘·통계·주간리뷰 탭 공용). */
export function itemById(state: Pick<AppState, 'items'>, sid: string): Item | undefined {
  return (state.items || []).find((i) => i.id === sid);
}
/** D-day 라벨·강조색 — 마감까지 남은 일수(dday) → {lab,cls}. */
export function ddayInfo(dday: number): { lab: string; cls: string } {
  const lab = dday === 0 ? 'D-DAY' : dday > 0 ? 'D-' + dday : 'D+' + -dday;
  const cls = dday < 0 ? 'bad' : dday <= 7 ? 'warn' : '';
  return { lab, cls };
}
/** 유효숙달 p∈[0,1] → 색(빨강 낮음→호박→초록). kind==='unknown'이면 회색(데이터 없음).
 *  명도는 토큰(--mastery-l0/--mastery-l1)에서 읽어 테마별로 갈린다 — 예전엔 42~52%로 고정이라
 *  다크에선 저숙달 빨강이(2.84:1), 라이트에선 고숙달 초록이(2.05:1) 각각 묻혔다. 램프 자체(빨강→초록)는
 *  색각이상에 취약하므로 호출부는 색만으로 정보를 전달하지 말 것(툴팁·수치 병기 — 현재 두 곳 다 준수). */
export function masteryColor(p: number, kind?: string): string {
  if (kind === 'unknown') return 'var(--line)';
  const t = clamp(p, 0, 1);
  const h = Math.round(t * 120);
  return `hsl(${h} 62% calc(var(--mastery-l0) + (var(--mastery-l1) - var(--mastery-l0)) * ${t.toFixed(3)}))`;
}
