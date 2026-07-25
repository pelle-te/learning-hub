/* ============================================================
   shell/tabs.ts — 탭 레지스트리(레거시 tabs.js의 registerTab 분산 등록 → 네이티브 단일 표).
   탭 추가 = 이 배열에 한 줄 + features/registry.tsx에 컴포넌트 등록. 나브/팔레트가 이걸 단일 원천으로 순회.
============================================================ */
/** 나브 표면(Wave⑥) — 학습(핵심·숙련) vs 자료(수집·발견). surface 미지정=전역(두 표면 공통, 설정 그룹). */
export type Surface = 'study' | 'materials';

/* ── 탭의 역할(D-4) ─────────────────────────────────────────────────────
   "갈 수 있는 곳"의 열거가 **다섯 벌이었고 멤버십이 서로 달랐다**: 레일 9 / 세그먼트 13 /
   `g`키 13 / `[ ]` 링 13 / ⌘K 25. 그 불일치가 조용한 결함을 낳았다 — `[ ]` 는 표면 경계를
   넘어 자료 탭으로 새고(레일엔 없는 곳으로 간다), `settings` 는 레일엔 있는데 링엔 없고,
   `g o` 는 죽은 탭으로 갔다 튕겼다.

   원인은 `hidden` 이 **부정으로 정의된 한 비트**였다는 것이다. "숨김"은 *어디서* 숨는지를
   말하지 않으므로 소비처마다 자기 해석을 덧붙일 수밖에 없었다(그게 다섯 벌의 정체다).
   `role` 은 긍정으로 말한다 — 이 탭이 **무엇인가**:

   · `destination` — 상시 도달점. 레일에 서고, `[ ]` 링이 순회하고, `g` 키가 가리킨다.
   · `lens`        — 호스트 안의 조망. 세그먼트·⌘K·딥링크로만 간다(레일·링에 없다).

   ⚠ 이 필드는 **선택이 아니라 필수**다. 기본값을 주면 새 탭이 자기도 모르게 한쪽에 들어가고,
   그 순간 다섯 열거가 다시 갈리기 시작한다. */
export type TabRole = 'destination' | 'lens';

export interface TabMeta {
  key: string;
  label: string;
  group: string;
  order: number;
  /** 도달 방식(위 주석) — 레일·`[ ]` 링·`g` 키의 단일 원천. */
  role: TabRole;
  icon: string;
  /** 소속 표면(Wave⑥ 스위처). 미지정=전역(학습·자료 양쪽에 노출 · 설정 그룹). */
  surface?: Surface;
  /** 단일 화면 대시보드 탭(데모 v6 사상) — HudFrame을 가득 채우고 내부 스크롤 없음.
     App의 fillFrame 판정 단일 원천(옛 하드코딩 FILL_TABS 목록 대체, L-15). */
  fill?: boolean;
  /** SubTabs 세그먼트 버튼에 쓸 짧은 라벨(없으면 label). 나브·⌘K·문서 제목은 그대로 label을 쓴다. */
  segLabel?: string;
}

/** 모든 탭(표시 순서·그룹·표면·아이콘). `role` 이 도달 방식을 정한다(destination=레일·링·g키 · lens=세그먼트·⌘K).
   Wave⑥ 표면 분리: **학습**(study · 계획 plan/숙련 train)과 **자료**(materials · 수집 collect/발견 discover)를
   상단 스위처로 가르고, **설정**(settings) 그룹은 두 표면 공통(전역 · surface 미지정). group=표면 내 소분류.
   빈도 위계: 매일(계획) > 주간(숙련·수집) > 드묾(발견·설정은 하단·⌘K 진입). */
