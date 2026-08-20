/* ============================================================
   phone/ReviewView.tsx — 폰 복습 러너(Phase 3 · "지하철 5분 복습").

   ## ⚠ 규칙은 lib, 화면만 새로

   큐는 데스크톱 `ReviewRun` 과 **같은** `buildReviewQueue`(lib)를 쓴다 — 회상 → 착각 재확인 →
   밀린 챕터. 폰은 화면만 새로 짠다(설계서 §9-4).

   ## 인출 판정이 앵커를 옮긴다(E1 · 2026-07-29)

   ⚠ **이 절은 옛 결정("폰은 상태를 쓰지 않는다")을 뒤집은 것이다.** 그 결정의 논거는 _"가짜로
   복습함을 기록하면 위험 모델이 거짓으로 내려간다 · 기록은 데스크톱 '집중'에서 정직하게 남긴다"_
   였는데, 세 가지가 그 전제를 무너뜨렸다:

   ① 이 화면의 챕터 카드 버튼은 **"인출했어요"** 라고 적혀 있고 본문은 _"망각곡선을 리셋하세요"_
      라고 말하는데 **아무것도 기록하지 않았다** — 화면이 하는 약속과 하는 일이 달랐다.
   ② "기록은 데스크톱이 남긴다"는 경로가 실제로는 조건 3중 게이트였다(집중 완주 + 토스트 클릭 +
      chapter 존재). 그래서 앵커는 데스크톱에서도 거의 안 생겼다(`lib/persistence.touchReview` 주석).
   ③ **"폰은 상태를 쓰지 않는다"는 이미 거짓이다** — B1 이 폰에 블록 완료 체크를 넣었고, 그건
      `adherenceFactor` 를 통해 계획 용량을 실제로 깎는다. 인출 기록보다 무거운 쓰기다.

   판정은 `lib/reviewQueue.anchorOf` 가 소유한다(데스크톱과 **같은 규칙** — §9-4). 회상 카드는
   `Summary` 에 chapter 가 없어 앵커가 원리적으로 없고, 그건 두 화면에서 똑같이 null 이다.

   ⚠ 데스크톱과 다른 점 하나: 저쪽 `2`(집중 시작)는 인출 사건이 아니라 세션 *시작*이라 앵커를
   옮기지 않는다(그래서 저긴 opt-in 이다). 폰엔 그런 동작이 없어 **긍정 판정 = 인출**이 항상 참이다.
============================================================ */
import { useState } from 'react';
import { useApp } from '@/store/useApp';
import { useSwipe } from '@/hooks/useSwipe';
import { useSchedule } from '@/store/selectors';
import { todayISO } from '@/lib/utils';
import {
  anchorOf,
  buildReviewQueue,
  cardSpeech,
  chapterCopy,
  requeue,
  runItemKey,
  type RunItem,
  cursorOp,
  landingIndex,
} from '@/lib/reviewQueue';
import { writeResume, dropResume } from '@/store/resumeCursor';
import { touchReview } from '@/lib/persistence';
import { CBMS_INFO } from '@/lib/methodology';
import { Icon } from '@/components/Icon';

const CARD = 'flex w-full flex-col gap-3 rounded-lg border border-line bg-panel p-4';
const BADGE = 'inline-flex w-fit rounded-full bg-tint-acc px-2 py-1 text-2xs font-bold tracking-wide text-acc-on-soft';
const REVEAL = 'm-0 grid gap-2 rounded-md border border-line bg-tint-acc-faint px-4 py-3 text-sm leading-relaxed';
const PRIMARY = 'min-h-11 flex-1 rounded-md bg-acc px-4 text-sm font-semibold text-on-acc';
const GHOST = 'min-h-11 rounded-md border border-line px-4 text-sm text-mut';

/* ⚠⚠ **`chapterCopy` 지역 사본을 `lib/reviewQueue` 로 올렸다(H14 · 2026-07-31 `/감사 근본`).**
   여기 있던 3분기에는 W2 가 데스크톱에만 더한 **`fromVault` 분기가 없어서**, 볼트 유래 앵커
   챕터가 폰에서 앱 인출 기록과 **같은 말**로 떴다 — `lib/vaultAnchors.ts` 가 _"UI 가 배지로
   구분한다"_ 고 적어 둔 계약을 폰이 조용히 깨는 형태다. 결정로그가 `chapterCopy` 2벌로 이미
   한 번 물렸고 H13 이 **배지만** 올렸던 것이 여기서 두 번째로 갈렸다.
   §9-4: 화면은 갈라도 **규칙(문구 포함)은 lib 하나**다. */

