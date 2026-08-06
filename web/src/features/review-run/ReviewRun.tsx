/* ============================================================
   ReviewRun — 탭: ↻ 복습 실행 (I-9 · doing surface)
   식별(review/stats/mastery)은 풍부하나 '실제로 복습을 굴리는 화면'이 빔 — 그 빈칸을 메운다.
   오늘 인출할 것을 한 카드씩 흐름으로: ① 회상(내 요약 다시 설명) ② 착각 재확인(과신 오답 재인출)
   ③ 밀린 챕터(간격반복 due/overdue). 진행은 이 세션의 로컬 상태(가짜 위험 감소 주장 없음) —
   실제 학습은 '집중 시작'(전역 타이머)·볼트 딥링크로 다리 놓고, 완료 세션이 정직하게 루프를 먹인다.

   ## 조작은 키보드가 정본이다(D-3)
   `Space` 펼치기 · `1` 건너뛰기 · `2` 판정/집중 시작 · `3` 떠올렸어요(챕터 · 볼트를 연 뒤) ·
   `V` 볼트 · `U` 되돌리기 · `Esc` 중단.
   카드 안에는 버튼이 없다 — 전부 화면 발치의 키캡 한 줄(`KeyBar`)로 모였고, 그 키캡이 곧
   누를 수 있는 버튼이다. 목록(`keys`)이 리스너와 화면의 **단일 원천**이라 둘이 갈릴 수 없다.

   ## 인출이 앵커를 옮긴다(E1 · 2026-07-29)
   이 화면은 챕터 카드에 _"지금 인출해 망각곡선을 리셋하세요"_ · _"한 번 인출하면 그때부터 유지
   주기가 잡힙니다"_ 라고 **약속해 놓고 그 경로를 주지 않았다.** `touchReview` 의 쓰기 호출부가
   `app/FocusChip.tsx` 하나였기 때문 — 즉 앵커를 얻으려면 25분 집중 세션을 완주하고 토스트가
   살아 있는 동안 '블록 완료로 표시'까지 눌러야 했다. 그래서 유지 큐(끝낸 챕터)는 앵커를 못 얻어
   영구히 `due` 였고, `reviewQueue.ts` 의 `MAINTENANCE_CAP` 주석이 그 기능의 존립 근거로 든
   _"볼 때마다 진짜 앵커가 하나씩 생겨 큐가 스스로 수렴한다"_ 가 한 번도 참이 아니었다.

   ⚠ **`2`(집중 시작)에서 앵커를 옮기지 않는 것이 이 설계의 핵심이다.** 그건 인출 사건이 아니라
     세션 *시작*이라, 거기에 매달면 25분 공부 없이 `2` 를 14번 눌러 14개 챕터의 망각곡선을
     리셋하게 된다 — 사용자가 승인한 "인출 사건이 사다리의 단위"라는 근거로도 정당화되지 않는다
     (그 경우 인출 사건 자체가 없다). 그래서 **`3` 을 따로 판다.**
   ⚠ **`3` 에는 대조 게이트가 없다** — 챕터 카드엔 펼칠 본문이 없어서(`revealable` 이 이 종류를
     애초에 제외한다) 요구할 대조가 없고, 볼트 열람을 조건으로 걸면 그건 계약이 아니라 새 마찰이다.
     자기보고의 위험은 알려진 채로 수용된 것이고, 최악이 "덜 급한 챕터를 좀 늦게 본다"라 방향이
     안전한 쪽이다(`spacedReview.ts:47-50` 의 비대칭 논거와 부호가 같다).
   ⚠ **회상 카드는 앵커가 원리적으로 없다** — `Summary` 에 `chapter` 필드 자체가 없다(요약은 과목
     단위다). sid 만으로 아무 챕터나 리셋하는 것은 인출 기록이 아니라 오염이라 하지 않는다.
============================================================ */
import { useEffect, useRef, useState } from 'react';
import { useKeymapDoc } from '@/hooks/useKeymap';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '@/store/useApp';
import { useSchedule } from '@/store/selectors';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { useFocus } from '@/store/useFocus';
import { useOverlay } from '@/store/useOverlay';
import { isTyping } from '@/hooks/interactions';
import { todayISO, openVaultSearch, vaultQuery } from '@/lib/utils';
import { touchReview, reviewTouchOf, restoreReviewTouch } from '@/lib/persistence';
import { toast } from '@/shell/toast';
import { riskSummary } from '@/lib/spacedReview';
import { holdReview, isHeld } from '@/lib/reviewHold';
import {
  anchorOf,
  buildReviewQueue,
  cardSpeech,
  chapterCopy,
  missTarget,
  requeue,
  runItemKey,
  type RunItem,
} from '@/lib/reviewQueue';
import { type ResumeNav } from '@/lib/resume';
import { writeResume, dropResume } from '@/store/resumeCursor';

