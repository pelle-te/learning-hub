/* ============================================================
   phone/ReviewView.tsx — 폰 복습 러너(Phase 3 · "지하철 5분 복습").

   ## ⚠ 규칙은 lib, 화면만 새로

   큐는 데스크톱 `ReviewRun` 과 **같은** `buildReviewQueue`(lib)를 쓴다 — 회상 → 착각 재확인 →
   밀린 챕터. 폰은 화면만 새로 짠다(설계서 §9-4).

   ## 폰은 상태를 쓰지 않는다 — 정직한 인출 연습

   데스크톱 러너는 챕터에 '집중 시작'(전역 타이머)을 붙여 완료 시 lastDs 를 갱신한다. 폰엔 그
   타이머 UI 가 없다. 가짜로 "복습함"을 기록하면 위험 모델이 거짓으로 내려간다 — 그래서 폰은
   **머릿속 인출 연습**만 제공한다(카드 넘기며 스스로 설명 → 원래 값과 대조). 기록은 데스크톱
   '집중'에서 정직하게 남긴다. 인출 자체가 기억을 강화하므로 이동 중 5분에 값이 있다.
============================================================ */
import { useState } from 'react';
import { useApp } from '@/store/useApp';
import { useSwipe } from '@/hooks/useSwipe';
import { useSchedule } from '@/store/selectors';
import { todayISO } from '@/lib/utils';
import { buildReviewQueue, requeue, runItemKey, type RunItem } from '@/lib/reviewQueue';
import type { ChapterReview } from '@/lib/spacedReview';
import { CBMS_INFO } from '@/lib/methodology';

const CARD = 'flex w-full flex-col gap-3 rounded-lg border border-line bg-panel p-4';
const BADGE = 'inline-flex w-fit rounded-full bg-tint-acc px-2 py-1 text-2xs font-bold tracking-wide text-acc';
const REVEAL = 'm-0 grid gap-2 rounded-md border border-line bg-tint-acc-faint px-4 py-3 text-sm leading-relaxed';
const PRIMARY = 'min-h-11 flex-1 rounded-md bg-acc px-4 text-sm font-semibold text-on-acc';
const GHOST = 'min-h-11 rounded-md border border-line px-4 text-sm text-mut';

/** 챕터 카드 문구(N-10) — 유지(끝낸 챕터)는 **왜 돌아왔는지**를 말해야 한다. 설명이 없으면
 *  끝낸 챕터가 다시 뜬 것이 "앱이 완료를 잊었다"로 읽힌다. 앵커를 모르면 모른다고 말한다.
 *  ⚠ 컴포넌트 밖 순수 함수인 이유는 인지복잡도 래칫이다 — 이 컴포넌트는 이미 한계에 붙어 있어
 *  본문에 분기를 더하면 게이트가 깨진다(래칫이 의도대로 작동한 자리). */
function chapterCopy(ch: ChapterReview): { badge: string; age: string; body: string } {
  if (!ch.maintenance)
    return {
      badge: ch.risk === 'overdue' ? '많이 밀림' : '복습 때',
      age: ` · ${ch.daysSince}일 방치`,
      body: `배웠지만 ${ch.daysSince}일 안 봤어요. 지금 머릿속으로 핵심을 인출해 망각곡선을 리셋하세요.`,
    };
  if (!ch.lastDs)
    return {
      badge: '유지',
      age: '',
      body: '끝낸 챕터인데 마지막으로 본 날이 기록에 없어요. 한 번 인출하면 유지 주기가 잡힙니다.',
    };
  return {
    badge: '유지',
    age: ` · ${ch.daysSince}일 방치`,
    body: `끝낸 챕터예요. 마지막으로 본 지 ${ch.daysSince}일 — 유지 인출로 붙잡아 둡니다.`,
  };
}

