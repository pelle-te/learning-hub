/* ============================================================
   useUI.ts — UI 환경설정 스토어(Zustand+Immer). lib/uiState의 순수 boot/persist를 감싸고,
   변경 시 즉시 영속 + IDB 미러('ui' 키)한다. 앱 데이터(useApp)와 분리된 단일 출처.
   뷰 토글·팔레트 최근명령처럼 자주 바뀌지만 가벼운 설정 전용(디바운스 불필요).
============================================================ */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { storage } from '@/lib/kv';
import { idbMirror } from '@/lib/idb';
import { bootUI, persistUI, pushRecent, type Accent, type SchedView, type UIState } from '@/lib/uiState';
import { canPin, togglePin as togglePinPure } from '@/lib/pins';
import { shellNotifyPrime } from '@/lib/tauri';
import { setInspectDs } from '@/lib/visits';

export interface UIStore {
  ui: UIState;
  setSchedView: (v: SchedView) => void;
  setAccent: (a: Accent) => void;
  setFxLite: (on: boolean) => void;
  toggleNav: () => void;
  /** Anki 실시간 due 자동 새로고침 토글(2단계-A4 — 구 'lh:anki-autorefresh' 직접 접근을 대체). */
  setAnkiAutoRefresh: (on: boolean) => void;
  /** 시스템 테마 따라가기 토글 — 켜는 즉시 ThemeProvider가 현재 OS 값으로 맞춘다. */
  setThemeAuto: (on: boolean) => void;
  /** T-3 상주 트레이 토글(기기별). 다음 닫기부터 적용된다 — 닫기 가드가 **매번** 이 값을 읽는다. */
  setTrayResident: (on: boolean) => void;
  /** I030 점검 모드 — `ds` 를 주면 **그 날짜의** 방문·홉을 원장에서 뺀다. `null` 이면 끈다.
   *  ⚠ 날짜를 호출부가 준다(스토어가 시계를 들지 않는다 — 이 저장소의 날짜 관용구). */
  setInspecting: (ds: string | null) => void;
  /** N-17 — 레일 조립(숨김 목록·선호 순서). 판정은 `shell/railLayout` 이 소유하고 여기는 담기만 한다. */
  setRailLayout: (v: { hidden?: string[]; order?: string[] }) => void;
  /** A-13 — 오늘의 히어로를 확정/해제. `null` 이면 해제(평소 선택으로 돌아간다). */
  setFocusLock: (v: { ds: string; key: string } | null) => void;
  /** T-6 예약 알림 시각(`HH:MM`) 또는 `null`(끔). 바꾸면 **오늘 몫이 되살아난다**(아래 참조). */
  setReminderAt: (at: string | null) => void;
  /** 오늘 몫을 쓴 것으로 표시. ⚠ 알림 전송 **전에** 부른다(`useDailyReminder` 머리주석). */
  setReminderFired: (ds: string) => void;
  /** T-13 — 이 화면을 오늘 봤다고 표시. 같은 날 두 번째는 아무것도 안 한다(쓰기 낭비 방지). */
  markSeen: (key: string, ds: string) => void;
  /** T-26 — 지금 화면을 고정/해제. 상한 규칙은 `lib/pins.togglePin` 이 소유한다. */
  togglePin: (to: string, label: string, at: number) => void;
  /** OS 가 지금 말하는 테마(기기-로컬 · H9). `null` = 덮지 않음(정본 `state.theme` 이 보인다).
   *  ThemeProvider 가 감지 결과를 여기 싣고, 수동 선택(`actions.setThemeTo`)이 `null` 로 지운다. */
  setAutoTheme: (t: UIState['autoTheme']) => void;
  recordRecent: (id: string) => void;
  recentIds: () => string[];
  /** KV에서 다시 부팅(가져오기 복원 등 화면 밖 경로가 lh_ui_v1을 교체했을 때).
   *  flush 없음 — 방금 KV에 쓰인 값을 읽는 것이라 되쓰면 왕복만 늘어난다. */
  reloadUI: () => void;
}

