/* ============================================================
   Graph — 탭: 🕸 학습 구조도. 로컬 학습 항목만으로 그려지는 힘-방향(force-directed) 허브-앤-스포크.
   ⚠ 옛 라벨은 '지식맵'이었는데 `mastery` 의 히트맵 패널 제목도 '발광 지식맵'이라 **같은 세그먼트
   바에 같은 이름이 둘**이었다(E10 · 2026-07-29). 둘은 다른 질문에 답한다 — 여기는 항목→챕터
   *구조*(항상 가용), 저기는 개념 단위 *숙달 분포*(볼트 산출). 이름이 그 차이를 말한다.
   항목=허브, 챕터=잎, 허브→챕터=링크. "내가 무엇을 얼마나 익혔나"의 살아있는 지도.
   서버 페치 없음(항상 가용) — graphData.buildGraph(순수)로 노드/링크를 만들고,
   자체 스프링-반발 시뮬레이션(velocity-Verlet 근사)을 <canvas>에서 돈다(외부 라이브러리 없음).

   안전장치(AmbientCanvas·TodaySignature와 동형):
   • devicePixelRatio 스케일 + ResizeObserver로 선명·반응형, getContext 실패시 무동작(throw X).
   • 정착하면 RAF 정지(운동에너지≈0=idle) → 배터리 절약. 드래그/테마변경 시 재가열.
   • prefers-reduced-motion → 애니메이션 생략, 레이아웃을 동기로 N회 반복 후 한 번만 그림.
   • document.hidden → RAF 일시정지. 언마운트 시 RAF·옵서버·리스너 전부 정리(누수 0).
   • 캔버스는 스크린리더에 불투명 → role=img + aria-label 요약 + .srOnly <ul>(항목 done/total) 병행.

   ── C-7 열 번째 이식(graph) — Tailwind ──────────────────────────────────────
   캔버스 크롬(호스트 프레임·범례·컨트롤·툴팁·상세 패널·빈 상태)만 옮긴다 — 캔버스 픽셀은 JS 가 그린다.
   지식맵/폴백 그래디언트(--bg-map-mastery)·상단 헤어라인(--bg-sig-top)·마운트 페이드업(enter-rise)·
   shadow-card/hero 를 mastery/ledger 이식에서 승계한다. 새로 이름 준 것: 부유 크롬 글래스 배경
   (--panel-glass-82/88/94/96)·backdrop 블러(--backdrop-graph)·검색실패 테두리(--line-warn-mid)·
   상세 패널 폭·off-ladder 반경(6/8px)·자간(0.14em)·허브 스와치 발광(--shadow-hub).
   ⚠ preflight 미포함 → 폼 컨트롤(<input>/<button>)은 UA line-height:normal 이라 body 1.6 을 상속
   하지 않는다: 폼 컨트롤엔 leading-auto, 정상흐름엔 leading-text(또는 소스 명시 1.25/1.7).
   ⚠ 전역 요소 규칙(input{}/button{})은 unlayered 라 Tailwind 를 이긴다 → 다른 속성만 ! 로 되찾는다.
   전역 :hover(:not(:disabled)) 특이도에 눌린 로컬 hover 는 되살리지 않는다(전역이 이긴 렌더 보존).
============================================================ */
import { weakKey } from '@/lib/domainKeys';
import { prefersReducedMotion } from '@/lib/motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useKeymapDoc } from '@/hooks/useKeymap';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/useApp';
import { useSchedule } from '@/store/selectors';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { chapterReviews, type ChapterReview } from '@/lib/spacedReview';
import { todayISO, openVaultSearch } from '@/lib/utils';
import State from '@/components/State';
import { Button } from '@/components/ui';
import { buildGraph, type GraphNode } from './graphData';
import { createGraphSim, type FocusResult } from './graphSim';
import { drawGraph, type Palette } from './graphDraw';
import { semanticChapterEdges, semanticAvailable, type SemEdge } from '@/lib/semantic';