import { CBMS_INFO, CBMS_CODES, addCbms, editCbms } from '@/lib/methodology';
import type { CbmsCode } from '@/lib/types';
import { jolSummary, overconfidentCards, type JolEntry } from '@/lib/insights';
import { Button } from '@/components/ui';
import { Icon } from '@/components/Icon';

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

   ⚠ `'ds-well'`·`'ds-glow'`·`'text-mut'`·`'ds-tiny'` 는 그대로 둔다 — 공유 디자인 시스템은
   공유 SSOT 라 **맨 마지막**이다(건드리면 트랙 A 시각 베이스라인이 전부 흔들린다). 혼용이 정상. */
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
/* ID-11 인출 전 예측 바 — 카드 **위**에 얇게. 카드 어휘(ds-well)를 안 쓰는 건 의도다:
   이건 복습 대상이 아니라 그 앞의 한 줄짜리 질문이라, 카드로 보이면 위계가 카드와 맞먹는다. */
const JOL_BAR = 'flex w-full max-w-runner flex-wrap items-center justify-end gap-2';
/** N-7 착지 안내 — 카드 위 한 줄(절제: 배지나 카드가 아니라 문장 하나). */
const RESUME_NOTE = 'm-0 flex w-full max-w-runner flex-wrap items-center gap-2 text-xs text-mut';
const JOL_BTN =
  'cursor-pointer rounded-full border border-line bg-none px-3 py-1 text-xs text-mut hover:border-acc hover:text-txt';
/* P-2 오답 한 줄 — JOL 바와 **같은 형상**을 의도적으로 쓴다. 둘 다 "카드가 아닌, 카드 앞뒤의
   한 줄짜리 질문"이라 같은 어휘여야 하고, 서로 동시에 뜨지 않으므로(askJol 이 `!miss`) 자리도
   겹치지 않는다. 왼쪽 정렬인 것만 다르다 — 이건 방금 지나간 것에 대한 말이라 진행 방향의 반대다. */
const MISS_BAR = 'flex w-full max-w-runner flex-wrap items-center justify-start gap-2';
const MISS_BTN =
  'flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-none px-3 py-1 text-xs text-mut hover:border-acc hover:text-txt';
/** 세션 앞 N개만 묻는다 — 매 카드마다 물으면 러너가 설문이 되고 대답이 무성의해진다. */
const JOL_MAX = 3;
const REVEAL = 'm-0 grid gap-2 rounded-md border border-line bg-tint-acc-faint py-3 pr-4 pl-8 leading-relaxed';
/* 배지 색은 data-* 변형으로 — 옛 `.badge[data-kind='confident']` 의 직역이다. */
const BADGE =
  'rounded-full bg-tint-acc px-2 py-1 text-xs font-bold tracking-wide text-acc-on-soft whitespace-nowrap ' +
  'data-[kind=confident]:bg-tint-warn data-[kind=confident]:text-warn ' +
  'data-[risk=overdue]:bg-tint-bad data-[risk=overdue]:text-bad';

/** P-2 커밋 **뒤**의 선택 메모 한 줄 — W8 `BlankNoteField` 와 같은 계약이다.
 *  ⚠ 취소 버튼이 없다: 기록은 이미 커밋됐고 이건 정밀도만 올린다. 안 적고 떠나도 잃는 것이 0.
 *  ⚠ 자동 포커스를 **주지 않는다**(W8 과 다른 점). 저기는 사용자가 그 줄을 열어서 마운트되지만,
 *    여기는 코드 한 키의 부수효과로 나타나므로 커서를 뺏으면 러너 키보드가 통째로 죽는다. */
function MissNoteField({ target, onSave }: { target: string; onSave: (v: string) => void }) {
  const [v, setV] = useState('');
  return (
    <>
      <span className="ds-tiny">
        ✓ <strong>{target}</strong> 오답으로 남겼어요 — 한 줄 덧붙이기(선택)
      </span>
      <input
        type="text"
        className="min-w-0 flex-1"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSave(v);
        }}
        placeholder="예) 경계조건 부호를 반대로 잡음"
        aria-label="오답 메모(선택)"
      />
      <Button sm variant="ghost" onClick={() => onSave(v)}>
        {v.trim() ? '저장' : '닫기'}
      </Button>
    </>
  );
}

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

/** 되돌리기용 세션 스냅샷 — 전진 직전 상태 전량(부분만 담으면 되돌린 뒤가 어긋난다).
 *  `touch` 는 이 전진이 **앱 상태에 남긴 앵커**와 그 직전 값이다(E1). 세션 state 만 되돌리고
 *  앵커를 두고 오면 화면은 물렸다고 하고 모델은 인출했다고 하는 어긋남이 조용히 남는다. */
