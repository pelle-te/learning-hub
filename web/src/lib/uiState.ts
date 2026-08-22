/* ============================================================
   uiState.ts — UI 환경설정의 단일 원천(영속). 앱 데이터(study_planner_v3)와 분리된
   '뷰 선택·최근 명령' 같은 가벼운 기기별 설정을 한 키로 모은다.
   목적: 산재하던 localStorage 키(sched_view·lh_recent_cmds)를 단일화 + 스키마 검증 + 테스트 가능.
   useApp과 동일한 KV 주입 패턴(순수)이라 노드/테스트에서도 그대로 동작.
============================================================ */
import * as z from 'zod/mini';
import { ThemeSchema } from './schema';
import type { KV, Theme } from './types';

// 배치 세그먼트 뷰(계획개편 §12-5) — [배분·주·일·월]. 배분(alloc)=주간 배분 보드(계획의 중심 · v2).
// 구 값(overview·cards)은 주(week)로 흡수.
export const SchedViewSchema = z.enum(['day', 'week', 'month']);
export type SchedView = z.infer<typeof SchedViewSchema>;
/** 레거시 뷰명 → 현행 매핑. 저장본·딥링크·구 fixture 호환(무마이그레이션).
    overview/cards = 옛 주 뷰 이름 · alloc = 옛 '배분' 뷰(재개편 v4에서 독립 세그먼트로 승격돼
    캘린더의 뷰가 아니게 됐다 → 주 뷰로 착지시킨다. 배분을 보려면 /alloc 세그먼트로). */
export function migrateSchedView(v: unknown): SchedView | undefined {
  if (v === 'overview' || v === 'cards' || v === 'alloc') return 'week';
  return v === 'day' || v === 'week' || v === 'month' ? v : undefined;
}

/** 네온 액센트 노브 — tokens.css의 [data-accent] 프리셋과 1:1.
 *  ⚠ **기본값은 `lime` 이다**(아래 `.default('lime')`). 이 주석은 "기본 violet"이라 적고 있었고,
 *  a11y 원장이 이미 그 드리프트를 지목했는데 미해소로 남아 있었다(2026-07-26 감사에서 정정).
 *  `violet` 은 전용 프리셋이 없는 **베이스 색**이라 코드가 그걸 "기본"으로 다루는 자리가 따로
 *  있다(`Settings.readAccentPreviews`) — 두 뜻이 겹쳐 주석이 낡은 채로 살아남았다. */
export const AccentSchema = z.enum(['violet', 'lime', 'cyan', 'amber']);
export type Accent = z.infer<typeof AccentSchema>;

/* ⚠ `navSurface`(나브 표면 영속)는 **N-6 에서 사라졌다**. 옛 저장에 남아 있어도 zod 가
   모르는 키를 버리므로 마이그레이션이 필요 없다 — 표면이라는 개념 자체가 없어졌다. */
// enum이 선언순 tuple을 보존 → 목록 재기입 없이 스키마에서 파생(SSOT). 소비처 타입 유지 위해 spread.
export const ACCENTS: Accent[] = [...AccentSchema.options];

export const RECENT_MAX = 6; // 팔레트 최근 명령 LRU 길이

