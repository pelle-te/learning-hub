/* ============================================================
   State — **성공하지 않은 화면의 단일 표면**(E17 · 2026-07-30).

   ## 왜 하나여야 하나

   실측(2026-07-29): 이 앱에서 "성공하지 않은 상태"는 넷인데(로딩·오프라인/미수집·에러·빈)
   **셋이 각자 다른 언어로** 그려지고 있었다.

   · 빈 상태  — `EmptyState` 15곳(일관)
   · 오프라인 — `ArtifactGate` 2곳
   · 에러     — `ArtifactError` 2곳 + `isError` 인라인 + `catch→toast`
   · **로딩   — 소속이 없었다**: `Skeleton` 컴포넌트 · `ds-spin`+텍스트 · **맨 텍스트 6곳**
     (`최신 소식을 불러오는 중…` 처럼 그냥 문장이 떠 있었다)

   판정(`lib/artifactState.ts` 의 `classifyArtifact`)은 **이미 SSOT 였다** — 4단계를 한 함수가
   정한다. 갈려 있던 것은 판정이 아니라 **표면**이고, 그래서 처방은 새 규칙이 아니라 그 4단계를
   받는 **그리는 곳 하나**다(레이어 규율: 판정=lib · 그리기=components).

   ## ⚠⚠ `next` 가 필수인 것이 이 파일의 절반이다 — 그리고 그 필수화엔 구멍이 있었다

   W5-1 이 `EmptyState.next` 를 필수 prop 으로 올렸다(막다른 빈 상태 9곳이 근거). 그런데
   타입이 `ReactNode` 였고 **`ReactNode` 는 `undefined` 를 포함한다** → `next={undefined}` 가
   타입 통과다. 즉 필수화가 "prop 을 *쓰라*"만 강제했고 "값을 *주라*"는 강제하지 못했다.
   그 구멍으로 실제로 하나가 새 있었다: `ArtifactGate` 의 오프라인 분기가 `onRetry` 없을 때
   `next={undefined}` 를 넘겨, **워크스페이스 미설정 화면이 다음 행동 없이** 렌더됐다 —
   W5-1 이 없애려던 바로 그 형태가 W5-1 의 컴포넌트 안에 남아 있었다.
   → `StateNext` 에서 `undefined`·`null` 을 **타입으로** 뺀다. 행동이 없으면 `{ terminal }` 로
     **왜 없는지를 쓰게** 강제한다(둘 중 하나는 반드시 화면에 남는다).

   ⚠ `kind='loading'` 만 `next` 를 요구하지 않는다. 로딩의 정답은 **기다리는 것**이고, 거기에
     CTA 를 요구하면 리포트가 경고한 "억지 CTA"를 타입이 생산하게 된다. 판별 유니온으로 갈랐다.
============================================================ */
import type { ReactElement, ReactNode } from 'react';

/**
 * 이 상태에서 **다음에 할 일**.
 *
 * ⚠ `ReactNode` 를 쓰지 않는 것이 요점이다 — 그 타입은 `undefined`·`null`·`false` 를 포함해서
 * "값을 안 줘도 통과"가 된다(위 머리주석의 구멍). 요소이거나, 아니면 **왜 없는지**다.
 */
export type StateNext = ReactElement | ReactElement[] | { terminal: string };

/** `{ terminal }` 형태인지 — 요소와 겹치지 않게 키로 판정한다. */
function isTerminal(n: StateNext): n is { terminal: string } {
  return typeof n === 'object' && n !== null && 'terminal' in n;
}

interface Common {
  glyph?: ReactNode;
  title: ReactNode;
  desc?: ReactNode;
}

/** 로딩만 `next` 가 없다(정답이 '기다리기'다) · 나머지는 필수. */
export type StateProps =
  (Common & { kind: 'loading'; next?: never }) | (Common & { kind?: 'empty' | 'error'; next: StateNext });

