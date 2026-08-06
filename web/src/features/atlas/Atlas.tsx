/* ============================================================
   Atlas(진로 지도) — 탭: 📡 전파·통신 분야 아틀라스.
   두 층: ① 그리드(/atlas) — 대분류로 갈래를 훑는다. ② 상세(/atlas/<key>) — 전체 폭을 써서
   하는일·주력·필요역량·세부토픽·진입경로·대표기업·리소스·전망·동향·메모를 펼친다(딥링크·뒤로가기 동작).
   데이터 골격은 lib/atlas(시드) — 관심 별·메모만 로컬 영속(localStore). 동향 자동수집은 후속 단계.
   레이어: store(usePageChrome)·lib(atlas·localStore)만 소비. app/다른 feature import 금지(boundaries).
============================================================ */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { useAtlasNews, usePing } from '@/store/queries';
import { readJSON, writeJSON } from '@/lib/localStore';
import { applyMorph, morphName } from '@/lib/motion';
import { MOD_K_LABEL } from '@/lib/platform';
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
import State from '@/components/State';
import { daysAgoLabel } from '@/lib/utils';

/* ── C-7 여섯 번째 이식(atlas) ────────────────────────────────────────────
   규약은 §15 + `styles/tokenBridge.css` 머리주석이 SSOT. `Atlas.module.css`(536줄) 삭제.
   control 에서 굳힌 규율 승계: 전역 요소 규칙(h1/h2/h3·textarea·button·a)은 unlayered 라
   layered 유틸리티를 이기므로, 그와 **다른** 속성만 `!` 로 이긴다(같은 값은 전역에 맡김).

   이 파일에서 처음 만난 것:
   ① **타임라인 점·연결선**(`.tlItem::before` 발광 점 · `::after` 세로선)을 Tailwind
      `before:`/`after:` 로 옮긴다. 치수(점 6px·선 1px)는 사다리 밖이라 표준 분수 유틸
      (`before:size-1.5`·`after:w-px`)로 정확히(§15-6 치수적 그래픽 예외).
   ② **인라인 색 주입 유지**: Panel 의 색 틱(`style={{ background: tick }}`)은 런타임 전달
      색이라 정적 클래스로 표현 불가 — §14-3 예외 그대로. 옛 `--sig`/`--fut` 로컬 별칭은
      실토큰(`--signal`/`--warn`)으로 편다(별칭이 있던 이유가 없어졌다). */
const ROOT = 'px-5 pt-4 pb-12';
const CHIP = 'rounded-full! px-3! py-1! text-sm! leading-auto! whitespace-nowrap';
const CHIP_ON = 'bg-acc-soft! border-line-acc-hover! font-semibold! text-txt!';
const CHIP_OFF = 'bg-panel! text-mut!';
const CARDS = 'grid grid-cols-atlas gap-2';
const CARD =
  'group relative rounded-md border border-line bg-panel transition hover:-translate-y-px hover:border-line-acc-hover focus-within:border-acc motion-reduce:transition-none motion-reduce:hover:translate-y-0';
const CARDLINK =
  'block py-3 pr-9 pl-3 text-inherit! focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acc';
const BADGE = 'inline-flex items-center gap-1 rounded-full px-2 py-1 text-2xs font-semibold whitespace-nowrap';
const STAR =
  'absolute top-2 right-2 border-0! bg-transparent! p-1 text-md! leading-none focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-acc';
const PANEL = 'rounded-md border border-line bg-panel px-4 py-3';
const PANEL_LBL = 'mb-2 flex items-center gap-1.5 text-2xs font-bold tracking-widest text-mut uppercase';
const TAG = 'rounded-full border border-line-acc bg-acc-soft px-2 py-1 text-sm text-txt';
const TAG_DIM = 'border-line! bg-panel2! text-mut!';
const TL = 'm-0 list-none p-0';
const TLITEM =
  "relative pb-3 pl-4 before:absolute before:top-1 before:left-0.5 before:size-1.5 before:rounded-full before:bg-signal before:shadow-tl-dot before:content-[''] after:absolute after:top-3 after:bottom-0 after:left-1.5 after:w-px after:bg-line2 after:content-[''] last:pb-0 last:after:hidden";

/* ⚠⚠ **주소가 경로에서 쿼리로 옮겨 갔다**(W9 · 2026-08-06 · `atlas`→`discovery` 흡수).
   종전엔 상세를 `/atlas/<key>` 로 읽었는데, 이 화면이 `discovery` 의 뷰가 되면서 그 경로가
   더는 존재하지 않는다(그대로 두면 `pathname.split('/')[2]` 가 늘 빈 문자열이라 **상세가
   영원히 안 열린다** — 조용한 도달성 손실). 그래서 `?field=<key>` 로 옮겼고, 링크는 **현재
   쿼리를 보존한 채** 그 키만 갈아 끼운다(호스트의 `view=atlas` 를 지우면 큐로 튕긴다).
   ⚠ 옛 `/atlas/<key>` 딥링크는 `app/App.tsx` 의 리다이렉트가 이 형태로 옮겨 준다. */
