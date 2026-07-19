/* ============================================================
   ReviewRun — 탭: ↻ 복습 실행 (I-9 · doing surface)
   식별(review/stats/mastery)은 풍부하나 '실제로 복습을 굴리는 화면'이 빔 — 그 빈칸을 메운다.
   오늘 인출할 것을 한 카드씩 흐름으로: ① 회상(내 요약 다시 설명) ② 착각 재확인(과신 오답 재인출)
   ③ 밀린 챕터(간격반복 due/overdue). 진행은 이 세션의 로컬 상태(가짜 위험 감소 주장 없음) —
   실제 학습은 '집중 시작'(전역 타이머)·볼트 딥링크로 다리 놓고, 완료 세션이 정직하게 루프를 먹인다.
============================================================ */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/useApp';
import { useSchedule } from '@/store/selectors';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { useFocus } from '@/store/useFocus';
import { todayISO } from '@/lib/utils';
import { riskChapters, riskSummary, type ChapterReview } from '@/lib/spacedReview';
import { pickRetrieval, pickConfidentWrong, type RetrievalCard, type ConfidentWrongCard } from '@/lib/retrieval';
import { CBMS_INFO } from '@/lib/methodology';
import { Button } from '@/components/ui';
import type { AppState, Day } from '@/lib/types';
import ds from '@/styles/ds.module.css';

/* ── C-7 Tailwind 이식(두 번째 feature) ──────────────────────────────────
   `ReviewRun.module.css` 를 없앴다. discovery 에 없던 마찰 3종을 여기서 처음 만났고,
   그 처리 방식이 남은 52개 모듈의 규약이 된다:

   ① **clamp() 유동값** → 사다리 반올림의 **예외**. 고정 px 로 바꾸면 전체화면 러너의
      반응형이 사라진다(이식이 아니라 동작 변경). `--pad-runner`·`--fs-runner-*` 로
      이름을 준다 — 색을 반올림하지 않고 이름 준 것과 같은 논리.
   ② **자손 셀렉터**(`.prompt em`·`.prompt small`) → 자식에 **직접 클래스를 준다**.
      `[&_em]:` 임의 변형은 린트가 막는다 — 그건 구조 변경을 회피하는 통로이고,
      6단계가 요구하는 것은 정확히 그 구조 변경이다.
   ③ **속성 셀렉터**(`.badge[data-kind]`) → `data-[kind=…]:` 변형. CSS 에서 하던 것의
      정공법 대응물이라 린트가 허용한다(그 규칙은 값만 막는다).

   ⚠ `ds.card`·`ds.glow`·`ds.muted`·`ds.tiny` 는 그대로 둔다 — `ds.module.css` 는
   공유 SSOT 라 **맨 마지막**이다(건드리면 스냅샷 59장이 전부 흔들린다). 혼용이 정상. */
const WRAP = 'flex h-full flex-col items-center justify-center gap-4 p-runner-pad';
const CARD_BASE = 'flex w-full flex-col gap-3';
const CENTER = 'w-full max-w-runner-narrow items-center text-center';
const ACTS = 'mt-1 flex flex-wrap items-center gap-2';
const ACTS_END = `${ACTS} justify-end`;
const ACTS_CENTER = `${ACTS} justify-center`;
const SKIP =
  'cursor-pointer rounded-sm border border-line bg-none px-3 py-2 text-md text-mut hover:border-acc hover:text-txt';
const PROMPT = 'm-0 text-runner-prompt leading-normal';
const REVEAL = 'm-0 grid gap-2 rounded-md border border-line bg-tint-acc-faint py-3 pr-4 pl-8 leading-relaxed';
/* 배지 색은 data-* 변형으로 — 옛 `.badge[data-kind='confident']` 의 직역이다. */
const BADGE =
  'rounded-full bg-tint-acc px-2 py-1 text-xs font-bold tracking-wide text-acc whitespace-nowrap ' +
  'data-[kind=confident]:bg-tint-warn data-[kind=confident]:text-warn ' +
  'data-[risk=overdue]:bg-tint-bad data-[risk=overdue]:text-bad';

type RunItem =
  | { kind: 'retrieval'; card: RetrievalCard }
  | { kind: 'confident'; card: ConfidentWrongCard }
  | { kind: 'chapter'; ch: ChapterReview };

const CHAPTER_CAP = 12;

