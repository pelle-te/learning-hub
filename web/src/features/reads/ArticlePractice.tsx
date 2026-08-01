/* ============================================================
   ArticlePractice — 지문 연습(읽을거리 ①). 수집 원문을 읽고 *내가 직접* 요약을 쓴다.
   영어 지문 = 영어 공부(원문 독해) / 한국어 지문 = 어휘력 + 요약 연습.
   원문은 절대 가공하지 않는다(요약은 사용자 몫). 왼쪽 목록 · 오른쪽 리더+내 요약 에디터.
   워크스페이스가 없으면 우아 안내, 수집 0편이면 '수집 시작'(reads-collect 도구).
============================================================ */
import { useEffect, useMemo, useRef, useState } from 'react';
import ArtifactGate from '@/components/ArtifactGate';
import State from '@/components/State';
import { useAiStream } from '@/components/useAiStream';
import { Button, Skeleton } from '@/components/ui';
import { coachSummary, type CoachFeedback } from '@/lib/api';
import { ReaderVocab } from './ReaderVocab';
import { classifyArtifact, artifactErrorCopy, workspaceHint, WORKSPACE_UNSET } from '@/lib/artifactState';
import { ui } from '@/shell';
import { useApp } from '@/store/useApp';
import { useFlushOnUnmount } from '@/hooks/interactions';
import { addBacklog } from '@/lib/methodology';
import { backlogFromArticle, PROMOTE_TOAST } from '@/lib/promote';
import type { Article, ArticleWork } from '@/lib/reads';
import { Icon } from '@/components/Icon';

type Filter = 'all' | 'en' | 'ko';
type Progress = 'all' | 'todo' | 'done';

// 필터 라벨 — 값→표시를 정적 표로 둔다(분기 사슬로 쓰면 세그먼트가 늘 때마다 복잡도가 붙는다).
const LANG_OPTS = [
  ['all', '전체'],
  ['en', 'EN'],
  ['ko', 'KO'],
] as const satisfies readonly (readonly [Filter, string])[];
const PROGRESS_OPTS = [
  ['all', '전체'],
  ['todo', '미완료'],
  ['done', '완료'],
] as const satisfies readonly (readonly [Progress, string])[];

// 언어 태그(EN=acc / KO=good) — 배경만 상태로 분기(§15 부칙 · 정적 클래스). 스팬이라 ! 불필요.
const LANG_TAG = 'flex-none rounded-sm px-1.5 py-px text-2xs font-black tracking-tag text-on-acc';
// 언어/진행 필터(button) — 전역 button{} 과 다른 속성만 !. 활성/비활성 배경·색은 정적 분기.
// ⚠ leading-auto: 이 앱은 preflight 를 안 싣는다 → 폼 컨트롤(button/textarea/input)은 UA
// line-height:normal 을 가지며 body 1.6 을 상속하지 않는다. 필터 버튼 텍스트는 원본에서 normal 로
// 렌더됐다(명시 line-height 없음). 1.6 으로 고정하면 ~1px 밀려 dark 스냅샷이 깨진다.
const LANG_BTN = 'rounded-sm! border-none! px-2.75! py-1! text-sm! leading-auto! font-extrabold!';
// 지문 목록 항목(button) — 테두리/배경은 선택 여부로 정적 분기(no-conflicting 회피 · global button 이 나머지 제공).
const LIST_ITEM = 'w-full flex flex-col gap-1 text-left rounded-base! py-2.75!';
// 코치 라벨 톤 — 빠진 핵심=learning · 정확성/바로잡기=bad · 나머지=mut(정적 맵 · 동적 s[k] 금지).
const COACH_TONE: Record<'miss' | 'bad' | 'mut', string> = {
  miss: 'text-learning',
  bad: 'text-bad',
  mut: 'text-mut',
};

