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

  // 툴팁 — 호버 노드 요약(허브=이름·완료/전체, 잎=이름). 위치는 커서 추종.
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  // B6 — 클릭 선택 노드(상세 패널). 챕터 잎이면 간격반복 위험까지 보여준다.
  const [sel, setSel] = useState<SelInfo | null>(null);

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

    const { nodes, links } = buildGraph(items);
    if (!nodes.length) return;
    const byId = new Map<string, SimNode>(nodes.map((n) => [n.id, n]));
    const idxById = new Map<string, number>(nodes.map((n, i) => [n.id, i]));

    let palette = readPalette();
    let cw = 0;
    let ch = 0;
    let dpr = 1;
    // 화면 자동맞춤 변환(월드→스크린) — 히트테스트 역변환에 재사용.
    let tf = { scale: 1, ox: 0, oy: 0 };
    let dragId: string | null = null;
    // 클릭(선택) vs 드래그 구분 — pointerdown~up 사이 이동이 미미하면 '클릭'으로 상세 패널을 연다.
    let downId: string | null = null;
    let downX = 0;
    let downY = 0;
    let moved = false;

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
    const sx = (x: number) => tf.ox + x * tf.scale;
    const sy = (y: number) => tf.oy + y * tf.scale;
    const draw = () => {
      computeTransform();
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
      // 노드
      for (const n of nodes) {
        const r = n.radius * Math.min(1.4, Math.max(0.7, tf.scale));
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
      // 허브 라벨(잎은 툴팁으로 — 라벨 폭주 방지)
      ctx.fillStyle = palette.txt;
      ctx.font = '600 12px var(--font-sans, sans-serif)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (const n of nodes) {
        if (n.kind !== 'hub') continue;
        const r = n.radius * Math.min(1.4, Math.max(0.7, tf.scale));
        ctx.fillText(n.label, sx(n.x), sy(n.y) + r + 3);
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
      const wx = (clientX - rect.left - tf.ox) / tf.scale;
      const wy = (clientY - rect.top - tf.oy) / tf.scale;
      let best: SimNode | null = null;
      let bestD = Infinity;
      for (const n of nodes) {
        const dx = n.x - wx;
        const dy = n.y - wy;
        const d = dx * dx + dy * dy;
        const rr = (n.radius + 6) * (n.radius + 6);
        if (d <= rr && d < bestD) {
          bestD = d;
          best = n;
        }
      }
      return best;
    };
    const tipText = (n: SimNode) => (n.kind === 'hub' ? `${n.label} · ${n.done ?? 0}/${n.total ?? 0} 챕터` : n.label);

    // ── 포인터(호버 툴팁 + 드래그) ─────────────────────────────────────────
    const onDown = (e: PointerEvent) => {
      const n = hit(e.clientX, e.clientY);
      if (!n) {
        setSel(null); // 빈 공간 클릭 → 선택 해제
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
      if (dragId != null) {
        const n = byId.get(dragId);
        if (n) {
          if (!moved && Math.hypot(e.clientX - downX, e.clientY - downY) > 4) moved = true;
          n.x = (e.clientX - rect.left - tf.ox) / tf.scale;
          n.y = (e.clientY - rect.top - tf.oy) / tf.scale;
          n.vx = 0;
          n.vy = 0;
          if (reduce.matches) draw();
          else ensureLoop();
          setTip({ x: e.clientX - rect.left, y: e.clientY - rect.top, text: tipText(n) });
        }
        return;
      }
      const n = hit(e.clientX, e.clientY);
      canvas.style.cursor = n ? 'grab' : 'default';
      setTip(n ? { x: e.clientX - rect.left, y: e.clientY - rect.top, text: tipText(n) } : null);
    };
    const onUp = (e: PointerEvent) => {
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
      downId = null;
      moved = false;
    };
    const onLeave = () => {
      if (dragId == null) setTip(null);
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
    document.addEventListener('visibilitychange', onVis);
    reduce.addEventListener('change', onTheme);

    // 초기화 — 모션 비선호면 동기로 정착시킨 뒤 1회 그림. 아니면 RAF 루프.
    resize();
    if (reduce.matches) {
      for (let i = 0; i < 320; i++) step(0.9 * Math.pow(0.99, i));
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
      document.removeEventListener('visibilitychange', onVis);
      reduce.removeEventListener('change', onTheme);
    };
  }, [items]);

  const ariaLabel = `지식맵 — 항목 ${items.length}개, 챕터 ${doneCh}/${totalCh} 완료`;

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
          <div className={g.legend} aria-hidden="true">
            <span>
              <i className={g.lHub} /> 항목(허브)
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
          </div>
          <canvas ref={canvasRef} className={g.canvas} role="img" aria-label={ariaLabel} />
          {tip && (
            <div className={g.tip} style={{ left: tip.x, top: tip.y }} role="tooltip">
              {tip.text}
            </div>
          )}
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
