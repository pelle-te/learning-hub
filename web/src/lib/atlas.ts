/* ============================================================
   atlas.ts — '진로 지도(전파·통신 분야 아틀라스)' 시드 데이터 + 순수 로직(프레임워크 무관).
   이 분야에 어떤 갈래가 있고 · 각 갈래가 뭘 하고 뭘 주력하며 · 어떻게 진입하고 · 지금 어디로 흐르는지를 구조화한다.

   레이어: 최하위 lib(위를 모름). 컴포넌트는 이 모듈의 상수·순수함수만 소비한다.
   ── 데이터 성격 ──
   • FIELDS/CATEGORIES = 편집 가능한 '지식 골격'(시드·도메인 지식 기반 초안). 자동 수집(RSS)이 붙기 전 손으로 채운다.
   • trends(동향) = 시드 예시. 후속에서 /api 자동 수집분이 필드별로 태깅되어 여기에 병합된다.
   • skills = '필요 역량'(내가 얼마나 아는지 진행도는 넣지 않는다 — 근거 없는 % 대신 필요 목록만).
   사용자 오버레이(관심 별·메모)는 lib이 순수하게 계산만 하고, 영속(localStore)은 feature가 담당.
============================================================ */

import { parseISO } from './utils';

export interface TrendItem {
  id: string;
  text: string;
  source: string; // 출처 태그(3GPP·ITU-R·KICS·전파연구원 …)
  daysAgo: number; // SEED_EPOCH 기준 상대일(자동수집 전 임시). 실제 경과일 = daysAgo + (오늘 − SEED_EPOCH).
}

/** 학습 리소스 — 종류(교재·강의·표준·커뮤니티·도구)로 분류. */
export interface Resource {
  label: string;
  kind: string;
}

/** 전망 지표 — 수요·진입난이도·성장 시점(정성 라벨). */
export interface Outlook {
  demand: string; // 인력 수요(보통 · 높음 · 매우 높음 …)
  difficulty: string; // 진입 난이도(중 · 상 · 최상 …)
  horizon: string; // 성장/상용 시점(단기 · 중기 · 장기)
}

export interface AtlasField {
  key: string;
  name: string; // 분야명(짧게)
  cat: string; // 소속 대분류 key
  one: string; // 한 줄 정의
  doing: string[]; // 하는 일(실무 활동)
  focus: string; // 주력 포인트(뭘 위주로)
  skills: string[]; // 필요 역량(칩)
  topics: string[]; // 세부 토픽·키워드(칩)
  entry: string[]; // 진입 경로(전공·자격증·인턴/연구실)
  orgs: string[]; // 대표 기업·기관·연구실
  resources: Resource[]; // 학습 리소스
  future: string; // 미래 전망(서술)
  outlook: Outlook; // 전망 지표
  trends: TrendItem[]; // 현재 동향(시드 → 자동수집 병합)
}

export interface AtlasCategory {
  key: string; // 대분류 key
  num: string; // 표시 번호(01~08)
  name: string; // 대분류명
}

/** NEW(최근 동향)로 치는 기준일 — summary·배지 공용. */
export const NEW_TREND_DAYS = 7;

/* 시드 데이터(CATEGORIES·FIELDS)는 atlasData.ts가 소유한다 — 이 모듈은 타입과 순수 로직만.
   소비처가 계속 '@/lib/atlas' 하나만 보면 되도록 여기서 다시 내보낸다(공개 표면 불변). */
export { CATEGORIES, FIELDS } from './atlasData';
import { CATEGORIES, FIELDS } from './atlasData';

/* ── 순수 로직 ──────────────────────────────────────────── */

/** 시드 동향(daysAgo)의 작성 기준일 — daysAgo는 이 날로부터 며칠 전인지를 뜻한다. */
export const SEED_EPOCH = '2026-07-12';

/** SEED_EPOCH 이후 흐른 일수(음수 클램프). 시드가 시간에 따라 늙게 만드는 축. */
function daysSinceEpoch(now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - parseISO(SEED_EPOCH).getTime()) / 86_400_000));
}

/** 동향의 현재 경과일 = 시드 상대일 + 에폭 이후 흐른 일수. 예전엔 daysAgo가 고정이라 특정 시드가
    영원히 NEW였다(배지 무의미) — 이제 실시간으로 늙는다(now 주입, 자동수집 배선 전까지의 임시 노화). */
export function trendAgeDays(t: TrendItem, now: Date): number {
  return t.daysAgo + daysSinceEpoch(now);
}

/** 필드의 NEW(최근 within일) 동향 개수. now는 주입점(기본 현재시각) — 테스트/미래시점 노화 검증 가능. */
export function newTrendCount(f: AtlasField, now: Date = new Date(), within = NEW_TREND_DAYS): number {
  return f.trends.filter((t) => trendAgeDays(t, now) <= within).length;
}

export interface CategoryGroup {
  cat: AtlasCategory;
  fields: AtlasField[];
}

/** 대분류별로 필드를 묶는다(CATEGORIES 순서 유지). cat 필터가 있으면 그 대분류만. */
export function groupByCategory(fields: AtlasField[], catFilter?: string | null): CategoryGroup[] {
  const groups: CategoryGroup[] = [];
  for (const cat of CATEGORIES) {
    if (catFilter && catFilter !== cat.key) continue;
    const fs = fields.filter((f) => f.cat === cat.key);
    if (fs.length) groups.push({ cat, fields: fs });
  }
  return groups;
}

export interface AtlasSummary {
  total: number; // 전체 필드 수
  categories: number; // 대분류 수
  starred: number; // 관심 표시 수
  newTrends: number; // 최근 within일 신규 동향 총수
}

/** 상단 리드아웃 요약. stars(관심 필드 key 집합)를 받아 관심 수를 센다. now는 NEW 동향 노화 기준(주입점). */
export function atlasSummary(fields: AtlasField[], stars: ReadonlySet<string>, now: Date = new Date()): AtlasSummary {
  const newTrends = fields.reduce((t, f) => t + newTrendCount(f, now), 0);
  let starred = 0;
  for (const f of fields) if (stars.has(f.key)) starred++;
  return {
    total: fields.length,
    categories: new Set(fields.map((f) => f.cat)).size,
    starred,
    newTrends,
  };
}

/** key로 필드 조회(없으면 undefined). */
export function fieldByKey(key: string): AtlasField | undefined {
  return FIELDS.find((f) => f.key === key);
}

/** key의 대분류 메타(없으면 undefined). */
export function categoryOf(field: AtlasField): AtlasCategory | undefined {
  return CATEGORIES.find((c) => c.key === field.cat);
}

/** 분야 → 뉴스 검색어(동향 자동수집용) — 분야명 + 상위 토픽 2개 결합. 셸이 Google 뉴스 RSS에 넘긴다.
    데이터에 별도 저장하지 않고 파생(SSOT는 name·topics). 필요하면 여기 규칙만 바꿔 전 분야 반영. */
export function newsQuery(f: AtlasField): string {
  const name = f.name.replace(/·/g, ' ').replace(/\s+/g, ' ').trim();
  const tops = f.topics.slice(0, 2).join(' ');
  return `${name} ${tops}`.trim();
}
