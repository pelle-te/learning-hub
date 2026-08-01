/* ============================================================
   shell/index.ts — React 셸 서비스 배럴.
   탭 메타·아이콘·토스트/모달 호스트·명령형 ui/io/actions를 한 곳에서 노출 — app·features가 여기서 가져온다.
   (⚠ **옛 문구 정정** — 종전엔 여기 "boundaries 무관 디렉터리라 어느 레이어에서도 import 가능"이라
   적혀 있었다. H10(2026-07-26)이 그 예외를 폐기했다: `shell` 은 등록된 레이어이고,
   `components`·`store`·`lib`·`hooks` 는 **이 배럴을 import 할 수 없다**(토스트는 `shell/toast`
   잎 모듈로 따로 허용). 금지된 것을 기능으로 광고하는 문장이 남아 있으면 다음 사람이 그걸 믿는다.)
   액션 표면 3분할(각 함수는 정확히 한 곳): ui(토스트·모달·백업) / io(내보내기·FS·복구) / actions(상태 변형).
============================================================ */
import { toast, toastUndo } from './toast';
import { confirm } from './modal';
import * as A from './actions';

export { ToastHost } from './toast';
export { ModalHost } from './modal';
export { Icon } from './icons';
export {
  orderedTabs,
  tabByKey,
  routeLabelOf,
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
  /** 볼트 과목 임포트(W4 확인 포함) — 입구는 둘(과목 탭·연동 탭)이지만 규칙은 하나다(H22). */
  importVaultSubject: A.importVaultSubject,
};
