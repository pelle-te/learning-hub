/* ============================================================
   shell/tabs.ts — 탭 레지스트리(레거시 tabs.js의 registerTab 분산 등록 → 네이티브 단일 표).
   탭 추가 = 이 배열에 한 줄 + features/registry.tsx에 컴포넌트 등록. 나브/팔레트가 이걸 단일 원천으로 순회.
============================================================ */
/* ⚠ **표면(Surface)은 N-6 에서 해체됐다**(2026-07-26). 옛 구조: 학습/자료 두 표면을 상단
   스위처로 가르고 `navSurface` 를 영속하고 표면별 나브를 두 벌 빌드했다. 지운 이유:
   자료 6탭 중 **5탭이 콜드 게이트**(usePing)라 눌러 들어가면 절반이 "설정하세요"인데, 그것을
   숨기려고 **전 화면 상시 크롬 2버튼**을 유지하고 있었다 — 값보다 크롬이 컸다. 폰은 애초에
   이 표면을 안 만들었고(6탭 중 `reads` 하나만 데려갔다) 그 쪽이 더 잘 살고 있었다.
   "학습 중 딴짓 격리"라는 의도된 마찰이라는 반론은 **접힘 그룹 하나면 충분**하다는 것이 답이다.
   함께 사라진 것: `Surface`·`SURFACES`·`surfaceOf`·`surfaceHome`·`navSurface` 영속·스위처 24줄
   ·표면↔`[ ]` 링의 순환 불일치(레일에 없는 탭으로 새던 것 — 목록이 하나가 되며 자동 해소). */

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
   · `retired`     — **은퇴한 화면**(Q-22 · 2026-08-02). 나브·세그먼트·링·`g` 어디에도 안 나오지만
                     **⌘K 와 딥링크로는 여전히 간다.** 화면 코드는 살아 있다.

   ⚠⚠ `retired` 가 왜 필요했나: `graph` 를 내릴 때 그 항목을 **`TABS` 배열에서 통째로 뺐고**, 그
   순간 ⌘K 에서도 사라졌다(팔레트는 URL 이 아니라 이 배열을 읽는다). 그때 커밋은 _"딥링크·⌘K
   도달성 손실 0"_ 이라 적었지만 **절반만 참**이었다. 임시 처방으로 `palette.ts` 에 `act:graph`
   한 줄을 손으로 놓았고, 그 파일 주석이 스스로 _"TABS 에서 화면을 내릴 때마다 여기"_ 라고
   **재발을 예약**해 뒀다. 은퇴에 어휘를 주면 배열에서 뺄 이유가 사라진다 — 손 유지가 0이 된다.

   ⚠ 이 필드는 **선택이 아니라 필수**다. 기본값을 주면 새 탭이 자기도 모르게 한쪽에 들어가고,
   그 순간 다섯 열거가 다시 갈리기 시작한다. */
import type { IconName } from '@/lib/iconPaths';

/** `/items` 의 구조도 뷰를 여는 쿼리 값. **여기가 정본**이다 — 소비처가 `features/items/Items.tsx`
 *  (읽는 쪽)와 `shell/palette.ts`(가는 쪽) 둘이라, 문자열을 양쪽에 적으면 한쪽만 고쳐진다(P3). */
export const STRUCTURE_VIEW = 'structure';

/** `/subject/:id` 의 **시험 전날 한 장** 뷰를 여는 쿼리 값(T-18). 위와 같은 이유로 여기가 정본이다. */
export const SHEET_VIEW = 'sheet';

export type TabRole = 'destination' | 'lens' | 'retired';

export interface TabMeta {
  key: string;
  label: string;
  group: string;
  order: number;
  /** 도달 방식(위 주석) — 레일·`[ ]` 링·`g` 키의 단일 원천. */
  role: TabRole;
  /** ⚠ `IconName` 이다 — 이 표의 오타는 종전에 '아이콘 없는 탭'으로 조용히 렌더됐다(H22). */
  icon: IconName;
  /** 단일 화면 대시보드 탭(데모 v6 사상) — HudFrame을 가득 채우고 내부 스크롤 없음.
     App의 fillFrame 판정 단일 원천(옛 하드코딩 FILL_TABS 목록 대체, L-15). */
  fill?: boolean;
  /** SubTabs 세그먼트 버튼에 쓸 짧은 라벨(없으면 label). 나브·⌘K·문서 제목은 그대로 label을 쓴다. */
  segLabel?: string;
  /** `role:'retired'` 전용 착지 경로(Q-22). 은퇴한 화면은 `key` 가 경로가 아니다. */
  to?: string;
}

