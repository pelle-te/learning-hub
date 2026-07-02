/* ============================================================
   useFocus — 전역 집중 세션(포모도로) 스토어. 컴포넌트 로컬이 아닌 앱 전역이라
   탭을 옮겨도 계속 돌고, 벽시계 endsAt 영속으로 새로고침에도 이어진다.
   표시·종료 감지는 상시 마운트된 FocusChip(TopBar)이 담당(단일 감시자).
============================================================ */
import { create } from 'zustand';
import { storage } from '@/lib/kv';
import { bootFocus, persistFocus, todayEntries, pickFocus, focusMinutes, type FocusSession } from '@/lib/focusState';
import { todayISO } from '@/lib/utils';
import type { SessionType } from '@/lib/types';
import { toast } from '@/shell/toast';
import { useApp } from './useApp';
import { selectSchedule } from './selectors';

export interface FocusTarget {
  ds: string;
  sid: string;
  type: SessionType;
  name: string;
  /** 세션 길이(분) */
  min: number;
  /** 블록 원래 분량(분) — 완료 토글에 전달 */
  blockMin: number;
}

interface FocusStore {
  session: FocusSession | null;
  /** 지정 블록으로 집중 세션 시작(알림 권한도 이때 지연 요청). */
  start: (t: FocusTarget) => void;
  /** '지금 할 일' 블록을 계산해 시작 — 상단 바·팔레트용. 대상 없으면 false. */
  startOnCurrent: () => boolean;
  /** 세션 중단(완료 아님). */
  stop: () => void;
  /** 집중 종료 직후 자동 휴식(포모도로 회복 구간) — 완료 토글 없는 'break' 세션. */
  startBreak: (min?: number) => void;
  /** 종료 처리 후 정리(FocusChip 전용 — 토스트/알림은 호출부가). */
  clear: () => void;
}

export const useFocus = create<FocusStore>((set, get) => ({
  session: bootFocus(storage, Date.now()),

  start(t) {
    // 알림 권한은 첫 시작 때 지연 요청 — 종료 알림(백그라운드에서도 보이게)용.
    if (typeof Notification !== 'undefined' && Notification.permission === 'default')
      void Notification.requestPermission();
    const now = Date.now();
    const session: FocusSession = {
      endsAt: now + t.min * 60_000,
      total: t.min * 60,
      startedAt: now,
      ds: t.ds,
      sid: t.sid,
      type: t.type,
      name: t.name,
      blockMin: t.blockMin,
    };
    set({ session });
    persistFocus(storage, session);
    toast(`집중 ${t.min}분 시작 — 화이팅 🔥`, 'info');
  },

  startOnCurrent() {
    const state = useApp.getState().state;
    const entries = todayEntries(state, selectSchedule(state));
    const now = new Date();
    const { focus } = pickFocus(entries, now.getHours() * 60 + now.getMinutes());
    if (!focus) {
      toast('지금 시작할 학습 블록이 없어요 — 학습 항목을 확인하세요.', 'warn');
      return false;
    }
    get().start({
      ds: todayISO(state),
      sid: focus.it.sid,
      type: focus.it.type,
      name: focus.it.name,
      min: focusMinutes(focus),
      blockMin: focus.it.min,
    });
    return true;
  },

  stop() {
    set({ session: null });
    persistFocus(storage, null);
  },

  startBreak(min = 5) {
    const now = Date.now();
    const session: FocusSession = {
      endsAt: now + min * 60_000,
      total: min * 60,
      startedAt: now,
      ds: '',
      sid: '',
      type: 'new', // 자리표시 — kind:'break'라 완료 토글 경로에 안 들어감
      name: '휴식',
      blockMin: 0,
      kind: 'break',
    };
    set({ session });
    persistFocus(storage, session);
    toast(`☕ ${min}분 휴식 — 끝나면 알려드려요.`, 'info');
  },

  clear() {
    set({ session: null });
    persistFocus(storage, null);
  },
}));
