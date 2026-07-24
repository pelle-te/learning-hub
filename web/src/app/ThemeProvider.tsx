import { useEffect } from 'react';
import { useApp } from '@/store/useApp';
import { useUI } from '@/store/useUI';

/* ThemeProvider — state.theme를 <html data-theme>로, UI설정 accent를 <html data-accent>로 반영(설계도 §1-1).
   토큰 기반 CSS(styles/tokens.css :root[data-theme]/[data-accent])가 색을 입힌다. 다크 기본 + 라이트 1종 · 네온 4색. */
const META: Record<string, string> = { dark: '#050506', light: '#ffffff' };

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useApp((s) => s.state.theme);
  const setTheme = useApp((s) => s.setTheme);
  const accent = useUI((s) => s.ui.accent);
  const fxLite = useUI((s) => s.ui.fxLite);
  const themeAuto = useUI((s) => s.ui.themeAuto);
  /* 시스템 테마 따라가기 — 켜져 있는 동안 OS 값을 `state.theme` 에 **해소해서** 써넣는다.
     ⚠ data-theme 을 직접 쓰지 않는 이유: 그러면 정본(state.theme)과 화면이 갈려, 상단바
     테마 버튼이 "다크로 전환"이라 말하면서 라이트를 보여 주는 상태가 만들어진다. 앱 안에서
     테마의 답은 언제나 한 곳(state.theme)이고, 이 이펙트는 그 값을 *바꾸는* 입력원일 뿐이다.
     ⚠ 사용자가 수동으로 테마를 바꾸면(⋯·팔레트) 다음 OS 변경 때 다시 끌려간다 — 그게
     '따라가기'의 의미이고, 원치 않으면 설정에서 끄면 된다. */
  useEffect(() => {
    if (!themeAuto || typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-color-scheme: light)');
    const apply = () => setTheme(mq.matches ? 'light' : 'dark');
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [themeAuto, setTheme]);
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
