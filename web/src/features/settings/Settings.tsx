/* ============================================================
   Settings — 탭: ⚙ 설정 (Phase 4 · 앱상태/Zustand · nav 숨김)
   레거시 ui-routine.js의 renderSettings + maintenanceCard를 React로.
   자주 안 바뀌는 기본값(시작일·모듈길이·피크 등) + 데이터 백업·정리.
   백업/내보내기/복구/아카이빙은 부수효과가 본질이라 shell/io로 위임(설계도 §3).

   월드클래스 라운드(AmbientCanvas 언어) — 폼이 본질인 유틸 탭의 괴리감 해소: 상단 시네마틱
   상태 밴드(백업·저장·기록을 카운트업 리드아웃으로)로 제품의 같은 피부·살아있는 감각을 입힘.
============================================================ */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/store/useApp';
import { useUI } from '@/store/useUI';
import {
  archiveOld,
  backupToVault,
  confirmLossy,
  downloadCorruptSnapshot,
  exportJSON,
  hasCorruptSnapshot,
  importJSON,
  resetAll,
  restoreFromIDB,
  seedDegreePlan,
  undoLast,
  undoPoints,
  undoTo,
} from '@/shell';
import { useHeroPointer } from '@/hooks/interactions';
import { dataSizeKB, recordBreakdown, recordsSince, archivableCount } from '@/lib/methodology';
import { ACCENTS, type Accent } from '@/lib/uiState';
import { GENERATIONS } from '@/lib/snapshots';
import { Button, NumberField } from '@/components/ui';
import { CountReadout } from '@/components/CountReadout';
import WorkspaceCard from './WorkspaceCard';
import CloudCard from './CloudCard';
import ConflictsNotice from './ConflictsNotice';
import UpdateCard from './UpdateCard';
import VisitLedger from './VisitLedger';
import { lastParity } from '@/lib/db/write';
import { preImageTally } from '@/lib/db/undoStack';
import type { AppState } from '@/lib/types';
import { Icon } from '@/components/Icon';

/* ── C-7 이식(settings) — Tailwind 클래스 ─────────────────────────────────────
   상단 시네마틱 상태 밴드 + 컨트롤 패널. ds.* 공유 클래스·런타임 색 주입(액센트 스와치
   미리보기 = style={{ background }})·전역 요소(h2/button/input/label)는 그대로 두고, 전역을
   이기는 지점만 `!`. 히어로 그래디언트·상단 헤어라인·밴드 그림자·페이드업 키프레임은 mastery/
   review 가 이름 준 것을 공유한다(값 동일). 규약은 §15 + tokenBridge.css 머리주석이 SSOT. */

const S = {
  wrap: 'flex min-w-0 flex-col gap-4',
  // Q-14 — 노치 HUD 통일(사유는 `styles/ds.css` 의 `ds-frame` 절).
  hero: `ds-frame mb-0! relative flex flex-wrap items-center gap-settings-gap bg-[image:var(--bg-hero-settings)] px-hero-px! py-5! animate-[enter-rise_var(--dur-slow)_var(--ease)_both] ds-hairline motion-reduce:animate-none`,
  heroLeft: 'flex min-w-0 flex-1 flex-col gap-0.75',
  eyebrow: 'text-xs leading-text font-extrabold tracking-eyebrow-wide text-acc uppercase',
  title: 'mt-0.5! mb-0! text-hero-title! font-black! leading-none tracking-title!', // h2 — 전역 h2{} 를 ! 로 이김(색 ink≡txt 는 동일→클래스 없음)
  meta: 'text-sm leading-body text-mut', // 11.5px → 12px(text-sm) 반올림(반픽셀 사다리 밖 · 클리핑 없어 정수 rung)
  status: 'flex flex-wrap gap-2.5 max-mobile:w-full',
  accRow: 'mt-1 flex flex-wrap gap-2.5',
  accBtn: 'inline-flex items-center gap-2 rounded-md! font-bold! hover:-translate-y-px', // <button> — r-sm→r-md·w500→700 만 다름(pad/size/color/border 는 전역과 동일 → 클래스 없음)
  accSwatch: 'size-4 flex-none rounded-swatch',
  stepper: 'flex items-stretch gap-1.5',
  stepInput: 'min-w-0 flex-1 text-center',
  stepBtn: 'w-8.5 flex-none text-lg! font-extrabold! leading-none', // <button> — 16px→15px(text-lg) 반올림 · w800 · lh1(전역 pad/border/bg/color 는 동일)
  subLabel: 'inline!', // 전역 label{display:block} 을 이김(div 사용처엔 무해)
  fldBody: 'mt-1.5',
  chkFlush: 'm-0!', // 'ds-chkRow' 의 margin:9px 0 을 이김
  chkTop: 'mt-2.5!', // 'ds-chkRow' 의 margin-top(9px) 을 10px 로 이김
  spacer: 'flex-1',
  pillRow: 'mb-1.5',
  fileInput: 'hidden',
  bdLine: 'mt-1! tabular-nums', // 'ds-foot' 의 margin-top(7px) 을 4px 로 이김
  warnAction: 'mt-2 flex flex-wrap items-center gap-2.5',
  warnActionSpan: 'min-w-warnspan flex-1', // 옛 `.warnAction > span` — 자식에 직접(규약 4)
  dangerRow: 'mt-3 border-t border-line pt-3',
  ro: `ds-ro min-w-24 px-3.75! max-mobile:flex-1`, // composes ro + 최소폭 96px·좌우 15px·모바일 flex
  roLab: 'ds-roLab',
} as const;