export const UIStateSchema = z.object({
  // preprocess로 구 값을 흡수하고, 그래도 못 맞추면 .catch로 폴백 — schedView 하나가
  // 전체 UIState parse를 깨 accent·최근명령까지 기본값으로 되돌리던 것을 방지(부분 손상 격리).
  // 기본=week(캘린더 주 뷰). 재개편 v4에서 배분이 독립 세그먼트로 빠지며 캘린더가 계획의 첫 착지가 됐다.
  /* ⚠ `z.preprocess` 는 **mini 에 없다**(H28) — 같은 뜻을 `pipe(transform, …)` 로 쓴다.
     의미는 동일하다: 값을 먼저 변환하고 그 결과를 스키마에 통과시킨다. */
  schedView: z.catch(
    z.pipe(
      z.transform((v) => migrateSchedView(v) ?? v),
      SchedViewSchema,
    ),
    'week',
  ),
  accent: z._default(AccentSchema, 'lime'),
  recentCommands: z._default(z.array(z.string()), []),
  /* 발광 효과 줄이기 — 발광 오라 무한 애니 정지(상시 페인트 절감).
     ⚠ 종전 이 줄은 «풀스크린 오로라 셰이더 정지»를 함께 적었는데 그 셰이더가 은퇴했다(I045). */
  // 기본 false(현 외형 그대로). 옛 저장본엔 없으니 .default로 호환. data-fx="lite"로 cascade.
  fxLite: z._default(z.boolean(), false),
  // 사이드바 접힘 — false=라벨+그룹 펼침(기본), true=60px 아이콘 레일. 옛 저장본 호환 위해 .default.
  navCollapsed: z._default(z.boolean(), false),
  /* ── N-17 **사용자 조립 레일**(W5 · 2026-08-07) ────────────────────────────────────
     N-14 가 레일을 평탄화하면서 열넷이 한 목록에 섰다. 그러면 "안 쓰는 화면이 매일 눈에
     들어온다"가 실재하는 비용이 되는데, 이 앱의 종전 답은 **강등**이었다 — 개발자가 관측을
     보고 자리를 옮기는 것. 그 답이 다섯 번 반복됐고 매번 근거가 같았다(P10 §1-3).
     여기서는 **사용자가 직접 접는다.** 판단이 필요 없는 결정을 판단으로 만들지 않는다.

     ⚠ **기기별 취향이라 여기다**(`themeAuto` 와 같은 논증): 폰과 PC 는 화면 수도
     쓰는 화면도 다르다. 앱 데이터로 동기화하면 한 기기의 정리가 다른 기기의 나브를 바꾼다.
     ⚠ **숨김은 도달성 손실이 아니다** — ⌘K·`g` 키·딥링크는 그대로다(레일에서만 접힌다).
     그 구분이 `retired` 와 이것을 가른다: 저긴 앱의 판정, 여긴 그날의 취향이다.
     ⚠ 순서는 **키 목록**이다(섹션 안에서만 적용된다). 섹션을 넘나드는 재배치를 허용하면
     질문 축(N-16)이 사용자마다 다른 뜻을 갖게 되고, 그러면 그 축이 아무것도 안 묶는다. */
  /* ── A-13 **오늘의 확정**(W7 · 2026-08-07) ─────────────────────────────────────────
     히어로의 입력이 전부 시간 의존이라(`nowMin`·`dayPhase`) **하루에 여러 번 바뀐다** — 아침에
     "회로이론 3장"이라 해 놓고 점심에 다른 것을 말한다. 그건 *"결정이 끝나 있다"* 는 이 화면의
     약속과 정반대다. 사용자가 "오늘은 이걸로 한다"고 못박으면 그날은 그것이 히어로다.
     ⚠ **기기별이다**: 어느 기기에서 오늘을 시작했는지에 따라 답이 달라도 되는 값이고(폰에서
       확정한 것이 PC 의 아침 화면을 바꿀 이유가 없다), 무엇보다 앱 데이터가 아니다.
     ⚠ `{ds,key}` 로 **날짜를 함께** 담는다 — 날짜가 없으면 어제 확정이 오늘 히어로를 붙든다. */
  focusLock: z._default(z.nullable(z.object({ ds: z.string(), key: z.string() })), null),
  // 나브 표면(Wave⑥) — 스위처 클릭·전역 탭 폴백용 영속값. 라우트가 우선. 옛 저장본은 .default로 학습.
  // Anki 실시간 due 자동 새로고침(2단계-A4) — 원래 AnkiPanel이 'lh:anki-autorefresh' 평문 키를
  // localStorage에 **직접** 쓰던 유일한 kv SSOT 우회였다. 계층 밖이라 백업에도 안 들어갔다
  // (0단계-E가 고친 결함과 같은 부류인데 그때 누락됨) → UI 설정으로 흡수해 _local 사이드카에 편입.
  ankiAutoRefresh: z._default(z.boolean(), false),
  /* 시스템 테마 따라가기 — OS 가 다크/라이트를 바꾸면(야간 모드 스케줄 등) 앱도 따라간다.
     ⚠ **`state.theme` 에 'auto' 를 넣지 않는다.** 앱 데이터의 theme 은 D1 로 동기화되고 서버
     zod 가 `.strict()` 로 받는다 — enum 에 값을 늘리면 이 앱과 **서버·다른 기기 클라이언트가
     동시에** 알아야 하고, 모르는 쪽은 상태 전체를 거부한다. 반면 "따라갈까 말까"는 기기별
     취향이지 동기화 대상이 아니다(모니터가 다르면 답도 다르다) → UI 설정에 둔다. 켜져 있으면
     ⚠⚠ 옛 구현은 _"ThemeProvider 가 감지 결과를 `state.theme` 에 해소된 값으로 써넣는다"_ 였다.
     그게 H9(2026-07-30 `/감사 근본`)다: `state.theme` 은 **D1 로 동기화되는 앱 데이터**라,
     PC 에서 해질녘에 OS 가 다크로 바뀌면 그 값이 클라우드를 타고 **폰 테마까지 뒤집었다.**
     기기별 취향이라 UI 설정에 뒀다고 적어 놓고, 그 취향의 *결과*는 전 기기에 뿌린 셈이다.
     → 감지 결과는 아래 `autoTheme` 에 **기기-로컬로** 담는다. `state.theme` 은 사람이 고른
     값만 담고(그건 여전히 동기화된다 — 수동 선택은 의도다), 화면은 둘을 `resolveTheme` 로
     해소한 값 하나를 본다. 옛 저장본 호환은 .default. */
  themeAuto: z._default(z.boolean(), false),
  /* 시스템이 지금 말하는 값 — `themeAuto` 가 켜져 있는 동안에만 `state.theme` 을 **덮는다**(H9).
     ⚠ 영속하지만 정본이 아니다: ThemeProvider 가 마운트마다 OS 를 다시 읽어 덮어쓰므로
     저장본이 틀려도 한 프레임 뒤 자가 교정된다(영속시키는 이유는 그 한 프레임의 깜빡임 제거).
     ⚠ 수동으로 테마를 고르면 `null` 로 지운다 — 그래야 "고른 값이 다음 OS 변경까지 유지"라는
     기존 계약이 그대로 성립한다(그 계약은 사용자가 못박은 것이다 · 절대규칙 #4). */
  autoTheme: z._default(z.nullable(ThemeSchema), null),
  /* ⚠⚠ **여기 `trayResident`(T-3)·`reminderAt`·`reminderLastDs`(T-6)가 있었다 — 은퇴했다**
     (I049 · 2026-08-22 발상 축). 옛 저장본에 남아 있어도 zod 가 모르는 키를 버리므로
     마이그레이션이 필요 없다(`navSurface` 가 N-6 에서 같은 방식으로 사라졌다). */
  /* T-13 "지난번 이후" — 화면 key → 마지막으로 본 날(ISO).
     ⚠ **기기별이다 · 동기화하지 않는다.** "내가 마지막으로 본 시점"은 이 기기의 *주의*에 대한
       사실이지 앱 데이터가 아니다 — PC 에서 본 것이 폰의 새 것 표시를 지우면 폰 사용자는 본 적
       없는 것을 본 것으로 처리당한다(`themeAuto` 와 같은 논증).
     ⚠ 날짜만 담는다(시각 아님). 같은 날 두 번 여는 것은 델타가 아니다.
     ⚠⚠ **이름이 `seenAt` 이었다 — `seenDs` 로 바꿨다**(C039 · 2026-08-22). 이 저장소에서
       `*At` 은 지배적으로 **epoch ms** 이고(선언 28건 중 24) `*Ds` 는 31어휘·600여 회 전량
       `YYYY-MM-DD` 로 지켜진다. 즉 이 필드만 접미사가 거짓말을 하고 있었고, 작성자는 그것을
       알면서 개명 대신 위 한 줄 주석을 달았다. 대가는 다음 소비처에서 나온다: `since.ts` 가
       `ds > seenDs` 로 **문자열 비교**를 하므로 `Date.now()` 를 넣으면 배지가 전 이력을 영구히
       「새 것」으로 세고, `toISOString()` 을 넣으면 오늘 것이 통째로 빠진다 — 둘 다 zod
       (`record(string,string)`)를 통과하고 게이트가 녹색이다.
     ⚠ **마이그레이션을 안 단다**(N-6 `navSurface` 선례). 기기별 값이고 `sinceCount` 가
       `!seenDs → null` 이라 옛 키가 사라진 첫 회차는 «셀 수 없음» = 배지 없음으로 조용히 지나간다. */
  seenDs: z._default(z.record(z.string(), z.string()), {}),
  /* T-26 핀 슬롯 — 어느 화면이든 고정해 상단에 띄운다.
     ⚠ 기기별이다(`seenDs` 와 같은 논증): 무엇을 눈앞에 두고 싶은가는 이 기기의 주의에 대한
       사실이고, PC 의 선택이 폰의 좁은 화면 위쪽을 차지하면 그건 방해다.
     ⚠ 상한(`MAX_PINS`)은 `lib/pins` 가 소유한다 — 스키마에 넣으면 초과분이 **저장 시점에
       거부**되고 사용자는 왜 안 붙었는지 모른다(선수 관계 순환에서 내린 것과 같은 판단). */
  pins: z._default(z.array(z.object({ to: z.string(), label: z.string(), at: z.number() })), []),
  /* I030 점검 모드 — 이 **날짜**의 방문·홉을 원장에 안 남긴다(`null` = 꺼짐).
     ⚠ 부울이 아니라 날짜인 이유는 `lib/visits` 머리주석이 SSOT: 켜 놓은 것을 잊으면 관측이
       조용히 영원히 멈추고, 그러면 다음 판정자가 **0 을 「안 쓴다」로 읽는다**. 자정에 스스로
       꺼지고, 켜져 있다는 사실이 리드아웃에 날짜로 보인다.
     ⚠ **기기별이다**(`seenDs` 와 같은 논증): 점검은 이 기기에서 하는 행위이고,
       동기화하면 PC 의 감사 세션이 폰의 관측까지 멈춘다. */
  inspectDs: z._default(z.nullable(z.string()), null),
});
export type UIState = z.infer<typeof UIStateSchema>;

