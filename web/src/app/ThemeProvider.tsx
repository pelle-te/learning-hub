import { useEffect } from 'react';
import { useApp } from '@/store/useApp';

/* ThemeProvider — 스토어의 state.theme를 <html data-theme>로 반영(설계도 §1-1).
   토큰 기반 CSS(styles/tokens.css :root[data-theme])가 색을 입힌다. 다크 기본 + 라이트 1종. */
const META: Record<string, string> = { dark: '#050506', light: '#ffffff' };

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useApp((s) => s.state.theme);
  useEffect(() => {
    const t = theme || 'dark';
    document.documentElement.setAttribute('data-theme', t);
    const m = document.querySelector('meta[name=theme-color]');
    if (m) m.setAttribute('content', META[t] || '#050506');
  }, [theme]);
  return <>{children}</>;
}
