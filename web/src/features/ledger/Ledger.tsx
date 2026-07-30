/* ============================================================
   Ledger — 탭: 📒 정본 원장 (자료 그룹 · 연동 현황과 세그먼트 페어)
   과목×챕터의 5단계 파이프라인(sourced→noted→verified→carded→reviewed) 진척을 한 화면에.
   원본: 산출물 `ledger` ← knowledge/_meta/cache/_챕터원장.json (챕터원장.py). 통합 4단계 소비.
   흩어져 있던 볼트 생산 진척(진척 14곳)을 단일 출처로 모은다 — "각 과목이 파이프라인 어디까지 왔나".

   today 재설계 사상: 상단 리드아웃(챕터·검증·카드) · fill 프레임 · 히어로 퍼널 · 온디맨드 챕터 세부.
   데이터 원본은 볼트 빌드 산출물(읽기전용) — 워크스페이스가 설정돼 있으면 자동, 오프라인이면 안내(mastery와 동형).

   ── C-7 아홉 번째 이식(ledger) — Tailwind ─────────────────────────────────────
   레이아웃이 mastery 와 동형이라 인프라를 크게 승계한다: 지식맵/폴백 그래디언트(--bg-map-mastery),
   상단 헤어라인(--bg-sig-top), 마운트 페이드업(enter-rise 키프레임), shadow-hero/card, hero-gap/px.
   새로 이름 준 것: 히어로 그래디언트(violet 층 없는 변형 · --bg-hero-ledger)·퍼널 막대 트랙
   (--bar-track)·2컬럼 트랙(380px)·상세 오버레이 폭·퍼널 gap·eyebrow 자간(0.24em)·상세 그림자(lg).
   전역 요소 규칙을 이기는 `!`(control §15-7): h2 히어로 제목·셋업/에러 h3·셀/딥링크 버튼(border/padding/radius).
   런타임 색 주입(퍼널 채움·셀·범례 스와치·단계 점 = style={{ background }})은 절대규칙 #3 구현이라 인라인 유지.
============================================================ */
import { useEffect, useRef, useState } from 'react';
import { useKeymapDoc } from '@/hooks/useKeymap';
import { useLedger, usePing } from '@/store/queries';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { classifyArtifact, needsWorkspace } from '@/lib/artifactState';
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
import { ui } from '@/shell';
import { Button } from '@/components/ui';
import State from '@/components/State';

