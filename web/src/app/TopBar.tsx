import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { actions, io, Icon } from '@/shell';
import { useTheme } from '@/store/selectors';
import { usePageChrome } from '@/store/usePageChrome';
import { useOverlay } from '@/store/useOverlay';
import { MOD_LABEL, MOD_K_LABEL } from '@/lib/platform';
import { agoLabel } from '@/lib/utils';
import FocusChip from './FocusChip';
import type { IconName } from '@/lib/iconPaths';

/* TopBar — 에디토리얼 헤더(설계도 §1-2). 현 Header(.top) 대체.
   워드마크 + 컨텍스트 서브 + 우측 액션 칩(⌘K·테마·⋯ 데이터 메뉴). 설정 진입은 레일 하단 ⚙가 담당.
   데이터 액션은 네이티브 shell/actions 호출(테마·내보내기·가져오기·되돌리기·초기화).
   ⋯ 메뉴는 바깥 클릭/Esc로 닫힘. ⌘K는 팔레트 열기(전역 단축키는 CommandPalette가 소유).

   ── C-7 셸 티어 3/5 이식(Tailwind) ──────────────────────────────────────────────
   ⚠ 전제 두 가지(§15-5·§15-6 · 둘 다 실사고에서 나왔다):
   ① raw `<button>` 은 **언레이어드 전역 `button{}`**(styles/global/components.css)에서 배경·보더·
      radius·padding·font-size(13px)·font-family 를 받는다. 유틸은 `@layer utilities` 라 그걸 못
      이기므로 해당 속성엔 `!` 가 필수다.
   ② `<h1>` 도 같다 — 언레이어드 전역 `h1{}`(base.css)이 font-size 22px·letter-spacing·font-weight 를
      건다. 워드마크는 21px/-0.03em/900 이라 전부 `!` 로 이겨야 한다(`!` 없이 두면 **조용히 22px**).
   그리고 `.rv small`(자손 셀렉터)은 규약 4로 옮길 수 없어 **값을 만드는 11곳**(alloc·degree·items×2·
   review·schedule×3·stats×2·today)이 `<small>` 에 직접 클래스를 준다 — 소비자가 아니라 생산자가
   자기 스타일을 소유하는 쪽이 정직하다. `TopBar.module.css` 삭제.
   ⚠ 메뉴(`.menu`/`.menu-sep`/`.menu-danger`)는 **전역 앱크롬 클래스**라 이 티어에서 건드리지 않는다
   (전역 요소 규칙은 맨 마지막에 함께 — App 의 `skip-link` 와 같은 취급). */
const BAR =
  'relative z-[var(--z-dropdown)] flex flex-none items-start gap-5.5 px-6.5 pt-5.5 pb-4 [view-transition-name:app-header] max-mobile:flex-wrap max-mobile:items-center max-mobile:gap-2.5 max-mobile:px-3.5 max-mobile:pt-3 max-mobile:pb-2.5';
// 워드마크 — 스택 대문자(700↓ 단일행), '허브'는 네온. 전역 h1{} 을 이기는 지점만 `!`.
const WORDMARK =
  'text-wordmark! leading-flat font-black! tracking-wordmark! uppercase max-mobile:text-wordmark-sm! max-mobile:leading-none';
const MARK_PART = 'block max-mobile:inline';
const SUB = 'mt-1.75 text-sm leading-snug tracking-topbar-sub text-mut max-mobile:hidden';
// 컨텍스트 리드아웃 — 페이지가 주입(진행률·연속·마감).
const READOUTS = 'mr-2 flex items-start gap-7.5 self-center max-mobile:hidden';
const READOUT = 'flex flex-col gap-1';
const RL = 'text-2xs font-bold tracking-readout text-mut uppercase';
const RV = 'text-readout-num leading-none font-extrabold tracking-readout-num tabular-nums';
/* 값 없음(—)은 강조 대신 뮤트 — 액센트 대시가 '검열 바'처럼 읽히는 것 방지. ⚠ 색/그림자는
   `racc` 와 **같은 속성**이라 두 클래스를 겹쳐 붙이면 레이어 순서로 갈린다(SubTabs 관용구):
   붙일 조합을 미리 고른다. */