/** 큐가 비었을 때 — "다 했다"가 아니라 **애초에 없다**. 둘을 같은 화면으로 그리면 거짓 축하가 된다. */
function NothingDue(): React.JSX.Element {
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

/** 세션을 끝까지 본 뒤 — 분모는 **again 을 뺀 카드 수**다(다시 만난 것을 두 번 세면 인출률이 내려간다). */
function SessionDone({
  cardCount,
  got,
  again,
  onRestart,
}: {
  cardCount: number;
  got: number;
  again: number;
  onRestart: () => void;
}): React.JSX.Element {
  return (
    <section className="flex flex-col items-center gap-3 p-6 text-center">
      <Icon name="target" className="size-12! stroke-[1.4]" />
      <h2 className="text-base font-semibold text-txt">복습 세션 완료</h2>
      <p className="text-sm text-mut">
        카드 {cardCount}장 중 <strong className="text-txt">{got}</strong>개를 인출했어요
        {again > 0 ? ` · 놓친 ${again}개는 한 번 더 만났어요` : ''}.
      </p>
      <button type="button" onClick={onRestart} className={GHOST}>
        처음부터
      </button>
    </section>
  );
}

/** 카드 종류 → 카드 컴포넌트. 종전엔 본문에 `kind === …` 삼항이 **셋 나란히** 있었고, 그래서
 *  종류가 하나 늘 때마다 본문이 자랐다. 분기를 여기로 모으면 본문은 "카드 하나를 그린다"만 안다.
 *  ⚠ 래퍼를 안 두고 카드를 **그대로** 반환한다 — DOM 이 한 노드도 안 늘어난다(§15-4). */
function ReviewCard({
  item,
  step,
  revealed,
  onReveal,
  onAdvance,
}: {
  item: RunItem;
  step: string;
  revealed: boolean;
  onReveal: () => void;
  onAdvance: (didIt: boolean) => void;
}): React.JSX.Element | null {
  if (item.kind === 'retrieval')
    return <RetrievalCard item={item} step={step} revealed={revealed} onReveal={onReveal} onAdvance={onAdvance} />;
  if (item.kind === 'confident')
    return <ConfidentCard item={item} step={step} revealed={revealed} onReveal={onReveal} onAdvance={onAdvance} />;
  if (item.kind === 'chapter') return <ChapterCard item={item} step={step} onAdvance={onAdvance} />;
  return null;
}

/**
 * @param startAt 이어하기로 들어왔을 때의 **0-based 착지 인덱스**(N-7). 탭바로 오면 0.
 *   ⚠ 커서를 이 화면이 직접 읽지 않는 이유는 데스크톱과 같다 — 그러면 탭바로 그냥 연 사람도
 *   묻지 않고 중간에서 시작한다. 이어하기는 누른 사람의 의도이지 화면의 기본값이 아니다.
 */
export default function ReviewView({ startAt = 0 }: { startAt?: number }): React.JSX.Element {
  const state = useApp((s) => s.state);
  const res = useSchedule();
  const today = todayISO(state);
  /* 세션 스냅샷 — 데스크톱 러너와 같은 이유(D-1). 폰은 백그라운드 pull 병합이 더 잦아
     파생 큐일 때 발밑에서 카드가 바뀔 여지가 오히려 크다. */
  const [queue, setQueue] = useState<RunItem[]>(() => buildReviewQueue(state, res.days, today));
  /* N-7 착지 — 큐 길이는 기기마다 다를 수 있으므로 클램프한다(순서는 결정론적이라 근사가
     성립하고, 어긋나면 아래 '처음부터' 가 탈출구다). */
  const [startedAt] = useState(() => landingIndex(startAt, queue.length));
  const [idx, setIdx] = useState(startedAt);
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
      /* E1 — 긍정 판정은 곧 인출 사건이다(폰엔 '집중 시작' 같은 비-인출 긍정이 없다).
         앵커가 없는 카드(회상)는 `anchorOf` 가 null 을 주므로 여기서 종류를 따질 필요가 없다. */
      const a = cur ? anchorOf(cur) : null;
      if (a) useApp.getState().mutate((st) => touchReview(st, a.sid, a.chapter, today));
      if (cur) setGotKeys((ks) => (ks.includes(runItemKey(cur)) ? ks : [...ks, runItemKey(cur)]));
    } else {
      setQueue((q) => requeue(q, idx)); // D-1 — 넘긴 카드를 3장 뒤 한 번 더(조건은 lib 이 판단)
    }
    setIdx((i) => i + 1);
    /* ⚠⚠ **폰도 커서를 쓴다**(M-10 · 2026-08-20). 종전엔 폰이 커서를 **읽기만** 해서 두 가지가
       조용히 틀렸다: 폰에서 진행한 것이 PC 에 안 이어졌고(같은 카드를 두 번 한다), 폰에서
       끝내도 `dropResume` 이 안 돌아 유령 이어하기 칩이 TTL 동안 남았다.
       이 파일 머리주석의 "폰이 이 기능의 주 수혜자다"가 사실이 되려면 쓰기가 있어야 한다.
       ⚠ 판정은 `lib/reviewQueue.cursorOp` — 데스크톱 러너와 **같은 함수**다. */
    const op = cursorOp(idx, queue.length);
    if (op?.kind === 'write') writeResume({ kind: 'review', label: '복습 세션', progress: op.progress });
    else if (op?.kind === 'drop') dropResume();
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
  const reveal = (): void => setRevealedAt(idx);
  const revealable = !!cur && cur.kind !== 'chapter';
  const swipe = useSwipe({
    onSwipeRight: cur ? () => advance(true) : undefined,
    onSwipeLeft: cur ? () => advance(false) : undefined,
    onTap: revealable && !revealed ? reveal : undefined,
  });

  if (total === 0) return <NothingDue />;

  if (finished)
    return <SessionDone cardCount={cardCount} got={gotKeys.length} again={againCount} onRestart={restart} />;

  const item = queue[idx]!;
  const step = `${item.again ? '↻ 다시 · ' : ''}${idx + 1} / ${total}`;
  /* H13 — 카드 전환은 SR 에 무음이다(같은 key 라 포커스는 버튼에 남고 본문만 교체된다).
     문구는 **lib 이 소유**한다(`cardSpeech`) — 데스크톱 러너와 같은 말을 해야 한다. */
  const { badge, subject } = cardSpeech(item);

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

      {/* 카드 **밖**의 라이브 리전(H13) — 안에 두면 카드와 함께 교체돼 공지가 씹힌다. */}
      <p className="sr-only" role="status">
        {step} · {badge} · {subject}
      </p>

      {/* N-7 착지 안내 — 건너뛴 카드가 있다는 사실을 말하지 않으면 "앱이 앞부분을 잃었다"로
          읽히고, 탈출구가 없으면 그 추측을 확인할 방법도 없다. 첫 판정에 사라진다. */}
      {startedAt > 0 && idx === startedAt && gotKeys.length === 0 ? (
        <p className="m-0 flex flex-wrap items-center gap-2 text-xs text-mut">
          다른 기기에서 {startedAt}장까지 봤어요.
          <button type="button" onClick={restart} className="min-h-8 rounded-md border border-line px-2 text-xs">
            처음부터
          </button>
        </p>
      ) : null}

      <ReviewCard item={item} step={step} revealed={revealed} onReveal={reveal} onAdvance={advance} />

      {/* 숨은 제스처를 한 줄로 알린다 — 버튼이 정본이라 없어도 쓸 수 있지만, 알려 주지 않으면
          만들어 둔 손맛을 아무도 못 찾는다(폰 할 일 스와이프를 드롭한 근거가 '발견성'이었다).
          `aria-hidden` — SR 사용자에게 손가락 방향 안내는 소음이고, 같은 동작이 버튼에 있다. */}
      <p className="text-center text-2xs text-mut" aria-hidden="true">
        ← 건너뛰기 · 인출 →{revealable && !revealed ? ' · 탭하면 펼침' : ''}
      </p>
    </section>
  );
}

