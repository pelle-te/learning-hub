/* ============================================================
   markets.ts — '증시 동향' 데이터 레이어(읽기 전용 브리핑).
   수집 산출물 `markets` 를 읽기만 한다 — 지수 등락 + 금융 뉴스.
   사용자 작성물이 없어 로컬 저장층(localStorage/idb)은 없다(reads와 다른 점).
   순수 계산 + fetch만 — 앱 상태(useApp)에 복제하지 않는다(설계도 §1-B, api.ts와 동일 원칙).
============================================================ */
import { getArtifact } from './api';

/** 지수 1종(증시_수집.py의 JSON과 1:1). 등락은 마지막 종가 vs 그 전 종가. */
export interface IndexQuote {
  symbol: string;
  name: string;
  region: string;
  currency: string;
  price: number;
  prevClose: number;
  change: number;
  changePct: number;
  spark: number[];
}

/** 금융 뉴스/칼럼 1편 — 원문 링크 + 발췌(요약 아님). */
export interface NewsItem {
  id: string;
  source: string;
  field: string;
  title: string;
  url: string;
  published: string;
  summary: string;
}

export interface MarketsArtifact {
  at: string;
  date: string;
  indices: IndexQuote[];
  news: NewsItem[];
}

/** 증시 아티팩트 페치(워크스페이스 설정 필요). 미수집/오프라인이면 throw → 호출부가 우아 안내.
    (브리핑 응답 타입은 api.ts MarketBriefResult가 단일 원천 — 필드까지 같은 중복 사본을 두지 않는다.) */
export async function fetchMarketsArtifact(): Promise<MarketsArtifact> {
  const r = await getArtifact<MarketsArtifact>('markets');
  if (!r.ok || !r.data) throw new Error(r.error || '아직 수집된 증시 데이터가 없어요');
  return r.data;
}

/** 뉴스 발행시각을 짧은 상대표기로("방금·3시간 전·어제·M/D"). 파싱 불가면 원문 문자열 그대로(빈 문자열은 '').
    now는 테스트 결정성을 위해 주입 가능(기본=현재). */
export function fmtPublished(published: string, now: number = Date.now()): string {
  const s = (published || '').trim();
  if (!s) return '';
  const t = Date.parse(s);
  if (Number.isNaN(t)) return s; // RSS의 비표준 날짜 등 — 원문 노출이 무표기보다 낫다.
  const mins = Math.round((now - t) / 60000);
  if (mins < 0) return '방금'; // 미래 타임스탬프(시계 오차)는 방금으로.
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

/** 지수 집계(리드아웃용) — 상승/하락/보합 개수. changePct 부호로 분류. */
export function indexStats(indices: IndexQuote[]) {
  let up = 0;
  let down = 0;
  let flat = 0;
  for (const i of indices) {
    if (i.changePct > 0) up += 1;
    else if (i.changePct < 0) down += 1;
    else flat += 1;
  }
  return { total: indices.length, up, down, flat };
}

/** 지역 → 그 지역 지수 배열(원래 순서 유지). 보드를 지역별로 묶을 때 사용. */
export function groupByRegion(indices: IndexQuote[]): [string, IndexQuote[]][] {
  const order: string[] = [];
  const map = new Map<string, IndexQuote[]>();
  for (const i of indices) {
    if (!map.has(i.region)) {
      map.set(i.region, []);
      order.push(i.region);
    }
    map.get(i.region)!.push(i);
  }
  return order.map((r) => [r, map.get(r)!]);
}

/** 부호 붙은 등락률 문자열(+1.24% / −0.82% / 0.00%). 유니코드 마이너스로 폭 안정. */
export function fmtPct(pct: number): string {
  const s = pct > 0 ? '+' : pct < 0 ? '−' : '';
  return `${s}${Math.abs(pct).toFixed(2)}%`;
}

/** 등락 방향 — 색·글리프·aria 문구의 단일 출처(색만 의존 안 하게). */
export function dir(pct: number): 'up' | 'down' | 'flat' {
  return pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
}