// 히어로/지식맵 밴드 상단 1px 발광 헤어라인(--bg-sig-top · review 이식이 깐 것 재사용).
// 폴백 패널(로딩·에러·셋업) — 지식맵과 동형(그래디언트·그림자 공유). 자식은 m-auto 로 중앙(옛 `.offWrap > *`).
const OFF_WRAP =
  'relative flex min-h-0 flex-1 overflow-y-auto rounded-lg border border-line bg-[image:var(--bg-map-mastery)] p-5.5 shadow-card animate-[enter-rise_var(--dur-slow)_var(--ease)_var(--stagger)_both] motion-reduce:animate-none [scrollbar-width:thin]';

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
              <span aria-hidden="true">{m.glyph}</span> {m.label}
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
        <span className="ds-tiny ds-muted">
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
            className={`size-3.75 cursor-pointer rounded-xs! p-0! transition-transform hover:z-[1] hover:scale-[1.5] hover:outline-1 hover:outline-txt motion-reduce:transition-none ${
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
  // role="dialog"를 선언하면 포커스 관리도 함께 약속하는 것이다 — 예전엔 트랩도 Esc도 없어
  // 키보드 사용자가 열고 나면 배경으로 새고 닫을 방법이 없었다(DetailDrawer·ShortcutsHelp·Today는
  // 전부 트랩을 붙였는데 여기만 이탈). 같은 훅으로 계약을 이행한다.
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
      aria-modal="true"
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
      <div className="ds-tiny ds-muted">
        {sel.subject} · {ch.chapter_id}
      </div>
      <div className="mt-0.5 mb-2.5 pr-6.5 text-lg font-extrabold text-txt">{ch.arc}</div>
      <div className="mb-3 flex flex-col gap-1.5">
        {LEDGER_STAGES.map((st, i) => {
          const done = ch.milestones[st];
          const cur = stageIndex(ch.furthest) === i;
          const m = STAGE_META[st];
          return (
            <div key={st} className={`flex items-center gap-2.25 ${done ? 'opacity-100' : 'opacity-50'}`}>
              <span
                className="flex size-4.5 flex-none items-center justify-center rounded-full border border-line text-xs font-black text-panel"
                style={done ? { background: m.color, borderColor: m.color } : undefined}
              >
                {done ? '✓' : ''}
              </span>
              <span className={`text-sm ${cur ? 'font-bold text-txt' : 'text-mut'}`}>
                {m.label} <span className="ds-tiny ds-muted">{m.desc}</span>
              </span>
            </div>
          );
        })}
      </div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-mut">
        <span>
          노트 <b className="text-txt tabular-nums">{ch.notes}</b>
          {ch.concept ? <span className="ds-muted"> (개념 {ch.concept})</span> : null}
        </span>
        <span>
          검증률 <b className="text-txt tabular-nums">{pctLabel(ch.verified_ratio)}</b>
        </span>
        <span>
          카드 <b className="text-txt tabular-nums">{ch.cards}</b>
          {ch.reps ? <span className="ds-muted"> · {ch.reps}회</span> : null}
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
        🔎 볼트에서 열기
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
        📥 백로그 <span className="ds-muted ds-tiny">(파이프라인에 아직 안 들어온 것)</span>
      </h3>
      {unp.length > 0 && (
        <div className="mt-2.5 flex flex-col gap-1.25">
          <div className="ds-tiny ds-muted">미처리 참고자료 — 폴더는 있으나 노트 미작성 ({unp.length})</div>
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
          <div className="ds-tiny ds-muted">출처 없는 과목 — 참고자료 폴더 미연결 ({nosrc.length})</div>
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

/** 병목 — 인접 단계 통과율이 가장 낮은 지점. "다음에 어디 손대면 크게 진척하나". */
function Bottleneck({ l: led }: { l: Ledger }) {
  const b = bottleneckStage(led);
  if (!b) return null;
  const m = STAGE_META[b.stage];
  const gap = b.from - b.passed;
  return (
    <div className="ds-rule">
      <h3>🎯 병목</h3>
      <div className="flex flex-col gap-1.5">
        <span className="ds-kpi" style={{ color: m.color }}>
          {m.glyph} {m.label}
        </span>
        <div className="ds-foot">
          직전 단계 <b>{b.from}</b>챕터 중 <b>{b.passed}</b>만 {m.label} 통과 — <b>{gap}</b>챕터 대기.
          <br />
          {b.stage === 'verified'
            ? '검증 파이프라인(지시문7)을 돌리면 가장 크게 진척합니다.'
            : b.stage === 'carded'
              ? 'Anki 카드 생성이 다음 레버입니다.'
              : b.stage === 'reviewed'
                ? '인출(복습) 관측이 쌓이면 숙달도까지 살아납니다.'
                : '노트 작성이 다음 레버입니다.'}
        </div>
      </div>
    </div>
  );
}

function Setup() {
  return (
    <div className="m-auto max-w-off px-1.5 py-2">
      <h3 className="mt-0! mb-2! text-base! font-extrabold! tracking-tight!">아직 챕터 원장이 없어요</h3>
      <ol className="ds-foot" style={{ lineHeight: 1.9 }}>
        <li>
          원장 빌드: <code>python pipeline/_도구/챕터원장.py</code>
          <span className="ds-muted"> (또는 아래 “원장 재빌드” 버튼)</span>
        </li>
        <li>
          한 명령 전체 빌드: <code>python pipeline/_도구/빌드.py</code>
        </li>
      </ol>
      <div className="ds-foot ds-muted">
        원장은 <code>subjects.json</code>(정본 slug·src) + 볼트 인덱스 + Anki 신호를 조인해 과목×챕터의 5단계 진척을
        집계합니다. 워크스페이스가 설정돼 있으면 자동으로 불러옵니다.
      </div>
    </div>
  );
}

export default function Ledger() {
  const { data: led, isLoading, isFetching, isError, error, refetch } = useLedger();
  const ping = usePing();
  const [sel, setSel] = useState<Sel | null>(null);
  const [rebuilding, setRebuilding] = useState(false);

  const rolls = led ? subjectRollups(led) : [];

  usePageChromeEffect(
    () => ({
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
  const errMsg = isError ? (error instanceof Error ? error.message : String(error)) : '';
  const realError = classifyArtifact({ hasData: !!led, loading, query: { isError, error }, ping }) === 'error';

  // 백엔드가 살아 있으면 원장을 재빌드(챕터원장.py)하고 다시 페치 — "단일 출처, 한 명령" 이야기의 실행부.
  const rebuild = async () => {
    setRebuilding(true);
    try {
      const r = await runTool('ledger-build');
      if (r.ok) {
        ui.toast('챕터 원장을 다시 빌드했어요.', 'ok');
        await refetch();
      } else {
        ui.toast((r.out || '').slice(0, 140) || `${needsWorkspace('원장 재빌드에 실패했어요')}.`, 'bad');
      }
    } catch {
      ui.toast('원장 재빌드에 실패했어요(워크스페이스 설정 필요).', 'bad');
    } finally {
      setRebuilding(false);
    }
  };

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col gap-3.5 px-4.5 pt-4 pb-3.5" aria-label="정본 원장">
      {/* ── 히어로 밴드 — 파이프라인 퍼널 + 생성일 + 재빌드 ── */}
      <div
        className={`ds-hairline ds-glow relative flex flex-none animate-[enter-rise_var(--dur-slow)_var(--ease)_both] items-center gap-hero-gap rounded-lg border border-line bg-[image:var(--bg-hero-ledger)] px-hero-px py-4.5 shadow-hero motion-reduce:animate-none max-wide:flex-wrap max-wide:gap-x-6 max-wide:gap-y-4`}
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-xs font-extrabold tracking-eyebrow-wide text-acc uppercase">정본 축</span>
          <h2 className="mt-0.5! mb-0! text-hero-title! leading-[1.04] font-black! tracking-tight!">📒 정본 원장</h2>
          <span className="text-xs text-mut tabular-nums">
            {led ? (
              <>
                생성 {led.generated || '—'} · 과목 {rolls.length} · 챕터 {led.n_chapters}
              </>
            ) : (
              '과목×챕터의 5단계 파이프라인 진척을 한 화면에'
            )}
          </span>
        </div>
        {led && <Funnel l={led} />}
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
              <>🔁 원장 재빌드</>
            )}
          </Button>
        </div>
      </div>

      {led ? (
        <div className="relative grid min-h-0 flex-1 grid-cols-ledger gap-3.5 max-wide:grid-cols-1 max-wide:overflow-y-auto">
          {/* 좌 — 과목별 파이프라인 매트릭스(immersive) */}
          <div className="ds-glow relative flex min-h-0 min-w-0 animate-[enter-rise_var(--dur-slow)_var(--ease)_var(--stagger)_both] flex-col rounded-lg border border-line bg-[image:var(--bg-map-mastery)] shadow-card motion-reduce:animate-none max-wide:min-h-85">
            <div className="flex flex-none flex-wrap items-baseline gap-x-3 gap-y-1.5 px-5 pt-4 pb-1">
              <span className="text-xs font-extrabold tracking-caps text-mut uppercase">
                과목별 파이프라인 — SUBJECT PIPELINE
              </span>
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
          <Setup />
        </div>
      )}
    </section>
  );
}
