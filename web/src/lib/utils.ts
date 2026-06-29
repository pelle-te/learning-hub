/* ============================================================
   utils.ts — 상수 & 순수 유틸 (프레임워크 무관). 레거시 js/utils.js 이식.
   전역 state를 읽던 헬퍼(todayISO·itemById)는 state를 인자로 받게 파라미터화.
   DOM/FS 의존(pageEl·loadVaultIndex 등)은 이식하지 않음(각각 app/features·Phase 5).
============================================================ */
import type { AppState, Item } from './types';

export const DOW = ['일', '월', '화', '수', '목', '금', '토'];
export const DOW_MON = ['월', '화', '수', '목', '금', '토', '일']; // 주간뷰(월요일 시작)
export const REVIEW_OFFSETS = [1, 3, 7, 16]; // 간격반복 복습(일)
/** 과목 색 팔레트(인디고 브랜드와 경쟁 안 하도록 인디고 제외, 명도·채도 정돈). */
export const PALETTE = ['#4f8ff0', '#1eb5a3', '#d99a3c', '#e76a8b', '#9a78ec', '#34b3df', '#6fae42', '#e07a4e'];
/** 고정 일과 블록 유형(색). '공부' 개념은 폐지 — 가용시간은 '깨어있는 시간 − 블록'으로 자동 계산. */
export const BLOCK_TYPES: Record<string, string> = {
  수면: '#3a3f4b',
  식사: '#c98a5e',
  취미: '#9a7fd1',
  수업: '#5e8ac9',
  기타: '#5a6072',
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
  const [y, m, d] = s.split('-').map(Number);
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
  const [h, m] = t.split(':').map(Number);
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
/** esc(): HTML 속성/본문에 안전하도록 작은따옴표까지 이스케이프. */
export function esc(s: unknown): string {
  return (s ?? '')
    .toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
