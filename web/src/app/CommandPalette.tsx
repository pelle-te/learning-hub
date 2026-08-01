import { useEffect, useMemo, useState } from 'react';
import { Command, defaultFilter, useCommandState } from 'cmdk';
import { useNavigate } from 'react-router-dom';
import {
  paletteCommands,
  recordRecent,
  captureSubjects,
  commitCapture,
  semanticPalette,
  contentSearch,
  verbsFor,
  type ContentHit,
  type HitVerb,
} from '@/shell';
import { parseCapture, type CaptureResult } from '@/lib/quickCapture';
import { loadReads } from '@/lib/reads';
import { MOD_ENTER_LABEL, MOD_K_LABEL } from '@/lib/platform';
import { markVia } from '@/lib/visits';
import { Icon } from '@/components/Icon';
import type { SemHit, SemKind } from '@/lib/semantic';
import type { IconName } from '@/lib/iconPaths';

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
const OVERLAY =
  'fixed inset-0 z-[var(--z-palette)] bg-scrim backdrop-blur-palette animate-[enter-fade_var(--dur-fast)_ease]';
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
const HINT_BASE = 'rounded-full border px-2 py-0.5 text-xs leading-text';
// Q-10 — 컨테이너 `opacity` 대신 **의미 토큰**으로. 투명도는 자기 글자의 대비를 깎는다
// (a11y 게이트가 이미 두 번 물린 관용구 — `ds.css` 의 `ds-sub` 머리주석이 SSOT).
const HINT = HINT_BASE + ' border-line text-mut';
const HINT_CAP = HINT_BASE + ' border-acc-glow text-acc opacity-90';
const EMPTY = 'p-6 text-center text-md text-mut';
const FOOT = 'flex justify-between border-t border-line px-3.5 py-2 text-xs leading-text text-mut';
const BRAND = 'font-bold';
const GROUP_HEAD = 'block px-3 pt-2 pb-1 text-xs leading-text font-extrabold tracking-label text-acc uppercase';

/** 팔레트가 진로 지도에서 실제로 쓰는 전부 — key·이름·대분류명(H14 의 지연 적재 결과물). */
type AtlasEntry = { key: string; name: string; cat: string };

/* ⚠ 값은 **아이콘 이름**이다(`components/Icon`) — 이모지가 아니다(2026-08-01). 같은 개념이
   두 표에서 다른 글리프였던 자리이기도 하다(📚 vs 📗 이 둘 다 '학습 항목'). */
const SEM_ICON: Record<SemKind, IconName> = {
  chapter: 'books',
  summary: 'pencil',
  book: 'book',
  backlog: 'inbox',
  mistake: 'alert',
};
const CONTENT_ICON: Record<ContentHit['kind'], IconName> = {
  subject: 'books',
  chapter: 'books',
  book: 'book',
  backlog: 'inbox',
  weak: 'alert',
  mistake: 'alert',
};
const CONTENT_HINT: Record<ContentHit['kind'], string> = {
  subject: '학습 항목',
  chapter: '학습 항목',
  book: '읽을거리',
  backlog: '보충',
  weak: '반복 약점',
  mistake: '오답 메모',
};

/** 파싱 결과가 '캡처할 가치'가 있는지 — 제목만 남으면(날짜·과목·챕터 무) 일반 검색으로 둔다. */
function meaningful(c: CaptureResult | null): c is CaptureResult {
  return !!c && !!(c.dateISO || c.subject || c.chapter);
}

/** 파싱 결과를 한 줄 칩 요약으로(팔레트 힌트·확인 토스트 공용).
 *  ⚠ **시각 칩과 세션유형 칩이 여기서 사라졌다**(P-18). 근거는 `lib/quickCapture.ts` 머리주석 —
 *  요지는 그 둘이 *블록을 만들겠다는 약속*으로 읽히는데 이 경로는 블록을 만들지 않는다는 것이다.
 *  남은 셋은 전부 착지가 있다: 날짜·과목은 저널 프리필로, 챕터는 `topic`/원문으로. */