/* ── 카드 3종 ─────────────────────────────────────────────────────────────────
   ⚠ 컴포넌트로 갈린 이유는 인지복잡도 래칫이다(F5 · 2026-08-01). 이 화면 본문이 **77** 로
   저장소 최댓값이었고, 그 대부분이 여기 세 블록의 JSX 분기였다 — 큐·판정 로직은 전부 lib 이
   갖고 있어서 본문에 남아 있던 것은 사실상 카드 세 벌의 마크업뿐이었다.
   ⚠ 문구·배지는 여전히 **lib 이 소유**한다(`cardSpeech`·`chapterCopy` · §9-4) — 파일을 갈랐다고
   말이 갈리면 H14 가 고친 `chapterCopy` 2벌이 세 번째로 재발한다. */

/** 펼치기 전/후로 갈리는 하단 버튼 줄 — 세 카드가 같은 배치를 쓴다(회상·착각). */
function RevealActions({
  revealLabel,
  doneLabel,
  revealed,
  onReveal,
  onAdvance,
}: {
  revealLabel: string;
  doneLabel: string;
  revealed: boolean;
  onReveal: () => void;
  onAdvance: (didIt: boolean) => void;
}) {
  return (
    <div className="mt-1 flex gap-2">
      {!revealed ? (
        <button type="button" onClick={onReveal} className={GHOST}>
          {revealLabel}
        </button>
      ) : null}
      <button type="button" onClick={() => onAdvance(false)} className={GHOST}>
        건너뛰기
      </button>
      <button type="button" onClick={() => onAdvance(true)} className={PRIMARY}>
        {doneLabel}
      </button>
    </div>
  );
}

