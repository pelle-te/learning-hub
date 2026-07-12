/* ============================================================
   Markets(증시 동향) — 탭: 📈 브리핑 대시보드.
   ① 지수 보드 — 전세계 주요 지수의 오늘 등락(지역별 카드 + 미니 스파크라인).
   ② 뉴스 피드 — "왜 움직였나"를 다루는 금융 칼럼·뉴스(원문 링크 + 발췌, 요약 아님).
   ③ 온디맨드 AI 브리핑 — 버튼을 누르면 그날 지수+헤드라인을 묶어 로컬 Ollama가 해설(자동 실행 X).
   데이터는 serve.js가 수집(지연·EOD일 수 있음). 꺼져 있거나 미수집이면 우아 안내.
   ⚠ 상승=초록/하락=빨강(글로벌 관례)이되, 방향은 ▲▼ 글리프+부호+aria-label로도 표기(색 비의존).
============================================================ */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { useMarkets, usePing } from '@/store/queries';
import { marketsBrief, type MarketBriefResult } from '@/lib/api';
import { indexStats, groupByRegion, fmtPct, dir, fmtPublished, type IndexQuote, type NewsItem } from '@/lib/markets';
import { classifyArtifact, artifactErrorMessage } from '@/lib/artifactState';
import { todayISO } from '@/lib/utils';
import ArtifactGate from '@/components/ArtifactGate';
import ArtifactError from '@/components/ArtifactError';
import DetailDrawer from '@/components/DetailDrawer';
import { useCollectTool, useAutoCollect } from '@/components/useCollectTool';
import { useAiStream } from '@/components/useAiStream';
import { Button, Skeleton } from '@/components/ui';
import { ui } from '@/shell';
import { useApp } from '@/store/useApp';
import { addBacklog } from '@/lib/methodology';
import { backlogFromNews, PROMOTE_TOAST } from '@/lib/promote';
import ds from '@/styles/ds.module.css';
import m from './Markets.module.css';

const DIR_GLYPH = { up: '▲', down: '▼', flat: '＝' } as const;
const DIR_WORD = { up: '상승', down: '하락', flat: '보합' } as const;
// 리드 지표 심볼 — 상단 리드아웃의 대표 지수(국내 투자자 기준 KOSPI). 수집 피드(_증시/feeds.json)에
// 이 심볼이 있어야 표시되고, 피드에서 빠지면 첫 지수로 무음 폴백한다(피드↔리드아웃 커플링).
const LEAD_SYMBOL = '^KS11';
// 승격 중복방지 안정 키 — 뉴스 고유 id, 없으면 url/title로 폴백(promoteNews와 NewsCard 잠금이 공유).
const newsKey = (n: NewsItem) => n.id || n.url || n.title;