/* W21 — 값의 강조는 **의미 토큰**이 진다: 다크는 네온(`text-shadow-readout` → `--emph-value`),
   라이트는 그림자가 `none` 이고 중량(`--emph-value-weight`)이 대신 무게를 준다. 한 클래스가
   두 테마에서 **다른 기전**으로 같은 말을 한다 — 라이트가 정체성 층을 3분의 1로 줄인 판본이
   되지 않게 하는 것이 이 항목의 전부다(근거는 `tokens.css` 의 `--emph-value` 머리주석). */
const RV_ACC = 'text-acc text-shadow-readout font-[var(--emph-value-weight)]';
/* 화면의 첫째 수치(N-15) — 44px. 리드아웃(30px)과 **크기로** 위계를 만든다: 이 자리가 비면
   종전 화면 그대로고, 채우면 그 탭에서 가장 큰 글자가 된다(원칙 2 의 물리적 표현). */
const PRIMARY = 'flex flex-col gap-1 max-mobile:hidden';
const PV =
  'text-primary-num leading-none font-[var(--emph-value-weight)] tracking-readout-num text-acc tabular-nums text-shadow-readout';
const PU = 'text-lg leading-none font-bold text-mut';
// Q-10 — `text-mut` 만으로 충분하다. 위에 얹던 `opacity-55` 는 이미 흐린 색을 **한 번 더**
// 깎아 '—' 를 사실상 안 보이게 했다(값 부재를 못 읽으면 리드아웃이 거짓말이 된다).
const RV_NULL = 'text-mut';
const ACTIONS = 'flex items-center gap-2 self-center';
/* HUD 칩 버튼 — 각진 헤어라인. 전역 button{} 을 이기는 속성 전부 `!` · 폼 컨트롤이라 leading-auto.
   ⚠ **색·보더색·자간은 base 에 두지 않는다**(SubTabs 와 같은 관용구 · 이식 중 실제로 물렸다):
   `bg-transparent!` 와 `bg-acc!` 처럼 **같은 속성 유틸을 겹쳐 붙이면** 클래스 나열 순서가 아니라
   Tailwind 가 방출한 순서로 갈려 주 액션이 통짜로 죽는다(네온 필이 투명 칩으로 렌더됐다).
   변형(plain/fill)이 자기 속성을 통째로 소유하게 나눈다. */
const BTN_BASE =
  'inline-flex min-h-8.5 items-center justify-center gap-1.5 rounded-sm! border! px-3.25! py-0! text-sm! leading-auto font-bold! transition-colors duration-fast ease-[var(--ease)] focus-visible:outline-2 focus-visible:outline-acc focus-visible:outline-offset-2 max-mobile:min-h-10';
const BTN_PLAIN =
  'border-line! bg-transparent! tracking-chip! text-ink! hover:border-line-acc-strong! hover:bg-panel2!';
/* 주 액션 — "네온 채움 필"(데모의 "지금 시작 →"). **2026-07-24 에 되살렸다**(사용자 결정 · §15-9).
   내력: `TopBar.module.css` 는 `.fill`(98행)을 `.btn`(112행) **앞에** 뒀는데 둘 다 클래스 하나짜리
   같은 명시도라 뒤에 온 `.btn` 이 이겼다 — background·border-color·color 세 속성이 통째로 죽고
   box-shadow(발광)와 자간만 살아남아, 헤더 주 액션은 지금까지 '발광하는 평칩'으로 렌더돼 왔다.
   C-7 이식 시점엔 절대규칙 #4(이식이 몰래 하는 디자인 변경 금지)에 따라 관측된 렌더를 재현만 하고
   결함으로 기록해 뒀고, 이제 사용자 결정으로 원래 의도대로 채운다.
   ⚠ BTN_PLAIN 을 파생해 쓰지 않는다 — 배경·색·보더색을 두 문자열이 나눠 가지면 클래스 나열
   순서가 아니라 Tailwind 방출 순서로 갈린다(§15-8 ②, 이 파일에서 실제로 물렸던 그 결함). */
