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
import { useEffect, useRef, useState } from 'react';
import { useKeymapDoc } from '@/hooks/useKeymap';
import { toHM, hLabel } from '@/lib/utils';
import { commit, reveal } from '@/lib/motion';

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
    'pointer-events-none absolute bottom-0 left-0 z-[2] h-0.5 rounded-full bg-acc shadow-dot transition-[width] duration-draw ease-linear motion-reduce:transition-none',
  nDotBase: 'relative z-[1] size-2.5 flex-none rounded-full',
  nDotStudy: 'bg-acc shadow-[var(--shadow-node-live)]',
  nDotBlock: 'bg-mut shadow-[var(--shadow-node-panel)]',
  nDotLive:
    'bg-acc scale-130 shadow-[var(--shadow-node-live)] pulse-now animate-[live-pulse_var(--tempo)_var(--ease)_infinite] motion-reduce:animate-none',
  nDotGhost:
    'relative z-[1] size-2 flex-none rounded-full border-2 border-line2 bg-transparent shadow-[var(--shadow-node-panel)]',
  reviewCta:
    'mt-1.5 mb-0.5 inline-flex items-center gap-2 rounded-md! border-0! bg-[var(--tint-warn-faint)]! px-3! py-2! text-hint! font-bold! shadow-[var(--shadow-inset-line2)] hover:shadow-[var(--shadow-inset-acc-glow)]',
  reviewDot: 'size-1.75 flex-none rounded-full bg-warn',
} as const;

export interface FlowRailProps<TE> {
  nodes: FlowNode<TE>[];
  nowMin: number;
  /** 밀린 복습 수 — >0 이면 종결 캡 뒤에 복습 딥링크 칩. */
  riskN: number;
  /** 학습 노드 클릭·완료 토글. */
  onToggle: (e: TE) => void;
  /** Enter — 현재 노드 집중 세션 시작. */
  onFocus: (e: TE) => void;
  /** s — 현재 노드 기록 프리필(부모가 store·toast 를 소유하므로 불투명 콜백). */
  onPrefill: (e: TE) => void;
  /** 복습 딥링크 칩 클릭. */
  onReview: () => void;
  /** E9 — 남은 창을 넘어 **오늘 밖**인 블록 요약. 없으면 null. */
  beyond?: { count: number; min: number } | null;
}

