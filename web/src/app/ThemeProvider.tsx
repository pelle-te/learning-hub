import { useEffect } from 'react';
import { useApp } from '@/store/useApp';
import { useUI } from '@/store/useUI';

/* ThemeProvider — state.theme를 <html data-theme>로, UI설정 accent를 <html data-accent>로 반영(설계도 §1-1).
   토큰 기반 CSS(styles/tokens.css :root[data-theme]/[data-accent])가 색을 입힌다. 다크 기본 + 라이트 1종 · 네온 4색. */
const META: Record<string, string> = { dark: '#050506', light: '#ffffff' };

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useApp((s) => s.state.theme);
  const accent = useUI((s) => s.ui.accent);
  const fxLite = useUI((s) => s.ui.fxLite);
  useEffect(() => {
    const t = theme || 'dark';
    document.documentElement.setAttribute('data-theme', t);
    const m = document.querySelector('meta[name=theme-color]');
    if (m) m.setAttribute('content', META[t] || '#050506');
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