/** 모든 탭(표시 순서·그룹·아이콘). `role` 이 도달 방식을 정한다(destination=레일·링·g키 · lens=세그먼트·⌘K).
   `group` 이 레일 섹션이다: 계획(plan) · 숙련(train) · 수집(collect) · 발견(discover) · 설정(settings).
   빈도 위계: 매일(계획) > 주간(숙련·수집) > 드묾(발견·설정은 하단·⌘K 진입). N-6 이후 표면 구분은 없다 —
   그룹 헤더가 그 일을 하고 있었고, 그 위에 표면을 또 얹은 것이 중복이었다. */
export const TABS: TabMeta[] = [
  // ── 계획(plan) ──
  {
    key: 'today',
    label: '오늘 학습',
    group: 'plan',
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
    order: 12,
    role: 'destination',
    segLabel: '캘린더',
    icon: 'calendar',
    fill: true,
  },
  // 내 길(goals) — 축 A '내 길 지도'(P9 Phase 6). 전략 앵커(전파통신 연구원 자립 트리)라 오늘 다음, 계획 상단.
  { key: 'goals', label: '내 길', group: 'plan', order: 15, role: 'lens', segLabel: '내 길', icon: 'compass' },
  // 배분 세그먼트(주간 배분 보드) — 옛 배치 탭의 alloc 뷰를 승격(재개편 v4). 캘린더 바로 뒤.
  {
    key: 'alloc',
    label: '주간 배분',
    group: 'plan',
    order: 22,
    role: 'lens',
    segLabel: '배분',
    icon: 'calendar',
    fill: true,
  },
  // 졸업 계획 — 스케줄 세그먼트에서 독립 탭으로 승격(주간 운영과 학기 단위 계획은 리듬이 달라 나브에 직접 노출).
  { key: 'degree', label: '졸업 계획', group: 'plan', order: 35, role: 'lens', segLabel: '졸업', icon: 'cap' },
  // 과목(items) — 전공 과목·챕터 카탈로그 + 뼈대(가용시간·수업·일과) + 과목별 요일 배분(계획 재개편 v3).
  // 계획의 lens. 세그먼트 라벨='과목' — 계획은 [캘린더 · 배분 · 과목] 3세그먼트다(v4).
  // fill: 좌 갤러리 / 우 가용 레일이 화면을 꽉 채우는 프레임이라 여백 래퍼 없이 붙인다.
  {
    key: 'items',
    label: '과목',
    group: 'plan',
    order: 40,
    role: 'lens',
    segLabel: '과목',
    icon: 'file',
    fill: true,
  },
  // ── 숙련(train) — '내가 뭘 아는가·무엇을 익힐까' ──
  {
    key: 'journal',
    label: '학습 기록',
    group: 'train',
    order: 60,
    role: 'destination',
    icon: 'notebook',
    fill: true,
  },
  {
    key: 'review',
    label: '주간 리뷰',
    group: 'train',
    order: 70,
    role: 'lens',
    icon: 'refresh',
    fill: true,
  },
  /* I-9: 복습 세션 러너 — 오늘 인출할 것(밀린 챕터·회상·착각 재확인)을 한 흐름으로 굴리는 doing surface.

     ⚠⚠ **W17 — 인출 축의 얼굴을 여기로 뒤집었다(2026-07-31 · `lens` → `destination`).**
     E13 이 `forecast` 를 호스트로 올린 근거("Anki 만 자기 목적지가 0")는 *축에 목적지가 필요하다*
     까지만 말하고 *어느 화면이 그 얼굴인가*는 말하지 않았다. 그리고 아래 `forecast` 주석이
     스스로 적었듯 **예보는 Anki 미래 due 를 원리적으로 못 그린다** — 반쪽이 축의 얼굴이었다.

     폰은 슬롯 5개라 **고르지 않을 수 없었고**(`PhoneApp.tsx`), 그 강제 선택이 둘을 말한다:
     ① 인출 축의 최상위는 *보는 화면*이 아니라 **하는 화면**이다(폰은 `복습 = 러너`)
     ② 기록·분석은 최상위가 아니다(journal·stats 를 통째로 버렸다).
     반면 `review-run` 은 회상·착각·밀린 챕터를 **한 큐**로 굴리고 폰과 **같은 lib**(`reviewQueue`)를
     쓴다 — 두 기기가 같은 규칙을 보는 유일한 화면이다.

     ⚠ 반대 근거를 지운 게 아니라 저울에 올렸다: 폰은 "지하철 5분"이라는 다른 전제 위에 있고,
     데스크톱 앞에 앉는 순간은 *무엇을 할지 정하는* 순간일 수 있다 → 예보는 **첫 세그먼트로
     바로 옆에** 남는다(한 번의 클릭 · 도달성 손실 0). */
  {
    key: 'review-run',
    label: '복습',
    group: 'train',
    order: 72,
    role: 'destination',
    segLabel: '복습 실행',
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
    order: 74,
    role: 'lens',
    icon: 'notebook',
    fill: true,
  },
  /* T-7 문항 원장 + T-2 시험 회수 창(2026-08-02). 오답 노트 **옆**이지 안이 아니다:
     `cbms` 는 틀린 *사건*(코드·메모)이고 여기는 다시 풀 수 있는 *대상*이다 — 시험 2주 전에
     열리는 것은 후자라 수명이 다르다(섞으면 오답 노트가 문제은행이 되고 시제가 흐려진다). */
  {
    key: 'questions',
    label: '문항',
    group: 'train',
    order: 76,
    role: 'lens',
    icon: 'notebook',
    fill: true,
  },
  {
    key: 'stats',
    label: '통계',
    group: 'train',
    order: 80,
    role: 'destination',
    icon: 'chart',
    fill: true,
  },
  // 복습 부하 예보(ID-1) — 앞 14일 다가오는 복습 파도를 조망. 통계 호스트의 세그먼트로 접는다
  // (분석 대시보드 묶음). lens · 라우트·⌘K·g단축키·세그먼트로 진입 · fill(단일 화면).
  /* ⚠ **E13 — 인출 축의 호스트로 승격했다(2026-07-29 · `lens` → `destination`).**
     제품 앵커가 이름을 명시한 세 소스(볼트·Anki·일과) 중 **Anki 만 자기 목적지가 0**이었고,
     "오늘 무엇을 다시 꺼내야 하나"의 조각이 3호스트에 흩어져 있었다(`review-run`·`mistakes`
     =기록 / 여기=통계 / Anki 덱=연동). `totalDue()` 는 5곳에서 각자 계산됐다.
     이 탭은 **볼트 due 와 Anki due 를 한 화면에 쥔 유일한 화면**이라 그 축의 얼굴이 될 수 있다.
     폰이 슬롯 5개 제약에서 `복습` 을 최상위로 뽑은 것도 같은 방향의 증거다.
     ⚠ 관측을 기다릴 수 없는 항목이다 — "없는 목적지"의 방문 수는 `route_visits` 에 영원히 0으로
     찍힌다(존재하지 않는 것에 대한 수요는 원장에 안 남는다).
     ⚠ 예보는 볼트 챕터만 그리고 **Anki 미래 due 는 원리적으로 못 그린다** → 호스트 상단은
     "오늘 due" 를 말하고 14일 막대는 그 아래다(반쪽 예보가 축의 얼굴이 되지 않게).
     ⚠⚠ **W17 이 그 마지막 문장을 끝까지 밀었다(2026-07-31 · `destination` → `lens`).** 반쪽이
     축의 얼굴이 될 수 없다면 얼굴은 *하는 화면*이어야 한다 — 위 `review-run` 주석이 근거를 든다.
     여기는 그 호스트의 **첫 세그먼트**로 남는다(도달성 손실 0 · 라우트·⌘K 그대로). */
  {
    key: 'forecast',
    label: '복습 예보',
    group: 'train',
    order: 75,
    role: 'lens',
    segLabel: '예보',
    icon: 'chart',
    fill: true,
  },
  {
    key: 'mastery',
    label: '숙달도 지도',
    group: 'train',
    order: 85,
    role: 'lens',
    icon: 'grid',
    fill: true,
  },
  /* ⚠⚠ **`graph`(학습 구조도) 탭이 은퇴했다 — 화면은 살아 있다**(P-19 · 2026-08-01 · 사용자 결정).
     `/items?view=structure` 의 **뷰 전환**으로 내려갔다(`features/items/Items.tsx` 가 lazy 로 띄운다).
     옛 `/graph` 는 App 의 리다이렉트가 그 URL 로 넘긴다 — 딥링크·⌘K 도달성 손실 0.

     근거는 **같은 로컬 데이터의 두 시각화가 서로 다른 질문의 자리에 앉아 있었다**는 것이다:
     `plan›과목` 은 항목→챕터를 목록으로, `train›구조` 는 같은 것을 힘-방향 그래프로 그렸다.
     ⚠ E10 이 두 화면을 남긴 판정(_"인접해 보인다고 같은 질문이 아니다"_)은 **뒤집히지 않았다.**
       그 판정이 가른 짝은 `graph` 대 `mastery`(볼트 산출 개념 히트맵 · 콜드 게이트)였고 그 둘은
       여전히 다른 호스트다. 여기서 합친 짝은 `graph` 대 `items` 이고, 이건 같은 데이터다.
     ⚠ 파일은 안 합쳤다 — 로드맵이 지적한 교환("탭 하나 줄이려고 4000줄 파일 하나")을 피하려고
       호스트만 바꿨다. `Graph.tsx` 는 그 자리에 그대로 있다.
     ⚠⚠ **위 "⌘K 도달성 손실 0" 은 절반만 참이었다**(P3 · 2026-08-01 정정). 리다이렉트가 덮는
       것은 *딥링크*뿐이고, 팔레트는 URL 이 아니라 **이 배열**을 읽는다(`palette.baseCommands` 가
       `orderedTabs()` 만 순회) → 탭을 빼는 순간 ⌘K 에서도 사라졌다.
     ✅ **Q-22(2026-08-02)가 그 재발 예약을 닫았다** — 종전엔 `shell/palette.ts` 에 `act:graph` 한
       줄을 **손으로** 놓아 메웠고, 그 파일 주석이 스스로 _"TABS 에서 화면을 내릴 때마다 여기"_ 라
       적어 뒀다. 이제 은퇴에 어휘가 있다(`role:'retired'`): 배열에 **남아 있으므로** ⌘K 가 자동으로
       줍고, 나브·세그먼트·링·`g` 어디에도 안 나온다. 손 유지가 0이 됐다.
     ⚠ 그 쿼리 값의 정본은 이 파일 위쪽의 `STRUCTURE_VIEW` 다. */
  {
    key: 'graph',
    label: '학습 구조도',
    group: 'train',
    order: 86,
    role: 'retired',
    icon: 'graph',
    /** ⚠ `retired` 만 갖는 필드 — 은퇴한 화면이 **실제로 어디로 가는가**. `key` 로 경로를 만들 수
     *  없기 때문이다(옛 `/graph` 는 리다이렉트일 뿐 착지점이 아니다). */
    to: `/items?view=${STRUCTURE_VIEW}`,
  },
  /* ── 읽을거리 ─────────────────────────────────────────────────────────────
     ⚠⚠ **'수집(collect)' 그룹이 P-4 에서 해체됐다(2026-08-01).** 그 이름은 사용자의 질문이
     아니라 **출처 분류**였다 — 옛 주석이 문자 그대로 자백했다("밖에서 들여오는 것 전부").
     그래서 `reads` 로 들어가면 세그먼트 바에 `markets`·`atlas`·`discovery` 가 늘 함께 떴고,
     그중 앞의 둘은 **학습 상태 소비 0**(자기 탭 주석이 자인) · 뒤 하나는 콜드 게이트다.
     즉 **읽으려는 순간에 딴짓 셋이 제시됐다.** 지금 `reads` 는 세그먼트 그룹이 자기 하나뿐이라
     `SubTabs` 가 바를 통째로 안 그린다(`segs.length < 2`). */
  {
    key: 'reads',
    label: '읽을거리',
    group: 'train',
    order: 45,
    role: 'destination',
    icon: 'reads',
  },
  {
    /* ⚠ **H24 — 상시 레일에서 내렸다(2026-07-29 · `destination` → `lens`).**
       제품 앵커는 "볼트·Anki·일과를 한눈에 보는 **로컬 학습 대시보드**"인데 이 탭은 학습 상태
       소비가 **0**이다(로드맵·설계 어디에도 존재 근거가 없고 등장은 전부 버그 수정 항목).
       그런데 레일 한 칸을 상시로 쓰면서 508줄 + 뉴스 RSS Rust 커맨드 + 파이썬 수집기를 문다.
       ⚠ **지우지 않는다.** ⌘K·`g` 단축키·딥링크(`/markets`)는 그대로다 — 도달성은 유지하고
       "매일 보이는 자리"만 회수한다. 그래야 `route_visits` 로 **레일을 지웠을 때 ⌘K 방문이
       남는가**를 물을 수 있다(`visits.ts` 머리주석이 이 탭을 1순위 후보로 지목한 그 질문).
       재판정: 관측 2주 뒤. 되돌리기는 이 두 글자다.

       ⚠⚠ **판정 규칙을 결과보다 먼저 적는다(P-4 사전등록 · 2026-08-01).**

         ⚠⚠⚠ **2026-08-01 정정 — 날짜가 아니라 표본에 건다(사용자 승인).** 아래 규칙의 원래
         형태는 *"2026-08-12 에 합계 ≥3 이면 유지"* 였는데, 그날 실제로 무슨 일이 벌어지는지를
         실측하니 **표본 0을 근거로 탭을 지운다**였다: 실 DB 의 `route_visits` 는 **2행 · 키 1개 ·
         날짜 1일**이다(2026-08-01 · `%APPDATA%/dev.jin.learninghub/learning-hub.db`). 즉 그날 그
         합계는 0 이 되고, **그 0 은 "안 쓴다"가 아니라 "안 쟀다"를 뜻한다**(앱이 두 번 열렸을 뿐).
         `visits.ts` 머리주석이 스스로 경고한 순환(*"자명한 0 을 근거로 쓰면 그건 관측이 아니라
         순환"*)이 그 규칙 자신에게 발동한 것이다 — `rail`·`seg` 를 제외한 정교함이 **분자**를
         지켰지만 **분모가 존재하지 않는다**는 것은 아무도 안 봤다.
         이 저장소는 같은 형태에 두 번 물렸다(스냅샷·a11y): **녹색이 "회귀 없음"이 아니라
         "안 쟀음"을 뜻하는** 상태. 판정 규칙에도 같은 방어가 필요하다.

         **판정 순서(먼저 분모, 그다음 분자):**
         ① **표본 게이트** — `관측일 ≥ 10 && 총방문(전 출처 합) ≥ 30` 을 **못 넘기면 판정하지
            않는다.** 결론은 *"판정 불가 — 표본 부족"* 이고, 그때 할 일은 삭제가 아니라 **관측을
            더 하는 것**이다(그리고 그 사실을 여기 적어 다음 판정일을 새로 잡는다).
         ② 게이트를 넘겼을 때만: `palette` + `key` + `link`(딥링크)
         합계가 **3 이상이면 유지, 미만이면 삭제**한다.
         · **`rail` 은 계산에서 제외** — 강등으로 레일에서 내렸으니 0 이 자명하고, 자명한 0 을
           근거로 쓰면 그건 관측이 아니라 순환이다.
         · **`seg` 도 제외** — 아래 시스템 호스트에 얹혀 있어 지나가다 눌릴 수 있고, 그건
           "찾아왔다"가 아니다. 이 탭에 대해 물어야 하는 것은 **이름을 알고 찾아왔는가**다.
         · 임계 3 의 근거: 2주 관측에서 "우연히 한 번"과 "쓴다"를 가르는 최소치. 큰 수를 쓰면
           저사용을 가치 부재로 읽는 함정에 더 깊이 들어간다(`visits.ts` 머리주석의 경고).
         ⚠ **이 탭의 강등 근거는 사용률이 아니라 목적 불일치였다** — 방문 수가 얼마가 나오든
           그 판단은 안 뒤집힌다. 위 규칙은 *삭제까지 갈 것인가*만 정한다.
         판정 입력은 이미 화면에 있다(`Settings` 의 방문 원장이 `visitSummary()` 를 읽는다). */
    key: 'markets',
    label: '증시 동향',
    group: 'discover',
    order: 47,
    role: 'lens',
    icon: 'trend',
  },
  /* E17-IA 콜드 강등 — 이 탭은 학습 상태 소비가 0이고(시드+RSS만 본다) 워크스페이스가 없으면
     본문이 안내문이다. H24(`markets`)와 **같은 논증**이라 같은 처분을 한다: 지우지 않고
     "매일 보이는 자리"만 회수한다(⌘K·`g`·딥링크 그대로). */
  {
    key: 'atlas',
    label: '진로 지도',
    group: 'discover',
    order: 48,
    role: 'lens',
    icon: 'radio',
  },
  // ── 발견(discover) — surface·triage·연동 ──
  // 발견 큐(discovery) — 축 C '발견 루프'(P9 Phase 6 Wave④). 수집·surface·다리개념 후보를 사람이 승격/기각(D5).
  {
    key: 'discovery',
    label: '발견',
    group: 'discover',
    order: 49,
    role: 'lens',
    icon: 'discovery',
  },
  /* 배관 상태는 **매일 볼 것이 아니다**. 게다가 이 탭은 콜드 게이트의 호스트라, 상시 목적지로
     두면 레일에서 눌러 들어간 절반이 "설정하세요"가 된다(N-6 이 표면을 해체한 그 근거). */
  {
    key: 'integrations',
    label: '연동 현황',
    group: 'settings',
    order: 50,
    role: 'lens',
    icon: 'link',
    fill: true,
  },
  // 정본 원장 — 과목×챕터 5단계 파이프라인 진척(통합 4단계 소비). 연동 현황 호스트의 세그먼트로 접는다
  // (자료 생산·연결 상태 묶음). lens · 라우트·⌘K·g단축키·세그먼트로 진입 · fill(단일 화면).
  /* '어디까지 아는가'는 배관이 아니라 **앎**의 질문이다 → 통계 호스트로 옮긴다(옛 자리는
     연동 호스트였는데, 그 호스트가 렌즈로 내려가며 호스트 자격도 함께 사라졌다). */
  {
    key: 'ledger',
    label: '정본 원장',
    group: 'train',
    order: 88,
    role: 'lens',
    icon: 'grid',
    fill: true,
  },
  // ── 설정(settings) — 레일 하단(스페이서 아래) ──
  // 안내(guide) — 이 시스템이 할 수 있는 것 + 하는 법 매뉴얼(전역 참조). 스크롤 페이지라 fill 없음.
  /* ⚠ **참조물은 "가는 곳"이 아니다.** 347줄 정적 매뉴얼이 레일 상시 1칸을 쓰고 있었다.
     ⚠ 여기서 **은퇴시키지 않는다** — 내용 분해(치트시트 '이 화면' 절 · 콜드 안내문 · 설정 도구
     목록)는 비가역이라 흡수가 끝난 뒤여야 한다. 지금 회수하는 것은 자리뿐이다. */
  /* ⚠⚠ **W7(2026-08-02) — 은퇴를 시도했다가 되돌렸다. 불변식이 옳았다.**
     `role:'retired'` 로 바꿔 봤더니 불변식 ②가 즉시 잡았다: _"은퇴한 탭은 **착지 경로(to)** 를
     갖는다 — 가리킬 곳 없는 은퇴는 그냥 삭제다"_. `to: '/guide'` 는 자기 자신이라 그 계약을
     만족하지 않는다(은퇴의 뜻은 *다른 곳에 흡수됐다* 이지 *나브에서만 숨긴다* 가 아니다).
     흡수는 **둘 중 둘이 생겼지만 셋 중 둘**이다: 찾기 → `/find`(T-25) · 화면별 키 → `KeycapBar`
     (T-22). 남은 하나가 _"이 시스템이 할 수 있는 것"_ 본문이고, 그건 갈 곳이 아직 없다.
     ⚠ 위 옛 주석이 건 조건(_"내용 분해는 비가역이라 흡수가 끝난 뒤"_)이 정확히 이걸 막고 있었고,
       불변식이 그 조건을 코드로 집행했다. **본문의 착지처가 생기기 전에는 은퇴시키지 말 것.** */
  { key: 'guide', label: '안내', group: 'settings', order: 185, role: 'lens', icon: 'book' },
  /* T-25 검색 화면 — `guide` 은퇴의 짝. 이 앱에서 찾는 것은 **탭 이름이 아니라 내용**이고,
     그 답을 아는 곳(⌘K)은 떠 있는 동안만 존재해 훑어보기가 안 됐다(그 파일 머리주석). */
  { key: 'find', label: '찾기', group: 'settings', order: 186, role: 'lens', icon: 'search' },
  // 제어판은 나브에 노출(설정 그룹). 탐구 수집·지식 재빌드 등 운영 도구 진입점.
  {
    key: 'control',
    label: '탐구 수집',
    group: 'settings',
    order: 190,
    role: 'lens',
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
  // 순서 = 화면 착지 순서: 캘린더(언제 할까) → 배분(무엇을 얼마씩) → 과목(무엇을·뼈대) → 멀리(N-14).
  ['schedule', 'alloc', 'items', 'goals', 'degree'],
  /* 기록 호스트 — 시제가 **과거**인 것만 남았다(E13). 적기(journal) → 이번 주 처방(review).
     옛 목록은 여기에 `review-run`·`mistakes` 까지 넣어 네 개였는데, 그 둘은 *다시 꺼내는 일*이라
     시제가 다르다. 그래서 "복습하려면 기록 탭으로 간다"는 설명 불가능한 동선이 있었다. */
  ['journal', 'review'],
  /* ⚠ **인출 호스트 — E13 신설(2026-07-29) · W17 이 얼굴을 뒤집었다(2026-07-31).**
     복습 실행(지금 굴리기 · 호스트) → 예보(앞으로 무엇이 밀리나) → 오답 노트(전 기간 아카이브).
     순서가 곧 판단이다: 이 축의 최상위는 **하는 화면**이고 보는 화면은 그 옆이다(근거는
     `review-run` 의 탭 메타 주석). 새 화면 0 · 라우트·⌘K 그대로(도달성 손실 0). */
  ['review-run', 'forecast', 'mistakes', 'questions'],
  /* 앎 호스트 — 통계(얼마나 했나) → 숙달도 → 지식맵 → 정본 원장(어디까지 아는가).
     `ledger` 가 배관(연동) 밑에서 여기로 왔다. */
  ['stats', 'mastery', 'ledger'],
  /* ⚠⚠ **읽을거리는 혼자다(P-4 · 2026-08-01).** 옛 '수집 호스트'는 `reads` 밑에
     `markets`·`atlas`·`discovery` 를 달고 있었는데, 그 묶음의 기준은 사용자의 질문이 아니라
     **출처 분류**("밖에서 들여온 것")였다. 결과는 **읽으려는 순간에 딴짓 셋**이었다.
     원소가 하나면 `SubTabs` 가 바를 통째로 안 그린다(`segs.length < 2`) — 그래서 여기 남는
     한 줄이 곧 "바가 없다"는 뜻이다. 지우지 말 것(지우면 `hostTabKey` 가 달라진다). */
  ['reads'],
  /* 시스템 호스트 — 설정(호스트) + 배관·도구·매뉴얼. 매일 볼 것이 아닌 것들의 집이다.
     ⚠ `integrations` 는 **호스트에서 렌즈로 내려왔다** — 그러면서 자기 밑에 있던 `ledger` 의
     호스트 자격도 사라졌으므로 그 탭을 앎 호스트로 옮겼다(불변식 ③-b: 호스트는 destination).
     ⚠⚠ **`discovery` 가 P-4 에서 여기로 왔다(2026-08-01).** 이 탭은 **운영 큐**다(후보를
       승격/기각한다) — `control` 과 같은 파이프라인의 앞뒤라 여기가 제 집이다.

     ⚠⚠⚠ **`atlas`·`markets` 는 2026-08-01 `/감사 근본`(P5+P6 · 사용자 승인)에 내려갔다.**
       그 둘이 여기 있던 이유는 IA 판단이 아니라 **불변식이 밀어붙인 것**이었다: 옛 ③-b 가
       _"lens 는 반드시 어느 세그먼트 그룹에 속한다"_ 라 "그룹 없이 둘 수 없다"가 됐고, 위
       주석이 스스로 그 자리를 *"잠정 거처"* 라 자인하고 있었다. 그 압력의 대가가 **설정
       세그먼트 7개 — 앱 최장**이었고, 그중 학습 상태 소비 0 이 셋이었다.
       ③-b 가 *"라우트·⌘K·세그먼트 중 최소 하나"* 로 완화되면서 그 강제가 사라졌다.
       ⚠ **도달성 손실은 0 이다** — `/atlas`·`/markets` 딥링크 · ⌘K · `g` 단축키 전부 그대로이고,
         완화된 불변식이 그 셋을 *실제로 세어* 잠근다(`test/invariants.test.ts` ③-b).
       ⚠ 남은 것은 여전히 IA 판단이다: `atlas` 의 목적지로 로드맵이 적은 `path` 는 **존재하지
         않고 신설은 사용자 결정 대기**다. 달라진 것은 그 결정이 날 때까지 **매일 보이는 바에
         세워 두지 않아도 된다**는 것뿐이다. */
  ['settings', 'integrations', 'control', 'discovery', 'find', 'guide'],
];
/* ── 나브 그룹(라벨+그룹 사이드바) ────────────────────────────────────────
   TabMeta.group(plan/train/collect/discover/settings) → 사이드바 섹션 헤더 라벨. 빈도 위계를 시각적 청킹으로.
   settings 그룹은 하단(스페이서 아래)에 렌더 — 저빈도 운영/설정(두 표면 공통). */
/* ⚠ **`collect: '수집'` 이 P-4 에서 사라졌다(2026-08-01).** 그 섹션의 유일한 destination 이
   `reads` 하나였고(나머지 셋은 lens 라 레일에 애초에 안 선다), 즉 헤더 하나가 항목 하나를
   덮고 있었다. `reads` 는 '숙련'으로 갔다 — 읽는 것도 학습 입력이고, 그 섹션이 이미 기록·
   복습·통계를 갖는다. ⚠ 옛 `discover: '발견'` 은 **어느 탭도 안 쓰던 고아 라벨**이었는데
   이제 `markets`·`atlas`·`discovery` 가 그 이름을 쓴다(라벨은 lens 라 렌더되지 않지만,
   불변식 ③이 "모든 탭 group 은 라벨을 갖는다"를 요구하므로 뜻이 맞는 이름을 준다). */
export const GROUP_LABELS: Record<string, string> = {
  plan: '계획',
  train: '숙련',
  discover: '발견',
  settings: '설정',
};

export interface NavGroup {
  key: string;
  label: string;
  tabs: TabMeta[];
}

/** 상시 노출되는 도달점(내부) — `role==='destination'` 전부. 그룹 묶기의 입력이다. */
function destinationTabs(): TabMeta[] {
  return ORDERED_TABS.filter((t) => t.role === 'destination');
}

/** 도달점을 그룹으로 묶는다. 설정 그룹은 레일 하단(스페이서 아래).
 *  TABS 가 불변이라 모듈 로드 시 1회 계산해 재사용한다(C-8 · 매 렌더 재빌드 금지).
 *
 *  ⚠ **그룹 순서는 `GROUP_LABELS` 의 선언 순서다**(빈도 위계: 계획 > 숙련 > 수집 > 발견 > 설정).
 *  탭 `order` 의 첫 등장으로 정하면 안 된다 — `reads`(45)·`markets`(47) 가 `journal`(60) 보다
 *  작아서 **수집·발견이 숙련 위로 올라간다**. 표면이 있던 시절엔 두 그룹이 아예 다른 화면에
 *  있어 이 어긋남이 보이지 않았고, N-6 이 합치는 순간 드러났다(실렌더 확인이 잡았다).
 *  탭 `order` 는 **그룹 안에서의** 순서만 정한다. */
function buildNavGroups(): NavGroup[] {
  const byGroup = new Map<string, TabMeta[]>();
  for (const t of destinationTabs()) {
    const g = byGroup.get(t.group);
    if (g) g.push(t);
    else byGroup.set(t.group, [t]);
  }
  const groups: NavGroup[] = [];
  for (const key of Object.keys(GROUP_LABELS)) {
    const tabs = byGroup.get(key);
    if (tabs?.length) groups.push({ key, label: GROUP_LABELS[key] ?? key, tabs });
  }
  // 라벨 표에 없는 그룹(신설 직후)도 잃지 않는다 — 불변식 테스트가 라벨 누락을 따로 잡는다.
  for (const [key, tabs] of byGroup) if (!groups.some((g) => g.key === key)) groups.push({ key, label: key, tabs });
  return groups;
}
const NAV_GROUPS: NavGroup[] = buildNavGroups();
export function navGroups(): NavGroup[] {
  return NAV_GROUPS;
}

/** `[ ]` 링이 도는 목록 — **레일에 보이는 순서 그대로**(그룹 순 → 그룹 안 order 순).
 *
 *  ⚠ 레일 순서에서 **파생**시키는 것이 핵심이다. 한때 이 함수가 `ORDERED_TABS` 를 직접 필터해
 *  두 목록의 *멤버십*은 같은데 *순서*가 달랐다(그룹 순서를 빈도 위계로 고정한 순간 갈렸다).
 *  그러면 `]` 를 눌렀을 때 레일에서 아래가 아닌 엉뚱한 칸으로 튄다 — 눈에 보이는 순서와 손이
 *  기대하는 순서가 어긋나는, 설명 없이는 못 알아채는 부류다. 이제 두 벌이 될 수 없다.
 *  (`test/invariants.test.ts` 가 같은 목록임을 계속 잠근다 — 이 파생이 뒤집히면 즉시 빨개진다.) */
const DESTINATIONS: TabMeta[] = NAV_GROUPS.flatMap((g) => g.tabs);
export function destinations(): TabMeta[] {
  return DESTINATIONS;
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

/* ⚠⚠ **탭이 아닌 라우트에도 이름이 있다(H27 · 2026-07-31 `/감사 근본`).**

   `App` 과 `docTitle` 은 라벨을 `tabByKey(첫 세그먼트)` 로 뽑는데, W12 가 신설한 `/subject/:id`
   와 미니 모드 `/mini` 는 **탭이 아니다** → `undefined` → 라우트 아나운서가 **무음**이고 문서
   제목이 `러닝허브` 로 고정된다. `/subject/:id` 는 ⌘K 챕터 히트의 **착지 화면**이라 실제 통행량이
   있는 경로다(W12 가 만든 값이 그 길로 흐른다).

   ⚠ 이걸 `TABS` 에 넣어 풀지 않는다 — 그러면 레일·`[ ]` 링·`g` 키·`primary` 불변식이 전부
   따라와서, "탭이 아닌 것"을 탭으로 만들어 IA 를 오염시킨다. 이름만 필요한 자리에는 이름만 준다. */
const ROUTE_LABELS: Record<string, string> = {
  subject: '과목',
  mini: '집중',
};

/** 라우트 첫 세그먼트 → 사람이 읽는 이름. 탭이면 탭 라벨, 아니면 위 표, 없으면 빈 문자열. */
export function routeLabelOf(key: string): string {
  return TAB_BY_KEY.get(key)?.label ?? ROUTE_LABELS[key] ?? '';
}
