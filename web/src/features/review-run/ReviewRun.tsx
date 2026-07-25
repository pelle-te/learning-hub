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
import { todayISO, openVaultSearch } from '@/lib/utils';
import { riskSummary } from '@/lib/spacedReview';
import { buildReviewQueue, requeue, runItemKey, type RunItem } from '@/lib/reviewQueue';
import { CBMS_INFO } from '@/lib/methodology';
import { jolSummary, type JolEntry } from '@/lib/insights';
import { Button } from '@/components/ui';

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

   ⚠ `'ds-card'`·`'ds-glow'`·`'ds-muted'`·`'ds-tiny'` 는 그대로 둔다 — 공유 디자인 시스템은
   공유 SSOT 라 **맨 마지막**이다(건드리면 스냅샷 59장이 전부 흔들린다). 혼용이 정상. */
const WRAP = 'flex h-full flex-col items-center justify-center gap-4 p-runner-pad';
const CARD_BASE = 'flex w-full flex-col gap-3';
const CENTER = 'w-full max-w-runner-narrow items-center text-center';
const ACTS = 'mt-1 flex flex-wrap items-center gap-2';
const ACTS_END = `${ACTS} justify-end`;
const ACTS_CENTER = `${ACTS} justify-center`;
const SKIP =
  'cursor-pointer rounded-sm border border-line bg-none px-3 py-2 text-md text-mut hover:border-acc hover:text-txt';
const PROMPT = 'm-0! text-runner-prompt! leading-normal'; // h2 — 언레이어드 전역 h2{} 를 ! 로 이긴다
/* ID-11 인출 전 예측 바 — 카드 **위**에 얇게. 카드 어휘(ds-card)를 안 쓰는 건 의도다:
   이건 복습 대상이 아니라 그 앞의 한 줄짜리 질문이라, 카드로 보이면 위계가 카드와 맞먹는다. */
const JOL_BAR = 'flex w-full max-w-runner flex-wrap items-center justify-end gap-2';
const JOL_BTN =
  'cursor-pointer rounded-full border border-line bg-none px-3 py-1 text-xs text-mut hover:border-acc hover:text-txt';
/** 세션 앞 N개만 묻는다 — 매 카드마다 물으면 러너가 설문이 되고 대답이 무성의해진다. */
const JOL_MAX = 3;
const REVEAL = 'm-0 grid gap-2 rounded-md border border-line bg-tint-acc-faint py-3 pr-4 pl-8 leading-relaxed';
/* 배지 색은 data-* 변형으로 — 옛 `.badge[data-kind='confident']` 의 직역이다. */
const BADGE =
  'rounded-full bg-tint-acc px-2 py-1 text-xs font-bold tracking-wide text-acc whitespace-nowrap ' +
  'data-[kind=confident]:bg-tint-warn data-[kind=confident]:text-warn ' +
  'data-[risk=overdue]:bg-tint-bad data-[risk=overdue]:text-bad';

