/* ============================================================
   interactions.ts — 탭 공유 인터랙션 프리미티브(오늘 탭 "FOCUS"에서 추출).
   세계적 수준의 "살아있는" 감각을 전 탭에 일관 적용하기 위한 단일 원천.
   • useCountUp — 마운트 시 0→target 카운트업(reduced-motion이면 즉시).
   • useHeroPointer — 포인터 추적: --mx/--my(스포트라이트) + --tiltX/Y(3D 틸트) CSS 변수 주입.
   짝이 되는 CSS는 ds.module.css의 .spotHost/.spotlight/.tiltable/.glow.
============================================================ */
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';

/** 마운트 시 0→target으로 부드럽게 카운트업(easeOutCubic). reduced-motion·SSR이면 즉시 target. */
export function useCountUp(target: number, ms = 750): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || typeof requestAnimationFrame === 'undefined') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 모션 자제 시 애니메이션 없이 즉시 최종값.
      setV(target);
      return;
    }
    let raf = 0;
    let startedAt = 0;
    const step = (now: number) => {
      if (!startedAt) startedAt = now;
      const t = Math.min(1, (now - startedAt) / ms);
      setV(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/** 포커스가 입력 요소(텍스트 편집)에 있으면 전역 단일키 단축키를 무시 — App·탭 로컬 키가 공유. */
export function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** 주(週) 이동 단일키 — ',' 이전 주 / '.' 다음 주(스케줄·리뷰 공용). 입력 중·수정자 조합은 무시.
 *  콜백은 ref로 최신을 읽어 리스너는 마운트당 1회만 등록. */
export function useWeekNavKeys(onPrev: () => void, onNext: () => void): void {
  const cb = useRef({ onPrev, onNext });
  useEffect(() => {
    cb.current = { onPrev, onNext }; // 렌더마다 최신 콜백 동기화(렌더 중 ref 쓰기 금지 규칙 준수)
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping()) return;
      if (e.key === ',') {
        e.preventDefault();
        cb.current.onPrev();
      } else if (e.key === '.') {
        e.preventDefault();
        cb.current.onNext();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
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
