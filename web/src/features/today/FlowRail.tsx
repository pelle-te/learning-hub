/* ============================================================
   FlowRail — 오늘의 흐름 레일(시간순 학습·일과 노드 리스트).

   TodaySignature 에서 **책임 이전**으로 떼어냈다(재설계 · 이 상호작용이 부모 인지복잡도 77 의 주
   동인이었다). 키보드 네비(j/k + 동사키)·노드 DOM refs 를 **이 컴포넌트가 소유**한다.

   ## 커서는 하나다 — 선택 = DOM 포커스(E5 · 2026-07-29)

   종전엔 커서가 **두 벌**이었다: `j/k` 가 옮기는 그림자 선택(`selKey`)과 Tab 이 옮기는 DOM
   포커스. 그래서 이 앱에서 **가장 잦은 쓰기인 완료 토글에 키가 없었고**, `Enter` 는 어느
   커서 위에 있느냐에 따라 뜻이 갈렸다(포커스면 토글 · 선택이면 집중 시작). 아래 `Enter`
   가드가 그 충돌을 봉합하던 자리다. 키보드로 완료하려면 히어로 CTA·프리셋·resume 칩을
   지나 **Tab 을 여러 번** 눌러야 했다.

   지금은 **roving tabindex** 다: 레일 전체가 탭 스톱 하나이고 `j/k` 는 `focus()` 를 옮긴다.
   커서가 하나가 되면서 뜻이 겹치던 자리가 사라지고, 그 위에 동사키를 편다 —
   `x` 완료 · `f` 집중 시작 · `s` 기록. `Enter`/`Space` 는 버튼의 **네이티브 활성**(=완료)이라
   따로 가로채지 않는다(가로채는 순간 다시 두 뜻이 된다).

   ⚠ **포인터 경로는 그대로다** — 노드는 여전히 버튼이고 탭=완료다. 키보드 경로를 추가하되
   포인터를 없애면 터치·스위치 접근에서 이 화면이 통째로 잠긴다.
   ⚠ `15분 미루기`(`.`)는 **여기 없다** — 그건 계획을 쓰는 새 도메인 연산이라 이 상호작용
   변경과 사정거리가 다르다(별건).
   부모는 데이터(nodes·nowMin·riskN)와 **불투명 콜백**(onToggle·onFocus·onPrefill·onReview)만 넘긴다 —
   `e` 를 제네릭으로 두어 FlowRail 이 `enriched` 형태·store·ds 에 전혀 결합되지 않는다(25-prop 컴포넌트로
   쪼개는 것과 정반대: 응집을 부수지 않고 상태기계만 옮긴다). 빈 상태는 부모가 렌더한다(공유 클래스 결합 회피).

   C-7 이식: 노드 전용 Tailwind 클래스 SSOT 는 여기(`N`) — 원래 today 의 `S` 맵에 있던 것을 이 파일로 옮겼다.
============================================================ */
import { useListCursor } from '@/hooks/useListCursor';
import { toHM, hLabel } from '@/lib/utils';
import { commit } from '@/lib/motion';

/** 흐름 노드 하나. `e` 는 부모가 콜백에서 다시 받는 **불투명 페이로드**(학습 노드면 값, 일과 블록이면 null). */
export interface FlowNode<TE> {
  key: string;
  kind: 'study' | 'block';
  start: number;
  end: number | null;
  name: string;
  sub: string;
  color?: string;
  done: boolean;
  e: TE | null;
}