export default function ReviewView(): React.JSX.Element {
  const state = useApp((s) => s.state);
  const res = useSchedule();
  const today = todayISO(state);
  /* 세션 스냅샷 — 데스크톱 러너와 같은 이유(D-1). 폰은 백그라운드 pull 병합이 더 잦아
     파생 큐일 때 발밑에서 카드가 바뀔 여지가 오히려 크다. */
  const [queue, setQueue] = useState<RunItem[]>(() => buildReviewQueue(state, res.days, today));
  const [idx, setIdx] = useState(0);
  const [gotKeys, setGotKeys] = useState<string[]>([]);
  const [revealedAt, setRevealedAt] = useState(-1);
  const revealed = revealedAt === idx;

  const total = queue.length;
  const finished = idx >= total;
  const cardCount = queue.filter((i) => !i.again).length;
  const againCount = total - cardCount;

  const advance = (didIt: boolean): void => {
    const cur = queue[idx];
    if (didIt) {
      if (cur) setGotKeys((ks) => (ks.includes(runItemKey(cur)) ? ks : [...ks, runItemKey(cur)]));
    } else {
      setQueue((q) => requeue(q, idx)); // D-1 — 넘긴 카드를 3장 뒤 한 번 더(조건은 lib 이 판단)
    }
    setIdx((i) => i + 1);
  };
  const restart = (): void => {
    setQueue(buildReviewQueue(state, res.days, today));
    setIdx(0);
    setGotKeys([]);
    setRevealedAt(-1);
  };

  /* UX-B2 카드 스와이프 — 인출/건너뛰기/펼치기가 버튼 3개 조준이었다. 플래시카드의 지배적
     관용(우=했다·좌=넘김·탭=뒤집기)을 그대로 쓴다. 큐 로직(`buildReviewQueue`)은 한 줄도 안 바뀐다.
     ⚠ 버튼은 전부 남는다 — 스와이프는 어포던스가 숨어 있어 발견성이 낮고 키보드·스위치 접근에는
       닿지 않는다. 훅도 버튼 위 탭은 삼킨다('건너뛰기'를 눌렀는데 펼쳐지는 일이 없게).
     ⚠ 훅은 early return 위에 있어야 한다(훅 규칙) → 현재 카드가 없을 때는 핸들러를 안 준다.
     ⚠ 챕터 카드는 펼칠 것이 없다(원래 요약·메모가 없다) → 그 카드에선 탭을 안 건다. */
  const cur = queue[idx];
  const revealable = !!cur && cur.kind !== 'chapter';
  const swipe = useSwipe({
    onSwipeRight: cur ? () => advance(true) : undefined,
    onSwipeLeft: cur ? () => advance(false) : undefined,
    onTap: revealable && !revealed ? () => setRevealedAt(idx) : undefined,
  });

  if (total === 0) {
    return (
      <section className="flex flex-col items-center gap-3 p-6 text-center">
        <div className="text-5xl" aria-hidden="true">
          ✓
        </div>
        <h2 className="text-base font-semibold text-txt">복습할 게 없어요</h2>
        <p className="text-sm text-mut">밀린 챕터도, 다시 인출할 요약·착각도 없습니다.</p>
      </section>
    );
  }

  if (finished) {
    return (
      <section className="flex flex-col items-center gap-3 p-6 text-center">
        <div className="text-5xl" aria-hidden="true">
          🎯
        </div>
        <h2 className="text-base font-semibold text-txt">복습 세션 완료</h2>
        <p className="text-sm text-mut">
          카드 {cardCount}장 중 <strong className="text-txt">{gotKeys.length}</strong>개를 인출했어요
          {againCount > 0 ? ` · 놓친 ${againCount}개는 한 번 더 만났어요` : ''}.
        </p>
        <button type="button" onClick={restart} className={GHOST}>
          처음부터
        </button>
      </section>
    );
  }

  const item = queue[idx]!;
  const step = `${item.again ? '↻ 다시 · ' : ''}${idx + 1} / ${total}`;

  return (
    <section {...swipe} className="flex flex-col gap-4 p-4">
      <div
        className="h-1 w-full overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-valuenow={idx}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={`복습 진행 ${step}`}
      >
        <span
          className="block h-full rounded-full bg-acc transition-all"
          style={{ width: `${(idx / total) * 100}%` }}
        />
      </div>

      {item.kind === 'retrieval' ? (
        <div className={CARD}>
          <div className="flex items-center justify-between gap-2">
            <span className={BADGE}>회상</span>
            <span className="text-2xs text-mut">
              {step} · {item.card.ageDays}일 전 요약
            </span>
          </div>
          <h2 className="m-0 text-base leading-normal font-semibold text-txt">
            "{item.card.summary.name}" — 보지 않고 스스로 3문장으로 설명해 보세요.
          </h2>
          {revealed ? (
            <ol className={REVEAL}>
              <li>{item.card.summary.s1}</li>
              <li>{item.card.summary.s2}</li>
              <li>{item.card.summary.s3}</li>
            </ol>
          ) : (
            <p className="text-sm text-mut">머릿속으로 먼저 인출한 뒤, 원래 요약과 대조하세요.</p>
          )}
          <div className="mt-1 flex gap-2">
            {!revealed ? (
              <button type="button" onClick={() => setRevealedAt(idx)} className={GHOST}>
                원래 요약
              </button>
            ) : null}
            <button type="button" onClick={() => advance(false)} className={GHOST}>
              건너뛰기
            </button>
            <button type="button" onClick={() => advance(true)} className={PRIMARY}>
              다시 설명했어요
            </button>
          </div>
        </div>
      ) : null}

      {item.kind === 'confident' ? (
        <div className={CARD}>
          <div className="flex items-center justify-between gap-2">
            <span className={`${BADGE} bg-tint-warn text-warn`}>착각 재확인</span>
            <span className="text-2xs text-mut">
              {step} · {CBMS_INFO[item.card.cbms.code].label}
            </span>
          </div>
          <h2 className="m-0 text-base leading-normal font-semibold text-txt">
            {item.card.cbms.name}
            {item.card.cbms.chapter ? ` · ${item.card.cbms.chapter}` : ''} — 확신했지만 틀렸던 지점. 지금은 설명할 수
            있나요?
          </h2>
          {revealed ? (
            <div className={REVEAL}>
              <p className="m-0 whitespace-pre-wrap">{item.card.cbms.note || '(메모 없음)'}</p>
              <p className="m-0 text-2xs text-mut">처방: {CBMS_INFO[item.card.cbms.code].tip}</p>
            </div>
          ) : (
            <p className="text-sm text-mut">먼저 스스로 답한 뒤, 당시 메모와 처방을 확인하세요.</p>
          )}
          <div className="mt-1 flex gap-2">
            {!revealed ? (
              <button type="button" onClick={() => setRevealedAt(idx)} className={GHOST}>
                당시 메모
              </button>
            ) : null}
            <button type="button" onClick={() => advance(false)} className={GHOST}>
              건너뛰기
            </button>
            <button type="button" onClick={() => advance(true)} className={PRIMARY}>
              다시 확인했어요
            </button>
          </div>
        </div>
      ) : null}

      {item.kind === 'chapter' ? (
        <div className={CARD}>
          <div className="flex items-center justify-between gap-2">
            <span className={`${BADGE} ${item.ch.risk === 'overdue' ? 'bg-tint-bad text-bad' : ''}`}>
              {chapterCopy(item.ch).badge}
            </span>
            <span className="text-2xs text-mut">
              {step}
              {chapterCopy(item.ch).age}
            </span>
          </div>
          <h2 className="m-0 flex items-center gap-2 text-base leading-normal font-semibold text-txt">
            <span
              className="inline-block size-3 shrink-0 rounded-sm"
              style={{ background: item.ch.color || 'var(--acc)' }}
              aria-hidden="true"
            />
            {item.ch.subject} <span className="text-sm font-medium text-mut">{item.ch.chapter}</span>
          </h2>
          <p className="text-sm text-mut">{chapterCopy(item.ch).body}</p>
          <div className="mt-1 flex gap-2">
            <button type="button" onClick={() => advance(false)} className={GHOST}>
              건너뛰기
            </button>
            <button type="button" onClick={() => advance(true)} className={PRIMARY}>
              인출했어요
            </button>
          </div>
        </div>
      ) : null}

      {/* 숨은 제스처를 한 줄로 알린다 — 버튼이 정본이라 없어도 쓸 수 있지만, 알려 주지 않으면
          만들어 둔 손맛을 아무도 못 찾는다(폰 할 일 스와이프를 드롭한 근거가 '발견성'이었다).
          `aria-hidden` — SR 사용자에게 손가락 방향 안내는 소음이고, 같은 동작이 버튼에 있다. */}
      <p className="text-center text-2xs text-mut" aria-hidden="true">
        ← 건너뛰기 · 인출 →{revealable && !revealed ? ' · 탭하면 펼침' : ''}
      </p>
    </section>
  );
}
