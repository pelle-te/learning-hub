/* ============================================================
   shell/index.ts — React 셸 서비스 배럴.
   탭 메타·아이콘·토스트/모달 호스트·명령형 ui/io/actions를 한 곳에서 노출 — app·features가 여기서 가져온다.
   (⚠ **옛 문구 정정** — 종전엔 여기 "boundaries 무관 디렉터리라 어느 레이어에서도 import 가능"이라
   적혀 있었다. H10(2026-07-26)이 그 예외를 폐기했다: `shell` 은 등록된 레이어이고,
   `components`·`store`·`lib`·`hooks` 는 **이 배럴을 import 할 수 없다**(토스트는 `shell/toast`
   잎 모듈로 따로 허용). 금지된 것을 기능으로 광고하는 문장이 남아 있으면 다음 사람이 그걸 믿는다.)
   액션 표면 3분할(각 함수는 정확히 한 곳): ui(토스트·모달·백업) / io(내보내기·FS·복구) / actions(상태 변형).
============================================================ */
import { toast, toastUndoable } from './toast';
import { commitUndoable, confirmIrreversible, confirmLossy } from './destructive';
import * as A from './actions';

export { ToastHost } from './toast';
export { ModalHost } from './modal';
/* ⚠ **재수출이다** — 실체는 `components/Icon.tsx` 로 갔다(이모지 이식의 선행 · 그 파일 머리주석).
   `app/` 셋이 이 배럴로 쓰고 있어 경로를 안 깨뜨리려 남긴다. 새 소비처는 `@/components/Icon` 을 직접 쓸 것 —
   `components`·`phone` 은 이 배럴을 물 수 없다(H10·H27). */
export { Icon } from '@/components/Icon';
export {
  orderedTabs,
  tabByKey,
  routeLabelOf,
  routeLabelOfLocation,
  subTabGroupOf,
  hostTabKey,
  navGroups,
  destinations,
  GROUP_LABELS,
  type TabMeta,
  type NavGroup,
  type TabRole,
} from './tabs';
export { paletteCommands, type PaletteCommand } from './palette';
export { vtMove, type VtKind, type VtMove } from './vt';
export {
  captureSubjects,
  commitCapture,
  semanticPalette,
  contentSearch,
  verbsFor,
  type ContentHit,
  type HitVerb,
} from './actions';
export { recordRecent } from './recent';
export { NAV_SHORTCUTS, GLOBAL_SHORTCUTS, type NavShortcut } from './shortcuts';

/** 공용 UI(토스트/확인·프롬프트 모달/백업) — feature 탭이 쓰는 표면(옛 legacy/load.ui).
 *
 *  ⚠ **`toastUndo` 가 여기서 사라졌다**(근본① · 2026-08-01). 그것은 `msg` 를 받아
 *  `A.undoLast`(= `BACKUP_KEY` 스냅샷 복원)를 6.5초 창에 매다는 것이었는데, 두 가지가 동시에
 *  틀렸다: ① 스냅샷은 **손으로 부른 `backupNow()` 직전**의 상태라 "직전 편집"이 아니고(며칠 전일
 *  수 있었다) ② 그래서 삭제마다 `backupNow()` 를 불러야 했고 그 호출이 *가져오기·초기화*용
 *  스냅샷을 계속 덮어썼다. 지금은 전역 ⌘Z 가 **행 단위 pre-image** 로 덮는다(`lib/db/undoStack`).
 *  스냅샷은 남아 있고 그 소비처는 가져오기·초기화 토스트 둘뿐이다(사용자 결정). */
export const ui = {
  toast,
  /** 되돌릴 수 있는 편집을 알린다(⌘Z 힌트 포함) — 옛 `toastUndo` 자리. */
  toastUndoable,
  /* ⚠⚠ **`confirm` 이 여기서 사라졌다**(Q-13 · 2026-08-02). 대신 사다리 세 마디를 노출한다 —
     `shell/destructive.ts` 머리주석이 어느 단인지 고르는 기준의 SSOT 이고, **불변식 ⑨** 가
     `confirm(` 직접 호출을 0건으로 잠근다. 종전엔 "삭제 = 확인창"이 반사였고, 그래서 ⌘Z 가 이미
     덮는 편집(학기·과목 삭제)까지 물어보고 나서 "⌘Z 로 되돌리기"를 알렸다. */
  /** ①단 — 묻지 않는다. ⌘Z 가 덮는 편집을 커밋하고 되돌릴 수 있다고만 알린다. */
  commitUndoable,
  /** ②단 — 못 되돌리지만 재구성 가능. 평범한 확인창. */
  confirmLossy,
  /** ③단 — 비가역. 확인창 + 빨간 확인 버튼. */
  confirmIrreversible,
  backupNow: A.backupNow,
};

/** 부수효과가 본질인 IO/다운로드/FS 액션(내보내기·백업·복구·아카이빙·캘린더 서명). */
export const io = {
  planSignature: A.planSignature,
  exportICS: A.exportICS,
  exportJSON: A.exportJSON,
  backupToVault: A.backupToVault,
  restoreFromIDB: A.restoreFromIDB,
  archiveOld: A.archiveOld,
  exportAnkiCards: A.exportAnkiCards,
  exportSummaryNotes: A.exportSummaryNotes,
  hasCorruptSnapshot: A.hasCorruptSnapshot,
  downloadCorruptSnapshot: A.downloadCorruptSnapshot,
  downloadFallbackSnapshot: A.downloadFallbackSnapshot,
};

/** 헤더 ⋯ 메뉴/팔레트가 호출하는 상태 변형 액션. */
export const actions = {
  toggleTheme: A.toggleTheme,
  importJSON: A.importJSON,
  undoLast: A.undoLast,
  /** 되돌릴 백업이 있나·언제 것인가 — 메뉴가 라벨을 정하기 전에 묻는다(읽기만 한다). */
  backupAt: A.backupAt,
  resetAll: A.resetAll,
  /** 볼트 과목 임포트(W4 확인 포함) — 입구는 둘(과목 탭·연동 탭)이지만 규칙은 하나다(H22). */
  importVaultSubject: A.importVaultSubject,
};