function summarize(c: CaptureResult): string {
  const parts: string[] = [];
  if (c.dateLabel) parts.push(c.dateLabel + (c.dateISO ? ` (${c.dateISO.slice(5)})` : ''));
  if (c.subject) parts.push(c.subject);
  if (c.chapter) parts.push(c.chapter);
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
/* ── Q-21 **객체 우선 팔레트** (2026-08-02) ────────────────────────────────────
   기본 항목이 **48개**(이동 22 + 액션 26)이고 그것들이 콘텐츠 히트와 **평평하게** 섞였다. 즉
   ⌘K 를 열면 제일 먼저 보이는 것이 *앱의 IA 를 다시 나열한 목록*이었다 — 레일이 이미 하는 일을
   한 번 더 하고, 정작 사용자가 찾는 객체(과목·챕터·보충·책)는 그 아래로 밀렸다.

   ## 시길 둘이 목록을 가른다 — 필터가 아니라 **의도 선언**이다

   · `>` — **명령만**. "무엇을 실행할지 이미 안다."
   · `@` — **이동만**. "어디로 갈지 이미 안다."
   · 없음 — **객체 우선**. 명령·탭은 검색어가 있을 때만 따라 나온다.

   ⚠⚠ **핵심은 마지막 줄이다.** 시길을 추가하는 것만으로는 아무것도 안 고쳐진다(아무도 안 치면
   기본 화면은 그대로 48개다). 기본 모드에서 **빈 검색어일 때 명령 목록을 접는 것**이 이 항목의
   실제 내용이고, 시길은 그렇게 접힌 것에 **여전히 한 글자로 닿는 길**이다. 접기만 하고 길을
   안 내면 그건 기능 삭제다.

   ⚠ 최근 명령(LRU)은 빈 검색어에서도 남는다 — `recordRecent` 가 쌓아 온 것이 정확히 "이 사람이
   실제로 쓰는 명령"이고, 그걸 숨기면 팔레트가 매번 처음부터가 된다.
   ⚠ 시길은 **첫 글자일 때만** 뜻을 갖는다. 검색어 중간의 `>` 는 그냥 글자다(챕터 제목에 화살표를
   쓰는 사람이 있다). 그리고 시길만 친 상태(`>` 한 글자)는 **빈 검색어와 같다** — 목록 전체를
   보여 줘야 고를 수 있다. */
export type PaletteMode = 'object' | 'command' | 'nav';
export interface PaletteQuery {
  mode: PaletteMode;
  /** 시길을 걷어낸 실제 검색어. 아래 모든 검색이 이것을 쓴다. */
  q: string;
}
export function parsePaletteQuery(raw: string): PaletteQuery {
  if (raw.startsWith('>')) return { mode: 'command', q: raw.slice(1).trim() };
  if (raw.startsWith('@')) return { mode: 'nav', q: raw.slice(1).trim() };
  return { mode: 'object', q: raw.trim() };
}

/** 빈 검색어의 객체 모드에서 남기는 최근 명령 수 — 48개 나열과 0개 사이의 타협점. */
export const RECENT_KEEP = 5;

export default function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  /* Q-21 — 입력에서 **의도(모드)** 와 **검색어**를 가른다. 아래 모든 검색은 `q` 를 쓴다(시길이
     검색어에 섞이면 `>테마` 가 아무것도 못 찾는다). 매칭은 cmdk 의 `defaultFilter` 에 그대로
     위임하되 시길만 벗겨 넘긴다 — 직접 `includes` 로 갈면 퍼지 매칭 품질을 잃는다. */
  const { mode, q } = useMemo(() => parsePaletteQuery(search), [search]);
  // 열릴 때만 계산(최근 명령 LRU가 외부에서 바뀌므로 재오픈 시 최신 순서 반영). 닫히면 빈 목록.
  const cmds = useMemo(() => (open ? paletteCommands() : []), [open]);
  /* Q-21 — **모드가 목록을 가른다.** 기본(객체) 모드에서 검색어가 비면 최근 명령 몇 개만 남긴다:
     48개 나열이 곧 "팔레트가 IA 를 재나열한다"의 실체였다. 시길 둘이 그렇게 접힌 것에 한 글자로
     닿는 길이고, `RECENT_KEEP` 근거는 `parsePaletteQuery` 머리주석에 있다.
     ⚠ `nav` 모드가 `id.startsWith('tab:')` 까지 보는 이유: **은퇴한 탭**은 `kind:'act'` 인데
     (착지 라우트로 보내야 해서) 여전히 *이동*이다. `kind` 만 보면 은퇴 탭이 이동 모드에서
     사라지고, 그건 불변식 ②가 잠근 "graph 가 ⌘K 에서 조용히 사라졌던" 그 형태다. */
  const shownCmds = useMemo(() => {
    if (mode === 'command') return cmds.filter((c) => c.kind === 'act' && !c.id.startsWith('tab:'));
    if (mode === 'nav') return cmds.filter((c) => c.kind === 'tab' || c.id.startsWith('tab:'));
    return q ? cmds : cmds.slice(0, RECENT_KEEP);
  }, [cmds, mode, q]);

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
      open && mode === 'object' && q
        ? parseCapture(
            q,
            new Date(),
            subjects.map((s) => s.name),
          )
        : null,
    [open, mode, q, subjects],
  );
  const showCapture = meaningful(cap);

  // E-6/C-3: 오프라인 통합 검색 — 학습 항목·독서·보충·반복약점을 부분문자열로(Ollama 불필요, 항상 동작).
  const content = useMemo(
    () => (open && readsSnap && mode === 'object' && q ? contentSearch(q, readsSnap) : []),
    [open, mode, q, readsSnap],
  );

  // 의미 검색(로컬 임베딩) — 350ms 디바운스, 늦은 응답은 버림. Ollama 불가면 조용히 빈 목록.
  // 짧은 질의는 렌더에서 걸러낸다(이펙트 내 동기 setState 회피 — 상태는 마지막 결과만 유지).
  const [semHits, setSemHits] = useState<SemHit[]>([]);
  useEffect(() => {
    if (!open || mode !== 'object') return;
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
  }, [open, mode, q]);
  const shownSem = mode === 'object' && q.length >= 2 ? semHits : [];

  /* 진로 지도 분야 인덱스 — **열릴 때 지연 적재**(H14 · 2026-07-30 감사).

     이 한 줄이 `import { FIELDS } from '@/lib/atlas'` 였는데, 팔레트는 App 이 정적으로 끌고
     App 은 부팅 직후 항상 로드된다 → 811줄 시드(`atlasData.ts` · 실측 **14.2 KB gz** 청크)가
     데스크톱 콜드 스타트의 두 번째 웨이브에 무조건 실렸다. 그런데 여기서 쓰는 것은 분야 25개의
     **key·이름·대분류명뿐**이고, 그마저 `search.trim()` 이 있을 때만 그린다.
     ⚠ 엔트리 예산(`npm run budget` 축 ①)은 App 이 동적 import 라 이 비용을 **못 본다** —
     "게이트가 녹색이니 없다"가 성립하지 않는 자리다(축 ②의 총합에만 잡혔다).

     인덱스를 손으로 베껴 두지 않는다 — 그건 이 저장소가 반복해 물린 SSOT 사본이다. 대신
     원본을 그대로 두고 **적재 시점만** 옮긴다. 실패해도 이 그룹만 비고 팔레트는 계속 돈다
     (부팅 청크와 달리 여기는 부분 기능이라 조용한 폴백이 맞다). */
  const [atlasFields, setAtlasFields] = useState<AtlasEntry[]>([]);
  useEffect(() => {
    if (!open || atlasFields.length) return;
    let stale = false;
    void import('@/lib/atlas')
      .then(({ FIELDS, categoryOf }) => {
        if (stale) return;
        setAtlasFields(FIELDS.map((f) => ({ key: f.key, name: f.name, cat: categoryOf(f)?.name ?? '' })));
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [open, atlasFields.length]);

  /** 캡처 실행 — **언제나 커밋**한다(E2). 파싱 결과가 있으면 함께 실린다. */
  const runCapture = () => {
    commitCapture(q, meaningful(cap) ? summarize(cap) : '');
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
  /* ⚠ **E2 이후 갈래가 없다.** 종전엔 여기서 두 경로로 갈렸고(구조화=프리필+화면 이동 /
     생 문장=즉시 저장), 그래서 **입력이 정교할수록 덜 저장되는** 역전이 있었다. 지금은 어느
     쪽이든 커밋하고, 파싱 결과는 버려지는 대신 레코드에 실린다(`commitCapture` 머리주석). */
  const captureNow = () => {
    // Q-21 — 시길은 의도 선언이지 문장의 일부가 아니다. 객체 모드에서만 캡처가 성립한다.
    if (mode !== 'object' || !q) return;
    runCapture();
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
      /* Q-21 — 시길만 벗겨 cmdk 의 기본 매칭에 **그대로 위임한다.** 직접 `includes` 로 갈면
         퍼지 매칭(오타·머리글자)을 잃고, 그건 시길이 주는 것보다 크게 잃는 것이다. */
      filter={(value, raw, keywords) => defaultFilter(value, parsePaletteQuery(raw).q, keywords)}
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
                <span className={LABEL}>
                  <Icon name="pin" /> 빠른 캡처 — 보충에 담기
                </span>
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
                      <Icon name={CONTENT_ICON[h.kind]} /> {h.label}
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
                      <Icon name={SEM_ICON[h.kind]} /> {h.label}
                    </span>
                    <span className={HINT}>{Math.round(h.sim * 100)}% 유사</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            {/* 진로 지도 분야 바로가기 — 검색어가 있을 때만(빈 상태 28개 홍수 방지). cmdk 부분문자열 필터가 좁힌다.
                ⚠ `atlasFields.length` 도 함께 본다 — 시드가 지연 적재라(H14) 첫 프레임엔 비어 있고,
                   그때 그룹만 렌더하면 항목 없는 머리글이 한 프레임 스친다. */}
            {mode === 'object' && q && atlasFields.length > 0 && (
              <Command.Group heading={<span className={GROUP_HEAD}>진로 지도 — 분야</span>}>
                {atlasFields.map((f) => (
                  <Command.Item
                    key={'atlas:' + f.key}
                    value={`atlas ${f.name} ${f.cat}`}
                    className={ITEM}
                    onSelect={() => {
                      close();
                      go(`/atlas/${f.key}`);
                    }}
                  >
                    <span className={LABEL}>
                      <Icon name="radio" /> {f.name}
                    </span>
                    <span className={HINT}>진로 지도</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            {shownCmds.map((c) => (
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
                      c.run?.(); // ⚠ 이동만 하는 항목은 `run` 이 없다(P3 — `act:graph`).
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
              <b>↑↓</b> 이동 · <b>Enter</b> 실행 ·{' '}
              {/* Q-21 — 시길은 안 보이면 없는 것과 같다(D-2 가 캡처에서 세운 그 규율). 지금 쓰고
                  있는 모드를 액센트로 표시해, 무엇이 걸러지고 있는지를 목록이 아니라 힌트가 말한다. */}
              <b className={mode === 'command' ? 'text-acc' : undefined}>&gt;</b> 명령 ·{' '}
              <b className={mode === 'nav' ? 'text-acc' : undefined}>@</b> 이동
            </>
          )}
        </span>
        {canDrill ? (
          <span className="text-acc">
            <b>→</b> 이 항목으로 할 일
          </span>
        ) : (
          <span className={mode === 'object' && q ? 'text-acc' : undefined}>
            <b>{MOD_ENTER_LABEL}</b> 캡처 — 보충에 담기
          </span>
        )}
        <span className={BRAND}>{MOD_K_LABEL}</span>
      </div>
    </Command.Dialog>
  );
}
