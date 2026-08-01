/* ============================================================
   useFocus — 전역 집중 세션(포모도로) 스토어. 컴포넌트 로컬이 아닌 앱 전역이라
   탭을 옮겨도 계속 돌고, 벽시계 endsAt 영속으로 새로고침에도 이어진다.
   표시·종료 감지는 상시 마운트된 FocusChip(TopBar)이 담당(단일 감시자).
============================================================ */
import { create } from 'zustand';
import { storage } from '@/lib/kv';
import { bootFocus, persistFocus, focusMinutes, type FocusSession } from '@/lib/focusState';
import { todayISO, minutesOfDay } from '@/lib/utils';
import type { SessionType } from '@/lib/types';
import { toast } from '@/shell/toast';
import { shellNotifyPrime } from '@/lib/tauri';
import { putResume, clearResume, resumeDevice, type ResumeCursor } from '@/lib/resume';
import { useApp } from './useApp';
import { selectTodayFocus } from './selectors';

export interface FocusTarget {
  ds: string;
  sid: string;
  type: SessionType;
  name: string;
  /** 세션 길이(분) */
  min: number;
  /** 블록 원래 분량(분) — 완료 토글에 전달 */
  blockMin: number;
  /** 복습이 겨냥한 챕터(ReviewRun 전용) — 완료 시 챕터 터치 기록(감사 #22) */
  chapter?: string;
}

interface FocusStore {
  session: FocusSession | null;
  /** 지정 블록으로 집중 세션 시작(알림 권한도 이때 지연 요청). */
  start: (t: FocusTarget) => void;
  /** '지금 할 일' 블록을 계산해 시작 — 상단 바·팔레트용. 대상 없으면 false. */
  startOnCurrent: () => boolean;
  /** 즉석 집중(ID-3) — 예약 블록 없이 임의 길이. `kind:'free'`라 완료 토글 경로에서 빠진다
   *  (유령 완료 방지). 볼트 정리·정독 같은 비예약 학습에 ⌘K 로 바로 타이머를 건다. */
  startFree: (min: number, label?: string) => void;
  /** 세션 중단(완료 아님). */
  stop: () => void;
  /** 회복 휴식(포모도로) — 완료 토글 없는 'break' 세션.
   *  ⚠ **P-8(2026-08-01)부터 자동이 아니다.** 종전엔 집중이 끝나면 `FocusChip` 이 곧바로
   *  `startBreak(5)` 를 불렀고, 그게 **사용자가 요청하지 않은 세션을 앱이 시작하는 유일한
   *  자리**였다(완료 토스트를 읽는 동안 이미 다음 타이머가 흐르고 있었다). 지금은 종료
   *  토스트의 선택지 하나다 — 없어진 것은 자동성이지 기능이 아니다. */
  startBreak: (min?: number) => void;
  /** 종료 처리 후 정리(FocusChip 전용 — 토스트/알림은 호출부가). */
  clear: () => void;
}

/** 커서 쓰기 두 줄 — 기기 id 가 없으면(미연결) 통째로 무동작. 스토어가 `useApp` 을 직접
 *  변형하는 유일한 자리라 여기 한 곳으로 모은다. */
function writeResume(cur: ResumeCursor): void {
  const id = resumeDevice();
  if (!id) return;
  useApp.getState().mutate((st) => putResume(st, id, cur));
}
function dropResume(): void {
  const id = resumeDevice();
  if (!id) return;
  useApp.getState().mutate((st) => clearResume(st, id));
}

export const useFocus = create<FocusStore>((set, get) => ({
  session: bootFocus(storage, Date.now()),

  start(t) {
    /* 알림 권한은 **시작할 때** 미리 받아 둔다 — 종료 알림(백그라운드에서도 보이게)용.
       ⚠⚠ 여기 웹 `Notification.requestPermission()` 이 있었는데 `tauri://` 오리진에서는
       `permission` 이 항상 `'denied'` 라 `=== 'default'` 조건이 **한 번도 참이 아니었다**
       (실측 2026-08-01 · P-8). 즉 이 두 줄은 죽은 코드였고, 그 결과 종료 알림도 죽어 있었다. */
    void shellNotifyPrime();
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
      chapter: t.chapter,
    };
    set({ session });
    persistFocus(storage, session);
    /* N-7 — 이어하기 커서(집중). 이 세션은 로컬 KV 에만 있어 기기를 넘지 않았다: 폰을 열면
       "PC 에서 뭘 하고 있었지"가 기억 재구성이었다. 클라우드 미연결이면 무동작이다. */
    // E26 — 종료 시각을 함께 실어 **다른 기기가** 남은 시간을 말할 수 있게 한다(읽기 전용).
    writeResume({ kind: 'focus', label: t.name, at: now, endsAt: session.endsAt });
    toast(`집중 ${t.min}분 시작 — 화이팅 🔥`, 'info');
  },

  startOnCurrent() {
    const state = useApp.getState().state;
    /* ⚠ 여기가 D-5 통일에서 빠져 있던 호출부다(H4) — `stat`·`today` 를 안 넘겨 급함 계산이
       죽어 있었고, 그래서 히어로와 ⌘K 집중이 **서로 다른 블록**을 가리켰다. 셀렉터가 재료를
       묶으므로 이제 그 실수가 구조적으로 불가능하다(근거는 `store/selectors.ts` 그 절). */
    const { focus } = selectTodayFocus(state, minutesOfDay(new Date()));
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

  startFree(min, label = '즉석 집중') {
    // 알림 권한은 시작할 때 미리(종료 축하 알림용) — start()와 동일. 근거는 그쪽 주석.
    void shellNotifyPrime();
    const m = Math.max(1, Math.round(min));
    const now = Date.now();
    const session: FocusSession = {
      endsAt: now + m * 60_000,
      total: m * 60,
      startedAt: now,
      ds: '', // 대상 블록 없음 — kind:'free'라 완료 토글에 안 들어감(유령 완료 방지)
      sid: '',
      type: 'new', // 자리표시(스키마 필수) — 완료 경로에서 걸러지므로 의미 없음
      name: label,
      blockMin: 0,
      kind: 'free',
    };
    set({ session });
    persistFocus(storage, session);
    toast(`집중 ${m}분 시작 — 화이팅 🔥`, 'info');
  },

  stop() {
    set({ session: null });
    persistFocus(storage, null);
    dropResume(); // 중단했으면 이어할 것이 없다 — 남겨 두면 다른 기기에 유령 커서가 뜬다
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
    dropResume(); // 세션 종료 = 이어할 것 없음(휴식은 커서를 만들지 않는다)
  },
}));
