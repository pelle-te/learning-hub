/* ============================================================
   shell/icons.tsx — 라인 아이콘(Lucide 스타일·단색·currentColor). 레거시 tabs.js의 svgIcon 이식.
   ICON_PATHS는 신뢰된 정적 상수(SVG inner) → dangerouslySetInnerHTML로 주입. CSS는 .ic(전역).
============================================================ */
const ICON_PATHS: Record<string, string> = {
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  chart:
    '<path d="M3 3v18h18"/><rect x="7" y="11" width="3" height="6"/><rect x="12" y="7" width="3" height="10"/><rect x="17" y="13" width="3" height="4"/>',
  cap: '<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1 2.5 3 6 3s6-2 6-3v-5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M15 13H9M15 17H9M10 9H9"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.07 0l2.5-2.5a5 5 0 0 0-7.07-7.07l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.07 0L4.43 13.5a5 5 0 0 0 7.07 7.07l1.5-1.5"/>',
  notebook:
    '<path d="M2 6h3M2 10h3M2 14h3M2 18h3"/><rect x="5" y="3" width="17" height="18" rx="2"/><path d="M10 3v18"/>',
  refresh:
    '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
  clipboard:
    '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h6"/>',
  // 숙달도 지도(히트맵) — 2×2 격자로 '맵'을 암시(통계 chart와 시각 구분).
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  // 지식맵(그래프) — 노드-링크로 '연결된 지식'을 암시.
  graph:
    '<circle cx="5" cy="6" r="2.5"/><circle cx="18" cy="5" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M7.2 7.1 10.5 15.8M15.7 6.6 13 15.8M7.4 6.2 15.6 5.2"/>',
  // 시스템 제어판(OPS) — 슬라이더 콘솔. 설정(gear)과 시각 구분(레일 톱니 중복 해소).
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  // 탐구 수집 — 돋보기(검색엔진 느낌).
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  // 사이드바 접기/펼치기 토글 — 좌측 패널 글리프.
  panelLeft: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
  // 증시 동향 — 상승 추세선+화살촉(trending-up). chart(막대)·graph(노드)와 시각 구분.
  trend: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  // 내 길 지도(goals) — 나침반(방향·목표). target(과녁)·radio(신호)와 시각 구분.
  compass: '<circle cx="12" cy="12" r="9"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88"/>',
  // 진로 지도(전파·통신 아틀라스) — 방송 신호(양측 동심호 + 중심점). trend(추세)·graph(노드)와 시각 구분.
  radio:
    '<circle cx="12" cy="12" r="2"/><path d="M4.93 19.07a10 10 0 0 1 0-14.14M19.07 4.93a10 10 0 0 1 0 14.14M7.76 16.24a6 6 0 0 1 0-8.48M16.24 7.76a6 6 0 0 1 0 8.48"/>',
  // 발견 큐(serendipity) — 큰 별+작은 별(발견·insight). compass(방향)·target(과녁)·radio(신호)와 시각 구분.
  discovery:
    '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M18.5 15l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  // 읽을거리 — 신문(칼럼·뉴스 지문 + 독서). file(문서)·book(독서 글리프)와 시각 구분.
  reads:
    '<path d="M4 22a2 2 0 0 1-2-2V7h4"/><path d="M6 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4"/><path d="M10 8h8M10 12h8M10 16h5"/>',
  // 헤더 액션·테마(이모지 대체) — 라인 아이콘으로 통일.
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-1"/>',
  trash:
    '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6M14 11v6"/>',
};

/** name에 맞는 라인 아이콘(없으면 null). */
export function Icon({ name }: { name?: string }) {
  const p = name ? ICON_PATHS[name] : '';
  if (!p) return null;
  return <svg className="ic" viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: p }} />;
}
