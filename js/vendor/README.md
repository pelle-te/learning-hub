# js/vendor — 벤더링된 의존성 (설계도 §2.2 적응 우선·도입 규율)

오프라인·단일 파일·버전 핀 원칙으로 들여온 외부 라이브러리. 정적 `import` 금지
(테스트가 파일을 concat해 sloppy `vm`으로 돌리므로) — **동적 `import()` 브라우저 경로에서만** 로드한다.

## lit-html.js
- **핀 버전**: `lit-html@3.3.3`
- **용도**: 리스트 중심 뷰의 점진(키드) 렌더 — A1·F-09 토대(현재 통계 탭 챕터 타임라인).
- **로드 방식**: `import('./vendor/lit-html.js')` (브라우저, 진짜 DOM에서만). 비DOM(테스트/SSR)은 문자열 폴백.
- **재현(한 명령에 가깝게)** — 소스→실행:
  ```bash
  cd <임시폴더>
  npm init -y && npm install lit-html@3.3.3 esbuild
  printf "export { html, svg, render, nothing, noChange } from 'lit-html';\nexport { repeat } from 'lit-html/directives/repeat.js';\n" > entry.js
  npx esbuild entry.js --bundle --format=esm --minify --legal-comments=none --outfile=lit-html.js
  # 산출 lit-html.js 를 러닝허브/js/vendor/ 로 복사
  ```
- **부패 관리**: 버전 업 시 위 명령으로 재번들 → 브라우저 스모크(통계 탭 타임라인) 확인 후 교체.
  최상위에서 `document`를 참조하므로 **main.js 정적 그래프에 넣지 말 것**(esm-smoke가 깨짐).