/** 회상 — 내 옛 요약을 보지 않고 3문장으로 재생한다. 앵커는 원리적으로 없다(`Summary` 에 chapter 없음). */
function RetrievalCard({
  item,
  step,
  revealed,
  onReveal,
  onAdvance,
}: {
  item: Extract<RunItem, { kind: 'retrieval' }>;
  step: string;
  revealed: boolean;
  onReveal: () => void;
  onAdvance: (didIt: boolean) => void;
}) {
  return (
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
      <RevealActions
        revealLabel="원래 요약"
        doneLabel="다시 설명했어요"
        revealed={revealed}
        onReveal={onReveal}
        onAdvance={onAdvance}
      />
    </div>
  );
}

/** 착각 재확인 — 확신했지만 틀렸던 지점(CBMS). `sid|chapter` 를 다 갖는 진짜 인출 사건이다. */
function ConfidentCard({
  item,
  step,
  revealed,
  onReveal,
  onAdvance,
}: {
  item: Extract<RunItem, { kind: 'confident' }>;
  step: string;
  revealed: boolean;
  onReveal: () => void;
  onAdvance: (didIt: boolean) => void;
}) {
  return (
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
      <RevealActions
        revealLabel="당시 메모"
        doneLabel="다시 확인했어요"
        revealed={revealed}
        onReveal={onReveal}
        onAdvance={onAdvance}
      />
    </div>
  );
}

/** 밀린 챕터 — 펼칠 본문이 없다(그래서 탭 제스처도 안 건다). 긍정 판정이 곧 앵커 이동이다. */
function ChapterCard({
  item,
  step,
  onAdvance,
}: {
  item: Extract<RunItem, { kind: 'chapter' }>;
  step: string;
  onAdvance: (didIt: boolean) => void;
}) {
  const copy = chapterCopy(item.ch);
  return (
    <div className={CARD}>
      <div className="flex items-center justify-between gap-2">
        <span className={`${BADGE} ${item.ch.risk === 'overdue' ? 'bg-tint-bad text-bad' : ''}`}>{copy.badge}</span>
        <span className="text-2xs text-mut">
          {step}
          {copy.age}
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
      <p className="text-sm text-mut">{copy.body}</p>
      <div className="mt-1 flex gap-2">
        <button type="button" onClick={() => onAdvance(false)} className={GHOST}>
          건너뛰기
        </button>
        <button type="button" onClick={() => onAdvance(true)} className={PRIMARY}>
          인출했어요
        </button>
      </div>
    </div>
  );
}
