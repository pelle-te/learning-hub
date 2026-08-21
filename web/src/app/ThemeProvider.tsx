import { useEffect } from 'react';
import { useTheme } from '@/store/selectors';
import { useUI } from '@/store/useUI';

/* ThemeProvider — state.theme를 <html data-theme>로, UI설정 accent를 <html data-accent>로 반영(설계도 §1-1).
   토큰 기반 CSS(styles/tokens.css :root[data-theme]/[data-accent])가 색을 입힌다. 다크 기본 + 라이트 1종 · 네온 4색. */
/* ⚠⚠ **`theme-color` 는 손으로 적지 않고 `--bg` 에서 파생한다**(D5 · 2026-08-01).

   여기 표가 `light: '#ffffff'` 라 적혀 있었는데 `tokens.css` 의 라이트 `--bg` 는 **`#fafbfc`** 다
   (다크는 `#050506` 로 일치했다). 그 차이만큼 OS 크롬 틴트와 페이지 배경 사이에 **얇은 이음매**가
   보였다 — 라이트에서만, 그리고 아무도 안 쓰는 색이라 사본이 갈린 줄도 몰랐다.
   손으로 벤 색은 원본이 바뀌어도 안 따라온다. 파생하면 그 부류가 원천 봉쇄된다(절대규칙 #3 의
   "색은 저장값이 아니다"가 여기에도 그대로 걸린다). 같은 관용구가 `Settings.readAccentPreviews`
   에 이미 있다.
   ⚠ 폴백을 남기는 이유: `getComputedStyle` 이 빈 문자열을 줄 수 있는 시점(SSR·초기 프레임)이
   있고, 그때 `content=""` 를 쓰면 브라우저가 기본 크롬으로 떨어진다. */
const META_FALLBACK: Record<string, string> = { dark: '#050506', light: '#fafbfc' };

function bgColorFor(theme: string): string {
  const root = document.documentElement;
  return getComputedStyle(root).getPropertyValue('--bg').trim() || META_FALLBACK[theme] || '#050506';
}

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
    // ⚠ 속성을 먼저 세운 **뒤** 읽는다 — 같은 이펙트 안이라 계산 스타일이 이미 새 테마다.
    if (m) m.setAttribute('content', bgColorFor(theme));
  }, [theme]);
  useEffect(() => {
    document.documentElement.setAttribute('data-accent', accent || 'violet');
  }, [accent]);
  useEffect(() => {
    /* 발광 효과 줄이기 — `data-fx="lite"` 면 CSS 가 오라 애니를 끈다.
       ⚠ 종전엔 «AmbientCanvas 도 정지» 했는데 그 캔버스가 은퇴했다(I045) — 지금 이 노브가 끄는
       것은 **CSS 애니뿐**이다. 배경은 이제 정적 그라데이션이라 끌 것이 없다. */
    if (fxLite) document.documentElement.setAttribute('data-fx', 'lite');
    else document.documentElement.removeAttribute('data-fx');
  }, [fxLite]);
  return <>{children}</>;
}