const BTN_FILL =
  // hover 의 brightness(1.06)는 사다리 밖이라 내장 칸(105)으로 반올림(규약 2 · hover 는 스냅샷 밖).
  'border-acc! bg-acc! tracking-fill! text-on-acc! shadow-fill-chip hover:brightness-105';
const BTN = `${BTN_BASE} ${BTN_PLAIN}`;
// 정사각 아이콘 전용 버튼(테마·설정·메뉴).
const BTN_ICON = `${BTN} w-8.5 px-0! max-mobile:w-10`;

const THEME_ICON: Record<'light' | 'dark', IconName> = { light: 'sun', dark: 'moon' };
const THEME_NEXT: Record<string, string> = { light: '다크', dark: '라이트' };
const THEME_NAME: Record<string, string> = { light: '라이트', dark: '다크' };

export default function TopBar() {
  // Q-12 — 내비 스택. 라우터가 소유한 히스토리를 그대로 쓴다(자체 스택을 만들면 딥링크·⌘K·
  // 리다이렉트가 만든 이동을 놓친다).
  const navigate = useNavigate();
  // 팔레트·치트시트 열기는 스토어가 소유 — 예전엔 전자가 App 에서 내려오는 prop, 후자가
  // `window.dispatchEvent('lh:open-shortcuts')` 라는 DOM 이벤트 우회였다(같은 일, 두 배선).
  const openPalette = useOverlay((s) => s.setPalette);
  const openHelp = useOverlay((s) => s.setHelp);
  // ⚠ 정본(`state.theme`)이 아니라 **해소된** 테마다(H9) — 시스템 따라가기가 켜져 있으면
  //    정본과 화면이 다를 수 있고, 그때 정본을 읽으면 이 버튼이 반대 방향을 말한다.
  const theme = useTheme();
  const readouts = usePageChrome((s) => s.readouts);
  const primary = usePageChrome((s) => s.primary);
  const action = usePageChrome((s) => s.action);
  const [moreOpen, setMoreOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const impRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [moreOpen]);

  const close = () => setMoreOpen(false);

  /* 되돌리기 백업의 존재·시각 — **메뉴를 여는 클릭이** 읽는다.
     ⚠ 렌더에서 읽으면 `Date.now()` 라 순수성 린트가 막고(옳다 — 시계는 렌더의 입력이 아니다),
       이펙트에서 읽으면 setState-in-effect 라 또 막힌다. 남는 정당한 자리가 이벤트 핸들러이고,
       마침 그게 의미도 맞다: **여는 순간이 "지금 알고 싶다"는 신호**다.
     ⚠ 마운트 시 한 번 읽는 방식은 안 된다 — 세션 내내 낡아 "방금"이라 적힌 3시간 전이 된다. */
  const [undoWhen, setUndoWhen] = useState<string | null>(null);
  const openMore = () => {
    const next = !moreOpen;
    if (next) {
      // ⚠ 갱신은 여는 쪽에서만 — 상태 업데이터 안에서 하면 StrictMode 이중 호출에 부작용이 두 번 돈다.
      const b = actions.backupAt();
      setUndoWhen(b ? (b.at == null ? '시각 모름' : agoLabel(b.at, Date.now())) : null);
    }
    setMoreOpen(next);
  };
  const undoInfo = undoWhen !== null;

  return (
    <header className={BAR}>
      <h1 className={WORDMARK}>
        <span className={MARK_PART}>러닝</span>
        {/* W22 — 워드마크의 발광을 껐다(액센트 예산은 **행동과 상태**에만). 색으로 브랜드는 그대로
            읽히고, 값(44px `primary`)이 크롬과 경쟁하지 않는다. */}
        <span className={`${MARK_PART} font-[var(--emph-value-weight)] text-acc`}>허브</span>
      </h1>
      <span className={SUB}>오늘 할 일에 집중해요 — 계획·복습·일정은 자동으로</span>
      <span className="flex-1" />
      {/* 전역 집중 세션 칩 — 어느 탭에서든 진행 중 세션이 보인다(클릭 → 오늘). */}
      <FocusChip />
      {primary && (
        <div className={`${PRIMARY} ${readouts.length > 0 ? 'mr-7.5' : 'mr-2'}`}>
          <span className={RL}>{primary.label}</span>
          <span className={PV}>
            {primary.value}
            {primary.unit && <span className={PU}>{primary.unit}</span>}
          </span>
        </div>
      )}
      {readouts.length > 0 && (
        <div className={READOUTS}>
          {readouts.map((r, i) => (
            <div key={i} className={READOUT}>
              <span className={RL}>{r.label}</span>
              <span className={`${RV} ${r.value === '—' ? RV_NULL : r.accent ? RV_ACC : ''}`}>{r.value}</span>
            </div>
          ))}
        </div>
      )}
      <div className={ACTIONS}>
        {/* ── Q-12 내비 스택 ────────────────────────────────────────────────────────────
            🌍 격차표 _"왔던 길(BackStack) — 뒤로는 이전 위치로"_ 대비 우리 현재는 **없음**
            이었다(`navigate(-1)`·`history.back` 앱 전량 0건). 그래서 "방금 그 화면"으로
            돌아가려면 **이름으로 다시 찾아가야** 했다 — `lastLens` 가 있었지만 레일 한 경로·
            세션 한정이라(자기 주석이 자인) 일반 후퇴가 아니었다.
            ⚠ 활성/비활성을 그리지 않는다: 브라우저 히스토리 길이는 표준으로 읽을 수 없고
            (`history.length` 는 다른 오리진 항목까지 센다), 없는 정보를 아는 척하면 비활성
            버튼이 거짓말이 된다. 눌러서 아무 일도 안 나는 편이 정직하다. */}
        <button className={BTN_ICON} onClick={() => navigate(-1)} title="뒤로 (Alt+←)" aria-label="이전 화면으로">
          ‹
        </button>
        <button className={BTN_ICON} onClick={() => navigate(1)} title="앞으로 (Alt+→)" aria-label="다음 화면으로">
          ›
        </button>
        {action && (
          <button className={`${BTN_BASE} ${BTN_FILL}`} onClick={action.onClick}>
            {action.label}
          </button>
        )}
        <button
          className={BTN}
          onClick={() => openPalette(true)}
          title={`명령 팔레트 (${MOD_LABEL}+K)`}
          aria-label="명령 팔레트 열기"
        >
          {MOD_K_LABEL}
        </button>
        {/* C-12: 단축키 치트시트는 '?' 키·팔레트로만 열려 발견성이 낮았다 — 눈에 보이는 진입점. */}
        <button
          className={BTN_ICON}
          onClick={() => openHelp(true)}
          title="키보드 단축키 (?)"
          aria-label="키보드 단축키 보기"
        >
          ?
        </button>
        <button
          className={BTN_ICON}
          onClick={() => actions.toggleTheme()}
          title={`테마: ${THEME_NAME[theme]} — 클릭하면 ${THEME_NEXT[theme]}로`}
          aria-label={`테마 전환 (현재 ${THEME_NAME[theme]})`}
        >
          <Icon name={THEME_ICON[theme]} className="size-4!" />
        </button>
        {/* ⋯ 메뉴 — 디스클로저(aria-expanded)로만 선언. role=menu는 화살표 내비·포커스 이동(APG)
            계약을 요구하는데 이 목록은 Tab 이동이라 role이 SR 기대만 깨뜨렸다(제거가 정확). */}
        <div className="relative" ref={wrapRef}>
          <button
            className={BTN_ICON}
            aria-expanded={moreOpen}
            onClick={openMore}
            title="데이터·백업 메뉴"
            aria-label="데이터·백업 메뉴"
          >
            ⋯
          </button>
          {moreOpen && (
            <div className="menu">
              <button
                type="button"
                onClick={() => {
                  close();
                  io.exportICS();
                }}
                title="일회성 스냅샷"
              >
                <Icon name="calendar" /> 캘린더(.ics) 내보내기
              </button>
              <button
                type="button"
                onClick={() => {
                  close();
                  io.exportJSON();
                }}
              >
                <Icon name="download" /> 데이터 내보내기(백업)
              </button>
              <button
                type="button"
                onClick={() => {
                  close();
                  impRef.current?.click();
                }}
              >
                <Icon name="upload" /> 데이터 가져오기
              </button>
              {/* ⚠ **언제 것인지 말한다.** 종전엔 라벨이 그냥 '되돌리기' 이고 백업이 없어도
                  눌렸다 — 누르면 "직전"이 아니라 *마지막 파괴적 동작 시점*(며칠 전일 수 있다)
                  으로 갔고, 그 사실이 화면 어디에도 없었다. 되돌리기가 조용히 며칠을 지우면
                  그건 안전망이 아니라 두 번째 사고다.
                  ⚠ 백업이 없으면 **비활성**이다(누르고 나서 토스트로 실패를 아는 것보다 낫다).
                  ⚠⚠ **라벨이 '스냅샷 복원'으로 바뀌었다**(근본① · 2026-08-01). 평범한 편집은 이제
                  전역 ⌘Z 가 덮으므로, 이 항목이 덮는 것은 **가져오기·초기화 직전**뿐이다 —
                  `backupNow()` 를 부르는 곳이 그 둘로 좁아졌기 때문이다(feature 삭제 경로에서 뺐다).
                  즉 위 "며칠 전" 문제의 원인이 사라졌고, 라벨이 그 사실을 정확히 말한다.
                  ⚠ 이 항목을 지우지 않은 이유: 스냅샷을 **유지**하기로 한 이상 6.5초 토스트가
                  유일한 접근로면 그건 유지가 아니다(창을 놓치면 도달 불가). ⌘Z 는 이 층을
                  **대체하지 않는다** — 통째 교체는 `undo` 스택에 안 쌓는다(`db/write.ts`). */}
              <button
                type="button"
                disabled={!undoInfo}
                onClick={() => {
                  close();
                  actions.undoLast();
                }}
                title={
                  undoInfo
                    ? `가져오기·초기화 직전 스냅샷으로 되돌리기 (백업 ${undoWhen})`
                    : '복원할 스냅샷이 없습니다 — 가져오기·초기화 직전에 자동으로 만들어집니다. 평범한 편집은 ⌘Z 로 되돌려요'
                }
              >
                <Icon name="undo" /> 스냅샷 복원
                {undoInfo ? <span className="ml-auto text-2xs text-mut">{undoWhen}</span> : null}
              </button>
              <div className="menu-sep" />
              <button
                type="button"
                className="menu-danger"
                onClick={() => {
                  close();
                  actions.resetAll();
                }}
              >
                <Icon name="trash" /> 전체 초기화…
              </button>
            </div>
          )}
        </div>
      </div>
      {/* importJSON(input)이 id="imp"의 .files를 읽는다 — 팔레트의 '가져오기'도 이 입력을 클릭. */}
      <input
        type="file"
        id="imp"
        ref={impRef}
        accept="application/json"
        className="hidden"
        onChange={(e) => actions.importJSON(e.currentTarget)}
      />
    </header>
  );
}