// 상태(tone) 정적 클래스 맵 — 타일 테두리/배경 + 숫자 색(§15 부칙 · 동적 조립 금지).
// 38%→line-acc-hover(40%) · 35%→line-bad(32%) 는 ~3% 반올림 허용범위(tokens.css line-acc-hover 주석과 같은 규율).
const TONE_TILE = { ok: 'border-line-acc-hover! bg-acc-soft!', warn: 'border-line-bad!' } as const;
const TONE_NUM = { ok: 'text-acc!', warn: 'text-bad!' } as const;
// 액센트 스와치 버튼 선택 상태 — 두 배경 유틸이 한 요소에 겹치지 않게 on/off 로 가른다(no-conflicting-classes 회피).
const ACC_STATE = { on: 'border-acc! bg-acc-soft!', off: 'bg-transparent!' } as const;

/** 저장 경로 진단 한 줄 — 쓴 것과 되읽은 것이 일치하는가(`db/write.ts` 의 되읽기 대조).
    ⚠ 옛 주석은 "2단계-D 이행 구간의 한시적 줄이고 2단계-E 에서 사라진다"고 적고 있었다 —
    둘 다 거짓이 됐다(정본이 SQLite 로 뒤집혔고 이 줄은 남았다 · `write.ts` 머리주석과 같은 드리프트).
    지금 이 줄의 뜻: **정본 저장이 건강한가**. 브라우저(SQLite 가 정본 아님)에선 렌더하지 않는다.
    사용자 행동이 필요한 사건(연결 실패)은 이 조용한 줄이 아니라 지속 배너가 맡는다(C1).
    ⚠ H6 이후 대조는 **표본**이다 — 건너뛴 회차는 이 값을 갱신하지 않는다(안 잰 것을 '일치'라
    보고하지 않기 위해서다 · `db/write.ts` 의 그 절). */
function ParityLine() {
  const p = lastParity();
  if (p.skipped) return null;
  if (p.unavailable)
    return (
      <div className={`ds-foot ${S.bdLine}`}>
        <Icon name="alert" /> 저장소에 연결하지 못했습니다(임시 저장 중)
      </div>
    );
  return (
    <div className={`ds-foot ${S.bdLine}`}>
      {p.ok ? (
        '✓ 저장 경로 정상(쓴 값과 되읽은 값 일치)'
      ) : (
        <>
          <Icon name="alert" /> 저장 경로 불일치: {p.mismatched.join(', ')}
        </>
      )}
    </div>
  );
}

/** 액센트 스와치 미리보기색 — tokens.css [data-accent] 프리셋의 --acc를 직접 읽어 파생(하드코딩 SSOT 위반 제거).
    ⚠ `fallback` 의 hex 넷은 `ThemeProvider.META_FALLBACK` 과 **같은 판단 대기 중**이다(V033 ·
    2026-08-22): `getPropertyValue` 가 빈 문자열을 주는 실제 조건은 «그 토큰이 없다» 하나이고,
    그건 불변식 ④가 이미 게이트에서 잡는다. `typeof document === 'undefined'` 가드도 이 앱에
    SSR 이 없으므로 사문이다. 지울지는 별개 판단이라 `scripts/_hexcheck.mjs` 원장(만료 2026-11-30).
    '테마 무관 대표 네온'을 위해 다크 테마 기준으로 계산한다(라이트에서도 스와치는 같은 네온).
    프리셋 규칙이 :root를 겨냥하므로 documentElement 속성을 잠깐 바꿔 읽고 즉시 원복 — 동기 실행이라
    중간 프레임은 페인트되지 않아 깜빡임이 없다. 향후 토큰 재튜닝이 스와치에 자동 반영된다. */
/* 파생이 실패했을 때의 값. ⚠ **실측상 파생 결과 4개가 이 상수와 글자 그대로 같았다**
   (P037 · 2026-08-27) — 그래서 첫 프레임에 이걸 써도 화면은 한 픽셀도 안 바뀐다. */
const ACC_FALLBACK: Record<Accent, string> = {
  violet: '#9b8cff',
  lime: '#b6f23a',
  cyan: '#4dd9e8',
  amber: '#ffb454',
};

