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
import rr from './ReviewRun.module.css';

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
      <div className={rr.wrap}>
        <div className={`${ds.card} ${ds.glow} ${rr.center}`}>
          <div className={rr.bigMark} aria-hidden="true">
            ✓
          </div>
          <h2>복습할 게 없어요</h2>
          <p className={ds.muted}>밀린 챕터도, 다시 인출할 요약·착각도 없습니다. 오늘 새 학습에 집중하세요.</p>
          <div className={rr.acts}>
            <Button onClick={() => nav('/today')}>오늘 학습으로</Button>
          </div>
        </div>
      </div>
    );
  }

  // 완주 — 이 세션 리캡.
  if (finished) {
    return (
      <div className={rr.wrap}>
        <div className={`${ds.card} ${ds.glow} ${rr.center}`}>
          <div className={rr.bigMark} aria-hidden="true">
            🎯
          </div>
          <h2>복습 세션 완료</h2>
          <p className={ds.muted}>
            {total}개 중 <strong>{doneCount}</strong>개를 인출했어요. 남은 챕터는 볼트에서 이어가세요.
          </p>
          <div className={rr.acts}>
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
    <div className={rr.wrap}>
      <div className={rr.progress} aria-hidden="true">
        <span className={rr.progressFill} style={{ width: `${(idx / total) * 100}%` }} />
      </div>

      {item.kind === 'retrieval' && (
        <div className={`${ds.card} ${ds.glow} ${rr.card}`} data-kind="retrieval">
          <div className={rr.kicker}>
            <span className={rr.badge} data-kind="retrieval">
              회상
            </span>
            <span className={ds.tiny}>
              {step} · {item.card.ageDays}일 전 요약
            </span>
          </div>
          <h2 className={rr.prompt}>
            "{item.card.summary.name}" — 이 주제를 <em>보지 않고</em> 스스로 3문장으로 설명해 보세요.
          </h2>
          {revealed ? (
            <ol className={rr.reveal}>
              <li>{item.card.summary.s1}</li>
              <li>{item.card.summary.s2}</li>
              <li>{item.card.summary.s3}</li>
            </ol>
          ) : (
            <p className={ds.muted}>머릿속으로 먼저 인출한 뒤, 아래로 내 원래 요약과 대조하세요.</p>
          )}
          <div className={rr.acts}>
            {!revealed && (
              <Button variant="ghost" onClick={reveal}>
                원래 요약 보기
              </Button>
            )}
            <button type="button" className={rr.skip} onClick={() => advance(false)}>
              건너뛰기
            </button>
            <Button onClick={() => advance(true)}>다시 설명했어요</Button>
          </div>
        </div>
      )}

      {item.kind === 'confident' && (
        <div className={`${ds.card} ${ds.glow} ${rr.card}`} data-kind="confident">
          <div className={rr.kicker}>
            <span className={rr.badge} data-kind="confident">
              착각 재확인
            </span>
            <span className={ds.tiny}>
              {step} · {item.card.ageDays}일 전 · {CBMS_INFO[item.card.cbms.code].label}
            </span>
          </div>
          <h2 className={rr.prompt}>
            {item.card.cbms.name}
            {item.card.cbms.chapter ? ` · ${item.card.cbms.chapter}` : ''} — 확신했지만 틀렸던 지점. 지금은 정확히
            설명할 수 있나요?
          </h2>
          {revealed ? (
            <div className={rr.reveal}>
              <p className={rr.note}>{item.card.cbms.note || '(메모 없음)'}</p>
              <p className={ds.tiny}>처방: {CBMS_INFO[item.card.cbms.code].tip}</p>
            </div>
          ) : (
            <p className={ds.muted}>먼저 스스로 답한 뒤, 당시 메모와 처방을 확인하세요.</p>
          )}
          <div className={rr.acts}>
            {!revealed && (
              <Button variant="ghost" onClick={reveal}>
                당시 메모 보기
              </Button>
            )}
            <button
              type="button"
              className={rr.skip}
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
        <div className={`${ds.card} ${ds.glow} ${rr.card}`} data-kind="chapter" data-risk={item.ch.risk}>
          <div className={rr.kicker}>
            <span className={rr.badge} data-kind="chapter" data-risk={item.ch.risk}>
              {item.ch.risk === 'overdue' ? '많이 밀림' : '복습 때'}
            </span>
            <span className={ds.tiny}>
              {step} · {item.ch.daysSince}일 방치
            </span>
          </div>
          <h2 className={rr.prompt}>
            <span className={rr.chDot} style={{ background: item.ch.color || 'var(--acc)' }} aria-hidden="true" />
            {item.ch.subject} <small>{item.ch.chapter}</small>
          </h2>
          <p className={ds.muted}>
            배웠지만 {item.ch.daysSince}일 안 봤어요(마지막 {item.ch.lastDs}). 지금 인출해 망각곡선을 리셋하세요.
          </p>
          <div className={rr.acts}>
            <button
              type="button"
              className={rr.skip}
              onClick={() =>
                window.open('obsidian://search?query=' + encodeURIComponent(item.ch.subject + ' ' + item.ch.chapter))
              }
              title="Obsidian에서 검색"
            >
              🔎 볼트
            </button>
            <button type="button" className={rr.skip} onClick={() => advance(false)}>
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
