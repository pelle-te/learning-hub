/* ============================================================
   ReviewRun — 탭: ↻ 복습 실행 (I-9 · doing surface)
   식별(review/stats/mastery)은 풍부하나 '실제로 복습을 굴리는 화면'이 빔 — 그 빈칸을 메운다.
   오늘 인출할 것을 한 카드씩 흐름으로: ① 회상(내 요약 다시 설명) ② 착각 재확인(과신 오답 재인출)
   ③ 밀린 챕터(간격반복 due/overdue). 진행은 이 세션의 로컬 상태(가짜 위험 감소 주장 없음) —
   실제 학습은 '집중 시작'(전역 타이머)·볼트 딥링크로 다리 놓고, 완료 세션이 정직하게 루프를 먹인다.

   ## 조작은 키보드가 정본이다(D-3)
   `Space` 펼치기 · `1` 건너뛰기 · `2` 판정(펼친 뒤에만) · `V` 볼트 · `U` 되돌리기 · `Esc` 중단.
   카드 안에는 버튼이 없다 — 전부 화면 발치의 키캡 한 줄(`KeyBar`)로 모였고, 그 키캡이 곧
   누를 수 있는 버튼이다. 목록(`keys`)이 리스너와 화면의 **단일 원천**이라 둘이 갈릴 수 없다.
============================================================ */
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '@/store/useApp';
import { useSchedule } from '@/store/selectors';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { useFocus } from '@/store/useFocus';
import { useOverlay } from '@/store/useOverlay';
import { isTyping } from '@/hooks/interactions';
import { todayISO, openVaultSearch } from '@/lib/utils';
import { riskSummary } from '@/lib/spacedReview';
import { buildReviewQueue, cardSpeech, requeue, runItemKey, type RunItem } from '@/lib/reviewQueue';
import { putResume, clearResume, resumeDevice, type ResumeCursor, type ResumeNav } from '@/lib/resume';

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
const ACTS_CENTER = `${ACTS} justify-center`;
const PROMPT = 'm-0! text-runner-prompt! leading-normal'; // h2 — 언레이어드 전역 h2{} 를 ! 로 이긴다
/* ── D-3 발치 키캡 바 ────────────────────────────────────────────────────
   카드에서 버튼 무리(건너뛰기·펼치기·판정·볼트)를 걷어내고 화면 발치의 한 줄로 모았다.
   **키캡은 진짜 버튼이다** — 포인터 경로를 없애면 키보드를 못 쓰는 상황(터치·스위치)에서
   러너가 통째로 잠긴다. 키를 *가르치는* 라벨이자 누를 수 있는 컨트롤, 둘 다인 형태. */
const KEYBAR = 'flex w-full max-w-runner flex-wrap items-center justify-center gap-2';
const KEYBTN =
  'flex cursor-pointer items-center gap-1.5 rounded-sm border border-line bg-none px-2.5 py-1.5 text-xs text-mut hover:border-acc hover:text-txt';
const KEYBTN_ON = `${KEYBTN} border-acc-glow text-acc`;
const KEYCAP =
  'min-w-5 rounded-sm border border-line bg-panel2 px-1.5 py-0.5 text-center font-mono text-2xs leading-none text-txt shadow-kbd';
/* ID-11 인출 전 예측 바 — 카드 **위**에 얇게. 카드 어휘(ds-card)를 안 쓰는 건 의도다:
   이건 복습 대상이 아니라 그 앞의 한 줄짜리 질문이라, 카드로 보이면 위계가 카드와 맞먹는다. */
const JOL_BAR = 'flex w-full max-w-runner flex-wrap items-center justify-end gap-2';
/** N-7 착지 안내 — 카드 위 한 줄(절제: 배지나 카드가 아니라 문장 하나). */
const RESUME_NOTE = 'm-0 flex w-full max-w-runner flex-wrap items-center gap-2 text-xs text-mut';
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

/** 발치 키캡 하나 — `k` 는 KeyboardEvent.key 그대로(리스너와 라벨이 같은 값을 쓴다). */
interface RunKey {
  k: string;
  cap: string;
  label: string;
  run: () => void;
  primary?: boolean;
  /** 목록엔 있지만 바에는 안 그린다(관용 처리용 — 아래 `2` 펼치기 폴백). */
  quiet?: boolean;
}

/** 되돌리기용 세션 스냅샷 — 전진 직전 상태 전량(부분만 담으면 되돌린 뒤가 어긋난다). */
interface RunSnap {
  idx: number;
  queue: RunItem[];
  gotKeys: string[];
  revealedAt: number;
  jol: JolEntry[];
  pred: boolean | null;
}

