// Flat config (ESLint 9). FSD식 단방향 의존을 강제한다:
//   app → features → components → {hooks, store} → lib   (역방향 import 금지)
//   hooks = React 훅 레이어(lib만 import). app/features/components가 소비.
// eslint-plugin-boundaries가 src/ 하위 폴더를 '레이어'로 보고 위반을 error로 잡는다.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import sonarjs from 'eslint-plugin-sonarjs';
import betterTailwind from 'eslint-plugin-better-tailwindcss';

export default tseslint.config(
  // e2e(Playwright)는 별도 러너·tsconfig 밖 → 앱 lint에서 제외(Playwright가 자체 처리).
  {
    ignores: [
      'dist',
      'dev-dist',
      'node_modules',
      'e2e/**',
      'playwright.config.ts',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // React Hooks 규칙(rules-of-hooks·exhaustive-deps) + react-compiler 규칙.
  // 컴파일러는 Rules of React를 지킨 컴포넌트만 메모이즈하므로(위반 시 조용히 bail),
  // 이 린트가 위반을 빌드 전에 잡아 자동최적화 적용률을 보장한다(Phase 7 컴파일러 채택 완성).
  reactHooks.configs.flat['recommended-latest'],
  /* 접근성 회귀 방어(2026-07-19 플랫폼 감사 ⑥) — aria-* 406회·role= 132회를 전부 수작업으로
     관리하면서 자동 검증이 0이었다. SPA 접근성의 어려운 부분(라우트 아나운서·문서 제목 동기화·
     포커스 복원)은 이미 손으로 제대로 해놨는데, 정작 값싼 린트가 빠져 있어 신규 코드의 퇴행을
     못 잡았다. jsx-a11y 는 aria 속성명 오타·role 대비 필수 속성 누락·상호작용 요소의 키보드
     핸들러 부재 같은 '기계가 잡을 수 있는 것'만 담당한다(나머지는 여전히 사람 몫). */
  { ...jsxA11y.flatConfigs.recommended, files: ['src/**/*.tsx'] },
  /* ⚠ **두 a11y 도구가 정면으로 충돌하는 지점**이라 근거를 남긴다(2026-07-25).

     axe 의 `scrollable-region-focusable` 은 *스크롤되는데 포커스 가능한 자식이 없는* 영역을
     **위반**으로 잡는다 — 키보드·스위치 사용자가 그 안을 볼 방법이 없기 때문이다(WCAG 2.1.1).
     실측으로 둘 걸렸다: `guide` 탭 본문(순수 텍스트라 포커스 대상 0)과 통계의 18주 잔디.
     해법은 컨테이너에 `tabIndex={0}` 을 주는 것이고, 그게 이 규칙의 표준 처방이다.

     그런데 jsx-a11y 의 `no-noninteractive-tabindex` 는 정확히 그것을 금지한다. 이유는
     타당하다 — 비대화형 요소를 아무렇게나 탭 순서에 넣으면 키보드 이동이 쓰레기가 된다.
     **다만 그 규칙은 소스만 보므로 "이 div 가 실제로 스크롤되는지"를 알 수 없다.**
     스크롤 여부는 렌더된 계산 스타일의 성질이고, 그건 axe 만 볼 수 있다.

     그래서 규칙을 끄지 않고 **좁힌다**: `role="group"` 이 붙은 요소에서만 허용한다.
     `group` 을 표식으로 고른 이유는 ① 스크롤 컨테이너의 의미에 맞고 ② 이름 없는 group 은
     스크린리더가 사실상 무시하므로 탭마다 잡음 랜드마크가 생기지 않으며 ③ 명시적이라
     "우연히 통과"가 아니라는 점이다(기본 옵션은 `allowExpressionValues: true` 라 삼항식으로
     쓰면 이 규칙을 조용히 우회할 수 있다 — 그 통로에 기대지 않는다).
     ⚠ 새로 여기에 해당하려면 **정말 스크롤되는 컨테이너**여야 한다. 아니면 규칙이 맞다. */
  {
    files: ['src/**/*.tsx'],
    rules: {
      'jsx-a11y/no-noninteractive-tabindex': ['error', { tags: [], roles: ['tabpanel', 'group'] }],
    },
  },
  /* 코드 품질 게이트(0단계-F) — sonarjs를 **recommended 없이** 규칙 2개만 켠다.
     recommended는 217규칙이고 실측 위반 249건 중 181건이 스타일 취향
     (no-nested-conditional 130 · no-nested-assignment 20 · void-use 18 ·
     no-nested-template-literals 13)이다. 그 노이즈가 신호(cognitive-complexity 34 ·
     super-linear-regex 2)를 묻는 게 정적분석 도구 도입의 주 실패 모드라, 신호만 취한다.
     recommended가 jsx-a11y·react-hooks 규칙 사본까지 물고 오는 것도 피한다(위에서 이미 켬).
     ※ 이 목록을 늘리려면 먼저 실측하고 "노이즈:신호" 비율을 근거로 남길 것. */
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { sonarjs },
    rules: {
      /* 인지복잡도 **래칫** — 임계는 현재 최댓값에 맞춰져 있고 **내려가기만 한다**.
         기본값 15로 조이면 즉시 34건이 터져 0-F가 리팩터 작업이 되는데, 0단계는 "플랫폼 무관
         선행"이지 리팩터 단계가 아니다. 지금 막는 건 *새로 생기는* 괴물뿐.
         ⚠ 6단계(Tailwind)는 CSS를 JSX로 옮겨 이 수치를 밀어올린다 → max-lines와 함께 재기준선.
         현황은 `npm run report:debt`.
         ⚠⚠ **77 → 66 으로 조인다(F5 재설계 · 2026-08-01).** 로드맵이 남긴 재설계 4건
         (ArticlePractice 45→16 · ReviewRun 47→22 · Graph 38→14 · DayPlanner 37→31)에
         **`phone/ReviewView` 77→38** 을 더해 갚았다 — 실측 최댓값이 **66**(TodaySignature)이 됐고
         max-lines 때와 같은 규율로 그만큼 조인다.
         ⚠ 폰 러너를 함께 판 이유를 적어 둔다: 옛 주석은 임계 77 의 주인을 `TodaySignature` 라
         적었는데 **실측은 `phone/ReviewView`(77)** 였다. 로드맵의 재설계 4건만 갚았다면 래칫은
         한 칸도 못 내려갔다 — 손으로 베낀 귀속이 "무엇을 고쳐야 내려가는가"를 틀리게 말한 것이다.
         ⚠ 여유는 다시 **0** 이고, 이제 남은 유일한 지배자가 `TodaySignature` 다. 그 파일은
         `max-lines`(726/727)에서도 여유가 없다 — 다음에 여기를 더 내리려면 그 하나를 쪼개야 한다.
         ⚠⚠ **66 → 62 로 조인다(F5 후보 소진 · 2026-08-06).** 그 "하나를 쪼개야 한다"를 실제로
         했다: `RetrievalSlot` 추출로 `TodaySignature` 가 66→**62**. 여유는 다시 0이고 지배자도
         그대로다(2위는 `lib/db/rows.ts` 56).
         ⚠ F5 남은 후보 셋은 **추출하지 않기로 판정**했다(근거는 `결정로그.md` 2026-08-06):
         ReviewRun 인라인 CBMS 는 전제(_"세션 상태기계와 공유 상태 0"_)가 **실측에서 거짓**이고
         (`missId` 를 키보드 게이트 `askingMiss` 와 `undo` 가 읽는다), Graph·CommandPalette 는
         드릴 prop 이 2개·제어값 누출이라 F5 오라클 아래다. **개수가 아니라 오라클이 정한다.** */
      /* ⚠⚠ **62 → 25 로 내린다 — 단, 초과 18개는 기한부 예외로 명시한다**(2026-08-20 리뷰 M-14).

         종전의 문제는 값이 아니라 **형태**였다: 임계가 관측 최댓값 + ε(59 → 62)라 ① 기존 최악
         함수 18개가 영구 면제되고 ② **신규 코드도 59까지 자유**였다. 즉 게이트가 "더 나빠지지
         않는다"조차 보장하지 않았다(이미 최악인 수준까지는 언제든 새로 쓸 수 있었다).
         이 저장소는 같은 상황의 규율을 이미 적어 뒀다 — *"큰 삭제 뒤 한도를 함께 내린다.
         여유 33%면 게이트가 아무것도 안 지킨다"*(CLAUDE.md W4). 번들 예산엔 적용됐고 여기엔 안 됐다.

         → **새 코드는 25**, 초과분은 아래 override 에 **파일 단위로 열거**한다. 목록에 있다는 것이
         곧 "여기는 아직 안 갚았다"는 선언이고, 목록에 새 파일을 더하려면 커밋이 필요하므로
         리뷰에 걸린다(`audit-allowlist.json`·a11y `알려진위반` 과 같은 **기한부 판단** 관용구).
         ⚠ `max-lines` 는 **안 건드린다** — 재측정하니 한도 727 vs 실측 720 이라 여유 1% 로 이미
         조여져 있다(리뷰가 이 축을 함께 지적한 것은 과했다 · 실측이 그 지적을 기각한다). */
      'sonarjs/cognitive-complexity': ['error', 25],
      // ReDoS — 실측 2건을 0단계-F에서 제거했고(vault 프론트매터·quickCapture 챕터) 재발을 막는다.
      // 이건 취향이 아니라 입력이 커지면 멈추는 버그라 임계 없이 error.
      'sonarjs/super-linear-regex': 'error',
    },
  },
  /* ── 인지복잡도 **기한부 예외 원장**(M-14 · 2026-08-20) ─────────────────────────
     위 임계(25)를 넘는 함수를 가진 파일. **목록은 줄어드는 방향으로만 편집한다.**

     ⚠ 착수 당시 16파일 18함수였고, 그날 **8함수로 갚았다**(순수 lib 전량):
       `lib/db/rows`(56·45→분해) · `lib/persistence`(37·28) · `lib/spacedReview`(45) ·
       `lib/contentSearch`(30) · `lib/quickCapture`(35) · `lib/dayPlans`(28) · `lib/absence`(26) ·
       `lib/scheduler/dayPlanOverride`(43) — 여덟 파일이 원장에서 **빠졌다**.

     ## 남은 것이 왜 남았나 — 개수가 아니라 **오라클**이 정한다

     · `lib/scheduler/engine.ts` `schedule()`(50) — 이 파일은 스스로 *"회귀로 동결된 코어"* 라
       적는다. 독립적인 두 단계(daily 배치·복습 대상 날 고르기)는 이미 뺐고, 남은 50은 phase 4·5
       (과목 진행 상태 초기화 ↔ 주간 모듈 배분)가 **같은 가변 상태를 주고받는** 부분이다.
       거기를 가르려면 그 상태를 인자로 흘려야 하고, 그건 "위치만 옮긴다"가 아니라 **설계 변경**이다.
     · React 컴포넌트 일곱 — `결정로그.md` 2026-08-06 이 F5 남은 후보를 **추출하지 않기로 판정**했다
       (드릴 prop 2개·제어값 누출·공유 상태 실측). 그 판정을 개수 때문에 뒤집지 않는다.
       ⚠ 그리고 이쪽은 절단면이 DOM 을 바꿀 수 있어 시각 스냅샷이 안전망이 아니라 **공범**이 된다
       (`--update-snapshots` 가 깨진 결과를 정답으로 굳힌다 · §15-4 가 두 번 물린 형태).

     재검토 만료: **2026-11-20**. 그때까지 안 줄었으면 이 블록을 지우고 게이트가 깨지게 둔다
     (판단에 유효기간이 없으면 그건 판단이 아니라 방치다 — SCA 원장이 세운 규율).
     ⚠ 상한을 62 로 두는 것은 **현 상태 동결**이다(이 파일들 안에서도 더 나빠지지 못한다). */
  {
    files: [
      'src/features/today/TodaySignature.tsx',
      'src/features/today/FlowRail.tsx',
      'src/features/schedule/Schedule.tsx',
      'src/features/schedule/DayPlanner.tsx',
      'src/features/integrations/TelemetryConsole.tsx',
      'src/phone/ReviewView.tsx',
      'src/phone/PhoneApp.tsx',
      'src/lib/scheduler/engine.ts',
    ],
    rules: { 'sonarjs/cognitive-complexity': ['error', 62] },
  },
  /* 파일 크기 래칫 — 임계는 **현재 최댓값**이고 내려가기만 한다.
     주석·빈 줄 제외: 이 저장소는 "왜"를 주석으로 남기는 걸 규약으로 삼는데(결정로그와 짝),
     주석을 줄 수에 세면 규약을 지킬수록 게이트가 조여지는 역인센티브가 된다.
     ⚠ 730 → 844 재기준선(C-7 today 이식): CSS Module(988줄)이 JSX 로 들어오며 TodaySignature.tsx
     가 729→844 로 밀렸다. 위 주석은 "이식이 끝나면 다시 내려갈 여지를 본다"고 예고했다.
     ⚠⚠ **844 → 745 로 조인다(2026-07-29).** C-7 은 끝났는데 임계는 그대로여서, 선언("임계는 현재
     최댓값")과 실측(최댓값 742 · DayPlanner)이 **102줄** 벌어져 있었다 — 새 파일이 그만큼 아무
     신호 없이 자랄 수 있었고, `report:debt` 헤더는 `(래칫 844)` 를 찍어 게이트가 팽팽한 것처럼
     읽혔다. 래칫의 유일한 계약("더 나빠지지 않는다")이 조용히 깨져 있던 자리다.
     여유 3줄은 의도다 — 인지복잡도 래칫(77·여유 0)과 같은 규율이고, 넘으면 쪼개라는 뜻이다. */
  {
    files: ['src/**/*.{ts,tsx}'],
    /* ⚠ **래칫을 745 → 727 로 조였다(H18 · 2026-07-30 `/감사 근본`).**
       규약은 _"임계는 **현재 최댓값**이고 내려가기만 한다"_ 인데, 그새 파일들이 줄어(E17·E24 등)
       실측 최댓값이 **724** 였다(면제된 `atlasData.ts` 제외 · 권위 측정은 전체-src eslint).
       즉 래칫이 **21줄 느슨**했고, 그 폭만큼 파일이 조용히 자랄 수 있었다 — 래칫의 유일한 일이
       "더 나빠지지 않는다"인데 그 보장이 21줄 헐거웠던 것이다.
       여유 3줄은 의도다(인지복잡도 래칫 77·여유 0 과 같은 규율 — 넘으면 쪼개라는 뜻). */
    rules: { 'max-lines': ['error', { max: 727, skipBlankLines: true, skipComments: true }] },
  },
  /* ── 이모지 금지(2026-08-01 · 72종→아이콘 이식의 **집행자**) ──────────────────────────
     ## 왜 규약이 아니라 린트인가

     원칙 ①("단일 네온 · 다색 글래스 금지")인데 이모지는 **OS 폰트가 그리는 통제 불가 다색 3D
     오브젝트**다. 게다가 폰트 버전이 스냅샷 안정성의 숨은 입력이 된다. 이식 전 실측은
     **69종 · 253라인**이었고, 그게 규약(관습)만으로 유지될 수 없다는 것은 이 저장소가
     stylelint·번들 예산·커버리지에서 반복해 배운 것이다.

     ## ⚠ 대상은 **문자열과 JSX 텍스트뿐**이다 — 주석은 안 본다

     주석의 `⚠` 는 이 저장소의 문서 관용구이고(문서 밀도가 높다) 사용자에게 안 보인다. 실제로
     옛 측정이 `⚠ 103회` 라 적었던 것의 **77회가 JSX 주석**이었다 — 대상 정의를 안 적으면 수가
     그 정의에 지배된다. eslint 는 `Literal`/`JSXText`/`TemplateElement` 만 보므로 자연히 갈린다.

     ## ⚠⚠ 범위는 **개념표 72종**이다 — 기하 마크는 대상이 아니다

     ⚠ `↔`(2194)는 표에 있지만 **뺐다.** 코드의 세 곳이 전부 *두 낱말을 잇는 타이포그래피*이고
     (`parent↔hub`·`핵심↔수집`·`다크↔라이트`) 그 자리에 아이콘을 넣으면 문장이 깨진다 —
     같은 글자라도 **픽토그램으로 쓰인 것만** 대상이라는 뜻이다.

     `✓ ✕ ▾ ▸ ● ○ ★ ■ ⬡` 같은 것들은 **단색 텍스트 기호**라 위 논거("다색 3D 오브젝트")가 걸리지
     않고, 상당수는 아이콘이 아니라 *데이터 마크*다(범례 점·상태 도형). 실제로 처음 넣은 넓은
     범위는 그것들까지 67건 잡았고, 그건 승인 범위 밖이다(절대규칙 #4). 그래서 문자 목록을 손으로
     든다 — "무엇이 대상인가"를 정규식이 스스로 말하게 하려는 것이다.

     ⚠ 새 픽토그램이 필요하면 `lib/iconPaths.ts` 에 **개념 이름**으로 추가한다(글리프 이름 금지).
     예외를 열어야 한다면 **사유 + 만료일**을 함께 적는다(a11y·SCA 원장과 같은 규율).

     ## ⚠⚠ 이 목록에는 **구멍이 있다** — 그게 손목록의 대가다 (D3 · 2026-08-01)

     `acab94e` 는 커밋 메시지에 *"다시 못 들어오게 막았다"* 라고 적었는데 **부분적으로만 참**이었다:
     같은 커밋이 남긴 `Review.tsx` 의 `⚖`(U+2696)가 이 셀렉터를 그대로 통과했다. 원인은 결함이
     아니라 **설계의 대가**다 — BMP 픽토그램은 코드포인트가 흩어져 있어 범위로 못 묶고(그래서
     위 절이 손목록을 고른 것이고, 그 선택은 여전히 옳다: 넓은 범위는 데이터 마크 67건을 잡았다)
     손목록은 **적은 것만** 막는다.
     → 규율: 새 글리프를 지울 때 **그 코드포인트를 여기 추가하는 것까지가 한 짝**이다.
     지금 든 것 중 U+2696·26A1·2B50·2757·231B 는 코드에 **용례 0**이고, 예방으로 미리 닫은 것이다. */
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'Literal[value=/[\u{1F000}-\u{1FAFF}\u2600\u26D4\u2705\u2611\u270D\u267B\u2139\u23F0\u23F1\u2328\u2615\u26A0\u2197\u2199\u21A9\u21AA\u2195\u2934\u2935\u25B6\u25C0\u2696\u26A1\u2B50\u2757\u231B]/u]',
          message: '이모지 금지 — 픽토그램은 `<Icon name="…" />`(lib/iconPaths.ts)이고, 문자열 자리는 글리프를 뺍니다.',
        },
        {
          selector:
            'JSXText[value=/[\u{1F000}-\u{1FAFF}\u2600\u26D4\u2705\u2611\u270D\u267B\u2139\u23F0\u23F1\u2328\u2615\u26A0\u2197\u2199\u21A9\u21AA\u2195\u2934\u2935\u25B6\u25C0\u2696\u26A1\u2B50\u2757\u231B]/u]',
          message: '이모지 금지 — 픽토그램은 `<Icon name="…" />`(lib/iconPaths.ts)입니다.',
        },
        {
          selector:
            'TemplateElement[value.raw=/[\u{1F000}-\u{1FAFF}\u2600\u26D4\u2705\u2611\u270D\u267B\u2139\u23F0\u23F1\u2328\u2615\u26A0\u2197\u2199\u21A9\u21AA\u2195\u2934\u2935\u25B6\u25C0\u2696\u26A1\u2B50\u2757\u231B]/u]',
          message: '이모지 금지 — 템플릿 문자열에서도 글리프를 뺍니다(토스트는 tone 이 성격을 말합니다).',
        },
      ],
    },
  },
  // atlasData.ts는 진로 아틀라스 시드 **데이터**(779줄)다 — 분할해도 복잡도가 줄지 않는 상수 테이블이라
  // 크기 래칫의 대상이 아니다(코드가 아니라 데이터라는 것이 예외 사유).
  {
    files: ['src/lib/atlasData.ts'],
    rules: { 'max-lines': 'off' },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      // boundaries는 eslint-module-utils/resolve로 import 경로를 실제 파일에 매핑한다.
      // TS 리졸버가 .ts/.tsx 확장자와 @/* 별칭(tsconfig paths)을 둘 다 해결한다.
      'import/resolver': {
        typescript: { project: './tsconfig.app.json' },
      },
      // 패턴은 '**/' 접두(절대경로 매칭) — boundaries가 Windows에서 rootPath(역슬래시)와
      // 정규화된 경로(슬래시) 불일치로 상대경로 변환에 실패해, 패턴이 절대경로와 대조되기 때문.
      'boundaries/elements': [
        { type: 'app', pattern: '**/src/app/**' },
        // ⚠ feature끼리의 결합은 이 규칙이 못 잡는다 — 모든 feature 폴더가 한 element라
        //   'features → features'로 통과한다. capture로 폴더명을 잡으려 했으나 위 '**/' 접두
        //   (Windows 절대경로 우회)와 함께 쓰면 캡처가 바인딩되지 않는다. 대신 아래
        //   no-restricted-imports가 '@/features/*' 별칭을 막아 같은 경계를 강제한다.
        { type: 'features', pattern: '**/src/features/**' },
        { type: 'components', pattern: '**/src/components/**' },
        { type: 'hooks', pattern: '**/src/hooks/**' },
        { type: 'store', pattern: '**/src/store/**' },
        { type: 'lib', pattern: '**/src/lib/**' },
        /* ⚠⚠ **`shell` 을 등록한다(H10 · 2026-07-26 감사).**

           종전엔 `shell/` 이 어느 element 에도 안 잡혀(`no-unknown` 도 off) 경계 밖이었고,
           `shell/index.ts` 는 그걸 _"boundaries 무관 디렉터리라 어느 레이어에서도 import
           가능"_ 이라며 **기능으로 선언**했다. 그 예외가 실제로 한 일: 허용표상 금지인
           **`components → store` 가 배럴 한 칸을 거쳐 통과**했다(팔레트·단축키·useCollectTool).
           무효화된 전제는 "shell 은 서비스라 분류 불가"인데, shell 이 나르는 것은 서비스만이
           아니라 **상태와 IPC** 다.

           ⚠ `toast` 만 따로 잡는 것이 이 표의 요점이다. 토스트는 zustand 단독 모듈이라
           스토어·IPC 사슬이 없고(위 실측), `store/useApp` 이 저장 실패를 알리려면 그게
           필요하다. **더 구체적인 패턴이 먼저** 와야 한다 — boundaries 는 첫 일치를 쓴다. */
        { type: 'shellToast', pattern: '**/src/shell/toast/**' },
        { type: 'shell', pattern: '**/src/shell/**' },
        /* ⚠⚠ **`phone` 을 등록한다(H27 · 2026-07-30 `/감사 근본`).**

           C-6 은 _"폰은 `lib/` 만 공유하고 화면은 따로다"_ 를 설계 결론으로 선언했지만
           (설계서 §13-0), `src/phone/**` 은 **어느 element 에도 안 잡혀 있었다** — `no-unknown`
           도 off 라 `@/features/*`·`@/app/*`·`@/shell` 을 넣어도 **린트가 조용했다.**
           즉 그 결론은 집행자 없는 관습이었고, 이 저장소는 "규약을 관습에 두면 흘러내린다"를
           stylelint·번들 예산·커버리지 임계에서 반복해 배웠다.

           ⚠ 지금 실제 import 는 전부 합법이다(감사 시점 실측) — 그래서 이 등록은 **회귀를 막는
             것**이고 기존 코드를 하나도 안 고친다. 비용 0 에 선언이 곧 집행이 된다.
           ⚠ 허용 목록은 아래 정책에서 `features` 와 같은 폭으로 준다. 폰이 `app/`·`features/` 를
             무는 것만 막으면 §13-0 의 결론이 그대로 강제된다. */
        { type: 'phone', pattern: '**/src/phone/**' },
      ],
    },
    rules: {
      // 진입점(main.tsx 등 레이어 미매칭 파일)·CSS import는 검사 제외
      'boundaries/no-unknown-files': 'off',
      'boundaries/no-unknown': 'off',
      /* v5→v7 마이그레이션(2026-07-19): `boundaries/element-types` → `boundaries/dependencies`,
         `rules` → `policies`, 그리고 from/allow 가 문자열이 아니라 **엔티티 셀렉터**
         (`{ element: { type } }`)를 받는다. 옛 표기도 아직 돌지만 deprecation 경고를 내고
         다음 메이저에서 제거된다 — 레이어 강제는 절대규칙(CLAUDE.md #2)이라 조용히 무력화될
         자리에 낡은 API를 두지 않는다. */
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            {
              from: { element: { type: 'app' } },
              allow: [
                { to: { element: { type: 'features' } } },
                { to: { element: { type: 'components' } } },
                { to: { element: { type: 'hooks' } } },
                { to: { element: { type: 'store' } } },
                { to: { element: { type: 'lib' } } },
                { to: { element: { type: 'shell' } } },
                { to: { element: { type: 'shellToast' } } },
              ],
            },
            /* 폰(H27) — 화면은 따로지만 소비 층은 feature 와 같다. `app`·`features`·`shell` 배럴은
               **주지 않는다**: 그게 §13-0 의 "하위 컴포넌트 선별 재사용은 성립하지 않았다"라는
               실측 결론이고, `shell` 은 `actions.ts`(스토어·IPC)를 나르므로 폰 번들에 들어가면
               H7(폰 초기 로드에서 데스크톱 IPC 표면 제거)이 되돌려진다. 토스트만 잎 모듈로 허용. */
            {
              from: { element: { type: 'phone' } },
              allow: [
                { to: { element: { type: 'components' } } },
                { to: { element: { type: 'hooks' } } },
                { to: { element: { type: 'store' } } },
                { to: { element: { type: 'lib' } } },
                { to: { element: { type: 'shellToast' } } },
                { to: { element: { type: 'phone' } } },
              ],
            },
            {
              from: { element: { type: 'features' } },
              allow: [
                { to: { element: { type: 'components' } } },
                { to: { element: { type: 'hooks' } } },
                { to: { element: { type: 'store' } } },
                { to: { element: { type: 'lib' } } },
                { to: { element: { type: 'shell' } } },
                { to: { element: { type: 'shellToast' } } },
              ],
            },
            {
              /* ⚠ **`shell` 이 없는 것이 이 줄의 요점이다**(H10). 재사용 프리미티브가 셸 배럴을
                 물면 그 한 칸으로 스토어·IPC 가 딸려 온다 — 토스트(잎 모듈)만 허용한다. */
              from: { element: { type: 'components' } },
              allow: [
                { to: { element: { type: 'hooks' } } },
                { to: { element: { type: 'lib' } } },
                { to: { element: { type: 'shellToast' } } },
              ],
            },
            {
              /* ⚠⚠ **`hooks → shellToast` 를 연다(H22 · 2026-08-01 · 사용자 승인).**

                 종전엔 `lib` 만이라 **사용자에게 말을 거는 훅은 승격할 자리가 없었다.** 그래서
                 `useCollectTool`(이름부터 훅인데)이 `components/` 에 살았다 — 설계가 아니라
                 정책이 고른 자리였다. 원인이 코드가 아니라 경계라는 감사(H22)의 진단이 맞았다.

                 ⚠ 여는 폭은 **잎 하나뿐**이다. 배럴(`shell`)은 여기서도 금지다 — 그러면 한 칸으로
                 `actions.ts`(스토어·IPC)가 딸려 와 `components → hooks → store` 가 전이로 뚫린다
                 (H10 이 `components` 에서 막은 것과 같은 구멍). 토스트가 잎인 근거는 위
                 `components` 정책 주석과 같다.
                 ⚠ **`shell/modal`(confirm)은 열지 않았다.** 한때 함께 열려다 되돌렸다 — H22 가
                 묶어 둔 나머지 두 건이 실제로는 훅이 아니었기 때문이다(`addSubject` 는 상태+UI 를
                 엮는 **액션**이라 `shell/actions` 가 제자리 · 캡처 커밋은 **순수 데이터 경로**라
                 `lib/quickCapture` 가 제자리). 쓰는 데 없는 정책을 열어 두면 그게 다음 감사의
                 "선언은 있는데 집행자가 없다"가 된다. 필요해지면 그때 같은 실측(잎인가)으로 연다. */
              from: { element: { type: 'hooks' } },
              allow: [{ to: { element: { type: 'lib' } } }, { to: { element: { type: 'shellToast' } } }],
            },
            {
              /* 스토어가 토스트만 쓰는 것은 의도다 — 저장 실패를 사용자에게 알리는 유일한 통로다
                 (`useApp` 주석). 배럴(`shell`)은 여기서도 금지 — 그러면 store → actions → store 다. */
              from: { element: { type: 'store' } },
              allow: [{ to: { element: { type: 'lib' } } }, { to: { element: { type: 'shellToast' } } }],
            },
            { from: { element: { type: 'lib' } }, allow: [{ to: { element: { type: 'lib' } } }] },
            {
              /* 셸 서비스는 상태·IPC·UI 를 엮는 자리다(액션 표면). 그래서 위로는 아무도 못
                 올라오게 하고(위 정책들), 여기서는 아래 전부를 허용한다. */
              from: { element: { type: 'shell' } },
              allow: [
                { to: { element: { type: 'components' } } },
                { to: { element: { type: 'hooks' } } },
                { to: { element: { type: 'store' } } },
                { to: { element: { type: 'lib' } } },
                { to: { element: { type: 'shell' } } },
                { to: { element: { type: 'shellToast' } } },
              ],
            },
            { from: { element: { type: 'shellToast' } }, allow: [{ to: { element: { type: 'lib' } } }] },
          ],
        },
      ],
    },
  },
  /* feature↔feature 결합 금지 — boundaries가 못 보는 경계를 여기서 막는다.
     cross-feature import는 전부 '@/features/...' 별칭을 쓰고 같은 feature 안은 './'를 쓰므로,
     features 폴더 안에서 그 별칭을 금지하면 정확히 교차 결합만 걸린다.
     공유가 필요하면 components/hooks/lib으로 승격할 것(그래야 재사용 계약이 명시된다). */
  {
    files: ['src/features/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features/*'],
              message:
                'feature끼리 직접 import 금지 — 같은 feature는 상대경로(./), 공유물은 components/hooks/lib으로 승격하세요.',
            },
            /* ⚠⚠ **상대경로 탈출도 막는다**(2026-08-20 리뷰 m-3).

               위 별칭 금지만 있던 동안, 그 옆 주석은 _"cross-feature import는 전부 '@/features/…'
               별칭을 쓰고"_ 라는 **관습을 전제로** 삼고 있었다. 실측(eslint 프로브)하면 별칭·
               타입 전용·동적 import 는 전부 잡히는데 `../alloc/Alloc` 만 **에러 0건**이었다.
               즉 절대규칙 #4 가 한쪽 문법에만 걸려 있었고, 이 저장소엔 이미 하위 폴더를 가진
               feature 가 있어(`features/ledger/mastery/`) 그 경로가 자연스럽게 나올 자리가 있다.

               패턴 둘: 한 칸 위 형제 feature(`features/day/X` 에서 이웃 폴더로), 그리고 두 칸 위
               `features` 재진입(`features/ledger/mastery/X` 에서의 탈출).
               같은 feature 안의 `./shared` 는 안 걸린다. 현재 실제 위반 0 이라 **회귀 방어**다.
               ⚠ 패턴 문자열을 이 주석에 인용하지 말 것 — 별과 슬래시가 붙으면 블록 주석이 거기서
                 끝난다(실제로 한 번 물렸다). 값은 바로 아래 `group` 이 정본이다. */
            {
              group: ['../*/*', '../../features/*', '../../features/*/**'],
              message:
                'feature 밖으로 나가는 상대경로 금지 — 같은 feature 안은 ./, 공유물은 components/hooks/lib으로 승격하세요(별칭 금지와 같은 경계입니다).',
            },
          ],
        },
      ],
    },
  },
  // registry.tsx는 모든 feature를 lazy 로드하는 *레지스트리*라 이 금지의 유일한 정당한 예외.
  {
    files: ['src/features/registry.tsx'],
    rules: { 'no-restricted-imports': 'off' },
  },
  /* SD-7 — main.tsx 의 **부팅 순서 계약**을 린트로 승격(2026-07-24).

     계약: `useApp` 모듈은 `initAppStore()` 가 **끝난 뒤에** 처음 평가돼야 한다. 그 스토어는
     `create()` 시점(=모듈 평가 시점)에 `preloadedState()` 를 읽으므로, 먼저 평가되면 아직
     null 인 값을 읽고 **셸이 SQLite 대신 낡은 localStorage 로 부팅한다.**

     ⚠ 이 계약은 main.tsx 주석에 정확한 조건까지 적혀 있었는데도 **그 파일 자신이 어겼다** —
     `ThemeProvider` 를 정적 import 했고 그게 `useApp` 을 끌어왔다(2단계-E 가 `App` 만 동적으로
     바꾸고 형제를 놓쳤다). 2026-07-24 트랙 B 가 잡을 때까지 살아 있었다.
     **교훈: 표현 가능한 계약을 주석에 두면 지켜지지 않는다.**

     막는 방식: main.tsx 에서 `useApp` 을 (직접이든 그것을 끌어오는 앱 컴포넌트든) **정적으로**
     import 하지 못하게 한다. 동적 `import()` 는 이 규칙의 대상이 아니라 그대로 통과한다 —
     그게 정확히 우리가 원하는 형태다. 새 컴포넌트를 여기에 정적으로 붙이려는 사람은
     아래 메시지를 읽고 동적 import 쪽으로 간다. */
  {
    files: ['src/main.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          /* ⚠⚠ **denylist 를 allowlist 로 뒤집었다(H10 · 2026-07-26 감사).**

             종전 표현은 모듈 이름 **3개짜리 denylist**(`@/store/useApp`·`@/app/App`·
             `@/app/ThemeProvider`)라 계약의 실제 내용("`useApp` 을 **전이적으로** 끌어오는
             모듈을 정적 import 하지 않는다")을 담지 못했다. 실제로 구멍이 열려 있었다:
             `import { ui } from '@/shell'` 한 줄이면 `shell/index` → `actions` → `@/store/useApp`
             으로 이어져 **셸이 다시 낡은 localStorage 로 부팅한다.** 목록에 없으니 린트는 조용하다.

             지금은 `@/…` 전부를 막고 **안전이 증명된 것만** 뚫는다:
             · `@/styles/**` — CSS
             · `@/lib/**` — 경계 규칙상 `lib → lib` 뿐이라 스토어에 닿을 수 없다(위 boundaries)
             · `@/app/queryClient` — `@tanstack/react-query` 만 문다(실측 · main.tsx 주석)
             새 진입점을 여기 정적으로 붙이려는 사람은 아래 메시지를 읽고 동적 import 로 간다. */
          patterns: [
            {
              /* ⚠ 부정 패턴(`!@/styles/**`)은 이 규칙에서 **동작하지 않는다**(실측 — 전부 걸렸다).
                 그래서 "스토어에 닿을 수 있는 레이어 전체"를 **디렉터리 단위**로 막는다. 모듈
                 이름을 세지 않으므로 그 레이어에 새 파일이 생겨도 자동으로 덮인다.
                 남는 것은 `@/lib/**`(경계상 lib→lib 뿐)과 `@/styles/**`(CSS) 뿐이고, 그래서
                 `queryClient` 를 `lib/` 로 옮겼다 — `@tanstack/react-query` 만 무는 순수 설정이라
                 원래 app 층에 있을 이유가 없었다(그 위치가 이 규칙의 예외를 강요하고 있었다). */
              group: [
                '@/app/**',
                '@/store/**',
                '@/features/**',
                '@/components/**',
                '@/hooks/**',
                '@/shell',
                '@/shell/**',
              ],
              message:
                'main.tsx 는 `useApp` 을 (전이적으로라도) 끌어오는 모듈을 **정적으로** import 할 수 없습니다 — 스토어가 initAppStore() 보다 먼저 만들어져 셸이 낡은 localStorage 로 부팅합니다(SD-7). `.then()` 안에서 동적 import 하세요. 정말 안전하다면 이 allowlist 에 근거와 함께 추가하세요.',
            },
          ],
        },
      ],
    },
  },
  /* ⚠ **H14 규칙(셸 크롬의 시드 정적 import 금지)이 P10 W4 에서 사라졌다**(2026-08-07).
     막던 대상(`@/lib/atlas`·`atlasData` · 811줄 시드 14.2 KB gz)이 `survey/` 필러로 갔다.
     ⚠ 규칙이 옳지 않아서가 아니라 **막을 것이 없어서** 지운 것이다 — 존재하지 않는 모듈을
     가리키는 린트는 다음 사람에게 "이런 모듈이 있다"고 거짓말한다. 같은 형태(셸 크롬이 큰
     시드를 정적으로 끄는 것)가 다시 나오면 이 블록을 되살려라: `git show 1c21ad5:web/eslint.config.js`.
     그때까지 그 축은 `npm run budget` 축 ②(데스크톱 부팅 웨이브)가 총합으로 지킨다. */
  // web/scripts/*.mjs — Node 도구(gate·scaffold-tab·bundle-budget). Node 전역 허용.
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },

  /* ── Tailwind 규약 집행자(C-6 파일럿 → C-7 본편) ─────────────────────────────
     `stylelint` 이 CSS 에서 강제하던 2가지(브레이크포인트 허용목록 · 생 hex 금지)는
     클래스가 JSX 로 옮겨가면 **검사 대상 밖으로 나간다.** 결정로그가 그 사실을 짚어 뒀다:
     _"규율은 소멸이 아니라 `better-tailwindcss` 로 **집행자만 교체**된다."_ 여기가 그 교체다.

     ⚠ 지금은 `src/phone/**` 만 대상이다. C-7 이 feature 를 하나씩 옮길 때마다 이 목록을
     넓힌다 — 한 번에 전체를 켜면 아직 CSS Modules 인 파일에서 오탐만 쏟아진다.
     (⚠ 이 두 문단은 **C-7 이행기의 기록**이다. 지금 대상은 아래 블록대로 `src` 전량이고
      `*.module.css` 는 0개다 — 이력으로 읽을 것. 2026-07-29 표시.)

     ⚠⚠ **설계서의 가정 하나가 틀렸다**: `플랫폼개편-설계.md` §4-6단계는 _"`[max-width:820px]`
     임의값은 better-tailwindcss 의 **임의값 룰**을 명시적으로 켜야 막힌다"_ 고 적었는데,
     v4.7.0 에 그런 룰은 **없다**(룰 15개 전량 확인). 대신 `no-restricted-classes` 의
     `restrict` 패턴으로 막는다 — 결과는 같고 수단이 다르다. */
  {
    /* ⚠⚠ **이행기 목록을 걷었다(H21 · 2026-07-26 감사).**

       여기 있던 것은 "feature 를 하나씩 옮길 때마다 넓힌다"는 **C-7 이행 장치**였다. C-7 은
       끝났고(`*.module.css` 0개) 그때부터 목록은 **표류**했다 — 이후 신설된 `features/forecast`·
       `features/mistakes`, 컴포넌트 `ArtifactError`·`ArtifactGate`·`CountReadout`·`ProgressRing`,
       `ui/{Button,NumberField}` 가 전부 빠져 있었다. 즉 **가장 새 코드가 무집행**이었고, 그건
       집행자를 두는 목적과 정반대다(이 저장소가 stylelint 를 들일 때 내린 결론과 같다:
       규약을 관습에 두면 흘러내린다).

       이제 `src` 아래 모든 `.tsx` 다 — 새 파일이 자동으로 포함되므로 같은 표류가 재발하지 않는다.
       (⚠ 이 주석에 글롭을 그대로 쓰지 말 것: 별표 둘 뒤의 슬래시가 블록 주석을 조기 종료시킨다.) */
    files: ['src/**/*.tsx'],
    plugins: { 'better-tailwindcss': betterTailwind },
    /* ⚠⚠ **`variables` 로 대문자 상수를 검사 대상에 넣지 말 것 — 2026-07-29 에 해 보고 되돌렸다.**

       진단 자체는 맞다: 플러그인의 변수 탐지 기본값은 `classNames?`·`classes`·`styles?` **라는
       이름의 변수**뿐이고(`…/lib/options/default-options.js` 의 `DEFAULT_VARIABLE_NAMES`),
       이 저장소의 관용구는 `const S = {…}`·`const RAIL = '…'` 이라 `className={대문자상수}`
       형태(786회)가 검사 밖이다. 그래서 `variables` 에 `^[A-Z][A-Z0-9_]*$` 를 더해 봤다.

       **결과: 위반 1619건 중 진짜는 정확히 1건이었다**(`RailSidebar` 의 `z-nav`). 나머지 1618건은
       전부 오탐 — 이 저장소에서 대문자는 "클래스"가 아니라 **그냥 모듈 상수**다: `icons.tsx` 의
       SVG path 데이터 819건 · `AmbientCanvas` 의 GLSL 셰이더 465건 · 팔레트/치트시트의 한글 라벨
       맵 · 이모지 맵 · `ThemeProvider` 의 테마 색 맵. 플러그인이 쓸 수 있는 키가 못 된다
       (이름을 바꿔 규약을 만드는 길은 있으나, 786개 참조를 건드리는 순수 churn 이다).

       진짜 1건이 속한 결함 부류("선언은 됐는데 아무 데서도 안 쓰이는 토큰")는 플러그인이 아니라
       **`scripts/check-tokens.mjs` 의 역방향 검사**가 소유한다 — 거기가 정확한 자리다. */
    settings: { 'better-tailwindcss': { entryPoint: 'src/styles/tw.css' } },
    rules: {
      /* ⚠ 전역 앱-크롬 클래스 허용(C-7 셸 티어). `styles/global/*.css` 의 27개 전역 클래스는
         Tailwind 유틸이 아니지만 셸이 문자열로 쓴다(플러그인 entryPoint=tw.css 는 이를 모른다).
         ds.* 는 모듈 참조(`ds.card`)라 안 걸리지만 `skip-link` 등은 생 문자열이라 걸린다.
         (⚠ 옛 문구의 "ds.module.css 티어에서 정리되면 목록이 줄어든다" 는 **끝난 이행 계획**을
         근거로 삼고 있었다 — 이 무시 목록은 이제 전역 앱크롬이 `styles/global/` 에서 유틸로
         옮겨갈 때만 줄어든다. 2026-07-29 정정.) */
      /* 전역 앱크롬 클래스는 유틸이 아니다 — `skip-link`(App)·`menu`/`menu-sep`/`menu-danger`(TopBar ⋯ 드롭다운)는
         `styles/global/components.css` 가 소유하고 **ds.module + 전역 요소 규칙과 함께 맨 마지막**에 옮긴다(§15-5). */
      /* 무시 목록 = **전역 앱크롬 클래스**뿐이다(ds.module + 전역 요소 규칙은 맨 마지막 티어에서
         함께 옮긴다). 여기에 새 이름을 넣는 것은 "아직 안 옮겼다"는 표시이지 면제가 아니다.
         `modal*`·`in`·`primary` 는 ShortcutsHelp 가 쓰는 공통 모달 크롬(global/components.css). */
      'better-tailwindcss/no-unknown-classes': [
        'error',
        {
          ignore: [
            /* 공유 디자인 시스템(`styles/ds.css`) — C-7 마지막 티어에서 CSS Module 에서 전역으로
               승격했다. 유틸리티가 아니므로 플러그인이 모르는 게 정상이고, 접두 하나로 면제한다
               (접두를 둔 이유의 절반이 이것이다 — `ds.css` 머리주석). */
            '^ds-',
            '^skip-link$',
            '^menu(-sep|-danger)?$',
            '^modal(-ov|-t|-a|-ok)?$',
            '^hud(-scroll|-fill)?$',
            '^in$',
            '^primary$',
            /* H21 로 대상이 `src` 전량이 되며 드러난 잔여 전역 앱크롬 — 전부
               `styles/global/{base,components}.css` 소유이고 성격이 위 목록과 같다.
               · `wrap` — 부팅 실패·다운그레이드 화면의 바깥 래퍼(main.tsx)
               · `ic` — 아이콘 스프라이트(shell/icons.tsx)
               · `modal-*`·`ghost` — 공통 모달 크롬(shell/modal.tsx)
               · `toast*`·`out` — 토스트 호스트(shell/toast.tsx)
               ⚠ 여기 넣는 것은 **"아직 안 옮겼다"는 표시이지 면제가 아니다**(위 주석과 같은 규율). */
            '^wrap$',
            '^ic$',
            '^modal-(b|in|cancel|danger)$',
            '^ghost$',
            '^toast(-host|-life|-i|-m|-act)?$',
            '^out$',
          ],
        },
      ],
      'better-tailwindcss/no-conflicting-classes': 'error',
      'better-tailwindcss/no-duplicate-classes': 'error',
      'better-tailwindcss/enforce-consistent-class-order': 'error',
      /* 임의값 금지 — 토큰 사다리를 우회하는 통로를 막는다(`phone.css` 규약 3).
         ⚠ **C-7 이 예외를 둘 갖게 된다. 지금 미리 적어 둔다 — 그때 발견하면 이미 늦다:**
         ① **반픽셀 font-size**(9.5/10.5/11.5px) — `stylelint.config.js:17-22` 가 왜 반픽셀
            금지를 일부러 안 넣었는지 기록한다: 월 캘린더 `.cell` 이 고정 행 높이 +
            `overflow:hidden` 이라 0.5px 상향이 **과목 칩을 통째로 잘라먹은** 실사고가 있다.
            Tailwind `text-*` 는 정수 사다리라 그 값들이 전부 임의값이 된다.
         ② **런타임 CSS 변수 인라인 주입** — `--seg` 4곳 · `--sub` · `--tint` 2곳. 동적 색은
            **정의상 정적 클래스로 표현 불가**다. 이건 절대규칙 #3(색은 파생물)의 구현이라
            없앨 수 없다. 예외로 파야 한다. */
      'better-tailwindcss/no-restricted-classes': [
        'error',
        {
          /* ⚠ 패턴을 셋으로 갈랐다(C-7 review-run 이식에서 발견). 처음엔 대괄호를 **전부**
             막았는데, 그러면 `data-[kind=confident]:bg-warn` 같은 **변형 셀렉터**까지 걸린다 —
             그건 임의값이 아니라 관계형 스타일을 표현하는 정공법이고, 이 저장소가 CSS 에서
             속성 셀렉터로 하던 것의 Tailwind 대응물이다. 막으면 `.badge[data-kind]` 류를
             옮길 방법이 사라진다. 막아야 할 것은 **값**이지 셀렉터가 아니다. */
          restrict: [
            {
              pattern: '.*[[].*?[0-9](?:px|rem|em|%|vw|vh|ch|deg).*',
              message:
                '임의 수치 금지 — 간격은 --sp-*, 타이포는 --fs-* 사다리에서 온다. 유동값(clamp 등)은 tokens.css 에 이름을 주고 브리지에 연결하세요.',
            },
            {
              pattern: '.*[[]#.*',
              message: '임의 색 금지 — 색은 tokens.css 의 의미론 토큰에서만 온다(절대규칙 #3).',
            },
            {
              pattern: '.*[[]&.*',
              message:
                '임의 변형(`[&_em]:`) 금지 — 자손 셀렉터를 되살리는 통로다. 자식에 직접 클래스를 주도록 JSX 를 고치세요(그게 6단계가 요구하는 구조 변경이다).',
            },
          ],
        },
      ],
    },
  },
);
