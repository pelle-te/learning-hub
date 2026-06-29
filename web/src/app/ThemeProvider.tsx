import { useEffect } from 'react';
import { useApp } from '@/store/useApp';

/* ThemeProvider — 스토어의 state.theme를 <html data-theme>로 반영(설계도 §2).
   토큰 기반 CSS(styles/tokens.css :root[data-theme])가 색을 입힌다. */
const META: Record<string, string> = { dark: '#0b0d12', light: '#ffffff', sepia: '#f3eadb' };

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useApp((s) => s.state.theme);
  useEffect(() => {
    const t = theme || 'light';
    document.documentElement.setAttribute('data-theme', t);
    const m = document.querySelector('meta[name=theme-color]');
    if (m) m.setAttribute('content', META[t] || '#ffffff');
  }, [theme]);
  return <>{children}</>;
}
