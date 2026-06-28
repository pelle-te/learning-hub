/* ============================================================
   main.js — ESM 진입점 (index.html이 <script type="module">로 이 파일 하나만 로드)
   ── 왜 이렇게 ──────────────────────────────────────────────
   로컬 서버(http)로 띄우면 file:// 제약이 풀려 ES 모듈을 쓸 수 있다.
   각 모듈은 진짜 모듈(strict·독립 스코프)이고, 파일 끝의 Object.assign으로
   '공개 표면'만 globalThis에 올린다(인라인 onclick·타 모듈 호출용 상호운용 층).
   여기서는 그 모듈들을 *의존성 순서대로* 사이드이펙트 import 한다 —
   각 import가 해당 모듈을 평가(전역 노출)하고, 마지막 app.js가 부팅(render)한다.

   ⚠️ 순서 = 옛 index.html의 <script> 순서와 동일해야 한다(앞이 뒤의 전역을 정의).
      utils → ui-kit → tabs → state → data-methodology → scheduler → ui-* → app
============================================================ */
import './utils.js';
import './ui-kit.js';
import './tabs.js';
import './state.js';
import './data-methodology.js';
import './scheduler.js';
import './ui-today.js';
import './ui-schedule.js';
import './ui-items.js';
import './ui-routine.js';
import './ui-stats.js';
import './ui-review.js';
import './ui-vault.js';
import './ui-anki.js';
import './ui-degree.js';
import './app.js';   // 마지막: applyTheme(); render(); 로 부팅
