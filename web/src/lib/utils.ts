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

export function colorForId(id: string): string {
  // FNV-1a 32비트 — 짧고 결정적이며 rid() 같은 짧은 문자열에서도 분포가 고르다.
  // >>> 0으로 부호 없는 32비트를 유지(자바스크립트 비트연산은 부호 있는 32비트라 음수 방지).
  let h = 0x811c9dc5;
  const s = String(id || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return oklchToHex(SUBJECT_L, SUBJECT_C, h % 360); // 해시 → 색상환 각도(0~359)
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
 *  spread 뒤의 최종 id로 계산하지 않으면 저장 색과 부팅 시 재유도 색이 어긋난다. */
export function makeItem(partial: Partial<Item> & { name: string }): Item {
  const merged = {
    id: rid(),
    source: '직접',
    mode: 'weekly',
    weeklyHours: 3,
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
 *  학습=녹색 가족 / 일과=차분한 슬레이트 / 액센트=라임 → 3티어가 hue로 갈려 한눈에 구분되고 딥블랙과 조화.
 *  타임라인에선 .muted로 발광 없이 깔리므로, 색을 가져도 학습 세그(발광)와 위계가 또렷이 갈린다. */
export const BLOCK_TYPES: Record<string, string> = {
  수면: '#586a96',
  식사: '#9a8676',
  취미: '#7d7397',
  수업: '#6f8bb0',
  기타: '#7a8294',
};
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

/** 시간(시간 단위) 표시 — 분으로 안 다루도록. */
export function hLabel(min: number): string {
  return round1(min / 60) + 'h';
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
  if (kind === 'unknown') return 'var(--line,#3a3a3a)';
  const t = clamp(p, 0, 1);
  const h = Math.round(t * 120);
  return `hsl(${h} 62% calc(var(--mastery-l0) + (var(--mastery-l1) - var(--mastery-l0)) * ${t.toFixed(3)}))`;
}