// 캔버스 호스트/폴백 상단 1px 발광 헤어라인(--bg-sig-top · review→ledger 이식이 깐 것 재사용).
// 범례 스와치(9px 원) 공통 · 칩(span). 의미연결(lSem)은 점선 선분이라 따로 준다.
const SWATCH = 'inline-block size-2.25 rounded-full';
const LEG_SPAN = 'inline-flex items-center gap-1.25 whitespace-nowrap';
// 검색 토스트(없음/위치) — 우상단 오버레이 공통(값만 색이 다름 · 정상흐름 div → leading-text).
const TOAST =
  'absolute top-11.5 right-3.5 z-[3] rounded-md border bg-panel-glass-88 px-2.5 py-1.25 text-xs leading-text [backdrop-filter:var(--backdrop-graph)]';
// 검색 입력 — type=search 는 전역 input[type=text]{} 밖(글래스 배경 직접). 전역 input{font-size:13}
// 만 겹쳐 text-sm! · 키보드 포커스링(acc55)은 로컬이 이겼던 것이라 focus-visible:…! 로 되찾는다.
const SEARCH =
  'h-7 w-37.5 rounded-md border border-line bg-panel-glass-88 px-2.25 text-sm! leading-auto text-txt [backdrop-filter:var(--backdrop-graph)] [transition:border-color_0.16s_var(--ease)] focus-visible:border-line-acc-focus!';
// 줌/찾기 버튼 — 전역 button{} 과 다른 속성만 !(배경·색·반경). border/padding/cursor 는 전역과 동일해 생략.
const CTRL_BTN =
  'grid size-7 place-items-center rounded-md! bg-panel-glass-88! text-base! leading-auto text-mut! [backdrop-filter:var(--backdrop-graph)]';
// 툴팁 — 항상 마운트, JS 가 style.display 로 토글(기본 hidden). 정상흐름 div → leading-text.
const TIP =
  'pointer-events-none absolute z-[3] hidden max-w-60 translate-x-3.5 -translate-y-1/2 rounded-sm border border-line bg-panel-glass-94 px-2.25 py-1.25 text-sm leading-text whitespace-nowrap text-txt shadow-hero tabular-nums';
// 상세 행(정상흐름 div · 소스 line-height 1.7) + 강조 b. 위험도는 group-data 관계형 색(§15 · 자손 셀렉터 대응물).
const ROW = 'text-sm leading-loose text-mut';
const ROW_RISK = `${ROW} group data-[risk=overdue]:text-bad`;
const B = 'font-bold text-txt';
const B_RISK = `${B} group-data-[risk=overdue]:text-bad group-data-[risk=due]:text-learning`;
// 상세 액션 버튼 — 전역 button{} 과 다른 속성만 !. hover box-shadow(inset acc)는 전역이 안 건드려 유지.
const DETAIL_BTN =
  'rounded-detail-btn! border-0! bg-tint-acc-12! px-2.5 py-1.5 text-sm! leading-auto font-extrabold! text-acc! shadow-[var(--shadow-inset-acc-glow)] hover:shadow-[var(--shadow-inset-acc-solid)]';

/** 노드 클릭 시 여는 상세 패널의 최소 정보(시뮬레이션 노드에서 스냅샷). */
interface SelInfo {
  id: string;
  kind: 'hub' | 'leaf';
  label: string;
  itemId: string;
  done?: number;
  total?: number;
  tone?: string;
  /** AN-23 — 허브 총 학습시간(graphData가 이미 계산). 상세에 '총 학습 X.Xh'로 노출. */
  hours?: number;
}

// AN-11 — sel이 없을 때 reviews를 스킵하기 위한 안정 빈 배열(memo 참조 고정 → reviewMap도 안정).
const EMPTY_REVIEWS: ChapterReview[] = [];

/** 테마/액센트에서 읽어오는 캔버스 색(런타임 해석 — var()는 캔버스에 못 쓴다). */
function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, fb: string) => cs.getPropertyValue(n).trim() || fb;
  return {
    bg: v('--panel', '#0e0f13'),
    line: v('--line', 'rgba(255,255,255,0.13)'),
    txt: v('--ink', '#f4f5f7'),
    mut: v('--mut', '#9298a4'),
    good: v('--good', '#62d28c'),
    learning: v('--learning', '#d6a72b'),
    acc: v('--acc', '#9b8cff'),
    // 캔버스 font는 var()를 해석하지 못한다(무효값 → 10px 시스템 폰트로 조용히 폴백) —
    // 색과 마찬가지로 여기서 런타임 해석해 넣는다(테마 변경 시 onTheme이 함께 갱신).
    font: `600 12px ${v('--font-sans', 'sans-serif')}`,
  };
}
/** 그래프 노드 → 상세 패널 스냅샷(클릭·검색 진입 공용). */
function selFrom(n: GraphNode): SelInfo {
  return {
    id: n.id,
    kind: n.kind,
    label: n.label,
    itemId: n.itemId,
    done: n.done,
    total: n.total,
    tone: n.tone,
    hours: n.hours,
  };
}