interface RunSnap {
  idx: number;
  queue: RunItem[];
  gotKeys: string[];
  revealedAt: number;
  jol: JolEntry[];
  pred: boolean | null;
  touch?: { sid: string; chapter: string; prev: string | undefined };
}

/**
 * D-3 키보드 계약 — 카드 종류·대조 여부·오답 줄 상태에서 **키 목록**을 조립한다.
 *
 * 이 화면엔 keydown 이 0개였다. 12장 세션이 21~27클릭이고 버튼이 카드 우측에 몰려 있어 매 카드
 * 같은 마우스 왕복을 했다 — 집중을 지키려는 화면이 손을 계속 불러냈다.
 *
 * ⚠ **판정은 대조 뒤에만**(`2` 는 펼친 뒤에 생긴다). 안 그러면 1/2 연타가 "12개 인출"로 기록되지만
 *   실제로는 아무것도 인출하지 않은 세션이 된다 — 학습 지능을 팔아 클릭을 사는 교환이다. 다만
 *   마찰로 두지 않는다: 펼치기 전에 `2` 를 누르면 **먼저 펼친다**(누른 사람의 의도는 "됐다,
 *   확인하자"이므로 그 다음 화면이 정확히 필요한 것이다). 키 수는 그대로 둘, 대조 없는 판정만
 *   원리적으로 불가능해진다.
 * ⚠ `1`(건너뛰기)은 펼치기 전에도 된다 — "모르겠다, 넘김"은 정직한 결과이고, D-1 재큐가 그 카드를
 *   세션 안에서 한 번 더 데려온다.
 * ⚠ 되돌리기(`u`)가 이 계약의 짝이다. 키가 빨라지면 오타도 빨라진다.
 * ⚠ 되돌리기·중단은 **카드 밖에서도** 산다 — 특히 마지막 카드를 잘못 눌러 리캡으로 튄 순간이
 *   되돌리기가 가장 필요한 때다. 카드 안에만 두면 그 순간에 정확히 없다.
 *
 * ⚠⚠ 이 목록은 keydown 리스너와 발치 `KeyBar` 의 **단일 원천**이다 — 둘이 갈리면 "화면엔 있는데
 *   안 눌리는 키"(또는 그 반대)가 생기고 그건 조용하다. 조립을 컴포넌트 본문 밖에 두는 이유가
 *   그것이다: 계약 전체를 한 화면에서 읽을 수 있어야 한다.
 */
function buildKeys(d: {
  cur: RunItem | undefined;
  revealed: boolean;
  reveal: () => void;
  advance: (didIt: boolean, anchor?: boolean) => void;
  skip: (it: RunItem) => void;
  startFocus: (it: Extract<RunItem, { kind: 'chapter' }>) => void;
  askingMiss: boolean;
  commitMiss: (code: CbmsCode) => void;
  canUndo: boolean;
  undo: () => void;
  abort: () => void;
}): RunKey[] {
  const { cur, revealed } = d;
  const keys: RunKey[] = [];
  if (cur) {
    // 챕터 카드엔 펼칠 본문이 없다 — 그래서 Space 도 대조 게이트도 이 종류를 애초에 제외한다.
    if (cur.kind !== 'chapter' && !revealed)
      keys.push({
        k: ' ',
        cap: 'Space',
        label: cur.kind === 'retrieval' ? '원래 요약 펼치기' : '당시 메모 펼치기',
        run: d.reveal,
      });
    keys.push({ k: '1', cap: '1', label: '건너뛰기', run: () => d.skip(cur) });
    if (cur.kind === 'chapter') {
      keys.push({ k: '2', cap: '2', label: '집중 시작', primary: true, run: () => d.startFocus(cur) });
      /* E1 — 챕터 카드의 인출 판정. `2`(집중 시작)와 뜻이 다르다: 저건 "이제 25분 볼게"이고
         이건 "지금 떠올렸어"다. 앵커를 옮기는 것은 후자뿐이다.
         ⚠ **대조 게이트를 걸지 않는다.** 볼트 열람을 조건으로 걸면 그건 계약이 아니라 새 마찰이다.
           자기보고의 위험(대충 누르면 곡선이 리셋된다)은 사용자가 알고 내린 결정이며, 최악이
           "덜 급한 챕터를 좀 늦게 본다"라 방향이 안전한 쪽이다. */
      keys.push({ k: '3', cap: '3', label: '떠올렸어요', run: () => d.advance(true, true) });
    } else
      keys.push({
        k: '2',
        cap: '2',
        label: revealed ? (cur.kind === 'retrieval' ? '다시 설명했어요' : '다시 확인했어요') : '펼쳐서 대조하기',
        primary: revealed,
        // 펼치기 전엔 **바에 안 그린다** — 그리면 Space 와 같은 일을 하는 칩이 둘이 된다.
        // 그래도 눌리면 펼친다: 계약을 가르치는 것과 실수를 벌하는 것은 다른 일이다.
        quiet: !revealed,
        // 착각 재확인은 `sid|chapter` 를 다 갖는 **진짜 인출 사건**이라 앵커를 옮긴다(E1).
        // 회상은 `Summary` 에 chapter 가 없어 옮길 것이 없다 — `anchorOf` 가 null 을 준다.
        run: () => (revealed ? d.advance(true, true) : d.reveal()),
      });
    if (cur.kind !== 'retrieval')
      keys.push({
        k: 'v',
        cap: 'V',
        label: '볼트에서 찾기',
        run: () =>
          // 질의 조립은 `lib/utils.vaultQuery` 하나(H14).
          openVaultSearch(
            cur.kind === 'confident'
              ? vaultQuery(cur.card.cbms.name, cur.card.cbms.chapter)
              : vaultQuery(cur.ch.subject, cur.ch.chapter),
          ),
      });
  }
  /* P-2 — `quiet` 라 발치 키캡 바에는 안 그린다: 칩 다섯이 그 줄에 이미 **글자와 함께** 있고,
     바에 또 그리면 같은 것이 두 벌이 된다.
     ⚠ 키 충돌 확인 — 러너의 기존 키는 `Space·1·2·3·V·U·Esc` 라 다섯 자 어디와도 안 겹친다. */
  if (d.askingMiss)
    for (const code of CBMS_CODES)
      keys.push({
        k: code.toLowerCase(),
        cap: code,
        label: CBMS_INFO[code].label,
        quiet: true,
        run: () => d.commitMiss(code),
      });
  if (d.canUndo) keys.push({ k: 'u', cap: 'U', label: '되돌리기', run: d.undo });
  keys.push({ k: 'Escape', cap: 'Esc', label: '중단', run: d.abort });
  return keys;
}

