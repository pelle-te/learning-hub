import { useEffect, useMemo, useState } from 'react';
import { Command, useCommandState } from 'cmdk';
import { useNavigate } from 'react-router-dom';
import {
  paletteCommands,
  recordRecent,
  captureSubjects,
  runQuickCapture,
  captureToBacklog,
  semanticPalette,
  contentSearch,
  verbsFor,
  type ContentHit,
  type HitVerb,
} from '@/shell';
import { parseCapture, type CaptureResult } from '@/lib/quickCapture';
import { loadReads } from '@/lib/reads';
import { MOD_ENTER_LABEL, MOD_K_LABEL } from '@/lib/platform';
import { FIELDS, categoryOf } from '@/lib/atlas';
import { markVia } from '@/lib/visits';
import type { SemHit, SemKind } from '@/lib/semantic';

/* ── C-7 컴포넌트 티어 이식(Tailwind) ──────────────────────────────────────────
   ⚠⚠ **검색 입력은 "한 번도 적용된 적 없는 CSS" 였고, 2026-07-24 에 되살렸다(사용자 결정).**
   `.input` 이 선언한 padding(16/18px)·투명 배경·하단만 보더·`color:inherit` 는 전부 죽어 있었다 —
   cmdk 가 `<input type="text">` 로 렌더하는데 언레이어드 전역 `input[type='text']`(명시도 0,1,1)이
   모듈 클래스(0,1,0)를 이겼기 때문이다. 실제 렌더는 앱 공통 입력(패딩 8/10 · 라운드 7 · 패널 배경 ·
   사방 1px 보더)이었다(계산 스타일 덤프로 확인). 팔레트는 다이얼로그 자체가 이미 테두리·라운드를
   갖는데 그 안에 또 입력 상자가 그려져 이중 액자였다 — 의도대로 **경계 없는 검색줄**로 되돌린다.
   ⚠ 유틸리티는 언레이어드를 못 이기므로 **전역이 세우는 속성마다 `!` 가 필요하다.** 그리고 보더는
   `border-0!` + `border-b!` 로 겹쳐 쓰지 않는다(§15-8 ② — 같은 속성을 두 유틸이 나눠 가지면
   방출 순서로 갈린다) → 변마다 하나씩 소유하게 `border-x-0!`·`border-t-0!`·`border-b!` 로 쓴다.
   포커스 링은 두지 않는다 — 팔레트가 열리면 이 입력이 **항상** 포커스라 링이 상태를 구분하지 못한다.

   그리고 `.semGroup [cmdk-group-heading]` 은 **우리가 만들지 않는 DOM**이라 규약 4 의 "자식에
   직접 클래스"를 쓸 수 없다. cmdk 의 `heading` 이 ReactNode 를 받으므로 **스타일된 노드를 직접
   넘긴다** — 바깥 `[cmdk-group-heading]` div 는 아무 스타일도 없어 패딩을 안쪽으로 옮겨도
   박스가 동일하다(덤프로 확인). 자손 셀렉터를 되살리지 않는 유일한 길이다. */
const OVERLAY = 'fixed inset-0 z-[var(--z-palette)] bg-scrim backdrop-blur-palette animate-[enter-fade_0.12s_ease]';
const CONTENT = 'fixed top-palette-y left-1/2 z-[var(--z-palette-top)] w-palette max-w-palette -translate-x-1/2';
const DIALOG = 'overflow-hidden rounded-palette border border-line bg-panel text-txt shadow-float';
const INPUT =
  'w-full rounded-none! border-x-0! border-t-0! border-b! border-line! bg-transparent! px-4.5! py-4! text-palette-input! outline-none!';
const LIST = 'max-h-palette-list overflow-auto p-1.5';
/* ⚠ 배경은 두 곳이 갖는다 — 선택 상태(0,2,0)가 캡처 틴트(0,1,0)를 이기는 원본 관계가
   Tailwind 에서도 그대로 성립한다(`data-[…]` 변형이 속성 셀렉터를 붙이므로). */
const ITEM =
  'flex cursor-pointer items-center justify-between gap-3 rounded-chip px-3 py-2.5 select-none data-[selected=true]:bg-acc-soft';