/** 오늘 복습 큐 — 회상 1 → 착각 재확인 1 → 밀린 챕터 상위 N. 하루 단위 결정적(회상·착각은 날짜 해시). */
function buildQueue(state: AppState, days: Day[], today: string): RunItem[] {
  const q: RunItem[] = [];
  const rc = pickRetrieval(state, today);
  if (rc) q.push({ kind: 'retrieval', card: rc });
  const cw = pickConfidentWrong(state, today);
  if (cw) q.push({ kind: 'confident', card: cw });
  for (const ch of riskChapters(state, days || [], today, CHAPTER_CAP)) q.push({ kind: 'chapter', ch });
  return q;
}

export default function ReviewRun() {
  const state = useApp((s) => s.state);
  const res = useSchedule();
  const nav = useNavigate();
  const today = todayISO(state);

  const queue = buildQueue(state, res.days, today);
  const risk = riskSummary(state, res.days || [], today);

  const [idx, setIdx] = useState(0);
  const [doneCount, setDoneCount] = useState(0);
  const [revealedAt, setRevealedAt] = useState(-1);
  const revealed = revealedAt === idx;

  const total = queue.length;
  const finished = idx >= total;
  const remaining = Math.max(0, total - idx);

  usePageChromeEffect(
    () => ({
      readouts: [
        { label: '남은 복습', value: finished ? 0 : remaining, accent: !finished && remaining > 0 },
        { label: '해낸 것', value: doneCount },
        { label: '오늘 위험', value: `${risk.overdue}⬤ ${risk.due}◒` },
      ],
      action: { label: '오늘 학습', onClick: () => nav('/today') },
    }),
    [remaining, doneCount, finished, risk.overdue, risk.due],
  );

  const advance = (didIt: boolean) => {
    if (didIt) setDoneCount((n) => n + 1);
    setIdx((i) => i + 1);
  };
  const reveal = () => setRevealedAt(idx);
  const restart = () => {
    setIdx(0);
    setDoneCount(0);
    setRevealedAt(-1);
  };

  // 빈 큐 — 복습할 게 없음(깨끗함).
  if (total === 0) {
    return (
      <div className={WRAP}>
        <div className={`${ds.card} ${ds.glow} ${CENTER}`}>
          <div className="text-runner-mark leading-none" aria-hidden="true">
            ✓
          </div>
          <h2>복습할 게 없어요</h2>
          <p className={ds.muted}>밀린 챕터도, 다시 인출할 요약·착각도 없습니다. 오늘 새 학습에 집중하세요.</p>
          <div className={ACTS_CENTER}>
            <Button onClick={() => nav('/today')}>오늘 학습으로</Button>
          </div>
        </div>
      </div>
    );
  }

  // 완주 — 이 세션 리캡.
  if (finished) {
    return (
      <div className={WRAP}>
        <div className={`${ds.card} ${ds.glow} ${CENTER}`}>
          <div className="text-runner-mark leading-none" aria-hidden="true">
            🎯
          </div>
          <h2>복습 세션 완료</h2>
          <p className={ds.muted}>
            {total}개 중 <strong>{doneCount}</strong>개를 인출했어요. 남은 챕터는 볼트에서 이어가세요.
          </p>
          <div className={ACTS_CENTER}>
            <Button onClick={restart} variant="ghost">
              처음부터
            </Button>
            <Button onClick={() => nav('/today')}>오늘 학습으로</Button>
          </div>
        </div>
      </div>
    );
  }

  const item = queue[idx]!;
  const step = `${idx + 1} / ${total}`;

  return (
    <div className={WRAP}>
      {/* 진행바에 정직한 의미를 준다 — 예전엔 aria-hidden인데 대체 수단도 없어 SR에는 진행이 통째로 없었다.
          (숫자 자체는 카드 안 "n / 총" 텍스트에도 있지만, 그건 카드가 바뀔 때만 읽힌다.) */}
      <div
        className="h-1 w-full max-w-runner overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-valuenow={idx}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={`복습 진행 ${idx + 1} / ${total}`}
      >
        <span
          className="block h-full rounded-full bg-acc transition-all duration-300"
          style={{ width: `${(idx / total) * 100}%` }}
        />
      </div>

      {item.kind === 'retrieval' && (
        <div className={`${ds.card} ${ds.glow} ${CARD_BASE} max-w-runner`} data-kind="retrieval">
          <div className="flex items-center justify-between gap-2">
            <span className={BADGE} data-kind="retrieval">
              회상
            </span>
            <span className={ds.tiny}>
              {step} · {item.card.ageDays}일 전 요약
            </span>
          </div>
          <h2 className={PROMPT}>
            "{item.card.summary.name}" — 이 주제를 <em className="text-acc not-italic">보지 않고</em> 스스로 3문장으로
            설명해 보세요.
          </h2>
          {revealed ? (
            <ol className={REVEAL}>
              <li>{item.card.summary.s1}</li>
              <li>{item.card.summary.s2}</li>
              <li>{item.card.summary.s3}</li>
            </ol>
          ) : (
            <p className={ds.muted}>머릿속으로 먼저 인출한 뒤, 아래로 내 원래 요약과 대조하세요.</p>
          )}
          <div className={ACTS_END}>
            {!revealed && (
              <Button variant="ghost" onClick={reveal}>
                원래 요약 보기
              </Button>
            )}
            <button type="button" className={SKIP} onClick={() => advance(false)}>
              건너뛰기
            </button>
            <Button onClick={() => advance(true)}>다시 설명했어요</Button>
          </div>
        </div>
      )}

      {item.kind === 'confident' && (
        <div className={`${ds.card} ${ds.glow} ${CARD_BASE} max-w-runner`} data-kind="confident">
          <div className="flex items-center justify-between gap-2">
            <span className={BADGE} data-kind="confident">
              착각 재확인
            </span>
            <span className={ds.tiny}>
              {step} · {item.card.ageDays}일 전 · {CBMS_INFO[item.card.cbms.code].label}
            </span>
          </div>
          <h2 className={PROMPT}>
            {item.card.cbms.name}
            {item.card.cbms.chapter ? ` · ${item.card.cbms.chapter}` : ''} — 확신했지만 틀렸던 지점. 지금은 정확히
            설명할 수 있나요?
          </h2>
          {revealed ? (
            <div className={REVEAL}>
              <p className="whitespace-pre-wrap">{item.card.cbms.note || '(메모 없음)'}</p>
              <p className={ds.tiny}>처방: {CBMS_INFO[item.card.cbms.code].tip}</p>
            </div>
          ) : (
            <p className={ds.muted}>먼저 스스로 답한 뒤, 당시 메모와 처방을 확인하세요.</p>
          )}
          <div className={ACTS_END}>
            {!revealed && (
              <Button variant="ghost" onClick={reveal}>
                당시 메모 보기
              </Button>
            )}
            <button
              type="button"
              className={SKIP}
              onClick={() =>
                window.open(
                  'obsidian://search?query=' + encodeURIComponent(item.card.cbms.name + ' ' + item.card.cbms.chapter),
                )
              }
              title="Obsidian에서 검색"
            >
              🔎 볼트
            </button>
            <Button onClick={() => advance(true)}>다시 확인했어요</Button>
          </div>
        </div>
      )}

      {item.kind === 'chapter' && (
        <div className={`${ds.card} ${ds.glow} ${CARD_BASE} max-w-runner`} data-kind="chapter" data-risk={item.ch.risk}>
          <div className="flex items-center justify-between gap-2">
            <span className={BADGE} data-kind="chapter" data-risk={item.ch.risk}>
              {item.ch.risk === 'overdue' ? '많이 밀림' : '복습 때'}
            </span>
            <span className={ds.tiny}>
              {step} · {item.ch.daysSince}일 방치
            </span>
          </div>
          <h2 className={PROMPT}>
            <span
              className="mr-2 inline-block size-3 rounded-sm align-baseline"
              style={{ background: item.ch.color || 'var(--acc)' }}
              aria-hidden="true"
            />
            {item.ch.subject} <small className="text-base font-medium opacity-70">{item.ch.chapter}</small>
          </h2>
          <p className={ds.muted}>
            배웠지만 {item.ch.daysSince}일 안 봤어요(마지막 {item.ch.lastDs}). 지금 인출해 망각곡선을 리셋하세요.
          </p>
          <div className={ACTS_END}>
            <button
              type="button"
              className={SKIP}
              onClick={() =>
                window.open('obsidian://search?query=' + encodeURIComponent(item.ch.subject + ' ' + item.ch.chapter))
              }
              title="Obsidian에서 검색"
            >
              🔎 볼트
            </button>
            <button type="button" className={SKIP} onClick={() => advance(false)}>
              건너뛰기
            </button>
            <Button
              onClick={() => {
                useFocus.getState().start({
                  ds: today,
                  sid: item.ch.sid,
                  type: 'rev',
                  name: item.ch.subject,
                  min: 25,
                  blockMin: 25,
                  chapter: item.ch.chapter, // 완료 시 챕터 터치 → 위험모델 lastDs 갱신(감사 #22)
                });
                advance(true);
              }}
            >
              ▶ 집중 시작
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
