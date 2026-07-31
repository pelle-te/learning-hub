/* ============================================================
   phone/ReadsView.tsx — 폰에서 **읽을거리·증시를 읽는다**(설계 §13-8 잔여의 실현).

   원본은 PC 워크스페이스의 JSON 파일이라 폰이 원리적으로 못 본다. PC 가 `docs` 에
   미러하고(`lib/artifactMirror.ts`) 기존 동기화가 그걸 실어 나른 것을 여기서 읽는다.

   ## 읽기 전용이다 — 그게 계약이다

   같은 키를 폰이 쓰면 다음 미러가 덮는다(단방향 · PC 가 소유자). 그래서 편집 UI 를 두지
   않는다. "승격"(읽을거리 → 학습 항목) 같은 행동은 `AppState` 를 건드리므로 폰에서도
   가능하지만, 그건 이 화면의 범위가 아니라 별도 안건이다.

   ## 본문을 그대로 보여 준다

   `reads` 산출물의 각 항목에 `text`(수천 자)가 들어 있다 — 이 화면이 존재할 값을 하는
   이유가 그것이다. 목록만 보여 줄 거면 폰에 올릴 이유가 없었다.
============================================================ */
import { useId, useState } from 'react';
import { readMirrored } from '@/lib/artifactMirror';
import { dayDiff, todayISO } from '@/lib/utils';

interface Article {
  id?: string;
  title?: string;
  source?: string;
  url?: string;
  published?: string;
  words?: number;
  text?: string;
}
interface ReadsArtifact {
  date?: string;
  articles?: Article[];
}
interface NewsItem {
  id?: string;
  title?: string;
  source?: string;
  url?: string;
  published?: string;
}
interface MarketsArtifact {
  date?: string;
  news?: NewsItem[];
  items?: NewsItem[];
}

const CARD = 'border-b border-line px-3 py-3';
// ⚠ 제목은 `<h3>` 이다 — 본문이 수천 자인 화면이라(이 뷰의 존재 이유) SR 사용자가 헤딩 탐색으로
//    기사 사이를 건너뛸 수 있어야 한다. div 로 두면 문서 헤딩 구조에서 항목이 사라진다.
const TITLE = 'text-base font-semibold text-ink';
const META = 'mt-1 text-xs text-mut';
const BODY = 'mt-2 text-sm leading-relaxed whitespace-pre-wrap text-txt';
const EMPTY = 'px-3 py-8 text-center text-sm text-mut';

/** 목록의 한 줄 — 탭하면 본문을 편다. 본문이 없으면 펼침 자체를 안 만든다. */
function ArticleRow({ a }: { a: Article }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const body = (a.text ?? '').trim();
  const meta = [a.source, a.published?.slice(0, 10), a.words ? `${a.words}단어` : ''].filter(Boolean).join(' · ');
  const head = (
    <>
      <h3 className={TITLE}>{a.title || '(제목 없음)'}</h3>
      {meta ? <div className={META}>{meta}</div> : null}
    </>
  );
  return (
    <article className={CARD}>
      {body ? (
        <>
          <button
            type="button"
            className="min-h-11 w-full text-left"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((v) => !v)}
          >
            {head}
          </button>
          {open ? (
            <div id={bodyId} className={BODY}>
              {body}
            </div>
          ) : null}
        </>
      ) : (
        <div className="min-h-11">{head}</div>
      )}
    </article>
  );
}

/** 산출물이 **만들어진** 날 → "오늘 만든 / 어제 만든 / N일 전" (W10).
 *  둘 중 최신을 쓴다 — 미러가 함께 돌므로 최신이 곧 "PC 가 마지막으로 켜졌을 때"에 가장 가깝다.
 *  ⚠ 미래 날짜·파싱 불가는 라벨을 안 만든다(모르면 말하지 않는다 — 없는 신선도를 주장하지 않는다). */
function madeAgoLabel(...dates: (string | undefined)[]): string | null {
  const ds = dates.filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}/.test(d)).sort();
  const newest = ds[ds.length - 1];
  if (!newest) return null;
  const n = dayDiff(newest.slice(0, 10), todayISO());
  if (n < 0) return null;
  return n === 0 ? '오늘 만든' : n === 1 ? '어제 만든' : `${n}일 전`;
}

export default function ReadsView(): React.JSX.Element {
  const reads = readMirrored<ReadsArtifact>('reads');
  const markets = readMirrored<MarketsArtifact>('markets');
  const articles = reads?.articles ?? [];
  const news = markets?.news ?? markets?.items ?? [];
  const madeLabel = madeAgoLabel(reads?.date, markets?.date);

  if (!reads && !markets) {
    return (
      <p role="status" className={EMPTY}>
        아직 받은 읽을거리가 없어요.
        <br />
        PC 에서 수집한 뒤 동기화되면 여기에 나타납니다.
      </p>
    );
  }

  return (
    <div>
      {/* ── W10 "언제 만들어졌나" — 원장('언제 받았나')과 **다른 자리** ────────────────────
          미러는 `StorageGuard` 의 `beforeSync` 로만 도는데 그건 `isTauri()` 가드 안이라
          **PC 셸이 실행 중일 때만** 갱신된다. PC 를 이틀 안 켜면 이 목록은 이틀 전 것인데
          헤더 원장은 "방금 동기화"라 말한다 — **배관은 신선한데 내용은 낡은** 조합이 화면에서
          구분되지 않았다. 산출물의 `date` 는 이미 받아 놓고 표시만 안 하고 있었다(새 필드 0).
          ⚠ 원장 옆에 두지 않는 것이 요점이다: 두 시각이 나란히 있으면 같은 종류로 읽힌다. */}
      {madeLabel && (
        <p className="px-3 pt-3 text-xs text-mut" role="status">
          PC 기준 {madeLabel} 목록
        </p>
      )}
      {articles.length > 0 ? (
        <section aria-label="읽을거리">
          <h2 className="px-3 pt-3 pb-1 text-xs font-bold tracking-wider text-mut uppercase">
            읽을거리{reads?.date ? ` · ${reads.date}` : ''}
          </h2>
          {articles.map((a, i) => (
            <ArticleRow key={a.id ?? i} a={a} />
          ))}
        </section>
      ) : null}

      {news.length > 0 ? (
        <section aria-label="증시 뉴스">
          <h2 className="px-3 pt-4 pb-1 text-xs font-bold tracking-wider text-mut uppercase">
            증시{markets?.date ? ` · ${markets.date}` : ''}
          </h2>
          {news.map((n, i) => (
            <article key={n.id ?? i} className={CARD}>
              <h3 className={TITLE}>{n.title || '(제목 없음)'}</h3>
              {n.source || n.published ? (
                <div className={META}>{[n.source, n.published?.slice(0, 10)].filter(Boolean).join(' · ')}</div>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}

      {articles.length === 0 && news.length === 0 ? (
        <p role="status" className={EMPTY}>
          받아 온 건 있는데 항목이 비어 있어요 — PC 에서 다시 수집해 보세요.
        </p>
      ) : null}
    </div>
  );
}