const CAPTURE = 'relative mb-1 border border-acc-glow bg-tint-acc-6';
const LABEL = 'text-base14';
/* 힌트 칩 — base 는 기하만 갖고 **색·보더색·투명도는 변형이 통째로 소유**한다(§15-8 ②). */
const HINT_BASE = 'rounded-full border px-2 py-0.5 text-xs leading-[1.6]';
const HINT = HINT_BASE + ' border-line opacity-60';
const HINT_CAP = HINT_BASE + ' border-acc-glow text-acc opacity-90';
const EMPTY = 'p-6 text-center text-md opacity-60';
const FOOT = 'flex justify-between border-t border-line px-3.5 py-2 text-xs leading-[1.6] opacity-70';
const BRAND = 'font-bold';
const GROUP_HEAD = 'block px-3 pt-2 pb-1 text-xs leading-[1.6] font-extrabold tracking-label text-acc uppercase';

const SEM_ICON: Record<SemKind, string> = { chapter: '📚', summary: '📝', book: '📖', backlog: '📥' };
const CONTENT_ICON: Record<ContentHit['kind'], string> = {
  subject: '📗',
  chapter: '📚',
  book: '📖',
  backlog: '📥',
  weak: '⚠️',
};
const CONTENT_HINT: Record<ContentHit['kind'], string> = {
  subject: '학습 항목',
  chapter: '학습 항목',
  book: '읽을거리',
  backlog: '보충',
  weak: '반복 약점',
};

const TYPE_LABEL: Record<NonNullable<CaptureResult['sessionType']>, string> = {
  anki: 'Anki',
  new: '새 학습',
  rev: '복습',
  blank: '백지',
  mock: '모의',
};

/** 파싱 결과가 '캡처할 가치'가 있는지 — 제목만 남으면(날짜·시간·유형·과목 무) 일반 검색으로 둔다. */
function meaningful(c: CaptureResult | null): c is CaptureResult {
  return !!c && !!(c.dateISO || c.minute != null || c.sessionType || c.subject || c.chapter);
}

/** 파싱 결과를 한 줄 칩 요약으로(팔레트 힌트·확인 토스트 공용). */
function summarize(c: CaptureResult): string {
  const parts: string[] = [];
  if (c.dateLabel) parts.push(c.dateLabel + (c.dateISO ? ` (${c.dateISO.slice(5)})` : ''));
  if (c.timeLabel) parts.push(c.timeLabel);
  if (c.subject) parts.push(c.subject);
  if (c.chapter) parts.push(c.chapter);
  if (c.sessionType) parts.push(TYPE_LABEL[c.sessionType]);
  return parts.join(' · ');
}

/* cmdk 항목의 `value` 는 매칭 문자열이자 선택 식별자다. 두 용도가 한 문자열이라 **만드는
   곳과 되찾는 곳이 반드시 같은 규칙**을 써야 한다 — 손으로 두 번 적으면 검색어가 바뀔 때
   조용히 어긋나고, 증상은 "→ 를 눌러도 아무 일도 안 일어남"이다(N-1). */
const contentValue = (h: ContentHit, search: string) => 'content ' + h.id + ' ' + search;
const verbValue = (v: HitVerb) => 'verb ' + v.id;

/** 결과 0건 안내.
 *
 *  ⚠ `filtered.count` 는 **forceMount 항목을 세지 않는다**(cmdk 는 forceMount 면 아예 등록을
 *  건너뛴다 — 실측). 이 팔레트의 캡처·통합검색·의미검색 결과가 전부 forceMount 라, 이 값은
 *  정확히 "명령·탭·분야 중 매칭 0"을 뜻한다. 그래서 다른 결과가 이미 있으면 가려낸다.
 *
 *  ⚠ **D-2 이전엔 여기가 캡처의 유일한 입구였다** — 결과가 0건일 때만 "보충에 담기" 행을
 *  띄웠다. 그래서 친 문장이 내가 공부 중인 무언가를 언급하는 순간(=검색이 히트하는 순간)
 *  캡처가 사라졌다. 지금은 캡처가 {@link MOD_ENTER_LABEL} 로 **항상** 도달 가능하므로 여기는
 *  안내만 한다(그 안내가 곧 발견 경로다). */
function NoMatchFallback({ search, suppressed }: { search: string; suppressed: boolean }) {
  const none = useCommandState((s) => s.filtered.count === 0);
  const q = search.trim();
  if (!none || suppressed) return null;
  if (!q) return <div className={EMPTY}>일치하는 명령이 없어요</div>;
  return <div className={EMPTY}>일치하는 명령이 없어요 — {MOD_ENTER_LABEL} 로 지금 친 문장을 그대로 캡처</div>;
}

