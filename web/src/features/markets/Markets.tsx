/* ============================================================
   Markets(증시 동향) — 탭: 📈 브리핑 대시보드.
   ① 지수 보드 — 전세계 주요 지수의 오늘 등락(지역별 카드 + 미니 스파크라인).
   ② 뉴스 피드 — "왜 움직였나"를 다루는 금융 칼럼·뉴스(원문 링크 + 발췌, 요약 아님).
   ③ 온디맨드 AI 브리핑 — 버튼을 누르면 그날 지수+헤드라인을 묶어 로컬 Ollama가 해설(자동 실행 X).
   데이터는 serve.js가 수집(지연·EOD일 수 있음). 꺼져 있거나 미수집이면 우아 안내.
   ⚠ 상승=초록/하락=빨강(글로벌 관례)이되, 방향은 ▲▼ 글리프+부호+aria-label로도 표기(색 비의존).
============================================================ */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { useMarkets, usePing } from '@/store/queries';
import { runTool, marketsBrief, type MarketBriefResult } from '@/lib/api';
import { indexStats, groupByRegion, fmtPct, dir, type IndexQuote, type NewsItem } from '@/lib/markets';
import { useFocusTrap } from '@/lib/useFocusTrap';
import { todayISO } from '@/lib/utils';
import EmptyState from '@/components/EmptyState';
import { Button } from '@/components/ui';
import { ui } from '@/shell';
import ds from '@/styles/ds.module.css';
import m from './Markets.module.css';

const DIR_GLYPH = { up: '▲', down: '▼', flat: '＝' } as const;
const DIR_WORD = { up: '상승', down: '하락', flat: '보합' } as const;

