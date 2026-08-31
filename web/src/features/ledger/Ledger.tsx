/* ============================================================
   Ledger — 탭: 📒 정본 원장
   ⚠ 종전 이 줄은 _"자료 그룹 · 연동 현황과 세그먼트 페어"_ 였다(M-16 · 2026-08-06 정정).
   `integrations` 가 호스트에서 렌즈로 내려가며 이 탭은 **앎 호스트**로 옮겨졌고, 그 페어는
   더 이상 존재하지 않는다. 배치의 정본은 `shell/tabs.ts` 의 `SUBTAB_GROUPS` — 여기 사본을
   두면 다음 IA 개편에 또 낡는다.
   과목×챕터의 5단계 파이프라인(sourced→noted→verified→carded→reviewed) 진척을 한 화면에.
   원본: 산출물 `ledger` ← knowledge/_meta/cache/_챕터원장.json (챕터원장.py). 통합 4단계 소비.
   흩어져 있던 볼트 생산 진척(진척 14곳)을 단일 출처로 모은다 — "각 과목이 파이프라인 어디까지 왔나".

   today 재설계 사상: 상단 리드아웃(챕터·검증·카드) · fill 프레임 · 히어로 퍼널 · 온디맨드 챕터 세부.
   데이터 원본은 볼트 빌드 산출물(읽기전용) — 워크스페이스가 설정돼 있으면 자동, 오프라인이면 안내(mastery와 동형).

   ── C-7 아홉 번째 이식(ledger) — Tailwind ─────────────────────────────────────
   레이아웃이 mastery 와 동형이라 인프라를 크게 승계한다: 지식맵/폴백 그래디언트(--bg-map-panel),
   상단 헤어라인(--bg-sig-top), 마운트 페이드업(enter-rise 키프레임), shadow-hero/card, hero-gap/px.
   새로 이름 준 것: 히어로 그래디언트(violet 층 없는 변형 · --bg-hero-ledger)·퍼널 막대 트랙
   (--bar-track)·2컬럼 트랙(380px)·상세 오버레이 폭·퍼널 gap·eyebrow 자간(0.24em)·상세 그림자(lg).
   전역 요소 규칙을 이기는 `!`(control §15-7): h2 히어로 제목·셋업/에러 h3·셀/딥링크 버튼(border/padding/radius).
   런타임 색 주입(퍼널 채움·셀·범례 스와치·단계 점 = style={{ background }})은 절대규칙 #3 구현이라 인라인 유지.
============================================================ */
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useKeymapDoc } from '@/hooks/useKeymap';
import { useLedger, usePing } from '@/store/queries';
import { useSearchParams } from 'react-router-dom';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { useStripUnknownView } from '@/hooks/useStripUnknownView';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { artifactErrorCopy, classifyArtifact, needsWorkspace, toolFailureCopy } from '@/lib/artifactState';
import { openVaultSearch, pctLabel } from '@/lib/utils';
import {
  LEDGER_STAGES,
  PLANNED_COLOR,
  STAGE_META,
  furthestColor,
  stageIndex,
  subjectRollups,
  bottleneckStage,
  type Ledger,
  type LedgerChapter,
  type LedgerSubject,
  type SubjectRollup,
} from '@/lib/ledger';
import { runTool } from '@/lib/api';
import { confirmLossy, toast, glyphOf } from '@/shell';
import { useApp } from '@/store/useApp';
import { applyCardedDone, ledgerPending, pendingCount, pendingPrompt } from '@/lib/ledgerSeed';
import { Button } from '@/components/ui';
import State from '@/components/State';

// 히어로/지식맵 밴드 상단 1px 발광 헤어라인(--bg-sig-top · review 이식이 깐 것 재사용).
// 폴백 패널(로딩·에러·셋업) — 지식맵과 동형(그래디언트·그림자 공유). 자식은 m-auto 로 중앙(옛 `.offWrap > *`).
const OFF_WRAP =
  'relative flex min-h-0 flex-1 overflow-y-auto rounded-lg border border-line bg-[image:var(--bg-map-panel)] p-5.5 animate-[enter-rise_var(--dur-slow)_var(--ease)_var(--stagger)_both] motion-reduce:animate-none [scrollbar-width:thin]';