/** 화면이 실제로 입는 테마 한 값 — 동기화되는 정본(`state.theme`)과 기기-로컬 감지값을 해소한다(H9).
 *
 *  ⚠ **해소는 여기 한 곳**이다. 예전엔 해소가 아니라 *덮어쓰기*(감지값을 정본에 써넣기)라
 *  해소 지점이 필요 없었고, 그 대가가 "기기별 취향이 전 기기로 새는" H9 였다. 읽는 쪽이
 *  둘을 각자 조합하기 시작하면 상단바 버튼이 "다크로 전환"이라 말하며 라이트를 보여 주는
 *  옛 사고가 되돌아온다 — 그래서 소비처(ThemeProvider·TopBar·팔레트 액션)는 전부 이 함수를 탄다. */
export function resolveTheme(saved: Theme | undefined, ui: Pick<UIState, 'themeAuto' | 'autoTheme'>): Theme {
  if (ui.themeAuto && ui.autoTheme) return ui.autoTheme;
  return saved || 'dark';
}

export const UI_KEY = 'lh_ui_v1'; // 단일 저장 키
// 단일화 이전 산재 키 — 부팅 시 1회 흡수 후 제거.
const LEGACY_VIEW = 'sched_view';
const LEGACY_RECENT = 'lh_recent_cmds';
/** AnkiPanel이 직접 쓰던 평문 키('1'/'0') — 2단계-A4에서 흡수. */
const LEGACY_ANKI_AUTO = 'lh:anki-autorefresh';