export const TABS: TabMeta[] = [
  // ── 학습 표면 · 계획(plan) ──
  {
    key: 'today',
    label: '오늘 학습',
    group: 'plan',
    surface: 'study',
    order: 10,
    role: 'destination',
    icon: 'target',
    fill: true,
  },
  /* 계획 = 캘린더 자신(D-4). 예전엔 `plan-host` 라는 **화면 없는 셸**이 나브에 서서 `/schedule`
     로 리다이렉트만 했다 — 나브 라벨이 '계획'이어야 하는데 첫 세그먼트 이름이 '캘린더'라는 이유
     하나로 탭 하나가 더 있었던 것이다. 그 이유는 `segLabel` 이 이미 해결한다(나브='계획' ·
     세그먼트='캘린더'). 셸을 지우면 리다이렉트 한 홉과 `shell` 필드가 함께 사라진다. */
  {
    key: 'schedule',
    label: '계획',
    group: 'plan',
    surface: 'study',
    order: 12,
    role: 'destination',
    segLabel: '캘린더',
    icon: 'calendar',
    fill: true,
  },
  // 내 길(goals) — 축 A '내 길 지도'(P9 Phase 6). 전략 앵커(전파통신 연구원 자립 트리)라 오늘 다음, 계획 상단.
  { key: 'goals', label: '내 길', group: 'plan', surface: 'study', order: 15, role: 'destination', icon: 'compass' },
  // 배분 세그먼트(주간 배분 보드) — 옛 배치 탭의 alloc 뷰를 승격(재개편 v4). 캘린더 바로 뒤.
  {
    key: 'alloc',
    label: '주간 배분',
    group: 'plan',
    surface: 'study',
    order: 22,
    role: 'lens',
    segLabel: '배분',
    icon: 'calendar',
    fill: true,
  },
  // 졸업 계획 — 스케줄 세그먼트에서 독립 탭으로 승격(주간 운영과 학기 단위 계획은 리듬이 달라 나브에 직접 노출).
  { key: 'degree', label: '졸업 계획', group: 'plan', surface: 'study', order: 35, role: 'destination', icon: 'cap' },
  // 과목(items) — 전공 과목·챕터 카탈로그 + 뼈대(가용시간·수업·일과) + 과목별 요일 배분(계획 재개편 v3).
  // 계획의 lens. 세그먼트 라벨='과목' — 계획은 [캘린더 · 배분 · 과목] 3세그먼트다(v4).
  // fill: 좌 갤러리 / 우 가용 레일이 화면을 꽉 채우는 프레임이라 여백 래퍼 없이 붙인다.
  {
    key: 'items',
    label: '과목',
    group: 'plan',
    surface: 'study',
    order: 40,
    role: 'lens',
    segLabel: '과목',
    icon: 'file',
    fill: true,
  },
  // ── 학습 표면 · 숙련(train) — '내가 뭘 아는가·무엇을 익힐까' ──
  {
    key: 'journal',
    label: '학습 기록',
    group: 'train',
    surface: 'study',
    order: 60,
    role: 'destination',
    icon: 'notebook',
    fill: true,
  },
  {
    key: 'review',
    label: '주간 리뷰',
    group: 'train',
    surface: 'study',
    order: 70,
    role: 'lens',
    icon: 'refresh',
    fill: true,
  },
  // I-9: 복습 세션 러너 — 오늘 인출할 것(밀린 챕터·회상·착각 재확인)을 한 흐름으로 굴리는 doing surface.
  // lens(레일에 없음) · 오늘탭 복습칩(I-2)·⌘K·기록 세그먼트로 진입 · fill(단일 화면).
  {
    key: 'review-run',
    label: '복습 실행',
    group: 'train',
    surface: 'study',
    order: 72,
    role: 'lens',
    icon: 'refresh',
    fill: true,
  },
  /* ID-9 오답 노트 — 전 기간 CBMS·백지 실패 아카이브. **독립 나브 탭이 아니라 기록 호스트의
     세그먼트다**(사용자 결정 2026-07-25 · I-14 가 같은 긴장에서 '독립탭 대신 강화'로 판정된 선례).
     ⚠ '주간 리뷰'(review)와 시제가 다르다: 리뷰는 *이번 주 처방*, 여기는 *전 기간 아카이브*.
       한 화면에 섞으면 주간 프레이밍이 흐려지고, 나브에 따로 세우면 두 화면이 서로를 먹는다 →
       같은 호스트의 이웃 세그먼트가 그 관계를 화면으로 말해 준다. */
  {
    key: 'mistakes',
    label: '오답 노트',
    group: 'train',
    surface: 'study',
    order: 74,
    role: 'lens',
    icon: 'notebook',
    fill: true,
  },
  {
    key: 'stats',
    label: '통계',
    group: 'train',
    surface: 'study',
    order: 80,
    role: 'destination',
    icon: 'chart',
    fill: true,
  },
  // 복습 부하 예보(ID-1) — 앞 14일 다가오는 복습 파도를 조망. 통계 호스트의 세그먼트로 접는다
  // (분석 대시보드 묶음). lens · 라우트·⌘K·g단축키·세그먼트로 진입 · fill(단일 화면).
  {
    key: 'forecast',
    label: '복습 예보',
    group: 'train',
    surface: 'study',
    order: 82,
    role: 'lens',
    segLabel: '예보',
    icon: 'chart',
    fill: true,
  },
  {
    key: 'mastery',
    label: '숙달도 지도',
    group: 'train',
    surface: 'study',
    order: 85,
    role: 'lens',
    icon: 'grid',
    fill: true,
  },
  // 지식맵은 통계 호스트의 섹션으로 접는다(숙달도 지도와 함께 '내가 뭘 아는가' 맵 묶음). 라우트·⌘K·g단축키는 유지.
  {
    key: 'graph',
    label: '지식맵',
    group: 'train',
    surface: 'study',
    order: 87,
    role: 'lens',
    icon: 'graph',
    fill: true,
  },
  // ── 자료 표면 · 수집(collect) — 피드·읽을거리 ──
  {
    key: 'reads',
    label: '읽을거리',
    group: 'collect',
    surface: 'materials',
    order: 45,
    role: 'destination',
    icon: 'reads',
  },
  {
    key: 'markets',
    label: '증시 동향',
    group: 'collect',
    surface: 'materials',
    order: 47,
    role: 'destination',
    icon: 'trend',
  },
  {
    key: 'atlas',
    label: '진로 지도',
    group: 'collect',
    surface: 'materials',
    order: 48,
    role: 'destination',
    icon: 'radio',
  },
  // ── 자료 표면 · 발견(discover) — surface·triage·연동 ──
  // 발견 큐(discovery) — 축 C '발견 루프'(P9 Phase 6 Wave④). 수집·surface·다리개념 후보를 사람이 승격/기각(D5).
  {
    key: 'discovery',
    label: '발견',
    group: 'discover',
    surface: 'materials',
    order: 49,
    role: 'destination',
    icon: 'discovery',
  },
  {
    key: 'integrations',
    label: '연동 현황',
    group: 'discover',
    surface: 'materials',
    order: 50,
    role: 'destination',
    icon: 'link',
    fill: true,
  },
  // 정본 원장 — 과목×챕터 5단계 파이프라인 진척(통합 4단계 소비). 연동 현황 호스트의 세그먼트로 접는다
  // (자료 생산·연결 상태 묶음). lens · 라우트·⌘K·g단축키·세그먼트로 진입 · fill(단일 화면).
  {
    key: 'ledger',
    label: '정본 원장',
    group: 'discover',
    surface: 'materials',
    order: 52,
    role: 'lens',
    icon: 'grid',
    fill: true,
  },
  // ── 전역(설정) — surface 미지정 → 학습·자료 두 표면 하단에 공통 노출 ──
  // 안내(guide) — 이 시스템이 할 수 있는 것 + 하는 법 매뉴얼(전역 참조). 스크롤 페이지라 fill 없음.
  { key: 'guide', label: '안내', group: 'settings', order: 185, role: 'destination', icon: 'book' },
  // 제어판은 나브에 노출(설정 그룹). 탐구 수집·지식 재빌드 등 운영 도구 진입점.
  {
    key: 'control',
    label: '탐구 수집',
    group: 'settings',
    order: 190,
    role: 'destination',
    icon: 'search',
    fill: true,
  },
  /* ⚠ `settings` 는 **destination 이다** — 레일 하단에 상시 서 있다. 옛 `hidden:true` 는 사실이
     아니었고(레일 빌더가 `|| t.key === 'settings'` 로 예외를 팠다), 그 거짓말 때문에 `[ ]` 링에서만
     조용히 빠져 있었다. 예외를 파야 했다는 것 자체가 그 비트가 틀렸다는 신호였다. */
  { key: 'settings', label: '설정', group: 'settings', order: 200, role: 'destination', icon: 'gear' },
];

