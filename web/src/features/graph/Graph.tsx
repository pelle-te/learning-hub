/* ============================================================
   Graph — 탭: 🕸 지식맵. 로컬 학습 항목만으로 그려지는 힘-방향(force-directed) 허브-앤-스포크.
   항목=허브, 챕터=잎, 허브→챕터=링크. "내가 무엇을 얼마나 익혔나"의 살아있는 지도.
   서버 페치 없음(항상 가용) — graphData.buildGraph(순수)로 노드/링크를 만들고,
   자체 스프링-반발 시뮬레이션(velocity-Verlet 근사)을 <canvas>에서 돈다(외부 라이브러리 없음).

   안전장치(AmbientCanvas·TodaySignature와 동형):
   • devicePixelRatio 스케일 + ResizeObserver로 선명·반응형, getContext 실패시 무동작(throw X).
   • 정착하면 RAF 정지(운동에너지≈0=idle) → 배터리 절약. 드래그/테마변경 시 재가열.
   • prefers-reduced-motion → 애니메이션 생략, 레이아웃을 동기로 N회 반복 후 한 번만 그림.
   • document.hidden → RAF 일시정지. 언마운트 시 RAF·옵서버·리스너 전부 정리(누수 0).
   • 캔버스는 스크린리더에 불투명 → role=img + aria-label 요약 + .srOnly <ul>(항목 done/total) 병행.
============================================================ */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/store/useApp';
import { useSchedule } from '@/store/selectors';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { chapterReviews, type ChapterReview } from '@/lib/spacedReview';
import { todayISO } from '@/lib/utils';
import EmptyState from '@/components/EmptyState';
import { Button } from '@/components/ui';
import { buildGraph, type GraphNode } from './graphData';
import { semanticChapterEdges, semanticAvailable, type SemEdge } from '@/lib/semantic';
import g from './Graph.module.css';

/** 노드 클릭 시 여는 상세 패널의 최소 정보(시뮬레이션 노드에서 스냅샷). */
interface SelInfo {
  id: string;
  kind: 'hub' | 'leaf';
  label: string;
  itemId: string;
  done?: number;
  total?: number;
  tone?: string;
}

/** 테마/액센트에서 읽어오는 캔버스 색(런타임 해석 — var()는 캔버스에 못 쓴다). */
interface Palette {
  bg: string;
  line: string;
  txt: string;
  mut: string;
  good: string;
  learning: string;
  acc: string;
  font: string;
}
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
function leafColor(n: GraphNode, p: Palette): string {
  return n.tone === 'done' ? p.good : n.tone === 'learning' ? p.learning : p.mut;
}

/** 활성 노드(드래그 대상)를 포함하는 가변 시뮬레이션 노드. */
type SimNode = GraphNode;