export default function Markets() {
  const markets = useMarkets();
  const { data: ping, isLoading: pingLoading } = usePing();
  const online = !!ping?.ok;

  const indices = useMemo(() => markets.data?.indices ?? [], [markets.data]);
  const news = useMemo(() => markets.data?.news ?? [], [markets.data]);
  const st = indexStats(indices);
  const lead = indices.find((i) => i.symbol === '^KS11') ?? indices[0];

  // 리드아웃 — 상단 바에 상승/하락·대표지수·서버상태·수집시각.
  usePageChromeEffect(
    () => ({
      readouts: [
        { label: '상승·하락', value: `${st.up}↑ ${st.down}↓`, accent: true },
        ...(lead ? [{ label: lead.name, value: fmtPct(lead.changePct) }] : []),
        { label: 'serve.js', value: online ? '● ON' : pingLoading ? '…' : 'OFF' },
        ...(markets.data?.at ? [{ label: '수집', value: markets.data.at.slice(5, 16).replace('T', ' ') }] : []),
      ],
    }),
    [st.up, st.down, lead?.name, lead?.changePct, online, pingLoading, markets.data?.at],
  );

  const [collecting, setCollecting] = useState(false);
  // silent=자동 수집(탭 열 때 오늘 데이터가 없으면) — 성공 토스트를 띄우지 않는다.
  const collect = useCallback(
    async (silent = false) => {
      if (collecting) return;
      setCollecting(true);
      try {
        const res = await runTool('markets-collect', {});
        if (res.ok) {
          await markets.refetch();
          if (!silent) ui.toast('증시 동향 수집 완료', 'ok');
        } else if (!silent) {
          ui.toast('수집 실패 — serve.js 출력 확인', 'bad');
        }
      } catch (e) {
        if (!silent) ui.toast('수집 요청 실패: ' + ((e as Error).message || e), 'bad');
      }
      setCollecting(false);
    },
    [collecting, markets],
  );

  // 자동 수집 — 탭을 열었을 때 온라인인데 데이터가 없거나 '오늘 것'이 아니면 알아서 채운다(대시보드처럼
  // 늘 최신으로 떠 있게). 장중 갱신은 상단 '수집' 버튼. 마운트당 1회만 시도(실패해도 루프 안 돎).
  const didAuto = useRef(false);
  useEffect(() => {
    if (didAuto.current || !online || markets.isLoading || collecting) return;
    const d = markets.data;
    const fresh = !!d && d.date === todayISO() && d.indices.length > 0;
    if (fresh) return;
    didAuto.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 탭 열 때 오늘 데이터 없으면 1회 자동 수집(의도적).
    void collect(true);
  }, [online, markets.isLoading, markets.data, collecting, collect]);

  // ── 온디맨드 AI 브리핑(오버레이 다이얼로그) ──────────────────────
  const [briefOpen, setBriefOpen] = useState(false);
  const [briefBusy, setBriefBusy] = useState(false);
  const [brief, setBrief] = useState<MarketBriefResult | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(briefOpen, panelRef);

  useEffect(() => {
    if (!briefOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBriefOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [briefOpen]);

  const askBrief = useCallback(async () => {
    setBriefOpen(true);
    if (briefBusy || brief) return; // 이미 받았으면 재사용(자동 재호출 안 함)
    setBriefBusy(true);
    try {
      const res = await marketsBrief(
        indices.map((i) => ({ name: i.name, symbol: i.symbol, changePct: i.changePct, price: i.price })),
        news.map((n) => ({ title: n.title, source: n.source })),
      );
      if (res.ok && res.brief) setBrief(res.brief);
      else ui.toast(res.error || '브리핑 실패', 'bad');
    } catch (e) {
      ui.toast('AI 브리핑 실패: ' + ((e as Error).message || e), 'bad');
    }
    setBriefBusy(false);
  }, [briefBusy, brief, indices, news]);

  const regions = useMemo(() => groupByRegion(indices), [indices]);

  // ── 빈/오프라인 상태 ─────────────────────────────────────────
  if (!indices.length && !news.length) {
    if (markets.isLoading || pingLoading) {
      return (
        <section className={m.wrap} aria-label="증시 동향">
          <div className={m.loading}>증시 동향 불러오는 중…</div>
        </section>
      );
    }
    return (
      <section className={m.wrap} aria-label="증시 동향">
        <div className={m.emptyHost}>
          {!online ? (
            <EmptyState
              glyph="📈"
              title="serve.js가 꺼져 있어요"
              desc={
                <>
                  증시 동향은 로컬 서버가 수집해요. 러닝허브 폴더에서 <code>node serve.js</code>로 켜면 전세계 지수
                  등락과 금융 뉴스를 가져옵니다. 피드 설정: <code>러닝허브/_증시/feeds.json</code>
                </>
              }
            />
          ) : (
            <EmptyState
              glyph="📈"
              title="아직 수집된 증시 데이터가 없어요"
              desc="전세계 주요 지수의 오늘 등락과, 왜 그렇게 움직였는지 다루는 금융 뉴스·칼럼을 가져올게요."
              actions={
                <Button variant="primary" onClick={() => collect()} disabled={collecting}>
                  {collecting ? (
                    <>
                      <span className={ds.spin} /> 수집 중…
                    </>
                  ) : (
                    '증시 동향 수집 시작'
                  )}
                </Button>
              }
            />
          )}
        </div>
      </section>
    );
  }

  return (
    <section className={m.wrap} aria-label="증시 동향">
      {/* 헤더 — 날짜/지연 안내 + 수집 + AI 브리핑 */}
      <header className={m.head}>
        <div className={m.headInfo}>
          <h2 className={m.headTitle}>증시 동향</h2>
          <span className={m.headNote}>지수는 지연·최근 종가 기준일 수 있어요 · 뉴스는 원문 링크</span>
        </div>
        <div className={m.headActions}>
          <button
            type="button"
            className={m.collectBtn}
            onClick={() => collect()}
            disabled={collecting || !online}
            title={online ? '새로 수집' : 'serve.js가 꺼져 있어요'}
          >
            {collecting ? <span className={ds.spin} /> : '↻'} 수집
          </button>
          <Button variant="primary" sm onClick={askBrief} disabled={!online || !indices.length}>
            🤖 오늘 왜 움직였나
          </Button>
        </div>
      </header>

      <div className={m.cols}>
        {/* 지수 보드 — 지역별 카드 그리드 */}
        <div className={m.board}>
          {regions.map(([region, list]) => (
            <section key={region} className={m.region} aria-label={region}>
              <h3 className={m.regionName}>{region}</h3>
              <div className={m.grid}>
                {list.map((i) => (
                  <IndexCard key={i.symbol} q={i} />
                ))}
              </div>
            </section>
          ))}
          {!indices.length && <div className={m.boardEmpty}>지수 데이터를 가져오지 못했어요(뉴스만 표시).</div>}
        </div>

        {/* 뉴스 피드 — "왜 움직였나" 칼럼·뉴스 */}
        <aside className={m.feed} aria-label="금융 뉴스">
          <h3 className={m.feedTitle}>왜 이렇게 움직였나 · 뉴스·칼럼</h3>
          {news.length ? (
            <ul className={m.newsList}>
              {news.map((n) => (
                <NewsCard key={n.id} n={n} />
              ))}
            </ul>
          ) : (
            <div className={m.boardEmpty}>수집된 뉴스가 없어요.</div>
          )}
        </aside>
      </div>

      {/* 온디맨드 AI 브리핑 다이얼로그 */}
      {briefOpen && (
        <div
          className={m.overlay}
          role="dialog"
          aria-modal="true"
          aria-label="오늘의 증시 브리핑"
          onClick={(e) => {
            if (e.target === e.currentTarget) setBriefOpen(false);
          }}
        >
          <div className={m.panel} ref={panelRef}>
            <div className={m.panelHead}>
              <span className={m.panelTitle}>🤖 오늘의 증시 브리핑</span>
              <button type="button" className={m.panelClose} onClick={() => setBriefOpen(false)} aria-label="닫기">
                ✕
              </button>
            </div>
            {briefBusy ? (
              <div className={m.panelBusy}>
                <span className={ds.spin} /> 그날 지수와 뉴스를 엮는 중…
              </div>
            ) : brief ? (
              <div className={m.panelBody}>
                {brief.overview && <p className={m.briefOverview}>{brief.overview}</p>}
                {brief.drivers?.length ? (
                  <div className={m.briefGroup}>
                    <span className={m.briefLabel}>오늘의 동인</span>
                    <ul className={m.driverList}>
                      {brief.drivers.map((d, i) => (
                        <li key={i}>
                          <b>{d.title}</b>
                          {d.detail ? <span> — {d.detail}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {brief.watch?.length ? (
                  <div className={m.briefGroup}>
                    <span className={m.briefLabel}>지켜볼 점</span>
                    <ul className={m.watchList}>
                      {brief.watch.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {brief.caveat && <p className={m.briefCaveat}>{brief.caveat}</p>}
              </div>
            ) : (
              <div className={m.panelBusy}>브리핑을 불러오지 못했어요.</div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/** 지수 카드 1장 — 현재가 + ▲▼ + 부호% + 스파크라인. 색은 방향, 정보는 색 비의존. */
function IndexCard({ q }: { q: IndexQuote }) {
  const d = dir(q.changePct);
  const price = q.price.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  return (
    <div
      className={m.card}
      data-dir={d}
      aria-label={`${q.name}, ${DIR_WORD[d]} ${Math.abs(q.changePct).toFixed(2)}퍼센트, 현재 ${price}`}
    >
      <div className={m.cardTop}>
        <span className={m.cardName}>{q.name}</span>
        <Spark spark={q.spark} d={d} />
      </div>
      <div className={m.cardPrice}>{price}</div>
      <div className={m.cardPct} data-dir={d}>
        <span aria-hidden="true">{DIR_GLYPH[d]}</span> {fmtPct(q.changePct)}
      </div>
    </div>
  );
}

/** 미니 스파크라인(최근 종가) — 의존성 없는 인라인 SVG polyline. */
function Spark({ spark, d }: { spark: number[]; d: 'up' | 'down' | 'flat' }) {
  if (!spark || spark.length < 2) return <span className={m.sparkEmpty} aria-hidden="true" />;
  const W = 56;
  const H = 20;
  const min = Math.min(...spark);
  const max = Math.max(...spark);
  const span = max - min || 1;
  const pts = spark
    .map((v, i) => {
      const x = (i / (spark.length - 1)) * W;
      const y = H - ((v - min) / span) * H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg className={m.spark} width={W} height={H} viewBox={`0 0 ${W} ${H}`} data-dir={d} aria-hidden="true">
      <polyline points={pts} fill="none" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** 뉴스 1장 — 출처·시각·제목(원문 링크)·발췌. */
function NewsCard({ n }: { n: NewsItem }) {
  return (
    <li className={m.newsItem}>
      <a className={m.newsLink} href={n.url} target="_blank" rel="noreferrer noopener">
        <div className={m.newsMeta}>
          <span className={m.newsSource}>{n.source}</span>
          {n.field ? <span className={m.newsField}>{n.field}</span> : null}
          <span className={m.newsGo} aria-hidden="true">
            ↗
          </span>
        </div>
        <div className={m.newsTitle}>{n.title}</div>
        {n.summary ? <div className={m.newsSummary}>{n.summary}</div> : null}
      </a>
    </li>
  );
}