/* CommandPalette — cmdk 기반 ⌘K 팔레트(손코딩 ui-command.js 대체, 설계도 §3).
   명령 목록은 네이티브 shell/palette(탭+액션)에서. 이동은 React Router, 액션은 shell/actions를 호출.
   open/onOpenChange는 부모(App)가 소유 — 전역 단축키도 거기서. */
export default function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  // 열릴 때만 계산(최근 명령 LRU가 외부에서 바뀌므로 재오픈 시 최신 순서 반영). 닫히면 빈 목록.
  const cmds = useMemo(() => (open ? paletteCommands() : []), [open]);
  // 과목 스냅샷(파서 입력) — 열릴 때만. store 접근은 shell(captureSubjects)에 위임(components→store 금지).
  const subjects = useMemo(() => (open ? captureSubjects() : []), [open]);
  // C-1: 읽을거리 스냅샷도 열릴 때 1회만 — contentSearch가 타이핑 매 키마다 localStorage 재파싱하던 것 제거.
  const readsSnap = useMemo(() => (open ? loadReads() : null), [open]);

  // 닫힐 때 입력 초기화(이벤트 핸들러에서 — effect 내 setState 회피). 캡처 실행/Esc 모두 이 경로로.
  const close = () => {
    setSearch('');
    onOpenChange(false);
  };

  /* N-11 — 팔레트발 내비게이션은 **이름을 알고 찾아간 것**이라 레일 클릭과 뜻이 다르다.
     레일에서 지운 목적지가 여기서 계속 열린다면 그건 "안 쓰이는 탭"이 아니라 "숨겨 둔 탭"이다.
     `close()` 에 붙이지 않는 이유: 캡처·Esc 도 그 경로를 지나 내비게이션 없이 닫는다. */
  const go = (to: string) => {
    markVia('palette');
    navigate(to, { viewTransition: true });
  };

  // 자연어 빠른 캡처 — 입력을 파싱해 날짜·시간·과목·유형을 뽑는다(예: "내일 오후 3시 알고리즘 2챕터 복습").
  // 순수 lib(quickCapture)라 여기선 결과만 미리보고, 선택 시 shell 액션으로 기록 프리필에 넘긴다.
  const cap = useMemo(
    () =>
      open && search.trim()
        ? parseCapture(
            search,
            new Date(),
            subjects.map((s) => s.name),
          )
        : null,
    [open, search, subjects],
  );
  const showCapture = meaningful(cap);

  // E-6/C-3: 오프라인 통합 검색 — 학습 항목·독서·보충·반복약점을 부분문자열로(Ollama 불필요, 항상 동작).
  const content = useMemo(
    () => (open && readsSnap && search.trim() ? contentSearch(search, readsSnap) : []),
    [open, search, readsSnap],
  );

  // 의미 검색(로컬 임베딩) — 350ms 디바운스, 늦은 응답은 버림. Ollama 불가면 조용히 빈 목록.
  // 짧은 질의는 렌더에서 걸러낸다(이펙트 내 동기 setState 회피 — 상태는 마지막 결과만 유지).
  const [semHits, setSemHits] = useState<SemHit[]>([]);
  useEffect(() => {
    if (!open) return;
    const q = search.trim();
    if (q.length < 2) return;
    let stale = false;
    const t = setTimeout(() => {
      semanticPalette(q)
        .then((hits) => {
          if (!stale) setSemHits(hits);
        })
        .catch(() => {});
    }, 350);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [open, search]);
  const shownSem = search.trim().length >= 2 ? semHits : [];

  const runCapture = () => {
    if (!cap) return;
    runQuickCapture(cap, summarize(cap));
    go('/journal');
  };

  /* ── D-2 캡처는 조건부이면 캡처가 아니다 ──────────────────────────────────
     예전엔 캡처 행이 "결과 0건일 때"(생 텍스트) 또는 "파서가 토큰을 뽑았을 때"(구조화)만
     떴다. 그래서 **친 문장이 내가 공부 중인 무언가를 언급하는 순간 캡처가 사라졌다** —
     "변위전류 유도 못 따라감"은 챕터를 히트시키므로 검색 결과가 뜨고, 그러면 담을 곳이
     없어진다. 캡처는 떠오른 것을 잃지 않으려고 있는 기능이라 조건부면 존재 이유가 없다.

     ⚠ **첫 줄 고정을 안 한다.** 캡처 행을 목록 맨 위에 박으면 `⌘K → t → Enter`(탭 이동)
     근육기억이 통째로 깨진다 — Enter 는 계속 '선택한 항목 실행'이고, 캡처는 전용 키를 갖는다.
     정확한 목표는 "1급 시민"이 아니라 **"항상 도달 가능"**이다.

     ⚠ cmdk 는 자기 키 처리 **전에** 이 핸들러를 부르고 `defaultPrevented` 를 존중한다
     (dist 실측) → preventDefault 로 Enter 의 기본 동작(선택 항목 실행)을 정확히 가로챈다. */
  const captureNow = () => {
    const q = search.trim();
    if (!q) return;
    // 파서가 뭔가 뽑았으면 구조화 캡처(기록 프리필), 아니면 친 문장 그대로 보충으로.
    // 뒤쪽이 중요하다 — 프리필은 과목·날짜만 나르므로 생 문장은 거기서 **사라진다**.
    if (meaningful(cap)) runCapture();
    else captureToBacklog(q);
    close();
  };

  /* ── N-1 명사 → 동사 ──────────────────────────────────────────────────────
     히트 위에서 `→`/`Tab` 을 누르면 **그 객체의 동사 목록**으로 내려간다. 종전엔 팔레트가
     찾아주고 데려다만 줘서, "이 약점을 보충에 담기"는 화면을 옮겨 그 항목을 다시 찾아
     버튼을 누르는 4클릭이었다.

     ⚠ **선택 값을 제어한다**(`value`/`onValueChange`). cmdk 는 비제어일 때 선택 항목을
     알려 주지 않는데, "지금 무엇 위에 있나"를 모르면 `→` 가 어떤 객체의 동사를 열지 알 수
     없다. 제어로 바꾼 대가로 **자동 첫 항목 선택이 사라지므로** 단계 전환마다 직접 세운다.

     ⚠ `→` 는 캐럿이 **입력 끝에 있을 때만** 가로챈다. 안 그러면 검색어 중간을 고치려고
     오른쪽으로 움직이는 것이 화면을 갈아 치운다(텍스트 편집을 뺏는 단축키는 결함이다).
     `Tab` 은 그 모호함이 없어 무조건 받는다. */
  const [sel, setSel] = useState('');
  const [verbHit, setVerbHit] = useState<ContentHit | null>(null);
  const verbs = useMemo(() => (verbHit ? verbsFor(verbHit) : []), [verbHit]);
  // 검색어가 값에 섞여 있어(cmdk 매칭용) 역참조가 필요하다 — id 문자열 파싱보다 정직하다.
  const hitByValue = useMemo(() => new Map(content.map((h) => [contentValue(h, search), h])), [content, search]);
  const selectedHit = verbHit ? null : (hitByValue.get(sel) ?? null);
  const canDrill = !!selectedHit && verbsFor(selectedHit).length > 0;

  const openVerbs = (h: ContentHit) => {
    const vs = verbsFor(h);
    if (!vs.length) return;
    setVerbHit(h);
    setSel(verbValue(vs[0]!)); // 제어 값이라 첫 항목을 직접 세운다(위 ⚠)
  };
  const backToHits = () => {
    const h = verbHit;
    setVerbHit(null);
    if (h) setSel(contentValue(h, search)); // 왔던 자리로 — 되돌아왔는데 커서가 딴 데면 길을 잃는다
  };

  /** 팔레트가 닫힐 때 동사 단계도 함께 접는다 — 다음 ⌘K 가 남의 객체 위에서 열리면 안 된다. */
  const closeAll = () => {
    setVerbHit(null);
    setSel('');
    close();
  };

  return (
    <Command.Dialog
      open={open}
      /* ⚠ Esc 를 여기서 받는다(N-1). Radix 는 Escape 를 **document 캡처 단계**에서 처리하므로
         우리 `onKeyDown`(버블)은 언제나 한 발 늦고, `preventDefault` 도 이미 소용이 없다.
         그리고 cmdk 의 `Command.Dialog` 는 Radix **루트** props 만 받아 `onEscapeKeyDown` 이
         닿지 않는다(dist 타입 확인). 남는 정직한 접점이 "닫아 달라는 요청"인 이 콜백이다.

         동사 단계에서 닫기 요청은 **한 단계만** 접는다 — 잘못 들어왔을 때 친 검색어까지
         잃으면 다시 치게 되고, 그건 이 항목이 없애려던 마찰이다.
         ⚠ 알려진 비대칭: 이 접점은 Esc 와 바깥 클릭을 구분하지 못해 **바깥 클릭도 한 단계만**
         접는다(한 번 더 눌러야 닫힌다). 중첩 메뉴의 통상 동작과 같은 방향이고, 구분하려면
         Radix 레이어 내부에 손을 넣어야 해서 값보다 결합이 크다. */
      onOpenChange={(v) => {
        if (v) return onOpenChange(true);
        if (verbHit) return backToHits();
        closeAll();
      }}
      label="명령 팔레트"
      className={DIALOG}
      overlayClassName={OVERLAY}
      contentClassName={CONTENT}
      value={sel}
      onValueChange={setSel}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        // ⌘Enter 캡처는 **동사 단계에서도** 산다(D-2 의 "무조건 성립"은 단계에 걸리지 않는다).
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          captureNow();
          return;
        }
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const el = e.target as HTMLInputElement;
        const atEnd = el.selectionStart == null || el.selectionStart >= (el.value?.length ?? 0);
        const atStart = el.selectionStart == null || el.selectionStart === 0;
        if (!verbHit && selectedHit && (e.key === 'Tab' || (e.key === 'ArrowRight' && atEnd))) {
          e.preventDefault();
          openVerbs(selectedHit);
          return;
        }
        // ⚠ Esc 는 여기서 안 받는다 — Radix 가 **캡처 단계**에서 먼저 가져가 이 핸들러는
        //   언제나 한 발 늦는다. 뒤로 가기는 `onOpenChange` 가 소유한다(그쪽 주석이 근거).
        if (verbHit && (e.key === 'Tab' || (e.key === 'ArrowLeft' && atStart))) {
          e.preventDefault();
          backToHits();
        }
      }}
    >
      <Command.Input
        value={search}
        onValueChange={setSearch}
        className={INPUT}
        placeholder="명령·탭 검색, 또는 빠른 캡처 (예: 내일 오후 3시 알고리즘 복습)"
        /* 팔레트가 열리는 유일한 경로는 사용자의 명시적 ⌘K 다. 열릴 때 입력에 포커스가 가는 건
           combobox/팔레트의 표준 동작이고, 없으면 오히려 키보드 사용자가 아무 데도 못 간다.
           no-autofocus 의 원래 대상은 '페이지 로드 시 강제 포커스'라 여기엔 해당 없음. */
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
      />
      <Command.List className={LIST}>
        {/* ── N-1 동사 단계 ─────────────────────────────────────────────────
            동사 목록일 땐 **다른 것을 아무것도 안 그린다.** 명령·탭이 함께 보이면 지금
            무엇에 대해 말하고 있는지가 흐려지고, 그 순간 동사가 엉뚱한 객체에 작용한 것처럼
            읽힌다(실제로는 안 그래도 그렇게 보이는 것으로 충분히 나쁘다).
            `forceMount` — 검색어는 객체를 찾을 때 쓴 말이라 동사 라벨과 안 맞는다. */}
        {verbHit ? (
          <Command.Group heading={<span className={GROUP_HEAD}>{verbHit.label}</span>} forceMount>
            {verbs.map((v) => (
              <Command.Item
                key={v.id}
                forceMount
                value={verbValue(v)}
                className={ITEM}
                onSelect={() => {
                  try {
                    v.run();
                  } catch (e) {
                    console.error(e);
                  }
                  closeAll();
                  if (v.to) go(v.to);
                }}
              >
                <span className={LABEL}>{v.label}</span>
                <span className={HINT}>{v.hint}</span>
              </Command.Item>
            ))}
          </Command.Group>
        ) : (
          <>
            <NoMatchFallback search={search} suppressed={showCapture || content.length > 0 || shownSem.length > 0} />
            {showCapture && cap && (
              <Command.Item
                key="quick-capture"
                forceMount
                value={'quick-capture ' + search}
                className={`${ITEM} ${CAPTURE}`}
                onSelect={() => {
                  try {
                    runCapture();
                  } catch (e) {
                    console.error(e);
                  }
                  close();
                }}
              >
                <span className={LABEL}>📌 빠른 캡처 — 기록에 남기기</span>
                <span className={HINT_CAP}>{summarize(cap)}</span>
              </Command.Item>
            )}
            {/* E-6 오프라인 통합 검색 — 학습 항목·독서 부분문자열(forceMount: 자체 매칭이 기준). */}
            {content.length > 0 && (
              <Command.Group heading={<span className={GROUP_HEAD}>빠른 검색 — 학습 항목·독서</span>} forceMount>
                {content.map((h) => (
                  <Command.Item
                    key={h.id}
                    forceMount
                    value={contentValue(h, search)}
                    className={ITEM}
                    onSelect={() => {
                      close();
                      go(h.to);
                    }}
                  >
                    <span className={LABEL}>
                      {CONTENT_ICON[h.kind]} {h.label}
                    </span>
                    <span className={HINT}>{CONTENT_HINT[h.kind]}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            {/* 의미 검색 결과 — cmdk 부분문자열 필터를 우회(forceMount): 임베딩 유사도가 매칭 기준. */}
            {shownSem.length > 0 && (
              <Command.Group heading={<span className={GROUP_HEAD}>의미 검색 — 내 학습 자산</span>} forceMount>
                {shownSem.map((h) => (
                  <Command.Item
                    key={'sem:' + h.id}
                    forceMount
                    value={'semantic ' + h.id + ' ' + search}
                    className={ITEM}
                    onSelect={() => {
                      close();
                      go(h.to);
                    }}
                  >
                    <span className={LABEL}>
                      {SEM_ICON[h.kind]} {h.label}
                    </span>
                    <span className={HINT}>{Math.round(h.sim * 100)}% 유사</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            {/* 진로 지도 분야 바로가기 — 검색어가 있을 때만(빈 상태 28개 홍수 방지). cmdk 부분문자열 필터가 좁힌다. */}
            {search.trim() && (
              <Command.Group heading={<span className={GROUP_HEAD}>진로 지도 — 분야</span>}>
                {FIELDS.map((f) => (
                  <Command.Item
                    key={'atlas:' + f.key}
                    value={`atlas ${f.name} ${categoryOf(f)?.name ?? ''}`}
                    className={ITEM}
                    onSelect={() => {
                      close();
                      go(`/atlas/${f.key}`);
                    }}
                  >
                    <span className={LABEL}>📡 {f.name}</span>
                    <span className={HINT}>진로 지도</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            {cmds.map((c) => (
              <Command.Item
                key={c.id}
                value={c.label + ' ' + c.hint}
                className={ITEM}
                onSelect={() => {
                  close();
                  recordRecent(c.id); // 최근 명령 LRU — 다음 ⌘K에서 위로.
                  try {
                    if (c.kind === 'tab') go('/' + c.key);
                    else {
                      c.run();
                      // 액션이 특정 탭에서 이어지는 경우(집중 시작·기록 프리필) 실행 후 이동.
                      if (c.to) go(c.to);
                    }
                  } catch (e) {
                    console.error(e);
                  }
                }}
              >
                <span className={LABEL}>{c.label}</span>
                <span className={HINT}>{c.hint}</span>
              </Command.Item>
            ))}
          </>
        )}
      </Command.List>
      {/* D-2 — 캡처의 발견 경로. 전용 키는 안 보이면 없는 것과 같아, 힌트 바가 곧 어포던스다.
          입력이 있을 때만 액센트로 올라온다(늘 밝으면 다섯 힌트가 서로를 죽인다 · D-6 과 같은 규율). */}
      {/* D-2 — 캡처의 발견 경로. N-1 의 `→` 도 같은 자리에서 배운다: 전용 키는 안 보이면
          없는 것과 같다. 액센트는 **지금 쓸 수 있을 때만** 켜진다(늘 밝으면 힌트가 서로를 죽인다). */}
      <div className={FOOT}>
        <span>
          {verbHit ? (
            <>
              <b>↑↓</b> 이동 · <b>Enter</b> 실행 · <b>←</b> 뒤로
            </>
          ) : (
            <>
              <b>↑↓</b> 이동 · <b>Enter</b> 실행 · <b>Esc</b> 닫기
            </>
          )}
        </span>
        {canDrill ? (
          <span className="text-acc">
            <b>→</b> 이 항목으로 할 일
          </span>
        ) : (
          <span className={search.trim() ? 'text-acc' : undefined}>
            <b>{MOD_ENTER_LABEL}</b> {showCapture ? '캡처 — 기록' : '캡처 — 보충'}
          </span>
        )}
        <span className={BRAND}>{MOD_K_LABEL}</span>
      </div>
    </Command.Dialog>
  );
}