/* TABS는 런타임 불변 상수 → 표시순 정렬·key 조회를 모듈 로드 시 1회만 계산하고 재사용(C-8).
   매 내비게이션마다 slice().sort()/find 선형스캔이 헛돌던 것 제거. 반환 배열은 읽기 전용으로 다룬다(제자리 변형 금지). */
export const ORDERED_TABS: TabMeta[] = [...TABS].sort((a, b) => a.order - b.order);
const TAB_BY_KEY = new Map(TABS.map((t) => [t.key, t]));

/* ── 섹션 세그먼트(lens 묶음) ───────────────────────────────────────────
   한 호스트 탭의 '페이지 안 섹션'으로 묶이는 탭들(첫 항목=레일에 서는 호스트=destination).
   나브 정리: 매일 안 쓰는 계획/분석 화면을 호스트 상단 세그먼트로 접어 1차 나브를 6개로 줄인다.
   라우트는 전부 살아있어 딥링크·⌘K·g단축키가 그대로 동작한다. */
export const SUBTAB_GROUPS: string[][] = [
  // 계획 호스트: 캘린더(schedule)가 **자기 자신이 호스트**다(D-4 — 옛 plan-host 셸 은퇴).
  // host=첫 항목=schedule → hostTabKey가 세 세그먼트를 '계획'으로 하이라이트.
  // 순서 = 화면 착지 순서: 캘린더(언제 할까) → 배분(무엇을 얼마씩) → 과목(무엇을·뼈대).
  ['schedule', 'alloc', 'items'],
  ['integrations', 'ledger'],
  // 기록 호스트: 기록(적기) → 주간 리뷰(이번 주 처방) → 복습 실행(지금 굴리기) → 오답 노트(전 기간 아카이브).
  ['journal', 'review', 'review-run', 'mistakes'],
  ['stats', 'forecast', 'mastery', 'graph'],
];

