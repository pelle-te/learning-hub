import { useEffect } from 'react';
import { useTheme } from '@/store/selectors';
import { useUI } from '@/store/useUI';

/* ThemeProvider — state.theme를 <html data-theme>로, UI설정 accent를 <html data-accent>로 반영(설계도 §1-1).
   토큰 기반 CSS(styles/tokens.css :root[data-theme]/[data-accent])가 색을 입힌다. 다크 기본 + 라이트 1종 · 네온 4색. */
const META: Record<string, string> = { dark: '#050506', light: '#ffffff' };

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const setAutoTheme = useUI((s) => s.setAutoTheme);
  const accent = useUI((s) => s.ui.accent);
  const fxLite = useUI((s) => s.ui.fxLite);
  const themeAuto = useUI((s) => s.ui.themeAuto);
  /* 시스템 테마 따라가기 — 켜져 있는 동안 OS 값을 **기기-로컬** `ui.autoTheme` 에 싣는다.
     ⚠⚠ 예전엔 이 값을 `state.theme`(정본)에 써넣었다. 그게 H9 다 — 정본은 D1 로 동기화되므로
     PC 의 해질녘 자동 전환이 **폰 테마까지 뒤집었다.** "따라갈까 말까"는 기기별 취향이라고
     `uiState` 가 적어 놓고, 그 취향의 *결과*를 전 기기에 뿌리고 있었다.
     ⚠ data-theme 을 직접 쓰지 않는 것은 그대로다: 화면이 보는 답은 언제나 한 값(`useTheme`)이고,
     이 이펙트는 그 해소의 **입력 하나**를 채울 뿐이다(상단바 버튼이 거짓말하지 않는 이유).
     ⚠ 수동으로 테마를 바꾸면(⋯·팔레트) 그 선택이 보이고, 다음 OS 변경 때 다시 끌려간다 — 그게
     '따라가기'의 의미이고(사용자가 못박은 계약 · 절대규칙 #4), 원치 않으면 설정에서 끄면 된다. */
  useEffect(() => {
    if (!themeAuto || typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-color-scheme: light)');
    const apply = (): void => setAutoTheme(mq.matches ? 'light' : 'dark');
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [themeAuto, setAutoTheme]);
  useEffect(() => {
    // `useTheme` 이 이미 해소된 한 값을 준다(널 폴백은 그 안에 있다).
    document.documentElement.setAttribute('data-theme', theme);
    const m = document.querySelector('meta[name=theme-color]');
    if (m) m.setAttribute('content', META[theme] || '#050506');
  }, [theme]);
  useEffect(() => {
    document.documentElement.setAttribute('data-accent', accent || 'violet');
  }, [accent]);
  useEffect(() => {
    // 발광 효과 줄이기 — data-fx="lite"면 CSS가 오라 애니를 끄고 AmbientCanvas가 정지(상시 GPU 절감).
    if (fxLite) document.documentElement.setAttribute('data-fx', 'lite');
    else document.documentElement.removeAttribute('data-fx');
  }, [fxLite]);
  return <>{children}</>;
}
