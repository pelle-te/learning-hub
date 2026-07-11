/* ============================================================
   interactions.ts — 탭 공유 인터랙션 프리미티브(오늘 탭 "FOCUS"에서 추출).
   세계적 수준의 "살아있는" 감각을 전 탭에 일관 적용하기 위한 단일 원천.
   • useCountUp — 현재 표시값→target 카운트업(reduced-motion이면 즉시).
   • useHeroPointer — 포인터 추적: --mx/--my(스포트라이트) + --tiltX/Y(3D 틸트) CSS 변수 주입.
   짝이 되는 CSS는 ds.module.css의 .spotHost/.spotlight/.tiltable/.glow.
============================================================ */
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';

/** 현재 표시값→target으로 부드럽게 카운트업/다운(easeOutCubic). reduced-motion·SSR이면 즉시 target.
 *  target 변경 시 0이 아니라 *현재값*에서 트윈 — 데이터 갱신마다 KPI가 0으로 튀는 깜빡임 방지(L-8). */
export function useCountUp(target: number, ms = 750): number {
  const [v, setV] = useState(0);
  const vRef = useRef(0); // 현재 표시값 미러(deps에 넣지 않고 애니메이션 시작점으로 읽기 위함)
  useEffect(() => {
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
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
    return d.getHours() * 60 + d.getMinutes();
  });
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNowMin(d.getHours() * 60 + d.getMinutes());
    };
    const id = setInterval(tick, 60_000);
    const onVis = () => {
      if (document.visibilityState === 'visible') tick(); // 백그라운드 복귀 시 즉시 캐치업.
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  return nowMin;
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
