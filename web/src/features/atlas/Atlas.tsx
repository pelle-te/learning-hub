/* ============================================================
   Atlas(진로 지도) — 탭: 📡 전파·통신 분야 아틀라스.
   두 층: ① 그리드(/atlas) — 대분류로 갈래를 훑는다. ② 상세(/atlas/<key>) — 전체 폭을 써서
   하는일·주력·필요역량·세부토픽·진입경로·대표기업·리소스·전망·동향·메모를 펼친다(딥링크·뒤로가기 동작).
   데이터 골격은 lib/atlas(시드) — 관심 별·메모만 로컬 영속(localStore). 동향 자동수집은 후속 단계.
   레이어: store(usePageChrome)·lib(atlas·localStore)만 소비. app/다른 feature import 금지(boundaries).
============================================================ */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { useAtlasNews, usePing } from '@/store/queries';
import { readJSON, writeJSON } from '@/lib/localStore';
import { onSync } from '@/lib/sync';
import { ATLAS_STARS_KEY as STARS_KEY, ATLAS_NOTES_KEY as NOTES_KEY } from '@/lib/sidecars';
import {
  CATEGORIES,
  FIELDS,
  atlasSummary,
  categoryOf,
  fieldByKey,
  groupByCategory,
  newTrendCount,
  newsQuery,
  type AtlasField,
} from '@/lib/atlas';
import { fmtPublished } from '@/lib/markets';
import s from './Atlas.module.css';

/** 상대일 라벨 — 0=오늘, 1=어제, 그 외 'N일 전'. */
function agoLabel(days: number): string {
  if (days <= 0) return '오늘';
  if (days === 1) return '어제';
  return `${days}일 전`;
}