export default function Graph() {
  const state = useApp((s) => s.state);
  const items = state.items;
  const res = useSchedule();
  const navigate = useNavigate();

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // 캔버스 뷰 제어(줌/팬/노드검색) — 명령형 핸들. 캔버스 이펙트가 채우고, 검색바·버튼이 호출한다.
  const viewApi = useRef<{
    focus: (q: string) => { i: number; n: number } | null;
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
  const reviews = useMemo(() => chapterReviews(state, res.days || [], todayISO(state)), [state, res]);
  const reviewMap = useMemo(() => {
    const m = new Map<string, ChapterReview>();
    for (const r of reviews) m.set(r.sid + '|' + r.chapter, r);
    return m;
  }, [reviews]);
  const leafRv = sel && sel.kind === 'leaf' ? reviewMap.get(sel.itemId + '|' + sel.label) : null;
  const hubRisk =
    sel && sel.kind === 'hub' ? reviews.filter((r) => r.sid === sel.itemId && r.risk !== 'fresh').length : 0;

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

    const { nodes, links } = buildGraph(items, expandedHubs);
    if (!nodes.length) return;
    const byId = new Map<string, SimNode>(nodes.map((n) => [n.id, n]));
    const idxById = new Map<string, number>(nodes.map((n, i) => [n.id, i]));

    let palette = readPalette();
    let cw = 0;
    let ch = 0;
    let dpr = 1;
    // 화면 자동맞춤 변환(월드→스크린) — 히트테스트 역변환에 재사용.
    let tf = { scale: 1, ox: 0, oy: 0 };
    // 사용자 뷰(줌/팬) — auto-fit 위에 얹는 스크린-공간 오버레이. userView가 켜지면 auto-fit을 동결(뷰 안정).
    const view = { k: 1, x: 0, y: 0 };
    let userView = false;
    let panning = false;
    let panStartX = 0;
    let panStartY = 0;
    let panOrigX = 0;
    let panOrigY = 0;
    let dragId: string | null = null;
    // 클릭(선택) vs 드래그 구분 — pointerdown~up 사이 이동이 미미하면 '클릭'으로 상세 패널을 연다.
    let downId: string | null = null;
    let downX = 0;
    let downY = 0;
    let moved = false;
    // L-4 — 검색 매치 순회 상태(같은 검색어로 Enter 반복 시 다음 매치로).
    let searchNeedle = '';
    let searchIdx = -1;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

    // ── 힘 시뮬레이션 1스텝(스프링-반발-중력, alpha 냉각) ──────────────────
    const REP = 5200; // 반발 상수
    const SPRING = 0.045; // 링크 스프링
    const REST = 74; // 링크 자연 길이
    const GRAV = 0.012; // 중심 인력
    const DAMP = 0.85; // 감쇠
    const fx = new Float64Array(nodes.length);
    const fy = new Float64Array(nodes.length);
    const step = (alpha: number): number => {
      fx.fill(0);
      fy.fill(0);
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i]!;
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j]!;
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 0.01) {
            dx = (i - j) * 0.1 + 0.1;
            dy = 0.1;
            d2 = dx * dx + dy * dy;
          }
          const d = Math.sqrt(d2);
          const f = REP / d2;
          const ux = (dx / d) * f;
          const uy = (dy / d) * f;
          fx[i]! += ux;
          fy[i]! += uy;
          fx[j]! -= ux;
          fy[j]! -= uy;
        }
      }
      for (const l of links) {
        const s = byId.get(l.source);
        const t = byId.get(l.target);
        if (!s || !t) continue;
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const f = SPRING * (d - REST);
        const ux = (dx / d) * f;
        const uy = (dy / d) * f;
        const si = idxById.get(l.source)!;
        const ti = idxById.get(l.target)!;
        fx[si]! += ux;
        fy[si]! += uy;
        fx[ti]! -= ux;
        fy[ti]! -= uy;
      }
      let ke = 0;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]!;
        if (n.id === dragId) {
          n.vx = 0;
          n.vy = 0;
          continue;
        }
        const ax = (fx[i]! - n.x * GRAV) * alpha;
        const ay = (fy[i]! - n.y * GRAV) * alpha;
        n.vx = (n.vx + ax) * DAMP;
        n.vy = (n.vy + ay) * DAMP;
        n.x += n.vx;
        n.y += n.vy;
        ke += n.vx * n.vx + n.vy * n.vy;
      }
      return ke / nodes.length;
    };

    // ── 그리기 ────────────────────────────────────────────────────────────
    const computeTransform = () => {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const n of nodes) {
        minX = Math.min(minX, n.x - n.radius);
        minY = Math.min(minY, n.y - n.radius);
        maxX = Math.max(maxX, n.x + n.radius);
        maxY = Math.max(maxY, n.y + n.radius);
      }
      const pad = 48;
      const bw = Math.max(1, maxX - minX);
      const bh = Math.max(1, maxY - minY);
      const scale = Math.min((cw - pad * 2) / bw, (ch - pad * 2) / bh, 1.6);
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      tf = { scale, ox: cw / 2 - cx * scale, oy: ch / 2 - cy * scale };
    };
    // 최종 스크린 좌표 = 사용자 뷰(view) ∘ auto-fit(tf). 노드 크기·라벨 임계도 유효 배율(effScale)을 따른다.
    const sx = (x: number) => view.x + view.k * (tf.ox + x * tf.scale);
    const sy = (y: number) => view.y + view.k * (tf.oy + y * tf.scale);
    const effScale = () => tf.scale * view.k;
    const draw = () => {
      if (!userView) computeTransform(); // 사용자가 줌/팬하면 auto-fit 동결(프레이밍 유지).
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      // 링크
      ctx.strokeStyle = palette.line;
      ctx.lineWidth = 1;
      for (const l of links) {
        const s = byId.get(l.source);
        const t = byId.get(l.target);
        if (!s || !t) continue;
        ctx.beginPath();
        ctx.moveTo(sx(s.x), sy(s.y));
        ctx.lineTo(sx(t.x), sy(t.y));
        ctx.stroke();
      }
      // 의미 연결(자동) — 과목 경계를 넘는 점선(액센트, 그리기 전용 — 힘에는 불참).
      // ref에서 최신 값을 읽는다(무거운 이펙트를 재실행하지 않고 얇은 이펙트가 draw만 갱신).
      const sem = semEdgesRef.current;
      if (sem.length) {
        ctx.strokeStyle = palette.acc;
        ctx.globalAlpha = 0.4;
        ctx.setLineDash([5, 5]);
        for (const l of sem) {
          const s = byId.get(l.source);
          const t = byId.get(l.target);
          if (!s || !t) continue;
          ctx.beginPath();
          ctx.moveTo(sx(s.x), sy(s.y));
          ctx.lineTo(sx(t.x), sy(t.y));
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
      // 노드
      const nodeScale = Math.min(1.6, Math.max(0.7, effScale()));
      for (const n of nodes) {
        const r = n.radius * nodeScale;
        const px = sx(n.x);
        const py = sy(n.y);
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        if (n.kind === 'hub') {
          ctx.fillStyle = n.color || palette.acc;
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = palette.bg;
          ctx.stroke();
        } else {
          ctx.fillStyle = leafColor(n, palette);
          ctx.globalAlpha = n.overflow ? 0.6 : 0.92;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
      // 허브 라벨(항상) + 잎 라벨(충분히 확대했을 때만 — 평소엔 툴팁으로 폭주 방지).
      ctx.fillStyle = palette.txt;
      ctx.font = palette.font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const showLeafLabels = effScale() > 1.35; // 줌인하면 챕터 이름도 드러난다(터치·탐색 지원).
      for (const n of nodes) {
        if (n.kind !== 'hub' && !(showLeafLabels && !n.overflow)) continue;
        const r = n.radius * nodeScale;
        if (n.kind === 'hub') {
          ctx.fillStyle = palette.txt;
          ctx.fillText(n.label, sx(n.x), sy(n.y) + r + 3);
        } else {
          ctx.fillStyle = palette.mut;
          ctx.fillText(n.label, sx(n.x), sy(n.y) + r + 2);
        }
      }
    };

    // ── RAF 루프(냉각 후 idle 정지) ─────────────────────────────────────────
    let raf = 0;
    let alpha = 1;
    const ALPHA_MIN = 0.02;
    const paused = () => document.hidden;
    const loop = () => {
      raf = 0;
      if (paused()) return; // 재개는 visibilitychange가
      const ke = step(alpha);
      alpha *= 0.98;
      draw();
      // 정착(alpha 소진 & 운동에너지≈0)하면 정지 — 드래그 중이면 계속.
      if (dragId != null || (alpha > ALPHA_MIN && ke > 0.02)) {
        raf = requestAnimationFrame(loop);
      }
    };
    const ensureLoop = () => {
      if (raf === 0 && !paused() && !reduce.matches) raf = requestAnimationFrame(loop);
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
      draw();
    };

    // ── 히트테스트(스크린→월드 역변환) ─────────────────────────────────────
    const hit = (clientX: number, clientY: number): SimNode | null => {
      const rect = canvas.getBoundingClientRect();
      // 스크린 → auto-fit(base) → 월드: view를 먼저 풀고(tf.ox 기준으로), 그다음 tf를 푼다.
      const bx = (clientX - rect.left - view.x) / view.k;
      const by = (clientY - rect.top - view.y) / view.k;
      const wx = (bx - tf.ox) / tf.scale;
      const wy = (by - tf.oy) / tf.scale;
      // L-3 — 렌더 반경과 히트 반경 일치: draw가 쓰는 nodeScale/effScale를 그대로 반영한다.
      // 화면 반경 = n.radius * nodeScale, 여기에 6px 여유를 더해 월드로 환산(줌 무관 일관).
      const eff = effScale();
      const ns = Math.min(1.6, Math.max(0.7, eff));
      let best: SimNode | null = null;
      let bestD = Infinity;
      for (const n of nodes) {
        const dx = n.x - wx;
        const dy = n.y - wy;
        const d = dx * dx + dy * dy;
        const worldR = (n.radius * ns + 6) / eff;
        const rr = worldR * worldR;
        if (d <= rr && d < bestD) {
          bestD = d;
          best = n;
        }
      }
      return best;
    };
    const tipText = (n: SimNode) => (n.kind === 'hub' ? `${n.label} · ${n.done ?? 0}/${n.total ?? 0} 챕터` : n.label);
    // X-7 A — 툴팁을 명령형으로 갱신(포인터마다 리렌더 방지). 위치는 좌상단 기준(CSS transform이 오프셋 담당).
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

    // ── 포인터(호버 툴팁 + 드래그) ─────────────────────────────────────────
    const onDown = (e: PointerEvent) => {
      const n = hit(e.clientX, e.clientY);
      if (!n) {
        // 빈 공간 = 캔버스 팬(뷰 이동) + 선택 해제.
        panning = true;
        panStartX = e.clientX;
        panStartY = e.clientY;
        panOrigX = view.x;
        panOrigY = view.y;
        canvas.setPointerCapture(e.pointerId);
        canvas.style.cursor = 'grabbing';
        setSel(null);
        return;
      }
      dragId = n.id;
      downId = n.id;
      downX = e.clientX;
      downY = e.clientY;
      moved = false;
      canvas.setPointerCapture(e.pointerId);
      reheat(0.4);
    };
    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (panning) {
        userView = true;
        view.x = panOrigX + (e.clientX - panStartX);
        view.y = panOrigY + (e.clientY - panStartY);
        draw();
        return;
      }
      if (dragId != null) {
        const n = byId.get(dragId);
        if (n) {
          if (!moved && Math.hypot(e.clientX - downX, e.clientY - downY) > 4) moved = true;
          // 스크린 → auto-fit → 월드(줌/팬 반영).
          const bx = (e.clientX - rect.left - view.x) / view.k;
          const by = (e.clientY - rect.top - view.y) / view.k;
          n.x = (bx - tf.ox) / tf.scale;
          n.y = (by - tf.oy) / tf.scale;
          n.vx = 0;
          n.vy = 0;
          if (reduce.matches) draw();
          else ensureLoop();
          showTip(e.clientX - rect.left, e.clientY - rect.top, tipText(n));
        }
        return;
      }
      const n = hit(e.clientX, e.clientY);
      canvas.style.cursor = n ? 'grab' : 'default';
      if (n) showTip(e.clientX - rect.left, e.clientY - rect.top, tipText(n));
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
      if (dragId != null) {
        const n = byId.get(dragId);
        dragId = null;
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
            setSel({
              id: n.id,
              kind: n.kind,
              label: n.label,
              itemId: n.itemId,
              done: n.done,
              total: n.total,
              tone: n.tone,
            });
          }
        }
      }
      downId = null;
      moved = false;
    };
    const onLeave = () => {
      if (dragId == null) hideTip();
    };

    // ── 줌(휠) — 커서 아래 지점을 고정한 채 확대/축소 ──────────────────────
    const K_MIN = 0.4;
    const K_MAX = 6;
    const zoomAt = (mx: number, my: number, factor: number) => {
      const newK = Math.max(K_MIN, Math.min(K_MAX, view.k * factor));
      if (newK === view.k) return;
      userView = true;
      // 커서 아래 점 고정: mx = view.x + view.k*base  →  base 불변 → view.x 보정.
      view.x = mx - ((mx - view.x) * newK) / view.k;
      view.y = my - ((my - view.y) * newK) / view.k;
      view.k = newK;
      draw();
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0012));
    };

    // 명령형 뷰 API — 검색바·버튼이 호출(노드로 이동/센터·리셋·버튼 줌).
    viewApi.current = {
      focus: (q: string) => {
        const needle = q.trim().toLowerCase();
        if (!needle) return null;
        // L-4 — 첫 매치만이 아니라 전체 매치를 모아 Enter 반복 시 순회한다.
        const matches = nodes.filter((n) => !n.overflow && n.label.toLowerCase().includes(needle));
        if (!matches.length) return null;
        if (needle === searchNeedle) searchIdx = (searchIdx + 1) % matches.length;
        else {
          searchNeedle = needle;
          searchIdx = 0;
        }
        const target = matches[searchIdx]!;
        userView = true;
        const k = 1.9;
        view.k = k;
        view.x = cw / 2 - k * (tf.ox + target.x * tf.scale);
        view.y = ch / 2 - k * (tf.oy + target.y * tf.scale);
        setSel({
          id: target.id,
          kind: target.kind,
          label: target.label,
          itemId: target.itemId,
          done: target.done,
          total: target.total,
          tone: target.tone,
        });
        draw();
        return { i: searchIdx + 1, n: matches.length };
      },
      reset: () => {
        userView = false;
        view.k = 1;
        view.x = 0;
        view.y = 0;
        draw();
      },
      zoom: (factor: number) => zoomAt(cw / 2, ch / 2, factor),
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
    if (reduce.matches) {
      // L-2 — step은 O(N²)라 N=400에서 320회면 ~25M 연산(수백ms 메인스레드 프리즈).
      // 반복수를 노드 수에 반비례로 캡해 모션민감 사용자의 초기화 프리즈를 막는다(정착 품질은 유지).
      const iters = Math.min(320, Math.floor(40000 / Math.max(1, nodes.length)));
      for (let i = 0; i < iters; i++) step(0.9 * Math.pow(0.99, i));
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
  const runSearch = (q: string) => {
    const r = viewApi.current?.focus(q) ?? null;
    setNoHit(!r && q.trim().length > 0);
    setMatchHint(r);
  };

  const ariaLabel = `지식맵 — 항목 ${items.length}개, 챕터 ${doneCh}/${totalCh} 완료${semEdges.length ? `, 의미 연결 ${semEdges.length}개` : ''}`;

  return (
    <section className={g.wrap} aria-label="지식맵">
      {items.length === 0 ? (
        <div className={g.emptyHost}>
          <EmptyState
            glyph="🕸"
            title="아직 지식맵이 비어 있어요"
            desc={
              <>
                학습 항목을 추가하면 지식맵이 그려져요. 항목은 <b>허브</b>, 챕터는 <b>잎</b>으로 이어져 무엇을 얼마나
                익혔는지 한눈에 보입니다.
              </>
            }
            actions={
              <Button variant="primary" onClick={() => navigate('/items', { viewTransition: true })}>
                + 학습 항목 추가
              </Button>
            }
          />
        </div>
      ) : (
        <div className={g.canvasHost} ref={wrapRef}>
          {/* 검색 + 줌 컨트롤 — 우상단 오버레이. 캔버스는 SR 불투명이라 여기 컨트롤이 접근 경로. */}
          <div className={g.controls}>
            <input
              className={g.search}
              type="search"
              value={query}
              placeholder="개념·챕터 찾기…"
              aria-label="지식맵 노드 검색"
              onChange={(e) => {
                setQuery(e.target.value);
                setNoHit(false);
                setMatchHint(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') runSearch(query);
              }}
            />
            <button type="button" className={g.ctrlBtn} aria-label="찾기" onClick={() => runSearch(query)}>
              ⌕
            </button>
            <button type="button" className={g.ctrlBtn} aria-label="확대" onClick={() => viewApi.current?.zoom(1.3)}>
              ＋
            </button>
            <button
              type="button"
              className={g.ctrlBtn}
              aria-label="축소"
              onClick={() => viewApi.current?.zoom(1 / 1.3)}
            >
              －
            </button>
            <button
              type="button"
              className={g.ctrlBtn}
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
            <div className={g.searchMiss} role="status">
              “{query}” 노드를 못 찾았어요
            </div>
          )}
          {matchHint && (
            <div className={g.searchHint} role="status" aria-label={`매치 ${matchHint.i} / ${matchHint.n}`}>
              {matchHint.i}/{matchHint.n}
              {matchHint.n > 1 ? <span className={g.searchHintTip}> · Enter로 다음</span> : null}
            </div>
          )}
          <div className={g.legend}>
            <span>
              <i className={g.lHub} /> 항목(허브·색=과목)
            </span>
            <span>
              <i style={{ background: 'var(--good)' }} /> 숙달
            </span>
            <span>
              <i style={{ background: 'var(--learning)' }} /> 학습중
            </span>
            <span>
              <i style={{ background: 'var(--mut)' }} /> 미착수
            </span>
            {semEdges.length > 0 ? (
              <span>
                <i className={g.lSem} /> 의미 연결(자동)
              </span>
            ) : semStatus === 'unavailable' ? (
              <span
                className={g.legendMut}
                title="serve.js + Ollama 임베딩 모델이 있으면 과목 경계를 넘는 의미 연결이 자동으로 그려져요"
              >
                <i className={g.lSem} /> 의미 연결 — Ollama 필요
              </span>
            ) : null}
          </div>
          <canvas ref={canvasRef} className={g.canvas} role="img" aria-label={ariaLabel} />
          {/* 툴팁 — 항상 마운트, 위치·텍스트·표시는 포인터 핸들러가 ref로 직접 갱신(리렌더 없음). */}
          <div ref={tipRef} className={g.tip} role="tooltip" aria-hidden="true" />
          {/* B6 — 노드 클릭 상세: 챕터의 상태·마지막 학습(간격반복)·점프. */}
          {sel && (
            <div className={g.detail} role="dialog" aria-label={`${sel.label} 상세`}>
              <button type="button" className={g.detailX} onClick={() => setSel(null)} aria-label="닫기">
                ✕
              </button>
              <div className={g.detailKind}>{sel.kind === 'hub' ? '학습 항목' : '챕터'}</div>
              <div className={g.detailName}>{sel.label}</div>
              {sel.kind === 'hub' ? (
                <>
                  <div className={g.detailRow}>
                    진행{' '}
                    <b>
                      {sel.done ?? 0}/{sel.total ?? 0}
                    </b>{' '}
                    챕터
                  </div>
                  {hubRisk > 0 && (
                    <div className={g.detailRow} data-risk="overdue">
                      복습 위험 <b>{hubRisk}개</b>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className={g.detailRow}>
                    상태 <b>{sel.tone === 'done' ? '숙달' : sel.tone === 'learning' ? '학습중' : '미착수'}</b>
                  </div>
                  {leafRv ? (
                    <div className={g.detailRow} data-risk={leafRv.risk}>
                      마지막 학습 <b>{leafRv.daysSince}일 전</b> ·{' '}
                      {leafRv.risk === 'overdue' ? '복습 시급' : leafRv.risk === 'due' ? '복습 권장' : '최근'}
                    </div>
                  ) : (
                    <div className={`${g.detailRow} ${g.detailMut}`}>완료된 학습 기록이 아직 없어요</div>
                  )}
                </>
              )}
              <div className={g.detailActions}>
                <button
                  type="button"
                  className={g.detailBtn}
                  onClick={() => navigate('/items', { viewTransition: true })}
                >
                  학습 항목 열기 →
                </button>
                {(hubRisk > 0 || (leafRv && leafRv.risk !== 'fresh')) && (
                  <button
                    type="button"
                    className={g.detailBtn}
                    onClick={() => navigate('/review', { viewTransition: true })}
                  >
                    복습 위험 보기 →
                  </button>
                )}
                {/* E-5: 볼트 딥링크 — obsidian://search는 볼트명 없이도 동작(설치돼 있으면). */}
                <button
                  type="button"
                  className={g.detailBtn}
                  onClick={() => window.open('obsidian://search?query=' + encodeURIComponent(sel.label))}
                  title="Obsidian에서 이 개념 검색 (설치돼 있어야 함)"
                >
                  🔎 볼트에서 찾기
                </button>
                {/* E-5: Anki는 신뢰 가능한 데스크톱 URL 스킴이 없어 연동 탭(덱 상태·내보내기)으로 안내. */}
                <button
                  type="button"
                  className={g.detailBtn}
                  onClick={() => navigate('/integrations', { viewTransition: true })}
                  title="Anki 덱 상태·카드 내보내기"
                >
                  📇 Anki 연동 →
                </button>
              </div>
            </div>
          )}
          {/* 스크린리더 대체 — 캔버스는 불투명하므로 항목별 done/total을 목록으로 병행 제공. */}
          <ul className={g.srOnly}>
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