// 전 필드가 .default()를 가지므로 빈 객체 parse가 완전한 기본 UIState를 만든다 —
// 기본값을 손으로 재나열하지 않고 스키마를 단일 원천으로.
export function defaultUI(): UIState {
  return UIStateSchema.parse({});
}

/** 저장된 UI 설정을 읽는다. 신규 키가 없으면 구 산재 키를 1회 흡수하고, 손상 시 기본값. */
export function bootUI(storage: KV): UIState {
  try {
    const raw = storage.getItem(UI_KEY);
    if (raw) {
      const obj: unknown = JSON.parse(raw);
      const parsed = UIStateSchema.safeParse(obj);
      if (!parsed.success) return defaultUI();
      // ⚠ anki 흡수는 UI_KEY가 **있어도** 해야 한다 — 기존 사용자는 UI_KEY와 구 anki 키를 둘 다
      // 가지고 있고, 여기서 안 읽으면 .default(false)가 사용자의 '1' 설정을 조용히 지운다.
      // 이미 신규 필드가 저장돼 있으면(=흡수 완료) 그 값이 이긴다.
      if (!hasOwn(obj, 'ankiAutoRefresh')) {
        const legacy = readLegacyAnki(storage);
        if (legacy !== undefined) parsed.data.ankiAutoRefresh = legacy;
      }
      return parsed.data;
    }
    return absorbLegacy(storage);
  } catch {
    return defaultUI();
  }
}