/** 선택된 챕터 스냅샷(상세 패널). */
interface Sel {
  subject: string;
  ch: LedgerChapter;
}

/** 히어로 퍼널 — 5단계 각각 도달 챕터 수(마일스톤 독립 카운트). 시선 집중점. */
function Funnel({ l: led }: { l: Ledger }) {
  const total = led.n_chapters || 1;
  return (
    <div
      className="flex h-23 min-w-55 flex-1 items-end justify-center gap-funnel-gap max-wide:order-3 max-wide:w-full"
      role="img"
      aria-label={`파이프라인 단계별 도달 챕터 (전체 ${led.n_chapters})`}
    >
      {LEDGER_STAGES.map((st) => {
        const n = led.stage_counts[st] || 0;
        const w = Math.round((n / total) * 100);
        const m = STAGE_META[st];
        return (
          <div
            key={st}
            className="flex max-w-21 flex-1 flex-col items-center gap-1"
            data-tip={`${m.label} — ${m.desc}: ${n}/${led.n_chapters}챕터`}
            role="img"
            aria-label={`${m.label} — ${m.desc}: ${n}/${led.n_chapters}챕터`}
          >
            <div className="flex h-13.5 w-full items-end overflow-hidden rounded-sm bg-bar-track">
              <div
                className="min-h-0.5 w-full rounded-t-sm transition-[height] duration-draw ease-[var(--ease)] motion-reduce:transition-none"
                style={{ height: `${w}%`, background: m.color }}
              />
            </div>
            <div className="text-lg leading-none font-black text-txt tabular-nums">{n}</div>
            <div className="text-2xs whitespace-nowrap text-mut">
              <Icon name={m.glyph} /> {m.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 과목 1행 — 챕터 셀 스트립(furthest 단계 색). 셀 클릭 = 챕터 상세. mastery SubjectHeat 미러. */
function SubjectRow({
  roll,
  subject,
  onPick,
}: {
  roll: SubjectRollup;
  subject: LedgerSubject;
  onPick: (ch: LedgerChapter) => void;
}) {
  return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-baseline gap-2">
        <b className="truncate text-md font-bold text-txt">{roll.subject}</b>
        <span className="ds-tiny text-mut">
          {roll.abbr} · {roll.total}챕터 · 진척 {pctLabel(roll.progress)}
          {!roll.srcPresent ? ' · 출처 없음' : ''}
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        {subject.chapters.map((ch) => (
          <button
            key={ch.chapter_id}
            type="button"
            /* ⚠ 미착수 칸에만 실선 테두리(H20 후속) — 색이 `--panel2`(패널과 거의 같은 톤)라
               라이트에서 칸 자체가 안 보인다. "빈 슬롯"이 보이지 않으면 진척 대비가 사라진다.
               색을 진하게 되돌리지 않는 이유: 그러면 미착수가 완료보다 강해지는 역전이 재발한다. */
            /* ⚠ **히트영역은 24px 다(H23 · 2026-07-31 `/감사 근본`).** 시각 크기는 15px 그대로 두고
               (격자 밀도가 이 화면의 정보이고, 키우면 진척 대비가 무너진다) `::after` 로 영역만
               넓힌다 — WCAG 2.5.8 은 24×24 를 요구하는데 `gap-1` 이라 피치가 19px 이었고 간격
               예외도 성립하지 않았다. axe 는 `target-size` 를 기본 실행하지 않아 67검사 전량
               녹색이어도 안 보인다(정적·렌더 검사 둘 다의 사각). `relative` 는 그 의사요소의 기준. */
            className={`ds-hit24 relative size-3.75 cursor-pointer rounded-xs! p-0! transition-transform hover:z-[1] hover:scale-[1.5] hover:outline-1 hover:outline-txt motion-reduce:transition-none ${
              ch.furthest === 'planned' ? 'border! border-line!' : 'border-0!'
            }`}
            style={{ background: furthestColor(ch.furthest) }}
            data-tip={`${ch.arc}  ·  ${STAGE_META[ch.furthest === 'planned' ? 'sourced' : ch.furthest]?.label ?? '미착수'}${ch.furthest === 'planned' ? '(미착수)' : ''}  ·  노트 ${ch.notes}·카드 ${ch.cards}`}
            aria-label={`${roll.subject} ${ch.arc} — ${ch.furthest}`}
            onClick={() => onPick(ch)}
          />
        ))}
      </div>
    </div>
  );
}

/** 챕터 상세 — 5단계 체크리스트 + 노트/검증/카드/복습 수치 + 볼트 딥링크. 온디맨드 세부. */
function Detail({ sel, onClose }: { sel: Sel; onClose: () => void }) {
  const { ch } = sel;
  /* role="dialog"를 선언하면 포커스 관리도 함께 약속하는 것이다 — 예전엔 트랩도 Esc도 없어
     키보드 사용자가 열고 나면 배경으로 새고 닫을 방법이 없었다(DetailDrawer·ShortcutsHelp·Today는
     전부 트랩을 붙였는데 여기만 이탈). 같은 훅으로 계약을 이행한다.

     ⚠⚠ **그런데 `aria-modal="true"` 는 거짓이었다**(U013 · 2026-08-21 ux 축). 이 패널은 우하단
     귀퉁이에 뜨고 **배경이 그대로 보이고 그대로 클릭된다** — 히트맵 칩을 눌러 상세를 갈아 끼우는
     것이 이 화면의 사용법이라 그게 의도다(칩 22개가 그대로 살아 있다). `aria-modal` 은 *"나머지
     문서는 없는 셈 치라"* 를 보조기술에 약속하는 속성이라, 그 상태에서 참이라고 말하면 스크린리더
     사용자만 배경을 잃는다 — 그리고 화면에는 배경이 멀쩡히 보이므로 **누구도 그 사실을 못 본다.**
     ⚠ `MiniHud.tsx:54-62` 의 「`inert` 없이 `aria-modal` 을 쓴다」 판정과 충돌하지 않는다:
       거기는 배경이 **덮여 있고** 여기는 배경이 **살아 있다**. 가르는 것은 관용구가 아니라 사실이다.
     → **비모달 dialog** 로 정직해진다(role 은 유지 · 트랩과 Esc·복원은 그대로 — Esc 가 있으므로
       2.1.2 의 「키보드 함정」이 아니고, 트랩은 왔던 칩으로 돌려보내는 장치다). */
  const panelRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(true, panelRef);
  /* E16 — 이 컴포넌트 자체가 조건부 렌더라 마운트 = 열림이다. */
  useKeymapDoc('이 화면 · 원장 상세', [{ display: 'Esc', label: '상세 닫기' }]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="absolute right-3.5 bottom-2 z-[5] w-full max-w-ledger-detail animate-[enter-rise_var(--dur)_var(--ease)_both] rounded-lg border border-line bg-panel px-4 pt-3.5 pb-4 shadow-detail motion-reduce:animate-none max-wide:fixed max-wide:right-auto max-wide:bottom-3.5 max-wide:left-1/2 max-wide:-translate-x-1/2"
      role="dialog"
      aria-label={`${ch.arc} 상세`}
      ref={panelRef}
      tabIndex={-1}
    >
      <button
        type="button"
        className="absolute top-2 right-2 size-6.5 leading-none text-mut!"
        onClick={onClose}
        aria-label="닫기"
      >
        ✕
      </button>
      <div className="ds-tiny text-mut">
        {sel.subject} · {ch.chapter_id}
      </div>
      <div className="mt-0.5 mb-2.5 pr-6.5 text-lg font-extrabold text-txt">{ch.arc}</div>
      <div className="mb-3 flex flex-col gap-1.5">
        {LEDGER_STAGES.map((st, i) => {
          const done = ch.milestones[st];
          const cur = stageIndex(ch.furthest) === i;
          const m = STAGE_META[st];
          return (
            /* ⚠⚠ **행 전체의 `opacity-50` 이 글자를 못 읽게 하고 있었다**(H6 · 2026-07-30).
               실측 `#50545c` on `#0e0f13` = **2.52:1**(다크 · 기준 4.5). 미달성 단계의 이름과
               설명이 사실상 안 보였다 — 그런데 이 오버레이는 **어느 a11y 로스터에도 없어서**
               (경로가 아니라 클릭으로 열린다) 검사된 적이 자체가 없었다. H6 이 그 사각을 닫자
               첫 실행에서 나왔다.
               ⚠ 불투명도로는 이 의도를 표현할 수 없다 — 통과하려면 다크 0.80·라이트 0.90 이
               필요하고(실측), 0.90 은 흐리게가 아니다. `AllocBoard` 의 `done` 셀이 같은 결론이었다.
               → 흐리게 하는 대상을 **마커(원)로 좁힌다.** 달성/미달성은 원래 ✓ 채움이 나르고
               (체크리스트의 표준 어포던스), 현재 단계는 `font-bold text-txt` 가 이미 가른다. */
            <div key={st} className="flex items-center gap-2.25">
              <span
                className={`flex size-4.5 flex-none items-center justify-center rounded-full border border-line text-xs font-black text-panel ${done ? '' : 'opacity-50'}`}
                style={done ? { background: m.color, borderColor: m.color } : undefined}
              >
                {done ? '✓' : ''}
              </span>
              <span className={`text-sm ${cur ? 'font-bold text-txt' : 'text-mut'}`}>
                {m.label} <span className="ds-tiny text-mut">{m.desc}</span>
              </span>
            </div>
          );
        })}
      </div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-mut">
        <span>
          노트 <b className="text-txt tabular-nums">{ch.notes}</b>
          {ch.concept ? <span className="text-mut"> (개념 {ch.concept})</span> : null}
        </span>
        <span>
          검증률 <b className="text-txt tabular-nums">{pctLabel(ch.verified_ratio)}</b>
        </span>
        <span>
          카드 <b className="text-txt tabular-nums">{ch.cards}</b>
          {ch.reps ? <span className="text-mut"> · {ch.reps}회</span> : null}
        </span>
        {ch.reviewed_recent ? (
          <span>
            최근 복습 <b className="text-txt tabular-nums">{ch.reviewed_recent}</b>
          </span>
        ) : null}
      </div>
      <button
        type="button"
        className="w-full rounded-md! p-2! text-sm font-semibold!"
        onClick={() => openVaultSearch(ch.arc.replace(/^\d+\s*/, ''))}
        title="Obsidian에서 이 챕터 검색 (설치돼 있어야 함)"
      >
        <Icon name="search" /> 볼트에서 열기
      </button>
    </div>
  );
}

/** 백로그 — 미처리 참고자료(폴더는 있으나 노트 없음) + 출처 없는 과목. 조용한 절단 금지. */
function Backlog({ l: led }: { l: Ledger }) {
  const { unprocessed_src: unp, subjects_without_src: nosrc } = led.backlog;
  if (!unp.length && !nosrc.length) return null;
  return (
    <div className="ds-rule">
      <h3>
        <Icon name="inbox" /> 백로그 <span className="ds-tiny text-mut">(파이프라인에 아직 안 들어온 것)</span>
      </h3>
      {unp.length > 0 && (
        <div className="mt-2.5 flex flex-col gap-1.25">
          <div className="ds-tiny text-mut">미처리 참고자료 — 폴더는 있으나 노트 미작성 ({unp.length})</div>
          <div className="flex flex-wrap gap-1.25">
            {unp.map((s) => (
              <span key={s} className="ds-chip">
                {s}
              </span>
            ))}
          </div>
        </div>
      )}
      {nosrc.length > 0 && (
        <div className="mt-2.5 flex flex-col gap-1.25">
          <div className="ds-tiny text-mut">출처 없는 과목 — 참고자료 폴더 미연결 ({nosrc.length})</div>
          <div className="flex flex-wrap gap-1.25">
            {nosrc.map((s) => (
              <span key={s} className="ds-chip border-line-warn! text-warn!">
                {s}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * **반영 줄**(I001 · 2026-08-22 발상 축) — 원장이 계획 엔진의 입력이 되는 자리.
 *
 * ## 왜 여기 이 줄이 필요한가
 *
 * 이 화면은 원장을 **보여 주기만** 했다. 원장→앱 다리는 있었지만 `importVaultSubject` 안,
 * 즉 **볼트 임포트 순간에만** 놓였다 — 그런데 검증·카드 발급은 임포트와 다른 리듬으로
 * 계속 일어난다. 실측(2026-08-22): 원장이 `carded 31 / 51` 을 아는데 앱의 `chapters[].done`
 * 은 **0/51** 이었고, 그 51챕터는 원장과 **100% 이름이 맞았다**. 다리는 있는데 위로 아무것도
 * 안 지나가고 있었던 것이다.
 *
 * ⚠⚠ **자동으로 안 찍는다** — `carded` 는 «카드를 만들었다»이지 «익혔다»가 아니다
 * (`lib/ledgerSeed.ts` 머리주석이 그 판단의 SSOT). 이 줄이 바꾸는 것은 **언제 물어보는가**
 * 하나뿐이다: 임포트 1회 → 원장이 앞설 때마다.
 * ⚠ 미반영이 0이면 **노드 자체가 없다.** 「0건 반영」이 상주하면 그 줄은 곧 배경이 된다.
 */
function ApplyToPlan() {
  const items = useApp((s) => s.state.items);
  const mutate = useApp((s) => s.mutate);
  const { data: led } = useLedger();
  const pending = ledgerPending(led, items);
  if (!pending.length) return null;
  const n = pendingCount(pending);
  const apply = async (): Promise<void> => {
    /* Q-13 ②단 — 원장이 밖에 그대로 있으니 언제든 다시 맞출 수 있다(재구성 가능). */
    const ok = await confirmLossy(pendingPrompt(pending), {
      title: '원장과 맞출까요?',
      okLabel: `${n}개 끝낸 것으로 표시`,
      cancelLabel: '그대로 두기',
    });
    if (!ok) return;
    /* ⚠ 카운터를 **객체 필드**로 — 콜백 안의 `let n = 0` 은 React Compiler 를 바일아웃시킨다. */
    const acc = { marked: 0 };
    mutate((st) => {
      for (const p of pending) {
        const it = st.items.find((x) => x.id === p.sid);
        if (it) acc.marked += applyCardedDone(it.chapters || [], p.chapters);
      }
    });
    toast(`챕터 ${acc.marked}개를 끝낸 것으로 표시했어요 — 유지 복습 큐로 넘어갑니다.`, 'ok');
  };
  return (
    <div className="ds-rule">
      <h3>
        <Icon name="check" /> 계획에 반영
      </h3>
      <div className="flex flex-col gap-1.5">
        <span className="ds-kpi">{n}챕터</span>
        <div className="ds-foot">
          원장은 <b>카드 발급까지</b> 끝났다고 하는데 앱에는 안 찍혀 있어요
          {pending.length > 1 ? ` (${pending.length}과목)` : ` (${pending[0]!.subject})`}.
          <br />
          찍으면 새로 배울 목록에서 빠지고 유지 복습으로 넘어갑니다.
        </div>
        <div>
          <Button sm variant="primary" onClick={() => void apply()}>
            {n}개 반영
          </Button>
        </div>
      </div>
    </div>
  );
}

/** 병목 — 인접 단계 통과율이 가장 낮은 지점. "다음에 어디 손대면 크게 진척하나". */
function Bottleneck({ l: led }: { l: Ledger }) {
  const b = bottleneckStage(led);
  if (!b) return null;
  const m = STAGE_META[b.stage];
  const gap = b.from - b.passed;
  return (
    <div className="ds-rule">
      <h3>
        <Icon name="target" /> 병목
      </h3>
      <div className="flex flex-col gap-1.5">
        <span className="ds-kpi" style={{ color: m.color }}>
          <Icon name={m.glyph} /> {m.label}
        </span>
        <div className="ds-foot">
          직전 단계 <b>{b.from}</b>챕터 중 <b>{b.passed}</b>만 {m.label} 통과 — <b>{gap}</b>챕터 대기.
          <br />
          {/* ⛔ `reviewed` 분기가 2026-08-29 에 빠졌다 — 부모 ledger 스키마에서 그 단계가
              사라졌다(pipeline 목적 정정: 복습은 범위 밖 · STAGES 5 → 4). */}
          {b.stage === 'verified'
            ? '검증 파이프라인(지시문7)을 돌리면 가장 크게 진척합니다.'
            : b.stage === 'carded'
              ? 'Anki 카드 생성이 다음 레버입니다.'
              : '노트 작성이 다음 레버입니다.'}
        </div>
      </div>
    </div>
  );
}

/* ⚠⚠ **성공하지 않은 화면은 `components/State` 하나가 그린다**(E17) — 이 셋업 화면만 그 밖에서
   `<h3>` + `<ol>` 로 손코딩돼 있었다(U030 · 2026-08-21 ux 축). 대가가 둘이었다:
   ① `State` 가 **타입으로 강제하는 `next`(다음 걸음)** 가 없어, 이 화면의 유일한 출구인
      「원장 재빌드」가 빈 상태 안에 없었다(툴바에만 있고, 툴바는 원장이 있을 때의 언어다).
   ② `kind='empty'` 가 아니라 그냥 `<div>` 라 **로딩·에러와 시각 언어가 갈렸다**.
   ⚠ 지시 목록(CLI 두 줄)은 그대로 `desc` 로 넘긴다 — `State.desc` 는 `ReactNode` 다. */
function Setup({ onRebuild, busy }: { onRebuild: () => void; busy: boolean }) {
  return (
    <State
      kind="empty"
      glyph={glyphOf('ledger')}
      title="아직 챕터 원장이 없어요"
      desc={
        <>
          <ol className="ds-foot m-0! text-left" style={{ lineHeight: 1.9 }}>
            <li>
              원장 빌드: <code>python pipeline/_도구/챕터원장.py</code>
            </li>
            <li>
              한 명령 전체 빌드: <code>python pipeline/_도구/빌드.py</code>
            </li>
          </ol>
          <span className="ds-foot text-mut">
            원장은 <code>subjects.json</code>(정본 slug·src)과 볼트 인덱스를 조인해 과목×챕터의 {LEDGER_STAGES.length}
            단계 진척을 집계합니다. 워크스페이스가 설정돼 있으면 자동으로 불러옵니다.
          </span>
        </>
      }
      next={
        <Button sm variant="primary" onClick={onRebuild} disabled={busy}>
          {busy ? '재빌드 중…' : '원장 재빌드'}
        </Button>
      }
    />
  );
}

/* ── A-19(W5) — 은퇴한 `mastery` 가 이 호스트의 **뷰**로 내려왔다 ──────────────────────
   `Find`·`Degree`·`ReviewRun` 이 흡수한 화면을 띄우는 것과 같은 관용구다(lazy — 원장 청크에
   히트맵을 싣지 않는다). ⚠ 분기를 **껍데기**가 한다: 이 화면은 훅이 여럿이라 중간 조기 반환을
   놓으면 뷰를 오갈 때 훅 순서가 갈린다(`ReviewRun` 이 같은 이유로 같은 형태를 썼다). */
/* ⛔⛔ 2026-08-29 — 「숙달도 지도」 뷰가 사라졌다. 그 화면이 읽던 지식상태 산출물이 **생산자째
   삭제**됐다(pipeline 목적 정정: 「전공 교재 → 원자형 노트」만 진다 · 숙달도 추정은 범위 밖).
   ▣ 삭제 시점 실측이 판단을 뒷받침한다: 숙달값은 서로 다른 값이 **넷**뿐이었고 (작성 상태 ×
     카드 유무)의 결정론적 함수였다 — 관측이 0이라 사후분포가 전량 사전분포였다. 즉 그 히트맵이
     보여 주던 것은 숙달도가 아니라 **작성 상태**였고, 그건 이 원장 화면이 이미 보여 준다.
   함께 은퇴: `mastery/{Mastery,KnowledgeMap,NextActions}.tsx`·`classes.ts` · 로스터 행.
   ⚠⚠ **`useKnowledge` 는 은퇴하지 않았다**(U084 · 2026-08-31 정정). 이 줄이 그렇게 적혀 있었는데
   `Review`·`TodaySignature`·`Subject` 가 아직 부른다 — 이 주석을 근거로 지우면 세 화면이 죽는다.
   실제로 걷힌 것은 **공급자**(`fetchKnowledgeArtifact` 가 항상 throw)이지 훅이 아니다. */

export default function LedgerHost() {
  /* 이 호스트에 남은 뷰는 **0** 이다(「숙달도 지도」가 나가면서). 그래도 `?view=mastery` 를 든
     북마크·이력이 실재하므로, 착지한 화면과 주소를 맞춘다 — 근거는 훅 머리주석(U048). */
  const [params, setParams] = useSearchParams();
  useStripUnknownView(params, setParams, []);
  return <Ledger />;
}

function Ledger() {
  const { data: led, isLoading, isFetching, isError, error, refetch } = useLedger();
  const ping = usePing();
  const [sel, setSel] = useState<Sel | null>(null);
  const [rebuilding, setRebuilding] = useState(false);

  const rolls = led ? subjectRollups(led) : [];

  usePageChromeEffect(
    () => ({
      /* W22/H3 — `primary` 는 **필수 키**다(`store/usePageChrome.ts` 머리주석). 이 화면은 렌즈라
         44px 앵커를 세우지 않는다 — 잊은 것이 아니라 없다고 정한 것이다. */
      primary: null,
      readouts: !led
        ? []
        : [
            { label: '챕터', value: led.n_chapters, accent: true },
            { label: '검증', value: led.stage_counts.verified },
            { label: '카드', value: led.stage_counts.carded },
          ],
    }),
    [led],
  );

  const loading = (isLoading || isFetching) && !led;
  // U008 — 원문(`HTTP 500`)이 아니라 사용자 문장 + 원문 병기(`lib/artifactState`가 SSOT).
  const errMsg = isError ? artifactErrorCopy(error) : '';
  const realError = classifyArtifact({ hasData: !!led, loading, query: { isError, error }, ping }) === 'error';

  // 백엔드가 살아 있으면 원장을 재빌드(챕터원장.py)하고 다시 페치 — "단일 출처, 한 명령" 이야기의 실행부.
  const rebuild = async () => {
    setRebuilding(true);
    try {
      const r = await runTool('ledger-build');
      if (r.ok) {
        toast('챕터 원장을 다시 빌드했어요.', 'ok');
        await refetch();
      } else {
        toast((r.out || '').slice(0, 140) || `${needsWorkspace('원장 재빌드에 실패했어요')}.`, 'bad');
      }
    } catch (e) {
      // H23 — 사유를 버리지 않는다(동시성 캡 소진을 워크스페이스 문제로 말하던 자리).
      toast(`${toolFailureCopy(e, '원장 재빌드에 실패했어요')}.`, 'bad');
    } finally {
      setRebuilding(false);
    }
  };

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col gap-3.5 px-4.5 pt-4 pb-3.5" aria-label="정본 원장">
      {/* ── 히어로 밴드 — 파이프라인 퍼널 + 생성일 + 재빌드 ── */}
      <div
        /* Q-14 — 노치 HUD 통일. `ds-glow`(테두리 hover)도 함께 뗀다: 테두리가 없으면 빛낼 것이 없다
             (ds.css 가 3종 이행 때 15곳에서 같은 이유로 뗀 그 짝). */
        className={`ds-frame ds-hairline relative mb-0! flex flex-none animate-[enter-rise_var(--dur-slow)_var(--ease)_both] items-center gap-hero-gap bg-[image:var(--bg-hero-ledger)] px-hero-px! py-4.5! motion-reduce:animate-none max-wide:flex-wrap max-wide:gap-x-6 max-wide:gap-y-4`}
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-xs font-extrabold tracking-eyebrow-wide text-acc uppercase">정본 축</span>
          <h2 className="mt-0.5! mb-0! flex items-center gap-2 text-hero-title! leading-none font-black! tracking-tight!">
            <Icon name="notebook" /> 정본 원장
          </h2>
          <span className="text-xs text-mut tabular-nums">
            {led ? (
              <>
                생성 {led.generated || '—'} · 과목 {rolls.length} · 챕터 {led.n_chapters}
              </>
            ) : (
              `과목×챕터의 ${LEDGER_STAGES.length}단계 파이프라인 진척을 한 화면에`
            )}
          </span>
        </div>
        {/* ⚠⚠ **히어로가 로딩→ready 에서 +27px 자랐다**(U061 · 2026-08-31 · 베이스라인 두 장을
            픽셀 스캔해 116 → 143). `State shape='frame'` 이 없애려던 바로 그 점프인데, 히어로는
            프레임 **밖**이라 그 처방이 여기까지 오지 않았다 — 아래 본문은 골격이 자리를 잡아
            주는데 위 밴드만 나중에 부풀었다.
            처방은 골격을 하나 더 그리는 것이 아니라 **퍼널의 자리를 로딩 중에도 잡는 것**이다
            (같은 `h-23`·`min-w-55`). 빈 자리는 아무것도 안 그린다 — 로딩 표시는 오른쪽
            「로드 중」이 이미 하고 있고, 여기에 스피너를 하나 더 두면 같은 사실을 두 번 말한다. */}
        {led ? (
          <Funnel l={led} />
        ) : (
          <div className="h-23 min-w-55 flex-1 max-wide:order-3 max-wide:w-full" aria-hidden />
        )}
        <div className="ml-auto flex flex-col items-end gap-2 max-wide:items-start">
          {loading && (
            <span className="text-xs text-mut tabular-nums">
              <span className="ds-spin" /> 로드 중
            </span>
          )}
          <Button sm variant="primary" onClick={rebuild} disabled={rebuilding}>
            {rebuilding ? (
              <>
                <span className="ds-spin" /> 빌드 중…
              </>
            ) : (
              <>
                <Icon name="refresh" /> 원장 재빌드
              </>
            )}
          </Button>
        </div>
      </div>

      {led ? (
        <div className="relative grid min-h-0 flex-1 grid-cols-ledger gap-3.5 max-wide:grid-cols-1 max-wide:overflow-y-auto">
          {/* 좌 — 과목별 파이프라인 매트릭스(immersive) */}
          <div className="ds-glow relative flex min-h-0 min-w-0 animate-[enter-rise_var(--dur-slow)_var(--ease)_var(--stagger)_both] flex-col rounded-lg border border-line bg-[image:var(--bg-map-panel)] motion-reduce:animate-none max-wide:min-h-85">
            <div className="flex flex-none flex-wrap items-baseline gap-x-3 gap-y-1.5 px-5 pt-4 pb-1">
              <span className="ds-caps">과목별 파이프라인 — SUBJECT PIPELINE</span>
              <span className="text-xs text-mut">셀 하나가 챕터 · 색 = 가장 멀리 간 단계 · 클릭으로 세부</span>
            </div>
            <div className="flex flex-none flex-wrap gap-x-3 gap-y-1 px-5 pt-1.5 pb-2.5 text-2xs text-mut">
              {LEDGER_STAGES.map((st) => (
                <span key={st} className="inline-flex items-center gap-1">
                  <i className="inline-block size-2.5 rounded-xs" style={{ background: STAGE_META[st].color }} />{' '}
                  {STAGE_META[st].label}
                </span>
              ))}
              <span className="inline-flex items-center gap-1">
                {/* ⚠ 범례 색은 **범례가 설명하는 그 값**이어야 한다 — 여기 리터럴을 다시 적어
                    두었던 탓에 H20 의 오타(`--panel-2`)가 두 곳에 복제돼 있었다. */}
                <i
                  className="inline-block size-2.5 rounded-xs border border-line"
                  style={{ background: PLANNED_COLOR }}
                />{' '}
                미착수
              </span>
            </div>
            <div className="min-h-0 flex-1 [scrollbar-width:thin] overflow-y-auto px-5 pt-1 pb-5">
              {rolls.map((roll) => (
                <SubjectRow
                  key={roll.subject}
                  roll={roll}
                  subject={led.subjects[roll.subject]!}
                  onPick={(ch) => setSel({ subject: roll.subject, ch })}
                />
              ))}
            </div>
          </div>
          {/* 우 — 병목·백로그(다음 행동) */}
          <div className="flex min-h-0 min-w-0 [scrollbar-width:thin] flex-col gap-3 overflow-y-auto pr-0.5">
            <ApplyToPlan />
            <Bottleneck l={led} />
            <Backlog l={led} />
          </div>
          {sel && <Detail sel={sel} onClose={() => setSel(null)} />}
        </div>
      ) : loading ? (
        /* E17 — 로딩·에러 표면이 `components/State` 하나다(옛 인라인 스피너 + 손코딩 에러 바디를
           대체). 프레임(OFF_WRAP)은 이 탭의 것이고 **안의 상태 언어만** 공용이다. */
        <div className={OFF_WRAP}>
          <State kind="loading" title="챕터 원장을 불러오는 중" />
        </div>
      ) : realError ? (
        <div className={OFF_WRAP}>
          <State
            title="챕터 원장을 불러오지 못했어요"
            desc={errMsg}
            kind="error"
            next={
              <Button sm variant="primary" onClick={() => refetch()}>
                다시 시도
              </Button>
            }
          />
        </div>
      ) : (
        <div className={OFF_WRAP}>
          <Setup onRebuild={() => void rebuild()} busy={rebuilding} />
        </div>
      )}
    </section>
  );
}
