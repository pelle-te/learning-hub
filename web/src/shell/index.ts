/* ============================================================
   shell/index.ts — React 셸 서비스 배럴(레거시 어댑터 legacy/load 대체).
   탭 메타·아이콘·토스트/모달 호스트·명령형 ui/actions를 한 곳에서 노출 — app·features가 여기서 가져온다.
   (boundaries 무관 디렉터리라 어느 레이어에서도 import 가능 — 옛 legacy/load와 동일한 위치 규약.)
============================================================ */
import { toast, toastUndo } from './toast';
import { confirm, prompt } from './modal';
import * as A from './actions';

export { ToastHost } from './toast';
export { ModalHost } from './modal';
export { Icon } from './icons';
export { orderedTabs, groupOrder, tabByKey, GROUP_LABELS, GROUP_ICONS, type TabMeta } from './tabs';
export { paletteCommands, type PaletteCommand } from './palette';
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

/** 부수효과가 본질인 IO/다운로드/FS 액션(옛 legacy/load.legacyFns). */
export const legacyFns = {
  planSignature: A.planSignature,
  exportICS: A.exportICS,
  backupToVault: A.backupToVault,
  exportJSON: A.exportJSON,
  restoreFromIDB: A.restoreFromIDB,
  archiveOldData: A.archiveOld,
  exportAnkiCards: A.exportAnkiCards,
  exportSummaryNotes: A.exportSummaryNotes,
};

/** 헤더 ⋯ 메뉴/팔레트가 호출하는 데이터 액션(옛 legacy/load.actions). */
export const actions = {
  toggleTheme: A.toggleTheme,
  exportICS: A.exportICS,
  exportJSON: A.exportJSON,
  importJSON: A.importJSON,
  undoLast: A.undoLast,
  resetAll: A.resetAll,
};
