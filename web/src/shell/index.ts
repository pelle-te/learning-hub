/* ============================================================
   shell/index.ts — React 셸 서비스 배럴.
   탭 메타·아이콘·토스트/모달 호스트·명령형 ui/io/actions를 한 곳에서 노출 — app·features가 여기서 가져온다.
   (⚠ **옛 문구 정정** — 종전엔 여기 "boundaries 무관 디렉터리라 어느 레이어에서도 import 가능"이라
   적혀 있었다. H10(2026-07-26)이 그 예외를 폐기했다: `shell` 은 등록된 레이어이고,
   `components`·`store`·`lib`·`hooks` 는 **이 배럴을 import 할 수 없다**(토스트는 `shell/toast`
   잎 모듈로 따로 허용). 금지된 것을 기능으로 광고하는 문장이 남아 있으면 다음 사람이 그걸 믿는다.)
   액션 표면 3분할(각 함수는 정확히 한 곳): ui(토스트·모달·백업) / io(내보내기·FS·복구) / actions(상태 변형).
============================================================ */

export { ToastHost } from './toast';
export { ModalHost } from './modal';
/* ⚠ **재수출이다** — 실체는 `components/Icon.tsx` 로 갔다(이모지 이식의 선행 · 그 파일 머리주석).
   `app/` 셋이 이 배럴로 쓰고 있어 경로를 안 깨뜨리려 남긴다. 새 소비처는 `@/components/Icon` 을 직접 쓸 것 —
   `components`·`phone` 은 이 배럴을 물 수 없다(H10·H27). */
export { Icon } from '@/components/Icon';
export {
  orderedTabs,
  tabByKey,
  routeLabelOfLocation,
  visitKeyOfLocation,
  navGroups,
  railTabs,
  hostHintOf,
  glyphOf,
  type TabMeta,
  type NavGroup,
  type TabRole,
} from './tabs';
export { paletteCommands, type PaletteCommand } from './palette';
export { vtMove, type VtKind, type VtMove } from './vt';
/* ⚠ 명령 카탈로그는 **`shell/verbs.ts`** 다(m-18 · 2026-08-20) — 종전엔 `actions.ts` 안에
   백업·내보내기와 섞여 있었고, 그래서 이 저장소에 카탈로그가 둘이 됐다(그 파일 머리주석 참조). */
export {
  captureSubjects,
  commitCapture,
  semanticPalette,
  contentSearch,
  verbsFor,
  type ContentHit,
  type HitVerb,
} from './verbs';
export { recordRecent, recordVisitAsRecent } from './recent';
export { NAV_SHORTCUTS, GLOBAL_SHORTCUTS, type NavShortcut } from './shortcuts';

/* ============================================================
   ⚠⚠ **`ui`/`io`/`actions` 세 객체가 사라졌다 — named export 다**(m-18 · 2026-08-20).

   종전엔 이 자리에 함수 참조를 담은 객체 리터럴 셋이 있었고, 소비처는 `ui.toast(…)`·
   `io.exportJSON()` 처럼 **프로퍼티 접근**으로 불렀다. 그 형태의 대가가 셋이었다:

   ① **tree-shaking 이 막힌다.** 객체 리터럴은 통째로 살아 있어야 하므로, `ui` 를 한 번이라도
      import 한 청크는 백업·복구·아카이빙까지 함께 끌고 온다.
   ② **`boundaries` 가 배럴 뒤를 못 본다.** 린트는 `features → shell` 한 변만 보고, 그 안에서
      무엇이 딸려 오는지 모른다(H10 이 `shell` 을 element 로 등록하며 고친 것은 *어느 레이어가*
      배럴을 물 수 있는가이지 *무엇이 들어 있는가* 가 아니다).
   ③ **grep 이 안 된다.** "어느 화면이 백업을 부르는가"를 `io.backupToVault` 로 찾아야 했는데,
      그건 이름이 아니라 *경로*라 이름을 바꾸면 검색이 통째로 어긋난다.

   ⚠ **세 갈래의 의미 구분은 주석으로 남긴다** — 원래 `ui`/`io`/`actions` 라는 이름이 하던
   일(이 함수가 어떤 성격인가)을 잃지 않기 위해서다. 새 함수를 여기 노출할 때 어느 절에 넣을지
   고르는 것이 곧 그 선언이다.
============================================================ */

/* ── ui — 공용 UI 표면(토스트·확인 사다리·백업 스냅샷) ───────────────────────
   ⚠ **`toastUndo` 는 없다**(근본① · 2026-08-01). 그것은 `undoLast`(= `BACKUP_KEY` 스냅샷 복원)를
   6.5초 창에 매다는 것이었는데 두 가지가 동시에 틀렸다: ① 스냅샷은 **손으로 부른 `backupNow()`
   직전**의 상태라 "직전 편집"이 아니고(며칠 전일 수 있었다) ② 그래서 삭제마다 `backupNow()` 를
   불러야 했고 그 호출이 *가져오기·초기화*용 스냅샷을 계속 덮어썼다. 지금은 전역 ⌘Z 가 **행 단위
   pre-image** 로 덮는다(`lib/db/undoStack`).
   ⚠⚠ **`confirm` 도 없다**(Q-13 · 2026-08-02). 대신 사다리 세 마디를 노출한다 —
   `shell/destructive.ts` 머리주석이 어느 단인지 고르는 기준의 SSOT 이고, **불변식 ⑨** 가
   `confirm(` 직접 호출을 0건으로 잠근다. */
export {
  toast,
  /** 되돌릴 수 있는 편집을 알린다(⌘Z 힌트 포함). */
  toastUndoable,
} from './toast';
export {
  /** ①단 — 묻지 않는다. ⌘Z 가 덮는 편집을 커밋하고 되돌릴 수 있다고만 알린다. */
  commitUndoable,
  /** ②단 — 못 되돌리지만 재구성 가능. 평범한 확인창. */
  confirmLossy,
  /** ③단 — 비가역. 확인창 + 빨간 확인 버튼. */
  confirmIrreversible,
} from './destructive';

/* ── io — 부수효과가 본질인 IO/다운로드/FS(내보내기·백업·복구·아카이빙·캘린더 서명) ── */
/* ── actions — 헤더 ⋯ 메뉴/팔레트가 호출하는 상태 변형 ────────────────────────
   ⚠ `backupAt` 은 읽기만 한다(메뉴가 라벨을 정하기 전에 묻는다).
   ⚠ `importVaultSubject` 는 입구가 둘(과목 탭·연동 탭)이지만 규칙은 하나다(H22).
   ⚠ `importAnkiDeck` 도 **같은 두 입구**의 같은 형태다 — C037 이 남아 있던 사본 둘을 모았다. */
export {
  planSignature,
  exportICS,
  exportJSON,
  backupToVault,
  restoreFromIDB,
  archiveOld,
  exportAnkiCards,
  exportSummaryNotes,
  hasCorruptSnapshot,
  downloadCorruptSnapshot,
  downloadFallbackSnapshot,
  toggleTheme,
  importJSON,
  undoLast,
  undoPoints,
  undoTo,
  backupAt,
  resetAll,
  seedDegreePlan,
  importAnkiDeck,
  importVaultSubject,
} from './actions';