export default function ReviewRun() {
  const state = useApp((s) => s.state);
  const res = useSchedule();
  const nav = useNavigate();
  const today = todayISO(state);

  const risk = riskSummary(state, res.days || [], today);

  /* 큐는 **세션 시작 시점의 스냅샷**이다(D-1). 재큐가 큐를 늘리므로 상태가 아니면 안 되고,
     파생으로 두면 세션 중 상태 변화(챕터 '집중 시작' → completions 갱신 · 클라우드 pull 병합)가
     발밑에서 큐를 갈아 끼워 `idx` 가 다른 카드를 가리킨다. 다시 열면 다시 만든다. */
  const [queue, setQueue] = useState<RunItem[]>(() => buildReviewQueue(state, res.days, today));
  const [idx, setIdx] = useState(0);
  /* '해낸 것'은 **서로 다른 카드**로 센다 — 재큐가 같은 카드를 두 번 보여주므로 이벤트로 세면
     "12개 중 14개 인출"이 나온다(옛 `doneCount` 가 정확히 그 형태였다). */
  const [gotKeys, setGotKeys] = useState<string[]>([]);
  const [revealedAt, setRevealedAt] = useState(-1);
  const revealed = revealedAt === idx;

  /* ID-11 인출 전 예측(JOL) — 펼치기 **전에** "떠오를 것 같아?"를 한 번 묻고 실제 결과와 대조한다.
     ⚠ 마찰 절제: 세션 앞 JOL_MAX 개만 묻는다. 매 카드마다 물으면 러너가 설문이 되고, 그러면
       사람들은 아무거나 눌러 신호가 오히려 나빠진다.
     ⚠ 영속하지 않는다(로컬 state) — D1·서버 zod·폰 계약까지 번지는 새 필드를 지표 하나로 열지 않는다.
     ⚠ 대답은 **선택**이다. 안 누르고 넘어가면 기록도 없다(강제하면 위 마찰 문제로 되돌아간다). */
  const [jol, setJol] = useState<JolEntry[]>([]);
  const [pred, setPred] = useState<boolean | null>(null);
  // 재큐된 카드에는 안 묻는다 — 예측은 첫 대면에서만 의미가 있고(두 번째는 이미 답을 봤다),
  // 같은 카드가 대조 기록에 두 번 들어가면 jolSummary 의 표본이 부풀어 오른다.
  const askJol = !revealed && pred === null && jol.length < JOL_MAX && !queue[idx]?.again;

  const total = queue.length;
  const finished = idx >= total;
  const remaining = Math.max(0, total - idx);
  const cardCount = queue.filter((i) => !i.again).length; // 서로 다른 카드 수 = 정직한 분모
  const gotCount = gotKeys.length;
  const againCount = total - cardCount;

  usePageChromeEffect(
    () => ({
      readouts: [
        { label: '남은 복습', value: finished ? 0 : remaining, accent: !finished && remaining > 0 },
        { label: '해낸 것', value: gotCount },
        { label: '오늘 위험', value: `${risk.overdue}⬤ ${risk.due}◒` },
      ],
      action: { label: '오늘 학습', onClick: () => nav('/today') },
    }),
    [remaining, gotCount, finished, risk.overdue, risk.due],
  );

  const advance = (didIt: boolean) => {
    const cur = queue[idx];
    if (didIt) {
      if (cur) setGotKeys((ks) => (ks.includes(runItemKey(cur)) ? ks : [...ks, runItemKey(cur)]));
    } else {
      // D-1 — 못 한 카드는 버리지 않고 세션 안에서 한 번 더(3장 뒤). 조건은 requeue 가 판단한다.
      setQueue((q) => requeue(q, idx));
    }
    // 예측을 남긴 카드만 대조 기록에 들어간다 — 안 물었거나 안 누른 카드는 조용히 빠진다.
    if (pred !== null) setJol((rows) => [...rows, { predicted: pred, recalled: didIt }]);
    setPred(null);
    setIdx((i) => i + 1);
  };
  const reveal = () => setRevealedAt(idx);
  const restart = () => {
    setQueue(buildReviewQueue(state, res.days, today));
    setIdx(0);
    setGotKeys([]);
    setRevealedAt(-1);
    setJol([]);
    setPred(null);
  };

  // 빈 큐 — 복습할 게 없음(깨끗함).
  if (total === 0) {
    return (
      <div className={WRAP}>
        <div className={`ds-card ds-glow ${CENTER}`}>
          <div className="text-runner-mark leading-none" aria-hidden="true">
            ✓
          </div>
          <h2>복습할 게 없어요</h2>
          <p className="ds-muted">밀린 챕터도, 다시 인출할 요약·착각도 없습니다. 오늘 새 학습에 집중하세요.</p>
          <div className={ACTS_CENTER}>
            <Button onClick={() => nav('/today')}>오늘 학습으로</Button>
          </div>
        </div>
      </div>
    );
  }

  const jolStat = jolSummary(jol);

  // 완주 — 이 세션 리캡.
  if (finished) {
    return (
      <div className={WRAP}>
        <div className={`ds-card ds-glow ${CENTER}`}>
          <div className="text-runner-mark leading-none" aria-hidden="true">
            🎯
          </div>
          <h2>복습 세션 완료</h2>
          {/* D-1 — 분모는 **서로 다른 카드 수**다. 옛 문구는 큐 길이를 분모로 썼는데 재큐가 그
              길이를 늘리므로 "12개 중 14개"가 나올 수 있었다(같은 카드를 두 번 세는 형태). */}
          <p className="ds-muted">
            카드 {cardCount}장 중 <strong>{gotCount}</strong>개를 인출했어요
            {againCount > 0 && <> · 놓친 {againCount}개는 세션 안에서 한 번 더 만났어요</>}. 남은 챕터는 볼트에서
            이어가세요.
          </p>
          {/* ID-11 — 예측이 얼마나 맞았나. **비율을 안 쓴다**(표본이 최대 3건이라 %는 정밀해 보이는
              소음이다) · 과신은 따로 짚는다: "될 줄 알았는데 안 됨"이 복습을 건너뛰게 하는 방향이다. */}
          {jolStat && (
            <p className="ds-muted ds-tiny">
              떠오를지 미리 답한 {jolStat.n}개 중 <strong>{jolStat.hit}개</strong>를 맞혔어요
              {jolStat.over > 0 && <> · 될 줄 알았는데 안 된 게 {jolStat.over}개(과신)</>}
              {jolStat.under > 0 && <> · 애매하다 했는데 된 게 {jolStat.under}개</>}
            </p>
          )}
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
  /* 재큐된 카드는 그렇다고 말한다 — 안 말하면 아까 넘긴 카드가 다시 뜬 것이 결함으로 읽힌다. */
  const step = `${item.again ? '↻ 다시 · ' : ''}${idx + 1} / ${total}`;

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

      {/* ID-11 — 카드 위 한 줄. 카드 종류가 셋이라 각 카드 안에 넣으면 같은 JSX 가 세 벌이 되고,
          그러면 한 곳만 고쳐지는 드리프트가 시작된다(이 저장소가 여러 번 물린 부류). */}
      {askJol && (
        <div className={JOL_BAR} role="group" aria-label="인출 전 예측">
          <span className="ds-tiny">펼치기 전에 — 이거 떠오를 것 같나요?</span>
          <button type="button" className={JOL_BTN} onClick={() => setPred(true)}>
            떠오를 듯
          </button>
          <button type="button" className={JOL_BTN} onClick={() => setPred(false)}>
            애매해
          </button>
        </div>
      )}

      {item.kind === 'retrieval' && (
        <div className={`ds-card ds-glow ${CARD_BASE} max-w-runner`} data-kind="retrieval">
          <div className="flex items-center justify-between gap-2">
            <span className={BADGE} data-kind="retrieval">
              회상
            </span>
            <span className="ds-tiny">
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
            <p className="ds-muted">머릿속으로 먼저 인출한 뒤, 아래로 내 원래 요약과 대조하세요.</p>
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
        <div className={`ds-card ds-glow ${CARD_BASE} max-w-runner`} data-kind="confident">
          <div className="flex items-center justify-between gap-2">
            <span className={BADGE} data-kind="confident">
              착각 재확인
            </span>
            <span className="ds-tiny">
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
              <p className="ds-tiny">처방: {CBMS_INFO[item.card.cbms.code].tip}</p>
            </div>
          ) : (
            <p className="ds-muted">먼저 스스로 답한 뒤, 당시 메모와 처방을 확인하세요.</p>
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
              onClick={() => openVaultSearch(item.card.cbms.name + ' ' + item.card.cbms.chapter)}
              title="Obsidian에서 검색"
            >
              🔎 볼트
            </button>
            <Button onClick={() => advance(true)}>다시 확인했어요</Button>
          </div>
        </div>
      )}

      {item.kind === 'chapter' && (
        <div className={`ds-card ds-glow ${CARD_BASE} max-w-runner`} data-kind="chapter" data-risk={item.ch.risk}>
          <div className="flex items-center justify-between gap-2">
            <span className={BADGE} data-kind="chapter" data-risk={item.ch.risk}>
              {item.ch.risk === 'overdue' ? '많이 밀림' : '복습 때'}
            </span>
            <span className="ds-tiny">
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
          <p className="ds-muted">
            배웠지만 {item.ch.daysSince}일 안 봤어요(마지막 {item.ch.lastDs}). 지금 인출해 망각곡선을 리셋하세요.
          </p>
          <div className={ACTS_END}>
            <button
              type="button"
              className={SKIP}
              onClick={() => openVaultSearch(item.ch.subject + ' ' + item.ch.chapter)}
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
