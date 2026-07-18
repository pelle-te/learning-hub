/* ============================================================
   Ledger — 탭: 📒 정본 원장 (자료 그룹 · 연동 현황과 세그먼트 페어)
   과목×챕터의 5단계 파이프라인(sourced→noted→verified→carded→reviewed) 진척을 한 화면에.
   원본: serve.js /api/artifact/ledger ← knowledge/_meta/cache/_챕터원장.json (챕터원장.py). 통합 4단계 소비.
   흩어져 있던 볼트 생산 진척(진척 14곳)을 단일 출처로 모은다 — "각 과목이 파이프라인 어디까지 왔나".

   today 재설계 사상: 상단 리드아웃(챕터·검증·카드) · fill 프레임 · 히어로 퍼널 · 온디맨드 챕터 세부.
   데이터 원본은 볼트 빌드 산출물(읽기전용) — serve.js 온라인이면 자동, 오프라인이면 안내(mastery와 동형).
============================================================ */
import { useEffect, useRef, useState } from 'react';
import { useLedger, usePing } from '@/store/queries';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { classifyArtifact } from '@/lib/artifactState';
import {
  LEDGER_STAGES,
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
import ds from '@/styles/ds.module.css';
import l from './Ledger.module.css';

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** 선택된 챕터 스냅샷(상세 패널). */
interface Sel {
  subject: string;
  ch: LedgerChapter;
}

/** 히어로 퍼널 — 5단계 각각 도달 챕터 수(마일스톤 독립 카운트). 시선 집중점. */
function Funnel({ l: led }: { l: Ledger }) {
  const total = led.n_chapters || 1;
  return (
    <div className={l.funnel} role="img" aria-label={`파이프라인 단계별 도달 챕터 (전체 ${led.n_chapters})`}>
      {LEDGER_STAGES.map((st) => {
        const n = led.stage_counts[st] || 0;
        const w = Math.round((n / total) * 100);
        const m = STAGE_META[st];
        return (
          <div
            key={st}
            className={l.funStage}
            data-tip={`${m.label} — ${m.desc}: ${n}/${led.n_chapters}챕터`}
            role="img"
            aria-label={`${m.label} — ${m.desc}: ${n}/${led.n_chapters}챕터`}
          >
            <div className={l.funBar}>
              <div className={l.funFill} style={{ height: `${w}%`, background: m.color }} />
            </div>
            <div className={l.funN}>{n}</div>
            <div className={l.funLab}>
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
    <div className={l.subRow}>
      <div className={l.subHead}>
        <b className={l.subNm}>{roll.subject}</b>
        <span className={`${ds.tiny} ${ds.muted}`}>
          {roll.abbr} · {roll.total}챕터 · 진척 {pct(roll.progress)}
          {!roll.srcPresent ? ' · 출처 없음' : ''}
        </span>
      </div>
      <div className={l.cells}>
        {subject.chapters.map((ch) => (
          <button
            key={ch.chapter_id}
            type="button"
            className={l.cell}
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className={l.detail}
      role="dialog"
      aria-modal="true"
      aria-label={`${ch.arc} 상세`}
      ref={panelRef}
      tabIndex={-1}
    >
      <button type="button" className={l.detailX} onClick={onClose} aria-label="닫기">
        ✕
      </button>
      <div className={`${ds.tiny} ${ds.muted}`}>
        {sel.subject} · {ch.chapter_id}
      </div>
      <div className={l.detailName}>{ch.arc}</div>
      <div className={l.steps}>
        {LEDGER_STAGES.map((st, i) => {
          const done = ch.milestones[st];
          const cur = stageIndex(ch.furthest) === i;
          const m = STAGE_META[st];
          return (
            <div key={st} className={`${l.step}${done ? ' ' + l.stepDone : ''}${cur ? ' ' + l.stepCur : ''}`}>
              <span className={l.stepDot} style={done ? { background: m.color, borderColor: m.color } : undefined}>
                {done ? '✓' : ''}
              </span>
              <span className={l.stepLab}>
                {m.label} <span className={`${ds.tiny} ${ds.muted}`}>{m.desc}</span>
              </span>
            </div>
          );
        })}
      </div>
      <div className={l.metrics}>
        <span>
          노트 <b>{ch.notes}</b>
          {ch.concept ? <span className={ds.muted}> (개념 {ch.concept})</span> : null}
        </span>
        <span>
          검증률 <b>{pct(ch.verified_ratio)}</b>
        </span>
        <span>
          카드 <b>{ch.cards}</b>
          {ch.reps ? <span className={ds.muted}> · {ch.reps}회</span> : null}
        </span>
        {ch.reviewed_recent ? (
          <span>
            최근 복습 <b>{ch.reviewed_recent}</b>
          </span>
        ) : null}
      </div>
      <button
        type="button"
        className={l.deepBtn}
        onClick={() => window.open('obsidian://search?query=' + encodeURIComponent(ch.arc.replace(/^\d+\s*/, '')))}
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
    <div className={ds.card}>
      <h3>
        📥 백로그 <span className={`${ds.muted} ${ds.tiny}`}>(파이프라인에 아직 안 들어온 것)</span>
      </h3>
      {unp.length > 0 && (
        <div className={l.blGroup}>
          <div className={`${ds.tiny} ${ds.muted}`}>미처리 참고자료 — 폴더는 있으나 노트 미작성 ({unp.length})</div>
          <div className={l.chips}>
            {unp.map((s) => (
              <span key={s} className={ds.chip}>
                {s}
              </span>
            ))}
          </div>
        </div>
      )}
      {nosrc.length > 0 && (
        <div className={l.blGroup}>
          <div className={`${ds.tiny} ${ds.muted}`}>출처 없는 과목 — 참고자료 폴더 미연결 ({nosrc.length})</div>
          <div className={l.chips}>
            {nosrc.map((s) => (
              <span key={s} className={`${ds.chip} ${l.chipWarn}`}>
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
    <div className={ds.card}>
      <h3>🎯 병목</h3>
      <div className={l.bottleBody}>
        <span className={ds.kpi} style={{ color: m.color }}>
          {m.glyph} {m.label}
        </span>
        <div className={ds.foot}>
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
    <div className={l.stateBody}>
      <h3>아직 챕터 원장이 없어요</h3>
      <ol className={ds.foot} style={{ lineHeight: 1.9 }}>
        <li>
          serve.js 실행 상태에서 원장 빌드: <code>python pipeline/_도구/챕터원장.py</code>
          <span className={ds.muted}> (또는 아래 “원장 재빌드” 버튼)</span>
        </li>
        <li>
          한 명령 전체 빌드: <code>python pipeline/_도구/빌드.py</code>
        </li>
      </ol>
      <div className={`${ds.foot} ${ds.muted}`}>
        원장은 <code>subjects.json</code>(정본 slug·src) + 볼트 인덱스 + Anki 신호를 조인해 과목×챕터의 5단계 진척을
        집계합니다. serve.js가 켜져 있으면 자동으로 불러옵니다.
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

  // serve.js 온라인이면 원장을 재빌드(챕터원장.py)하고 다시 페치 — "단일 출처, 한 명령" 이야기의 실행부.
  const rebuild = async () => {
    setRebuilding(true);
    try {
      const r = await runTool('ledger-build');
      if (r.ok) {
        ui.toast('챕터 원장을 다시 빌드했어요.', 'ok');
        await refetch();
      } else {
        ui.toast((r.out || '').slice(0, 140) || '원장 재빌드에 실패했어요(serve.js 필요).', 'bad');
      }
    } catch {
      ui.toast('원장 재빌드에 실패했어요(serve.js 필요).', 'bad');
    } finally {
      setRebuilding(false);
    }
  };

  return (
    <section className={l.wrap} aria-label="정본 원장">
      {/* ── 히어로 밴드 — 파이프라인 퍼널 + 생성일 + 재빌드 ── */}
      <div className={`${l.hero} ${ds.glow}`}>
        <div className={l.heroLeft}>
          <span className={l.eyebrow}>정본 축</span>
          <h2 className={l.headTitle}>📒 정본 원장</h2>
          <span className={l.headMeta}>
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
        <div className={l.heroAction}>
          {loading && (
            <span className={l.headMeta}>
              <span className={ds.spin} /> 로드 중
            </span>
          )}
          <Button sm variant="primary" onClick={rebuild} disabled={rebuilding}>
            {rebuilding ? (
              <>
                <span className={ds.spin} /> 빌드 중…
              </>
            ) : (
              <>🔁 원장 재빌드</>
            )}
          </Button>
        </div>
      </div>

      {led ? (
        <div className={l.cols}>
          {/* 좌 — 과목별 파이프라인 매트릭스(immersive) */}
          <div className={`${l.mapCol} ${ds.glow}`}>
            <div className={l.mapHead}>
              <span className={l.mapTitle}>과목별 파이프라인 — SUBJECT PIPELINE</span>
              <span className={l.mapMeta}>셀 하나가 챕터 · 색 = 가장 멀리 간 단계 · 클릭으로 세부</span>
            </div>
            <div className={l.legend}>
              {LEDGER_STAGES.map((st) => (
                <span key={st}>
                  <i style={{ background: STAGE_META[st].color }} /> {STAGE_META[st].label}
                </span>
              ))}
              <span>
                <i style={{ background: 'var(--panel-2,#2a2d35)' }} /> 미착수
              </span>
            </div>
            <div className={l.mapScroll}>
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
          <div className={l.actionCol}>
            <Bottleneck l={led} />
            <Backlog l={led} />
          </div>
          {sel && <Detail sel={sel} onClose={() => setSel(null)} />}
        </div>
      ) : loading ? (
        <div className={l.offWrap}>
          <div className={ds.muted}>
            <span className={ds.spin} /> 챕터 원장 로드 중...
          </div>
        </div>
      ) : realError ? (
        <div className={l.offWrap}>
          <div className={l.errBody} role="alert">
            <span className={l.errGlyph} aria-hidden="true">
              ⚠
            </span>
            <h3>챕터 원장을 불러오지 못했어요</h3>
            <div className={`${ds.foot} ${ds.muted}`}>{errMsg}</div>
            <Button sm variant="primary" onClick={() => refetch()}>
              다시 시도
            </Button>
          </div>
        </div>
      ) : (
        <div className={l.offWrap}>
          <Setup />
        </div>
      )}
    </section>
  );
}
