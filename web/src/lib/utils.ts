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
/** 과목 색 팔레트 — ⑧ 라임 가족 네온 비비드(모노크롬·고채도). 라임그린·에메랄드·민트·틸·스프링·시안틸·제이드·딥틸.
 *  ⑦ 단색 가족을 유지하되 채도를 확 올려 '쨍하게' + WeekGrid 세그에 같은 색 글로우를 입혀 '반짝이게'.
 *  전부 녹색 한 가족이라 세그를 모두 발광시켜도 무지개처럼 안 싸운다 — 라임 액센트까지 함께 빛나는 네온 통일감.
 *  ⚠ 순수 라임(#b6f23a)은 액센트 전용으로 비움(과목 0번은 더 초록 쪽 #9be83f). 일과 블록(BLOCK_TYPES)만 발광 제외.
 *  (스왑: 한 줄만 교체하면 전 탭 반영. 순서를 바꾸면 과목별 배정 색이 바뀜.) */
export const PALETTE = ['#9be83f', '#22d6a4', '#63f0c8', '#1fb89a', '#3fe06a', '#22cdd6', '#5fe8a8', '#1f9b8a'];

/* 과목 색 파생 키 = **item.id 해시**(0단계-G · 2026-07-19 결정).
   이전엔 배열 인덱스였다. 인덱스는 위치 정보라 삭제·재정렬 시 뒤따르는 모든 과목 색이 한 칸씩
   밀렸고(Items.tsx가 이동 직후 재유도로 덮어 가리고 있었다), 그 보정 코드가 파생 로직을 4곳으로
   불렸다. id는 과목의 정체성이라 위치가 바뀌어도 불변 → 파생이 1곳으로 모이고 보정이 사라진다.

   ⚠ 알려진 트레이드오프(결정 시 감수):
   ① 목록의 '순서 있는 색 그라데이션'을 잃는다(팔레트 주석 ⑦⑧이 의도했던 것).
   ② 해시는 충돌한다 — 8색이므로 과목 5개면 두 과목이 같은 색일 확률이 약 80%다(생일 문제).
      인덱스 방식은 8개까지 색 중복이 없었다. 충돌 없이 완전 불변은 8칸에선 원리적으로 불가능
      (충돌 회피는 '다른 과목의 존재'에 의존 → 삭제 시 색이 바뀜 = 불변성 포기).
      중복이 실사용에서 거슬리면 PALETTE를 늘리는 게 정공법이다(색을 늘리면 확률이 급감).
   원칙(절대규칙 #3)은 그대로다: **색은 저장값이 아니라 PALETTE의 파생물**이고, PALETTE 한 줄을
   바꾸면 전 탭에 반영된다. 바뀐 건 '무엇으로부터 파생하는가'(위치 → 정체성)뿐이다. */
export function colorForId(id: string): string {
  // FNV-1a 32비트 — 짧고 결정적이며 rid() 같은 짧은 문자열에서도 분포가 고르다.
  // >>> 0으로 부호 없는 32비트를 유지(자바스크립트 비트연산은 부호 있는 32비트라 음수 인덱스 방지).
  let h = 0x811c9dc5;
  const s = String(id || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return PALETTE[h % PALETTE.length] as string;
}

/** 과목 색은 '저장값'이 아니라 팔레트의 파생물 — 부팅마다 id 해시로 다시 유도한다.
 *  (수동 색 선택 UI가 없으므로 안전.) 이 덕에 PALETTE만 바꾸면 어떤 저장 데이터든 다음 부팅에 전부 갱신된다
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
  return h * 60 + (m || 0);
}
export function toHM(m: number): string {
  m = Math.round(m);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
export function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}
/** jsq(): JS 문자열 리터럴용 — 따옴표·백슬래시·개행 차단. */
export function jsq(s: unknown): string {
  return (s ?? '').toString().replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' ').replace(/\r/g, '');
}
/** 시간(시간 단위) 표시 — 분으로 안 다루도록. */
export function hLabel(min: number): string {
  const h = min / 60;
  return Math.round(h * 10) / 10 + 'h';
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