export const ATLAS_FIELD_PARAM = 'field';

export default function Atlas() {
  const [params] = useSearchParams();
  const key = params.get(ATLAS_FIELD_PARAM) || '';
  const field = key ? fieldByKey(key) : undefined;
  /** 이 화면 안의 이동 — 쿼리 하나만 바꾼다(호스트 뷰·필터를 잃지 않게 나머지는 그대로). */
  const hrefFor = useCallback(
    (k: string | null) => {
      const p = new URLSearchParams(params);
      if (k) p.set(ATLAS_FIELD_PARAM, k);
      else p.delete(ATLAS_FIELD_PARAM);
      return { search: `?${p.toString()}` };
    },
    [params],
  );

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
      /* W22/H3 — `primary` 는 **필수 키**다(`store/usePageChrome.ts` 머리주석). 이 화면은 렌즈라
         44px 앵커를 세우지 않는다 — 잊은 것이 아니라 없다고 정한 것이다. */
      primary: null,
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
      <section className={ROOT}>
        <Link to={hrefFor(null)} className="mb-3 inline-block text-sm text-mut! hover:text-acc">
          ← 분야 목록
        </Link>
        {/* Q-11 — 목록 카드의 짝. 이름이 **같은 규약**에서 나오므로 두 곳이 손으로 맞춰질 일이 없다. */}
        <header
          className="relative mb-4 border-b border-line2 pb-3"
          style={{ viewTransitionName: morphName('atlas', field.key) }}
        >
          <div className="text-2xs font-bold tracking-widest text-acc uppercase">
            {cat?.num} {cat?.name}
          </div>
          <h1 className="mt-1! mb-1! text-xl! font-extrabold! tracking-tight!">{field.name}</h1>
          <p className="m-0 max-w-prose text-md leading-normal text-mut">{field.one}</p>
          <button
            type="button"
            className={`absolute top-0 right-0 px-3! py-1! text-sm! leading-auto! max-mobile:static max-mobile:mt-2.5 ${on ? 'border-acc! bg-acc! font-bold! text-on-acc!' : ''}`}
            aria-pressed={on}
            onClick={() => toggleStar(field.key)}
          >
            {on ? '★ 관심 해제' : '☆ 관심 표시'}
          </button>
        </header>

        <div className="grid grid-cols-2 items-start gap-3 max-mobile:grid-cols-1">
          <Panel tick="var(--acc)" label="하는 일">
            <ul className="m-0 space-y-0.5 pl-4 text-md leading-relaxed">
              {field.doing.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </Panel>

          <Panel tick="var(--acc2)" label="주력 포인트">
            <p className="m-0 text-md leading-relaxed">{field.focus}</p>
          </Panel>

          <Panel tick="var(--acc)" label="필요 역량">
            <div className="flex flex-wrap gap-1">
              {field.skills.map((sk) => (
                <span key={sk} className={TAG}>
                  {sk}
                </span>
              ))}
            </div>
          </Panel>

          <Panel tick="var(--signal)" label="세부 토픽 · 키워드">
            <div className="flex flex-wrap gap-1">
              {field.topics.map((t) => (
                <span key={t} className={`${TAG} ${TAG_DIM}`}>
                  {t}
                </span>
              ))}
            </div>
          </Panel>

          <Panel tick="var(--acc2)" label="진입 경로">
            <ol className="m-0 space-y-1 pl-5 text-md leading-relaxed marker:font-bold marker:text-acc">
              {field.entry.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ol>
          </Panel>

          <Panel tick="var(--acc)" label="대표 기업 · 기관 · 연구실">
            <div className="flex flex-wrap gap-1">
              {field.orgs.map((o) => (
                <span key={o} className={TAG}>
                  {o}
                </span>
              ))}
            </div>
          </Panel>

          <Panel tick="var(--signal)" label="학습 리소스">
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {field.resources.map((r) => (
                <li key={r.label} className="flex items-baseline gap-2 text-md leading-snug">
                  <span className="min-w-10 flex-none rounded-sm bg-tint-signal px-1.5 py-0.5 text-center text-2xs font-semibold text-signal">
                    {r.kind}
                  </span>
                  <span>{r.label}</span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel tick="var(--warn)" label="전망">
            <div className="mb-3 flex gap-2 max-mobile:flex-col">
              <div className="min-w-0 flex-1 rounded-sm border border-line bg-panel2 px-2 py-2">
                <span className="mb-0.5 block text-2xs text-mut">인력 수요</span>
                <span className="block text-md font-bold tracking-tight text-warn">{field.outlook.demand}</span>
              </div>
              <div className="min-w-0 flex-1 rounded-sm border border-line bg-panel2 px-2 py-2">
                <span className="mb-0.5 block text-2xs text-mut">진입 난이도</span>
                <span className="block text-md font-bold tracking-tight text-warn">{field.outlook.difficulty}</span>
              </div>
              <div className="min-w-0 flex-1 rounded-sm border border-line bg-panel2 px-2 py-2">
                <span className="mb-0.5 block text-2xs text-mut">성장 시점</span>
                <span className="block text-md font-bold tracking-tight text-warn">{field.outlook.horizon}</span>
              </div>
            </div>
            <div className="rounded-sm bg-tint-warn-faint px-3 py-2">
              <p className="m-0 text-sm leading-relaxed text-warn-on-txt">{field.future}</p>
            </div>
          </Panel>

          <Panel tick="var(--signal)" label="현재 동향 · 자동 수집" wide>
            {news.data && news.data.length > 0 ? (
              // 라이브(백엔드 사용 가능) — Google 뉴스 최신 소식.
              <>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-2xs font-bold tracking-wider text-signal">● 실시간 · Google 뉴스</span>
                  <button
                    type="button"
                    className="rounded-full! px-2! py-1! text-2xs! text-mut!"
                    onClick={() => news.refetch()}
                  >
                    새로고침
                  </button>
                </div>
                <ul className={TL}>
                  {news.data.map((n) => (
                    <li key={n.id} className={TLITEM}>
                      <a
                        className="text-md leading-snug text-txt! no-underline hover:text-signal hover:underline"
                        href={n.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {n.title}
                      </a>
                      <div className="mt-0.5 text-2xs text-mut">
                        <b className="font-semibold text-signal">{n.source}</b> · {fmtPublished(n.published)}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : online && news.isLoading ? (
              /* W15 — RSS 는 몇 건이 올지 모른다. 3행 골격은 그 사실에 대해 거짓말하므로
                 `indeterminate`(끝을 모르는 대기의 정직한 표현). */
              <State kind="loading" shape="indeterminate" title="최신 소식을 불러오는 중" />
            ) : field.trends.length ? (
              // 폴백(오프라인·서버꺼짐·수집실패) — 시드 동향.
              <ul className={TL}>
                {/* 왜 시드를 보고 있는지 밝힌다 — 예전엔 수집 실패를 조용히 삼켜 사용자가
                    낡은 시드를 '최신 소식'으로 오인했다(실패와 오프라인이 구분되지 않았다). */}
                <li className={`${TLITEM} text-sm text-mut`}>
                  {news.isError
                    ? '최신 소식을 못 불러왔어요 — 아래는 저장된 참고 동향이에요.'
                    : '· 서버 미연결 — 아래는 저장된 참고 동향이에요(최신 아님).'}
                </li>
                {[...field.trends]
                  .sort((a, b) => a.daysAgo - b.daysAgo)
                  .map((t) => (
                    <li key={t.id} className={TLITEM}>
                      <div className="text-md leading-snug">{t.text}</div>
                      <div className="mt-0.5 text-2xs text-mut">
                        <b className="font-semibold text-signal">{t.source}</b> · {daysAgoLabel(t.daysAgo)}
                      </div>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="m-0 text-sm text-mut">
                {online
                  ? '관련 소식을 찾지 못했어요.'
                  : '수집된 동향이 아직 없어요 — 워크스페이스를 설정하면 실시간으로 채워집니다.'}
              </p>
            )}
          </Panel>

          <Panel tick="var(--acc2)" label="내 메모" wide>
            <textarea
              className="min-h-18 resize-y leading-normal focus-visible:border-line-acc-focus! focus-visible:outline-none"
              value={notes[field.key] ?? ''}
              placeholder="이 갈래에 대한 관찰·JD 메모… (예: 빔포밍 실무엔 채널추정+스케줄러가 핵심)"
              onChange={(e) => setNote(field.key, e.target.value)}
              aria-label={`${field.name} 메모`}
            />
            <div className="mt-1 text-2xs text-mut">
              발견한 통찰을 여기에. <kbd className="font-mono font-bold text-acc">{MOD_K_LABEL}</kbd> 빠른 캡처와 함께
              진로관을 갱신해 나갑니다.
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
    <section className={ROOT}>
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="분야 대분류 필터">
        <button
          type="button"
          className={`${CHIP} ${catFilter === null ? CHIP_ON : CHIP_OFF}`}
          aria-pressed={catFilter === null}
          onClick={() => setCatFilter(null)}
        >
          전체<span className="ml-0.5 text-mut tabular-nums">{FIELDS.length}</span>
        </button>
        {CATEGORIES.map((c) => {
          const n = FIELDS.filter((f) => f.cat === c.key).length;
          return (
            <button
              key={c.key}
              type="button"
              className={`${CHIP} ${catFilter === c.key ? CHIP_ON : CHIP_OFF}`}
              aria-pressed={catFilter === c.key}
              onClick={() => setCatFilter(c.key)}
            >
              {c.num} {c.name}
              <span className="ml-0.5 text-mut tabular-nums">{n}</span>
            </button>
          );
        })}
      </div>

      {/* 관심 분야 핀 — 전체 뷰에서만 상단에 모아 추적을 쉽게(★가 실제 역할을 하도록). */}
      {catFilter === null && starred.length > 0 && (
        <div className="mb-5">
          <div className="mb-2 flex items-baseline gap-2">
            <span className="text-md font-semibold text-acc">★</span>
            <h2 className="m-0! text-md! font-bold! tracking-tight!">관심 분야</h2>
            <span className="h-px flex-1 bg-line2" />
            <span className="ml-0.5 text-mut tabular-nums">{starred.length}</span>
          </div>
          <div className={CARDS}>
            {starred.map((f) => (
              <FieldCard key={f.key} f={f} starred onToggle={toggleStar} hrefFor={hrefFor} />
            ))}
          </div>
        </div>
      )}

      {groups.map((g) => (
        <div key={g.cat.key} className="mb-5">
          <div className="mb-2 flex items-baseline gap-2">
            <span className="font-mono text-xs font-semibold text-acc">{g.cat.num}</span>
            <h2 className="m-0! text-md! font-bold! tracking-tight!">{g.cat.name}</h2>
            <span className="h-px flex-1 bg-line2" />
          </div>
          <div className={CARDS}>
            {g.fields.map((f) => (
              <FieldCard key={f.key} f={f} starred={stars.has(f.key)} onToggle={toggleStar} hrefFor={hrefFor} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

/** 분야 카드 — 상세로 가는 링크 + 관심 토글(중첩 인터랙티브 회피: Link + 절대배치 star). */
function FieldCard({
  f,
  starred,
  onToggle,
  hrefFor,
}: {
  f: AtlasField;
  starred: boolean;
  onToggle: (k: string) => void;
  /** 상세로 가는 주소 — 호스트가 어디든 **현재 쿼리를 보존**해 만든다(위 `ATLAS_FIELD_PARAM` 절). */
  hrefFor: (k: string | null) => { search: string };
}) {
  const nt = newTrendCount(f);
  const to = hrefFor(f.key);
  return (
    <article className={CARD}>
      {/* 그리드→상세 공유요소 morph(View Transitions). `viewTransition` 이 이 이동을
          startViewTransition 으로 감싸고(BrowserRouter 에서 동작), onClick 이 **클릭된 카드에만**
          'atlas-hero' 이름을 붙여 old 스냅샷이 이 카드를 그 이름으로 잡는다. 상세 헤더가 같은
          이름을 늘 지녀 new 스냅샷과 보간(morph)된다 — 페이지당 소스 하나·대상 하나라 유일.
          네비게이션이 카드를 언마운트해 인라인 이름은 자연히 사라진다. 미지원/reduced-motion 은
          즉시 전환(motion.css). ⚠ `useViewTransitionState` 는 안 쓴다 — data router 를 요구하는데
          이 앱은 BrowserRouter 다(atlasTab.test 가 이 회귀를 잡았다). */}
      <Link
        to={to}
        viewTransition
        className={CARDLINK}
        onClick={(e) => {
          // Q-11 — 규약이 이름을 짓는다. 종전 `atlas-hero` 는 **id 가 없어** 카드가 여럿 떠 있을 때
          // 짝이 유일하지 않았다(브라우저가 짝을 못 지으면 전환이 통째로 죽는다).
          applyMorph(e.currentTarget, 'atlas', f.key);
        }}
      >
        <h3 className="m-0! text-md! font-semibold! tracking-tight!">{f.name}</h3>
        <p className="mt-1 mb-2 text-sm leading-snug text-mut">{f.one}</p>
        <div className="flex items-center gap-2">
          {nt > 0 && (
            <span
              className={`${BADGE} bg-tint-signal text-signal before:size-1 before:rounded-full before:bg-current before:content-['']`}
            >
              +{nt} 동향
            </span>
          )}
          <span className="ml-auto text-2xs font-semibold text-acc opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
            자세히 →
          </span>
        </div>
      </Link>
      <button
        type="button"
        className={`${STAR} ${starred ? 'text-acc!' : 'text-mut!'}`}
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
    <div className={`${PANEL} ${wide ? 'col-span-full' : ''}`}>
      <div className={PANEL_LBL}>
        {/* 색 틱 — 런타임 전달 색이라 인라인 주입(§14-3 예외). */}
        <span className="size-2 flex-none rounded-xs" style={{ background: tick }} />
        {label}
      </div>
      {children}
    </div>
  );
}
