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
   ⚠⚠ **여기 적혀 있던 폴백 근거가 거짓이었다**(V033 · 2026-08-22 코드 축 실행). 종전 문구는
   *"`getComputedStyle` 이 빈 문자열을 줄 수 있는 시점(**SSR·초기 프레임**)이 있고"* 였는데,
   `lib/ledger.ts:51-63` 이 정반대를 못박아 뒀다: *"'SSR 안전'·'토큰 로드 전'은 **이 앱에 없는
   상황**이다(토큰 CSS 는 `main.tsx` 의 첫 import 다)."* 그리고 이 함수는 `useEffect` 안에서만
   불린다 — 그 시점엔 토큰이 이미 서 있다.

   즉 `getPropertyValue('--bg')` 가 빈 문자열을 주는 **실제 조건은 «그 토큰이 없다» 하나**이고,
   그건 폴백이 덮을 일이 아니라 **시끄럽게 실패해야 할 일**이다 — `lib/ledger.ts` 가 기록한
   그 사고(`--panel-2` 하이픈 오타 → 죽은 hex 로 조용히 렌더 → 라이트에서 의미 역전이 몇 달)와
   같은 형태다. 집행자는 이미 있다: **불변식 ④**(JS 가 읽는 토큰이 `tokens.css` 에 있는가).

   ⚠ **그래서 폴백을 지금 지우지는 않았다** — 지우면 토큰 소실 시 `content=""` 가 되어 OS 기본
   크롬으로 떨어지고, 그 트레이드오프는 «시끄럽게 실패»의 형태를 고르는 **별개 판단**이다.
   `scripts/_hexcheck.mjs` 의 원장에 사유+만료일(2026-11-30)로 올려 뒀다 — 그날 다시 판단한다. */
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