export function FlowRail<TE>({
  nodes,
  nowMin,
  riskN,
  onToggle,
  onFocus,
  onPrefill,
  onReview,
  beyond = null,
}: FlowRailProps<TE>) {
  /* 커서 = **실제 DOM 포커스**(E5). `selKey` 는 그 포커스를 따라가는 거울이라 두 벌이 아니다 —
     roving tabindex 의 "지금 탭 스톱인 노드"를 정하는 데 쓴다. */
  const [selKey, setSelKey] = useState<string | null>(null);
  const nodeRefs = useRef(new Map<string, HTMLElement>());

  // 핸들러가 읽는 최신 값 — 리스너를 재등록하지 않고도 최신 상태/콜백을 보게 하는 통로.
  // (nodes 는 매 렌더 새 배열이라 deps 에 넣으면 window keydown 이 매 렌더 제거→재등록된다.)
  /* N-16 — 이 화면의 키를 **치트시트에 등재**한다. 등록은 아래 핸들러가 그대로 하고(Enter 의
     타깃 가드가 `useKeymap` 의 keys→run 모델로 표현되지 않는다) 설명만 레지스트리로 올린다.
     이 넷은 이 항목 전까지 **어디에도 문서화돼 있지 않았다** — 있는데 아무도 모르는 키였다. */
  useKeymapDoc('이 화면 · 오늘 흐름', [
    { display: 'J / K', label: '다음 / 이전 블록' },
    { display: 'X', label: '완료 토글' },
    { display: 'F', label: '집중 시작' },
    { display: 'S', label: '요약에 채우기' },
  ]);

  const keyCtx = useRef({ nodes, selKey, onFocus, onPrefill, onToggle });
  useEffect(() => {
    keyCtx.current = { nodes, selKey, onFocus, onPrefill, onToggle };
  });

  useEffect(() => {
    /* 커서를 옮긴다 = **포커스를 옮긴다**(E5). 스크롤 판정(모션 자제)은 `lib/motion` 이 소유하고
       (H16) 여기선 대상만 고른다. 포커스가 곧 커서라 `setSelKey` 는 `onFocus` 가 대신 해도
       되지만, 노드가 없는 경우(일과 블록=div)를 위해 여기서도 세운다. */
    const move = (key: string): void => {
      setSelKey(key);
      const el = nodeRefs.current.get(key);
      reveal(el, 'nearest');
      el?.focus({ preventScroll: true });
    };
    const onKey = (e: KeyboardEvent): void => {
      const { nodes, selKey, onFocus, onPrefill, onToggle } = keyCtx.current;
      if (!nodes.length) return;
      const keys = nodes.map((n) => n.key);
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const idx = selKey ? keys.indexOf(selKey) : -1;
      if (e.key === 'j') {
        e.preventDefault();
        move(keys[Math.min(keys.length - 1, idx + 1)] ?? keys[0]!);
        return;
      }
      if (e.key === 'k') {
        e.preventDefault();
        move(idx <= 0 ? keys[0]! : keys[idx - 1]!);
        return;
      }
      /* 동사키 — 전부 **같은 커서**(포커스한 노드)에 대해 돈다.
         ⚠ `Enter`/`Space` 는 안 다룬다: 포커스한 노드는 버튼이라 네이티브 활성이 곧 완료다.
            가로채면 한 키가 다시 두 뜻을 갖게 되고, 그게 E5 이전의 결함이었다. */
      const verb =
        e.key === 'x' || e.key === 'X'
          ? onToggle
          : e.key === 'f' || e.key === 'F'
            ? onFocus
            : e.key === 's' || e.key === 'S'
              ? onPrefill
              : null;
      if (!verb) return;
      const nd = nodes.find((n) => n.key === selKey);
      if (!nd?.e) return; // 일과 블록엔 동사가 없다(페이로드가 null)
      e.preventDefault();
      verb(nd.e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // deps 빈 배열이 정직하다 — 핸들러가 참조하는 값은 전부 keyCtx.current 에서 읽는다(마운트당 1회 등록).
  }, []);

  /* roving tabindex — 레일 전체가 탭 스톱 **하나**다. 커서가 없으면 첫 노드가 그 자리를 맡아
     Tab 으로 들어온 사람도 즉시 `j/k` 를 쓸 수 있다(들어올 문이 없으면 키 계약이 죽는다). */
  const tabStop = selKey ?? nodes[0]?.key ?? null;

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
        const nNameCls = `truncate ${block ? 'font-semibold text-mut' : 'font-bold'} ${live || sel ? 'text-acc' : ''} ${nd.done ? 'line-through' : ''} ${nd.e ? 'group-hover/node:text-acc' : ''}`;
        const nDotCls = `${N.nDotBase} ${live ? N.nDotLive : block ? N.nDotBlock : N.nDotStudy}`;
        const setNodeRef = (el: HTMLElement | null): void => {
          const m = nodeRefs.current;
          if (el) m.set(nd.key, el);
          else m.delete(nd.key);
        };
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
            onFocus={() => setSelKey(nd.key)}
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
          E9: 남은 창을 넘는 블록이 있으면 "이후 일정 없음"은 **거짓말**이다. 그때는 그것들이
          오늘 밖이라는 사실을 한 줄로 말한다 — 접힌 줄 자체가 "이건 못 한 게 아니라 애초에
          오늘 것이 아니었다"는 판단이고, 저녁마다 오던 실패감의 출처를 없앤다. */}
      <div className={`${N.node} py-1.75! opacity-55`}>
        <span className={`${N.nTime} leading-text`}>—</span>
        <span className={N.nDotGhost} />
        <span className={N.nBody}>
          <span className={N.nSub}>
            {beyond ? `오늘 밖 ${beyond.count}개 · ${hLabel(beyond.min)}` : '이후 일정 없음'}
          </span>
        </span>
      </div>
      {/* I-2 — 밀린 복습이 있으면 종결 캡 뒤에 은은한 딥링크 칩(스케줄 쓰기 아님 → 복습 실행으로). */}
      {riskN > 0 && (
        <button
          type="button"
          className={N.reviewCta}
          onClick={onReview}
          aria-label={`밀린 복습 ${riskN}개 — 복습 세션으로 이동`}
        >
          <span className={N.reviewDot} aria-hidden="true" />
          복습 {riskN}개 밀림 <b className="ml-0.5 font-extrabold text-acc">복습 세션 →</b>
        </button>
      )}
    </>
  );
}
