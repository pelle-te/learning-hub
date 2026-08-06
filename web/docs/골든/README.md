# 골든 — 레퍼런스(스타일 앵커)

> 새 feature를 만들거나 재설계할 때 **구조·컨벤션·어조의 템플릿**으로 삼는 실물 표본. 서브에이전트에 "이걸 앵커로" 전달한다. 시스템 볼트의 `골든/`과 같은 사상.

## 재설계·시그니처 앵커 → `src/features/today/`

`today` 탭이 **재설계 사상의 원본**이다(단일 목적·상단 리드아웃·fill 프레임·온디맨드 세부 — `protocols/탭재설계.md`). 히어로/시그니처 레이아웃, 라임 액센트, DS 토큰 사용의 모범.

- `Today.tsx` · `TodaySignature.tsx` — 리드아웃 + fill 프레임 구성. **스타일은 Tailwind 유틸리티 + 공유 `ds-*`**(C-7 이후 `*.module.css` 0개 — 인라인 클래스맵·`FlowRail.tsx` 의 `N` 맵이 노드 클래스 SSOT 방식의 표본)
- `SetupGuide.tsx` — 빈/초기 상태 처리
- `consts.ts` — feature 국소 상수 분리

## 구조 앵커(최소 골격) → `scaffold-tab.mjs` 산출물

`node scripts/scaffold-tab.mjs`가 만드는 스텁이 **레이어 규약을 만족하는 최소 골격**이다(default export·Tailwind 유틸리티 스타일·boundaries 준수·테스트 스텁 · C-7 이후 `*.module.css` 안 만든다). 새 탭은 여기서 출발해 today의 사상으로 채운다.

- ⚠ **스텁의 기본 `role` 은 `lens` 다** — `destination` 은 세 의무(`seq` 고유성 · `primary` 앵커 · 시그니처 표면)를 더 요구하고 그건 *본 구현*이 채운다(실측: destination 스텁은 불변식 셋을 즉시 깬다). 승격 체크리스트는 스캐폴딩이 실행 끝에 출력하고, 절차는 `protocols/새탭추가.md` 1번이 SSOT.

## 앵커로 삼을 때 확인할 것

- boundaries 준수(app/다른 feature import 없음).
- 계산 로직은 컴포넌트가 아니라 `lib` 순수함수에.
- 스타일은 Tailwind 유틸리티 + 공유 `ds-*`(`styles/ds.css`) — 전역 클래스·`*.module.css` 신설 없이.
- 빈 상태 `components/State`(`kind='empty'` · `next` 필수), reduced-motion 백스톱. ⚠ 옛 `EmptyState` 는 E17 에서 삭제됐다.

> 더 나은 표본이 생기면 이 문서의 앵커를 갱신한다(골든은 살아있는 기준).
