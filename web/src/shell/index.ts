/* ============================================================
   shell/index.ts — React 셸 서비스 배럴.
   탭 메타·아이콘·토스트/모달 호스트·명령형 ui/io/actions를 한 곳에서 노출 — app·features가 여기서 가져온다.
   (boundaries 무관 디렉터리라 어느 레이어에서도 import 가능.)
   액션 표면 3분할(각 함수는 정확히 한 곳): ui(토스트·모달·백업) / io(내보내기·FS·복구) / actions(상태 변형).
============================================================ */
import { toast, toastUndo } from './toast';
import { confirm, prompt } from './modal';
import * as A from './actions';

export { ToastHost } from './toast';
export { ModalHost } from './modal';
export { Icon } from './icons';
export {
  orderedTabs,
  tabByKey,
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

/** 공용 UI(토스트/확인·프롬프트 모달/백업) — feature 탭이 쓰는 표면(옛 legacy/load.ui). */
export const ui = {
  toast,
  confirm,
  prompt,
  backupNow: A.backupNow,
  toastUndo: (msg: string) => toastUndo(msg, A.undoLast),
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
};
