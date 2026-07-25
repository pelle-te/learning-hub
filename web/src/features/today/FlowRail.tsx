/* ============================================================
   FlowRail — 오늘의 흐름 레일(시간순 학습·일과 노드 리스트).

   TodaySignature 에서 **책임 이전**으로 떼어냈다(재설계 · 이 상호작용이 부모 인지복잡도 77 의 주
   동인이었다). 선택 상태(selKey)·키보드 네비(j/k/Enter/s)·노드 DOM refs 를 **이 컴포넌트가 소유**한다.
   부모는 데이터(nodes·nowMin·riskN)와 **불투명 콜백**(onToggle·onFocus·onPrefill·onReview)만 넘긴다 —
   `e` 를 제네릭으로 두어 FlowRail 이 `enriched` 형태·store·ds 에 전혀 결합되지 않는다(25-prop 컴포넌트로
   쪼개는 것과 정반대: 응집을 부수지 않고 상태기계만 옮긴다). 빈 상태는 부모가 렌더한다(공유 클래스 결합 회피).

   C-7 이식: 노드 전용 Tailwind 클래스 SSOT 는 여기(`N`) — 원래 today 의 `S` 맵에 있던 것을 이 파일로 옮겼다.
============================================================ */
import { useEffect, useRef, useState } from 'react';
import { useKeymapDoc } from '@/hooks/useKeymap';
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
    'pointer-events-none absolute bottom-0 left-0 z-[2] h-0.5 rounded-full bg-acc shadow-dot transition-[width] duration-1000 ease-linear motion-reduce:transition-none',
  nDotBase: 'relative z-[1] size-2.5 flex-none rounded-full',
  nDotStudy: 'bg-acc shadow-[var(--shadow-node-live)]',
  nDotBlock: 'bg-mut shadow-[var(--shadow-node-panel)]',
  nDotLive:
    'bg-acc scale-130 shadow-[var(--shadow-node-live)] animate-[today-dot-ping_1.5s_var(--ease)_infinite] motion-reduce:animate-none',
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
}

export function FlowRail<TE>({ nodes, nowMin, riskN, onToggle, onFocus, onPrefill, onReview }: FlowRailProps<TE>) {
  // I-4 — 흐름 레일 키보드 흐름: j/k 노드 이동(활성 하이라이트+스크롤) · Enter 집중 시작 · s 기록 프리필.
  const [selKey, setSelKey] = useState<string | null>(null);
  const nodeRefs = useRef(new Map<string, HTMLElement>());

  // 핸들러가 읽는 최신 값 — 리스너를 재등록하지 않고도 최신 상태/콜백을 보게 하는 통로.
  // (nodes 는 매 렌더 새 배열이라 deps 에 넣으면 window keydown 이 매 렌더 제거→재등록된다.)
  /* N-16 — 이 화면의 키를 **치트시트에 등재**한다. 등록은 아래 핸들러가 그대로 하고(Enter 의
     타깃 가드가 `useKeymap` 의 keys→run 모델로 표현되지 않는다) 설명만 레지스트리로 올린다.
     이 넷은 이 항목 전까지 **어디에도 문서화돼 있지 않았다** — 있는데 아무도 모르는 키였다. */
  useKeymapDoc('이 화면 · 오늘 흐름', [
    { display: 'J / K', label: '다음 / 이전 블록 선택' },
    { display: 'Enter', label: '선택한 블록으로 집중 시작' },
    { display: 'S', label: '선택한 블록을 요약에 채우기' },
  ]);

  const keyCtx = useRef({ nodes, selKey, onFocus, onPrefill });
  useEffect(() => {
    keyCtx.current = { nodes, selKey, onFocus, onPrefill };
  });

  useEffect(() => {
    const reveal = (key: string): void => {
      const el = nodeRefs.current.get(key);
      const rm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el?.scrollIntoView({ block: 'nearest', behavior: rm ? 'auto' : 'smooth' });
    };
    const onKey = (e: KeyboardEvent): void => {
      const { nodes, selKey, onFocus, onPrefill } = keyCtx.current;
      if (!nodes.length) return;
      const keys = nodes.map((n) => n.key);
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const idx = selKey ? keys.indexOf(selKey) : -1;
      if (e.key === 'j') {
        e.preventDefault();
        const next = keys[Math.min(keys.length - 1, idx + 1)] ?? keys[0]!;
        setSelKey(next);
        reveal(next);
      } else if (e.key === 'k') {
        e.preventDefault();
        const prev = idx <= 0 ? keys[0]! : keys[idx - 1]!;
        setSelKey(prev);
        reveal(prev);
      } else if (e.key === 'Enter') {
        // ⚠ 노드 버튼에 DOM 포커스가 있으면(Tab 이동) Enter 는 **네이티브 활성**(=완료 토글)에 맡긴다.
        //    여기서 가로채면 사용자가 기대한 토글 대신 집중 세션이 시작된다. j/k 선택(selKey)은 DOM
        //    포커스를 옮기지 않으므로, 그때의 Enter 는 아래로 내려가 집중 세션을 연다(둘이 안 겹친다).
        if (t?.tagName === 'BUTTON') return;
        const nd = nodes.find((n) => n.key === selKey);
        if (nd?.e) {
          e.preventDefault();
          onFocus(nd.e);
        }
      } else if (e.key === 's' || e.key === 'S') {
        const nd = nodes.find((n) => n.key === selKey);
        if (nd?.e) {
          e.preventDefault();
          onPrefill(nd.e);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // deps 빈 배열이 정직하다 — 핸들러가 참조하는 값은 전부 keyCtx.current 에서 읽는다(마운트당 1회 등록).
  }, []);

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
            <span className={`${N.nTime} ${nd.e ? 'leading-[normal]' : 'leading-[1.6]'}`}>{toHM(nd.start)}</span>
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
      {/* 종결 캡 고스트 — 마지막 노드 뒤 "이후 일정 없음": 스파인이 끝났다고 읽히게(비인터랙티브). */}
      <div className={`${N.node} py-1.75! opacity-55`}>
        <span className={`${N.nTime} leading-[1.6]`}>—</span>
        <span className={N.nDotGhost} />
        <span className={N.nBody}>
          <span className={N.nSub}>이후 일정 없음</span>
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