/** 커서 쓰기/지우기(N-7) — 미연결이면 무동작. `useFocus` 와 같은 관용구. */
function writeResume(cur: ResumeCursor): void {
  const id = resumeDevice();
  if (!id) return;
  useApp.getState().mutate((st) => putResume(st, id, cur));
}
function dropResume(): void {
  const id = resumeDevice();
  if (!id) return;
  useApp.getState().mutate((st) => clearResume(st, id));
}

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
  /* N-7 착지 — '이어하기 (7/12)' 를 눌러 왔으면 그 자리에서 시작한다.
     ⚠ 이 두 줄이 없던 동안 칩은 진행을 **약속만 하고** 러너는 언제나 0 에서 열렸다. 즉
       `resume.ts` 머리주석이 이 기능의 존재 이유로 든 중복 학습("폰에서 7장 했는데 PC 에서
       또 본다")을 기능이 스스로 **보장**하고 있었다.
     ⚠ 커서를 여기서 직접 읽지 않는다 — 그러면 레일·⌘K 로 그냥 연 사람도 묻지 않고 7번째
       카드에서 시작한다. 의도는 **진입 경로**(내비 state)가 실어 나른다.
     ⚠ 큐는 이 기기에서 새로 짜이므로 길이가 다를 수 있다 → 클램프. 순서는 결정론적이라
       근사가 성립하고, 어긋나면 아래 '처음부터 보기'가 탈출구다. */
  const resumeAt = (useLocation().state as ResumeNav | null)?.resumeAt;
  const [startedAt] = useState(() =>
    typeof resumeAt === 'number' ? Math.max(0, Math.min(resumeAt, Math.max(0, queue.length - 1))) : 0,
  );
  const [idx, setIdx] = useState(startedAt);
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
  const [past, setPast] = useState<RunSnap[]>([]);
  // 재큐된 카드에는 안 묻는다 — 예측은 첫 대면에서만 의미가 있고(두 번째는 이미 답을 봤다),
  // 같은 카드가 대조 기록에 두 번 들어가면 jolSummary 의 표본이 부풀어 오른다.
  const askJol = !revealed && pred === null && jol.length < JOL_MAX && !queue[idx]?.again;

  const total = queue.length;
  const finished = idx >= total;
  /* N-7 — 끝냈으면 커서를 지운다(다른 기기에 유령 이어하기가 남지 않게).
     ⚠ 렌더가 아니라 이펙트다: 완주 분기 안에서 부르면 렌더 중 스토어를 변형하게 된다. */
  useEffect(() => {
    if (finished) dropResume();
  }, [finished]);
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
    setPast((p) => [...p, { idx, queue, gotKeys, revealedAt, jol, pred }]); // D-3 되돌리기용
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
    /* N-7 — 이어하기 커서(복습). **5장마다**만 쓴다: 카드마다 쓰면 한 세션이 아웃박스에 12행을
       남기고, 그 12행이 말하는 것은 같은 한 가지("복습 중")다. 진행 표기는 다음 카드 기준. */
    if ((idx + 1) % 5 === 0 && idx + 1 < queue.length)
      writeResume({ kind: 'review', label: '복습 세션', at: Date.now(), progress: `${idx + 2}/${queue.length}` });
  };
  const reveal = () => setRevealedAt(idx);
  /* D-3 되돌리기 — 오타 한 번(1 을 눌러야 할 때 2)이 세션 기록을 조용히 오염시키던 것을 닫는다.
     상태 전량을 스냅샷으로 되돌린다: 재큐가 큐를 바꿨을 수도, JOL 이 기록됐을 수도 있어
     `idx--` 만으로는 되돌아가지지 않는다(부분 복원이 곧 새 결함이다). */
  const undo = () => {
    const prev = past[past.length - 1];
    if (!prev) return;
    setPast((p) => p.slice(0, -1));
    setQueue(prev.queue);
    setIdx(prev.idx);
    setGotKeys(prev.gotKeys);
    setRevealedAt(prev.revealedAt);
    setJol(prev.jol);
    setPred(prev.pred);
  };
  const restart = () => {
    setQueue(buildReviewQueue(state, res.days, today));
    setIdx(0);
    setGotKeys([]);
    setRevealedAt(-1);
    setJol([]);
    setPred(null);
    setPast([]);
  };

  /* ── D-3 키보드 계약 ────────────────────────────────────────────────────
     이 화면엔 keydown 이 **0개**였다. 12장 세션이 21~27클릭이고 버튼이 카드 우측에 몰려
     있어 매 카드 같은 마우스 왕복을 했다 — 집중을 지키려는 화면이 손을 계속 불러냈다.

     ⚠ **판정은 대조 뒤에만**(`2` 는 펼친 뒤에 생긴다). 안 그러면 1/2 연타가 "12개 인출"로
     기록되지만 실제로는 아무것도 인출하지 않은 세션이 된다 — 학습 지능을 팔아 클릭을 사는
     교환이다. 다만 마찰로 두지 않는다: 펼치기 전에 `2` 를 누르면 **먼저 펼친다**(누른 사람의
     의도는 "됐다, 확인하자"이므로 그 다음 화면이 정확히 필요한 것이다). 키 수는 그대로 둘,
     대조 없는 판정만 원리적으로 불가능해진다.
     ⚠ `1`(건너뛰기)은 펼치기 전에도 된다 — "모르겠다, 넘김"은 정직한 결과이고, D-1 재큐가
     그 카드를 세션 안에서 한 번 더 데려온다.
     ⚠ 되돌리기(`u`)가 이 계약의 짝이다. 키가 빨라지면 오타도 빨라진다. */
  const cur = queue[idx];
  const keys: RunKey[] = [];
  if (cur) {
    const revealable = cur.kind !== 'chapter';
    if (revealable && !revealed)
      keys.push({
        k: ' ',
        cap: 'Space',
        label: cur.kind === 'retrieval' ? '원래 요약 펼치기' : '당시 메모 펼치기',
        run: reveal,
      });
    keys.push({ k: '1', cap: '1', label: '건너뛰기', run: () => advance(false) });
    if (cur.kind === 'chapter')
      keys.push({
        k: '2',
        cap: '2',
        label: '▶ 집중 시작',
        primary: true,
        run: () => {
          useFocus.getState().start({
            ds: today,
            sid: cur.ch.sid,
            type: 'rev',
            name: cur.ch.subject,
            min: 25,
            blockMin: 25,
            chapter: cur.ch.chapter, // 완료 시 챕터 터치 → 위험모델 lastDs 갱신(감사 #22)
          });
          advance(true);
        },
      });
    else
      keys.push({
        k: '2',
        cap: '2',
        label: revealed ? (cur.kind === 'retrieval' ? '다시 설명했어요' : '다시 확인했어요') : '펼쳐서 대조하기',
        primary: revealed,
        // 펼치기 전엔 **바에 안 그린다** — 그리면 Space 와 같은 일을 하는 칩이 둘이 된다.
        // 그래도 눌리면 펼친다: 계약을 가르치는 것과 실수를 벌하는 것은 다른 일이다.
        quiet: !revealed,
        run: () => (revealed ? advance(true) : reveal()),
      });
    if (cur.kind !== 'retrieval')
      keys.push({
        k: 'v',
        cap: 'V',
        label: '볼트에서 찾기',
        run: () =>
          openVaultSearch(
            cur.kind === 'confident'
              ? cur.card.cbms.name + ' ' + cur.card.cbms.chapter
              : cur.ch.subject + ' ' + cur.ch.chapter,
          ),
      });
  }
  /* ⚠ 되돌리기·중단은 **카드 밖에서도** 산다 — 특히 마지막 카드를 잘못 눌러 리캡으로 튄 순간이
     되돌리기가 가장 필요한 때다. 카드 안에만 두면 그 순간에 정확히 없다. */
  if (past.length) keys.push({ k: 'u', cap: 'U', label: '되돌리기', run: undo });
  keys.push({ k: 'Escape', cap: 'Esc', label: '중단', run: () => nav('/today') });

  /* 리스너는 마운트당 1회 — 목록은 이펙트에서 동기화한다(렌더 중 ref 쓰기 금지 · `useWeekNavKeys` 선례). */
  const keysRef = useRef<RunKey[]>([]);
  useEffect(() => {
    keysRef.current = keys;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping()) return;
      if (useOverlay.getState().palette || useOverlay.getState().help) return; // 위가 열려 있으면 그쪽 것
      const hit = keysRef.current.find((a) => a.k === e.key);
      if (!hit) return;
      e.preventDefault();
      hit.run();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

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
        {/* 마지막 카드를 잘못 눌러 여기 도착했을 수 있다 — 되돌리기가 가장 필요한 순간이다. */}
        <KeyBar keys={keys} />
      </div>
    );
  }

  const item = queue[idx]!;
  /* 재큐된 카드는 그렇다고 말한다 — 안 말하면 아까 넘긴 카드가 다시 뜬 것이 결함으로 읽힌다. */
  const step = `${item.again ? '↻ 다시 · ' : ''}${idx + 1} / ${total}`;

  /* ⚠⚠ **카드 전환이 스크린리더에 완전 무음이었다(H13 · 2026-07-26 감사).**
     카드 세 종류가 같은 `key` 로 자리를 바꾸므로 포커스는 버튼에 남고 **본문만 교체**된다 —
     SR 입장에서는 아무 일도 안 일어난 것이다. `progressbar` 의 `aria-label` 갱신은 공지
     대상이 아니라서 그 층도 못 메운다. 결과: 12장 세션 내내 무엇을 보고 있는지 모른 채
     버튼만 누른다(기능이 있는데 안 보이는 것과 같다).
     → 카드 **밖**의 라이브 리전에 "n/총 · 배지 · 프롬프트 요약"을 싣는다. 밖인 것이 중요하다:
       카드 안에 두면 카드와 함께 교체돼 리전이 매번 새로 삽입되고, 그러면 공지가 씹힌다. */
  const { badge, subject } = cardSpeech(item); // 문구는 lib 이 소유(폰 러너와 같은 말)

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

      {/* N-7 착지 안내 — 이어하기로 왔고 아직 아무것도 안 했을 때만. 건너뛴 카드가 있다는 사실을
          말하지 않으면 "앱이 앞부분을 잃었다"로 읽히고, 탈출구가 없으면 그 추측을 확인할 방법도
          없다. 첫 판정을 내리는 순간 사라진다(그 뒤엔 이 세션의 이야기다). */}
      {startedAt > 0 && idx === startedAt && past.length === 0 && (
        <p className={RESUME_NOTE}>
          다른 기기에서 {startedAt}장까지 봤어요 — {startedAt + 1}번째부터 이어갑니다.
          <Button onClick={restart} variant="ghost" sm>
            처음부터 보기
          </Button>
        </p>
      )}

      {/* H13 — 카드 전환 공지(시각 영향 0). 카드 **밖**이라 리전이 계속 살아 있고 텍스트만 바뀐다. */}
      <p className="sr-only" role="status">
        {step} · {badge} · {subject}
      </p>

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
        </div>
      )}

      {item.kind === 'chapter' && (
        <div className={`ds-card ds-glow ${CARD_BASE} max-w-runner`} data-kind="chapter" data-risk={item.ch.risk}>
          <div className="flex items-center justify-between gap-2">
            <span className={BADGE} data-kind="chapter" data-risk={item.ch.risk}>
              {item.ch.maintenance ? '유지' : item.ch.risk === 'overdue' ? '많이 밀림' : '복습 때'}
            </span>
            <span className="ds-tiny">
              {step}
              {item.ch.maintenance && !item.ch.lastDs ? '' : ` · ${item.ch.daysSince}일 방치`}
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
          {/* 유지 카드는 **왜 돌아왔는지**를 말해야 한다 — 끝낸 챕터가 설명 없이 다시 뜨면
              사용자 눈엔 앱이 완료를 잊은 것으로 읽힌다(앵커를 모르는 경우는 그렇다고 말한다). */}
          <p className="ds-muted">
            {item.ch.maintenance ? (
              item.ch.lastDs ? (
                <>
                  끝낸 챕터예요. 마지막으로 본 지 {item.ch.daysSince}일({item.ch.lastDs}) — 유지 인출로 붙잡아 둡니다.
                </>
              ) : (
                <>끝낸 챕터인데 마지막으로 본 날이 기록에 없어요. 한 번 인출하면 그때부터 유지 주기가 잡힙니다.</>
              )
            ) : (
              <>
                배웠지만 {item.ch.daysSince}일 안 봤어요(마지막 {item.ch.lastDs}). 지금 인출해 망각곡선을 리셋하세요.
              </>
            )}
          </p>
        </div>
      )}

      <KeyBar keys={keys} />
    </div>
  );
}

/** D-3 발치 키캡 한 줄 — 카드마다 흩어져 있던 버튼 무리가 여기 하나로 모였다.
 *  키캡은 **누를 수도 있다**(포인터 경로 보존 — 키보드만 남기면 러너가 통째로 잠긴다).
 *  목록은 러너의 `keys` 가 단일 원천이라 리스너와 화면이 갈릴 수 없다 — 갈리면
 *  "화면엔 있는데 안 눌리는 키"(또는 그 반대)가 생기고 그건 조용하다. */
function KeyBar({ keys }: { keys: RunKey[] }) {
  const shown = keys.filter((a) => !a.quiet);
  if (!shown.length) return null;
  return (
    <div className={KEYBAR} role="group" aria-label="복습 조작">
      {shown.map((a) => (
        <button
          key={a.k}
          type="button"
          className={a.primary ? KEYBTN_ON : KEYBTN}
          onClick={a.run}
          aria-keyshortcuts={a.k === ' ' ? 'Space' : a.cap}
        >
          <kbd className={KEYCAP}>{a.cap}</kbd>
          {a.label}
        </button>
      ))}
    </div>
  );
}