const N = {
  node: "relative flex w-full items-center gap-3 border-0! bg-transparent! pr-2! pl-0! text-left text-base14! before:pointer-events-none before:absolute before:top-0 before:bottom-0 before:left-node-spine before:w-0.5 before:-translate-x-px before:bg-line2 before:content-[''] first:before:top-1/2 last:before:bottom-1/2",
  nTime: 'w-10.5 flex-none text-sm font-bold text-mut tabular-nums',
  nBody: 'flex min-w-0 flex-1 flex-col gap-px',
  nSub: 'truncate text-note-info text-mut',
  nNow: 'flex-none text-2xs font-extrabold tracking-mode text-acc [text-shadow:var(--navlink-glow)]',
  nNowSmall: 'text-tiny9 font-extrabold opacity-85',
  nProg:
    'pointer-events-none absolute bottom-0 left-0 z-[2] h-0.5 rounded-full bg-acc shadow-dot transition-[width] duration-draw ease-[var(--ease-draw)] motion-reduce:transition-none',
  nDotBase: 'relative z-[1] size-2.5 flex-none rounded-full',
  nDotStudy: 'bg-acc shadow-[var(--shadow-node-live)]',
  nDotBlock: 'bg-mut shadow-[var(--shadow-node-panel)]',
  nDotLive:
    'bg-acc scale-130 shadow-[var(--shadow-node-live)] pulse-now animate-[live-pulse_var(--tempo)_var(--ease)_infinite] motion-reduce:animate-none',
  nDotGhost:
    'relative z-[1] size-2 flex-none rounded-full border-2 border-line2 bg-transparent shadow-[var(--shadow-node-panel)]',
} as const;

export interface FlowRailProps<TE> {
  nodes: FlowNode<TE>[];
  nowMin: number;
  /** 학습 노드 클릭·완료 토글. */
  onToggle: (e: TE) => void;
  /** Enter — 현재 노드 집중 세션 시작. */
  onFocus: (e: TE) => void;
  /** s — 현재 노드 기록 프리필(부모가 store·toast 를 소유하므로 불투명 콜백). */
  onPrefill: (e: TE) => void;
}

