/* ============================================================
   interactions.ts — 탭 공유 인터랙션 프리미티브(오늘 탭 "FOCUS"에서 추출).
   세계적 수준의 "살아있는" 감각을 전 탭에 일관 적용하기 위한 단일 원천.
   • useCountUp — 현재 표시값→target 카운트업(reduced-motion이면 즉시).
   • useHeroPointer — 포인터 추적: --mx/--my(스포트라이트) + --tiltX/Y(3D 틸트) CSS 변수 주입.
   짝이 되는 CSS는 styles/ds.css의 .ds-spotHost/.ds-spotlight/.ds-glow.
============================================================ */
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { minutesOfDay } from '@/lib/utils';
import { prefersReducedMotion } from '@/lib/motion';
import { onVisible, onHidden } from '@/lib/visibility';
import { useKeymap } from './useKeymap';

/** 현재 표시값→target으로 부드럽게 카운트업/다운(easeOutCubic). reduced-motion·SSR이면 즉시 target.
 *  target 변경 시 0이 아니라 *현재값*에서 트윈 — 데이터 갱신마다 KPI가 0으로 튀는 깜빡임 방지(L-8). */
export function useCountUp(target: number, ms = 750): number {
  const [v, setV] = useState(0);
  const vRef = useRef(0); // 현재 표시값 미러(deps에 넣지 않고 애니메이션 시작점으로 읽기 위함)
  useEffect(() => {
    // ⚠ 판정은 `lib/motion` 하나다(H19) — 여기서 matchMedia 를 직접 부르면 앱 설정('발광 효과
    //    줄이기')을 모르는 사본이 된다. 그 사본들이 설정 라벨을 거짓으로 만들고 있었다.
    const reduce = prefersReducedMotion();
    if (reduce || typeof requestAnimationFrame === 'undefined') {
      vRef.current = target;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 모션 자제 시 애니메이션 없이 즉시 최종값.
      setV(target);
      return;
    }
    const from = vRef.current; // 이번 트윈의 출발점 = 현재 화면에 보이는 값
    let raf = 0;
    let startedAt = 0;
    const step = (now: number) => {
      if (!startedAt) startedAt = now;
      const t = Math.min(1, (now - startedAt) / ms);
      const val = from + (target - from) * (1 - Math.pow(1 - t, 3));
      vRef.current = val;
      setV(val);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/** 현재 시각을 '자정 이후 분(0~1439)'으로 — 분단위 틱(60s)으로 갱신, 백그라운드 복귀 시 즉시 캐치업.
 *  '지금' 라인·⏱ 지금 행이 로드 시각에 멈추지 않도록(스케줄·일과 공유 · 3중 중복 이펙트 제거). */
export function useNowMin(): number {
  const [nowMin, setNowMin] = useState(() => {
    const d = new Date();
    return minutesOfDay(d);
  });
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNowMin(minutesOfDay(d));
    };
    const id = setInterval(tick, 60_000);
    const off = onVisible(tick); // 백그라운드 복귀 시 즉시 캐치업.
    return () => {
      clearInterval(id);
      off();
    };
  }, []);
  return nowMin;
}

/** 주기적으로 **리렌더만** 트리거하는 틱 — 화면의 상대시각(⏱ mm:ss·now 라인)이 로드 시점에
 *  멈추지 않게. period 는 호출부가 상황에 맞게 준다(포모도로 세션 중=1s · 평시=30s). 백그라운드에선
 *  멈추고 복귀 시 즉시 캐치업. 카운터 값은 리렌더 트리거일 뿐이라 읽지도 반환하지도 않는다
 *  (그래서 종전의 `% 86400` 상한도 불필요 — 단조 증가로 충분하다). */
export function useAdaptiveTick(periodMs: number): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    const bump = (): void => setTick((t) => t + 1);
    const start = (): void => {
      if (id == null) id = setInterval(bump, periodMs);
    };
    const stop = (): void => {
      if (id != null) {
        clearInterval(id);
        id = null;
      }
    };
    start();
    const offHide = onHidden(stop);
    const offShow = onVisible(() => {
      bump(); // 복귀 즉시 캐치업
      start();
    });
    return () => {
      stop();
      offHide();
      offShow();
    };
  }, [periodMs]);
}

/** 언마운트 시 미커밋 초안 flush — fn을 이펙트에서 ref에 담아(렌더 중 ref쓰기 금지·React Compiler refs 준수)
 *  언마운트 클린업에서 1회 호출. ArticlePractice·BookShelf의 상이한 두 구현을 한 방식으로 통일(SR-16). */
export function useFlushOnUnmount(fn: () => void): void {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn; // 렌더마다 최신 콜백 동기화(이펙트서 할당)
  });
  useEffect(() => () => ref.current(), []);
}

/** 포커스가 입력 요소(텍스트 편집)에 있으면 전역 단일키 단축키를 무시 — App·탭 로컬 키가 공유. */
export function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** 주 이동 `,`/`.` — **N-16 이후 `useKeymap` 위에 얹힌 얇은 래퍼**다.
 *  옛 구현은 자기 리스너를 직접 걸었고, 그래서 이 키가 *어느 화면에 사는지* 앱이 몰랐다
 *  (치트시트는 전역이라 적었지만 실제론 2화면뿐 = 12개 탭에서 거짓말). 이제 등록과 설명이
 *  같은 선언에서 나오므로 치트시트가 "지금 이 화면" 섹션에 스스로 뜬다. */
export function useWeekNavKeys(onPrev: () => void, onNext: () => void): void {
  useKeymap(
    '이 화면 · 주 이동',
    [
      { keys: [','], display: ',', label: '이전 주' },
      { keys: ['.'], display: '.', label: '다음 주' },
    ].map((b, i) => ({ ...b, run: i === 0 ? onPrev : onNext })),
  );
}

/** 포인터 추적 — 패널 위 커서 위치를 CSS 변수로(스포트라이트 --mx/--my, 3D 틸트 --tiltX/Y).
    tilt=0이면 틸트 없이 스포트라이트만(큰 보드/편집 패널용). ds.spotHost와 함께 사용. */
export function useHeroPointer<T extends HTMLElement = HTMLDivElement>(tilt = 6) {
  const ref = useRef<T>(null);
  const onMouseMove = (e: ReactMouseEvent<T>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    el.style.setProperty('--mx', `${px * 100}%`);
    el.style.setProperty('--my', `${py * 100}%`);
    if (tilt) {
      el.style.setProperty('--tiltY', `${(px - 0.5) * tilt}deg`);
      el.style.setProperty('--tiltX', `${-(py - 0.5) * tilt}deg`);
    }
  };
  const onMouseLeave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty('--tiltX', '0deg');
    el.style.setProperty('--tiltY', '0deg');
  };
  return { ref, onMouseMove, onMouseLeave };
}