export default function Markets() {
  const markets = useMarkets();
  const { data: ping, isLoading: pingLoading, refetch: refetchPing } = usePing();
  const online = !!ping?.ok;

  const indices = useMemo(() => markets.data?.indices ?? [], [markets.data]);
  const news = useMemo(() => markets.data?.news ?? [], [markets.data]);
  const st = useMemo(() => indexStats(indices), [indices]);
  const mutate = useApp((s) => s.mutate);

  // B5 — '학습으로 보내기': 헤드라인을 보충 백로그로 승격. 소비(증시)→학습을 잇는다.
  // 중복 승격 방지 — 이 세션에 이미 보낸 헤드라인은 버튼을 '보냄'으로 잠근다(반복 클릭=중복 백로그).
  const [promoted, setPromoted] = useState<ReadonlySet<string>>(() => new Set());
  const promoteNews = useCallback(
    (n: NewsItem) => {
      const key = newsKey(n);
      if (promoted.has(key)) return;
      const seed = backlogFromNews(n);
      mutate((state) => addBacklog(state, '', seed.name, seed.topic, seed.note));
      setPromoted((prev) => new Set(prev).add(key));
      ui.toast(PROMOTE_TOAST, 'ok');
    },
    [mutate, promoted],
  );
  const lead = indices.find((i) => i.symbol === LEAD_SYMBOL) ?? indices[0];

  // 리드아웃 — 상단 바에 상승/하락·대표지수·서버상태·수집시각.
  usePageChromeEffect(
    () => ({
      readouts: [
        { label: '상승·하락·보합', value: `${st.up}↑ ${st.down}↓ ${st.flat}＝`, accent: true },
        ...(lead ? [{ label: lead.name, value: fmtPct(lead.changePct) }] : []),
        { label: 'serve.js', value: online ? '● ON' : pingLoading ? '…' : 'OFF' },
        ...(markets.data?.at ? [{ label: '수집', value: markets.data.at.slice(5, 16).replace('T', ' ') }] : []),
      ],
    }),
    [st.up, st.down, st.flat, lead?.name, lead?.changePct, online, pingLoading, markets.data?.at],
  );

  // ── 온디맨드 AI 브리핑 상태(스트리밍) ──────────────────────────
  // busy·preview·AbortController·onDelta 수명은 useAiStream이 소유(SR-15). 결과·열림·오류는 여기 유지(누수 방지).
  const brief = useAiStream();
  const [briefOpen, setBriefOpen] = useState(false);
  const [briefErr, setBriefErr] = useState<string | null>(null);
  const [briefResult, setBriefResult] = useState<MarketBriefResult | null>(null);
  // 브리핑이 도착하면 결과 카드로 포커스 이동 — 전체를 role=status로 장황하게 읽지 않고 간결히 알림.
  const briefResultRef = useRef<HTMLDivElement>(null);

  // silent=자동 수집(탭 열 때 오늘 데이터가 없으면) — 성공 토스트를 띄우지 않는다.
  const { collecting, collect: collectRaw } = useCollectTool('markets-collect', markets.refetch, '증시 동향 수집 완료');
  const collect = useCallback(
    async (silent = false) => {
      // 수집이 데이터를 갈면 옛 브리핑은 다른 날의 해설 — 무효화해 다음 열람 때 새로 받는다.
      if (await collectRaw(silent)) setBriefResult(null);
    },
    [collectRaw],
  );

  // 자동 수집 — 탭을 열었을 때 온라인인데 데이터가 없거나 '오늘 것'이 아니면 알아서 채운다(대시보드처럼
  // 늘 최신으로 떠 있게). 장중 갱신은 상단 '수집' 버튼. 마운트당 1회만 시도(useAutoCollect가 didAuto 소유, SR-13).
  const d = markets.data;
  const fresh = !!d && d.date === todayISO() && d.indices.length > 0;
  useAutoCollect(collect, { online, isLoading: markets.isLoading, collecting, fresh });

  // AI 브리핑 요청 — 스트리밍(토큰 미리보기) + 취소 가능. 이미 받은 브리핑은 재사용(수집이 무효화).
  const askBrief = useCallback(async () => {
    setBriefOpen(true);
    if (brief.busy || briefResult) return;
    setBriefErr(null);
    const idxArgs = indices.map((i) => ({ name: i.name, symbol: i.symbol, changePct: i.changePct, price: i.price }));
    const newsArgs = news.map((n) => ({ title: n.title, source: n.source }));
    const res = await brief.run((o) => marketsBrief(idxArgs, newsArgs, o));
    if (res.ok) {
      if (res.value.ok && res.value.brief) setBriefResult(res.value.brief);
      else setBriefErr(res.value.error || '브리핑 실패');
    } else if (!res.aborted) {
      setBriefErr('AI 브리핑 실패: ' + res.error);
    }
  }, [brief, briefResult, indices, news]);

  // 닫으면 진행 중 생성도 중단(서버가 업스트림을 끊어 Ollama 생성 자체가 멈춘다).
  const closeBrief = useCallback(() => {
    brief.cancel();
    setBriefOpen(false);
  }, [brief]);

  // 브리핑 결과가 오면 결과 카드로 포커스 이동(드로어가 열려 있을 때만).
  useEffect(() => {
    if (briefResult && briefOpen) briefResultRef.current?.focus();
  }, [briefResult, briefOpen]);

  const regions = useMemo(() => groupByRegion(indices), [indices]);
  // 뉴스 분야 필터 — 피드가 길어지면 관심 분야만. 등장 순서로 고유 분야 수집.
  const [newsField, setNewsField] = useState('');
  const newsFields = useMemo(() => {
    const seen: string[] = [];
    for (const n of news) if (n.field && !seen.includes(n.field)) seen.push(n.field);
    return seen;
  }, [news]);
  const shownNews = useMemo(() => (newsField ? news.filter((n) => n.field === newsField) : news), [news, newsField]);

  // ── 빈/오프라인 상태 ─────────────────────────────────────────
  if (!indices.length && !news.length) {
    // 표시 단계는 공용 SSOT(classifyArtifact) — reads·mastery와 같은 규칙.
    const phase = classifyArtifact({
      hasData: false,
      loading: markets.isLoading || pingLoading || (collecting && online),
      query: { isError: markets.isError, error: markets.error },
      ping: { ok: online },
    });
    if (phase === 'loading') {
      // 지수 카드 형상 스켈레톤 — 무엇이 올지 예고하고 팝인 레이아웃 점프를 없앤다.
      return (
        <section className={m.wrap} aria-label="증시 동향">
          <span className={m.srOnly} role="status">
            증시 동향 불러오는 중…
          </span>
          <div className={m.skeleBoard} aria-hidden="true">
            <Skeleton width={120} height={14} />
            <div className={m.grid}>
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className={m.skeleCard}>
                  <Skeleton width="55%" height={13} />
                  <Skeleton width="70%" height={20} />
                  <Skeleton width="38%" height={13} />
                </div>
              ))}
            </div>
          </div>
        </section>
      );
    }
    // 서버는 살아 있는데 진짜 실패(미생성 계열 아님) — '미수집'과 구분해 실제 오류를 노출.
    if (phase === 'error') {
      const errorMessage = artifactErrorMessage(markets.error);
      return (
        <section className={m.wrap} aria-label="증시 동향">
          <div className={m.emptyHost}>
            <ArtifactError label="증시 데이터를" detail={errorMessage} onRetry={() => void markets.refetch()} />
          </div>
        </section>
      );
    }
    return (
      <section className={m.wrap} aria-label="증시 동향">
        <div className={m.emptyHost}>
          <ArtifactGate
            online={online}
            onRetry={() => {
              void refetchPing();
              void markets.refetch();
            }}
            glyph="📈"
            offlineDesc={
              <>
                증시 동향은 로컬 서버가 수집해요. 러닝허브 폴더에서 <code>node serve.js</code>로 켜면 전세계 지수 등락과
                금융 뉴스를 가져옵니다. 피드 설정: <code>러닝허브/_증시/feeds.json</code>
              </>
            }
            emptyTitle="아직 수집된 증시 데이터가 없어요"
            emptyDesc="전세계 주요 지수의 오늘 등락과, 왜 그렇게 움직였는지 다루는 금융 뉴스·칼럼을 가져올게요."
            collecting={collecting}
            onCollect={() => void collect()}
            collectLabel="증시 동향 수집 시작"
          />
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
          <Button
            sm
            onClick={() => void collect()}
            disabled={collecting || !online}
            title={online ? '새로 수집' : 'serve.js가 꺼져 있어요'}
          >
            {collecting ? <span className={ds.spin} /> : '↻'} 수집
          </Button>
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
          <div className={m.feedHead}>
            <h3 className={m.feedTitle}>왜 이렇게 움직였나 · 뉴스·칼럼</h3>
            {newsFields.length > 1 && (
              <select
                className={m.feedFilter}
                value={newsField}
                onChange={(e) => setNewsField(e.target.value)}
                aria-label="뉴스 분야 필터"
              >
                <option value="">전체 분야</option>
                {newsFields.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            )}
          </div>
          {shownNews.length ? (
            <ul className={m.newsList}>
              {shownNews.map((n) => (
                <NewsCard key={n.id} n={n} onPromote={promoteNews} promoted={promoted} />
              ))}
            </ul>
          ) : (
            <div className={m.boardEmpty}>{news.length ? '이 분야의 뉴스가 없어요.' : '수집된 뉴스가 없어요.'}</div>
          )}
        </aside>
      </div>

      {/* 온디맨드 AI 브리핑 — 공용 DetailDrawer(포커스 트랩·Esc·바깥클릭·복원 일원화) */}
      <DetailDrawer open={briefOpen} onClose={closeBrief} title="🤖 오늘의 증시 브리핑">
        {brief.busy ? (
          <>
            <div className={m.panelBusy} role="status">
              <span className={ds.spin} /> {brief.preview ? '해설을 쓰는 중…' : '그날 지수와 뉴스를 엮는 중…'}
            </div>
            {/* 스트리밍 미리보기 — 완성된 문장부터 타이핑되듯 나타난다(SR에는 위 status만 공지). */}
            {brief.preview && (
              <p className={m.briefStream} aria-hidden="true">
                {brief.preview}
              </p>
            )}
          </>
        ) : briefResult ? (
          <div ref={briefResultRef} tabIndex={-1} aria-label="오늘의 증시 브리핑 결과">
            {briefResult.overview && <p className={m.briefOverview}>{briefResult.overview}</p>}
            {briefResult.drivers?.length ? (
              <div className={m.briefGroup}>
                <span className={m.briefLabel}>오늘의 동인</span>
                <ul className={m.driverList}>
                  {briefResult.drivers.map((d, i) => (
                    <li key={i}>
                      <b>{d.title}</b>
                      {d.detail ? <span> — {d.detail}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {briefResult.watch?.length ? (
              <div className={m.briefGroup}>
                <span className={m.briefLabel}>지켜볼 점</span>
                <ul className={m.watchList}>
                  {briefResult.watch.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {briefResult.caveat && <p className={m.briefCaveat}>{briefResult.caveat}</p>}
            {markets.data?.at && (
              <p className={m.briefStamp}>기준 데이터: {markets.data.at.slice(0, 16).replace('T', ' ')} 수집</p>
            )}
            {/* 최신 데이터로 다시 해설 — 드로어를 닫지 않고 재생성(옛 전면 재수집 없이). */}
            <Button
              sm
              variant="ghost"
              disabled={brief.busy || !online}
              onClick={() => {
                setBriefResult(null);
                setBriefErr(null);
                void askBrief();
              }}
            >
              🔄 다시 생성
            </Button>
          </div>
        ) : (
          <div className={m.panelBusy} role="alert">
            <span>{briefErr || '브리핑을 불러오지 못했어요.'}</span>
            <Button
              sm
              onClick={() => {
                setBriefResult(null);
                setBriefErr(null);
                void askBrief();
              }}
            >
              다시 시도
            </Button>
          </div>
        )}
      </DetailDrawer>
    </section>
  );
}

/** 지수 카드 1장 — 현재가 + ▲▼ + 절대등락 + 부호% + 스파크라인. 색은 방향, 정보는 색 비의존.
    memo — 브리핑 스트리밍 중 토큰마다 보드 전체가 재조정되지 않게(SR-14, 표시 순수). */
const IndexCard = memo(function IndexCard({ q }: { q: IndexQuote }) {
  const d = dir(q.changePct);
  const price = q.price.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  // 절대 등락폭 — 부호(유니코드 마이너스) + 절대값. changePct 옆에 병기(SR-19).
  const chSign = q.change > 0 ? '+' : q.change < 0 ? '−' : '';
  const chAbs = `${chSign}${Math.abs(q.change).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}`;
  return (
    <div
      className={m.card}
      data-dir={d}
      /* role 없는 div의 aria-label은 무시된다(ARIA 1.2) — group으로 유효화 */
      role="group"
      aria-label={`${q.name}, ${DIR_WORD[d]} ${Math.abs(q.changePct).toFixed(2)}퍼센트, 현재 ${price}${q.currency ? ' ' + q.currency : ''}`}
    >
      <div className={m.cardTop}>
        <span className={m.cardName}>{q.name}</span>
        <Spark spark={q.spark} d={d} />
      </div>
      <div className={m.cardPrice}>
        {price}
        {q.currency ? <span className={m.cardCurrency}> {q.currency}</span> : null}
      </div>
      <div className={m.cardPct} data-dir={d}>
        <span aria-hidden="true">{DIR_GLYPH[d]}</span> {chAbs} ({fmtPct(q.changePct)})
      </div>
    </div>
  );
});

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

/** 뉴스 1장 — 출처·시각·제목(원문 링크)·발췌 + '학습으로 보내기'(보충 백로그 승격).
    memo — 브리핑 스트리밍 중 토큰마다 피드 전체가 재조정되지 않게(SR-14, 표시 순수). */
const NewsCard = memo(function NewsCard({
  n,
  onPromote,
  promoted,
}: {
  n: NewsItem;
  onPromote: (n: NewsItem) => void;
  promoted: ReadonlySet<string>;
}) {
  // 피드 유래 URL은 신뢰경계 밖 — javascript: 등 비-http 스킴은 링크로 만들지 않는다.
  const safeUrl = /^https?:\/\//i.test(n.url) ? n.url : undefined;
  const done = promoted.has(newsKey(n)); // 이미 승격했으면 버튼 잠금(중복 백로그 방지, SR-4)
  return (
    <li className={m.newsItem}>
      <a className={m.newsLink} href={safeUrl} target="_blank" rel="noreferrer noopener">
        <div className={m.newsMeta}>
          <span className={m.newsSource}>{n.source}</span>
          {n.field ? <span className={m.newsField}>{n.field}</span> : null}
          {fmtPublished(n.published) ? <span className={m.newsTime}>{fmtPublished(n.published)}</span> : null}
          <span className={m.newsGo} aria-hidden="true">
            ↗
          </span>
        </div>
        <div className={m.newsTitle}>{n.title}</div>
        {n.summary ? <div className={m.newsSummary}>{n.summary}</div> : null}
      </a>
      <button
        type="button"
        className={m.newsPromote}
        onClick={() => onPromote(n)}
        disabled={done}
        title={done ? '이미 백로그로 보냈어요' : '보충 백로그로 보내기'}
      >
        {done ? '✓ 보냄' : '📥 학습으로 보내기'}
      </button>
    </li>
  );
});