export default function Graph() {
  const state = useApp((s) => s.state);
  const items = state.items;
  const res = useSchedule();
  const navigate = useNavigate();

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // 캔버스 뷰 제어(줌/팬/노드검색) — 명령형 핸들. 캔버스 이펙트가 채우고, 검색바·버튼이 호출한다.
  const viewApi = useRef<{
    focus: (q: string) => FocusResult | null;
    reset: () => void;
    zoom: (f: number) => void;
    redraw: () => void;
  } | null>(null);
  const [query, setQuery] = useState('');
  const [noHit, setNoHit] = useState(false);
  // L-4 — 검색 매치 순회 힌트(k/N). Enter 반복 시 다음 매치로 순회하며 위치를 표시.
  const [matchHint, setMatchHint] = useState<{ i: number; n: number } | null>(null);

  // 툴팁 — 호버 노드 요약(허브=이름·완료/전체, 잎=이름). 위치는 커서 추종.
  // X-7 A — 포인터마다 setState 리렌더(60/s)를 피하려 DOM 노드를 ref로 직접 갱신한다
  // (위치·텍스트·표시를 명령형으로). React가 style을 관리하지 않으므로 재렌더에도 유지된다.
  const tipRef = useRef<HTMLDivElement>(null);
  // B6 — 클릭 선택 노드(상세 패널). 챕터 잎이면 간격반복 위험까지 보여준다.
  const [sel, setSel] = useState<SelInfo | null>(null);
  // AN-5 — 상세 dialog가 열릴 때 닫기 버튼으로 포커스를 옮겨 키보드 사용자가 진입/탈출 가능하게(ref는 이펙트에서만 사용).
  const detailCloseRef = useRef<HTMLButtonElement>(null);
  // '+N개 더' 오버플로 노드를 눌러 펼친 허브(itemId) — 캡을 풀어 숨은 챕터를 실제로 드러낸다.
  const [expandedHubs, setExpandedHubs] = useState<ReadonlySet<string>>(() => new Set());

  // 킬러 ② — 과목 경계를 넘는 의미 연결(로컬 임베딩). 비동기 보강: Ollama 없으면 조용히 빈 배열.
  // 상태를 추적해 '왜 의미 연결이 없나'를 범례로 밝힌다(발견가능성 — 없던 기능을 존재하게).
  const [semEdges, setSemEdges] = useState<SemEdge[]>([]);
  // 의미 연결은 그리기 전용(힘 시뮬레이션 불참)이라, 무거운 캔버스 이펙트의 의존성에서 떼어낸다.
  // ref로 draw()가 최신 값을 읽고, 아래 얇은 이펙트가 값 변경 시 재시뮬레이션 없이 draw만 다시 부른다.
  // (semEdges가 새 배열 참조로 바뀔 때마다 힘 시뮬레이션이 alpha=1로 리셋되며 드래그 위치가 날아가던 버그 차단.)
  const semEdgesRef = useRef<SemEdge[]>([]);
  const [semStatus, setSemStatus] = useState<'idle' | 'ok' | 'unavailable'>('idle');
  useEffect(() => {
    let stale = false;
    semanticChapterEdges(items)
      .then((edges) => {
        if (stale) return;
        setSemEdges(edges);
        // 임베딩 시도 후 비활성이면(Ollama 꺼짐·모델 미설치) 안내, 아니면 정상.
        setSemStatus(semanticAvailable() ? 'ok' : 'unavailable');
      })
      .catch(() => {
        if (!stale) setSemStatus('unavailable');
      });
    return () => {
      stale = true;
    };
  }, [items]);

  // 챕터별 복습 위험(C8) — 잎 상세에서 '마지막 학습·경과일'로 재활용.
  // AN-11 — 소비처(leafRv/hubRisk)는 노드를 클릭해 sel이 있을 때만 쓴다. 지도만 보는 대다수 세션엔
  // 전수 스캔이 순수 낭비 → sel이 truthy일 때만 계산(온디맨드 세부). sel 없을 때 둘 다 미사용이라 동작 보존.
  const reviews = useMemo(
    () => (sel ? chapterReviews(state, res.days || [], todayISO(state)) : EMPTY_REVIEWS),
    [sel, state, res.days],
  );
  const reviewMap = useMemo(() => {
    const m = new Map<string, ChapterReview>();
    for (const r of reviews) m.set(weakKey(r.sid, r.chapter), r);
    return m;
  }, [reviews]);
  const leafRv = sel && sel.kind === 'leaf' ? reviewMap.get(weakKey(sel.itemId, sel.label)) : null;
  const hubRisk =
    sel && sel.kind === 'hub' ? reviews.filter((r) => r.sid === sel.itemId && r.risk !== 'fresh').length : 0;

  /* E16 — 이 Esc 는 패널이 열렸을 때만 산다 → 치트시트도 그때만 말한다(`enabled`).
     무조건 등재하면 닫을 것이 없을 때도 "Esc 닫기"라 적어 **반대 방향으로** 거짓말한다. */
  useKeymapDoc('이 화면 · 노드 상세', [{ display: 'Esc', label: '상세 패널 닫기' }], !!sel);

  // AN-5 — role="dialog" 상세 패널의 키보드 닫기. sel이 있을 때만 document keydown Esc→닫기
  // (캔버스 상호작용과 충돌 없게 게이트, cleanup 필수).
  useEffect(() => {
    if (!sel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSel(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sel]);
  // AN-5 — 열릴 때(또는 선택 노드가 바뀔 때) 닫기 버튼으로 포커스 1회 이동. React Compiler: 이펙트 내에서만 ref 접근.
  useEffect(() => {
    if (sel) detailCloseRef.current?.focus();
  }, [sel]);

  // 상단 리드아웃 — 항목·챕터·완료율(Mastery가 usePageChromeEffect를 쓰는 방식과 동일).
  const totalCh = items.reduce((t, it) => t + (it.chapters?.length || 0), 0);
  const doneCh = items.reduce((t, it) => t + (it.chapters?.filter((c) => c.done).length || 0), 0);
  const pct = totalCh ? Math.round((doneCh / totalCh) * 100) : 0;
  usePageChromeEffect(
    () => ({
      readouts: items.length
        ? [
            { label: '완료율', value: `${pct}%`, accent: true },
            { label: '항목', value: items.length },
            { label: '챕터', value: `${doneCh}/${totalCh}` },
          ]
        : [],
    }),
    [items.length, doneCh, totalCh, pct],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return; // getContext 실패 — 조용히 무동작(throw 금지)

    const graph = buildGraph(items, expandedHubs);
    if (!graph.nodes.length) return;
    // 힘 시뮬·좌표기하·뷰 상태의 명령형 코어(DOM 무관, features/graph/graphSim.ts) —
    // 이 이펙트는 캔버스·팔레트·draw·RAF·포인터 리스너만 배선하고 나머지는 코어에 위임한다.
    const sim = createGraphSim(graph, wrap.clientWidth || 1, wrap.clientHeight || 1);

    let palette = readPalette();
    let cw = 0;
    let ch = 0;
    let dpr = 1;
    // 클릭(선택) vs 드래그·팬 구분은 포인터 제스처(DOM)라 컴포넌트가 소유한다.
    let panning = false;
    let panStartX = 0;
    let panStartY = 0;
    let panOrigX = 0;
    let panOrigY = 0;
    let downId: string | null = null;
    let downX = 0;
    let downY = 0;
    let moved = false;

    /* ⚠ 이 핸들은 **변화를 듣기 위한 것**이고, "지금 자제인가"의 판정은 `lib/motion` 이 한다(H19).
       종전엔 `reduce.matches` 를 직접 읽어 앱 설정('발광 효과 줄이기')을 모르는 사본이었다. */
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

    // ── 그리기 — 코어(sim)·팔레트·치수만 읽는 순수 렌더는 `graphDraw.drawGraph` 가 소유한다.
    //    semEdges 는 ref 에서 최신 값을 읽는다(무거운 이펙트 재실행 없이 얇은 이펙트가 draw 만 갱신).
    const draw = () => drawGraph(ctx, sim, palette, { dpr, cw, ch }, semEdgesRef.current);

    // ── RAF 루프(냉각 후 idle 정지) ─────────────────────────────────────────
    let raf = 0;
    let alpha = 1;
    const ALPHA_MIN = 0.02;
    const paused = () => document.hidden;
    const loop = () => {
      raf = 0;
      if (paused()) return; // 재개는 visibilitychange가
      const ke = sim.step(alpha);
      alpha *= 0.98;
      draw();
      // 정착(alpha 소진 & 운동에너지≈0)하면 정지 — 드래그 중이면 계속.
      if (sim.isDragging() || (alpha > ALPHA_MIN && ke > 0.02)) {
        raf = requestAnimationFrame(loop);
      }
    };
    const ensureLoop = () => {
      if (raf === 0 && !paused() && !prefersReducedMotion()) raf = requestAnimationFrame(loop);
    };
    const reheat = (a = 0.6) => {
      alpha = Math.max(alpha, a);
      ensureLoop();
    };

    // ── 크기(devicePixelRatio) ─────────────────────────────────────────────
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cw = wrap.clientWidth;
      ch = wrap.clientHeight;
      canvas.width = Math.max(1, Math.floor(cw * dpr));
      canvas.height = Math.max(1, Math.floor(ch * dpr));
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${ch}px`;
      sim.resize(cw, ch);
      draw();
    };

    // ── 툴팁(호버 요약) — 명령형 갱신(포인터마다 리렌더 방지) ─────────────────
    const tipText = (n: GraphNode) => (n.kind === 'hub' ? `${n.label} · ${n.done ?? 0}/${n.total ?? 0} 챕터` : n.label);
    const showTip = (x: number, y: number, text: string) => {
      const el = tipRef.current;
      if (!el) return;
      if (el.textContent !== text) el.textContent = text;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.display = 'block';
    };
    const hideTip = () => {
      const el = tipRef.current;
      if (el) el.style.display = 'none';
    };

    // ── 포인터(호버 툴팁 + 드래그 + 팬) — 좌표를 캔버스-로컬로 환산해 코어에 위임 ──────
    const onDown = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const n = sim.hitTest(e.clientX - rect.left, e.clientY - rect.top);
      if (!n) {
        // 빈 공간 = 캔버스 팬(뷰 이동) + 선택 해제.
        panning = true;
        panStartX = e.clientX;
        panStartY = e.clientY;
        const v = sim.view();
        panOrigX = v.x;
        panOrigY = v.y;
        canvas.setPointerCapture(e.pointerId);
        canvas.style.cursor = 'grabbing';
        setSel(null);
        return;
      }
      sim.beginDrag(n.id);
      downId = n.id;
      downX = e.clientX;
      downY = e.clientY;
      moved = false;
      canvas.setPointerCapture(e.pointerId);
      reheat(0.4);
    };
    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      if (panning) {
        sim.pan(panOrigX + (e.clientX - panStartX), panOrigY + (e.clientY - panStartY));
        draw();
        return;
      }
      if (sim.isDragging()) {
        if (!moved && Math.hypot(e.clientX - downX, e.clientY - downY) > 4) moved = true;
        sim.dragTo(px, py);
        if (prefersReducedMotion()) draw();
        else ensureLoop();
        const dn = downId ? sim.node(downId) : undefined;
        if (dn) showTip(px, py, tipText(dn));
        return;
      }
      const n = sim.hitTest(px, py);
      canvas.style.cursor = n ? 'grab' : 'default';
      if (n) showTip(px, py, tipText(n));
      else hideTip();
    };
    const onUp = (e: PointerEvent) => {
      if (panning) {
        panning = false;
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch {
          /* 이미 해제됨 */
        }
        canvas.style.cursor = 'default';
        return;
      }
      if (sim.isDragging()) {
        const n = downId ? sim.node(downId) : undefined;
        sim.endDrag();
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch {
          /* 이미 해제됨 */
        }
        reheat(0.3);
        // 거의 안 움직였으면 클릭 = 상세 패널 열기(드래그 후엔 열지 않음).
        if (n && !moved && downId === n.id) {
          if (n.overflow) {
            // 오버플로 노드 = 빈 상세 데드엔드였던 것 → 그 허브를 펼쳐 숨은 챕터를 드러낸다.
            setExpandedHubs((prev) => {
              const next = new Set(prev);
              next.add(n.itemId);
              return next;
            });
            setSel(null);
          } else {
            setSel(selFrom(n));
          }
        }
      }
      downId = null;
      moved = false;
    };
    const onLeave = () => {
      if (!sim.isDragging()) hideTip();
    };

    // ── 줌(휠) — 커서 아래 지점을 고정한 채 확대/축소(코어가 뷰 계산, 변화 시 draw) ──────
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      if (sim.zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0012))) draw();
    };

    // 명령형 뷰 API — 검색바·버튼이 호출(노드로 이동/센터·리셋·버튼 줌). 코어에 위임하고 draw만 배선.
    viewApi.current = {
      focus: (q) => {
        const r = sim.focus(q);
        if (r) draw();
        return r;
      },
      reset: () => {
        sim.reset();
        draw();
      },
      zoom: (factor) => {
        if (sim.zoomAt(cw / 2, ch / 2, factor)) draw();
      },
      // 의미 연결이 도착/변경되면 얇은 이펙트가 호출 — 재시뮬레이션 없이 현재 프레임만 다시 그린다.
      redraw: () => draw(),
    };

    // ── 테마/가시성/리사이즈 리스너 ────────────────────────────────────────
    const onTheme = () => {
      palette = readPalette();
      draw();
    };
    const onVis = () => {
      if (!document.hidden) ensureLoop();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    const mo = new MutationObserver(onTheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-accent'] });
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('visibilitychange', onVis);
    reduce.addEventListener('change', onTheme);

    // 초기화 — 모션 비선호면 동기로 정착시킨 뒤 1회 그림. 아니면 RAF 루프.
    resize();
    if (prefersReducedMotion()) {
      // L-2 — step은 대형에서 무겁다. 반복수를 노드 수에 반비례로 캡해 모션민감 사용자의
      // 초기화 프리즈를 막는다(정착 품질은 유지).
      const iters = Math.min(320, Math.floor(40000 / Math.max(1, sim.nodes.length)));
      for (let i = 0; i < iters; i++) sim.step(0.9 * Math.pow(0.99, i));
      draw();
    } else {
      ensureLoop();
    }

    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      document.removeEventListener('visibilitychange', onVis);
      reduce.removeEventListener('change', onTheme);
      viewApi.current = null;
    };
  }, [items, expandedHubs]);

  // 얇은 이펙트 — 의미 연결(그리기 전용)이 바뀌면 ref만 갱신하고 현재 프레임을 다시 그린다.
  // 무거운 시뮬레이션 이펙트를 재실행하지 않으므로 드래그한 노드 위치·냉각 상태가 보존된다.
  useEffect(() => {
    semEdgesRef.current = semEdges;
    viewApi.current?.redraw();
  }, [semEdges]);

  // 검색 실행 — 라벨 부분일치 노드로 이동/센터. 없으면 '없음', 있으면 순회 위치(k/N) 표시.
  // 코어(sim.focus)는 뷰만 옮기고 React 상태엔 손대지 않으므로, 매치된 노드의 상세·힌트는 여기서 반영.
  const runSearch = (q: string) => {
    const r = viewApi.current?.focus(q) ?? null;
    if (r) setSel(selFrom(r.target));
    setNoHit(!r && q.trim().length > 0);
    setMatchHint(r ? { i: r.i, n: r.n } : null);
  };

  const ariaLabel = `학습 구조도 — 항목 ${items.length}개, 챕터 ${doneCh}/${totalCh} 완료${semEdges.length ? `, 의미 연결 ${semEdges.length}개` : ''}`;

  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col px-4.5 pt-4 pb-3.5 max-mobile:px-3 max-mobile:pt-3 max-mobile:pb-2.5"
      aria-label="학습 구조도"
    >
      {items.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-line bg-[image:var(--bg-map-mastery)] shadow-card">
          <State
            glyph="🕸"
            title="아직 학습 구조도가 비어 있어요"
            desc={
              <>
                학습 항목을 추가하면 구조도가 그려져요. 항목은 <b>허브</b>, 챕터는 <b>잎</b>으로 이어져 무엇을 얼마나
                익혔는지 한눈에 보입니다.
              </>
            }
            next={
              <Button variant="primary" onClick={() => navigate('/items', { viewTransition: true })}>
                + 학습 항목 추가
              </Button>
            }
          />
        </div>
      ) : (
        <div
          className={`ds-hairline relative min-h-0 min-w-0 flex-1 animate-[enter-rise_var(--dur-slow)_var(--ease)_both] overflow-hidden rounded-lg border border-line bg-[image:var(--bg-map-mastery)] shadow-card motion-reduce:animate-none`}
          ref={wrapRef}
        >
          {/* 검색 + 줌 컨트롤 — 우상단 오버레이. 캔버스는 SR 불투명이라 여기 컨트롤이 접근 경로. */}
          <div className="absolute top-3 right-3.5 z-[3] flex items-center gap-1.25">
            <input
              className={SEARCH}
              type="search"
              value={query}
              placeholder="개념·챕터 찾기…"
              aria-label="학습 구조도 노드 검색"
              onChange={(e) => {
                setQuery(e.target.value);
                setNoHit(false);
                setMatchHint(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') runSearch(query);
              }}
            />
            <button type="button" className={CTRL_BTN} aria-label="찾기" onClick={() => runSearch(query)}>
              ⌕
            </button>
            <button type="button" className={CTRL_BTN} aria-label="확대" onClick={() => viewApi.current?.zoom(1.3)}>
              ＋
            </button>
            <button type="button" className={CTRL_BTN} aria-label="축소" onClick={() => viewApi.current?.zoom(1 / 1.3)}>
              －
            </button>
            <button
              type="button"
              className={CTRL_BTN}
              aria-label="전체 보기로 초기화"
              onClick={() => {
                setQuery('');
                setNoHit(false);
                setMatchHint(null);
                viewApi.current?.reset();
              }}
            >
              ⤢
            </button>
          </div>
          {noHit && (
            <div className={`${TOAST} border-line-warn-mid text-warn`} role="status">
              “{query}” 노드를 못 찾았어요
            </div>
          )}
          {matchHint && (
            <div
              className={`${TOAST} border-line-acc-hover text-acc tabular-nums`}
              role="status"
              aria-label={`매치 ${matchHint.i} / ${matchHint.n}`}
            >
              {matchHint.i}/{matchHint.n}
              {matchHint.n > 1 ? <span className="text-mut"> · Enter로 다음</span> : null}
            </div>
          )}
          <div className="pointer-events-none absolute top-3 left-3.5 z-[2] flex flex-wrap gap-x-3.5 gap-y-1.5 rounded-md border border-line bg-panel-glass-82 px-3 py-2 text-xs leading-text text-mut [backdrop-filter:var(--backdrop-graph)] max-mobile:gap-x-2.5 max-mobile:gap-y-1 max-mobile:px-2.25 max-mobile:py-1.5 max-mobile:text-2xs">
            <span className={LEG_SPAN}>
              <i className={`${SWATCH} bg-acc shadow-hub`} /> 항목(허브·색=과목)
            </span>
            <span className={LEG_SPAN}>
              <i className={`${SWATCH} bg-good`} /> 숙달
            </span>
            <span className={LEG_SPAN}>
              <i className={`${SWATCH} bg-learning`} /> 학습중
            </span>
            <span className={LEG_SPAN}>
              <i className={`${SWATCH} bg-mut`} /> 미착수
            </span>
            {semEdges.length > 0 ? (
              <span className={LEG_SPAN}>
                <i className="inline-block h-0 w-3.5 rounded-none border-t-2 border-dashed border-acc opacity-70" />{' '}
                의미 연결(자동)
              </span>
            ) : semStatus === 'unavailable' ? (
              <span
                className={`${LEG_SPAN} italic opacity-70`}
                title="Ollama 임베딩 모델이 있으면 과목 경계를 넘는 의미 연결이 자동으로 그려져요"
              >
                <i className="inline-block h-0 w-3.5 rounded-none border-t-2 border-dashed border-acc opacity-70" />{' '}
                의미 연결 — Ollama 필요
              </span>
            ) : null}
          </div>
          <canvas ref={canvasRef} className="block size-full touch-none" role="img" aria-label={ariaLabel} />
          {/* 툴팁 — 항상 마운트, 위치·텍스트·표시는 포인터 핸들러가 ref로 직접 갱신(리렌더 없음). */}
          <div ref={tipRef} className={TIP} role="tooltip" aria-hidden="true" />
          {/* B6 — 노드 클릭 상세: 챕터의 상태·마지막 학습(간격반복)·점프. */}
          {sel && (
            <div
              className="absolute bottom-3.5 left-3.5 z-[4] w-full max-w-graph-detail animate-[enter-rise_var(--dur)_var(--ease)_both] rounded-md border border-line bg-panel-glass-96 px-4 pt-3.5 pb-3.25 shadow-hero"
              role="dialog"
              aria-label={`${sel.label} 상세`}
            >
              <button
                ref={detailCloseRef}
                type="button"
                className="absolute top-2 right-2.25 size-5.5 rounded-detail-x! border-0! bg-transparent! text-mut!"
                onClick={() => setSel(null)}
                aria-label="닫기"
              >
                ✕
              </button>
              <div className="text-2xs font-extrabold tracking-kind text-acc uppercase">
                {sel.kind === 'hub' ? '학습 항목' : '챕터'}
              </div>
              <div className="mt-0.75 mb-2 pr-5 text-lg leading-tight font-extrabold break-keep text-txt">
                {sel.label}
              </div>
              {sel.kind === 'hub' ? (
                <>
                  <div className={ROW}>
                    진행{' '}
                    <b className={B}>
                      {sel.done ?? 0}/{sel.total ?? 0}
                    </b>{' '}
                    챕터
                  </div>
                  {/* AN-23 — graphData가 이미 집계한 챕터 학습시간 합을 노출(0이면 생략). */}
                  {sel.hours != null && sel.hours > 0 && (
                    <div className={ROW}>
                      총 학습 <b className={B}>{sel.hours.toFixed(1)}h</b>
                    </div>
                  )}
                  {hubRisk > 0 && (
                    <div className={ROW_RISK} data-risk="overdue">
                      복습 위험 <b className={B_RISK}>{hubRisk}개</b>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className={ROW}>
                    상태{' '}
                    <b className={B}>{sel.tone === 'done' ? '숙달' : sel.tone === 'learning' ? '학습중' : '미착수'}</b>
                  </div>
                  {leafRv ? (
                    <div className={ROW_RISK} data-risk={leafRv.risk}>
                      마지막 학습 <b className={B_RISK}>{leafRv.daysSince}일 전</b> ·{' '}
                      {leafRv.risk === 'overdue' ? '복습 시급' : leafRv.risk === 'due' ? '복습 권장' : '최근'}
                    </div>
                  ) : (
                    <div className={`${ROW} opacity-80`}>완료된 학습 기록이 아직 없어요</div>
                  )}
                </>
              )}
              <div className="mt-2.75 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={DETAIL_BTN}
                  // AN-17 — 목록 최상단이 아니라 이 항목 카드로 딥링크(허브=자기 항목 id, 잎=부모 항목 id 둘 다 sel.itemId).
                  onClick={() => navigate('/items?focus=' + encodeURIComponent(sel.itemId), { viewTransition: true })}
                >
                  학습 항목 열기 →
                </button>
                {(hubRisk > 0 || (leafRv && leafRv.risk !== 'fresh')) && (
                  <button
                    type="button"
                    className={DETAIL_BTN}
                    onClick={() => navigate('/review', { viewTransition: true })}
                  >
                    복습 위험 보기 →
                  </button>
                )}
                {/* E-5: 볼트 딥링크 — obsidian://search는 볼트명 없이도 동작(설치돼 있으면). */}
                <button
                  type="button"
                  className={DETAIL_BTN}
                  onClick={() => openVaultSearch(sel.label)}
                  title="Obsidian에서 이 개념 검색 (설치돼 있어야 함)"
                >
                  🔎 볼트에서 찾기
                </button>
                {/* E-5: Anki는 신뢰 가능한 데스크톱 URL 스킴이 없어 연동 탭(덱 상태·내보내기)으로 안내. */}
                <button
                  type="button"
                  className={DETAIL_BTN}
                  onClick={() => navigate('/integrations', { viewTransition: true })}
                  title="Anki 덱 상태·카드 내보내기"
                >
                  📇 Anki 연동 →
                </button>
              </div>
            </div>
          )}
          {/* 스크린리더 대체 — 캔버스는 불투명하므로 항목별 done/total을 목록으로 병행 제공. */}
          <ul className="ds-srOnly">
            {items.map((it) => {
              const t = it.chapters?.length || 0;
              const d = it.chapters?.filter((c) => c.done).length || 0;
              return (
                <li key={it.id}>
                  {it.name} — 챕터 {d}/{t} 완료
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