function readAccentPreviews(): Record<Accent, string> {
  const fallback = ACC_FALLBACK;
  if (typeof document === 'undefined') return fallback;
  const root = document.documentElement;
  const prevTheme = root.getAttribute('data-theme');
  const prevAccent = root.getAttribute('data-accent');
  root.setAttribute('data-theme', 'dark');
  const out = {} as Record<Accent, string>;
  for (const a of ACCENTS) {
    // 기본(violet)은 전용 프리셋이 없어 data-accent를 비운다(베이스 --acc).
    if (a === 'violet') root.removeAttribute('data-accent');
    else root.setAttribute('data-accent', a);
    out[a] = getComputedStyle(root).getPropertyValue('--acc').trim() || fallback[a];
  }
  if (prevTheme == null) root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', prevTheme);
  if (prevAccent == null) root.removeAttribute('data-accent');
  else root.setAttribute('data-accent', prevAccent);
  return out;
}
/* ⚠⚠ **모듈 스코프에서 부르지 않는다**(P037 · 2026-08-27 성능 축). 종전엔
   `const ACC_PREVIEW = readAccentPreviews()` 가 모듈 상수라, **Settings 청크가 평가되는 순간
   = 탭 전환 도중** 메인 스레드에서 돌았다. 그 함수는 `documentElement` 의 속성을 4회 바꾸며
   `getComputedStyle(root).getPropertyValue('--acc')` 를 4회 부른다 = **강제 동기 스타일
   재계산 4회**. 실측 **28.1 ms(1x) / 220.9 ms(4x)** 이고 4x 프로파일에서 `getPropertyValue`
   자체가 389.4 ms(20.5%)로 잡혔다. 비용은 DOM 노드 수·토큰 수에 비례해 자란다.
   ⭐ 파생이라는 계약(토큰을 재튜닝하면 스와치가 따라온다)은 **그대로 유지**하고, 시점만
   첫 페인트 뒤로 옮긴다 — 첫 프레임은 `ACC_FALLBACK` 이고 그 값이 실측상 파생 결과와 같다. */
function useAccentPreviews(): Record<Accent, string> {
  const [preview, setPreview] = useState<Record<Accent, string>>(ACC_FALLBACK);
  useEffect(() => {
    /* rAF = 「이 전환의 첫 페인트 뒤」. 여기서 재계산이 나도 전환은 이미 끝나 있다. */
    const id = requestAnimationFrame(() => setPreview(readAccentPreviews()));
    return () => cancelAnimationFrame(id);
  }, []);
  return preview;
}
/** 액센트 스와치 라벨. tokens.css [data-accent] 프리셋과 1:1. */
const ACC_LABEL: Record<Accent, string> = { violet: '바이올렛', lime: '라임', cyan: '시안', amber: '앰버' };

/** 최근 백업 경과일(state._lastBackupAt) — 렌더 전용(변형 없음). */
function lastBackupDays(at?: string): number | null {
  if (!at) return null;
  const t = new Date(at);
  if (isNaN(t.getTime())) return null;
  return Math.floor((Date.now() - t.getTime()) / 86400000);
}

/** 상태 리드아웃 — 공용 CountReadout에 이 탭의 클래스만 입힘(카운트업 정본 공유).
    display가 주어지면 카운트업 대신 그 노드를 그대로 렌더(숫자가 아닌 상태 텍스트용 — tone/클래스 분기 수렴). */
function Readout({
  value,
  suffix,
  lab,
  tone,
  display,
}: {
  value?: number;
  suffix?: React.ReactNode;
  lab: string;
  tone?: 'ok' | 'warn';
  display?: React.ReactNode;
}) {
  const tileCls = `${S.ro} ${tone ? TONE_TILE[tone] : ''}`;
  const numCls = `ds-roNum ${tone ? TONE_NUM[tone] : ''}`;
  if (display != null) {
    return (
      <div className={tileCls} title={lab}>
        <span className={`${numCls} text-lg!`}>{display}</span>
        <span className={S.roLab}>{lab}</span>
      </div>
    );
  }
  return (
    <CountReadout
      value={value ?? 0}
      suffix={suffix}
      lab={lab}
      className={tileCls}
      numClassName={numCls}
      labClassName={S.roLab}
    />
  );
}

/** 숫자 설정 — 빈 필드/NaN을 min으로 방어하고 [min,max]로 클램프(모듈 밖으로 승격해 Stepper와 공유).
    (HTML min/max·step은 스피너 힌트일 뿐, 직접 타이핑한 값이나 지운 필드(NaN)를 막지 못한다.) */
function clampNum(raw: number, min: number, max: number, round = false) {
  let v = round ? Math.round(raw) : raw;
  if (!Number.isFinite(v)) v = min;
  return Math.min(max, Math.max(min, v));
}

/** –/+ 스텝퍼 — components.css:58이 약속한 어포던스. 클릭 증감(step 상수·clampNum·min/max 재사용).
    직접 타이핑도 그대로 보존(input onChange도 같은 clamp 경유). */