export default function Atlas() {
  const { pathname } = useLocation();
  const key = pathname.split('/')[2] || ''; // /atlas/<key>
  const field = key ? fieldByKey(key) : undefined;

  const [catFilter, setCatFilter] = useState<string | null>(null);
  const [stars, setStars] = useState<Set<string>>(() => new Set(readJSON<string[]>(STARS_KEY, [])));
  const [notes, setNotes] = useState<Record<string, string>>(() => readJSON<Record<string, string>>(NOTES_KEY, {}));

  // 가져오기 복원(_local)·다른 탭 편집 → KV에서 되읽는다. 없으면 낡은 메모리 상태가
  // 다음 편집의 writeJSON에서 복원본을 통째로 덮어쓴다(메모 영구 유실 · 0단계-E ③).
  useEffect(
    () =>
      onSync((m) => {
        if (m.kind !== 'local') return;
        setStars(new Set(readJSON<string[]>(STARS_KEY, [])));
        setNotes(readJSON<Record<string, string>>(NOTES_KEY, {}));
      }),
    [],
  );

  const toggleStar = useCallback((k: string) => {
    setStars((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      writeJSON(STARS_KEY, [...next]);
      return next;
    });
  }, []);

  const setNote = useCallback((k: string, text: string) => {
    setNotes((prev) => {
      const next = { ...prev, [k]: text };
      if (!text) delete next[k];
      writeJSON(NOTES_KEY, next);
      return next;
    });
  }, []);

  // 상단 리드아웃(TopBar) — 분야 수·대분류·관심·이번 주 새 동향. 관심 수만 가변.
  const summary = useMemo(() => atlasSummary(FIELDS, stars), [stars]);
  usePageChromeEffect(
    () => ({
      readouts: [
        { label: '분야 갈래', value: summary.total },
        { label: '대분류', value: summary.categories },
        { label: '관심', value: summary.starred },
        { label: '이번 주 동향', value: summary.newTrends, accent: true },
      ],
    }),
    [summary.total, summary.categories, summary.starred, summary.newTrends],
  );

  // 동향 자동수집 — 상세를 열 때만(백엔드 사용 가능 && 필드 선택) Google 뉴스 라이브를 가져온다.
  // 훅은 조건 없이 최상위에서 호출(enabled로 게이트) — 그리드에선 enabled=false로 무동작.
  const online = usePing().data?.ok === true;
  const news = useAtlasNews(field ? newsQuery(field) : '', online);

  // ── 상세 화면(딥링크) ──────────────────────────────────
  if (field) {
    const cat = categoryOf(field);
    const on = stars.has(field.key);
    return (
      <section className={s.root}>
        <Link to="/atlas" className={s.back}>
          ← 분야 목록
        </Link>
        <header className={s.dHead}>
          <div className={s.dcat}>
            {cat?.num} {cat?.name}
          </div>
          <h1 className={s.dTitle}>{field.name}</h1>
          <p className={s.lead}>{field.one}</p>
          <button
            type="button"
            className={`${s.starBtn} ${on ? s.starBtnOn : ''}`}
            aria-pressed={on}
            onClick={() => toggleStar(field.key)}
          >
            {on ? '★ 관심 해제' : '☆ 관심 표시'}
          </button>
        </header>

        <div className={s.dGrid}>
          <Panel tick="var(--acc)" label="하는 일">
            <ul className={s.list}>
              {field.doing.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </Panel>

          <Panel tick="var(--acc2)" label="주력 포인트">
            <p className={s.prose}>{field.focus}</p>
          </Panel>

          <Panel tick="var(--acc)" label="필요 역량">
            <div className={s.chips}>
              {field.skills.map((sk) => (
                <span key={sk} className={s.tag}>
                  {sk}
                </span>
              ))}
            </div>
          </Panel>

          <Panel tick="var(--sig)" label="세부 토픽 · 키워드">
            <div className={s.chips}>
              {field.topics.map((t) => (
                <span key={t} className={`${s.tag} ${s.tagDim}`}>
                  {t}
                </span>
              ))}
            </div>
          </Panel>

          <Panel tick="var(--acc2)" label="진입 경로">
            <ol className={s.steps}>
              {field.entry.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ol>
          </Panel>

          <Panel tick="var(--acc)" label="대표 기업 · 기관 · 연구실">
            <div className={s.chips}>
              {field.orgs.map((o) => (
                <span key={o} className={s.tag}>
                  {o}
                </span>
              ))}
            </div>
          </Panel>

          <Panel tick="var(--sig)" label="학습 리소스">
            <ul className={s.resList}>
              {field.resources.map((r) => (
                <li key={r.label} className={s.resItem}>
                  <span className={s.kind}>{r.kind}</span>
                  <span>{r.label}</span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel tick="var(--fut)" label="전망">
            <div className={s.outlook}>
              <div className={s.oStat}>
                <span className={s.oK}>인력 수요</span>
                <span className={s.oV}>{field.outlook.demand}</span>
              </div>
              <div className={s.oStat}>
                <span className={s.oK}>진입 난이도</span>
                <span className={s.oV}>{field.outlook.difficulty}</span>
              </div>
              <div className={s.oStat}>
                <span className={s.oK}>성장 시점</span>
                <span className={s.oV}>{field.outlook.horizon}</span>
              </div>
            </div>
            <div className={s.futBox}>
              <p className={s.prose}>{field.future}</p>
            </div>
          </Panel>

          <Panel tick="var(--sig)" label="현재 동향 · 자동 수집" wide>
            {news.data && news.data.length > 0 ? (
              // 라이브(백엔드 사용 가능) — Google 뉴스 최신 소식.
              <>
                <div className={s.tlHead}>
                  <span className={s.live}>● 실시간 · Google 뉴스</span>
                  <button type="button" className={s.refresh} onClick={() => news.refetch()}>
                    새로고침
                  </button>
                </div>
                <ul className={s.tl}>
                  {news.data.map((n) => (
                    <li key={n.id} className={s.tlItem}>
                      <a className={s.tlLink} href={n.url} target="_blank" rel="noreferrer">
                        {n.title}
                      </a>
                      <div className={s.tlSrc}>
                        <b>{n.source}</b> · {fmtPublished(n.published)}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : online && news.isLoading ? (
              <p className={s.muted}>최신 소식을 불러오는 중…</p>
            ) : field.trends.length ? (
              // 폴백(오프라인·서버꺼짐·수집실패) — 시드 동향.
              <ul className={s.tl}>
                {/* 왜 시드를 보고 있는지 밝힌다 — 예전엔 수집 실패를 조용히 삼켜 사용자가
                    낡은 시드를 '최신 소식'으로 오인했다(실패와 오프라인이 구분되지 않았다). */}
                <li className={`${s.tlItem} ${s.muted}`}>
                  {news.isError
                    ? '⚠ 최신 소식을 못 불러왔어요 — 아래는 저장된 참고 동향이에요.'
                    : '· 서버 미연결 — 아래는 저장된 참고 동향이에요(최신 아님).'}
                </li>
                {[...field.trends]
                  .sort((a, b) => a.daysAgo - b.daysAgo)
                  .map((t) => (
                    <li key={t.id} className={s.tlItem}>
                      <div className={s.tlText}>{t.text}</div>
                      <div className={s.tlSrc}>
                        <b>{t.source}</b> · {agoLabel(t.daysAgo)}
                      </div>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className={s.muted}>
                {online
                  ? '관련 소식을 찾지 못했어요.'
                  : '수집된 동향이 아직 없어요 — 워크스페이스를 설정하면 실시간으로 채워집니다.'}
              </p>
            )}
          </Panel>

          <Panel tick="var(--acc2)" label="내 메모" wide>
            <textarea
              className={s.memo}
              value={notes[field.key] ?? ''}
              placeholder="이 갈래에 대한 관찰·JD 메모… (예: 빔포밍 실무엔 채널추정+스케줄러가 핵심)"
              onChange={(e) => setNote(field.key, e.target.value)}
              aria-label={`${field.name} 메모`}
            />
            <div className={s.memoHint}>
              발견한 통찰을 여기에. <kbd>⌘K</kbd> 빠른 캡처와 함께 진로관을 갱신해 나갑니다.
            </div>
          </Panel>
        </div>
      </section>
    );
  }

  // ── 그리드 화면(브라우즈) ──────────────────────────────
  const groups = groupByCategory(FIELDS, catFilter);
  const starred = FIELDS.filter((f) => stars.has(f.key)); // 관심 핀 섹션(전체 뷰 상단)
  return (
    <section className={s.root}>
      <div className={s.filters} role="group" aria-label="분야 대분류 필터">
        <button
          type="button"
          className={`${s.chip} ${catFilter === null ? s.chipOn : ''}`}
          aria-pressed={catFilter === null}
          onClick={() => setCatFilter(null)}
        >
          전체<span className={s.chipN}>{FIELDS.length}</span>
        </button>
        {CATEGORIES.map((c) => {
          const n = FIELDS.filter((f) => f.cat === c.key).length;
          return (
            <button
              key={c.key}
              type="button"
              className={`${s.chip} ${catFilter === c.key ? s.chipOn : ''}`}
              aria-pressed={catFilter === c.key}
              onClick={() => setCatFilter(c.key)}
            >
              {c.num} {c.name}
              <span className={s.chipN}>{n}</span>
            </button>
          );
        })}
      </div>

      {/* 관심 분야 핀 — 전체 뷰에서만 상단에 모아 추적을 쉽게(★가 실제 역할을 하도록). */}
      {catFilter === null && starred.length > 0 && (
        <div className={s.catGroup}>
          <div className={s.catHead}>
            <span className={`${s.catNum} ${s.pinStar}`}>★</span>
            <h2>관심 분야</h2>
            <span className={s.catRule} />
            <span className={s.chipN}>{starred.length}</span>
          </div>
          <div className={s.cards}>
            {starred.map((f) => (
              <FieldCard key={f.key} f={f} starred onToggle={toggleStar} />
            ))}
          </div>
        </div>
      )}

      {groups.map((g) => (
        <div key={g.cat.key} className={s.catGroup}>
          <div className={s.catHead}>
            <span className={s.catNum}>{g.cat.num}</span>
            <h2>{g.cat.name}</h2>
            <span className={s.catRule} />
          </div>
          <div className={s.cards}>
            {g.fields.map((f) => (
              <FieldCard key={f.key} f={f} starred={stars.has(f.key)} onToggle={toggleStar} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

/** 분야 카드 — 상세로 가는 링크 + 관심 토글(중첩 인터랙티브 회피: Link + 절대배치 star). */
function FieldCard({ f, starred, onToggle }: { f: AtlasField; starred: boolean; onToggle: (k: string) => void }) {
  const nt = newTrendCount(f);
  return (
    <article className={s.card}>
      <Link to={`/atlas/${f.key}`} className={s.cardLink}>
        <h3 className={s.cardName}>{f.name}</h3>
        <p className={s.one}>{f.one}</p>
        <div className={s.meta}>
          {nt > 0 && <span className={`${s.badge} ${s.badgeSig}`}>+{nt} 동향</span>}
          <span className={s.more}>자세히 →</span>
        </div>
      </Link>
      <button
        type="button"
        className={`${s.star} ${starred ? s.starOn : ''}`}
        aria-label={starred ? `${f.name} 관심 해제` : `${f.name} 관심 표시`}
        aria-pressed={starred}
        onClick={() => onToggle(f.key)}
      >
        {starred ? '★' : '☆'}
      </button>
    </article>
  );
}

/** 상세 섹션 카드 — 라벨(색 틱) + 내용. wide면 그리드 전체 폭을 차지. */
function Panel({ tick, label, wide, children }: { tick: string; label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`${s.panel} ${wide ? s.panelWide : ''}`}>
      <div className={s.panelLbl}>
        <span className={s.tick} style={{ background: tick }} />
        {label}
      </div>
      {children}
    </div>
  );
}
