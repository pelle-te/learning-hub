import { useEffect } from 'react';
import { useApp } from '@/store/useApp';

/* ThemeProvider — 스토어의 state.theme를 <html data-theme>로 반영(설계도 §2).
   레거시 applyTheme도 같은 속성을 쓰므로 단일 원천(테마)이 어느 경로로 바뀌든 일치한다.
   토큰 기반 CSS(legacy/style.css :root[data-theme])가 색을 입힌다. */
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