/** 신뢰 불가 파싱 결과에서 자기 소유 속성만 확인(프로토타입 오염 차단 — sidecars.ts와 동형). */
function hasOwn(o: unknown, k: string): boolean {
  return !!o && typeof o === 'object' && Object.hasOwn(o, k);
}

/** 구 anki 자동새로고침 키를 boolean으로. 저장된 적 없으면 undefined(= 흡수할 게 없음). */
function readLegacyAnki(storage: KV): boolean | undefined {
  try {
    const raw = storage.getItem(LEGACY_ANKI_AUTO);
    return raw == null ? undefined : raw === '1';
  } catch {
    return undefined;
  }
}

/** 구 키(sched_view·lh_recent_cmds·lh:anki-autorefresh)를 단일 UIState로 흡수(있을 때만). */
function absorbLegacy(storage: KV): UIState {
  const ui = defaultUI();
  const anki = readLegacyAnki(storage);
  if (anki !== undefined) ui.ankiAutoRefresh = anki;
  try {
    const mapped = migrateSchedView(storage.getItem(LEGACY_VIEW));
    if (mapped) ui.schedView = mapped;
  } catch {
    /* noop */
  }
  try {
    const raw = storage.getItem(LEGACY_RECENT);
    const arr = raw ? JSON.parse(raw) : null;
    if (Array.isArray(arr)) ui.recentCommands = arr.filter((x) => typeof x === 'string').slice(0, RECENT_MAX);
  } catch {
    /* noop */
  }
  return ui;
}

/** UI 설정을 단일 키로 직렬화·저장하고 JSON을 반환(호출부가 IDB 미러에 전달). */
export function persistUI(storage: KV, ui: UIState): string {
  const json = JSON.stringify(ui);
  try {
    storage.setItem(UI_KEY, json);
    // 흡수 완료된 구 키 정리 — 다음 부팅부턴 단일 출처만 본다.
    storage.removeItem(LEGACY_VIEW);
    storage.removeItem(LEGACY_RECENT);
    storage.removeItem(LEGACY_ANKI_AUTO);
  } catch {
    /* private mode 등 — 메모리 상태는 계속 동작 */
  }
  return json;
}

/** 최근 명령 LRU 갱신(최신 앞·중복 제거·최대 RECENT_MAX). */
export function pushRecent(list: string[], id: string): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, RECENT_MAX);
}