export default function ReviewRun() {
  const state = useApp((s) => s.state);
  /* E16 — 이 화면은 앱에서 키가 가장 많은데 **치트시트에 없었다**. 발치 `KeyBar` 가 화면 위에서
     가르치지만 그건 *이 카드에 지금 뜨는 것*만 보여준다 — `?` 를 눌러 전체 어휘를 물었을 때
     답이 없으면, 있는 기능이 없는 것과 같다. 등록은 아래 리스너가 그대로 하고 설명만 올린다
     (`keys` 는 카드 종류에 따라 달라지므로 `useKeymap` 의 keys→run 모델로 옮길 수 없다). */
  useKeymapDoc('이 화면 · 복습 실행', [
    { display: 'Space', label: '펼쳐서 대조' },
    { display: '1', label: '건너뛰기' },
    { display: '2', label: '판정 / 집중 시작' },
    { display: '3', label: '떠올렸어요(챕터 · 앵커를 옮긴다)' },
    { display: 'V', label: '볼트에서 찾기' },
    { display: 'U', label: '되돌리기' },
    { display: 'Esc', label: '중단' },
  ]);
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
  /* ── P-2 인라인 CBMS(2026-08-01) ────────────────────────────────────────────
     러너 안에서 실패한 카드를 오답으로 남기는 **경로가 0**이었다. 완주 화면의 과신 카드만
     버튼 하나였고 그것도 `/journal` 이동이라 러너 문맥을 잃었다. 오늘 탭에서 시작하면
     **3클릭·2화면·4필드**. 이 파일이 자기 손으로 적어 뒀다: _"그 2개를 오답으로 남기려면
     3화면·6클릭이라 아무도 안 했다."_ 그 결과가 `cbms` **0행**이고, 0행이
     `mistakeArchive`·`weakSpots`·`pickConfidentWrong`·복습 사다리(P-3)를 전부 굶긴다.
     외부 근거: 오답 로그는 규율이 아니라 **항목당 시간**에서 죽는다(60초를 넘으면 단순화하라
     — mistaketomastery.com · 확인 2026-08-01).

     ## ⚠ W8 패턴 그대로: **먼저 커밋 · 메모는 나중 · 취소 경로 없음**
     `1`(못 떠올림)은 **하나도 안 느려진다** — 카드는 즉시 전진하고, 방금 넘긴 카드에 대한
     "왜 막혔나" 한 줄이 다음 카드 위에 뜬다. 안 고르고 지나가도 잃는 것이 0이라 마찰이 아니다.
     ⚠ 되돌리기(`u`)는 이 줄을 **닫기만** 하고 이미 커밋된 기록은 지우지 않는다 — "못 떠올렸다"는
       관측은 세션 내비게이션과 무관하게 참이고, 정정 경로는 오답 아카이브의 삭제다. */
  const [miss, setMiss] = useState<{ sid: string; name: string; chapter: string } | null>(null);
  /** 코드를 고른 뒤의 기록 id — 메모만 덧붙이는 데 쓴다. null 이면 아직 안 골랐다. */
  const [missId, setMissId] = useState<string | null>(null);
  // 재큐된 카드에는 안 묻는다 — 예측은 첫 대면에서만 의미가 있고(두 번째는 이미 답을 봤다),
  // 같은 카드가 대조 기록에 두 번 들어가면 jolSummary 의 표본이 부풀어 오른다.
  /* ⚠ `!miss` — 오답 한 줄이 떠 있으면 예측은 안 묻는다. 둘은 **다른 카드**에 대한 질문이라
     같이 뜨면 화면이 무엇을 묻는지 흐려지고, JOL 은 선택이지만 CBMS 표본은 지금 0행이다. */
  const askJol = !revealed && pred === null && jol.length < JOL_MAX && !queue[idx]?.again && !miss;

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
      /* ⚠⚠ **목적지인데 앵커가 없었다(H3 · 2026-07-31 `/감사 근본`).** W22 는 destination 마다
         `primary`(44px)를 요구했고 불변식이 그걸 지킨다고 했는데, 이 화면은 크롬 호출에 `primary`
         가 **없는 채로 통과**했다 — 검사가 feature 폴더 전체에서 `/\bprimary:/` 를 찾았고 아래
         키캡 객체의 `primary: true`·`primary: revealed` 두 줄에 걸렸기 때문이다. `review-run` 은
         가장 최근에 승격된 목적지다(W17).
         ⚠ 그리고 **같은 양을 두 번 그리지 않는다** — 이 배치가 세 화면에서 자책한 형태다.
           `남은 복습`을 앵커로 올리면서 아래 리드아웃에서는 뺀다(한 양 = 한 자리). */
      primary: { value: String(finished ? 0 : remaining), unit: '장', label: '남은 복습' },
      readouts: [
        { label: '해낸 것', value: gotCount },
        { label: '오늘 위험', value: `${risk.overdue}⬤ ${risk.due}◒` },
      ],
      action: { label: '오늘 학습', onClick: () => nav('/today') },
    }),
    [remaining, gotCount, finished, risk.overdue, risk.due],
  );

  /**
   * 한 카드를 마친다. `anchor` 가 참이면 이 전진은 **인출 사건**이라 복습 앵커를 오늘로 옮긴다(E1).
   * ⚠ 호출부가 앵커 여부를 정한다 — 여기서 `didIt` 만 보고 판단하면 `2`(집중 시작)까지 앵커를
   *   옮겨, 공부 없이 키만 눌러도 망각곡선이 리셋된다(머리주석 ⚠ 첫째).
   */
  const advance = (didIt: boolean, anchor = false) => {
    const cur = queue[idx];
    const a = anchor && cur ? anchorOf(cur) : null;
    // 되돌리기가 앵커까지 물릴 수 있도록 **직전 값을 스냅샷에 함께** 담는다(쓰기 전에 읽는다).
    const snap: RunSnap = { idx, queue, gotKeys, revealedAt, jol, pred };
    if (a) snap.touch = { ...a, prev: reviewTouchOf(state, a.sid, a.chapter) };
    setPast((p) => [...p, snap]); // D-3 되돌리기용
    if (a) useApp.getState().mutate((st) => touchReview(st, a.sid, a.chapter, today));
    if (didIt) {
      if (cur) setGotKeys((ks) => (ks.includes(runItemKey(cur)) ? ks : [...ks, runItemKey(cur)]));
    } else {
      // D-1 — 못 한 카드는 버리지 않고 세션 안에서 한 번 더(3장 뒤). 조건은 requeue 가 판단한다.
      setQueue((q) => requeue(q, idx));
    }
    /* 예측을 남긴 카드만 대조 기록에 들어간다 — 안 물었거나 안 누른 카드는 조용히 빠진다.
       E6 — **어떤 카드였는지도 함께** 싣는다. 종전엔 카운트만 남아 완주 화면이 "과신 2개"라
       말하고 끝났고, 그 2개를 오답으로 남기려면 3화면·6클릭이라 아무도 안 했다. */
    if (pred !== null && cur) {
      const a = anchorOf(cur);
      const { subject } = cardSpeech(cur);
      setJol((rows) => [
        ...rows,
        { predicted: pred, recalled: didIt, label: subject, sid: a?.sid, chapter: a?.chapter },
      ]);
    }
    setPred(null);
    setIdx((i) => i + 1);
    /* N-7 — 이어하기 커서(복습). **5장마다**만 쓴다: 카드마다 쓰면 한 세션이 아웃박스에 12행을
       남기고, 그 12행이 말하는 것은 같은 한 가지("복습 중")다. 진행 표기는 다음 카드 기준. */
    if ((idx + 1) % 5 === 0 && idx + 1 < queue.length)
      writeResume({ kind: 'review', label: '복습 세션', progress: `${idx + 2}/${queue.length}` });
  };
  /** P-2 — 코드 1키 커밋. 문맥이 sid·과목명·챕터를 이미 알므로 **필드가 4→1** 이 된다. */
  const commitMiss = (code: CbmsCode) => {
    const t = miss;
    if (!t) return;
    let id = '';
    useApp.getState().mutate((st) => {
      id = addCbms(st, today, t.sid, t.name, t.chapter, code, '', false);
    });
    setMissId(id);
  };
  /** 커밋 **뒤에만** 부르는 메모 덧붙이기(정밀도만 올린다 — 없어도 기록은 이미 있다). */
  const saveMissNote = (note: string) => {
    const id = missId;
    if (id) useApp.getState().mutate((st) => editCbms(st, id, { note: note.trim() }));
    setMiss(null);
    setMissId(null);
  };
  const reveal = () => setRevealedAt(idx);
  /* D-3 되돌리기 — 오타 한 번(1 을 눌러야 할 때 2)이 세션 기록을 조용히 오염시키던 것을 닫는다.
     상태 전량을 스냅샷으로 되돌린다: 재큐가 큐를 바꿨을 수도, JOL 이 기록됐을 수도 있어
     `idx--` 만으로는 되돌아가지지 않는다(부분 복원이 곧 새 결함이다). */
  const undo = () => {
    const prev = past[past.length - 1];
    if (!prev) return;
    // E1 — 세션 state 보다 **앱 상태를 먼저** 되돌린다(앵커가 남으면 화면과 모델이 갈린다).
    if (prev.touch) {
      const t = prev.touch;
      useApp.getState().mutate((st) => restoreReviewTouch(st, t.sid, t.chapter, t.prev));
    }
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
  /** `1` — 전진은 즉시. 방금 넘긴 카드의 "왜 막혔나"가 다음 카드 위에 뜬다(안 고르면 순손실 0). */
  const skip = (it: RunItem) => {
    setMiss(missTarget(it));
    setMissId(null);
    advance(false);
  };
  /** 챕터 카드의 `2` — 25분 집중을 연다. 앵커는 **여기서 안 옮긴다**(세션 완주가 옮긴다 · FocusChip). */
  const startFocus = (it: Extract<RunItem, { kind: 'chapter' }>) => {
    /* ⚠ **진행 중 세션을 말없이 갈아치우지 않는다(E1).** `useFocus.start` 는 무조건 덮어쓰는데,
       챕터 카드의 유일한 긍정 동작이 집중 시작이라 러너를 훑으며 `2` 를 두 번 누르면 첫 세션이
       증발한다 — 그리고 그 세션이 **앵커의 유일한 생산자**였다(위 머리주석). 즉 "러너를 다 봤는데
       다음 날 그대로 온다"의 실제 메커니즘이 여기였다. */
    const s = useFocus.getState().session;
    if (s && s.kind !== 'break') {
      toast(`이미 "${s.name}" 집중 중이에요 — 끝내거나 중단한 뒤 시작하세요.`, 'warn');
      return;
    }
    useFocus.getState().start({
      ds: today,
      sid: it.ch.sid,
      type: 'rev',
      name: it.ch.subject,
      min: 25,
      blockMin: 25,
      chapter: it.ch.chapter, // 완료 시 챕터 터치 → 위험모델 lastDs 갱신(감사 #22)
    });
    advance(true);
  };
  const keys = buildKeys({
    cur,
    revealed,
    reveal,
    advance,
    skip,
    startFocus,
    // 오답 한 줄이 떠 있는데 아직 코드를 안 골랐을 때만 c/b/m/s/t 가 산다.
    askingMiss: !!miss && !missId,
    commitMiss,
    canUndo: past.length > 0,
    // ⚠ 되돌리기는 오답 줄을 **닫기만** 한다 — 이미 커밋된 기록은 안 지운다(위 P-2 주석).
    undo: () => {
      setMiss(null);
      setMissId(null);
      undo();
    },
    abort: () => nav('/today'),
  });

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
        <div className={`ds-well ${CENTER}`}>
          <div className="text-runner-mark leading-none" aria-hidden="true">
            ✓
          </div>
          <h2>복습할 게 없어요</h2>
          <p className="text-mut">밀린 챕터도, 다시 인출할 요약·착각도 없습니다. 오늘 새 학습에 집중하세요.</p>
          <div className={ACTS_CENTER}>
            <Button onClick={() => nav('/today')}>오늘 학습으로</Button>
          </div>
        </div>
      </div>
    );
  }

  const jolStat = jolSummary(jol);

  /* ── P-11 보류 선반의 입구 — **끝내 못 인출한 챕터**가 그 결정을 내릴 정확한 자리 ────────
     `건너뛰기` 는 아무것도 안 써서 이 챕터들이 **내일 완전히 동일하게 돌아온다.** 12장을 다
     밀어도 내일 큐는 여전히 12장이라, 사용자가 할 수 있는 유일한 행동이 매일 같은 것을 다시
     미는 의식이었다. 여기서 "당분간 안 볼게"라고 말할 수 있게 한다.
     ⚠ 세션 중 카드마다 묻지 않는다 — 인출 흐름을 끊고, 무엇보다 **그 순간엔 판단할 정보가
       없다**(몇 개를 못 했는지 모른다). 완주 화면이 그 전량을 아는 유일한 시점이다. */
  const missedChapters = queue
    .filter((i) => !i.again && i.kind === 'chapter' && !gotKeys.includes(runItemKey(i)))
    .map((i) => (i as Extract<RunItem, { kind: 'chapter' }>).ch)
    .filter((ch, i, arr) => arr.findIndex((x) => x.sid === ch.sid && x.chapter === ch.chapter) === i)
    .filter((ch) => !isHeld(state, ch.sid, ch.chapter));

  /* P-2 — 방금 넘긴 카드의 "왜 막혔나". 코드 하나로 커밋되고, 그 뒤 메모는 선택이다.
     ⚠ 카드 **위**의 한 줄이다(모달이 아니다) — 러너 흐름을 멈추지 않는 것이 이 위젯의 전부다.
     ⚠⚠ **완주 화면에도 그린다.** 마지막 카드를 못 떠올린 순간이 정확히 이 줄이 가장 필요한
       때인데, 그때 러너는 이미 리캡으로 넘어가 있다 — 카드 분기 안에만 두면 그 경우에만
       조용히 사라진다(되돌리기·중단 키를 카드 밖에도 둔 것과 같은 이유). */
  const missRow = miss ? (
    <div className={MISS_BAR} role="group" aria-label="못 떠올린 이유 분류">
      {missId ? (
        <MissNoteField target={`${miss.name}${miss.chapter ? ` · ${miss.chapter}` : ''}`} onSave={saveMissNote} />
      ) : (
        <>
          <span className="ds-tiny">
            왜 막혔나 — <strong>{miss.name}</strong>
            {miss.chapter ? ` · ${miss.chapter}` : ''}
          </span>
          {CBMS_CODES.map((code) => (
            <button
              key={code}
              type="button"
              className={MISS_BTN}
              onClick={() => commitMiss(code)}
              aria-label={`${CBMS_INFO[code].label}으로 남기기 (단축키 ${code})`}
            >
              <b className={KEYCAP}>{code}</b> {CBMS_INFO[code].label}
            </button>
          ))}
        </>
      )}
    </div>
  ) : null;

  // 완주 — 이 세션 리캡.
  if (finished) {
    return (
      <div className={WRAP}>
        <div className={`ds-well ${CENTER}`}>
          {/* 크기는 부모의 `--fs-runner-mark` 사다리를 그대로 탄다 — `.ic` 가 1em 이라 별도 수치가 필요 없다. */}
          <div className="text-runner-mark leading-none" aria-hidden="true">
            <Icon name="target" className="stroke-[1.4]" />
          </div>
          <h2>복습 세션 완료</h2>
          {/* D-1 — 분모는 **서로 다른 카드 수**다. 옛 문구는 큐 길이를 분모로 썼는데 재큐가 그
              길이를 늘리므로 "12개 중 14개"가 나올 수 있었다(같은 카드를 두 번 세는 형태). */}
          <p className="text-mut">
            카드 {cardCount}장 중 <strong>{gotCount}</strong>개를 인출했어요
            {againCount > 0 && <> · 놓친 {againCount}개는 세션 안에서 한 번 더 만났어요</>}. 남은 챕터는 볼트에서
            이어가세요.
          </p>
          {/* ID-11 — 예측이 얼마나 맞았나. **비율을 안 쓴다**(표본이 최대 3건이라 %는 정밀해 보이는
              소음이다) · 과신은 따로 짚는다: "될 줄 알았는데 안 됨"이 복습을 건너뛰게 하는 방향이다. */}
          {jolStat && (
            <p className="ds-tiny text-mut">
              떠오를지 미리 답한 {jolStat.n}개 중 <strong>{jolStat.hit}개</strong>를 맞혔어요
              {jolStat.over > 0 && <> · 될 줄 알았는데 안 된 게 {jolStat.over}개(과신)</>}
              {jolStat.under > 0 && <> · 애매하다 했는데 된 게 {jolStat.under}개</>}
            </p>
          )}
          {/* ── E6 과신 카드 · P-2 에서 **버튼이 사라졌다**(2026-08-01) ────────────────
              E6 은 여기 `오답으로 남기기 →` 를 뒀고 그게 러너에서 CBMS 표본이 생기는 **유일한**
              경로였다. 그런데 그 버튼은 `/journal` 로 이동한다 — 러너 문맥을 잃고 폼에서 필드
              넷을 다시 채우는 길이라, 이 파일이 스스로 적었듯 **아무도 안 눌렀다**(cbms 0행).
              지금은 `1`(못 떠올림) 직후 그 자리에서 1키로 커밋되므로(P-2) 이 버튼은
              *항상 도달 가능하고 엄격히 나은 대체*에 밀려 은퇴했다.
              ⚠ **문장은 남긴다** — 과신은 복습을 건너뛰게 하는 방향이라 완주 화면이 짚어야 하고,
                그 카드들은 세션 중에 이미 각자의 `1` 자리에서 오답으로 남길 기회를 지났다. */}
          {overconfidentCards(jol).map((r, i) => (
            <p key={`${r.label}-${i}`} className={RESUME_NOTE}>
              <span>
                <Icon name="alert" /> <strong>{r.label}</strong> — 될 줄 알았는데 안 됐어요
              </span>
            </p>
          ))}
          {/* P-11 — 못 인출한 챕터를 **큐에서 뺄 수 있게**. P-9(컷 리스트)와 같은 동사(`빼기`)·
              같은 되돌리기(`되돌리기`)·같은 시각 어휘(`ds-shed`)를 쓴다 — 사용자에게 두 개의
              다른 "버리기"가 생기면 안 된다는 것이 이 항목의 착수 조건이었다.
              ⚠ 자동 만료를 두지 않는다. 되돌릴 때까지 빠져 있고, 되돌릴 자리는 예보 탭 선반이다. */}
          {missedChapters.length > 0 && (
            <div className="mt-1 flex w-full max-w-runner flex-col gap-1.5 text-left">
              <p className="m-0! text-xs leading-body text-mut">
                못 떠올린 {missedChapters.length}개는 <b className="font-bold text-txt">내일 그대로 돌아와요</b>. 당분간
                안 볼 것은 지금 빼 두세요 — 삭제가 아니고 예보 탭에서 되돌릴 수 있어요.
              </p>
              <ul className="m-0! flex list-none flex-wrap gap-1.5 p-0!">
                {missedChapters.map((ch) => (
                  <li key={`${ch.sid}|${ch.chapter}`} className="m-0!">
                    <Button
                      sm
                      variant="ghost"
                      onClick={() =>
                        useApp.getState().mutate((st) => {
                          holdReview(st, ch.sid, ch.chapter, today);
                        })
                      }
                    >
                      {ch.subject} · {ch.chapter} 복습에서 빼기
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className={ACTS_CENTER}>
            <Button onClick={restart} variant="ghost">
              처음부터
            </Button>
            <Button onClick={() => nav('/today')}>오늘 학습으로</Button>
          </div>
        </div>
        {/* P-2 — 마지막 카드를 못 떠올린 채 여기 도착했으면 그 "왜 막혔나"가 여기서 이어진다. */}
        {missRow}
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
          className="block h-full rounded-full bg-acc transition-all duration-draw"
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

      {missRow}

      {item.kind === 'retrieval' && (
        <div className={`ds-well ${CARD_BASE} max-w-runner`} data-kind="retrieval">
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
            <p className="text-mut">머릿속으로 먼저 인출한 뒤, 아래로 내 원래 요약과 대조하세요.</p>
          )}
        </div>
      )}

      {item.kind === 'confident' && (
        <div className={`ds-well ${CARD_BASE} max-w-runner`} data-kind="confident">
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
            <p className="text-mut">먼저 스스로 답한 뒤, 당시 메모와 처방을 확인하세요.</p>
          )}
        </div>
      )}

      {item.kind === 'chapter' && (
        <div className={`ds-well ${CARD_BASE} max-w-runner`} data-kind="chapter" data-risk={item.ch.risk}>
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
          {/* ⚠ 문구는 **lib 이 소유한다**(H14) — 폰 러너와 같은 문장이어야 한다. 특히 볼트 유래
              앵커의 구분(W2)이 한쪽에만 있으면 `vaultAnchors.ts` 의 계약이 조용히 깨진다. */}
          <p className="text-mut">{chapterCopy(item.ch).body}</p>
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
