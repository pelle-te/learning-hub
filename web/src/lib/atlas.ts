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

export const CATEGORIES: AtlasCategory[] = [
  { key: 'rfhw', num: '01', name: '무선 · RF 하드웨어' },
  { key: 'mobile', num: '02', name: '이동통신 네트워크' },
  { key: 'sat', num: '03', name: '위성 · 우주 통신' },
  { key: 'spectrum', num: '04', name: '전파 자원 · 관리 · 규제' },
  { key: 'broadcast', num: '05', name: '방송 · 미디어 전송' },
  { key: 'standard', num: '06', name: '표준 · 프로토콜' },
  { key: 'special', num: '07', name: '특수 · 응용 통신' },
  { key: 'phy', num: '08', name: '물리계층 · 신호처리' },
];

/* 필드 시드 — 도메인 지식 기반 초안. 각 항목 편집·확장 가능(자동수집이 trends를 채운다). */
export const FIELDS: AtlasField[] = [
  // ── 01 무선·RF 하드웨어 ──────────────────────────────────
  {
    key: 'antenna',
    name: '안테나 설계',
    cat: 'rfhw',
    one: '배열·MIMO·메타물질로 전파를 원하는 방향으로 쏘고 받는 일',
    doing: [
      '방사패턴·이득·대역폭·임피던스 매칭을 목표 규격에 맞춰 설계',
      '위상배열/빔포밍 안테나와 급전망(feed network) 구현',
      '전자계 시뮬레이션(HFSS·CST)으로 최적화 후 안테나 챔버에서 측정 검증',
      '단말·기지국·차량 등 플랫폼 제약(공간·재질) 안에서 성능 확보',
    ],
    focus:
      '전자기학과 배열 이론이 뼈대. EM 시뮬레이터를 손에 익히고, Massive MIMO·빔포밍처럼 "여러 소자를 함께 제어"하는 감각을 키우는 게 핵심.',
    skills: ['전자기학', '안테나·배열 이론', 'EM 시뮬레이션(HFSS/CST)', '마이크로파 회로', 'RF 측정'],
    topics: ['위상배열', 'MIMO', '메타물질/메타표면', '패치·혼 안테나', '빔포밍', '임피던스 정합', 'RIS'],
    entry: [
      '전자·전파공학 전공 → 전자기학·안테나공학 수강',
      '무선설비기사·정보통신기사로 기초 다지기',
      '안테나/전파 연구실 학부연구생 → HFSS/CST 프로젝트 경험',
    ],
    orgs: ['삼성전자(네트워크·MX)', 'LG전자', '한화시스템', 'ETRI', '국방과학연구소(ADD)', '에이스테크·감마누'],
    resources: [
      { label: 'Balanis, Antenna Theory', kind: '교재' },
      { label: 'Pozar, Microwave Engineering', kind: '교재' },
      { label: 'ANSYS HFSS / CST Studio', kind: '도구' },
      { label: 'IEEE AP-S(안테나·전파 학회)', kind: '커뮤니티' },
    ],
    future:
      '6G에서 재구성 지능형 표면(RIS)·홀로그래픽 안테나로 확장. 메타물질·초박형 배열로 "면 전체가 안테나"가 되는 방향.',
    outlook: { demand: '높음', difficulty: '상', horizon: '중기' },
    trends: [
      { id: 'ant1', text: 'RIS(재구성 지능형 표면) 시제품, 실내 커버리지 실험 확대', source: 'IEEE', daysAgo: 4 },
      { id: 'ant2', text: '단말용 mmWave 위상배열 모듈 집적도 상승', source: 'KICS', daysAgo: 12 },
    ],
  },
  {
    key: 'transceiver',
    name: 'RF 송수신기',
    cat: 'rfhw',
    one: 'PA·LNA·믹서 — 신호를 전파에 싣고 다시 뽑아내는 회로',
    doing: [
      '송수신 체인(PA/LNA/믹서/필터/PLL) 아키텍처 설계',
      '선형성·잡음지수(NF)·효율(PAE)의 트레이드오프 최적화',
      '측정·캘리브레이션(EVM·ACLR·감도)으로 규격 충족 검증',
      'Doherty·엔벨로프 트래킹·DPD로 전력증폭기 효율 확보',
    ],
    focus: '아날로그/RF 회로 이해 위에, "선형성 vs 효율" 줄다리기를 다루는 기법(DPD·Doherty)을 익히는 게 실무의 핵심.',
    skills: ['RF/아날로그 회로', '신호·시스템', '반도체 소자', 'RF 측정(VNA·스펙트럼)', '전력증폭기 이론'],
    topics: ['PA/LNA', '믹서·PLL', 'DPD(디지털 사전왜곡)', 'Doherty', '엔벨로프 트래킹', 'NF/IP3', 'EVM/ACLR'],
    entry: [
      '전자공학 → 아날로그·RF 회로설계 수강',
      '회로 설계 연구실 → 칩 테이프아웃 or 보드 설계 경험',
      '무선설비기사 + 계측기(VNA·스펙트럼) 실습',
    ],
    orgs: ['삼성전자(시스템LSI)', 'Qualcomm', 'Skyworks·Qorvo', 'ETRI', '어보브반도체·에이디테크놀로지'],
    resources: [
      { label: 'Razavi, RF Microelectronics', kind: '교재' },
      { label: 'Pozar, Microwave Engineering', kind: '교재' },
      { label: 'Cadence/Keysight ADS', kind: '도구' },
      { label: 'IEEE MTT-S(마이크로파 학회)', kind: '커뮤니티' },
    ],
    future:
      'GaN 기반 고효율 PA와 광대역 DPD의 결합, mmWave 대역으로의 확장이 관건. 소프트웨어 정의 무선(SDR)로 유연화.',
    outlook: { demand: '높음', difficulty: '상', horizon: '단기' },
    trends: [{ id: 'trx1', text: '광대역 DPD로 PA 효율·선형성 동시 개선 논문 다수', source: 'IEEE', daysAgo: 9 }],
  },
  {
    key: 'mmwave',
    name: '밀리미터파 · THz',
    cat: 'rfhw',
    one: '초광대역 고주파 — 6G·이미징의 물리적 한계를 개척',
    doing: [
      'mmWave/THz 소자·안테나·패키징(AiP) 설계',
      '전파 전파(propagation)·경로손실·블로키지 측정과 모델링',
      '빔 트래킹·빔 관리로 링크 유지',
      '고주파용 온보드·온패키지 집적 검증',
    ],
    focus: '고주파 특유의 큰 경로손실·직진성을 다루는 채널 측정·모델링과, 소자·패키징 집적이 핵심 난제.',
    skills: ['전파 전파 이론', '고주파 소자', '안테나·패키징(AiP)', '채널 측정·모델링', 'EM 시뮬레이션'],
    topics: ['28/39GHz', 'sub-THz(>100GHz)', '경로손실', '빔 트래킹', 'AiP', '위상배열', 'ISAC'],
    entry: [
      '전파공학 → 전자기파·마이크로파 심화',
      'mmWave/THz 연구실 → 측정 캠페인·채널모델 참여',
      '통신사·장비사 5G mmWave 인턴',
    ],
    orgs: ['삼성전자', 'ETRI', 'KAIST·포스텍 THz 연구실', 'Keysight', 'ADD'],
    resources: [
      { label: 'Rappaport, mmWave Wireless Comm.', kind: '교재' },
      { label: '3GPP TR 38.901(채널모델)', kind: '표준' },
      { label: 'Keysight PNA/채널 사운더', kind: '도구' },
    ],
    future: '6G 후보 대역(sub-THz). 통신+이미징+센싱 융합. 소자·패키징 상용화가 최대 병목이자 기회.',
    outlook: { demand: '보통(성장)', difficulty: '최상', horizon: '장기' },
    trends: [
      { id: 'mm1', text: 'sub-THz(140GHz) 채널 측정 캠페인 결과 공개', source: '3GPP', daysAgo: 6 },
      { id: 'mm2', text: 'THz 이미징-통신 융합(ISAC) 실증 시연', source: 'IEEE', daysAgo: 15 },
    ],
  },
  {
    key: 'rfic',
    name: 'RFIC · 화합물반도체',
    cat: 'rfhw',
    one: 'GaN·GaAs·SiGe로 만드는 고출력·고효율 RF 칩',
    doing: [
      'RFIC/MMIC(PA·LNA·스위치) 설계·레이아웃·검증',
      '화합물반도체 공정(GaN/GaAs) 특성 반영한 소자 모델링',
      '온칩 정합·열 설계와 신뢰성 평가',
      '패키지·모듈 집적(FEM)',
    ],
    focus: '반도체 소자 물리와 RF 회로를 잇는 자리. 소재별 강점(GaN=고출력, SiGe=집적, GaAs=저잡음)을 아는 게 차별점.',
    skills: ['반도체 소자물리', 'RF 회로', 'IC 레이아웃/EDA', '열·신뢰성', '공정 이해'],
    topics: ['GaN/GaAs/SiGe', 'MMIC', 'PA/FEM', '로드풀', '열 설계', '전력밀도'],
    entry: [
      '전자공학·반도체 → 소자·아날로그IC 수강',
      'IC 설계 연구실 → MMIC 테이프아웃 경험',
      '반도체·방산 RF칩 부서 인턴',
    ],
    orgs: ['삼성전자(파운드리·LSI)', 'RFHIC', 'Wolfspeed·Qorvo', 'ETRI', 'ADD·한화'],
    resources: [
      { label: 'Razavi, Design of Analog CMOS IC', kind: '교재' },
      { label: 'Cadence Virtuoso / Keysight ADS', kind: '도구' },
      { label: 'IEEE IMS(마이크로파 심포지엄)', kind: '커뮤니티' },
    ],
    future: 'GaN이 기지국·위성·국방 PA 주류로. 화합물반도체가 전략물자화되며 국산화 수요 증가.',
    outlook: { demand: '높음', difficulty: '최상', horizon: '중기' },
    trends: [{ id: 'ic1', text: 'GaN-on-Si 대구경 웨이퍼 수율 개선, 단가 하락', source: 'IEEE', daysAgo: 20 }],
  },

  // ── 02 이동통신 네트워크 ─────────────────────────────────
  {
    key: 'ran',
    name: '기지국 · RAN',
    cat: 'mobile',
    one: 'Massive MIMO·빔포밍으로 무선 접속망(RAN)의 용량을 짓는 일',
    doing: [
      '링크버짓·셀 플래닝으로 커버리지/용량 설계',
      '빔포밍·스케줄러 알고리즘, 채널 추정·프리코딩 구현',
      'RU/DU 물리계층 소프트웨어 개발과 프론트홀 연동',
      '필드 최적화(드라이브 테스트)·KPI 튜닝',
    ],
    focus:
      '안테나 어레이 & Massive MIMO, 채널추정, 3GPP 물리계층이 핵심. 전자기학+신호처리+확률통계의 삼각 기반 위에 선다.',
    skills: ['신호처리·DSP', '확률·통계', '정보이론', '3GPP 물리계층', '무선통신 이론'],
    topics: ['Massive MIMO', '빔포밍/프리코딩', '채널추정', '스케줄러', 'HARQ', 'OFDM', 'cell-free'],
    entry: [
      '전자·통신공학 → 디지털통신·무선통신 수강',
      '무선통신 연구실 → 링크레벨 시뮬레이션(MATLAB/Python)',
      '통신사·장비사(삼성 네트워크) 인턴/채용',
    ],
    orgs: ['삼성전자(네트워크)', 'SKT·KT·LG U+', '에릭슨·노키아', 'ETRI', 'HFR·쏠리드'],
    resources: [
      { label: 'Tse & Viswanath, Fundamentals of Wireless', kind: '교재' },
      { label: '3GPP TS 38.211/212/214(물리계층)', kind: '표준' },
      { label: 'MATLAB 5G Toolbox', kind: '도구' },
      { label: '한국통신학회(KICS)', kind: '커뮤니티' },
    ],
    future: '6G AI-native RAN·ISAC(통합 센싱·통신). cell-free MIMO로 "셀 경계"가 흐려지고, 신호처리·ML 비중이 커진다.',
    outlook: { demand: '매우 높음', difficulty: '상', horizon: '단기' },
    trends: [
      { id: 'ran1', text: '통신 3사 vRAN 상용화 확대, 벤더 종속 탈피 가속', source: '3GPP', daysAgo: 2 },
      { id: 'ran2', text: '64T64R Massive MIMO 기지국 도심 밀집셀 표준 장비화', source: 'KICS', daysAgo: 5 },
      { id: 'ran3', text: 'AI 기반 셀 에너지 절감(트래픽 예측 셧다운) 필드 적용', source: '전파연구원', daysAgo: 7 },
    ],
  },
  {
    key: 'oran',
    name: 'Open RAN · vRAN',
    cat: 'mobile',
    one: '기지국을 개방형 인터페이스·소프트웨어로 분해',
    doing: [
      'O-RAN 규격(fronthaul·E2·A1) 구현·상호운용 시험',
      'RU/DU/CU 분리와 가상화(vRAN)',
      'RIC(지능형 컨트롤러)와 xApp/rApp 개발',
      '멀티벤더 통합·성능 최적화',
    ],
    focus: 'O-RAN 아키텍처와 클라우드 네이티브를 함께. RIC 위에서 도는 xApp/rApp(망 자동화 앱)이 차별 포인트.',
    skills: ['네트워크·프로토콜', '클라우드·컨테이너(K8s)', 'C/C++·Go', 'DSP 기초', '시스템 통합'],
    topics: ['O-RAN', 'RIC/xApp', 'fronthaul(7.2x)', 'vRAN/DU', '클라우드 네이티브', '멀티벤더'],
    entry: [
      '통신·컴퓨터공학 → 네트워크·클라우드 수강',
      'SW 중심이면 컨테이너·리눅스 역량 우선',
      'O-RAN PlugFest·오픈소스(OAI) 참여',
    ],
    orgs: ['삼성전자', 'SKT·KT·LG U+', 'HFR·쏠리드', 'ETRI', 'Rakuten·Mavenir'],
    resources: [
      { label: 'O-RAN Alliance 규격', kind: '표준' },
      { label: 'OpenAirInterface(OAI)', kind: '도구' },
      { label: 'srsRAN 오픈소스', kind: '도구' },
    ],
    future: '개방형 생태계로 벤더 다변화. AI 기반 RIC가 망 자동 최적화의 두뇌로. SW 역량자에게 열린 통신 진입로.',
    outlook: { demand: '높음', difficulty: '중상', horizon: '단기' },
    trends: [
      { id: 'oran1', text: 'O-RAN Alliance 최신 규격 릴리스, RIC 인터페이스 확정', source: '3GPP', daysAgo: 3 },
      { id: 'oran2', text: '국내 vRAN 필드 상용망 확대 발표', source: 'KICS', daysAgo: 10 },
    ],
  },
  {
    key: 'core',
    name: '5G 코어 · 슬라이싱',
    cat: 'mobile',
    one: '서비스별로 망을 잘라 QoS를 보장하는 코어망',
    doing: [
      '5GC(SBA) 네트워크 함수(AMF·SMF·UPF) 설계·운용',
      '네트워크 슬라이싱·QoS 정책 구성',
      'MEC(엣지 컴퓨팅)·특화망 연동',
      '시그널링·세션 관리 트러블슈팅',
    ],
    focus: '서비스 기반 아키텍처(SBA)와 클라우드 네이티브 코어. 슬라이싱 오케스트레이션이 산업 응용의 열쇠.',
    skills: ['네트워크·프로토콜', '클라우드·가상화', '리눅스·컨테이너', '시그널링(HTTP/2·NAS)', '보안'],
    topics: ['5GC/SBA', '네트워크 슬라이싱', 'UPF/SMF', 'MEC', '이음5G(특화망)', 'QoS'],
    entry: [
      '통신·컴퓨터공학 → 네트워크·프로토콜 수강',
      'CCNA/리눅스·클라우드 자격으로 기반',
      '통신사 코어망·클라우드 인턴',
    ],
    orgs: ['삼성전자', 'SKT·KT·LG U+', '에릭슨·노키아', 'ETRI', '네이버클라우드'],
    resources: [
      { label: '3GPP TS 23.501(5GS 아키텍처)', kind: '표준' },
      { label: 'free5GC / Open5GS', kind: '도구' },
      { label: 'Kubernetes 공식 문서', kind: '도구' },
    ],
    future: '슬라이싱이 스마트팩토리·특화망의 핵심. 코어의 완전 클라우드화·자동화(SMO)로 운영 인력 수요 이동.',
    outlook: { demand: '높음', difficulty: '중상', horizon: '단기' },
    trends: [{ id: 'core1', text: '5G 특화망(이음5G) 산업 현장 적용 사례 증가', source: '전파연구원', daysAgo: 8 }],
  },
  {
    key: 'g6',
    name: '6G · AI-native',
    cat: 'mobile',
    one: '통합센싱통신(ISAC)·cell-free로 가는 차세대 무선',
    doing: [
      '6G 요구사항·후보기술 연구와 표준 기고',
      'AI-native 에어인터페이스·수신기 설계',
      'ISAC(센싱-통신 융합) 실험·프로토타이핑',
      '테라헤르츠·거대 배열 실증',
    ],
    focus: 'AI/ML for wireless + 정보이론 + 새 물리계층. 표준화 초기라 연구·논문 비중이 크고, 수학 기반이 관건.',
    skills: ['AI·ML', '정보이론', '신호처리·DSP', '최적화', '논문·표준 기고'],
    topics: ['ISAC', 'AI-native 에어인터페이스', 'cell-free MIMO', 'THz', 'RIS', 'IMT-2030'],
    entry: [
      '통신·전자공학 → 정보이론·확률과정 심화',
      '대학원(무선통신·ML) 진학이 사실상 표준 경로',
      '6G 국책과제 연구실·ETRI 참여',
    ],
    orgs: ['삼성리서치', 'ETRI', 'KAIST·성대·연대 6G 연구실', 'Nokia Bell Labs', 'ADD'],
    resources: [
      { label: 'Goldsmith, Wireless Communications', kind: '교재' },
      { label: 'ITU-R IMT-2030 프레임워크', kind: '표준' },
      { label: '6G Forum(국내)', kind: '커뮤니티' },
    ],
    future: '2030 상용 목표. 통신이 센싱·컴퓨팅과 융합하고 AI가 물리계층까지 침투. 통신+AI 융합 인재 수요 급증.',
    outlook: { demand: '높음(연구)', difficulty: '최상', horizon: '장기' },
    trends: [
      { id: 'g61', text: 'ITU-R IMT-2030(6G) 프레임워크 권고 채택', source: 'ITU-R', daysAgo: 4 },
      { id: 'g62', text: 'AI-native 에어인터페이스 3GPP 스터디 개시', source: '3GPP', daysAgo: 11 },
    ],
  },

  // ── 03 위성·우주 통신 ────────────────────────────────────
  {
    key: 'ntn',
    name: 'NTN · 위성-지상 통합',
    cat: 'sat',
    one: '3GPP 표준으로 위성과 지상망을 하나로 잇는 비지상 네트워크',
    doing: [
      'NTN 규격(도플러·전파지연 보상) 구현',
      '위성-지상 핸드오버·이동성 관리 설계',
      '단말 직접 위성연결(D2D)·IoT-NTN 검증',
      '링크버짓·궤도 기반 커버리지 분석',
    ],
    focus: '큰 전파지연·도플러를 보상하는 물리/MAC 기법과 3GPP NTN 규격. 궤도 역학 기초가 밑받침.',
    skills: ['3GPP 규격', '신호처리·DSP', '위성·궤도 역학', '링크버짓', '이동성 관리'],
    topics: ['NTN', 'D2D(위성-스마트폰)', 'LEO/GEO', '도플러 보상', 'IoT-NTN', '핸드오버'],
    entry: [
      '통신·항공우주 → 위성통신·무선통신 수강',
      '위성통신 연구실·국책 저궤도 과제 참여',
      '통신사·위성사 NTN 협력 프로젝트',
    ],
    orgs: ['삼성전자', 'SKT·KT SAT', '한화시스템', 'ETRI', 'Starlink·AST SpaceMobile'],
    resources: [
      { label: '3GPP TR 38.811 / TS 38.821(NTN)', kind: '표준' },
      { label: 'Maral, Satellite Communications Systems', kind: '교재' },
      { label: 'KICS 위성통신 연구회', kind: '커뮤니티' },
    ],
    future: '스마트폰 직접 위성통신(음영지역 해소)이 상용화 물결. 통신사-위성사 합종연횡으로 시장 재편.',
    outlook: { demand: '높음(급성장)', difficulty: '상', horizon: '단기' },
    trends: [
      { id: 'ntn1', text: '스마트폰-위성 직접연결(D2D) 상용 서비스 개시', source: '3GPP', daysAgo: 3 },
      { id: 'ntn2', text: '3GPP Rel-19 NTN 기능 확장 논의', source: '3GPP', daysAgo: 14 },
    ],
  },
  {
    key: 'leo',
    name: 'LEO 위성군집',
    cat: 'sat',
    one: '저궤도 다수 위성으로 지구 전역 저지연 인터넷',
    doing: [
      '위성 통신 페이로드·링크 설계',
      '위성간 광링크(ISL)·군집 라우팅',
      '지상 게이트웨이·사용자 단말 연동',
      '궤도·도플러 기반 핸드오버 운용',
    ],
    focus: '링크버짓 + 궤도 역학 + 위성 페이로드. 수백~수천 위성을 함께 굴리는 군집 운용·핸드오버 설계가 특징.',
    skills: ['링크버짓 설계', '위성·궤도 역학', '통신 시스템', '광통신(ISL)', '네트워크 라우팅'],
    topics: ['LEO 군집', 'ISL(위성간 광링크)', '핸드오버', '게이트웨이', '평판 안테나', 'Ka/Ku 대역'],
    entry: [
      '항공우주·통신공학 → 위성통신·궤도역학',
      '큐브위성·위성 동아리/연구실 실물 경험',
      '위성 스타트업·국책 저궤도 사업 참여',
    ],
    orgs: ['한화시스템·한화스페이스허브', 'KT SAT', '쎄트렉아이', 'ETRI', 'SpaceX(Starlink)·OneWeb'],
    resources: [
      { label: 'Maral, Satellite Communications Systems', kind: '교재' },
      { label: 'STK(위성 궤도 시뮬레이터)', kind: '도구' },
      { label: '한국항공우주학회', kind: '커뮤니티' },
    ],
    future: 'Starlink류 상용화로 시장 급성장. 국내 저궤도 위성통신 국책사업 본격화로 신규 인력 수요 형성.',
    outlook: { demand: '높음(신생)', difficulty: '상', horizon: '중기' },
    trends: [{ id: 'leo1', text: '국내 저궤도 위성통신 개발 국책사업 예타 통과', source: '전파연구원', daysAgo: 6 }],
  },
  {
    key: 'groundstation',
    name: '위성 지상국 · 링크',
    cat: 'sat',
    one: '위성과 지상을 잇는 안테나·추적·링크버짓의 영역',
    doing: [
      '지상국 대형 안테나·추적(ACU) 시스템 운용',
      '링크버짓·가시선(AoS/LoS) 분석',
      '업/다운링크 주파수 조정과 ITU 등록',
      '지상국 자동화·원격운용',
    ],
    focus: '대형 안테나·추적 + 링크버짓 계산 + 주파수 국제조정. 평판형 위상배열로 소형화되는 흐름을 함께.',
    skills: ['링크버짓 설계', '안테나·추적', '전파 전파', 'RF 시스템', '주파수 조정'],
    topics: ['지상국(GES)', '추적 안테나', '링크버짓', '평판 위상배열', 'Ka/Ku 대역', 'ITU 등록'],
    entry: ['전파·통신공학 → 위성통신·안테나', '위성 지상국 운용사·연구기관 인턴', '무선통신사·전파 관련 자격'],
    orgs: ['KT SAT(금산 위성센터)', '한화시스템', 'ETRI', '국립전파연구원', 'Viasat·SES'],
    resources: [
      { label: 'Maral & Bousquet, Satellite Comm.', kind: '교재' },
      { label: 'ITU-R 전파규칙(RR)', kind: '표준' },
    ],
    future: '평판형 위상배열 지상국으로 소형화·다중위성 동시추적. LEO 군집 확산으로 지상 인프라 수요 증가.',
    outlook: { demand: '보통', difficulty: '중상', horizon: '중기' },
    trends: [],
  },

  // ── 04 전파 자원·관리·규제 ──────────────────────────────
  {
    key: 'specmgmt',
    name: '스펙트럼 관리',
    cat: 'spectrum',
    one: '유한한 주파수 자원의 할당·경매·공유 정책',
    doing: [
      '주파수 분배·재배치 계획 수립',
      '경매·이용대가·기술기준 산정',
      '대역 공유(비면허·DSS) 정책 설계',
      '국제 분배표·ITU 규칙과의 정합 검토',
    ],
    focus: '전파법·정책과 전파공학 기초를 겸비. 국내외 분배표와 ITU 규칙을 읽어 자원 배분을 설계하는 일.',
    skills: ['전파법·정책', '전파공학 기초', '경제·정책 분석', '국제 전파규칙', '기술기준'],
    topics: ['주파수 분배', '경매', '동적 스펙트럼 공유(DSS)', '비면허 대역', '재배치', '6G 후보대역'],
    entry: [
      '전파·통신공학 + 정책/행정 소양',
      '공무원(전파정책)·기관 연구직 경로',
      '전파연구원·정보통신정책연구원(KISDI) 인턴',
    ],
    orgs: ['과학기술정보통신부', '국립전파연구원', '중앙전파관리소', 'KISDI', 'ETRI'],
    resources: [
      { label: '전파법·주파수 분배표', kind: '표준' },
      { label: 'ITU-R 전파규칙(RR)', kind: '표준' },
      { label: 'KISDI 정책자료', kind: '커뮤니티' },
    ],
    future: '6G·위성 수요로 대역 재배치·공유가 화두. 동적 스펙트럼 공유(DSS)·AI 기반 자원관리로 진화.',
    outlook: { demand: '보통', difficulty: '중', horizon: '중기' },
    trends: [{ id: 'sm1', text: '6G 후보대역·위성 대역 분배 공청회 개최', source: '전파연구원', daysAgo: 5 }],
  },
  {
    key: 'monitor',
    name: '전파 감시 · 관리',
    cat: 'spectrum',
    one: '불법·간섭 전파를 찾아내 정리하는 전파질서의 파수꾼',
    doing: [
      '전파 측정·방향탐지(DF)로 발생원 추적',
      '혼신·불요파 단속과 조치',
      '전파환경 조사·측정망 운용',
      '드론·재밍 등 신종 위협 대응',
    ],
    focus: '측정·방향탐지 장비 운용과 전파 규정 숙지. 현장 조사·분석 역량이 실무의 중심.',
    skills: ['전파 측정·계측', '방향탐지(DF)', '전파법·규정', 'RF 시스템', '신호 분석'],
    topics: ['방향탐지', '혼신 분석', '측정망', '드론 대응', 'GPS 재밍', '불요파'],
    entry: ['전파·통신공학 → 계측·전파 실습', '전파관리 공무원·기관직', '무선설비/전파전자통신 자격'],
    orgs: ['중앙전파관리소', '국립전파연구원', '과기정통부', '군(전자전 부대)', 'ETRI'],
    resources: [
      { label: 'ITU-R 스펙트럼 모니터링 핸드북', kind: '표준' },
      { label: '스펙트럼 분석기·DF 장비', kind: '도구' },
    ],
    future: 'AI 기반 자동 혼신 탐지·드론 방해전파 대응 수요 증가. 측정망 자동화로 광역 감시.',
    outlook: { demand: '보통(안정)', difficulty: '중', horizon: '단기' },
    trends: [{ id: 'mon1', text: '드론 불법전파·GPS 재밍 대응 감시체계 강화', source: '전파연구원', daysAgo: 9 }],
  },
  {
    key: 'emc',
    name: 'EMC · 전자파 인체영향',
    cat: 'spectrum',
    one: '전자파 적합성(간섭 안 주고 안 받기)과 인체보호 기준',
    doing: [
      'EMC/EMI 시험(방사·전도)과 대책 설계',
      'SAR(전자파흡수율) 측정·평가',
      '차폐·접지·필터로 노이즈 저감',
      '전자파 안전 인증 대응',
    ],
    focus: '전자파 간섭 이론과 시험 규격(CISPR·MIL-STD). 차폐·접지·필터 설계 실무가 핵심.',
    skills: ['EMC 이론', '전자파 측정', '회로·PCB 설계', '시험규격(CISPR)', 'SAR 평가'],
    topics: ['EMI/EMC', 'SAR', '차폐·접지', 'CISPR/MIL-STD', '무선충전', '전장(EV) EMC'],
    entry: ['전자·전파공학 → 전자기학·회로', 'EMC 시험소·인증기관 실무', '무선설비기사 + 계측 경험'],
    orgs: ['KTL·KTC(시험인증)', '국립전파연구원', '현대차·삼성전자', 'ETRI', 'TÜV·UL'],
    resources: [
      { label: 'Paul, Introduction to EMC', kind: '교재' },
      { label: 'CISPR / KN 규격', kind: '표준' },
    ],
    future: '전기차·의료기기·무선충전 확산으로 EMC 수요 급증. 인체보호 기준 강화로 SAR 평가 중요성 상승.',
    outlook: { demand: '높음(안정)', difficulty: '중상', horizon: '단기' },
    trends: [],
  },
  {
    key: 'cert',
    name: '표준 · 시험 · 인증',
    cat: 'spectrum',
    one: '적합성 평가·기술기준으로 시장 진입을 여는 관문',
    doing: [
      '적합성평가(인증·등록) 실무',
      '기술기준·시험방법 제정·개정',
      '국제 상호인정(MRA)·해외 인증 대응',
      '신기술 인증체계 정비',
    ],
    focus: '기술기준·시험규격과 측정 능력, 그리고 규제·표준 문서를 정확히 해독하는 힘.',
    skills: ['기술기준·규격', '전파 측정·계측', '규제·법령 해독', '품질·프로세스', '영어 문서'],
    topics: ['적합성평가', '기술기준', 'MRA', '전파 인증(KC)', '시험방법', 'RED/FCC'],
    entry: ['전파·통신공학', '시험인증기관(전파연구원·KTL) 채용', '무선설비/정보통신 자격'],
    orgs: ['국립전파연구원(RRA)', 'KTL·KTC', '과기정통부', 'TTA', 'FCC·ETSI(해외)'],
    resources: [
      { label: '전파법·기술기준 고시', kind: '표준' },
      { label: 'ETSI/FCC 규격 DB', kind: '표준' },
    ],
    future: '6G·위성·저전력 신기술 인증체계 정비 수요. 국제 표준 정합성·상호인정 확대.',
    outlook: { demand: '보통(안정)', difficulty: '중', horizon: '중기' },
    trends: [],
  },

  // ── 05 방송·미디어 전송 ─────────────────────────────────
  {
    key: 'terrestrial',
    name: '지상파 · ATSC 3.0',
    cat: 'broadcast',
    one: 'IP 기반 차세대 방송(ATSC 3.0)으로 진화하는 지상파 전송',
    doing: [
      '방송 변조·다중화(OFDM) 시스템 설계',
      'ATSC 3.0/DVB 송신·중계 구축',
      '방송-통신 융합(재난경보·모바일) 서비스',
      '전송 품질·커버리지 최적화',
    ],
    focus: 'OFDM·채널코딩과 방송 표준(ATSC 3.0). 대규모 동시전송·재난경보 같은 방송 고유 응용이 강점.',
    skills: ['변조·전송(OFDM)', '채널코딩(LDPC)', '방송 표준', 'RF 송신', '네트워크'],
    topics: ['ATSC 3.0', 'OFDM', 'LDPC', '재난경보(EWS)', '모바일 방송', 'SFN(단일주파수망)'],
    entry: ['통신·방송공학 → 디지털통신·방송시스템', '방송사·송신소 기술직', '무선설비/방송통신기사'],
    orgs: ['KBS·MBC·SBS 기술', 'EBS', '한국방송기술인연합', 'ETRI', '디지캡·픽스트리'],
    resources: [
      { label: 'ATSC 3.0 표준(A/322 등)', kind: '표준' },
      { label: 'Proakis, Digital Communications', kind: '교재' },
    ],
    future: '방송망으로 대규모 동시전송(재난·자율차 지도). 방송-통신 융합으로 새 응용 영역 확장.',
    outlook: { demand: '보통', difficulty: '중', horizon: '중기' },
    trends: [{ id: 'tv1', text: 'ATSC 3.0 기반 재난경보·모바일 방송 실증', source: 'KICS', daysAgo: 13 }],
  },
  {
    key: 'stream',
    name: '대용량 스트리밍 전송',
    cat: 'broadcast',
    one: '실시간·대규모 미디어를 망 위로 안정 전송하는 기술',
    doing: [
      '적응형 스트리밍(ABR)·CDN 설계·운용',
      '저지연 라이브(LL-HLS·WebRTC) 전송',
      '코덱·트랜스코딩 파이프라인',
      'QoE(체감품질) 측정·최적화',
    ],
    focus: '전송 프로토콜(QUIC·WebRTC)과 코덱 이해. 지연·버퍼링을 줄이는 QoE 최적화가 실무 핵심.',
    skills: ['네트워크·프로토콜', '미디어 코덱', '스트리밍(HLS/DASH)', '서버·클라우드', 'QoE 분석'],
    topics: ['ABR', 'CDN', 'WebRTC', 'QUIC', 'LL-HLS', 'HEVC/AV1', 'QoE'],
    entry: ['컴퓨터·통신공학 → 네트워크·멀티미디어', 'OTT·미디어 플랫폼 SW 인턴', '백엔드·네트워크 프로젝트'],
    orgs: ['네이버·카카오', 'SOOP·치지직', 'CDN(클라우드플레어·라임라이트)', 'LG U+', '픽스트리'],
    resources: [
      { label: 'MDN WebRTC/Media 문서', kind: '커뮤니티' },
      { label: 'FFmpeg', kind: '도구' },
    ],
    future: '실시간 인터랙티브(클라우드 게임·XR) 저지연 전송이 관건. AI 코덱·초저지연 프로토콜 확산.',
    outlook: { demand: '높음', difficulty: '중', horizon: '단기' },
    trends: [],
  },

  // ── 06 표준·프로토콜 ────────────────────────────────────
  {
    key: 'std3gpp',
    name: '3GPP 셀룰러 표준',
    cat: 'standard',
    one: '4G/5G/6G 이동통신 규격을 만드는 국제 표준화의 심장',
    doing: [
      '규격서(TS) 작성·기술 기고(contribution)',
      '표준화 회의(RAN/SA WG) 참여·협상',
      '기술 제안·크로스체크·합의 도출',
      '표준특허(SEP) 발굴·선언',
    ],
    focus: '물리~코어 전 계층 규격 이해와 영어 문서화·협상력. 기고와 표준특허가 곧 기업 경쟁력.',
    skills: ['통신 시스템 전반', '3GPP 규격', '영어(문서·협상)', '신호처리', '특허'],
    topics: ['3GPP TS/TR', 'RAN1~4', 'SEP(표준특허)', 'Release', '기고(contribution)', 'IMT-2030'],
    entry: ['통신공학 대학원(무선통신) 사실상 필수', '표준화 담당 부서·연구소 배치', 'ETRI·삼성리서치 표준 팀 경로'],
    orgs: ['삼성전자·삼성리서치', 'LG전자', 'ETRI', 'Qualcomm·Ericsson·Huawei', 'TTA(국내 표준)'],
    resources: [
      { label: '3GPP 규격 포털(TS/TR)', kind: '표준' },
      { label: 'Sesia, LTE/5G — The UMTS Long Term Evolution', kind: '교재' },
      { label: 'TTA·KICS 표준 세미나', kind: '커뮤니티' },
    ],
    future: '6G(Rel-20+) 표준화 본격화. 표준특허(SEP) 라이선싱이 기업 수익·경쟁력의 핵심으로.',
    outlook: { demand: '높음', difficulty: '최상', horizon: '중기' },
    trends: [
      { id: 's3g1', text: '3GPP Rel-19 기능 동결, Rel-20(6G) 스터디 착수', source: '3GPP', daysAgo: 4 },
      { id: 's3g2', text: '표준특허(SEP) 라이선싱 분쟁 판례 주목', source: 'IEEE', daysAgo: 18 },
    ],
  },
  {
    key: 'itur',
    name: 'ITU-R · 국제 전파규칙',
    cat: 'standard',
    one: '전파·위성 궤도의 국제 배분과 규칙을 정하는 UN 기구',
    doing: [
      '국제 주파수 등록·궤도 조정',
      'WRC(세계전파통신회의) 의제 대응',
      '전파규칙(RR)·권고 해석·기고',
      '국가 간 주파수 협상',
    ],
    focus: '국제 전파규칙(RR)과 외교·조정 감각. 국가 이익을 건 주파수·궤도 협상이 무대.',
    skills: ['국제 전파규칙', '전파법·정책', '영어·외교', '전파공학', '협상'],
    topics: ['ITU-R', 'WRC', '전파규칙(RR)', '주파수 등록', '궤도 조정', '지역 조율'],
    entry: ['전파·통신공학 + 국제 정책', '전파연구원·과기정통부 국제협력', '국제기구 인턴(ITU)'],
    orgs: ['국립전파연구원', '과기정통부', 'ITU(제네바)', 'ETRI', 'APT(아·태전기통신협의체)'],
    resources: [
      { label: 'ITU-R 전파규칙(Radio Regulations)', kind: '표준' },
      { label: 'ITU-R 권고·핸드북', kind: '표준' },
    ],
    future: 'WRC-27 대역 배분 경쟁. 위성 궤도·주파수 선점 각축으로 국제 조정 인력 중요성 상승.',
    outlook: { demand: '낮음(전문)', difficulty: '상', horizon: '중기' },
    trends: [{ id: 'itu1', text: 'WRC-27 의제 대비 국내 대응반 구성', source: 'ITU-R', daysAgo: 16 }],
  },
  {
    key: 'wifi',
    name: 'Wi-Fi · IEEE 802',
    cat: 'standard',
    one: '무선랜(Wi-Fi 7/8)·근거리망 표준의 세계',
    doing: [
      'IEEE 802.11 규격 구현·인증',
      'MLO(멀티링크)·OFDMA·MU-MIMO 설계',
      '비면허 대역 공존·간섭 관리',
      'AP/칩셋 성능 최적화',
    ],
    focus: 'OFDMA·MU-MIMO와 802.11 규격. 비면허 대역 특유의 공존·혼잡 관리가 실무 포인트.',
    skills: ['무선랜 규격', '신호처리·DSP', 'MAC 프로토콜', 'RF 기초', '펌웨어'],
    topics: ['Wi-Fi 7(11be)', 'MLO', 'OFDMA', 'MU-MIMO', '6GHz', 'TWT(절전)'],
    entry: ['통신·전자공학 → 무선통신·네트워크', 'AP·칩셋 제조사 인턴', '오픈소스(Linux mac80211) 기여'],
    orgs: ['삼성전자', '넷기어·아이피타임', 'Broadcom·Qualcomm·MediaTek', 'ETRI', 'Wi-Fi Alliance'],
    resources: [
      { label: 'IEEE 802.11 표준', kind: '표준' },
      { label: 'Gast, 802.11 Wireless Networks', kind: '교재' },
    ],
    future: 'Wi-Fi 7 상용 확산, Wi-Fi 8(초신뢰·다중AP 협력) 표준화. 6GHz 비면허 확장으로 성능 도약.',
    outlook: { demand: '높음', difficulty: '중상', horizon: '단기' },
    trends: [{ id: 'wifi1', text: 'Wi-Fi 7(802.11be) 인증 제품 확산, MLO 상용화', source: 'IEEE', daysAgo: 12 }],
  },
  {
    key: 'shortrange',
    name: '근거리 · UWB · BLE',
    cat: 'standard',
    one: 'UWB 측위·블루투스 등 초근거리 무선의 영역',
    doing: [
      'UWB 정밀측위(ToF·AoA·TDoA) 설계',
      'BLE·근거리 프로토콜 스택 구현',
      '측위 정확도·전력 최적화',
      '디지털키·태그 응용 개발',
    ],
    focus: 'UWB 측위 원리와 저전력 프로토콜. cm급 정밀측위 응용을 구현하는 게 차별점.',
    skills: ['측위 이론', '저전력 설계', '임베디드·펌웨어', 'RF 기초', '프로토콜 스택'],
    topics: ['UWB(802.15.4z)', 'BLE', 'ToF/AoA', '디지털키(CCC)', '측위', '태그/앵커'],
    entry: ['전자·통신공학 → 임베디드·무선', '단말·자동차 전장 인턴', '측위 연구실 프로젝트'],
    orgs: ['삼성전자', '현대모비스', 'NXP·Qorvo', 'ETRI', '스타트업(측위)'],
    resources: [
      { label: 'IEEE 802.15.4z(UWB)', kind: '표준' },
      { label: 'Nordic/NXP SDK', kind: '도구' },
    ],
    future: 'UWB 디지털키·정밀측위 확산. 실내 위치기반 서비스·자산추적 시장 성장.',
    outlook: { demand: '보통(성장)', difficulty: '중', horizon: '단기' },
    trends: [],
  },

  // ── 07 특수·응용 통신 ────────────────────────────────────
  {
    key: 'military',
    name: '국방 · 전술통신 · 전자전',
    cat: 'special',
    one: '재밍 속에서도 살아남는 군용 통신과 전자전(EW)',
    doing: [
      '주파수도약·확산대역 통신 설계',
      '전자전(재밍·항재밍·ES/EA) 시스템 개발',
      '전술데이터링크·보안통신 구축',
      '위협 신호 분석·대응',
    ],
    focus: '확산대역·항재밍 기법 + 신호처리 + 보안. 방산·연구소 중심의 안정적 진로.',
    skills: ['확산대역·항재밍', '신호처리·DSP', '정보보안', 'RF 시스템', '전자전(EW)'],
    topics: ['주파수도약(FHSS)', '확산대역(DSSS)', '재밍/항재밍', '전술데이터링크', '인지 전자전', 'SIGINT'],
    entry: ['전자·통신공학 → 통신·신호처리 심화', '방산기업·ADD 연구직(병역특례 포함)', '군 통신·정보 특기 경로'],
    orgs: ['국방과학연구소(ADD)', '한화시스템', 'LIG넥스원', '삼성탈레스', 'ETRI'],
    resources: [
      { label: 'Sklar, Digital Communications', kind: '교재' },
      { label: 'Poisel, EW 관련 문헌', kind: '교재' },
    ],
    future: 'AI 인지전자전·드론 대응 수요 급증. 국방 통신망 현대화(전술 5G)로 지속 투자.',
    outlook: { demand: '높음(안정)', difficulty: '상', horizon: '단기' },
    trends: [{ id: 'mil1', text: '인지 전자전(Cognitive EW)·드론 대응 체계 투자 확대', source: 'IEEE', daysAgo: 17 }],
  },
  {
    key: 'radar',
    name: '레이더 · 항공/해상',
    cat: 'special',
    one: '전파로 표적을 탐지·추적하고 항공/해상을 잇는 통신',
    doing: [
      '레이더 파형·신호처리(CFAR·도플러·MTI) 설계',
      '항공/해상 무선통신·항법 시스템 운용',
      'ADS-B·AIS 등 감시시스템 구축',
      'MIMO·이미징 레이더 알고리즘',
    ],
    focus: '레이더 신호처리와 전파탐지·항법. 방산·항공·해양·자동차로 응용이 넓다.',
    skills: ['레이더 신호처리', '신호처리·DSP', '전자기·전파', '탐지·추정 이론', 'RF 시스템'],
    topics: ['CFAR', '도플러/MTI', 'MIMO 레이더', '4D 이미징 레이더', 'ADS-B/AIS', '항법(GNSS)'],
    entry: ['전자·통신공학 → 신호처리·레이더', '방산·자동차 레이더 인턴', '레이더 연구실 프로젝트'],
    orgs: ['LIG넥스원', '한화시스템', '현대모비스·비트센싱', 'ADD', 'ETRI'],
    resources: [
      { label: 'Richards, Radar Signal Processing', kind: '교재' },
      { label: 'MATLAB Radar Toolbox', kind: '도구' },
    ],
    future: '4D 이미징 레이더(자율주행)·MIMO 레이더 확산. 통신-레이더 융합(ISAC)으로 영역 확장.',
    outlook: { demand: '높음', difficulty: '상', horizon: '단기' },
    trends: [{ id: 'rad1', text: '자율주행용 4D 이미징 레이더 양산 경쟁 가열', source: 'IEEE', daysAgo: 8 }],
  },
  {
    key: 'iot',
    name: 'IoT 저전력 통신',
    cat: 'special',
    one: 'NB-IoT·LoRa 등 오래 가는 저전력 광역 무선(LPWAN)',
    doing: [
      'LPWAN(NB-IoT·LoRa·Sigfox) 통신 설계',
      '저전력 프로토콜·배터리 수명 최적화',
      '대규모 단말 연결(mMTC) 구조 설계',
      '센서망·게이트웨이 구축',
    ],
    focus: '저전력 설계 + 광역 커버리지 + 초대규모 접속. 센서망 응용과 배터리 수명이 실무 관건.',
    skills: ['저전력 설계', '네트워크·프로토콜', '임베디드', 'RF 기초', '클라우드(IoT 플랫폼)'],
    topics: ['NB-IoT', 'LoRa/LoRaWAN', 'mMTC', '앰비언트 IoT', '에너지 하베스팅', '위성 IoT'],
    entry: ['전자·통신·컴퓨터공학 → 임베디드·무선', 'IoT 스타트업·SI 인턴', '메이커/캡스톤 IoT 프로젝트'],
    orgs: ['삼성전자', 'SKT·KT·LG U+', '텔릿·리텍', 'ETRI', 'IoT 스타트업'],
    resources: [
      { label: 'LoRaWAN 규격(LoRa Alliance)', kind: '표준' },
      { label: '3GPP NB-IoT 규격', kind: '표준' },
    ],
    future: '앰비언트 IoT(배터리리스)·위성 IoT. 6G mMTC로 초대규모 연결, 산업·물류 응용 확대.',
    outlook: { demand: '보통', difficulty: '중', horizon: '단기' },
    trends: [{ id: 'iot1', text: '앰비언트 IoT(에너지 하베스팅) 3GPP 표준화 논의', source: '3GPP', daysAgo: 10 }],
  },
  {
    key: 'v2x',
    name: 'V2X 차량통신',
    cat: 'special',
    one: '차량이 서로·인프라와 대화하는 자율주행의 신경망',
    doing: [
      'C-V2X(PC5 사이드링크) 통신 설계',
      '저지연·고신뢰(URLLC) 전송 구현',
      '측위·센서융합·협력인지 연동',
      '차량·노변장치(RSU) 통합 시험',
    ],
    focus: '사이드링크(단말 직접통신)와 URLLC, 정밀측위. 자동차와 통신이 만나는 융합 영역.',
    skills: ['차량통신 규격', '신호처리·DSP', '네트워크·프로토콜', '측위', '기능안전'],
    topics: ['C-V2X(PC5)', 'URLLC', '사이드링크', '협력주행', 'RSU', '정밀측위'],
    entry: ['전자·통신·자동차공학 → 무선통신', '완성차·전장·통신사 V2X 인턴', 'V2X 연구실 프로젝트'],
    orgs: ['현대차·현대모비스', '삼성전자(하만)', 'SKT·KT', 'ETRI·한국자동차연구원', 'Qualcomm'],
    resources: [
      { label: '3GPP TS 23.287(V2X)', kind: '표준' },
      { label: 'Tse & Viswanath(무선 기초)', kind: '교재' },
    ],
    future: '자율주행 확산으로 C-V2X 표준 주류화. 협력주행·군집주행으로 응용 심화.',
    outlook: { demand: '높음(성장)', difficulty: '중상', horizon: '중기' },
    trends: [],
  },
  {
    key: 'quantum',
    name: '양자통신',
    cat: 'special',
    one: '양자역학으로 도청 불가능한 통신(QKD)·양자네트워크',
    doing: [
      'QKD(양자키분배) 시스템 구현·운용',
      '양자 중계·얽힘 분배 실험',
      '양자내성암호(PQC) 연동',
      '광통신·단일광자 검출 설계',
    ],
    focus: '양자광학 + 암호 + 광통신. 연구·국책과제 중심으로, 물리·수학 기반이 두터워야 한다.',
    skills: ['양자광학', '광통신', '정보보안·암호', '광학 실험', '신호처리'],
    topics: ['QKD', 'PQC', '양자중계', '얽힘 분배', '단일광자', '양자인터넷'],
    entry: ['물리·전자공학 대학원(양자정보)', '양자통신 국책 연구단 참여', 'ETRI·출연연 연구직'],
    orgs: ['ETRI', 'KIST', 'SKT·KT(양자)', 'KAIST 양자대학원', 'ID Quantique'],
    resources: [
      { label: 'Nielsen & Chuang, Quantum Computation', kind: '교재' },
      { label: 'ETRI 양자통신 백서', kind: '커뮤니티' },
    ],
    future: '양자인터넷 초기 단계. 국가 안보 통신·금융 보안 실증 확대로 연구 인력 수요 형성.',
    outlook: { demand: '낮음(연구)', difficulty: '최상', horizon: '장기' },
    trends: [{ id: 'q1', text: '국가 양자통신 시험망 구간 확대 구축', source: '전파연구원', daysAgo: 19 }],
  },

  // ── 08 물리계층·신호처리 ────────────────────────────────
  {
    key: 'dsp',
    name: '변조 · 채널코딩 · DSP',
    cat: 'phy',
    one: '비트를 전파에 싣는 물리계층의 수학 — 변조·코딩·검출',
    doing: [
      '변조/복조(QAM·OFDM) 설계',
      '채널코딩(LDPC·Polar·Turbo) 구현',
      '등화·동기·검출 알고리즘 개발',
      '링크레벨 시뮬레이션으로 성능 검증',
    ],
    focus: '신호처리 + 정보이론 + 확률통계. 모든 무선의 공통 기반이라 어디로 가든 밑천이 된다.',
    skills: ['신호처리·DSP', '정보이론', '확률·통계', '선형대수', '수치해석'],
    topics: ['QAM/OFDM', 'LDPC/Polar', '등화·동기', 'MIMO 검출', 'MMSE/ML', '채널모델'],
    entry: [
      '전자·통신공학 → 디지털통신·정보이론',
      '통신 연구실 → 링크 시뮬레이션(MATLAB/Python)',
      '모뎀·물리계층 부서 인턴',
    ],
    orgs: ['삼성전자(모뎀)', 'Qualcomm', 'MediaTek', 'ETRI', 'LG전자'],
    resources: [
      { label: 'Proakis, Digital Communications', kind: '교재' },
      { label: 'Tse & Viswanath, Fundamentals of Wireless', kind: '교재' },
      { label: 'MATLAB Comm. Toolbox', kind: '도구' },
    ],
    future: 'AI 기반 물리계층(수신기 학습). Polar/LDPC 이후 차세대 코드·검출로 연구 지속.',
    outlook: { demand: '높음', difficulty: '상', horizon: '단기' },
    trends: [{ id: 'dsp1', text: 'AI 기반 수신기(딥러닝 검출) 표준 후보 논의', source: '3GPP', daysAgo: 6 }],
  },
  {
    key: 'mlwireless',
    name: 'AI / ML for Wireless',
    cat: 'phy',
    one: '무선에 기계학습을 접목 — 채널예측·자원할당·수신기 학습',
    doing: [
      '채널 예측·CSI 압축(딥러닝) 모델 개발',
      '자원할당·스케줄링 강화학습 설계',
      '무선용 경량·엣지 모델 최적화',
      '데이터셋·시뮬레이터 구축',
    ],
    focus: 'ML과 무선 도메인 지식의 결합. 데이터셋·시뮬레이터·엣지 추론을 다루는 역량이 관건.',
    skills: ['AI·ML(딥러닝)', '신호처리·DSP', '선형대수·최적화', 'Python/PyTorch', '무선통신 이론'],
    topics: ['CSI 피드백', '채널 예측', '강화학습 스케줄링', 'AI-native PHY', '엣지 추론', '디지털 트윈'],
    entry: ['전자·통신·컴퓨터공학 → ML + 무선통신', '대학원(무선+ML) 연구', 'AI·모뎀 연구조직 인턴'],
    orgs: ['삼성리서치', 'Qualcomm AI', 'ETRI', 'Nokia Bell Labs', '네이버·카카오(AI)'],
    resources: [
      { label: 'Goodfellow, Deep Learning', kind: '교재' },
      { label: 'PyTorch / Sionna(무선 ML)', kind: '도구' },
      { label: 'IEEE 무선+ML 워크숍', kind: '커뮤니티' },
    ],
    future: '6G AI-native의 핵심. 물리계층까지 AI가 침투. 통신+AI 융합 인재 수요가 가장 빠르게 성장.',
    outlook: { demand: '매우 높음', difficulty: '상', horizon: '단기' },
    trends: [
      { id: 'ml1', text: 'AI/ML 에어인터페이스 3GPP 스터디 아이템 진행', source: '3GPP', daysAgo: 5 },
      { id: 'ml2', text: 'CSI 피드백 딥러닝 압축, 표준 성능평가 단계', source: 'IEEE', daysAgo: 14 },
    ],
  },
];

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

/** 분야 → 뉴스 검색어(동향 자동수집용) — 분야명 + 상위 토픽 2개 결합. serve.js가 Google 뉴스 RSS에 넘긴다.
    데이터에 별도 저장하지 않고 파생(SSOT는 name·topics). 필요하면 여기 규칙만 바꿔 전 분야 반영. */
export function newsQuery(f: AtlasField): string {
  const name = f.name.replace(/·/g, ' ').replace(/\s+/g, ' ').trim();
  const tops = f.topics.slice(0, 2).join(' ');
  return `${name} ${tops}`.trim();
}