function Stepper({
  id,
  value,
  step,
  min,
  max,
  round = false,
  onChange,
}: {
  id: string;
  value: number;
  step: number;
  min: number;
  max: number;
  round?: boolean;
  onChange: (v: number) => void;
}) {
  const commit = (raw: number) => onChange(clampNum(raw, min, max, round));
  return (
    <div className={S.stepper}>
      <button type="button" className={S.stepBtn} aria-label={`${step} 감소`} onClick={() => commit(value - step)}>
        –
      </button>
      {/* 미완 입력을 확정하지 않는다 — 예전엔 값을 고쳐 치는 도중 빈값이 0으로 저장돼
          모듈 길이 0분 같은 설정이 잠깐 확정됐다(스케줄러 입력이라 파급이 크다). */}
      <NumberField id={id} step={step} min={min} max={max} value={value} onCommit={commit} className={S.stepInput} />
      <button type="button" className={S.stepBtn} aria-label={`${step} 증가`} onClick={() => commit(value + step)}>
        +
      </button>
    </div>
  );
}

/** 기본 설정 + 데이터 백업·정리. */
export default function Settings() {
  const state = useApp((s) => s.state);
  const mutate = useApp((s) => s.mutate);
  const accent = useUI((s) => s.ui.accent);
  const accPreview = useAccentPreviews();
  const setAccent = useUI((s) => s.setAccent);
  const fxLite = useUI((s) => s.ui.fxLite);
  const setFxLite = useUI((s) => s.setFxLite);
  const themeAuto = useUI((s) => s.ui.themeAuto);
  const setThemeAuto = useUI((s) => s.setThemeAuto);
  // 포인터 추적 스포트라이트 — 상태 밴드가 커서를 따라 발광(틸트 없는 큰 보드).
  const { ref: heroRef, onMouseMove: heroMove, onMouseLeave: heroLeave } = useHeroPointer(0);
  // 파일에서 복원 — 숨은 파일 인풋을 버튼이 대리 클릭(importJSON은 HTMLInputElement를 받는다).
  const impRef = useRef<HTMLInputElement>(null);
  // 손상 원본 보존본(CORRUPT_KEY · 감사 ③#9) — 있을 때만 회수 버튼 노출, 내려받으면 정리돼 사라진다.
  const [hasCorrupt, setHasCorrupt] = useState(() => hasCorruptSnapshot());

  // 설정값 1개 변경 — 레거시 setSetting(state[k]=v;persist;render)을 mutate로.
  // (draft 파라미터는 d — store 셀렉터 `s`와 겹치지 않게. 옛 사유였던 CSS 모듈 import `st` 는 C-7 에서 사라졌다.)
  const set = <K extends keyof AppState>(k: K, v: AppState[K]) => mutate((d) => void ((d as AppState)[k] = v));

  // 피크 시간대 역전 감지 — 끝이 시작보다 이르면 스케줄러 피크 우선배치가 조용히 깨진다.
  const peakInverted = !!state.peakStart && !!state.peakEnd && state.peakEnd <= state.peakStart;

  const days = lastBackupDays(state._lastBackupAt as string | undefined);
  const stale = days == null || days >= 7;
  // 데이터 슬라이스가 바뀔 때만 재직렬화/재집계 — 스칼라 설정 타이핑마다 전체 JSON.stringify를 돌지 않도록.
  // (state 전체를 넘기지만 데이터 5슬라이스가 바뀔 때만 무효화 — exhaustive-deps는 그래서 명시 억제.)
  const sizeKB = useMemo(
    () => dataSizeKB(state),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.completions, state.summaries, state.cbms, state.backlog, state.blankResults],
  );
  const bd = useMemo(
    () => recordBreakdown(state),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.completions, state.summaries, state.cbms, state.backlog, state.blankResults],
  );
  const recs = bd.done + bd.summaries + bd.cbms + bd.backlog + bd.blank;
  const archN = archivableCount(state);
  /* ⚠⚠ **「무엇을 잃나」를 말한다**(D022 · 2026-08-22). 종전엔 「N일 전」뿐이었는데 그건 경과
     시간이지 **위험의 크기**가 아니다 — 한 달 전 백업이어도 그 뒤에 안 썼으면 잃을 것이 없고,
     어제 백업이어도 오늘 30건을 썼으면 그게 위험이다. 사람이 «백업할까»를 판단하는 재료는 후자다.
     ⚠ 0건이면 **수를 안 붙인다** — 「0건이 로컬에만」은 안심이 아니라 소음이고, 이 저장소가
     반복해 지운 «값 부재와 값 0 을 같은 픽셀로 그리는» 형태다. */
  const atRisk = recordsSince(state, state._lastBackupAt as string | undefined);
  const riskTail = atRisk > 0 ? ` · ${atRisk}건이 앱에만` : '';
  const backupLine =
    (days == null ? '볼트 백업 기록 없음' : days === 0 ? '볼트 백업: 오늘' : `볼트 백업: ${days}일 전`) + riskTail;

  const archiveOldConfirm = async () => {
    /* Q-13 ②단 — 비우기 전에 **파일로 먼저 내려받으므로** 밖에 원본이 남는다(재구성 가능). */
    const ok = await confirmLossy(
      '6개월 이전의 기록을 보관 파일(.json)로 내려받고 앱에서 비울까요? (완료기록·요약·오답·백지·인출지연·문항·JOL 예측 + 완료된 할 일·지난 일정. 통계가 가벼워지고 저장공간을 회수합니다. 보관 파일은 따로 두면 나중에 열람 가능)',
      { title: '오래된 기록 정리', okLabel: '정리' },
    );
    if (ok) archiveOld(6);
  };

  return (
    <section className={S.wrap} aria-label="설정">
      {/* ── 시네마틱 상태 밴드 — 무엇을 설정하나 + 핵심 상태(백업·저장·기록) ── */}
      <div ref={heroRef} onMouseMove={heroMove} onMouseLeave={heroLeave} className={`${S.hero} ds-spotHost`}>
        <div className="ds-spotlight" aria-hidden="true" />
        <div className="ds-aura" aria-hidden="true" />
        <div className={S.heroLeft}>
          <span className={S.eyebrow}>환경설정 · SETTINGS</span>
          <h2 className={S.title}>설정</h2>
          <span className={S.meta}>
            학습 계획의 기본값 · 테마 · 데이터 백업. 요일별 가용시간·수업·일과는{' '}
            <b className="text-txt">가용시간·수업·일과</b> 탭에서.
          </span>
        </div>
        <div className={S.status}>
          <Readout
            display={days == null ? '없음' : days === 0 ? '오늘' : `${days}일 전`}
            lab="볼트 백업"
            tone={stale ? 'warn' : 'ok'}
          />
          <Readout value={sizeKB} suffix={<small className="ml-px">KB</small>} lab="저장 크기" />
          <Readout value={recs} suffix={<small className="ml-px">건</small>} lab="기록 수" />
        </div>
      </div>

      <div className="ds-rule">
        <h2>
          테마 · 액센트 <span className="ds-tiny text-mut">— 네온 색을 고르세요(다크/라이트 전환은 우측 상단 ◐)</span>
        </h2>
        <div className={S.accRow}>
          {ACCENTS.map((a) => (
            <button
              key={a}
              type="button"
              aria-pressed={accent === a}
              aria-label={`액센트 ${ACC_LABEL[a]}`}
              onClick={() => setAccent(a)}
              className={`${S.accBtn} ${accent === a ? ACC_STATE.on : ACC_STATE.off}`}
            >
              <span
                aria-hidden="true"
                className={S.accSwatch}
                style={{ background: accPreview[a], boxShadow: `0 0 8px ${accPreview[a]}` }}
              />
              {ACC_LABEL[a]}
            </button>
          ))}
        </div>
        <div className="ds-foot">
          액센트는 이 기기에 저장돼요(데이터와 별개). 발광·강조·진행 바 전체에 즉시 반영됩니다.
        </div>
        <label className={`ds-chkRow ${S.chkTop}`}>
          <input type="checkbox" checked={fxLite} onChange={(e) => setFxLite(e.target.checked)} />
          발광 효과 줄이기 (발광 펄스 정지 — 저사양/노트북에서 가볍게)
        </label>
        <label className="ds-chkRow">
          <input type="checkbox" checked={themeAuto} onChange={(e) => setThemeAuto(e.target.checked)} />
          시스템 테마 따라가기 (OS 가 밝기를 바꾸면 앱도 함께 — 끄면 수동 선택 유지)
        </label>
        {/* ⚠⚠ **여기 N-17 「레일 정리」(안 쓰는 화면 접기 · 순서 바꾸기)가 있었다 — 은퇴했다**
            (I027 · 2026-08-22 발상 축). 실측: 출하 2026-08-07 뒤 **15일 동안 `railHidden`·
            `railOrder` 가 둘 다 빈 배열**. 근거·되살리는 조건은 `app/RailSidebar.tsx` 의 그 자리 주석. */}
        {/* ⚠⚠ **여기 T-3 상주 트레이 · 자동 시작 · T-6 하루 한 번 알림이 있었다 —
            셋 다 은퇴했다**(I049 · 2026-08-22 발상 축). 근거: 레일 배지·작업표시줄 배지·알림이
            **글자 그대로 같은 식**을 쓰고 있었고, 그 식의 입력이 실물에서 전부 0행이라 두
            채널은 한 번도 말한 적이 없다. 남은 것은 레일 배지 하나다.
            트레이·자동 시작은 알림의 **원리적 선행**이었으므로(그 파일이 자인) 함께 갔다. */}
      </div>

      <div className="ds-rule">
        <h2>기본 설정</h2>
        <div className="ds-row">
          <div>
            <label htmlFor="set-start">시작일</label>
            <input
              id="set-start"
              type="date"
              value={state.startDate}
              onChange={(e) => set('startDate', e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="set-modlen">모듈 길이 (시간)</label>
            <Stepper
              id="set-modlen"
              value={state.moduleLen / 60}
              step={0.5}
              min={0.5}
              max={12}
              onChange={(v) => set('moduleLen', Math.round(v * 60))}
            />
          </div>
          <div>
            <label htmlFor="set-revratio">복습 시간 비중 (%)</label>
            <Stepper
              id="set-revratio"
              value={state.reviewRatio}
              step={5}
              min={0}
              max={60}
              round
              onChange={(v) => set('reviewRatio', v)}
            />
          </div>
        </div>
        <div className="ds-foot">
          모듈 = 한 번에 집중하는 공부 슬롯(기본 2시간). 하루 공부 가능 시간이 이 단위로 과목에 배분됩니다.
        </div>
        <hr />
        <div className="ds-row">
          <div className="ds-fld">
            <label htmlFor="set-blank" className={S.subLabel}>
              백지 복습 자동 배치 <span className="ds-tiny text-mut">(방법론 9절 — 주 1회 단원 재구성)</span>
            </label>
            <div className={S.fldBody}>
              <label className={`ds-chkRow ${S.chkFlush}`}>
                <input
                  type="checkbox"
                  id="set-blank"
                  checked={state.blankReviewWeekly}
                  onChange={(e) => set('blankReviewWeekly', e.target.checked)}
                />{' '}
                <span>그 주 배운 과목마다 주말에 백지 복습 한 칸</span>
              </label>
            </div>
          </div>
          <div>
            <label htmlFor="set-mock">
              모의시험 주기 (주) <span className="ds-tiny text-mut">0=끔 (방법론 12절)</span>
            </label>
            <Stepper
              id="set-mock"
              value={state.mockEveryWeeks || 0}
              step={1}
              min={0}
              max={12}
              round
              onChange={(v) => set('mockEveryWeeks', v)}
            />
          </div>
        </div>
        <div className="ds-foot">
          백지 복습·모의시험은 여유 있는 날에만 배치되며 가용시간을 넘기지 않아요. <b>오늘 학습</b> 탭에서 절차 가이드를
          봅니다.
        </div>
        <hr />
        <div className="ds-row">
          <div className="ds-fld">
            {/* 그룹 캡션은 <label>이 아니다 — label 은 '하나의 컨트롤'에 묶이는 것이고, 여기서
                실제 label 역할은 아래 'ds-chkRow' 가 이미 하고 있다(input 을 감싼다). 캡션은 div +
                role=group/aria-labelledby 로 묶어야 스크린리더가 "적응형 용량 그룹"으로 읽는다.
                .subLabel 이 display:inline 을 명시하므로 div 로 바꿔도 픽셀은 동일. */}
            <div className={S.subLabel} id="set-adaptive-cap">
              적응형 용량 <span className="ds-tiny text-mut">(방법론 1·10절 — "계획은 가설")</span>
            </div>
            <div className={S.fldBody} role="group" aria-labelledby="set-adaptive-cap">
              <label className={`ds-chkRow ${S.chkFlush}`}>
                <input
                  type="checkbox"
                  checked={state.adaptiveCapacity !== false}
                  onChange={(e) => set('adaptiveCapacity', e.target.checked)}
                />{' '}
                <span>최근 14일 완료율로 다음 계획 용량을 자동 보정(꾸준히 70%만 끝내면 계획도 70%로)</span>
              </label>
            </div>
          </div>
          <div className="ds-fld">
            <div className={S.subLabel} id="set-review-anki">
              복습은 Anki에 위임 <span className="ds-tiny text-mut">(시간 이중계상 방지)</span>
            </div>
            <div className={S.fldBody} role="group" aria-labelledby="set-review-anki">
              <label className={`ds-chkRow ${S.chkFlush}`}>
                <input
                  type="checkbox"
                  checked={state.reviewViaAnki}
                  onChange={(e) => set('reviewViaAnki', e.target.checked)}
                />{' '}
                <span>매일 Anki 항목이 있으면 합성 간격복습(1·3·7·16) 슬롯을 만들지 않음 — due는 FSRS가 소유</span>
              </label>
            </div>
          </div>
          <div className="ds-fld">
            <div className={S.subLabel} id="set-graph-prio">
              그래프 우선순위 <span className="ds-tiny text-mut">(지식엔진 숙달도로 배분 보정 · 설계 B)</span>
            </div>
            <div className={S.fldBody} role="group" aria-labelledby="set-graph-prio">
              <label className={`ds-chkRow ${S.chkFlush}`}>
                <input
                  type="checkbox"
                  checked={state.graphPriority}
                  onChange={(e) => set('graphPriority', e.target.checked)}
                />{' '}
                <span>
                  같은 마감 긴급도면 <b>숙달 낮은(약한) 과목을 먼저</b> 배치. 숙달도 지도 탭에서 지식상태를 먼저
                  불러와야 작동(없으면 영향 0).
                </span>
              </label>
            </div>
          </div>
        </div>
        <div className="ds-row">
          <div>
            <label htmlFor="set-peak0">
              각성도 최고 시간대 시작 <span className="ds-tiny text-mut">(방법론 1절 — 어려운 새 학습을 맑을 때)</span>
            </label>
            <input
              id="set-peak0"
              type="time"
              value={state.peakStart || ''}
              onChange={(e) => set('peakStart', e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="set-peak1">끝</label>
            <input
              id="set-peak1"
              type="time"
              value={state.peakEnd || ''}
              onChange={(e) => set('peakEnd', e.target.value)}
            />
          </div>
          <div className={S.spacer} />
        </div>
        {peakInverted && (
          <div className="ds-warnbox ds-bad">
            <Icon name="alert" /> 끝 시각이 시작보다 빨라요 — 피크 구간이 비어 우선 배치가 동작하지 않습니다.
          </div>
        )}
        <div className="ds-foot">
          피크 시간대를 정하면 <b>새 학습(new)·모의시험</b>을 그 구간에 우선 배치하고, 복습·Anki는 나머지 시간에.
          비워두면 끔(이른 시각부터 순서대로).
        </div>
      </div>

      {/* Tauri 셸에서만 렌더(브라우저에선 null) — 1단계에서 승격된 워크스페이스 경로 설정. */}
      <WorkspaceCard />

      {/* C-5 — 클라우드 동기화(여러 기기에서 편집). 연결 전에는 아무 요청도 나가지 않는다. */}
      <CloudCard />

      {/* Phase 4 — 동기화 충돌(다른 기기 편집에 덮인 내 편집). 충돌이 없으면 렌더 안 함. */}
      <ConflictsNotice />

      {/* 2026-07-25 — 앱 업데이트. 텔레메트리(결함을 알게 되는 경로)의 짝이다: 고친 것을
          전달할 경로가 없으면 관측은 절반만 값을 낸다. 셸에서만 렌더. */}
      <UpdateCard />

      <div className="ds-rule">
        <h2>
          데이터 백업·정리 <span className="ds-tiny text-mut">— localStorage 한 곳에만 있으면 캐시 삭제 시 전소</span>
        </h2>
        <div className={`ds-row ${S.pillRow}`}>
          <span className={`ds-pill ${stale ? 'ds-warn' : 'ds-good'}`}>{backupLine}</span>
          <span className="ds-pill">
            저장 크기 {sizeKB}KB · 기록 {recs}건
          </span>
        </div>
        {/* 기록 구성비 — 어느 데이터가 저장을 지배하는지 진단(막연한 총합 → 범주별). */}
        <div className={`ds-foot ${S.bdLine}`}>
          완료 {bd.done} · 요약 {bd.summaries} · 오답 {bd.cbms} · 백로그 {bd.backlog} · 백지 {bd.blank}
        </div>
        <ParityLine />
        <VisitLedger />
        <div className="ds-row">
          <Button sm onClick={() => backupToVault()}>
            <Icon name="folder" /> 볼트 폴더에 백업
          </Button>
          <Button sm variant="ghost" onClick={() => exportJSON()}>
            <Icon name="save" /> 파일로 내보내기
          </Button>
          <Button sm variant="ghost" onClick={() => impRef.current?.click()}>
            <Icon name="folder" /> 파일에서 복원
          </Button>
          {/* 숨은 파일 인풋 — importJSON이 HTMLInputElement를 받으므로 버튼이 대리 클릭(백업가드·언두 토스트는 내장). */}
          <input
            type="file"
            accept="application/json"
            ref={impRef}
            onChange={(e) => {
              const el = e.target;
              if (el.files?.length) importJSON(el);
              el.value = '';
            }}
            className={S.fileInput}
          />
          <Button
            sm
            variant="ghost"
            onClick={() => restoreFromIDB()}
            title="localStorage가 지워졌을 때 IndexedDB 자동 미러에서 복구"
          >
            <Icon name="refresh" /> IndexedDB에서 복구
          </Button>
          {hasCorrupt && (
            <Button
              sm
              variant="ghost"
              onClick={() => {
                downloadCorruptSnapshot();
                setHasCorrupt(hasCorruptSnapshot());
              }}
              title="부팅이 살리지 못해 보존해 둔 손상 원본(raw)을 파일로 회수합니다 — 내려받으면 보존 키를 정리(감사 ③#9)"
            >
              <Icon name="alert" /> 손상 원본 내려받기
            </Button>
          )}
          <Button
            sm
            variant="ghost"
            disabled={archN === 0}
            onClick={archiveOldConfirm}
            title={
              archN === 0
                ? '정리할 오래된 기록이 없습니다'
                : `6개월 이전 ${archN}건을 보관 파일로 내려받고 앱에서 비웁니다`
            }
          >
            <Icon name="archive" /> 오래된 기록 정리(6개월 이전)
          </Button>
        </div>
        {/* 아카이브 사전 미리보기 — 블라인드 위험버튼을 "N건 보관 가능" 정보형으로 승격. */}
        <div className={`ds-foot ${S.bdLine}`}>
          {archN === 0 ? (
            '정리할 오래된 기록 없음'
          ) : (
            <>
              6개월 이전 <b>{archN}건</b> 보관 가능
            </>
          )}
        </div>
        {stale && (
          <div className={`ds-warnbox ${S.warnAction}`}>
            <span className={S.warnActionSpan}>
              백업이 {days == null ? '아직 없어요' : `${days}일 지났어요`}. 브라우저 캐시를 지우면 데이터가 사라질 수
              있으니 백업하세요.
            </span>
            <Button sm onClick={() => backupToVault()}>
              지금 볼트에 백업
            </Button>
          </div>
        )}
        <div className="ds-foot">
          볼트 백업은 <code>러닝허브_백업.json</code>을 씁니다 — 셸에서는 <b>워크스페이스 폴더</b>에 바로,
          브라우저에서는 폴더를 골라(Chrome/Edge). 이 파일이 지식엔진의 입력이에요. 저장 때마다{' '}
          <b>IndexedDB에 자동 미러</b>되어, 사이트 데이터가 지워져도 <b>복구</b>로 되살릴 수 있어요(같은 브라우저 한정).
          정리는 6개월 이전 기록을 보관 파일로 내려받고 앱에서 비워 쿼터·성능을 지킵니다.
        </div>
        {/* 위험구역 — 되돌리기(직전 백업본 복원)·전체 초기화. TopBar ⋯메뉴에만 있던 걸 설정탭에도. */}
        <div className={`ds-row ${S.dangerRow}`}>
          {/* ⚠ 종전엔 이 시드가 `defaults()` 에 실려 있어서 **초기화가 빈 상태를 안 만들었다**
              (m-14). 기본값에서 떼되 버리지 않고 여기로 옮겼다 — 새 기기·초기화 뒤 다시 넣는
              것이 이 데이터의 유일한 정당한 자리다. */}
          <Button sm variant="ghost" onClick={() => seedDegreePlan()}>
            <Icon name="cap" /> 졸업 계획 시드
          </Button>
          <Button sm variant="ghost" onClick={() => undoLast()}>
            <Icon name="undo" /> 스냅샷 복원
          </Button>
          <Button sm danger onClick={() => resetAll()}>
            전체 초기화…
          </Button>
        </div>
        <UndoPoints />
      </div>
    </section>
  );
}

/**
 * 되돌릴 수 있는 지점(I038 · 2026-08-22) — **세대가 1이라 회수 경로가 자기를 덮고 있었다.**
 *
 * 근거·시나리오는 `lib/snapshots.ts` 머리주석이 SSOT. 여기서 지는 것 둘:
 * ① 목록을 **시각과 함께** 보여 준다 — «되돌리기»가 어디로 가는지 모르면 그건 되돌리기가 아니다
 *    (`backupAt` 이 ⋯ 메뉴에서 이미 세운 규율의 확장이다).
 * ② ⚠⚠ **한계를 함께 적는다.** 이 스냅샷은 같은 기기에 있으므로 기기가 부서지면 무의미하다.
 *    밖의 표본(Anki 백업 문서)도 그 문장을 자기 페이지에 직접 적는다 — 안 적으면 이 기능은
 *    안전이 아니라 **안전의 착각**을 판다.
 */
function UndoPoints() {
  const [points, setPoints] = useState(() => undoPoints());
  if (!points.length) return null;
  const when = (at: number | null): string => (at === null ? '시각 미상' : new Date(at).toLocaleString());
  return (
    <div className="ds-foot mt-2">
      <b>되돌릴 수 있는 지점</b>{' '}
      <span className="text-mut">· 초기화·가져오기·보관 직전에 자동으로 남아요 · 최대 {GENERATIONS}개</span>
      <ul className="m-0! mt-1 flex list-none flex-col gap-1 p-0!">
        {points.map((p) => (
          <li key={p.key} className="m-0! flex flex-wrap items-center gap-2">
            <span className="ds-tiny tabular-nums">{when(p.at)}</span>
            <Button
              sm
              variant="ghost"
              onClick={() => {
                undoTo(p.key);
                setPoints(undoPoints());
              }}
            >
              {p.gen === 0 ? '가장 최근으로' : `${p.gen}단계 전으로`}
            </Button>
          </li>
        ))}
      </ul>
      <div className="ds-tiny mt-1 text-warn">
        이 지점들은 <b>이 기기 안에만</b> 있어요 — 기기가 고장 나면 함께 사라집니다. 진짜 백업은 내보내기(파일)예요.
      </div>
      <JournalFeasibility />
    </div>
  );
}

/**
 * I022 최싼검증 — **변경 저널을 지어도 되는가**(2026-08-22 발상 축).
 *
 * 항목의 전제는 «하루 저널 바이트가 SQLite 로 감당된다» 였고, 그것을 재는 자리가 여기다.
 * 되돌리기 스택과 같은 재료(pre-image)를 쓰므로 이 패널 안에 산다 — 따로 두면 «무엇을 재는
 * 수인가»가 화면에서 사라진다.
 *
 * ⚠⚠ **「하루」라 쓰지 않는다.** 이 수는 앱을 켠 뒤 누적이고, 영속하지 않는다(그 이유는
 * `lib/db/undoStack.ts` 의 그 절 — 표를 먼저 지으면 재려던 것을 재기 전에 지은 셈이 된다).
 */
function JournalFeasibility() {
  const t = preImageTally();
  if (!t.pushes) return null;
  return (
    <div className="ds-tiny mt-1 text-mut tabular-nums">
      켠 뒤 되돌리기 재료 <b>{(t.bytes / 1024).toFixed(1)}KB</b> · {t.pushes}회 —{' '}
      <span className="text-mut">이 앱을 쓰는 하루가 변경 저널에 남길 무게예요(누적 · 껐다 켜면 0부터).</span>
    </div>
  );
}