/* ── 나브 그룹(라벨+그룹 사이드바) ────────────────────────────────────────
   TabMeta.group(plan/train/collect/discover/settings) → 사이드바 섹션 헤더 라벨. 빈도 위계를 시각적 청킹으로.
   settings 그룹은 하단(스페이서 아래)에 렌더 — 저빈도 운영/설정(두 표면 공통). */
export const GROUP_LABELS: Record<string, string> = {
  plan: '계획',
  train: '숙련',
  collect: '수집',
  discover: '발견',
  settings: '설정',
};

/* ── 표면 스위처(Wave⑥) ──────────────────────────────────────────────────
   학습(핵심·숙련) vs 자료(수집·발견) 두 표면. RailSidebar 상단 세그먼트가 이걸 순회한다. */
export interface SurfaceMeta {
  key: Surface;
  label: string;
  icon: string;
  /** 스위처 클릭 시 이동할 홈 탭 key(그 표면 첫 노출 탭). */
  home: string;
}
export const SURFACES: SurfaceMeta[] = [
  { key: 'study', label: '학습', icon: 'target', home: 'today' },
  { key: 'materials', label: '자료', icon: 'reads', home: 'reads' },
];

export interface NavGroup {
  key: string;
  label: string;
  tabs: TabMeta[];
}

/** 한 표면에 상시 노출되는 도달점 — `role==='destination'` + 그 표면 소속(또는 전역).
 *  **레일·`[ ]` 링이 같은 이 함수에서 파생된다**(D-4). 예전엔 링이 표면을 안 보고 전역 목록을
 *  돌아 학습 화면에서 `]` 를 누르면 레일에 없는 자료 탭으로 새어 나갔다. */
export function destinations(surface: Surface): TabMeta[] {
  return ORDERED_TABS.filter((t) => t.role === 'destination' && (t.surface === surface || t.surface === undefined));
}

/** 한 표면의 도달점을 그룹 순서대로 묶는다(첫 등장=order 최소). 전역(설정) 그룹은 두 표면 모두 하단 노출. */
function buildNavGroups(surface: Surface): NavGroup[] {
  const groups: NavGroup[] = [];
  for (const t of destinations(surface)) {
    let g = groups.find((x) => x.key === t.group);
    if (!g) {
      g = { key: t.group, label: GROUP_LABELS[t.group] ?? t.group, tabs: [] };
      groups.push(g);
    }
    g.tabs.push(t);
  }
  return groups;
}
/** 표면별 나브 그룹 — TABS 불변이라 표면당 1회 계산해 재사용(C-8 · 매 렌더 재빌드 제거). */
const NAV_GROUPS_BY_SURFACE: Record<Surface, NavGroup[]> = {
  study: buildNavGroups('study'),
  materials: buildNavGroups('materials'),
};
export function navGroups(surface: Surface): NavGroup[] {
  return NAV_GROUPS_BY_SURFACE[surface];
}

/** key가 속한 표면 — 탭 메타의 surface(전역=undefined). 라우트에서 활성 표면 파생에 쓴다. */
export function surfaceOf(key: string): Surface | undefined {
  return TAB_BY_KEY.get(key)?.surface;
}
/** 표면의 홈 탭 key(스위처 클릭 시 이동). SURFACES.home 단일 원천. */
export function surfaceHome(surface: Surface): string {
  return SURFACES.find((s) => s.key === surface)?.home ?? 'today';
}

/** key가 속한 섹션 그룹의 탭 메타 배열(첫 항목=호스트). 그룹에 없으면 null. */
export function subTabGroupOf(key: string): TabMeta[] | null {
  const g = SUBTAB_GROUPS.find((arr) => arr.includes(key));
  if (!g) return null;
  return g.map((k) => tabByKey(k)).filter((t): t is TabMeta => !!t);
}

/** 나브가 1차 활성으로 칠 호스트 key — 흡수 탭이면 그 호스트, 아니면 자기 자신. */
export function hostTabKey(key: string): string {
  const g = SUBTAB_GROUPS.find((arr) => arr.includes(key));
  return g ? g[0]! : key;
}

/** 표시 순서대로 정렬된 탭(모듈 로드 시 1회 계산된 상수 반환 — 제자리 변형 금지). */
export function orderedTabs(): TabMeta[] {
  return ORDERED_TABS;
}
export function tabByKey(key: string): TabMeta | undefined {
  return TAB_BY_KEY.get(key);
}