export function FlowRail<TE>({ nodes, nowMin, onToggle, onFocus, onPrefill }: FlowRailProps<TE>) {
  /* 커서 = **실제 DOM 포커스**(E5). 상태기계는 **`useListCursor` 가 소유한다**(W13 · 2026-07-31) —
     이 화면이 검증한 패턴인데 23화면 중 2곳에만 있었고, 나머지는 Tab 순회였다(트레이 3번째 행의
     ⤵ 까지 실측 14회). 어휘도 그 훅이 7개로 닫는다: `x·e·d·p·f·v·u`.
     ⚠ `s`(요약 채우기)가 그 어휘에 없어 **`p`(배치)로 옮겼다** — 어휘를 열어 두면 화면마다
     자기 키가 생기고, 그게 정확히 이 항목이 없애려는 것이다. */
  const cursor = useListCursor<FlowNode<TE>>({
    items: nodes.map((n) => ({ key: n.key, item: n })),
    docTitle: '이 화면 · 오늘 흐름',
    verbs: {
      x: (n) => n.e && onToggle(n.e),
      f: (n) => n.e && onFocus(n.e),
      p: (n) => n.e && onPrefill(n.e),
    },
  });
  const selKey = cursor.cursor;
  const tabStop = cursor.tabStop;

  return (
    <>
      {nodes.map((nd) => {
        const live = nd.start <= nowMin && (nd.end == null || nowMin < nd.end);
        const past = nd.done || (nd.end != null && nowMin >= nd.end);
        const sel = selKey === nd.key;
        const block = nd.kind === 'block';
        const dur = nd.end != null ? ` · ${hLabel(nd.end - nd.start)}` : '';
        // 현재 블록 실시간 진행률(경과/길이) — 1초 틱으로 갱신.
        const prog =
          live && nd.end != null && nd.end > nd.start
            ? Math.min(100, Math.max(0, Math.round(((nowMin - nd.start) / (nd.end - nd.start)) * 100)))
            : 0;
        // 상태 정적 클래스맵(§15 · 동적 조립 금지). 선택이 라이브보다 우선(원본 소스 순서).
        const stateBg = sel
          ? 'rounded-md bg-[var(--tint-ink-5)] shadow-[var(--shadow-inset-line2)]'
          : live
            ? 'rounded-md bg-[var(--tint-acc-9)]'
            : '';
        const cls = `${N.node} py-2.75! ${nd.e ? 'group/node cursor-pointer hover:rounded-md focus-visible:rounded-md! focus-visible:[outline-offset:var(--node-outline-offset)]!' : 'cursor-default'} ${past ? 'opacity-40' : ''} ${stateBg}`;
        // nName 색/굵기: 블록=뮤트·600, 라이브·선택=acc, study hover=acc(group/node), 완료=취소선.
        const nNameCls = `truncate ${block ? 'font-semibold text-mut' : 'font-bold'} ${live || sel ? 'text-acc' : ''} ${nd.done ? 'ds-shed' : ''} ${nd.e ? 'group-hover/node:text-acc' : ''}`;
        const nDotCls = `${N.nDotBase} ${live ? N.nDotLive : block ? N.nDotBlock : N.nDotStudy}`;
        const setNodeRef = cursor.register(nd.key);
        const inner = (
          <>
            {live && <span className={N.nProg} style={{ width: `${prog}%` }} aria-hidden="true" />}
            {/* nTime 내장 text-sm 은 companion LH 를 흘리므로 명시 — 폼컨트롤(study 버튼) 자손=normal · div=1.6. */}
            <span className={`${N.nTime} ${nd.e ? 'leading-auto' : 'leading-text'}`}>{toHM(nd.start)}</span>
            <span className={nDotCls} style={nd.kind === 'study' && nd.color ? { background: nd.color } : undefined} />
            <span className={N.nBody}>
              <span className={nNameCls}>{nd.name}</span>
              <span className={N.nSub}>
                {nd.sub}
                {dur}
              </span>
            </span>
            {live && (
              <span className={N.nNow}>
                지금 <small className={N.nNowSmall}>{prog}%</small>
              </span>
            )}
          </>
        );
        return nd.e ? (
          <button
            key={nd.key}
            ref={setNodeRef}
            type="button"
            className={cls}
            /* D-7 commit — 완료 토글은 이 앱에서 가장 잦은 쓰기인데 **아무 반응이 없었다**
               (체크 표시가 바뀌는 것이 전부). 눌린 노드 자리에서 1회 착지시킨다. */
            onClick={(ev) => {
              onToggle(nd.e!);
              commit(ev.currentTarget);
            }}
            /* E5 — 포커스가 곧 커서다. 마우스·Tab 으로 들어와도 `j/k` 가 그 자리에서 이어진다
               (거울을 안 맞추면 Tab 으로 옮긴 뒤 `j` 가 엉뚱한 데서 다시 시작한다). */
            onFocus={() => cursor.onItemFocus(nd.key)}
            tabIndex={tabStop === nd.key ? 0 : -1}
            aria-label={`${nd.name} 완료 토글`}
            aria-pressed={nd.done}
            aria-current={sel ? true : undefined}
          >
            {inner}
          </button>
        ) : (
          <div key={nd.key} ref={setNodeRef} className={cls} aria-current={sel ? true : undefined}>
            {inner}
          </div>
        );
      })}
      {/* 종결 캡 — 스파인이 끝났다고 읽히게(비인터랙티브).
          ⚠ W6(2026-07-31) — 여기 `오늘 밖 N개 · Mh` 를 함께 그렸었다(11px · `opacity-55`).
          같은 판정이 리드아웃·링 분모와 합쳐 **세 자리**로 쪼개져 있었고 어느 자리도 "오늘 안에
          들어가는가"라는 문장을 말하지 않았다 → 히어로 아이브로 아래 한 줄이 그 판정을 통째로
          가져갔다. 여기 남은 것은 스파인의 끝 표시뿐이다(한 양 = 한 자리). */}
      <div className={`${N.node} py-1.75! opacity-55`}>
        <span className={`${N.nTime} leading-text`}>—</span>
        <span className={N.nDotGhost} />
        <span className={N.nBody}>
          <span className={N.nSub}>이후 일정 없음</span>
        </span>
      </div>
      {/* ⚠ 밀린 복습 칩이 여기 있었다 — **W18 에서 레일 스크롤 밖의 '오늘 밖' 구역으로 옮겼다.**
          같은 성격의 신호가 이 칩(레일 안)과 화면 최하단 스트립 둘로 갈려 있었고, 이건 스크롤
          안이라 블록이 많은 날엔 아예 안 보였다(그 자체가 옮길 이유였다). */}
    </>
  );
}
