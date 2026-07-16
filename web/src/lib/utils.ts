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

/** 과목 색은 '저장값'이 아니라 팔레트의 파생물 — 부팅마다 항목 인덱스로 다시 유도한다.
 *  (수동 색 선택 UI가 없으므로 안전.) 이 덕에 PALETTE만 바꾸면 어떤 저장 데이터든 다음 부팅에 전부 갱신된다
 *  — 옛 색을 hex로 일일이 매핑하던 리맵의 사각지대(저장값이 목록에 없으면 안 바뀜)를 원천 제거. */
export function refineItemColors(state: AppState): AppState {
  (state.items || []).forEach((it, i) => {
    it.color = PALETTE[i % PALETTE.length] as string;
  });
  return state;
}

/** 새 학습 항목 생성 — 색은 현재 항목 수로 팔레트 순환. items/degree/anki/vault의 6개 중복 골격 단일화.
 *  기본은 주간 과목; partial로 source/mode/weeklyHours/dailyMin/chapters 등을 덮어쓴다. */
export function makeItem(itemCount: number, partial: Partial<Item> & { name: string }): Item {
  return {
    id: rid(),
    source: '직접',
    color: PALETTE[itemCount % PALETTE.length],
    mode: 'weekly',
    weeklyHours: 3,
    dailyMin: 30,
    deadline: '',
    chapters: [],
    ...partial,
  };
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
/** 유효숙달 p∈[0,1] → 색(빨강 낮음→호박→초록). kind==='unknown'이면 회색(데이터 없음). */
export function masteryColor(p: number, kind?: string): string {
  if (kind === 'unknown') return 'var(--line,#3a3a3a)';
  const h = Math.round(clamp(p, 0, 1) * 120);
  return `hsl(${h} 62% ${42 + Math.round(p * 10)}%)`;
}