export const useUI = create<UIStore>()(
  immer((set, get) => {
    const flush = () => {
      try {
        idbMirror(persistUI(storage, get().ui), 'ui');
      } catch {
        /* 저장 실패는 무시 — 메모리 상태는 계속 동작 */
      }
    };
    /* I030 — 부팅 값을 `lib/visits` 에 **한 번** 실어 준다. `lib/` 는 스토어를 import 할 수
       없으므로(레이어 단방향) 미러링 자리는 여기 하나다. 안 하면 앱을 껐다 켠 순간 점검
       모드가 조용히 풀리고, 그 세션의 순회가 다시 원장에 들어간다. */
    const booted = bootUI(storage);
    setInspectDs(booted.inspectDs);
    return {
      ui: booted,
      setSchedView(v) {
        set((s) => {
          s.ui.schedView = v;
        });
        flush();
      },
      setAccent(a) {
        set((s) => {
          s.ui.accent = a;
        });
        flush();
      },
      setFxLite(on) {
        set((s) => {
          s.ui.fxLite = on;
        });
        flush();
      },
      toggleNav() {
        set((s) => {
          s.ui.navCollapsed = !s.ui.navCollapsed;
        });
        flush();
      },
      setAnkiAutoRefresh(on) {
        set((s) => {
          s.ui.ankiAutoRefresh = on;
        });
        flush();
      },
      setTrayResident(on) {
        set((s) => {
          s.ui.trayResident = on;
        });
        flush();
      },
      setInspecting(ds) {
        set((s) => {
          s.ui.inspectDs = ds;
        });
        setInspectDs(ds); // 영속값과 `lib/visits` 의 사본은 **같은 자리에서** 움직인다
        flush();
      },
      /* N-17 — 둘을 한 setter 로 받는 이유: 순서 이동은 숨김을 안 건드리고 그 반대도 마찬가지라
         따로 두면 호출부가 매번 "다른 하나는 그대로"를 적어야 한다(부분 갱신이 기본이 맞다). */
      setFocusLock(v) {
        set((s) => {
          s.ui.focusLock = v;
        });
        flush();
      },
      setRailLayout(v) {
        set((s) => {
          if (v.hidden) s.ui.railHidden = v.hidden;
          if (v.order) s.ui.railOrder = v.order;
        });
        flush();
      },
      setReminderAt(at) {
        set((s) => {
          s.ui.reminderAt = at;
          /* ⚠ 시각을 바꾸면 **오늘 몫을 되살린다.** 안 그러면 "9시로 해 놨다가 오늘 이미
             받았는데 14시로 바꾸면 오늘은 안 온다"가 되고, 사용자는 설정이 안 먹었다고 읽는다.
             끄는 경우(`null`)엔 그대로 둔다 — 되살릴 대상이 없다. */
          if (at !== null) s.ui.reminderLastDs = null;
        });
        /* ⚠ **켤 때 알림 권한을 미리 받는다**(H-9 · 2026-08-06 감사). 종전엔 `shellNotifyPrime`
           을 부르는 곳이 **집중 세션뿐**이었다 — 집중을 한 번도 안 쓴 사용자는 권한이 없는
           채로 이 기능을 켜고, 첫 발화가 조용히 실패한다(그리고 그 실패가 안 보였다).
           권한 요청은 사용자가 **방금 알림을 켠 순간**이 가장 자연스러운 자리다. */
        if (at !== null) void shellNotifyPrime();
        flush();
      },
      setReminderFired(ds) {
        set((s) => {
          s.ui.reminderLastDs = ds;
        });
        flush();
      },
      togglePin(to, label, at) {
        if (!canPin(to, label)) return;
        const next = togglePinPure(get().ui.pins, { to, label, at });
        set((s) => {
          s.ui.pins = next;
        });
        flush();
      },
      markSeen(key, ds) {
        if (get().ui.seenAt[key] === ds) return; // 같은 날 재방문은 쓰기가 아니다
        set((s) => {
          s.ui.seenAt[key] = ds;
        });
        flush();
      },
      setThemeAuto(on) {
        set((s) => {
          s.ui.themeAuto = on;
          /* ⚠ 끄면 감지값도 함께 버린다(H9) — 남겨 두면 `resolveTheme` 이 무시하긴 하지만,
             다시 켜는 순간 **옛 OS 값이 한 프레임 비친다.** 토글이 자기 부산물을 소유한다. */
          if (!on) s.ui.autoTheme = null;
        });
        flush();
      },
      setAutoTheme(t) {
        set((s) => {
          s.ui.autoTheme = t;
        });
        flush();
      },
      recordRecent(id) {
        set((s) => {
          s.ui.recentCommands = pushRecent(s.ui.recentCommands, id);
        });
        flush();
      },
      recentIds() {
        return get().ui.recentCommands;
      },
      reloadUI() {
        const next = bootUI(storage);
        set((s) => {
          s.ui = next;
        });
        setInspectDs(next.inspectDs); // 가져오기 복원도 점검 모드를 되싣는다(부팅과 같은 계약)
      },
    };
  }),
);