export default function ArticlePractice({
  articles,
  work,
  setWork,
  online,
  pingLoading,
  loading,
  isError,
  errorMessage,
  refetch,
  refetchPing,
  collecting,
  collect,
  collectError,
}: {
  articles: Article[];
  work: Record<string, ArticleWork>;
  setWork: (id: string, w: ArticleWork) => void;
  online: boolean;
  pingLoading: boolean;
  /* 쿼리 표면 전체(UseQueryResult) 대신 필요한 조각만 — 데이터 레이어 누수 차단. */
  loading: boolean;
  isError: boolean;
  errorMessage?: string;
  refetch: () => Promise<unknown>;
  refetchPing: () => Promise<unknown>;
  /* 수집 상태·트리거 — 부모(Reads)가 소유한 단일 useCollectTool('reads-collect') 인스턴스에서
     주입(SR-13). 자식이 별도 인스턴스를 만들면 collecting 상태가 둘로 갈렸다. */
  collecting: boolean;
  collect: (silent?: boolean) => Promise<boolean>;
  /** 조용한 자동 수집의 마지막 실패 사유(H23) — 부모의 단일 `useCollectTool` 인스턴스가 소유한다. */
  collectError?: string | null;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [progress, setProgress] = useState<Progress>('all');
  const [selId, setSelId] = useState<string | null>(null);
  const mutate = useApp((s) => s.mutate);

  // B5 — '학습으로 보내기': 읽은 글을 보충 백로그(나중에 학습할 큐)로 승격. 소비→학습 루프를 닫는다.
  // 중복 승격 방지 — 이 세션에 이미 보낸 지문은 버튼을 '보냄'으로 잠근다(반복 클릭=중복 백로그).
  const [promoted, setPromoted] = useState<ReadonlySet<string>>(() => new Set());
  const promote = (a: Article) => {
    if (promoted.has(a.id)) return;
    const seed = backlogFromArticle(a);
    mutate((st) => addBacklog(st, '', seed.name, seed.topic, seed.note));
    setPromoted((prev) => new Set(prev).add(a.id));
    ui.toast(PROMOTE_TOAST, 'ok');
  };

  /* ⚠ **요약 편집·AI 채점의 상태는 여기 없다**(F5 · 2026-08-01). 초안·`useAiStream`·채점 결과·
     결과 포커스·`workRef` 미러·언마운트 flush 가 전부 `SummaryEditor` 로 내려갔고, 그 수명은
     아래 `key={sel.id}` 리마운트가 정한다. 이 컴포넌트에 남은 일은 **지문 목록과 선택**이다. */
  const list = useMemo(() => {
    let xs = filter === 'all' ? articles : articles.filter((a) => a.lang === filter);
    // 진행 필터 — 요약 완료(work[id].done) 기준 한 겹(BookShelf 상태필터 미러 · SR-3).
    if (progress !== 'all') xs = xs.filter((a) => (progress === 'done' ? !!work[a.id]?.done : !work[a.id]?.done));
    return xs;
  }, [articles, filter, progress, work]);
  // 유효 선택 파생 — 저장 selId가 목록에 없으면(필터 변경·수집) 첫 지문으로(효과 없이 렌더에서 계산).
  const effId = selId && list.some((a) => a.id === selId) ? selId : (list[0]?.id ?? null);
  const sel = articles.find((a) => a.id === effId) ?? null;

  // ── 빈/오프라인 상태 ─────────────────────────────────────────
  if (!articles.length) {
    // 표시 단계는 공용 SSOT(classifyArtifact) — markets·mastery와 같은 규칙.
    // 이 컴포넌트는 error 객체 대신 errorMessage 문자열만 받으므로 합성 Error로 넘긴다(미생성 계열 판정용).
    const phase = classifyArtifact({
      hasData: false,
      loading: loading || pingLoading,
      query: { isError, error: errorMessage ? new Error(errorMessage) : undefined },
      ping: { ok: online },
    });
    if (phase === 'loading') return <PracticeSkeleton />;
    // 서버는 살아 있는데 진짜 실패(미생성 계열 아님) — '미수집'과 구분해 실제 오류를 노출(SR-9).
    if (phase === 'error') {
      return (
        <div className="grid min-h-0 flex-1 place-items-center p-6">
          <State
            kind="error"
            {...artifactErrorCopy('지문을', errorMessage)}
            next={
              <Button variant="primary" onClick={() => void refetch()}>
                다시 시도
              </Button>
            }
          />
        </div>
      );
    }
    return (
      <div className="grid min-h-0 flex-1 place-items-center p-6">
        <ArtifactGate
          online={online}
          onRetry={() => {
            void refetchPing();
            void refetch();
          }}
          glyph="reads"
          offlineDesc={
            <>
              읽을거리 지문은 러닝허브가 직접 수집해요. {workspaceHint('내 RSS 피드에서 원문을 가져옵니다')} 피드 설정:{' '}
              <code>hub/_읽을거리/feeds.json</code>
            </>
          }
          emptyTitle="아직 수집된 지문이 없어요"
          emptyDesc={
            <>
              내 RSS 피드에서 오늘의 칼럼·뉴스 원문을 가져올게요. 영어는 영어 공부, 한국어는 어휘력·요약 연습용 지문으로
              쌓입니다.
            </>
          }
          collecting={collecting}
          onCollect={() => void collect()}
          collectLabel="지문 수집 시작"
          collectError={collectError}
        />
      </div>
    );
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-reads gap-4.5 max-mobile:grid-cols-1 max-mobile:grid-rows-[auto_1fr] max-mobile:overflow-y-auto">
      {/* 왼쪽 — 지문 목록 + 필터 + 수집 */}
      <aside className="flex min-h-0 flex-col gap-2.5">
        <div className="flex flex-none flex-wrap items-center justify-between gap-2">
          <FilterGroup label="언어 필터" opts={LANG_OPTS} value={filter} onPick={setFilter} />
          {/* 진행 필터 — 요약 완료 기준(전체/미완료/완료). 언어 필터와 독립(SR-3). */}
          <FilterGroup label="진행 필터" opts={PROGRESS_OPTS} value={progress} onPick={setProgress} />
          <Button
            sm
            onClick={() => void collect()}
            disabled={collecting || !online}
            title={online ? '새 지문 수집' : WORKSPACE_UNSET}
          >
            {collecting ? <span className="ds-spin" /> : '↻'} 수집
          </Button>
        </div>
        <ul className="m-0 flex min-h-0 flex-1 [scrollbar-width:thin] list-none flex-col gap-1.5 overflow-y-auto p-0 max-mobile:max-h-[var(--reads-list-vh)]">
          {list.length ? (
            list.map((a) => (
              <ArticleRow key={a.id} a={a} w={work[a.id]} selected={a.id === effId} onSelect={setSelId} />
            ))
          ) : (
            <li className="px-3 py-4.5 text-center text-md text-mut">
              이 언어의 지문이 없어요 — 필터를 바꾸거나 수집해 보세요.
            </li>
          )}
        </ul>
      </aside>

      {/* 오른쪽 — 리더(원문) + 내 요약 에디터 */}
      <div className="flex min-h-0 min-w-0 flex-col">
        {sel ? (
          <>
            <ReaderPane sel={sel} online={online} />
            {/* ⚠ `key` 가 계약이다(F5) — 지문이 바뀌면 초안·채점 상태를 **구조가** 새로 만든다
                (부모가 위 `ReaderVocab` 에서 쓰는 것과 같은 수법). 이걸 빼면 옛 지문의 초안이
                새 지문 아래 남고, 옛 채점 응답이 새 지문에 착지한다. */}
            <SummaryEditor
              key={sel.id}
              sel={sel}
              w={work[sel.id]}
              setWork={setWork}
              online={online}
              promote={promote}
              promoted={promoted.has(sel.id)}
            />
          </>
        ) : (
          <div className="grid flex-1 place-items-center text-base14 text-mut">왼쪽에서 지문을 선택하세요.</div>
        )}
      </div>
    </div>
  );
}

/** 세그먼트 필터 한 벌(언어·진행) — 라벨은 정적 표에서 온다(동적 분기 금지 · §15 부칙). */
function FilterGroup<T extends string>({
  label,
  opts,
  value,
  onPick,
}: {
  label: string;
  opts: readonly (readonly [T, string])[];
  value: T;
  onPick: (v: T) => void;
}) {
  return (
    <div className="inline-flex gap-0.5 rounded-md border border-line bg-panel p-0.75" role="group" aria-label={label}>
      {opts.map(([v, text]) => (
        <button
          key={v}
          type="button"
          className={`${LANG_BTN} ${value === v ? 'bg-acc! text-on-acc!' : 'bg-transparent! text-mut!'}`}
          aria-pressed={value === v}
          onClick={() => onPick(v)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** 리더(원문) — 가공하지 않는다. 어휘 팝오버는 `ReaderVocab` 이 소유. */
function ReaderPane({ sel, online }: { sel: Article; online: boolean }) {
  const en = sel.lang === 'en';
  return (
    // lang — 영어 지문은 SR이 영어 음성으로 낭독하도록 부분 언어 전환(WCAG 3.1.2).
    <article
      className="flex min-h-0 flex-1 [scrollbar-width:thin] overflow-y-auto rounded-lg border border-line bg-panel px-6.5 py-5.5 max-mobile:p-4"
      lang={en ? 'en' : undefined}
    >
      <header className="mb-4 border-b border-line2 pb-3.5">
        <div className="mb-2 flex items-center gap-2 text-sm leading-text font-bold text-mut" lang="ko">
          <span className={`${LANG_TAG} ${en ? 'bg-acc' : 'bg-good'}`}>{en ? 'EN' : 'KO'}</span>
          {sel.field} · {sel.source}
          <a
            className="ml-auto text-sm leading-text font-bold"
            href={/^https?:\/\//i.test(sel.url) ? sel.url : undefined}
            target="_blank"
            rel="noreferrer noopener"
          >
            원문 <Icon name="arrowUpRight" />
          </a>
        </div>
        <h2 className="m-0! text-reader-title! leading-tight font-black! tracking-title!">{sel.title}</h2>
      </header>
      <ReaderVocab key={sel.id} lang={sel.lang} text={sel.text} online={online} />
    </article>
  );
}

/* ============================================================
   SummaryEditor — 내 요약 초안 + AI 채점(트리거·스트리밍·결과). **자기 상태를 소유한다.**

   ## ⚠ F5 추출(2026-08-01 `/감사 근본`) — 오라클은 줄 수가 아니라 **드릴된 prop 개수**였다

   종전 시그니처는 **12 props** 였고 그중 여덟(`draft`·`setDraft`·`commit`·`grader`·`askCoach`·
   `coach`·`coachResultRef`·`promoted`)이 부모에 있을 이유가 없었다 — 부모는 그 값들을 **쓰지
   않고 그대로 내려보내기만** 했다. 그래서 `ArticlePractice` 본문은 "지문 목록을 그리는 일"과
   "요약 하나를 편집·채점하는 일" 둘을 동시에 들고 있었고, 후자의 수명 규율(초안 리셋·채점 취소·
   언마운트 flush)이 전부 부모의 `effId` 에 손으로 배선돼 있었다.

   → **`key={sel.id}` 로 리마운트**해 그 배선을 구조가 대신하게 한다(부모가 `ReaderVocab` 에서
   **이미 쓰던 수법**이다 — 새 관용구가 아니다). 그 한 줄이 셋을 한꺼번에 없앤다:
   · 초안 리셋 — `useState(w?.summary ?? '')` 초기값이 곧 리셋이다(옛 `draftFor` 비교 렌더 setState 제거)
   · 채점 취소 — 언마운트가 `useAiStream` 의 abort 를 부른다(H18 이 그 훅에 넣었다 · 옛 `cancelGrade` 효과 제거)
   · 결과 오표시 — 옛 `coach.id === sel.id` 태깅은 *한 컴포넌트가 여러 지문을 섬기던 시절*의 방어다.
     리마운트되면 옛 지문의 응답이 착지할 컴포넌트 자체가 없다.

   ⚠ **`workRef` 는 남는다.** 채점은 수십 초라 그동안 사용자가 요약을 고치거나 완료를 토글할 수
   있고, 클릭 시점에 캡처한 `w` 로 덮으면 **그 편집이 되돌려진다**(X-6). 리마운트는 이 문제를
   안 풀어 준다 — 같은 지문 안에서 벌어지는 일이기 때문이다.
============================================================ */
function SummaryEditor({
  sel,
  w,
  setWork,
  online,
  promote,
  promoted,
}: {
  sel: Article;
  w?: ArticleWork;
  setWork: (id: string, v: ArticleWork) => void;
  online: boolean;
  promote: (a: Article) => void;
  promoted: boolean;
}) {
  /* ⚠ 초기값이 곧 초안 리셋이다 — 호출부의 `key={sel.id}` 가 지문 전환마다 이 상태를 새로 만든다. */
  const [draft, setDraft] = useState(w?.summary ?? '');
  const grader = useAiStream();
  const [coach, setCoach] = useState<CoachFeedback | null>(null);
  /* 채점 결과가 도착하면 결과 카드로 포커스를 옮긴다 — 전체를 role=status 로 장황하게 읽지 않고
     간결히 '결과가 왔다'만 알린다. */
  const coachResultRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (coach) coachResultRef.current?.focus();
  }, [coach]);

  /* 최신 `w` 미러 — 위 머리주석의 X-6. 비동기 채점 핸들러의 클로저가 낡은 값을 들지 않게. */
  const wRef = useRef(w);
  useEffect(() => {
    wRef.current = w;
  }, [w]);

  const commit = (done?: boolean) => {
    const cur = wRef.current;
    setWork(sel.id, { summary: draft, done: done ?? cur?.done ?? false, updatedAt: new Date().toISOString() });
  };
  // 언마운트 안전망 — g키 라우트 이동·지문 전환처럼 blur 없이 떠나면 미커밋 초안이 유실됐다(SR-16).
  useFlushOnUnmount(() => {
    const cur = wRef.current;
    if ((cur?.summary ?? '') !== draft) {
      setWork(sel.id, { summary: draft, done: cur?.done ?? false, updatedAt: new Date().toISOString() });
    }
  });

  // 내 요약 채점 — 현재 초안을 원문과 대조(Ollama 스트리밍). 원문 요약은 시키지 않는다.
  // busy/preview/abort 는 grader(useAiStream)가 소유 — 여기선 성공·실패 처리만.
  const askCoach = async () => {
    if (grader.busy) return;
    if (!draft.trim()) {
      ui.toast('먼저 요약을 써 보세요.', 'warn');
      return;
    }
    commit(); // 채점 전 현재 초안 저장
    setCoach(null);
    const res = await grader.run(({ signal, onDelta }) => coachSummary(sel.text, draft, sel.lang, { signal, onDelta }));
    if (!res.ok) {
      // aborted(지문 전환·언마운트로 인한 취소)는 조용히, 그 외만 오류 토스트.
      if (!res.aborted) ui.toast('AI 채점 실패: ' + res.error, 'bad');
      return;
    }
    const cs = res.value;
    if (!cs.ok || !cs.feedback) {
      ui.toast(cs.error || '채점 실패', 'bad');
      return;
    }
    setCoach(cs.feedback);
    // 영속화 — 수십 초 걸린 채점을 이탈·새로고침에도 보존(최신 work 위에 coach 필드만 병합 · X-6).
    const cur = wRef.current;
    setWork(sel.id, {
      summary: cur?.summary ?? draft,
      done: cur?.done ?? false,
      updatedAt: cur?.updatedAt ?? new Date().toISOString(),
      coach: cs.feedback,
      coachAt: new Date().toISOString(),
    });
  };

  const en = sel.lang === 'en';
  // 요약 분량 표기 — KO 지문은 글자수 '자', EN 지문은 어절수 '단어'(지문 길이·독후감 단위와 정렬 · SR-7).
  const trimmed = draft.trim();
  const myCount = en ? (trimmed ? trimmed.split(/\s+/).length : 0) : trimmed.length;
  return (
    <div className="mt-3.5 flex-none rounded-lg border border-line bg-panel px-4 py-3.5">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm leading-text font-extrabold tracking-editor text-acc">
          {en ? '내 정리 (영어 공부 — 핵심 표현·해석)' : '내 요약 (직접 요약해 보기)'}
        </span>
        <span className="text-xs leading-text text-mut tabular-nums">
          {myCount}
          {en ? ' 단어' : '자'}
        </span>
      </div>
      <textarea
        className="min-h-24 resize-y rounded-md! bg-bg! px-3.25! py-2.75! text-base14! leading-text!"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit()}
        placeholder={
          en
            ? '모르는 단어·구문, 핵심 문장 해석, 이 글의 요지를 영어/한국어로 정리…'
            : '이 글을 한두 문단으로 요약해 보세요. 핵심 주장과 근거를 내 말로…'
        }
        aria-label="내 요약"
      />
      <div className="mt-2.5 flex gap-2">
        <Button sm variant={w?.done ? 'default' : 'primary'} onClick={() => commit(!w?.done)}>
          {w?.done ? '✓ 완료됨 — 되돌리기' : '요약 완료로 표시'}
        </Button>
        <Button
          sm
          onClick={() => void askCoach()}
          disabled={grader.busy || !online}
          title={online ? '' : WORKSPACE_UNSET}
        >
          {grader.busy ? (
            <>
              <span className="ds-spin" /> 채점 중…
            </>
          ) : (
            <>
              <Icon name="bot" /> AI 채점 받기
            </>
          )}
        </Button>
        <Button
          sm
          onClick={() => promote(sel)}
          disabled={promoted}
          title={promoted ? '이미 백로그로 보냈어요' : '보충 백로그로 보내기'}
        >
          {promoted ? (
            '✓ 보냄'
          ) : (
            <>
              <Icon name="inbox" /> 학습으로 보내기
            </>
          )}
        </Button>
      </div>

      {/* 진행 상태만 간결히 공지(sr-only) — 스트리밍 토큰은 장황해 읽지 않는다. */}
      {grader.busy && (
        <span
          role="status"
          style={{
            position: 'absolute',
            width: 1,
            height: 1,
            overflow: 'hidden',
            clip: 'rect(0 0 0 0)',
            whiteSpace: 'nowrap',
          }}
        >
          채점 중…
        </span>
      )}

      {/* 채점 스트리밍 미리보기 — 완성 문장부터 타이핑되듯(SR에는 위 상태만 공지). */}
      {grader.busy && grader.preview && (
        <p className="mt-3 mb-0 text-md break-words whitespace-pre-wrap text-mut" aria-hidden="true">
          {grader.preview}
        </p>
      )}

      <CoachResult coach={coach} saved={w} cardRef={coachResultRef} />
    </div>
  );
}

/** 2-pane 스켈레톤(markets 미러 · SR-17) — 목록 행 + 리더 라인 형상을 예고해 팝인 레이아웃 점프를 없앤다. */
function PracticeSkeleton() {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-reads gap-4.5 max-mobile:grid-cols-1 max-mobile:grid-rows-[auto_1fr] max-mobile:overflow-y-auto">
      <span className="ds-srOnly" role="status">
        지문 불러오는 중…
      </span>
      <aside className="flex min-h-0 flex-col gap-2.5" aria-hidden="true">
        <div className="flex min-h-0 flex-1 flex-col gap-1.5">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex flex-col gap-1.75 rounded-base border border-line bg-panel px-3.25 py-2.75">
              <Skeleton width="42%" height={12} />
              <Skeleton width="86%" height={14} />
              <Skeleton width="55%" height={11} />
            </div>
          ))}
        </div>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-col" aria-hidden="true">
        <div className="flex min-h-0 flex-1 flex-col gap-3 rounded-lg border border-line bg-panel px-6.5 py-5.5">
          <Skeleton width="30%" height={12} />
          <Skeleton width="78%" height={24} />
          <Skeleton width="100%" height={14} />
          <Skeleton width="100%" height={14} />
          <Skeleton width="93%" height={14} />
          <Skeleton width="97%" height={14} />
          <Skeleton width="60%" height={14} />
        </div>
      </div>
    </div>
  );
}

/** 지문 목록 한 줄 — 언어 태그·분야·진행 표시(✓ 완료 / ✎ 초안)·제목·출처·예상 읽기시간. */
function ArticleRow({
  a,
  w,
  selected,
  onSelect,
}: {
  a: Article;
  w?: ArticleWork;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const hasDraft = !w?.done && !!w?.summary?.trim();
  // 예상 읽기시간 — en≈200어절/분, ko≈500자/분(words 필드 재사용 · SR-18).
  const mins = Math.max(1, Math.ceil(a.words / (a.lang === 'en' ? 200 : 500)));
  return (
    <li>
      <button
        type="button"
        className={`${LIST_ITEM} ${selected ? 'border-acc! bg-acc-soft!' : 'bg-panel!'}`}
        onClick={() => onSelect(a.id)}
        aria-current={selected}
      >
        <span className="flex items-center gap-1.75">
          <span className={`${LANG_TAG} ${a.lang === 'en' ? 'bg-acc' : 'bg-good'}`}>
            {a.lang === 'en' ? 'EN' : 'KO'}
          </span>
          <span className="text-xs leading-auto font-bold text-mut">{a.field}</span>
          {w?.done ? (
            <span className="ml-auto text-sm leading-auto font-black text-good" title="요약 완료">
              ✓
            </span>
          ) : hasDraft ? (
            <span className="ml-auto text-sm leading-auto font-bold text-acc" title="작성 중인 초안 있음">
              ✎
            </span>
          ) : null}
        </span>
        <span className="line-clamp-2 text-base14 leading-tight font-bold text-txt">{a.title}</span>
        <span className="text-xs leading-auto text-mut tabular-nums">
          {a.source} · {a.words}
          {a.lang === 'en' ? ' words' : '자'} · 약 {mins}분
        </span>
      </button>
    </li>
  );
}

/**
 * AI 채점 결과 카드 — 결과가 없으면 아무것도 그리지 않는다.
 *
 * 방금 채점(transient)이 우선이고, 없으면 저장분(`work[id].coach`)으로 폴백해 이탈·새로고침
 * 후에도 보인다 — 그때는 '저장된 채점' 배지가 붙는다.
 *
 * ⚠ **옛 `coach.id === id` 태깅이 사라졌다**(F5 · 2026-08-01). 그 방어의 전제는 *한 에디터
 * 컴포넌트가 여러 지문을 차례로 섬긴다*였다 — 수십 초짜리 응답이 오기 전에 지문을 옮기면 옛
 * 채점이 새 지문 아래 붙었다. 이제 호출부가 `key={sel.id}` 로 리마운트하므로 **옛 응답이 착지할
 * 컴포넌트 자체가 없고**, 그 전에 언마운트 abort 가 스트림을 끊는다(H18). 태그를 남겨 두면
 * 사라진 위험에 대한 방어가 코드에 남아 다음 사람에게 *아직 그 위험이 있다*고 말한다.
 */
function CoachResult({
  coach,
  saved,
  cardRef,
}: {
  coach: CoachFeedback | null;
  saved?: ArticleWork;
  cardRef: React.Ref<HTMLDivElement>;
}) {
  const fb = coach ?? saved?.coach;
  const savedAt = coach ? undefined : saved?.coachAt;
  if (!fb) return null;
  return (
    <div
      className="mt-3 rounded-base border border-line-acc bg-acc-soft px-3.5 py-3"
      ref={cardRef}
      tabIndex={-1}
      aria-label="AI 채점 결과"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2.5">
        {typeof fb.score === 'number' && (
          <span
            className={`flex-none rounded-full px-3 py-0.5 text-lg leading-text font-black text-on-acc ${
              fb.score >= 70 ? 'bg-good' : 'bg-bad'
            }`}
          >
            {fb.score}점
          </span>
        )}
        {fb.comment && <span className="text-md font-semibold text-txt">{fb.comment}</span>}
        {savedAt && (
          <span className="ds-tiny text-mut" style={{ marginLeft: 'auto' }}>
            저장된 채점
          </span>
        )}
      </div>
      {fb.missing?.length ? <CoachList label="빠진 핵심" items={fb.missing} tone="miss" /> : null}
      {fb.redundant?.length ? <CoachList label="군더더기" items={fb.redundant} tone="mut" /> : null}
      {fb.accuracy?.length ? <CoachList label="정확성" items={fb.accuracy} tone="bad" /> : null}
      {fb.corrections?.length ? <CoachList label="바로잡기" items={fb.corrections} tone="bad" /> : null}
      {fb.key_expressions?.length ? (
        <CoachList label="핵심 표현" items={fb.key_expressions.map((k) => `${k.en} — ${k.ko}`)} tone="mut" />
      ) : null}
      {fb.model_summary && (
        <div className="mt-2.5 border-t border-line2 pt-2 text-md text-txt">
          <span className="mb-0.75 block text-xs leading-text font-extrabold text-acc">모범 요약</span>
          {fb.model_summary}
        </div>
      )}
    </div>
  );
}

/** 코치 피드백 항목 묶음(빠진 핵심·군더더기·정확성 등). */
function CoachList({ label, items, tone }: { label: string; items: string[]; tone: 'miss' | 'bad' | 'mut' }) {
  return (
    <div className="mt-2">
      <span className={`mb-0.75 inline-block text-xs leading-text font-extrabold tracking-label ${COACH_TONE[tone]}`}>
        {label}
      </span>
      <ul className="m-0 pl-4.5 text-md leading-text text-txt">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}