const WRAP = 'mx-auto flex max-w-empty flex-col items-center gap-2 px-6 py-11 text-center';
// 차분한 네온 글리프 — 1px inset 링은 `--line-acc`(= acc 30% + line) 토큰 그대로.
const GLYPH =
  'mb-1 flex size-16 items-center justify-center rounded-empty-glyph bg-acc-soft text-empty-glyph inset-ring inset-ring-line-acc';
const TITLE = 'text-empty-title font-extrabold tracking-empty-title text-ink';
const DESC = 'text-md leading-[1.65] text-mut';
const ACTIONS = 'mt-2.5 flex flex-wrap justify-center gap-2';
/** 종착 상태 안내 — 행동이 아니라 **이유**라 톤을 낮춘다(CTA 처럼 보이면 누를 것을 찾게 된다). */
const TERMINAL = 'mt-1.5 text-xs text-mut';

/**
 * 로딩 글리프 — 스피너는 **글리프 웰에 넣지 않는다.**
 *
 * ⚠ 실렌더가 잡았다(§15-4): 처음엔 이모지와 같은 자리(64px `bg-acc-soft` 웰)에 13px `ds-spin` 을
 * 넣었는데, 화면 가운데에 **빈 상자 하나**로 읽혔다(모션 자제로 회전이 멈추면 더). 웰은 *이모지*를
 * 담기 위한 장식이고 스피너는 그 자체가 어포던스다 — 담을 이유가 없다. 대신 웰과 비슷한 시각
 * 무게를 갖도록 `ds-spin-lg`(30px)로 키운다.
 */
const SPIN = (
  <div className="mb-1 flex size-16 items-center justify-center">
    <span className="ds-spin ds-spin-lg" />
  </div>
);

export default function State(props: StateProps) {
  const { kind = 'empty', title, desc } = props;
  /* 글리프 기본값을 kind 가 정한다 — 호출부마다 이모지를 고르게 하면 그게 곧 다음 드리프트다.
     에러=경고. 빈 상태만 feature 의 성격이라 호출부가 준다(글리프가 곧 그 화면의 정체성인 경우가
     있다 — `items` 의 📚 등). 로딩은 위 `SPIN` 이 웰 없이 직접 그린다. */
  const glyph = props.glyph ?? (kind === 'error' ? '⚠️' : undefined);
  return (
    <div
      className={WRAP}
      /* ⚠⚠ **에러도 공지한다(H7 · 2026-07-30 `/감사 근본`).** 종전엔 `role`/`aria-live` 를
         `loading` 에만 걸었다 → 산출물 읽기가 실패하면 스크린리더 사용자는 "불러오는 중"을 들은
         뒤 **아무 공지도 받지 못했다**. 게다가 같은 노드가 `role=status` → 롤 없음으로 바뀌며
         텍스트가 교체되므로 라이브 공지도 불발한다(리전이 사라지면 변경이 관측되지 않는다).
         E17 이 성공하지 않은 화면 **전부**를 이 컴포넌트로 모았으므로 파급이 앱 전역이고,
         같은 이유로 **수정 지점도 한 곳**이다 — 그게 E17 이 사 온 값이다.
         `alert` 인 이유: 실패는 사용자가 하려던 일이 안 됐다는 뜻이라 즉시 알려야 한다.
         빈 상태(`empty`)는 롤이 없다 — 정상 상태이고, 매번 공지하면 그 자체가 소음이다. */
      role={kind === 'loading' ? 'status' : kind === 'error' ? 'alert' : undefined}
      aria-live={kind === 'loading' ? 'polite' : undefined}
    >
      {kind === 'loading' ? SPIN : glyph != null && <div className={GLYPH}>{glyph}</div>}
      <div className={TITLE}>{title}</div>
      {desc != null && <div className={DESC}>{desc}</div>}
      {props.kind === 'loading' ? null : isTerminal(props.next) ? (
        <div className={TERMINAL}>{props.next.terminal}</div>
      ) : (
        <div className={ACTIONS}>{props.next}</div>
      )}
    </div>
  );
}
