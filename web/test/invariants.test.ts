// @vitest-environment jsdom
/* ============================================================
   invariants.test.ts — "두 원천이 손으로 동기화되던" 불변식을 기계적으로 잠근다.
   이전엔 주석으로만 지켜져 누락 시 조용히 오작동(무증상)했다.

   ① SCHEDULE_INPUT_KEYS ⊇ scheduler가 읽는 state 슬라이스
      누락 시 selectSchedule 캐시가 거짓 히트 → 그 슬라이스 변경에 stale 스케줄(전탭 오작동).
   ② LOADERS(features/registry) 키 === TABS(shell/tabs) 키
      한쪽만 추가 시 런타임 "알 수 없는 탭" 카드 or 죽은 로더.
============================================================ */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
/* ⚠ **스캐너·주석제거기는 여기 한 벌이다**(m-16). 지역 워커를 새로 파지 말 것 —
   종전엔 11벌이었고 주석 제거기가 4벌·의미 3가지로 갈려 오탐·오검이 동시에 났다.
   새 불변식을 추가할 때 이 모듈을 쓰면 규율(주석은 검사 대상이 아니다)이 자동 상속된다. */
import { SRC, aliasOf, cssFiles, filesUnder, importSpecifiers, sources, strip, tsFiles, tsxFiles } from './_sources';
import { schedule } from '@/lib/scheduler';
import { defaults } from '@/lib/persistence';
import { SCHEDULE_INPUT_KEYS } from '@/store/selectors';
import { LOADERS } from '@/features/registry';
import {
  TABS,
  RAIL_SECTIONS,
  navGroups,
  railTabs,
  objectRoutes,
  orderedTabs,
  SUBTAB_GROUPS,
  tabByKey,
} from '@/shell/tabs';
import { NAV_SHORTCUTS } from '@/shell/shortcuts';
import { ANCHOR_TAB_ROUTES, CONTENT_ANCHORS } from '@/lib/contentAnchors';
// ⚠ 불변식 ③-b 가 ⌘K 도달을 **세어야** 하므로 팔레트 목록을 실제로 읽는다(믿지 않는다).
import { paletteCommands as basePaletteCommands } from '@/shell/palette';

/* Proxy 내부 접근·상속 프로퍼티 등 슬라이스가 아닌 잡음 키(캐시 입력이 아님). */
const NOISE = new Set([
  'then',
  'constructor',
  'hasOwnProperty',
  'toJSON',
  'valueOf',
  'nodeType',
  'schemaVersion', // 마이그레이션 마커 — schedule 결과에 영향 없음
]);

describe('불변식 ① SCHEDULE_INPUT_KEYS는 scheduler가 읽는 슬라이스를 전부 포함한다', () => {
  it('schedule()이 읽는 최상위 state 슬라이스 ⊆ SCHEDULE_INPUT_KEYS', () => {
    // scheduler가 실제로 도는 유효 상태(오늘·지식·항목 포함).
    const base: AppState = {
      ...defaults(),
      _today: '2026-06-23',
      _knowState: { subjects: [] },
      items: [
        {
          id: 'x1',
          sid: 's1',
          name: '테스트 과목',
          subject: '테스트',
          color: '#9be83f',
          mode: 'weekly',
          weeklyHours: 3,
          chapters: [{ name: '1장', deadline: '', mastery: 0 }],
        },
      ],
    } as unknown as AppState;

    const read = new Set<string>();
    const probe = new Proxy(base, {
      get(target, prop, recv) {
        if (typeof prop === 'string') read.add(prop);
        return Reflect.get(target, prop, recv);
      },
    });

    schedule(probe as AppState);

    const declared = new Set<string>(SCHEDULE_INPUT_KEYS);
    const missed = [...read].filter((k) => {
      if (NOISE.has(k)) return false;
      if (typeof (base as unknown as Record<string, unknown>)[k] === 'function') return false;
      return !declared.has(k);
    });

    // 실패 시 missed에 담긴 키를 SCHEDULE_INPUT_KEYS에 추가하면 된다(selectors.ts).
    expect(missed).toEqual([]);
  });
});

describe('불변식 ② LOADERS(registry) ↔ TABS(tabs) 키 패리티', () => {
  /* ⚠ `retired`(Q-22)는 **자기 라우트가 없다** — 화면이 다른 곳에 흡수됐고 `to` 가 그곳을
     가리킨다. 그래서 로더 패리티에서 뺀다. 대신 아래 두 검사가 그만큼을 메운다:
     ① 은퇴 탭은 `to` 를 반드시 갖는다(가리킬 곳 없는 은퇴는 그냥 삭제다).
     ② 은퇴 탭도 ⌘K 에서 도달 가능하다(그것이 `retired` 의 존재 이유 전부다). */
  /* ⚠ `object`(A-7 · 2026-08-07)도 **로더가 없다** — 명사 주소는 화면 탭이 아니라 *이름과
     라우트 패턴*이고, 착지는 기존 화면이 진다(`app/NounRoutes.tsx`). 로더 패리티에 넣으면
     "탭이 아닌 것"에 컴포넌트를 요구하게 되어 A-7 이 없앤 두 번째 표가 다른 형태로 돌아온다.
     대신 아래 케이스가 그만큼을 메운다: **object 는 이름과 라우트를 반드시 갖는다.** */
  const live = TABS.filter((t) => t.role !== 'view' && t.role !== 'object');

  it('두 원천의 탭 키 집합이 정확히 일치한다(은퇴 제외)', () => {
    const loaderKeys = Object.keys(LOADERS).sort();
    const tabKeys = live.map((t) => t.key).sort();
    expect(loaderKeys).toEqual(tabKeys);
  });

  /* ⚠ 어휘가 `retired` → `view` 로 바뀌었다(I048 · 2026-08-22). 계약은 그대로다: 호스트 안의
     뷰는 **주소를 갖는다** — 가리킬 곳 없는 뷰는 뷰가 아니라 그냥 삭제 대상이다. */
  it('호스트 안의 뷰는 주소(to)를 갖는다 — 가리킬 곳 없으면 그건 삭제다', () => {
    for (const t of TABS.filter((x) => x.role === 'view')) {
      expect(t.to, `${t.key} 가 은퇴했는데 to 가 없다`).toBeTruthy();
    }
  });

  it('⭐ 호스트 안의 뷰도 ⌘K 로 도달한다 — `graph` 가 조용히 사라졌던 그 결함의 집행자', () => {
    const ids = new Set(basePaletteCommands().map((c) => c.id));
    for (const t of TABS.filter((x) => x.role === 'view')) {
      expect(ids.has('tab:' + t.key), `${t.key} 가 ⌘K 에서 사라졌다`).toBe(true);
    }
  });

  /* ── A-7 명사 주소(`role:'object'` · 2026-08-07) ─────────────────────────────
     이 역할이 로스터에 있는 이유는 **이름 하나**다(라우트 아나운서·문서 제목). 이름이 없으면
     H27 이 고쳤던 무음이 그대로 돌아오고, 라우트 패턴이 없으면 로스터가 *어떤 주소를 말하는지*
     알 수 없어 두 번째 표가 다시 필요해진다 — 즉 이 두 필드가 `object` 의 존재 이유 전부다.
     ⚠ 분모 단언을 붙인다: 목록이 비면 아래 순회가 **한 번도 안 돌고 통과**한다(F3 규율). */
  it('명사 주소는 이름과 라우트 패턴을 갖는다 — 그 둘이 `object` 의 존재 이유다', () => {
    const objects = TABS.filter((t) => t.role === 'object');
    expect(objects.length, '명사 주소가 0개면 이 케이스가 아무것도 안 잰다').toBeGreaterThan(0);
    for (const t of objects) {
      expect(t.label, `${t.key} 에 이름이 없다 — 아나운서가 무음이 된다`).toBeTruthy();
      expect(t.route?.startsWith('/'), `${t.key} 의 route 가 경로가 아니다`).toBe(true);
    }
  });

  /* ⚠⚠ **로스터에 있는데 라우터에 없으면 그건 이름만 있는 유령이다.** A-7 이 `ROUTE_LABELS` 를
     없앤 이유가 *두 표가 갈린다*였는데, 로스터와 라우터가 갈리면 같은 병이 한 칸 옮겨간 것뿐이다
     (이 저장소는 `/graph` 에서 정확히 그 형태에 물렸다 — 리다이렉트를 손으로 놓고 그게 한 번도
     이기지 못했다). 착지는 매개변수의 함수라 파생시킬 수 없으므로, **대조**로 잠근다. */
  it('명사 주소의 라우트 패턴이 실제로 라우터에 등록돼 있다', () => {
    /* ⚠ 종전엔 `NounRoutes.tsx` 도 읽었다 — **그 파일이 삭제됐다**(I047 · 2026-08-22 · 명사
       주소 셋이 만든 뒤 아무도 안 가리켰다). 남은 명사(`subject`·`mini`)는 `App.tsx` 가 직접
       그린다. 파일 목록을 손으로 들고 있으므로, 명사가 다시 늘어 별도 파일이 생기면 여기도
       늘려야 한다 — 그 사실을 여기 적어 둔다. */
    const src = readFileSync(join(process.cwd(), 'src/app/App.tsx'), 'utf8');
    for (const t of objectRoutes()) {
      /* `/day/:ds` 처럼 상수로 조립되는 패턴도 있으므로 **첫 세그먼트**로 찾는다 — 문자열 전량
         일치를 요구하면 상수화가 곧 실패가 되고, 그러면 이 검사가 상수화를 벌한다. */
      /* ⚠ 대소문자를 안 가린다 — 상수로 넘기는 자리(`path={MINI_PATH}`)가 실재한다. 그 형태를
         실패로 치면 검사가 "리터럴로 적어라"를 강요하게 되고, 그건 이 파일이 반복해서 반대해 온
         것이다(손베낌 문자열은 표류한다). */
      const seg = t.route!.split('/')[1]!;
      expect(new RegExp(`path=[{"'\`][^\\n]*${seg}`, 'i').test(src), `${t.key}(${t.route}) 가 라우터에 없다`).toBe(
        true,
      );
    }
  });

  it('명사 주소는 **화면 탭 열거에 안 샌다** — 레일·링·⌘K·라우트 생성 전부', () => {
    const objectKeys = new Set(TABS.filter((t) => t.role === 'object').map((t) => t.key));
    for (const k of orderedTabs().map((t) => t.key))
      expect(objectKeys.has(k), `${k} 가 화면 탭 목록에 샜다`).toBe(false);
    const ids = new Set(basePaletteCommands().map((c) => c.id));
    for (const k of objectKeys) expect(ids.has('tab:' + k), `${k} 가 ⌘K 탭 목록에 샜다`).toBe(false);
  });
});

// ── 불변식 ③ 표면 스위처(Wave⑥) — 표면·그룹 정합 ──
describe('불변식 ③ 나브 그룹 정합', () => {
  /* ⚠⚠ **`GROUP_LABELS`·`TabMeta.group` 이 N-14(W5)에서 사라졌다.** 묶음의 원천이 둘이던 것을
     하나(`RAIL_SECTIONS`)로 접었으므로, 이 케이스가 지키던 것("고아 group 키")도 형태가 바뀐다:
     이제 위험한 것은 *라벨 없는 그룹* 이 아니라 **어느 섹션에도 안 적힌 레일 탭**이다(그러면
     레일 맨 끝 `섹션 미지정` 으로 밀려나 조용히 이름을 잃는다). */
  it('레일에 설 수 있는 탭은 전부 어느 섹션엔가 적혀 있다', () => {
    const inSection = new Set(RAIL_SECTIONS.flatMap((s) => s.tabs));
    const rail = TABS.filter((t) => t.role === 'destination' || t.role === 'lens');
    expect(rail.length, '레일 탭이 0개면 이 케이스가 아무것도 안 잰다').toBeGreaterThan(0);
    for (const t of rail) expect(inSection.has(t.key), `${t.key} 가 어느 섹션에도 없다`).toBe(true);
  });

  it('섹션이 가리키는 탭이 전부 실존하고 레일에 설 수 있다', () => {
    for (const sec of RAIL_SECTIONS)
      for (const k of sec.tabs) {
        const t = tabByKey(k);
        expect(t, `${sec.key} 섹션의 ${k} 가 없는 탭이다`).toBeTruthy();
        expect(['destination', 'lens'], `${k} 는 레일에 설 수 없는 역할이다`).toContain(t?.role);
      }
  });

  /* ⚠ **질문이어야 한다**(N-16). 라벨이 명사면 그건 분류이고, 분류는 외워야 한다 —
     이 축의 값 전부가 *묻는 대로 읽힌다*는 데 있으므로 형태를 잠근다. */
  it('섹션 헤더가 질문이다 — 분류명으로 되돌아가지 않게', () => {
    expect(RAIL_SECTIONS.length).toBeGreaterThan(0);
    for (const sec of RAIL_SECTIONS) expect(sec.question, `${sec.key}`).toMatch(/\?$/);
  });
  /* ⚠ 옛 '표면 정합' 3케이스는 N-6 과 함께 사라졌다 — 표면이 없으니 "다른 표면으로 누출"이라는
     사건 자체가 표현 불가능해졌다(테스트를 지운 게 아니라 지킬 대상이 없어진 것이다).
     그 케이스들이 실제로 지키던 것 — **전역 진입점은 어디서든 도달 가능** — 만 남긴다. */
  /* ⚠ **2026-07-29(E13/IA 재편)에 다시 쓰였고 P10 W4(2026-08-07)에 짝을 잃었다.** 옛 문구는
     _"설정 그룹 진입점(control·settings)은 항상 레일에 선다"_ 였는데, 그건 지키려던 것("전역
     진입점은 어디서든 도달 가능")보다 **좁은 명제**였다 — 레일에 서는 것은 도달 가능성의 여러
     수단 중 하나일 뿐이다. `control`(탐구 수집)은 그 뒤 `survey/` 필러로 갔으므로 이제 이 케이스가
     지키는 것은 `settings` 하나다. 지킬 대상을 정확히 적는다 — **레일이 아니라 도달성**이다. */
  it('전역 진입점(settings)은 도달 가능하다 — 레일이든 세그먼트든', () => {
    const rail = navGroups().flatMap((g) => g.tabs.map((t) => t.key));
    expect(rail).toContain('settings'); // 설정은 하단 앵커라 레일에 남는다
  });
});

/* ============================================================
   불변식 ③-b — **"갈 수 있는 곳"의 열거는 하나에서 파생된다** (D-4)

   레일 / `[ ]` 링 / `g` 키 / 세그먼트가 각자 자기 목록을 갖던 시절, 멤버십이 조용히 갈렸다:
   `g o` 는 은퇴한 탭으로 갔다 튕겼고, 링은 표면 경계를 넘어 레일에 없는 곳으로 샜다.
   목적지가 사라지는 사건은 **아무 에러도 안 내므로** 손으로는 못 지킨다 — 기계로 잠근다.
============================================================ */
describe('불변식 ③-b 도달 경로(D-4) — 모든 열거가 TABS.role 에서 파생된다', () => {
  /* ⚠ **분모를 먼저 못박는다**(2026-07-31 `/감사 근본` F3). 아래 케이스들은 전부 컬렉션 순회인데,
     컬렉션이 비면 `for … expect` 는 **한 번도 실행되지 않고 통과한다** — 즉 "목록이 통째로
     사라지는 것"만은 원리적으로 못 잡는다. 이 사각이 가설이 아니라는 것은 같은 세션에
     `dbRows.test.ts` 에서 실증됐다(`EPHEMERAL_ONLY_KEYS` 를 비웠더니 그 목록을 지키는 케이스가
     **초록으로 통과**했다). 순회 게이트에는 분모 단언이 짝이다. */
  it('열거가 비어 있지 않다 — 아래 순회 케이스들이 공허하게 통과하지 않도록', () => {
    expect(TABS.length).toBeGreaterThan(0);
    expect(NAV_SHORTCUTS.length).toBeGreaterThan(0);
    expect(SUBTAB_GROUPS.length).toBeGreaterThan(0);
    expect(navGroups().flatMap((g) => g.tabs).length).toBeGreaterThan(0);
  });
  /* ⚠⚠ **N-14(W5) 이 이 케이스를 뒤집었다.** 옛 명제는 *"레일에 서는 것은 정확히
     destination"* 이었고, 그건 두 층 구조(레일 + 세그먼트)의 계약이었다. 평탄화 뒤에는
     **렌즈도 레일에 선다** — 지켜야 할 것은 "렌즈 누출 0"이 아니라 **은퇴·명사 누출 0**이다
     (은퇴한 화면이 레일에 서면 그건 은퇴가 아니고, 명사가 서면 매개변수 없는 죽은 링크다). */
  it('레일에 서는 것은 destination 이거나 lens 다(은퇴·명사 누출 0)', () => {
    const rail = navGroups().flatMap((g) => g.tabs);
    expect(rail.length).toBeGreaterThan(0);
    for (const t of rail) expect(['destination', 'lens'], t.key).toContain(t.role);
  });
  it('`[ ]` 링은 레일과 같은 목록을 돈다(같은 함수에서 파생 — 두 벌이 될 수 없다)', () => {
    expect(railTabs().map((t) => t.key)).toEqual(navGroups().flatMap((g) => g.tabs.map((t) => t.key)));
  });
  it('모든 `g` 시퀀스가 실존하는 탭을 가리킨다(죽은 목적지 금지)', () => {
    for (const sc of NAV_SHORTCUTS) expect(tabByKey(sc.tab), `g ${sc.seq}`).toBeTruthy();
  });
  /* ⚠⚠ 아래 셋이 W5 의 집행자다. 옛 불변식은 "실존한다"만 봤고, 그래서 `g` 표가 IA 변경 3건
     (forecast 승격·markets 강등·atlas 강등)을 **하나도 안 따라간 채 전부 초록**이었다.
     실측 당시: destination 7 중 2개에 `g` 가 없고, `g` 키 12 중 **6개가 lens** 였다. */
  /* ⚠ ①-6(W5) — 규칙의 **한 단어**가 바뀌었다: destination → *레일에 서는 것*. 렌즈가 레일에
     서게 됐으므로(N-14) `g` 가 렌즈를 가리켜도 "레일에 없는 곳에 선다"가 아니다. */
  it('`g` 표의 tab 은 전부 레일에 선다(눌러 가면 레일에 없는 곳에 서는 것 금지)', () => {
    for (const sc of NAV_SHORTCUTS)
      expect(['destination', 'lens'], `g ${sc.seq} → ${sc.tab}`).toContain(tabByKey(sc.tab)?.role);
  });
  it('레일에 서는 것 전부가 `g` 키를 갖는다(손가락에서 빠지는 것 금지)', () => {
    const covered = new Set(NAV_SHORTCUTS.map((s) => s.tab));
    for (const t of railTabs()) expect(covered.has(t.key), `${t.key} 에 g 키가 없다`).toBe(true);
  });
  it('seq 는 고유하다 — 첫 글자 충돌은 `SEQ_OVERRIDE` 에 명시해야 한다(조용한 가림 금지)', () => {
    const seqs = NAV_SHORTCUTS.map((s) => s.seq);
    expect(new Set(seqs).size, `중복: ${seqs.join(',')}`).toBe(seqs.length);
  });
  /* ⚠ 세그먼트 바는 N-14 에서 은퇴했지만 **묶음은 남았다**(레일 섹션). 그래서 이 케이스가
     지키는 것도 남는다 — 다만 요구는 하나로 준다: **섹션의 첫 줄은 그 질문의 얼굴**이다
     (`destination`). 나머지가 lens 여야 한다는 요구는 뺐다 — 한 섹션에 얼굴이 둘이면
     안 되는 이유가 두 층 구조에 있었고, 그 구조가 없다. */
  it('각 섹션의 첫 항목은 그 질문의 얼굴(destination)이다', () => {
    for (const g of SUBTAB_GROUPS) {
      for (const k of g) expect(tabByKey(k), k).toBeTruthy();
      expect(tabByKey(g[0]!)?.role, `섹션 얼굴 ${g[0]}`).toBe('destination');
    }
  });
  /* ⚠⚠ **완화됐다: "세그먼트 그룹" → "라우트·⌘K·세그먼트 중 최소 하나"**
     (P5+P6 · 2026-08-01 `/감사 근본` · 사용자 승인).

     옛 형태는 _"lens 는 반드시 어느 세그먼트 그룹에 속한다"_ 였다. 막으려던 것은 옳았다 —
     **도달 경로 없는 탭**. 그런데 요구한 것은 그보다 좁았다: *특정* 도달 경로 하나. 라우트·⌘K·
     `g` 단축키가 이미 도달을 보장하는데도, 그것들과 무관하게 **세그먼트 바에 자리를 요구**한 것이다.

     결과는 측정 가능했다: `atlas`·`markets` 는 "학습 상태 소비 0 · 콜드면 안내문"이라 매일 볼
     화면이 아닌데도 갈 곳이 없어 시스템 호스트에 얹혔고(그 파일이 *"잠정 거처"* 라 자인한다),
     설정 세그먼트가 **7개 — 앱 최장**이 됐다. 즉 이 불변식이 "매일 안 볼 것"을 매일 보이는 바에
     세우는 **압력**이었다. 게다가 `group:'discover'` 라는 두 번째 IA 원천과 어긋나서
     `GROUP_LABELS.discover` 는 **한 번도 렌더되지 않았고**, 옛 불변식은 "라벨이 존재하는가"만
     봐서 그 사실을 못 봤다.

     ⚠ **느슨해지되 공허해지지 않는 것이 요점이다.** 열거 셋을 *실제로* 훑는다 — `paletteCommands()`
     를 불러 세지, "어차피 ⌘K 가 탭을 다 담으니 항상 참"이라고 **믿지 않는다**. 그래서 세그먼트에서
     내린 렌즈가 나중에 ⌘K 목록에서까지 빠지면 여기서 빨간불이 뜬다.

     ⚠⚠ **이 불변식이 못 보는 것을 적어 둔다(알리바이 방지).** 순회 대상이 `TABS` 라, **`TABS`
     에서 통째로 내려간 화면**은 애초에 여기 안 들어온다 — P3 이 잡은 `graph` 가 정확히 그 형태였다
     (P-19 가 배열에서 빼자 ⌘K 에서 사라졌는데 딥링크는 살아 있어 "도달성 손실 0"으로 보였다).
     그 구멍을 막는 것은 이 불변식이 아니라 `palette.ts` 의 손수 놓은 `act:graph` 항목과 그 옆
     주석이다(*"TABS 에서 화면을 내릴 때마다 여기"*). 둘은 서로 다른 것을 지킨다. */
  it('lens 는 라우트·⌘K·세그먼트 중 **최소 하나**로 도달 가능하다', () => {
    const inSeg = new Set(SUBTAB_GROUPS.flat());
    const inPalette = new Set(
      basePaletteCommands()
        .filter((c) => c.kind === 'tab')
        .map((c) => c.key),
    );
    const inShortcut = new Set(NAV_SHORTCUTS.map((s) => s.tab));
    for (const t of TABS) {
      if (t.role !== 'lens') continue;
      const paths = [inSeg.has(t.key) && '세그먼트', inPalette.has(t.key) && '⌘K', inShortcut.has(t.key) && 'g단축키'];
      expect(paths.some(Boolean), `${t.key} 는 어느 경로로도 못 간다(세그먼트·⌘K·g 전부 없음)`).toBe(true);
    }
  });
});

/* ============================================================
   불변식 ③-c — **키를 등록하는 화면은 그 키를 설명한다** (E19 · 2026-07-29)

   이 저장소는 키 계약을 **주석으로** 지켰고, `useKeymap` 자체가 그 표류에서 태어났다(N-16:
   "keydown 이 27파일 85건에 흩어져 어느 화면에 어떤 키가 사는지 앱 자신도 몰랐다"). 그런데
   레지스트리를 만든 뒤에도 표류는 계속됐다 — 복습 러너는 앱에서 키가 가장 많은데 치트시트에
   없었고, 일일 배치의 `Alt+↑↓` 는 **`aria-label` 문장 하나에만** 적혀 스크린리더 사용자에게만
   문서화돼 있었다. 셋 다 **정적 검사 전량 녹색**에서 살아 있었다.

   ⚠ 범위를 **전역 리스너로 좁힌 것이 의도**다. 요소 스코프 `onKeyDown`(입력칸의 Enter 처리 등)
   까지 요구하면 폼마다 치트시트 항목이 생겨 소음이 되고, 그러면 이 불변식이 첫 주에 무력화된다.
   `document`/`window` 에 거는 키는 **그 화면에 있는 동안 어디서나 먹는다** — 그건 정의상 화면 키다.
   ⚠ 예외 목록을 두지 않는다. 예외는 반드시 썩고, 썩은 예외는 게이트가 아니라 알리바이가 된다
   (`tabs.ts` 의 `role` 이 필수 필드인 것과 같은 규율).
============================================================ */
describe('불변식 ③-c 전역 키를 거는 feature 는 치트시트에 등재한다', () => {
  const FEATURES = join(process.cwd(), 'src', 'features');
  // 스캐너는 `test/_sources.ts` 한 벌이다(m-16) — 지역 워커를 다시 파지 말 것.
  const files = (dir: string): string[] => tsFiles(dir);
  const REGISTERS = /(document|window)\.addEventListener\(\s*['"`]keydown/;
  const DECLARES = /useKeymap(Doc)?\s*\(/;

  it('전역 keydown 을 거는 파일은 useKeymap/useKeymapDoc 을 부른다', () => {
    const offenders = files(FEATURES).filter((p) => {
      const src = readFileSync(p, 'utf8');
      return REGISTERS.test(src) && !DECLARES.test(src);
    });
    // 실패하면: 그 화면의 키를 `useKeymapDoc(scope, rows, enabled?)` 로 등재하세요.
    // 조건부로 사는 키(패널 열림 등)는 `enabled` 로 그 조건을 그대로 옮깁니다.
    expect(offenders).toEqual([]);
  });

  it('전역 키를 거는 feature 가 하나 이상 존재한다(0이면 이 불변식이 아무것도 안 잰다)', () => {
    /* ⚠ 조용한 통과 방지 — 정규식이 망가지거나 경로가 바뀌면 0개가 되고, 그건 녹색이 아니라 고장이다.
       ⚠⚠ 이 수는 **바닥**이지 실측 개수가 아니다(4 → 3 · I044 가 `graph` 를 지웠다). 화면이
       줄면 내리는 것이 옳고, 늘 때 따라 올릴 이유는 없다 — 올리면 이 줄이 로스터 사본이 되고,
       그건 이 저장소가 반복해 물린 «손으로 적은 목록은 표류한다» 그대로다. */
    const registrars = files(FEATURES).filter((p) => REGISTERS.test(readFileSync(p, 'utf8')));
    expect(registrars.length).toBeGreaterThanOrEqual(3);
  });

  /* ── ⚠⚠ 앵커 예산(W22 · 2026-07-31) ────────────────────────────────────────────
     원칙 ②("제일 큰 픽셀 = 제일 중요한 것")의 **물리적 표현**은 `usePageChrome.primary`(44px)인데,
     그걸 세우는 곳이 6군데/5 feature 뿐이었다 — 원칙이 21%만 켜져 있었다. 반대로 **상시 크롬**은
     액센트 발광을 여럿 들고 있어 콘텐츠가 뜨기 전에 예산이 소진됐다.

     ⚠ **필수화는 억지 숫자를 낳을 수 있다**(로드맵이 적어 둔 미실행 사유). `settings` 의 "첫
     수치"가 무엇인지는 답이 없다. 그래서 규칙은 "전부 세워라"가 아니라 **"세우거나, 왜 없는지를
     써라"** 다 — `State.next` 가 `{ terminal }` 로 같은 형태를 이미 쓴다(행동이 없으면 이유를
     쓰게 한다). 사유 없는 결측만 실패한다. */
  const PRIMARY_면제: Record<string, string> = {
    today: '히어로 과목명이 72px 로 이 화면의 앵커다 — 44px 리드아웃을 더하면 앵커가 둘이 된다(원칙 ③ 위반).',
    settings: '수치가 없는 화면이다. 없는 값을 세우면 원칙 ②가 아니라 억지 숫자를 강제하게 된다.',
    /* A-9(2026-08-07) — 승격은 *자리*를 바꾼 것이지 화면을 바꾼 것이 아니다(절대규칙 #4).
       그리고 이 화면의 수는 **입력의 함수**다(빈 질의면 결과가 0): 44px 자리에 질의 전엔 0,
       치는 동안 요동치는 수를 올리면 앵커가 아니라 노이즈가 된다. `settings` 와 같은 부류. */
    find: '질의 전에는 셀 것이 없고, 치는 동안의 결과 수는 앵커가 아니라 노이즈다.',
  };

  /* ⚠⚠ **검사 범위가 결함이었다(H3 · 2026-07-31 `/감사 근본`).**

     종전엔 feature 폴더 전체에서 `primary:` 를 찾았다. 그래서 `review-run` — 가장 최근에 승격된
     목적지(W17) — 이 **크롬 호출에 `primary` 가 없는데도 통과**했다: 같은 파일의 키캡 객체 두 줄
     (`primary: true`·`primary: revealed`)에 정규식이 걸렸기 때문이다. 즉 그 배치가 다른 세 축에서
     고친 형태("선언은 있는데 집행자가 없다")를 **자기 집행자 안에** 새로 하나 만들었고, 초록불이
     그 사실을 덮고 있었다.

     지금은 두 겹이다:
     ① **타입** — `usePageChromeEffect` 의 `primary` 가 **필수 키**라 모든 호출부가 값을 쓴다
        (`store/usePageChrome.ts` 머리주석 · `State.next` 와 같은 처방).
     ② **여기** — `usePageChromeEffect(…)` **호출 구간 안**에서만, 그리고 `null` 이 아닌지까지 본다.
        괄호 균형으로 구간을 잘라내므로 파일 다른 곳의 동명 키에 걸리지 않는다. */
  /** 파일 안의 모든 `usePageChromeEffect(…)` 호출 본문(괄호 균형으로 잘라낸다). */
  const chromeCalls = (src: string): string[] => {
    const out: string[] = [];
    for (let i = src.indexOf('usePageChromeEffect('); i >= 0; i = src.indexOf('usePageChromeEffect(', i + 1)) {
      let depth = 0;
      for (let k = src.indexOf('(', i); k < src.length; k++) {
        if (src[k] === '(') depth++;
        else if (src[k] === ')' && --depth === 0) {
          out.push(src.slice(i, k));
          break;
        }
      }
    }
    return out;
  };
  /**
   * 호출 구간 안에서 `primary` 가 **실제 값**으로 세워졌는가(`null` 은 "없다고 정한 것"이다).
   *
   * ⚠ 부정 전방탐색(`/primary:\s*(?!null)/`)으로 쓰면 안 된다 — `\s*` 가 0글자로 백트래킹해
   * `primary: null` 조차 통과한다(실측으로 이 테스트가 그 형태를 한 번 잡았다). **토큰을 뽑아
   * 비교**한다.
   */
  const anchorSet = (call: string): boolean => {
    const m = /\bprimary:\s*([A-Za-z_{[(]\w*)/.exec(call);
    return m != null && m[1] !== 'null' && m[1] !== 'undefined';
  };

  it('모든 destination 이 `primary` 를 세우거나 면제 사유를 갖는다', () => {
    /* ⚠ **레일 탭 전량이 아니라 `destination` 만** 본다(N-14 · W5). 평탄화로 `railTabs()` 가
       렌즈까지 담게 됐는데, 44px 앵커는 *그 질문의 얼굴*에 요구하는 것이지 모든 화면에
       요구하는 것이 아니다 — 전부에 걸면 조망 화면마다 억지 숫자가 하나씩 생긴다(원칙 ②가
       금지하는 그 형태). */
    const missing = TABS.filter((t) => t.role === 'destination')
      .filter((t) => !PRIMARY_면제[t.key])
      .filter((t) => {
        // 그 feature 폴더 전체를 본다 — 리드아웃을 세우는 파일이 탭 진입점이 아닐 수 있다.
        const dir = join(FEATURES, t.key);
        let srcs: string[];
        try {
          srcs = files(dir).map((p) => readFileSync(p, 'utf8'));
        } catch {
          return true; // 폴더가 없으면 그 자체가 결함이다(등록만 되고 화면이 없다)
        }
        return !srcs.some((s) => chromeCalls(s).some(anchorSet));
      })
      .map((t) => t.key);
    // 실패하면: `usePageChromeEffect` 에 `primary` 를 세우거나, 위 면제 표에 **사유와 함께** 올리세요.
    expect(missing).toEqual([]);
  });

  it('⚠ 검사가 **크롬 호출 밖의 동명 키**에 걸리지 않는다 — H3 이 뚫린 방식 자체를 잠근다', () => {
    const decoy = 'usePageChromeEffect(() => ({ readouts: [], primary: null }), []);\nconst k = { primary: true };';
    expect(chromeCalls(decoy).some(anchorSet), '키캡의 primary 가 앵커로 오인됐다').toBe(false);
    // 그리고 진짜로 세운 경우는 통과해야 한다(검사가 아무것도 안 잡는 쪽으로 무너지지 않게).
    const real = "usePageChromeEffect(() => ({ readouts: [], primary: { value: '3', label: '남은' } }), []);";
    expect(chromeCalls(real).some(anchorSet)).toBe(true);
  });

  it('면제 표가 사문화하지 않았다 — 목록에 없는 탭·이미 세운 탭이 남아 있으면 실패', () => {
    for (const key of Object.keys(PRIMARY_면제)) {
      expect(tabByKey(key)?.role, `${key} 는 destination 이 아니다 — 면제할 이유가 없다`).toBe('destination');
    }
  });

  /* ── ⚠⚠ 원칙 ③ 재정의(Q-15 · 2026-08-02) — **"페이지마다"가 아니라 "목적지마다"** ──────
     디자인시스템 §0 원칙 ③은 _"시그니처 = 페이지마다 하나"_ 라 선언했는데 실측은 **23화면 중
     7곳**이었다(30%). 로드맵은 이걸 "선언과 코드의 드리프트"로만 적었지만, 어느 7곳인지 세어
     보니 **훨씬 날카로운 사실**이 나왔다:

     · 시그니처 보유 7 = today·journal·stats·settings(destination) + **review·ledger(lens)**
       + **graph(은퇴 탭)** → **셋(43%)이 목적지가 아닌 화면에 붙어 있다.**
     · destination 7 중 시그니처가 있는 것은 **4**(today·journal·stats·settings)고,
       `schedule`·`reads`·`review-run` 셋이 비어 있다.

     즉 문제는 "16화면이 미달"이 아니라 **분배가 도달 구조와 무관하다**는 것이다. 매일 여는
     목적지 셋에는 없고, 세그먼트로만 닿는 렌즈 둘과 **은퇴한 탭 하나**에는 있다. "페이지마다"가
     23곳을 약속하는 바람에 이 어긋남이 30% 라는 한 덩어리 숫자에 묻혀 있었다 — 원칙 ②가
     2026-07-29 에 다시 쓰인 것과 **같은 형태**다(선언의 범위가 코드의 범위와 다르면 새 화면마다
     두 언어가 섞인다).

     ⚠ `review-run` 은 H3 이 `primary` 검사를 뚫었던 그 탭이다 — **탭 키와 feature 폴더가 같아야
     한다는 가정**(`review-run` ≠ `review`)이 그때도 지금도 함정이었다. 여기선 폴더를 키로 찾으므로
     `review` 의 시그니처가 `review-run` 에 잘못 귀속되지 않는다.

     ⚠ **재정의는 야심을 줄인 것이 아니라 자리를 정한 것이다.** lens 는 목적지에 딸린 렌즈라
     자기 앵커를 세우면 호스트와 겨루고(원칙 ⑤ 단일 포커스), 은퇴 탭은 새로 만들 이유가 없다.
     기존 `ledger`·`graph` 의 시그니처는 **뜯지 않는다** — 되돌리는 비용이 얻는 것보다 크고,
     이 규칙이 막는 것은 *신설*이다.
     ⚠ 이 검사가 못 보는 것: 시그니처의 **질**("그 페이지 기능을 압축했는가"). 표면이 붙어
     있는지만 센다. */
  const SIG_면제: Record<string, string> = {
    schedule:
      '주간 격자 자체가 화면 전체를 덮는 fill 이라 그 안에 시그니처를 또 두면 격자와 겨룬다. Q-15 가 남긴 격차 ①.',
    'review-run':
      '러너는 한 번에 한 객체만 있는 화면이고 그 표면은 `ds-well`(단독·집중)이 맡는다 — 시그니처를 더하면 카드와 겨룬다(원칙 ⑤ 단일 포커스). 격차가 아니라 결정이다.',
    /* A-9(2026-08-07) — 이 화면의 표면은 **결과 목록**이고, 시그니처를 얹으면 사용자가 방금 친
       질의의 답 위에 장식이 앉는다. 막혔을 때 오는 화면이라 *빨리 읽히는 것*이 유일한 값이다. */
    find: '결과 목록이 곧 표면이다 — 질의의 답 위에 시각 자산을 얹으면 읽는 속도만 깎는다.',
  };
  /** 시그니처 표면의 표식 — 노치 HUD 이거나, 액센트 베이크 면(`--bg-sig-*`/`--bg-hero-*`)이거나. */
  const SIG_MARK = /ds-frame|bg-\[image:var\(--bg-(sig|hero)-/;

  it('모든 destination 이 시그니처 표면을 갖거나 면제 사유를 갖는다', () => {
    // ⚠ 위 `primary` 와 같은 이유로 `destination` 만 본다(N-14).
    const missing = TABS.filter((t) => t.role === 'destination')
      .filter((t) => !SIG_면제[t.key])
      .filter((t) => {
        const dir = join(FEATURES, t.key);
        try {
          return !files(dir).some((p) => SIG_MARK.test(readFileSync(p, 'utf8')));
        } catch {
          return true;
        }
      })
      .map((t) => t.key);
    expect(missing, '원칙 ③ — 목적지는 시그니처 하나를 갖는다(없다면 위 표에 사유와 함께)').toEqual([]);
  });

  it('시그니처 면제 표가 사문화하지 않았다', () => {
    for (const key of Object.keys(SIG_면제)) {
      expect(tabByKey(key)?.role, `${key} 는 destination 이 아니다 — 면제할 이유가 없다`).toBe('destination');
      const dir = join(FEATURES, key);
      const has = files(dir).some((p) => SIG_MARK.test(readFileSync(p, 'utf8')));
      expect(has, `${key} 는 이미 시그니처를 갖는다 — 면제 표에서 빼라`).toBe(false);
    }
  });

  /* ── ⚠⚠ 거짓말하는 뼈대 금지(W15 · 2026-07-31) ────────────────────────────────────
     로딩 표면이 두 언어로 갈려 있던 것이 W15 의 문제 제기였는데, 갈림의 **해로운 쪽**은
     `SkeletonText`(= n줄 골격)다: 길이가 데이터에 따라 변하는 목록에 3~4줄을 약속하면
     **골격이 3행을 약속하고 12행이 오는** 상태가 되고, 그건 로딩이 아니라 오답이다.
     없애려던 레이아웃 점프를 골격이 스스로 만든다.

     ⚠ `Skeleton`(폭·높이를 명시한 상자)까지 금지하지는 않는다 — `markets`(지수 카드 8칸 고정
     그리드)·`reads`(2단 리더)처럼 **화면이 실제로 그 형상을 확정하는** 자리가 있고, 그건 거짓말이
     아니라 예고다. 금지 대상은 **줄 수를 지어내는 프리미티브** 하나다.
     끝을 모르는 대기는 `<State kind='loading' shape='indeterminate'>` 가 정직한 표현이다. */
  it('features 는 `SkeletonText`(n줄 골격)를 쓰지 않는다 — 끝을 모르면 indeterminate 다', () => {
    const offenders = files(FEATURES).filter((p) => /<SkeletonText\b/.test(readFileSync(p, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

/* ============================================================
   불변식 ④ — **JS 가 읽는 CSS 토큰은 실제로 정의돼 있다** (6단계/C-7 선행조건)

   왜 이게 불변식이 되어야 하는가: C-7(Tailwind 전환)이 "조용히 깨지는 것 3종"
   으로 지목한 항목이다. Tailwind 의 `@theme` 는 **미사용으로 보이는 토큰을 트리셰이킹**
   하는데, 아래 파일들은 토큰을 **JS 에서만** 읽으므로 Tailwind 눈에는 안 쓰이는 것으로 보인다.

   그리고 그것들은 **전부 폴백값을 갖고 있다**(예: `Settings.tsx` 의 `|| fallback[a]` ·
   `lib/motion.ts` 의 `|| 'currentColor'`). 즉 토큰이 사라져도 **에러가 안 나고 틀린 색으로
   렌더된다.**
   ⚠ 파일 이름을 이 문단에 세지 마라(C061 · 2026-08-22) — 종전엔 «그 셋 … `Graph.tsx` ·
   `AmbientCanvas`» 였는데 둘 다 은퇴했고 그새 `lib/motion.ts` 가 늘었다. 아래 구현은 이미
   **찾아서** 판다(그게 이 테스트의 설계다) — 낡은 것은 주석뿐이었다.

   더 나쁜 것은 시각 게이트가 이걸 못 잡는다는 점이다 — 0단계-G 에서 실증됐다:
   `maxDiffPixelRatio: 0.02` + 단일 계열 팔레트라 **과목 색 전량 교체가 스냅샷 59장을
   통과했다.** 6단계는 정의상 스냅샷을 대량 재생성하므로 그때 이 축은 완전히 무방비가 된다.

   ⚠ 파일 목록을 손으로 적지 않는다 — `getComputedStyle` 을 쓰는 파일을 **찾아서** 판다.
   네 번째 파일이 생겨도 자동으로 걸린다(손 목록은 반드시 드리프트한다).

   ## ⚠ 이 테스트가 못 잡는 것 (과대평가 금지)

   여기서 보는 것은 **원천(`tokens.css`)에 선언돼 있는가**이지 **빌드된 CSS 에 살아남았는가**가
   아니다. 후자는 실제 번들을 봐야 하고 그건 e2e 의 몫이다. 그래도 이 테스트가 값이 있는 이유:
   C-7 이 토큰을 `@theme` 로 **옮기면** 여기가 즉시 빨간불이 된다 — "토큰의 집이 바뀌었으니
   JS 로 읽는 3곳을 손보라"는 신호가 정확히 그 시점에 온다. 조용히 지나가지 않는 것이 목적이다.
============================================================ */
describe('불변식 ④ JS 에서 읽는 CSS 토큰이 tokens.css 에 정의돼 있다', () => {
  /* ⚠ `import.meta.url` 을 안 쓴다 — 이 파일은 jsdom 환경이라 그 값이 `http:` 스킴이고
     `fileURLToPath` 가 던진다(실제로 물렸다). vitest 는 `web/` 에서 도므로 cwd 가 안전하다. */
  const SRC = join(process.cwd(), 'src') + '/';

  /** `src/` 전체에서 `getComputedStyle` 을 쓰는 파일 경로. */
  const readersOfCssVars = (): string[] =>
    tsFiles(SRC).filter((p) => readFileSync(p, 'utf8').includes('getComputedStyle'));

  const tokensCss = readFileSync(join(SRC, 'styles', 'tokens.css'), 'utf8');
  const readers = readersOfCssVars();

  it('토큰을 JS 에서 읽는 파일이 존재한다(0개면 이 불변식이 아무것도 안 잰다)', () => {
    // ⚠ 조용한 통과 방지 — 정규식이 망가지거나 경로가 바뀌면 0개가 되고, 그건 녹색이 아니라 고장이다.
    expect(readers.length).toBeGreaterThanOrEqual(3);
  });

  it('그 파일들이 참조하는 --토큰이 전부 tokens.css 에 정의돼 있다', () => {
    const missing: string[] = [];
    for (const file of readers) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/'(--[a-z][\w-]*)'/g)) {
        const name = m[1]!;
        // 정규식을 안 쓴다 — 토큰명에 `-` 가 많아 이스케이프 실수가 나기 쉽고, 실제로 한 번
        // 물렸다(전부 '없음'으로 나왔다). `--acc:` 는 `--acc2:` 에 안 걸리므로 문자열이면 충분하다.
        if (!tokensCss.includes(`${name}:`)) missing.push(`${file.replace(SRC, '')} → ${name}`);
      }
    }
    expect(missing, `tokens.css 에 없는 토큰:\n${missing.join('\n')}`).toEqual([]);
  });
});

/* ============================================================
   불변식 ⑤ — **CSS 가 참조하는 --토큰은 실제로 정의돼 있다** (④의 거울상)

   ④가 "JS 가 읽는 토큰"을 잠갔는데, **CSS 쪽에는 같은 방어가 없었다.** 그래서 이 구멍이
   실제로 뚫려 있었다: `var(--tx)` 가 3곳에서 쓰이는데 그런 토큰은 **없다**(진짜 이름은
   `--txt`). C-7 첫 feature 이식(discovery) 중에 발견했다.

   ## 왜 아무도 못 봤나 — 이게 이 불변식의 존재 이유다

   CSS 커스텀 프로퍼티는 **없는 이름을 참조해도 에러가 아니다.** 값이 무효가 되고
   `color` 는 상속으로 떨어진다. 그래서:

   - 빌드 통과 · 린트 통과 · 타입 통과 (CSS 에는 이름 검사가 없다)
   - **시각 스냅샷도 통과** — 상속된 색이 그럴듯해 보이고, `maxDiffPixelRatio: 0.02` +
     단일 계열 팔레트라 애초에 색 회귀를 못 잡는다(0단계-G 실증)

   즉 "전량 녹색인데 틀린 색으로 렌더 중"이었다. `stylelint` 의 `color-no-hex` 는 색의
   **출처**를 강제했지만 그 출처가 **실재하는지**는 아무도 안 봤다.

   ⚠ 이게 C-7 에서 특히 위험한 이유: 전환은 토큰 참조를 대량으로 옮겨 적는 작업이고,
   오타 하나가 정확히 이 형태로 조용히 통과한다.
============================================================ */
describe('불변식 ⑤ CSS 가 참조하는 --토큰이 정의돼 있다', () => {
  const SRC = join(process.cwd(), 'src') + '/';

  /** 런타임에 JS 가 인라인으로 주입하는 변수 — CSS 에 정의가 없는 것이 **정상**이다.
   *  동적 색이라 정적 선언이 불가능하다(절대규칙 #3 의 구현 · 설계서 §4-6단계). */
  const RUNTIME_INJECTED = new Set(['--seg', '--sub', '--tint']);

  const cssFilesLocal = (): string[] => cssFiles(SRC);

  const files = cssFilesLocal();
  const all = files.map((f) => readFileSync(f, 'utf8')).join('\n');
  // 정의된 것 전부(tokens.css 든 feature 모듈이든 — 지역 변수도 정당한 정의다).
  const defined = new Set([...all.matchAll(/(--[a-z][\w-]*)\s*:/gi)].map((m) => m[1]!));

  /* ⚠ 옛 단언은 `files.length > 10` 이었다. 주석은 "0개면 아무것도 안 잰다"인데 값은 10이라,
     **통합할수록 게이트가 조여지는** 역인센티브가 됐다 — C-7 이 CSS Module 54개를 0으로 만들며
     실제로 이 줄에서 걸렸다(파일이 정확히 10개가 됐다). 카나리아가 정말로 지켜야 하는 것은
     "글롭이 아무것도 못 찾는 상태"와 "정의의 원천이 스캔 범위 밖으로 나가는 것"이므로
     개수 대신 **원천 파일의 존재**를 단언한다. */
  it('CSS 파일을 찾았다 — 특히 토큰 원천이 스캔 범위 안에 있다', () => {
    expect(files.length).toBeGreaterThan(0);
    const names = files.map((f) => f.replace(/\\/g, '/'));
    expect(names.some((n) => n.endsWith('/styles/tokens.css'))).toBe(true);
    expect(names.some((n) => n.endsWith('/styles/tokenBridge.css'))).toBe(true);
    expect(names.some((n) => n.endsWith('/styles/ds.css'))).toBe(true);
  });

  /* ⚠ **주석을 걷어낸 뒤 스캔한다.** 이 케이스는 E24 에서 물렸다: 브리지 주석에 이 불변식의
     탄생 사유(_"`var(--tx)` 오타"_)를 인용했더니 **그 인용이 위반으로 잡혔다.** 검사 대상은
     참조이고 주석은 참조가 아니다 — 주석 안 CSS 는 실행되지 않으므로 조용한 실패가 불가능하다.
     (불변식 ⑥이 같은 이유로 같은 처리를 한다. 이 저장소는 옛 이름·옛 값을 주석에 인용해 *왜
     바뀌었는지*를 남기는 문화라, 원문 스캔은 묘비명을 위반으로 읽는다.) */
  it('폴백 없는 var(--x) 참조가 전부 정의를 갖는다', () => {
    const missing: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of src.matchAll(/var\(\s*(--[a-z][\w-]*)\s*\)/gi)) {
        const name = m[1]!;
        if (defined.has(name) || RUNTIME_INJECTED.has(name)) continue;
        missing.push(`${f.replace(SRC, '')} → var(${name})`);
      }
    }
    /* ⚠ 폴백이 있는 참조(`var(--x, 1rem)`)는 검사하지 않는다 — 그건 "없을 수 있다"를
       작성자가 **명시한** 것이라 조용한 실패가 아니다. 폴백 없는 것만이 사고다. */
    expect([...new Set(missing)], `정의 없는 토큰:\n${[...new Set(missing)].join('\n')}`).toEqual([]);
  });
});

/* ============================================================
   불변식 ⑥ — **모션 어휘와 시간 사다리는 주석이 아니라 게이트가 지킨다** (E24 · 2026-07-30)

   E24 가 키프레임 32종 → 20종, 길이 리터럴 15종 → 토큰 8종으로 수렴시켰다. 그런데 그 수렴을
   지키는 것이 **주석뿐이면 원래 상태로 되돌아온다** — 32종이 생긴 경위가 정확히 그것이다
   (C-7 이 feature 를 하나씩 옮기는 동안 각 feature 의 키프레임이 그 feature 이름을 달고
   올라왔고, 아무 게이트도 "이건 이미 있는 움직임이다"라 말하지 않았다).

   ## 왜 정적 검사가 이걸 원리적으로 못 보는가

   - `stylelint` 는 색의 출처를 강제하지만(생 hex 금지) **시간에는 같은 규칙이 없었다** —
     `--dur-*` 토큰이 애초에 존재하지 않았기 때문이다.
   - 시각 스냅샷은 **정지 프레임**이라 길이·이징을 어떻게 바꿔도 통과한다(`e2e/motion.spec.ts`
     머리주석이 그 반증을 기록한다). 중간 프레임 하네스도 어휘당 한 장이라 *새로 생긴* 이름을
     못 본다.
   - 즉 새 키프레임 `xyz-fade-in 0.42s` 를 추가하는 커밋은 **전 게이트 녹색**이다.

   그래서 여기서 잠근다. 세 축이다: ① 어휘 이름 ② 길이 토큰 ③ WAAPI 상수 ↔ 토큰 동기.
============================================================ */
describe('불변식 ⑥ 모션 어휘·시간 사다리', () => {
  const SRC = join(process.cwd(), 'src') + '/';

  /** 선언된 어휘 접두사. 여기 없는 이름의 키프레임을 만들려면 **어휘를 먼저 늘려야** 한다
   *  (그 판단은 `lib/motion.ts` 머리주석 = 어휘 SSOT 에 남는다). */
  /* ⚠ **여섯 마디 + `vt`(전이)다.** 이 정규식이 어휘의 집행자이므로 여기 늘리는 것이 곧
     "어휘를 늘렸다"는 선언이고, 근거는 `lib/motion.ts` 머리주석이 진다 — 두 곳이 갈리면
     집행자가 SSOT 보다 관대해진다(그 순간 문법이 없어진다).
     ⚠⚠ **한때 여덟이었다**(A-17 `shift` · A-18 `deny` · 2026-08-07). 둘 다 소비처가 레일 조립
     화면 하나뿐이었고 그 화면이 은퇴하며 함께 갔다(I027 · 2026-08-22). 집행자를 안 좁히면
     **없는 마디로 키프레임을 지을 수 있게 되고**, 그건 어휘가 아니라 목록이다. */
  const VOCAB = /^(enter|shed|live|commit|draw|vt)-/;
  /** 어휘 밖 예외 — 사유가 코드에 적혀 있어야 하고, 늘어나면 그게 곧 문법 붕괴의 신호다. */
  const VOCAB_EXCEPTIONS = new Set([
    // 토스트 되돌리기 창의 남은 시간 바. 움직임이 장식이 아니라 **정보**이고 길이가 런타임값
    // (`animation-duration` 을 JS 가 ms 로 준다)이라 다섯 어휘 어디에도 속하지 않는다.
    'toastLife',
  ]);

  const filesUnderLocal = (pred: (name: string) => boolean): string[] => filesUnder(pred, SRC);

  /** ⚠ **주석을 먼저 걷어낸다.** 이 저장소의 주석은 옛 이름·옛 값을 인용해 *왜 바뀌었는지*를
   *  남기는 문화라(그게 규약이다) 원문을 그대로 스캔하면 `@keyframes ds-sp 가 여기 있었다` 같은
   *  묘비명이 위반으로 잡힌다 — 실제로 이 불변식의 첫 실행이 그렇게 실패했다. 검사 대상은
   *  **선언**이고 주석은 선언이 아니다. */
  /* ⚠ 지역 제거기를 다시 만들지 않는다(m-16) — `test/_sources.ts` 의 `strip` 한 벌이다.
     종전엔 여기가 **블록 주석만** 지웠고, 아래 세 케이스가 각자 `/\/\/.*$/gm` 를 덧붙였다.
     그 정규식은 문자열 속 `https://` 뒤까지 잘라 같은 줄의 선언을 **조용히 삭제**한다(오검).
     공용 `strip` 은 `[^:]` 가드로 그 함정을 피한다 — 불변식 ⑦·⑧이 이미 쓰던 형태다. */
  const stripComments = strip;

  const cssFiles = filesUnderLocal((n) => n.endsWith('.css'));
  const tsFiles = filesUnderLocal((n) => /\.tsx?$/.test(n));
  const allCss = cssFiles.map((f) => stripComments(readFileSync(f, 'utf8'))).join('\n');

  it('키프레임 이름이 전부 선언된 어휘에 속한다(컴포넌트 이름을 단 키프레임 0)', () => {
    const names = [...allCss.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]!);
    // ⚠ 조용한 통과 방지 — 정규식이 망가지면 0개가 되고 그건 녹색이 아니라 고장이다.
    expect(names.length).toBeGreaterThanOrEqual(15);
    const stray = names.filter((n) => !VOCAB.test(n) && !VOCAB_EXCEPTIONS.has(n));
    expect(
      stray,
      `어휘 밖 키프레임(enter|shed|shift|deny|live|commit|draw|vt 접두사 필요 · 어휘 SSOT=lib/motion.ts):\n${stray.join('\n')}`,
    ).toEqual([]);
  });

  it('CSS 의 animation/transition 길이가 리터럴이 아니다(사다리 밖 시간 금지)', () => {
    /* `animation:`·`transition:`·`animation-duration:`·`animation-delay:` 선언 안의 시간 리터럴.
       ⚠ 0 계열은 통과시킨다 — reduced-motion 백스톱(`0.01ms`·`0s`)은 "모션을 끈다"는 뜻이라
         사다리 칸이 아니다. 그 값을 토큰으로 바꾸면 백스톱이 사다리에 묶여 버린다. */
    const bad: string[] = [];
    for (const f of cssFiles) {
      const src = stripComments(readFileSync(f, 'utf8'));
      for (const m of src.matchAll(/(animation|transition)(-duration|-delay)?\s*:\s*([^;{}]+)/g)) {
        for (const t of m[3]!.matchAll(/(?<![\w.-])(\d+(?:\.\d+)?)(m?s)\b/g)) {
          const v = Number(t[1]);
          if (v === 0 || (t[2] === 'ms' && v <= 0.01)) continue;
          bad.push(`${f.replace(SRC, '')} → ${t[0]} (in \`${m[1]}${m[2] ?? ''}\`)`);
        }
      }
    }
    expect(
      bad,
      `시간 리터럴(토큰을 쓸 것 — tokens.css 의 --dur-*/--draw/--tempo-*/--stagger):\n${bad.join('\n')}`,
    ).toEqual([]);
  });

  it('JSX 의 animate-[…]·duration-… 길이가 리터럴이 아니다', () => {
    const bad: string[] = [];
    for (const f of tsFiles) {
      const src = stripComments(readFileSync(f, 'utf8'));
      for (const m of src.matchAll(/animate-\[[^\]]*\]/g)) {
        if (/(?<![\w.-])\d+(?:\.\d+)?m?s\b/.test(m[0])) bad.push(`${f.replace(SRC, '')} → ${m[0]}`);
      }
      /* `duration-fast|base|slow|draw`(테마 항목)만 허용. 임의값·숫자 스케일은 사다리 밖이다.
         ⚠ `duration-` 뒤 첫 토큰만 본다(`before:duration-fast` 같은 변형 접두사는 앞에 붙는다). */
      for (const m of src.matchAll(/\bduration-(\[[^\]]*\]|\d+)/g)) bad.push(`${f.replace(SRC, '')} → ${m[0]}`);
    }
    expect(bad, `시간 리터럴(JSX):\n${bad.join('\n')}`).toEqual([]);
  });

  /* ⚠⚠ **이 케이스는 E24 착수 중 실제로 물린 사고에서 나왔다.** 브리지에 `--duration-fast` 라
     적었는데(그럴듯하다) Tailwind v4 의 네임스페이스는 `--transition-duration-*` 다 → 테마 변수는
     출력되는데 **`duration-fast` 클래스가 생성되지 않았고**, 그러면 `transition-[width]
     duration-fast` 는 Tailwind 기본 150ms 로 조용히 떨어진다. typecheck·lint:css·build·스냅샷
     **전량 녹색**이었다 — 존재하지 않는 유틸리티 클래스는 CSS 에서 에러가 아니라 무규칙이기
     때문이다(불변식 ⑤가 잠근 `var(--tx)` 오타와 같은 부류의 침묵).
     ⚠ 빌드된 CSS 를 검사하지 않는 이유: 이 파일은 `dist/` 없이도 돌아야 한다(게이트 순서상
       유닛이 build 보다 앞이다). 대신 **이름 패리티**를 잠근다 — 사고의 원인이 정확히 그것이었다. */
  it('JSX 가 쓰는 duration-<이름> 이 브리지의 --transition-duration-<이름> 과 짝이다', () => {
    const bridge = readFileSync(join(SRC, 'styles', 'tokenBridge.css'), 'utf8');
    const used = new Set<string>();
    for (const f of tsFiles) {
      const src = stripComments(readFileSync(f, 'utf8'));
      for (const m of src.matchAll(/\bduration-([a-z][\w-]*)/g)) used.add(m[1]!);
    }
    // ⚠ 조용한 통과 방지 — 0개면 정규식이 망가진 것이다.
    expect(used.size).toBeGreaterThanOrEqual(3);
    const orphan = [...used].filter((n) => !bridge.includes(`--transition-duration-${n}:`));
    expect(
      orphan,
      `브리지에 없는 duration 이름(→ 클래스가 생성되지 않아 150ms 로 조용히 떨어진다):\n${orphan.join('\n')}`,
    ).toEqual([]);
  });

  /* ⚠⚠ **④ 이징 — 축이 하나 빠져 있었다**(2026-07-31 · 로드맵 E24 잔여의 답).
     로드맵은 "어휘마다 다른 이징이 필요한지는 실물로 보기 전엔 모른다"로 미뤘는데, 세어 보니
     **코드가 이미 셋을 쓰고 있었고 둘이 익명 리터럴**이었다(`ease-in-out` 2곳=live-breathe ·
     `linear` 2곳=진행 바). 즉 필요 여부는 이미 답이 나와 있었고, 문제는 그 답이 이름을 못 가져
     **게이트 밖에 있었다**는 것이다 — 길이가 정확히 같은 경위로 15종까지 흩어졌던 그 자리다.
     이름을 준 지금은 흩어질 경로를 막는다. `tokens.css` 만 값을 갖는다. */
  it('이징이 토큰 밖에서 리터럴로 쓰이지 않는다(tokens.css 만 값을 갖는다)', () => {
    const bad: string[] = [];
    const 리터럴 = /\b(cubic-bezier\(|ease-in-out\b|ease-linear\b|(?<![\w-])linear(?![\w-])\s*(?:;|,|\)))/;
    for (const f of [...cssFiles, ...tsFiles]) {
      if (f.endsWith(join('styles', 'tokens.css'))) continue; // 값의 주인
      const src = stripComments(readFileSync(f, 'utf8'));
      // 이징이 놓이는 자리만 본다: CSS 의 transition/animation 선언 + JSX 의 ease-*/animate-[…].
      const 자리 = [
        ...[...src.matchAll(/(?:animation|transition)(?:-timing-function)?\s*:\s*([^;{}]+)/g)].map((m) => m[1]!),
        ...[...src.matchAll(/\bease-[^\s'"`]+/g)].map((m) => m[0]),
        ...[...src.matchAll(/animate-\[[^\]]*\]/g)].map((m) => m[0]),
      ];
      for (const seg of 자리) if (리터럴.test(seg)) bad.push(`${f.replace(SRC, '')} → ${seg.trim().slice(0, 80)}`);
    }
    expect(
      bad,
      `이징 리터럴(토큰을 쓸 것 — --ease · --ease-live · --ease-draw · --ease-shed):\n${bad.join('\n')}`,
    ).toEqual([]);
  });

  it('이징 토큰 넷이 전부 선언돼 있다(소비만 잠그면 정의가 사라져도 통과한다)', () => {
    const tokensCss = readFileSync(join(SRC, 'styles', 'tokens.css'), 'utf8');
    for (const n of ['--ease', '--ease-live', '--ease-draw', '--ease-shed'])
      expect(new RegExp(`${n}:\\s*\\S`).test(tokensCss), `${n} 미정의`).toBe(true);
  });

  it('WAAPI 상수가 tokens.css 의 토큰과 같은 값이다(복제의 유일한 방어선)', () => {
    /* `lib/motion.ts` 의 `COMMIT_MS` 는 `--dur-slow` 의 복제다 — WAAPI 는 `var()` 를 못 읽어서
       (그 파일 머리주석) 복제가 불가피하고, 그래서 여기가 유일한 드리프트 방어선이다. */
    const tokensCss = readFileSync(join(SRC, 'styles', 'tokens.css'), 'utf8');
    const durSlow = /--dur-slow:\s*(\d+)ms/.exec(tokensCss);
    expect(durSlow, 'tokens.css 에 --dur-slow 가 ms 단위로 정의돼 있어야 한다').not.toBeNull();

    const motionTs = readFileSync(join(SRC, 'lib', 'motion.ts'), 'utf8');
    const commitMs = /const COMMIT_MS = (\d+);/.exec(motionTs);
    expect(commitMs, 'lib/motion.ts 에 COMMIT_MS 상수가 있어야 한다').not.toBeNull();

    expect(Number(commitMs![1]), 'COMMIT_MS ≠ --dur-slow — 둘 중 하나만 고쳤다').toBe(Number(durSlow![1]));

    /* ⚠⚠ 여기 `DENY_MS`(--dur-fast) · `SHIFT_MS`(--dur) 대조 둘이 더 있었다 — **그 두 상수가
       은퇴했다**(I027 · 2026-08-22 · `lib/motion.ts` 의 어휘 절). 복제가 사라졌으므로 그 방어선도
       사라진다: 없는 상수를 계속 단언하면 «있어야 한다»가 곧 «되살려라»가 되고, 그건 은퇴를
       되돌리라는 명령이 검사망에 숨어 있는 형태다. WAAPI 리터럴 복제는 이제 `COMMIT_MS` 하나다. */
  });
});

/* ============================================================
   불변식 ⑦ — **모션 자제 판정은 `lib/motion` 하나다** (H19 · 2026-07-30 `/감사 근본`)

   자제해야 할 이유는 둘인데(OS 의 `prefers-reduced-motion`, 앱 설정의 `data-fx="lite"`)
   판정이 다섯 곳에 흩어져 있었고 **그중 둘만 후자를 알았다**. 결과가 관측 가능한 거짓말이었다:
   설정 라벨이 "발광 펄스 정지"를 약속하는데 `commit()` 의 링 펄스는 계속 돌았다.

   ⚠ 이 불변식이 없으면 재발이 **조용하다** — 새 컴포넌트가 `matchMedia('(prefers-reduced-motion…')`
   를 한 줄 부르는 순간 그 화면만 앱 설정을 모르게 되고, 정적 검사도 스냅샷도 그걸 못 본다
   (모션 자제 사용자의 화면에서만 다르게 보인다).
   ⚠ **MediaQueryList 를 만드는 것 자체는 막지 않는다** — 변화를 *듣는* 것은 정당하다.
   막는 것은 그 `.matches` 를 **판정으로 읽는 것**이다.
   (예로 들던 `AmbientCanvas`·`Graph` 는 둘 다 은퇴했다 — 예시를 지웠고 규칙은 그대로다 · C061)
============================================================ */
describe('불변식 ⑦ 모션 자제 판정이 lib/motion 밖에 없다', () => {
  const SRC7 = join(process.cwd(), 'src') + '/';
  const OWNER = join(SRC7, 'lib', 'motion.ts');

  const tsFilesLocal = (): string[] => tsFiles(SRC7);

  it('`.matches` 로 모션 자제를 직접 판정하는 파일이 없다', () => {
    const offenders = tsFilesLocal()
      .filter((p) => p !== OWNER)
      .filter((p) => {
        /* ⚠ **주석을 걷어내고 본다.** 안 그러면 "종전엔 `reduce.matches` 를 읽었다"고 적어 둔
           설명이 위반으로 잡힌다(실제로 잡혔다) — 근거를 남길수록 게이트가 빨개지는 역인센티브는
           이 저장소가 `max-lines` 에서 이미 거부한 형태다. */
        const src = readFileSync(p, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])\/\/.*$/gm, '$1');
        // `<이름>.matches` 형태로 읽는 자리 — 그 이름이 reduced-motion 질의로 만들어졌는가.
        if (!/prefers-reduced-motion/.test(src)) return false;
        return /\breduce\.matches\b|matchMedia\([^)]*prefers-reduced-motion[^)]*\)\.matches/.test(src);
      })
      .map((p) => p.slice(SRC7.length).replaceAll('\\', '/'));
    expect(
      offenders,
      `모션 자제 판정을 직접 하고 있다(앱 설정 data-fx 를 모르는 사본이 된다) — \`prefersReducedMotion()\` 을 쓰세요:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('판정 소유자가 **두 이유를 모두** 본다(0이면 이 불변식이 아무것도 안 잰다)', () => {
    const owner = readFileSync(OWNER, 'utf8');
    expect(owner).toMatch(/prefers-reduced-motion/);
    expect(owner, "앱 설정('발광 효과 줄이기')을 안 보면 라벨이 거짓이 된다").toMatch(/data-fx/);
  });
});

/* ============================================================
   불변식 ⑧ — **타이포·스태킹에도 사다리가 있다** (H29 · 2026-07-30 `/감사 근본`)

   모션은 어휘 다섯 마디 + 길이 토큰 8종으로 닫고 불변식 ⑥이 지킨다(E24). 그런데 같은 성질의
   두 축은 **집행자가 0** 이었다:

   · `leading-[…]` 임의값 **234곳 · 20종** — 새 화면마다 새 줄높이가 생겨도 아무도 모른다.
   · `z-*` 이원화 — 앱 크롬은 `--z-*` 토큰인데 일부는 생 숫자였다(`z-10` 이 그 형태).

   ⚠ 생 숫자 z 를 **전부** 막지는 않는다. 컴포넌트 **내부** 스태킹(막대 위에 숫자 · 오버레이 위
   배지)은 지역적이고 한 자리로 충분하다 — 그건 이름 붙일 관계가 아니라 그리기 순서다.
   막는 것은 **두 자리 이상**이다: 그 크기는 앱 전역 레이어와 겨루겠다는 뜻이고, 그 겨룸은
   `--z-*` 사다리가 이미 이름으로 정리해 뒀다.
============================================================ */
describe('불변식 ⑧ 줄높이·스태킹이 사다리를 벗어나지 않는다', () => {
  const SRC8 = join(process.cwd(), 'src') + '/';
  /** 윈도우 경로 구분자 — 리터럴로 쓰면 이스케이프가 헷갈린다(실제로 두 번 물렸다). */
  const SEP_BS = String.fromCharCode(92);

  /* ⚠ **공용 `sources()` 를 쓴다**(V027 · 2026-08-22). 여기 15줄짜리 지역 워커가 있었는데
     `test/_sources.ts` 의 `sources()` 와 **하는 일이 같았다**(재귀 순회 + 주석 제거).
     ⑩이 2026-08-21 에 같은 정리를 받았고 남은 셋(⑧·⑪·⑬)이 이월돼 있었다.
     사본을 두면 «주석을 어떻게 걷는가»가 불변식마다 갈리고, 그건 실제로 갈려 있었다 —
     ⑪은 **줄 맨 앞의 줄 주석만** 지워 줄 끝 주석을 못 걷었고, ⑬은 m-16 때까지 아예 원문을 봤다.
     경로 모양만 이 불변식의 것으로 맞춘다(`src/` 기준 상대). */
  const sourcesLocal = (): { path: string; code: string }[] =>
    sources().map(({ path, code }) => ({ path: path.slice(SRC8.length).split(SEP_BS).join('/'), code }));

  it('`leading-[…]` 임의값이 없다 — 줄높이는 `--leading-*` 사다리에서 고른다', () => {
    const bad = sourcesLocal()
      .flatMap(({ path, code }) => (code.match(/leading-\[[^\]]+\]/g) ?? []).map((m) => `${path}: ${m}`))
      .sort();
    expect(
      bad,
      `줄높이 임의값 ${bad.length}건 — \`tokenBridge.css\` 의 --leading-* 중에서 고르세요(auto/flat/none/display/tight/snug/body/text/loose):\n${bad.join('\n')}`,
    ).toEqual([]);
  });

  it('두 자리 이상 z-index 는 `--z-*` 토큰으로만 쓴다(앱 레이어와 겨루는 크기다)', () => {
    const bad = sourcesLocal()
      .flatMap(({ path, code }) => (code.match(/\bz-\[(\d{2,})\]|\bz-(\d{2,})\b/g) ?? []).map((m) => `${path}: ${m}`))
      .sort();
    expect(
      bad,
      `생 z-index ${bad.length}건 — \`z-[var(--z-nav|dropdown|toast|modal|dialog|tooltip|palette)]\` 를 쓰세요:\n${bad.join('\n')}`,
    ).toEqual([]);
  });

  /* ⚠⚠ **hover 강조 세기도 같은 부류였다(H31 · 2026-07-31 `/감사 근본`).**
     실측 4값(`1.07`·`1.08`·`1.14`·`1.16`) — 인접 차이가 0.9%·1.8% 다. 모션 규약이 _"2% 이하면
     드리프트"_ 로 못박은 폭인데 이 축만 집행자가 0 이었다. 줄높이(H29)와 **완전히 같은 처방**의
     미적용분이라 여기 나란히 둔다(`--brightness-emph`·`--brightness-emph-strong`).
     ⚠ Tailwind 기본 스케일(`brightness-105` 등)은 막지 않는다 — 그건 이름 있는 사다리다.
       금지 대상은 **임의값**(`brightness-[…]`) 하나다. */
  it('`brightness-[…]` 임의값이 없다 — 강조 세기는 `--brightness-emph*` 두 칸에서 고른다', () => {
    const bad = sourcesLocal()
      .flatMap(({ path, code }) => (code.match(/brightness-\[[^\]]+\]/g) ?? []).map((m) => `${path}: ${m}`))
      .sort();
    expect(
      bad,
      `강조 세기 임의값 ${bad.length}건 — 큰 면은 \`brightness-emph\`, 작은 마커는 \`brightness-emph-strong\`:\n${bad.join('\n')}`,
    ).toEqual([]);
  });

  it('사다리가 실제로 정의돼 있다(0이면 이 불변식이 아무것도 안 잰다)', () => {
    const bridge = readFileSync(join(SRC8, 'styles', 'tokenBridge.css'), 'utf8');
    const steps = [...bridge.matchAll(/--leading-([a-z]+):/g)].map((m) => m[1]);
    expect(steps.length, '--leading-* 사다리가 없으면 위 검사는 "쓰지 말라"만 하고 대안이 없다').toBeGreaterThanOrEqual(
      8,
    );
    expect(steps).toContain('text');
    // 강조 세기 사다리도 같은 이유로 **존재**를 단언한다(분모가 없으면 위 검사는 금지만 한다).
    const emph = [...bridge.matchAll(/--brightness-(emph[a-z-]*):/g)].map((m) => m[1]);
    expect(emph, '--brightness-emph* 두 칸이 없으면 대안 없이 금지만 하는 셈이다').toEqual(['emph', 'emph-strong']);
  });
});

/* ============================================================
   불변식 ⑫ — **폰이 쓰는 `ds-*` 는 폰 CSS 안에 있어야 한다** (2026-08-01)

   ## 왜 이게 게이트여야 하는가 — 실사고에서 나왔다

   폰 엔트리(`phone/main.tsx`)는 `tokens.css` + `phone/phone.css` 만 싣는다. `styles/ds.css` 는
   **데스크톱 `main.tsx` 만** import 한다(번들 분리가 의도다 — 설계서 §9-4: 셀룰러 첫 로드).
   그래서 폰 화면이 `ds-*` 를 쓰면 **클래스가 아예 존재하지 않아 무스타일로 렌더된다.**

   P-17 에서 정확히 이 일이 났다: 사본 감쇠 4형태를 `ds-shed` 로 수렴시키면서 폰 3곳
   (`DayView` 2 · `TodayView` 1)도 함께 바꿨는데, 폰에서는 완료된 블록이 취소선도 감쇠도 없이
   본문색 그대로 나왔다.

   ⚠⚠ **기존 게이트가 원리적으로 못 잡는다** — 이게 이 불변식의 존재 이유다:
   · 정적 검사·타입: 클래스 *존재*를 안 본다(문자열이다).
   · 폰 a11y: 무스타일이면 글자가 오히려 **더 밝아져** 대비를 통과한다.
   · `phone.spec.ts`: 스냅샷을 안 찍는다(설계상 — 베이스라인 두 벌 방지).
   즉 세 겹이 전부 초록인 채로 화면만 틀린다. 잡은 것은 "폰이 어떤 CSS 를 싣는가"를 손으로
   읽은 것뿐이었고, 손으로 읽는 것은 다음번에 반복되지 않는다.

   ⚠ 이 불변식은 "폰이 `ds-*` 를 쓰지 마라"가 **아니다** — 데스크톱과 같은 이름을 쓰는 것은
   오히려 규약(같은 뜻은 같은 이름)이다. 요구하는 것은 **그 이름이 폰 CSS 에도 정의돼 있을 것**
   하나이고, 정의가 두 곳이면 값이 갈릴 수 있다는 위험은 각 선언의 주석이 진다(포커스 링 선례).
============================================================ */
describe('불변식 ⑫ 폰이 쓰는 ds-* 가 폰 번들에 정의돼 있다', () => {
  const SRC = join(process.cwd(), 'src') + '/';
  const phoneDir = join(SRC, 'phone');

  const tsxUnder = (dir: string): string[] => tsFiles(dir);

  /** ⚠ **주석을 걷어낸다 — 반증으로 잡았다.** 이 저장소의 주석은 옛 이름·근거를 인용하는 문화라
   *  `phone.css` 의 `.ds-shed` 설명 문단 자체가 "선언"으로 세어졌다. 선언을 통째로 지우고
   *  돌렸더니 **초록으로 통과**했다 — 불변식 ⑥이 같은 함정을 이미 기록해 뒀는데 안 썼다. */
  const 주석제거 = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

  it('폰 화면의 모든 ds-* 클래스가 phone.css 에 선언돼 있다', () => {
    const phoneCss = 주석제거(readFileSync(join(phoneDir, 'phone.css'), 'utf8'));
    const used = new Set<string>();
    for (const f of tsxUnder(phoneDir)) {
      const src = readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      for (const m of src.matchAll(/\bds-[a-zA-Z0-9-]+/g)) used.add(m[0]);
    }
    // ⚠ `String.raw` — 평범한 템플릿 리터럴이면 `\b` 가 정규식 경계가 아니라 **백스페이스 문자**로
    //   해석돼 이 검사가 영영 매치에 실패한다(즉 항상 빨갛다). 첫 판이 정확히 그랬다.
    const 미정의 = [...used].filter((c) => !new RegExp(String.raw`\.${c}\b`).test(phoneCss));
    expect(
      미정의,
      `폰이 쓰지만 phone.css 에 없는 클래스(무스타일로 렌더된다 — ds.css 는 폰 번들에 없다):\n${미정의.join('\n')}`,
    ).toEqual([]);
  });

  it('phone.css 의 ds-* 선언이 ds.css 의 같은 이름과 **같은 속성 집합**이다(값 드리프트 감지)', () => {
    /* 값까지 문자 비교하면 포맷 차이로 깨지므로 **속성 이름 집합**을 본다 — 한쪽에만 속성이
       생기거나 사라지는 것이 드리프트의 관측 가능한 형태다(색만 바뀌는 미세 차이는 못 잡지만,
       그건 두 선언의 주석이 지는 몫이다). */
    const 속성집합 = (css: string, cls: string): string[] | null => {
      const m = new RegExp(String.raw`\.${cls}\s*\{([^}]*)\}`).exec(css);
      if (!m) return null;
      return [...m[1]!.matchAll(/(^|\n)\s*([a-z-]+)\s*:/g)].map((x) => x[2]!).sort();
    };
    const phoneCss = 주석제거(readFileSync(join(phoneDir, 'phone.css'), 'utf8'));
    const dsCss = 주석제거(readFileSync(join(SRC, 'styles', 'ds.css'), 'utf8'));
    for (const cls of [...phoneCss.matchAll(/\.(ds-[a-zA-Z0-9-]+)\s*\{/g)].map((m) => m[1]!)) {
      const a = 속성집합(phoneCss, cls);
      const b = 속성집합(dsCss, cls);
      if (!b) continue; // 폰 전용 클래스 — 대조할 원본이 없다
      expect(a, `${cls} 의 속성이 ds.css 와 갈렸다(같은 뜻이 두 화면에서 다르게 보인다)`).toEqual(b);
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   불변식 ⑨ — **뷰 전이 morph 이름은 규약에서만 나온다** (Q-11 · 2026-08-02)

   morph 는 "같은 객체를 따라간다"는 뜻을 픽셀로 말하는 유일한 어휘다. 그런데 종전엔 이름을
   **호출부가 각자 지었고**(`subject-morph`·`atlas-hero`) 그중 어느 것도 **id 를 담지 않았다**.
   id 가 없으면 같은 종류의 카드가 둘 이상 이름을 갖는 순간 브라우저가 짝을 못 지어 **전환이
   통째로 죽는다** — 그리고 그 실패는 조용하다(에러도 로그도 없이 크로스페이드로 떨어진다).

   ⚠ 이 불변식이 못 보는 것: 규약을 쓰되 **entity 를 잘못 고른** 경우(예: 목록은 'subject',
   상세는 'course'). 짝이 안 맞으면 역시 조용히 죽는다. 그건 §15-4(실렌더 확인)의 몫이다.
──────────────────────────────────────────────────────────────────────────── */
/** 윈도우 경로를 POSIX 로 — `endsWith('lib/motion.ts')` 가 플랫폼에 따라 갈리지 않게. */
const normPath = (p: string): string => p.split(String.fromCharCode(92)).join('/');

describe('불변식 ⑨ morph 이름은 lib/motion 의 규약에서만 나온다', () => {
  const SRC = join(process.cwd(), 'src') + '/';
  // 스캐너는 `test/_sources.ts` 한 벌이다(m-16). 지역 이름은 `tsFiles` 를 가리지 않게 바꾼다.
  const srcTsFiles = tsFiles(SRC);

  it('viewTransitionName 에 문자열 리터럴을 직접 넣지 않는다', () => {
    const bad: string[] = [];
    for (const f of srcTsFiles) {
      if (normPath(f).endsWith('lib/motion.ts')) continue; // 규약 자신
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      // `viewTransitionName: 'x'` / `viewTransitionName = 'x'` 둘 다 잡는다.
      for (const m of src.matchAll(/viewTransitionName\s*[:=]\s*(['"`])/g)) {
        bad.push(`${f.replace(SRC, '')} → ${m[0]}`);
      }
    }
    expect(bad, `morph 이름은 morphName()/applyMorph() 로만 짓는다(id 가 없으면 짝이 유일하지 않다)`).toEqual([]);
  });

  it('규약이 실제로 쓰이고 있다(0이면 이 불변식이 아무것도 안 잰다)', () => {
    const users = srcTsFiles.filter((f) => {
      if (normPath(f).endsWith('lib/motion.ts')) return false;
      return /\b(applyMorph|morphName)\s*\(/.test(readFileSync(f, 'utf8'));
    });
    expect(users.length).toBeGreaterThan(0);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   불변식 ⑩ — **한 화면에 동시에 도는 `live` 는 최대 둘** (Q-18 · 2026-08-02)

   `live` 는 모션 어휘 여섯 마디 중 유일하게 **끝나지 않는** 것이다(맥동·오라·펄스). 그래서
   개수가 곧 밀도이고, 셋을 넘기면 "지금 무엇이 살아 있는가"가 신호가 아니라 배경이 된다.

   ## ⚠⚠ 이 불변식이 필요한 이유 — 모션 게이트가 **원리적으로** 못 본다
   `e2e/motion.spec.ts` 머리주석이 스스로 적어 뒀다: _"길이는 잡고 **무한 주기는 픽셀로 못
   잡는다**"_. 정지 프레임을 아무리 찍어도 무한 애니의 개수는 안 드러난다 — 프레임 하나에는
   그것들이 우연히 어느 위상에 있든 그냥 정적인 점으로 찍힌다. 즉 이 축은 **세는 검사**로만
   지킬 수 있고, 안 세면 `live` 는 조용히 늘어난다(23회까지 늘어난 경위가 그것이다).

   ⚠⚠ **무엇을 세는가가 이 검사의 정확도 전부다.** 첫 구현은 `live-*` 문자열을 전부 셌는데,
   그러면 마커 클래스(`live-aura`)와 키프레임 이름(`live-breathe`)이 **한 줄에서 이중으로**
   잡혀 "무한 애니 2개"를 3으로 읽었다(실제로 그 오탐이 첫 실행에 나왔다). 세야 하는 것은
   **애니메이션을 거는 지점**이다 → `animate-[live-…]` 의 등장 횟수.

   ⚠ 세는 단위는 **소스의 등장 횟수**이지 런타임 노드 수가 아니다. 목록 안의 한 줄이 20행으로
   렌더되면 20개가 도는데 그건 이 검사가 못 본다 — 그 층은 §15-4(실렌더 확인)의 몫이다.
   여기서 막는 것은 **어휘가 화면마다 늘어나는 것**이다.
──────────────────────────────────────────────────────────────────────────── */
describe('불변식 ⑩ 화면 하나가 무한 애니를 셋 이상 걸지 않는다', () => {
  /** 화면 파일당 상한. 둘까지가 "이것과 저것이 살아 있다"이고, 셋부터는 배경이다. */
  const LIVE_CAP = 2;
  /** 어휘 정의부·공유 프리미티브는 제외 — 정의는 한 곳에 모여 있는 것이 정상이다. */
  const DEFS = /(styles|components\/ui)\//;
  /* ⚠ **지역 파일 워커를 지웠다**(V027 · 2026-08-21). m-16 이 11벌의 워커·4벌의 주석제거기를
     `test/_sources.ts` 한 벌로 접었는데 이 블록만 자기 것을 들고 있었다 — 그리고 주석 제거도
     **블록 주석만** 걷어서 **줄 주석(`//`) 안의 `animate-[live-*]` 는 위반으로 셌다**.
     공용 `strip` 은 그 두 문법을 다 걷고 `https://` 오검까지 피한다(그 파일 머리주석이 SSOT). */
  const 화면들 = tsxFiles().filter((f) => !DEFS.test(aliasOf(f)));

  it(`화면 파일당 live-* 등장이 ${LIVE_CAP}회 이하다`, () => {
    const over = 화면들
      .map((f) => ({
        이름: aliasOf(f),
        n: [...strip(readFileSync(f, 'utf8')).matchAll(/animate-\[live-[a-z-]+/g)].length,
      }))
      .filter((x) => x.n > LIVE_CAP)
      .map((x) => `${x.이름} → ${x.n}회`);
    expect(over, '무한 애니가 화면에 셋 이상이면 그건 신호가 아니라 배경이다').toEqual([]);
  });

  it('live 어휘가 실제로 쓰이고 있다(0이면 이 불변식이 아무것도 안 잰다)', () => {
    const used = 화면들.some((f) => /animate-\[live-[a-z-]+/.test(strip(readFileSync(f, 'utf8'))));
    expect(used).toBe(true);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   불변식 ⑪ — **파괴적 동작은 3단 사다리 어휘로만 말한다** (Q-13 · 2026-08-02)

   이 앱에는 파괴를 다루는 관용구가 **두 벌 공존**했다: `ui.confirm`(7파일 14곳)과 전역 ⌘Z.
   둘이 만나는 자리가 증상이었다 — 학기 삭제·과목 삭제는 **확인창을 띄운 뒤** "⌘Z 로 되돌리기"를
   알렸다(같은 안전장치 이중 과금). 반대편엔 `UpdateCard` 의 **`window.confirm`** 이 있었다:
   앱에서 가장 파괴적인 확인 하나가 포커스 트랩·`isModalOpen()` 키 게이트 **밖**에 있었다.

   그래서 어휘를 세 마디로 닫고(`shell/destructive.ts` 가 SSOT) 여기서 **직접 호출을 0으로**
   잠근다. 어휘를 강제해야 하는 이유는 모션 어휘(⑥)와 같다 — 주석으로만 둔 규약은 다음 삭제
   버튼이 `confirm(` 을 한 번 더 부르는 순간 조용히 무너지고, 그 무너짐은 **아무 게이트도 안
   빨개진다**(둘 다 동작하기 때문이다).

   ⚠ 이 불변식이 **못 보는 것**: 어느 단을 골랐는지의 타당성. ①(안 묻는다)로 분류했는데 실은
   ⌘Z 스택에 안 들어가는 편집이면 되돌릴 수 없는 삭제가 조용히 일어난다 — 실제로 `BookShelf`
   가 그 경계선이었다(`useApp` 이 아니라 읽을거리 블롭이라 ③이 맞다). 그 판정은 사람이 한다.
──────────────────────────────────────────────────────────────────────────── */
describe('불변식 ⑪ confirm 직접 호출이 사다리 밖에 없다', () => {
  const SRC11 = join(process.cwd(), 'src') + '/';
  /** 어휘의 정의부 둘 — 여기서만 `confirm(` 이 등장하는 것이 정상이다. */
  const LADDER = ['shell/modal.tsx', 'shell/destructive.ts'];

  /* ⚠⚠ **공용 `sources()`·`strip` 을 쓴다**(V027 · 2026-08-22). 여기엔 지역 워커 **와**
     지역 `strip` 이 둘 다 있었고, 그 지역 `strip` 은 줄 주석을 **줄 맨 앞의 것만** 지워
     **줄 끝 주석(`foo(); // confirm(…)`)을 못 걷었다** — 공용 것은 앞 글자를 되돌리는 형태라 그것도 걷고
     `http://` 를 안 자른다. 즉 사본이 «주석을 걷는다»는 같은 말을 하면서 다른 일을 하고 있었다.
     ⚠ 주석을 걷는 이유는 그대로다: 이 저장소는 *왜 그렇게 했는지*를 주석에 옛 코드로 인용하는
     습관이 있어(⑤·⑥이 같은 처리를 하는 이유), 근거를 남길수록 빨개지면 역인센티브가 된다. */
  const sources11 = (): { rel: string; code: string }[] =>
    sources().map(({ path, code }) => ({ rel: normPath(path).replace(normPath(SRC11), ''), code }));

  it('사다리 정의부 밖에서 confirm( 을 부르지 않는다', () => {
    const bad: string[] = [];
    for (const { rel, code } of sources11()) {
      if (LADDER.includes(rel)) continue;
      // `confirmLossy(`·`confirmIrreversible(` 는 사다리 어휘다 — 뒤에 영문자가 오면 통과.
      // `code` 는 `sources()` 가 이미 주석을 걷어 준다(V027) — 여기서 또 걷지 않는다.
      const hits = [...code.matchAll(/(?<![A-Za-z])confirm\((?!\s*['"`]?\s*\))/g)];
      if (hits.length) bad.push(`${rel} → ${hits.length}회`);
    }
    expect(bad, '파괴적 동작은 shell/destructive 의 세 마디로만 말한다(그 파일 머리주석)').toEqual([]);
  });

  it('사다리 세 마디가 실제로 쓰이고 있다(0이면 이 불변식이 아무것도 안 잰다)', () => {
    const all = sources11()
      .filter(({ rel }) => !LADDER.includes(rel))
      .map(({ code }) => code)
      .join('\n');
    for (const w of ['commitUndoable', 'confirmLossy', 'confirmIrreversible']) expect(all).toContain(w);
  });
});

/* ============================================================
   불변식 ⑬ — **폼 스킨의 타입 목록이 실제 쓰이는 타입을 덮는다** (2026-08-08)

   `styles/global/components.css` 는 텍스트형 입력의 겉모습(폭·배경·테두리·패딩·포커스링)을
   **타입 열거**로 건다. 열거인 것은 의도다 — 뒤집으면(`input:not([type='checkbox'], …)`)
   타입 없는 인라인 입력 열(스케줄 추가칸·폰 캡처바·ics 주소)이 통째로 이 스킨을 뒤집어쓴다.

   ## 왜 게이트여야 하는가 — 실제로 표류했고, 기존 게이트 전부가 못 봤다

   `type='search'`(찾기 화면의 **유일한 컨트롤**)와 `type='url'`(설정›클라우드 서버 주소)이
   목록에 없어서 **아무 스킨도 안 입은 네이티브 상자**로 렌더되고 있었다. 못 잡은 이유:
   · 타입·린트: CSS 셀렉터와 JSX 속성의 관계를 모른다.
   · 시각 스냅샷: **회귀가 아니라 처음부터 그랬다** → 베이스라인이 그 모습으로 굳어 있었다.
   · a11y(axe): 무스타일 입력은 흰 배경 + 검은 글자라 대비를 오히려 **더 잘** 통과한다.
   즉 세 겹이 초록인 채로 화면만 낡아 보였다.

   ⚠ 이 불변식이 **못 보는 것**: 예외 목록에 넣는 판단의 타당성(그건 사람이 한다). 잡는 것은
   *새 타입이 조용히 스킨 없이 들어오는 것* 하나다.
──────────────────────────────────────────────────────────────────────────── */
describe('불변식 ⑬ <input type> 이 전역 폼 스킨에 등재돼 있다', () => {
  const SRC13 = join(process.cwd(), 'src');
  /** 텍스트형 스킨을 **의도적으로 안 받는** 타입 — 각자 자기 규칙이 이미 있다. */
  const EXEMPT = new Set([
    'checkbox', // 커스텀 체크박스(같은 파일에 자기 절이 있다)
    'radio',
    'file', // 두 곳 다 `hidden` — 버튼이 대리 클릭한다
    'range',
    'color',
    'button',
    'submit',
    'reset',
    'hidden',
    'image',
  ]);

  /** `src/**` 의 모든 `<input …>` 여는 태그. */
  function inputTags(): { rel: string; tag: string }[] {
    const out: { rel: string; tag: string }[] = [];
    /* ⚠⚠ **주석을 걷어낸다**(m-16). 이 불변식만 원문을 그대로 스캔하고 있었다 — 그러면
       주석에 옛 마크업을 인용하는 순간 위반이 되고, 고치는 유일한 길이 **프로덕션 CSS 를
       바꾸는 것**이 된다. 이 파일이 네 번이나 "근거를 남길수록 게이트가 빨개지면 그건
       역인센티브다"라고 못박은 그 규율을, 가장 최근 케이스가 안 받고 있었다.
       ⚠ 걷는 일도 순회하는 일도 **`sources()` 한 곳이 한다**(V027 · 2026-08-22) — 여기 있던
       지역 워커가 ⑧·⑪ 의 것과 사본 셋이었고, 그 셋의 주석 처리가 실제로 갈려 있었다. */
    for (const { path: p, code } of sources()) {
      if (!/\.tsx$/.test(p)) continue;
      const rel = normPath(p).replace(normPath(SRC13) + '/', '');
      /* JSX 는 속성 안에 `>` 를 품을 수 있다(`onChange={(e) => …}`) → 중괄호 깊이를 세며
             태그 끝을 찾는다. 정규식 하나로 끊으면 타입 속성이 잘려 **거짓 통과**가 된다. */
      for (const m of code.matchAll(/<input\b/g)) {
        let depth = 0;
        let end = m.index;
        for (let j = m.index; j < code.length; j++) {
          const c = code[j];
          if (c === '{') depth++;
          else if (c === '}') depth--;
          else if (c === '>' && depth === 0) {
            end = j;
            break;
          }
        }
        out.push({ rel, tag: code.slice(m.index, end + 1) });
      }
    }
    return out;
  }

  /** `components.css` 가 실제로 스킨을 거는 타입(문서를 믿지 않고 CSS 를 읽는다). */
  function skinnedTypes(): Set<string> {
    const css = readFileSync(join(SRC13, 'styles', 'global', 'components.css'), 'utf8');
    /* 셀렉터 목록 → `{` 직전까지. 텍스트형 스킨 블록은 `width: 100%` 로 시작하는 그 하나다. */
    const block = css.match(/((?:input\[type='[a-z]+'\],\s*)+[\s\S]*?)\{\s*width:\s*100%/);
    return new Set([...(block?.[1].matchAll(/input\[type='([a-z]+)'\]/g) ?? [])].map((m) => m[1]));
  }

  it('스킨 블록이 실제로 존재한다(0이면 아래 검사가 아무것도 안 잰다)', () => {
    expect(skinnedTypes().size, 'components.css 의 텍스트형 입력 스킨 블록을 못 찾았다').toBeGreaterThanOrEqual(6);
  });

  it('쓰이는 모든 <input type> 이 스킨 목록이거나 면제 목록에 있다', () => {
    const skinned = skinnedTypes();
    const bad = inputTags()
      .map(({ rel, tag }) => ({ rel, type: /\btype=["']([a-z]+)["']/.exec(tag)?.[1] }))
      .filter(({ type }) => type && !skinned.has(type) && !EXEMPT.has(type))
      .map(({ rel, type }) => `${rel}: type="${type}"`)
      .sort();
    expect(
      [...new Set(bad)],
      `스킨 없는 입력 타입 — styles/global/components.css 의 타입 열거에 추가하거나, 안 받는 것이 의도라면 EXEMPT 에 이유와 함께 적어라:\n${bad.join('\n')}`,
    ).toEqual([]);
  });
});

/* ============================================================
   불변식 ⑭ **테스트만 import 하는 프로덕션 모듈이 없다**(2026-08-20 리뷰 m-4).

   ## 왜 테스트가 집행자인가 — knip 이 원리적으로 못 본다

   `knip.jsonc` 는 `test/**` 를 entry 로 잡는다. 그래서 테스트만 쓰는 `src/` 모듈은 영원히
   *사용 중*이다. entry 에서 빼 봤지만 **knip 의 vitest 플러그인이 자동으로 다시 넣는다**
   (프로브로 실측 · 그 파일 머리주석에 적어 뒀다). 즉 설정으로는 못 고치는 축이다.

   실제로 그 구멍으로 둘이 샜다:
   · `lib/predictionScore.ts`(125줄) — 프로덕션 소비처 0. 삭제됨.
   · `lib/since.ts`(65줄) — 프로덕션 소비처 0인데 **짝인 쓰기 경로는 살아서 매 내비게이션마다
     돌고 있었다**(`app/useMarkSeen` → `useUI.seenDs`(당시 이름 `seenAt`), 읽는 코드 0곳). 표시를 맡던 `SubTabs` 가
     N-14/W5 에서 은퇴할 때 판정·시점이 함께 안 걷힌 것이다. 레일 신호로 되살렸다.

   ## ⚠ 무엇을 위반으로 보나

   `src/` 안의 모듈 중 **`src/` 어디에서도 import 되지 않는데 `test/` 에서는 import 되는 것**.
   진입점·자동 로드 파일은 정의상 `src/` 참조가 없으므로 면제 목록에 둔다 — 면제가 늘어나면
   그게 곧 "이 검사가 무뎌지고 있다"는 신호이니 사유를 함께 적을 것.
============================================================ */
describe('불변식 ⑭ 테스트만 쓰는 프로덕션 모듈이 없다', () => {
  /** 정의상 `src/` 안에서 참조되지 않는 파일 — 번들러·러너·HTML 이 직접 문다. */
  const ENTRYPOINTS = new Set([
    '@/main', // index.html
    '@/phone/main', // phone.html
    '@/lib/db/sqlite.worker', // new Worker(new URL(...))
    '@/vite-env.d', // 타입 선언
  ]);

  it('src/ 에서 아무도 안 쓰는데 테스트만 쓰는 모듈이 없다', () => {
    const srcFiles = tsFiles(SRC);
    const testFiles = filesUnder((n) => /\.tsx?$/.test(n), join(process.cwd(), 'test'));

    const usedInSrc = new Set<string>();
    for (const f of srcFiles) {
      for (const spec of importSpecifiers(strip(readFileSync(f, 'utf8')))) {
        if (spec.startsWith('@/')) usedInSrc.add(spec.replace(/\.tsx?$/, ''));
        else if (spec.startsWith('.')) {
          // 상대경로 → 별칭으로 정규화(한 모듈이 두 표기로 세어지지 않게).
          const abs = join(f, '..', spec).split(sep).join('/');
          const i = abs.indexOf('/src/');
          if (i >= 0) usedInSrc.add('@/' + abs.slice(i + 5).replace(/\.tsx?$/, ''));
        }
      }
    }

    const usedInTest = new Set<string>();
    for (const f of testFiles) {
      for (const spec of importSpecifiers(strip(readFileSync(f, 'utf8')))) {
        if (spec.startsWith('@/')) usedInTest.add(spec.replace(/\.tsx?$/, ''));
      }
    }

    // ⚠ 조용한 통과 방지 — 그래프가 비면 이 검사는 아무것도 안 잰다.
    expect(usedInSrc.size, 'src import 그래프가 비었다 — 스캐너가 고장 났다').toBeGreaterThan(50);
    expect(usedInTest.size, 'test import 그래프가 비었다 — 스캐너가 고장 났다').toBeGreaterThan(50);

    const orphans = srcFiles
      .map((p) => aliasOf(p))
      .filter((a) => !ENTRYPOINTS.has(a) && !usedInSrc.has(a) && usedInTest.has(a));

    expect(
      orphans,
      '테스트만 import 하는 프로덕션 모듈이다 — 소비처를 만들거나 지워라(knip 은 이 축을 못 본다)',
    ).toEqual([]);
  });
});

/* ============================================================
   불변식 ⑮ **소스에 원시 NUL 바이트가 없다**(2026-08-20 리뷰 — 정독 중 발견).

   `Map` 키 구분자로 `\x00` 을 쓰는 건 정당한 관용구다(ID 에 나올 수 없는 문자). 문제는 그걸
   **이스케이프가 아니라 원시 바이트**로 소스에 박은 것이었다 — 세 파일(`lib/visits.ts` ·
   `dbRowVerify.test.ts` · `dbUnavailable.test.ts`)이 그랬다.

   결과: `.gitattributes` 가 `*.ts text eol=lf` 라 선언해도 **git 의 바이너리 판정이 이긴다**
   (앞 8000 바이트에 NUL 이 있으면 binary). 그 파일들의 `git diff` 는 영원히
   `Bin 6024 -> 5979 bytes` 이고 — 즉 **프로덕션 소스 하나를 포함해 셋이 코드리뷰에서
   보이지 않는 채로 바뀌어 왔다.** 게이트 전량(tsc·eslint·vitest)은 녹색이었다:
   JS 문자열 리터럴 안의 원시 NUL 은 문법적으로 합법이라 어느 검사기도 볼 이유가 없다.

   런타임 동작은 이스케이프와 **문자 그대로 동일**하다 — 이건 순전히 *도구가 파일을 읽는 방식*
   의 문제이고, 그래서 정적 검사가 아니라 여기 있다.
============================================================ */
describe('불변식 ⑮ 소스에 원시 NUL 이 없다', () => {
  it('web/src·web/test 어느 파일도 NUL 바이트를 담지 않는다', () => {
    const roots = [SRC, join(process.cwd(), 'test')];
    const 오염 = roots
      .flatMap((r) => filesUnder((n) => /\.(tsx?|css|json)$/.test(n), r))
      .filter((f) => readFileSync(f).includes(0))
      .map((f) =>
        f
          .slice(process.cwd().length + 1)
          .split(sep)
          .join('/'),
      );
    expect(오염, '원시 NUL → git 이 바이너리로 보고 diff 를 숨긴다. `\x00` 이스케이프를 쓸 것').toEqual([]);
  });
});

/* ============================================================
   불변식 ⑯ **프로세스를 갈아타는 호출 앞에는 저장 확정이 온다**(D004 · 2026-08-21 데이터 축).

   이 앱에는 프로세스가 사라지는 경로가 셋이다: 창 닫기 · 트레이 종료 · 업데이트 설치.
   앞의 둘은 `StorageGuard` 가 지켰고 세 번째는 **그 관용구를 안 태웠다** — `app.restart()`
   가 `on_close_requested` 를 태우지 않기 때문이다. 400ms 디바운스에 걸린 편집이 그대로
   사라졌고, 확인 문구는 *"먼저 저장하세요"* 라고 말하는데 **이 앱에 수동 저장이 없다.**

   근본 원인은 관용구가 **경로마다 사본으로** 붙어 있던 것이다(데이터 축 근본원인 ③).
   `settleBeforeExit` 가 그 유일한 자리이고, 이 불변식은 **네 번째 경로**를 잡는다.

   ⚠ 검사 대상은 호출 순서가 아니라 **같은 파일이 그 확정을 안다는 것**이다. 순서까지 정적
   으로 보려면 AST 가 필요하고, 이 저장소의 다른 불변식들과 같은 이유로 그 값은 비용을
   넘지 않는다 — 여기서 막으려는 것은 «관용구의 존재를 모르고 새 경로를 여는 것» 이다.
============================================================ */
describe('불변식 ⑯ 종료 경로는 settleBeforeExit 를 태운다(D004)', () => {
  /** 프로세스가 돌아오지 않는 호출. `lib/tauri.ts` 는 이것들의 **정의**라 제외한다. */
  const 종료호출 = /\b(installUpdate|shellQuit)\s*\(/;

  it('그 호출을 하는 파일은 settleBeforeExit 를 함께 부른다', () => {
    const 위반 = tsFiles()
      .filter((f) => !f.endsWith(join('lib', 'tauri.ts')))
      .filter((f) => {
        const src = strip(readFileSync(f, 'utf8'));
        return 종료호출.test(src) && !src.includes('settleBeforeExit');
      })
      .map((f) => aliasOf(f));

    expect(위반, '프로세스를 갈아타기 전에 저장을 확정하지 않는다 — D004 가 정확히 그 형태였다').toEqual([]);
  });

  it('그 호출을 하는 파일이 존재한다 — 0이면 이 불변식이 아무것도 안 잰다', () => {
    const 소비처 = tsFiles().filter(
      (f) => !f.endsWith(join('lib', 'tauri.ts')) && 종료호출.test(strip(readFileSync(f, 'utf8'))),
    );
    expect(소비처.length).toBeGreaterThan(0);
  });
});

describe('불변식 ⑰ 마이크로카피가 부르는 탭 이름이 실재한다(U009)', () => {
  /* ⚠⚠ 이 불변식이 없던 동안 무슨 일이 있었나(2026-08-21 ux 축 U009).

     빈 상태·안내 문구가 사용자를 다른 탭으로 보내는 관용구는 **`<b>이름</b> 탭`** 하나다.
     그런데 그 이름은 손으로 적혀 있었고 `shell/tabs.ts` 의 로스터와 아무 연결이 없었다 —
     그래서 N-12(`journal`→`day`)·W4 의 탭 개편이 지나간 뒤에도 문구는 옛 이름에 머물렀고,
     실측하면 넷 중 **셋이 존재하지 않는 탭**이었다(`학습 기록`·`Anki 현황`·`배치`).
     사용자에게 이건 단순한 오타가 아니라 **따라갈 수 없는 처방**이다.

     §1-A/§1-B 의 형태 그대로다: 손으로 적은 목록이고 집행자가 없었다. 여기가 그 집행자다.

     ⚠ **은퇴한 탭 이름도 실패**로 본다 — `role:'retired'` 는 ⌘K 로만 닿는 화면이라
     "그 탭에서 하세요"가 성립하지 않는다(나브·세그먼트 어디에도 그 이름이 안 뜬다).
     ⚠ 주석은 검사하지 않는다(`strip`) — 근거에 옛 이름을 인용하는 것이 위반이 되면
       그건 이 파일이 네 번 못박은 역인센티브다.

     ## ⚠⚠ 2026-08-22(C033) — **자기 문법만 막고 같은 뜻의 다른 표기를 못 봤다**

     위 관용구가 잡는 것은 `<b>이름</b> 탭` 하나였다. 그런데 `find/GuideView.tsx` 는 같은 일을
     **전용 컴포넌트**(`<Tab>읽을거리</Tab>`)로 하고 있었고, 실측하면 **없는 탭 다섯을 여덟 번**
     가리켰다(`발견`·`읽을거리`·`탐구 수집`·`증시 동향`·`증시` — P10 W4 가 제거한 화면들이다).
     즉 이 불변식이 서 있는 동안에도 그 파일은 통째로 사각이었다. 코드 축 1회차가 이것을
     **근본 원인 R1**(집행자가 자기 문법을 막고 같은 뜻의 다른 표기를 못 본다)로 세웠고,
     여기가 그 첫 처방이다 — 문법을 하나 더 아는 것.

     처방의 나머지 절반은 그 파일 쪽이다: `Tab` 이 **이름 대신 로스터 키**를 받게 바꿨다.
     그래서 아래 검사는 두 축이다 — ① 옛 텍스트 형태가 **되돌아오지 않는가**(`<Tab>이름</Tab>`)
     ② 키 형태(`<Tab k="…" />`)가 **로스터에 실재하는 키인가**.
     ⚠ ②는 `role:'view'` 를 허용한다(①·`<b>…</b> 탭` 과 다르다): 팔레트가 그 셋도 `to` 로
     싣고(Q-22 · `shell/palette.ts`) 불변식 ⑱이 로스터 등재를 집행하므로 «그 화면으로 가라»가
     ⌘K 로 실제로 성립한다. 은퇴 어휘가 아니라 **호스트 안의 화면**이라는 것이 차이다. */
  const 살아있는이름 = new Set(
    TABS.filter((t) => t.role !== 'view').flatMap((t) => [t.label, t.segLabel].filter((x): x is string => !!x)),
  );
  const 관용구 = /<b>([^<>{}]{1,14})<\/b>[^\S\n]{0,3}탭|<Tab>([^<>{}]{1,14})<\/Tab>/g;
  const 키관용구 = /<Tab\s+k=["']([\w-]+)["']/g;
  const 로스터키 = new Set(TABS.map((t) => t.key));

  const 소스 = tsxFiles().map((f) => ({ 파일: aliasOf(f), code: strip(readFileSync(f, 'utf8')) }));

  const 언급 = 소스.flatMap(({ 파일, code }) =>
    [...code.matchAll(관용구)].map((m) => ({ 파일, 이름: (m[1] ?? m[2]!).trim() })),
  );
  const 키언급 = 소스.flatMap(({ 파일, code }) => [...code.matchAll(키관용구)].map((m) => ({ 파일, 키: m[1]! })));

  it('`<b>…</b> 탭` · `<Tab>…</Tab>` 이 가리키는 이름이 전부 살아 있는 탭이다', () => {
    const 위반 = 언급.filter((x) => !살아있는이름.has(x.이름)).map((x) => `${x.파일}: “${x.이름} 탭”`);
    expect(위반, `없는(또는 은퇴한) 탭으로 보내는 문구 — 이름 정본은 shell/tabs.ts 다`).toEqual([]);
  });

  it('`<Tab k="…" />` 의 키가 전부 로스터에 있다 — 개명·제거가 조용히 지나가지 않게', () => {
    const 위반 = 키언급.filter((x) => !로스터키.has(x.키)).map((x) => `${x.파일}: <Tab k="${x.키}" />`);
    expect(위반, `로스터에 없는 키 — 정본은 shell/tabs.ts 의 TABS 다`).toEqual([]);
  });

  it('두 관용구 중 적어도 하나를 쓰는 문구가 존재한다 — 0이면 이 불변식이 아무것도 안 잰다', () => {
    expect(언급.length + 키언급.length).toBeGreaterThan(0);
  });

  /* ⚠ 키 형태가 **0이 되면** 이 불변식의 절반이 조용히 잠든다 — 그건 `GuideView` 가 옛
     텍스트 형태로 되돌아갔다는 뜻일 수 있다(C033 이 고친 바로 그 상태). 분모를 함께 센다. */
  it('키 형태가 실제로 쓰이고 있다 — C033 의 처방이 살아 있는지의 분모', () => {
    expect(키언급.length, '`<Tab k="…" />` 가 0이다 — 이름 문자열로 되돌아갔는지 확인하라').toBeGreaterThan(0);
  });
});

/* ============================================================
   불변식 ⑱ — **`?view=` 로 가는 화면은 전부 로스터에 있다**(I025 · 2026-08-22 발상 축)

   ## 무엇이 틀렸었나

   이 저장소의 은퇴·통합 관용구는 화면을 지우는 대신 **호스트의 `?view=` 로 내린다**(W9 이 탭
   셋을 그렇게 접었다). 그런데 그 화면이 로스터(`TABS`)에 `role:'view'` 로 **등재되지 않으면**
   셋을 한꺼번에 잃는다:

     ① **이름** — `routeLabelOfLocation` 이 못 찾아 아나운서·문서 제목이 **호스트 이름**을 읽는다
        (H-12 가 고친 결함의 재발 경로).
     ② **⌘K** — 팔레트는 로스터를 순회하므로 그 화면으로 가는 문이 **하나도 없다.**
     ③ **관측** — `visitKeyOfLocation`(I034)이 호스트로 접어 집계한다 → 그 화면은 자기 몫의 수를
        영원히 못 갖고, 「관측이 쌓이면 판정한다」가 원리적으로 안 온다.

   실측(2026-08-22): 로스터에 있던 것은 `forecast`·`mastery` **둘뿐**이었고, `degree` 의 네 뷰와
   `find?view=guide` 는 **밖**이었다. 즉 옳은 문법이 12개 중 2개에만 적용돼 있었다.

   ## 무엇을 검사하나

   소스에서 **실제로 그 주소로 보내는 곳**(`?view=` 리터럴 · `setParams({view})`)을 긁어
   로스터가 그 값을 아는지 본다. 목록을 손으로 적지 않는 것이 요점이다 — 적으면 이 파일이
   네 번 못박은 그 표류를 스스로 저지른다.

   ⚠ **`role:'object'` 안의 뷰는 면제다**(`/subject/:id?view=sheet`). `to` 는 정적 주소인데 그
     화면의 주소는 매개변수를 가져 하나가 아니다 — 같은 표에 넣으면 두 어휘가 섞인다.
============================================================ */
describe('불변식 ⑱ `?view=` 화면이 로스터에 있다', () => {
  /** 로스터가 아는 `?view=` 값(호스트별). */
  const 로스터뷰 = new Set(
    TABS.filter((t) => t.role === 'view' && t.to?.includes('?view=')).map((t) => {
      const [host, value] = t.to!.split('?view=');
      return `${host}|${value}`;
    }),
  );

  /** 매개변수를 가진 명사 안의 뷰 — 위 ⚠ 의 면제. 사유 없는 면제는 방치다. */
  const 면제 = new Map<string, string>([
    ['sheet', '`/subject/:id` 안의 뷰 — 주소가 매개변수를 가져 정적 `to` 가 없다'],
  ]);

  it('소스가 보내는 `?view=` 값이 전부 로스터에 있다(또는 사유 있는 면제다)', () => {
    const 위반: string[] = [];
    for (const f of tsxFiles()) {
      const code = strip(readFileSync(f, 'utf8'));
      /* `to="/degree?view=close"` · `` `/find?view=${X}` `` 두 형태를 본다. 상수 보간은 값을
         모르므로 **호스트만** 대조한다 — 그 호스트에 등재된 뷰가 하나도 없으면 위반이다. */
      for (const m of code.matchAll(/['"`]\/([a-z-]+)\?view=([^'"`$}]+)['"`]/g)) {
        const key = `/${m[1]}|${m[2]}`;
        if (로스터뷰.has(key) || 면제.has(m[2]!)) continue;
        위반.push(`${aliasOf(f)}: /${m[1]}?view=${m[2]}`);
      }
    }
    expect(위반, "이 주소로 가면 이름·⌘K·방문 집계를 함께 잃는다 — 로스터에 `role:'view'` 로 등재하라").toEqual([]);
  });

  it('면제 표가 사문화하지 않았다 — 쓰이지 않는 사유가 남아 있으면 실패', () => {
    /* ⚠ `.ts` 도 본다 — 뷰 값 상수(`SHEET_VIEW`)의 집이 `shell/tabs.ts` 라, `.tsx` 만 훑으면
       면제가 «쓰이지 않는다»로 보여 이 케이스가 자기 자신을 오탐한다. */
    const 쓰임 = new Set<string>();
    for (const f of [...tsxFiles(), ...tsFiles()]) {
      const code = strip(readFileSync(f, 'utf8'));
      for (const m of code.matchAll(/view=([a-z]+)/g)) 쓰임.add(m[1]!);
      for (const m of code.matchAll(/_VIEW = '([a-z]+)'/g)) 쓰임.add(m[1]!);
    }
    expect([...면제.keys()].filter((k) => !쓰임.has(k))).toEqual([]);
  });

  it('로스터에 실제로 뷰가 있다 — 0이면 이 불변식이 아무것도 안 잰다', () => {
    expect(로스터뷰.size).toBeGreaterThan(4);
  });

  /* ── ⑱의 **짝** — 로스터에 있는 뷰가 검증망에도 있는가 (U066 · 2026-08-31) ──────────
     ⑱은 «소스가 보내는 주소가 로스터에 있나»를 재고, 이건 그 반대 방향이다: **로스터에 선
     뷰가 두 커버리지 로스터 중 어디에도 없으면 아무도 그 화면을 안 본다.**
     실측으로 `req`(졸업요건 정리) 하나가 정확히 그 상태였다 — `A11Y_EXTRA` 에도
     `MERGED_VIEWS` 에도 없었다. ⚠ 처방이 「그 항목을 추가한다」가 아니라 **집행자**인 이유는
     이 회차가 세 번 확인한 형태이기 때문이다: 손으로 적은 로스터는 화면이 은퇴하거나 태어날
     때마다 표류하고, 그 표류는 **초록으로** 지나간다. */
  it('로스터의 모든 뷰가 시각 또는 a11y 커버리지 로스터에 있다', () => {
    const 커버 = new Set<string>();
    for (const f of ['e2e/_fixtures.ts', 'e2e/visual.spec.ts']) {
      const code = strip(readFileSync(join(SRC, '..', f), 'utf8'));
      for (const m of code.matchAll(/path:\s*['"`]\/([a-z-]+)\?view=([a-z]+)/g)) 커버.add(`/${m[1]}|${m[2]}`);
    }
    const 밖 = [...로스터뷰].filter((k) => !커버.has(k)).sort();
    expect(
      밖,
      '로스터에 선 뷰인데 두 커버리지 로스터 어디에도 없다 — `e2e/_fixtures.ts` 의 `A11Y_EXTRA` ' +
        '또는 `e2e/visual.spec.ts` 의 `MERGED_VIEWS` 에 넣어라(안 넣으면 아무도 그 화면을 안 본다).',
    ).toEqual([]);
  });
});

/* ============================================================
   불변식 ⑱-B — **은퇴한 어휘를 기계가 안다** (U078 · 2026-08-31 ux 축)

   ## 왜 생겼나 — 이 회차의 근본 원인 R1 이 여기다

   2026-08-29 은퇴 회차는 코드·타입·토큰·로스터를 **정확히** 지웠다. `knip` 0 issues ·
   `verify` exit 0 이 그 사실을 정확히 반영한다. 그런데 그 데이터를 *말하는* 층은 그대로 남았다:
   **화면 문구**(U044·U045·U057·U060) · **검증망 로스터**(U049·U063) · **주석**(U055).
   공통 형태는 «지운 것»과 «가리키던 것»의 거리다 — 지우는 사람은 **import 그래프**를 따라가고,
   문구·로스터·주석은 그 그래프에 **없다.**

   실제 피해가 «못 찾는다» 가 아니라 «따를 수 있는 거짓» 이었다: 「볼트를 **재빌드하면**
   연결됩니다」 · 「**숙달도 지도 탭에서** 먼저 불러와야 작동」 · 「`지식엔진.py build`」.
   사용자는 그대로 따라가고, 실패하고, 자기 설정을 의심하는 루프가 닫히지 않는다.

   ## 왜 여기인가

   ⛔ Vale 같은 산문 린터를 들이지 않는다 — 대상이 `.tsx` 라 문장이 JSX 사이에 조각나 있고,
   그 도구는 새 설정 파일·새 어휘 원장·새 CI 단계를 요구한다(도입 비용이 결함보다 크다).
   여기는 이미 `sources()`(주석 제거본)를 갖고 있고 게이트 안이며, 불변식 ⑰(살아 있는 탭 이름)이
   **같은 축의 옆칸**이다 — 그쪽은 태그 문법을 보고 이쪽은 **평문**을 본다(R2 가 지목한 사각).

   ⚠ **면제는 사유 + 날짜를 요구한다.** 은퇴 어휘가 정당하게 남는 자리가 실제로 있다(묘비명·
   과거 관측 기록). 사유 없는 면제는 방치이고, 그러면 이 표가 2주 만에 무력해진다.
============================================================ */
describe('불변식 ⑱-B 은퇴 어휘가 사용자 문구에 안 남는다', () => {
  /** 은퇴한 이름 → 언제·왜. **여기 적는 것이 곧 「그 말을 화면에 쓰지 마라」는 선언이다.** */
  const 은퇴어휘: [string, string][] = [
    ['숙달도 지도', '2026-08-29 · 생산자(지식엔진) 삭제로 화면 은퇴'],
    ['내 길 지도', '2026-08-29 · 부모 goals 계약 삭제로 화면 은퇴'],
    ['지식엔진', '2026-08-29 · 부모 `_도구/지식엔진.py` 삭제(치라고 시킬 수 없다)'],
    ['학습신호', '2026-08-29 · 부모 `_도구/학습신호.py` 삭제'],
    ['SERVE.JS', '4단계 · Node 백엔드 삭제(저장소 전체 0건)'],
  ];

  /* 정당한 자리 — **사유와 날짜가 있어야 한다.** */
  const 면제 = new Map<string, string>([
    ['docs', '문서·주석은 대상이 아니다 — 이 저장소는 옛 이름을 인용해 *왜 바뀌었는지*를 남긴다(2026-08-31)'],
  ]);

  it('사용자에게 보이는 문구에 은퇴한 이름이 없다', () => {
    const 위반: string[] = [];
    for (const { path, code } of sources()) {
      if (!/\.tsx$/.test(path)) continue;
      /* ⚠ **JSX 텍스트 노드만 본다.** 식별자·클래스·주석까지 보면 `features/ledger/mastery` 같은
         경로나 `masteryColor` 같은 이름이 걸려 검사가 규약보다 넓어진다(주석은 `sources()` 가
         이미 걷는다). 태그 사이의 글자와 문자열 리터럴이 사용자가 읽는 것이다. */
      const 조각 = [
        ...[...code.matchAll(/>([^<>{}]{2,300})</g)].map((m) => m[1]!),
        ...[...code.matchAll(/['"`]([^'"`\n]{2,300})['"`]/g)].map((m) => m[1]!),
      ];
      /* ⚠⚠ **설명하는 문장은 통과시킨다.** 화면이 사용자에게 «그건 은퇴했다» 고 **말해 주는 것**은
         이 검사가 원하는 바로 그 상태다(안내 탭의 은퇴 공지가 그렇다). 잡아야 하는 것은 은퇴한
         것을 **처방하거나 가리키는** 문장이다. CSS 고아 주석 검사가 묘비명을 통과시키는 것과
         같은 규율이고, 그 구분이 없으면 검사가 규약과 싸운다 — 실제로 이 검사를 세우자마자
         `GuideView` 의 은퇴 공지 한 줄이 걸렸다. */
      const 설명함 = /은퇴|삭제됐|사라졌|없습니다|없어요|더는|이제 없/;
      for (const [말, 사유] of 은퇴어휘) {
        const 걸린 = 조각.filter((t) => t.includes(말));
        if (!걸린.length || 걸린.every((t) => 설명함.test(t))) continue;
        위반.push(`${path.split(/[\\/]/).slice(-2).join('/')}: “${말}” — ${사유}`);
      }
    }
    expect(
      [...new Set(위반)].sort(),
      '은퇴한 이름이 사용자 문구에 남아 있다 — 그 말을 따라가면 없는 화면·없는 명령에 닿는다(U078)',
    ).toEqual([]);
  });

  it('면제 표가 사문화하지 않았다 — 사유 없는 면제는 방치다', () => {
    for (const [, 사유] of 면제) expect(사유, '면제엔 사유와 날짜가 있어야 한다').toMatch(/20\d\d-\d\d-\d\d/);
  });

  it('표가 비어 있지 않다 — 0개면 이 불변식이 아무것도 안 잰다', () => {
    expect(은퇴어휘.length).toBeGreaterThan(3);
  });
});

/* ============================================================
   불변식 ⑲ — **UTC 표현으로 날짜를 자르지 않는다**(C043 · 2026-08-22 코드 축 1회차)

   ## 무엇이 틀렸었나

   `lib/since.ts` 의 저널 카운터 한 줄만 `new Date(x.at).toISOString().slice(0, 10)` 이었다.
   그런데 비교 대상인 `seenDs` 는 `todayISO()` = **로컬** 날짜다. KST 00:00–09:00 에 쓴 3문장
   요약은 전날 날짜가 붙어 `ds > seenDs` 를 통과하지 못했고, `seenDs` 는 이미 전진했으므로
   **다음 날에도 영영** 레일 배지에 안 떴다.

   `utils.ts` 의 `iso()` 가 정확히 이 함정 때문에 존재하고 그 주석이 *"toISOString()은 UTC라
   KST 등에서 하루가 밀린다"* 라고 적어 뒀는데, 규약이 주석에만 있어서 한 줄이 새어 나갔다.

   ## ⚠ 이 불변식과 시간대 매트릭스는 짝이다 — 하나만으로는 부족하다

   · 여기(문법) — `toISOString()` 에서 **날짜만 꺼내는 두 관용구**를 소스 전량에서 막는다.
     지금 위반 0이고, 0을 **잠그는** 것이 목적이다(C058 과 같은 형태 — 지금 지켜지는 규율을
     아무도 안 지키고 있는 상태를 끝낸다).
   · 짝(표본) — `vitest.tz.config.ts` 의 `tz-east`/`tz-west` 가 **행동**을 잰다. 실측:
     결함이 있는 코드로 `TZ=UTC` 는 8/8 통과(판별력 0)였고 매트릭스는 양방향 모두 실패했다.

   ⚠ **전체 `toISOString()` 을 막지 않는다.** 타임스탬프를 통째로 저장하는 것은 정당하고
   실제로 그 용법이 넷 있다(`methodology.ts` 둘 · `shell/actions.ts` 둘 — 백업·내보내기 시각).
   막는 것은 **UTC 문자열에서 날짜 부분을 꺼내 로컬 날짜와 섞는 것** 하나다.
============================================================ */
describe('불변식 ⑲ UTC 표현에서 날짜를 잘라 쓰지 않는다(C043)', () => {
  const SRC19 = join(process.cwd(), 'src') + '/';
  /** `.toISOString()` 뒤에 곧바로 날짜만 꺼내는 두 관용구. */
  const 관용구19 = /toISOString\(\)\s*\.\s*(?:slice\(\s*0\s*,\s*10\s*\)|split\(\s*['"]T['"]\s*\)\s*\[\s*0\s*\])/;

  it('`toISOString().slice(0,10)` · `.split("T")[0]` 이 src 에 없다 — 로컬 날짜는 utils.iso() 다', () => {
    const 위반 = [...tsFiles(SRC19), ...tsxFiles()]
      .filter((p) => 관용구19.test(strip(readFileSync(p, 'utf8'))))
      .map(aliasOf);
    expect(위반, 'UTC 날짜와 로컬 날짜(`todayISO`)를 섞으면 시간대에 따라 하루가 밀린다 — `iso(d)` 를 써라').toEqual(
      [],
    );
  });

  it('`utils.iso()` 가 실재한다 — 대안이 없으면 이 금지는 처방이 아니라 방해다', () => {
    const utils = readFileSync(join(SRC19, 'lib', 'utils.ts'), 'utf8');
    expect(utils, '금지의 짝인 함수가 사라졌다').toMatch(/export function iso\(/);
  });
});

/* ============================================================
   불변식 ⑳ — **`*At` 은 시점이다**(C039 · 2026-08-22 코드 축 1회차)

   ## 무엇이 틀렸었나

   `*At` 접미사가 **네 뜻**으로 쓰이고 있었다. 선언 28건 전수: epoch ms **24** · `HH:MM` 1
   (`schema.doneAt`) · `YYYY-MM-DD` 1(`uiState.seenAt`) · 0-based 인덱스 2. 반면 `*Ds` 는
   31어휘·600여 회가 **전량** `YYYY-MM-DD` 로 지켜진다 — 즉 이 저장소에 규약은 있었고 한쪽만
   샜다. 더 나쁜 것은 `uiState.ts` 가 스스로 *"⚠ 날짜만 담는다(시각 아님)"* 라고 적었다는
   점이다: **작성자가 이름이 거짓임을 알고 개명 대신 주석을 달았다.**

   대가는 다음 소비처가 치른다. `since.ts` 가 `ds > seenDs` 로 **문자열 비교**를 하므로,
   두 번째 소비처를 다는 사람이 지배적 관용구(`*At` = epoch ms)를 적용하면
   `Date.now()` → 배지가 전 이력을 영구히 「새 것」으로 세고, `toISOString()` → 오늘 것이
   통째로 빠진다. 둘 다 zod(`record(string, string)`)를 통과하고 게이트가 녹색이다.
   `doneAt` 은 더 예약된 형태였다 — 스키마 주석이 *"표본이 쌓이면 그린다"* 며 미래의 소비처를
   명시적으로 예약했는데, 그 사람이 `new Date(entry.doneAt)` 를 쓰면 `'21:40'` 에서
   **`Invalid Date`** 가 나온다.

   ## 무엇을 검사하나

   zod 스키마의 `*At` 필드가 **`z.number()`(epoch ms)** 이거나 **사유 있는 면제**인지 본다.
   면제는 «전체 ISO 타임스탬프» 하나뿐이고, 그것도 여기 사유를 적어야 통과한다.
   ⚠ 이름을 세지 않는다 — 파일을 파싱해서 판다(손 목록은 이 파일이 다섯 번 못박은 그 표류다).
============================================================ */
describe('불변식 ⑳ zod 스키마의 `*At` 은 시점(epoch ms)이다(C039)', () => {
  const SRC20 = join(process.cwd(), 'src', 'lib') + '/';

  /** 사유 있는 면제 — 전체 ISO 타임스탬프를 문자열로 담는 자리. 사유 없는 면제는 방치다. */
  const 면제20 = new Map<string, string>([
    ['_lastBackupAt', '전체 ISO 타임스탬프(`new Date().toISOString()`) — 시점이 맞고 경과일 계산에만 쓴다'],
  ]);

  /** `이름: z.…` 선언에서 `*At` 인 것만. 값 표현식은 그 줄 끝까지. */
  const 선언 = (): { 파일: string; 이름: string; 값: string }[] => {
    const out: { 파일: string; 이름: string; 값: string }[] = [];
    for (const p of [join(SRC20, 'schema.ts'), join(SRC20, 'uiState.ts')]) {
      for (const line of strip(readFileSync(p, 'utf8')).split('\n')) {
        const m = /^\s*(_?[a-z][A-Za-z0-9]*At)\??:\s*(z\..*)$/.exec(line);
        if (m) out.push({ 파일: aliasOf(p), 이름: m[1]!, 값: m[2]! });
      }
    }
    return out;
  };

  it('`*At` 필드가 z.number() 이거나 사유 있는 면제다', () => {
    const 위반 = 선언()
      .filter((d) => !면제20.has(d.이름) && !/z\.(optional\(z\.)?number\b/.test(d.값))
      .map((d) => `${d.파일}: ${d.이름} = ${d.값.trim()}`);
    expect(위반, '`*At` 은 이 저장소에서 epoch ms 다 — 날짜는 `*Ds`, 시각은 `*Hm` 을 써라').toEqual([]);
  });

  it('면제 표가 사문화하지 않았다 — 사라진 필드의 사유가 남아 있으면 실패', () => {
    const 이름들 = new Set(선언().map((d) => d.이름));
    expect([...면제20.keys()].filter((k) => !이름들.has(k))).toEqual([]);
  });

  it('실제로 `*At` 선언을 찾고 있다 — 0이면 이 불변식이 아무것도 안 잰다', () => {
    expect(선언().length).toBeGreaterThan(0);
  });
});

/* ============================================================
   불변식 ㉑ — **정체성 해시는 `lib/utils` 한 곳이 소유한다**(C046 · 2026-08-22 코드 축 1회차)

   ## 무엇이 틀렸었나

   `utils.ts` 의 `hash32` 머리주석이 규약을 **선언**한다: *"정체성에서 값을 파생할 때는 이걸
   쓴다 … 새 해시를 또 만들면 파생마다 다른 근거를 갖게 된다."* 그런데 실측하면
   `Math.imul` 을 쓰는 자리가 **넷 · 알고리즘이 둘**이었다:

   · `semesterFingerprint.hash01` — `hash32` 의 **비트 사본**(상수 `2166136261`·`16777619` 가
     `0x811c9dc5`·`0x01000193` 이다).
   · `mistakes.hashStr` ↔ `retrieval.hashStr` — 서로의 사본(×31). 결합을 지던 것은
     *"`retrieval.ts` 와 같은 식"* 이라는 **산문 한 줄**이었다.

   집행자는 0이었다(`rg "Math.imul|hash32" test/invariants.test.ts eslint.config.js` → 0건).
   즉 규약은 주석에만 있었고 **이미 세 번 어겨져 있었다.**

   ## 왜 Minor 였고, 그럼에도 왜 잠그나

   넷 다 결정론적이고 **현재 출력이 갈린 곳은 없다** — 청구되는 것은 다음 변경의 비용이다.
   `hash32` 는 `chapterFuzz`(복습 due ±1일)와 `colorForId` 를 동시에 먹이고, 그 주석이
   *"노브만 바꾸면 다음 부팅에 전부 갱신된다"* 를 근거로 승수 교체를 **장려한다**. 그때
   사본만 옛 알고리즘에 남으면 두 화면이 같은 id 에 대해 다른 이야기를 시작하고, 어느 검사도
   울지 않는다.

   ## 축이 둘이라는 것이 규약의 일부다

   `hash32`(FNV — 분포를 산다)와 `rotateSeed`(×31 — 결정성만 산다)는 **다른 축**이라 합치지
   않는다. 합치면 색 분포 튜닝이 「오늘의 창」 회전을 함께 흔든다. 둘 다 집은 `lib/utils` 다.
============================================================ */
describe('불변식 ㉑ Math.imul(해시)이 lib/utils 밖에 없다(C046)', () => {
  const SRC21 = join(process.cwd(), 'src') + '/';
  const OWNER21 = join(SRC21, 'lib', 'utils.ts');

  it('`Math.imul` 을 쓰는 파일이 `lib/utils.ts` 하나다', () => {
    const 위반 = [...tsFiles(SRC21), ...tsxFiles()]
      .filter((p) => p !== OWNER21 && /Math\.imul/.test(strip(readFileSync(p, 'utf8'))))
      .map(aliasOf);
    expect(
      위반,
      '새 해시를 또 만들면 파생마다 다른 근거를 갖는다 — `hash32`(정체성) 또는 `rotateSeed`(회전)를 써라',
    ).toEqual([]);
  });

  it('두 축이 실재한다 — 이름만 남고 구현이 사라지면 이 금지가 처방이 아니라 방해다', () => {
    const utils = readFileSync(OWNER21, 'utf8');
    expect(utils, '정체성 축(FNV)이 사라졌다').toMatch(/export function hash32\(/);
    expect(utils, '회전 축(×31)이 사라졌다').toMatch(/export function rotateSeed\(/);
  });

  it('⚠ 두 축을 합치지 않았다 — 상수가 갈려 있는 것이 의도다', () => {
    const utils = strip(readFileSync(OWNER21, 'utf8'));
    expect(utils, 'FNV prime 이 사라졌다 — 정체성 축이 회전 축으로 접혔는가').toMatch(/0x01000193/);
    expect(utils, '회전 승수가 사라졌다 — 회전 축이 정체성 축으로 접혔는가').toMatch(/Math\.imul\(h, 31\)/);
  });
});

/* ============================================================
   불변식 ㉒ — **⌘K 내용 검색의 목적지가 로스터와 이어져 있다**(C048 · 2026-08-22 코드 축 1회차)

   ## 무엇이 틀렸었나

   `lib/contentSearch.ts` 안에서 목적지가 **다섯 자리 · 네 관용구**로 조립됐다(지역 화살표 헬퍼 ·
   헬퍼+템플릿 · 생 리터럴 · `+` 연결). 그중 셋(`/day`·`/review`·`/mistakes`)은 `shell/tabs.ts`
   와 **연결이 0**이었다. 이 저장소는 실제로 탭 키를 갈아 왔다(`journal`→`day` · `graph` 은퇴 ·
   `guide` 삭제 후 부활) — 개명이 오면 그 셋은 **컴파일도 린트도 통과한 채** 남고,
   `App.tsx` 의 `<Route path="*" element={<Navigate to="/today"/>}/>` 가 ⌘K 히트를 전부 오늘
   화면으로 착지시킨다. 사용자에겐 *"⌘K 가 엉뚱한 데로 간다"* 이고, 불변식 ⑱은 `?view=` 만
   보므로 원리적으로 사각이다.

   ## 처방이 왜 두 조각인가

   리포트의 처방은 *"탭 경로를 로스터에서 읽는다"* 였는데 **레이어가 그것을 막는다**:
   `lib → lib` 만 허용이라(boundaries) `lib/contentSearch` 가 `shell/tabs` 를 부를 수 없다.
   그 경계는 옳다(순수 규칙이 셸을 끌면 폰 번들·테스트가 함께 무거워진다). 그래서:
   ① `lib/contentAnchors.ts` — 목적지가 **한 관용구 · 한 자리**(고칠 곳이 하나다).
   ② 여기 — 그 표의 경로를 **로스터와 대조**한다. 테스트는 레이어 밖이라 둘 다 볼 수 있다.
============================================================ */
describe('불변식 ㉒ 내용 검색 목적지가 로스터의 경로와 같다(C048)', () => {
  const 경로of = (t: (typeof TABS)[number]): string => t.route ?? t.to ?? '/' + t.key;

  it('`ANCHOR_TAB_ROUTES` 의 키가 전부 로스터에 있다', () => {
    const 로스터키 = new Set(TABS.map((t) => t.key));
    expect(Object.keys(ANCHOR_TAB_ROUTES).filter((k) => !로스터키.has(k))).toEqual([]);
  });

  it('⚠⚠ 그 경로가 로스터가 말하는 경로와 **글자 그대로** 같다 — 개명이 여기서 빨간불이 된다', () => {
    const 불일치 = Object.entries(ANCHOR_TAB_ROUTES)
      .map(([key, route]) => {
        const t = TABS.find((x) => x.key === key);
        return t && 경로of(t) !== route ? `${key}: 앵커 ${route} ≠ 로스터 ${경로of(t)}` : '';
      })
      .filter(Boolean);
    expect(불일치, '⌘K 히트가 `*` 라우트를 타 오늘 화면으로 착지한다 — lib/contentAnchors 를 맞춰라').toEqual([]);
  });

  it('⚠ `contentSearch` 가 목적지를 직접 짓지 않는다 — 관용구가 다시 갈리는 것을 막는다', () => {
    const code = strip(readFileSync(join(process.cwd(), 'src', 'lib', 'contentSearch.ts'), 'utf8'));
    const 생경로 = [...code.matchAll(/to:\s*[`'"]\//g)].length;
    expect(생경로, '`to:` 에 생 경로 리터럴이 돌아왔다 — CONTENT_ANCHORS 를 써라').toBe(0);
  });

  it('표가 실제로 쓰이고 있다 — 0이면 이 불변식이 아무것도 안 잰다', () => {
    expect(Object.keys(ANCHOR_TAB_ROUTES).length).toBeGreaterThan(2);
    expect(Object.keys(CONTENT_ANCHORS).length).toBeGreaterThan(3);
  });
});

/* ============================================================
   불변식 ㉓ — **뷰 콜백 안 도메인 로직 래칫**(C057 · 2026-08-22 코드 축 1회차)

   ## 왜 이 축인가 — 근본 원인 R3 의 집행자

   코드 축 1회차가 세운 근본 원인 셋 중 **R3** 은 *"새 표면은 규칙을 컴포넌트 안에 두고
   테스트를 안 붙인다"* 였다. 표본이 `C036` 이다: 학사 눈금 인입 규칙 11줄이 두 화면에
   **글자 그대로** 복제돼 있었고 그 규칙에 닿는 테스트가 **0건**이었다 — 컴포넌트를 렌더하지
   않으면 도달 방법 자체가 없었기 때문이다. 그리고 게이트는 전량 녹색이었다(테스트가 0이므로).

   `mutate((st) => …)` 콜백이 길어지는 것이 그 형태의 관측 가능한 신호다: 상태를 바꾸는 **규칙**이
   렌더 트리 안에 살고 있다는 뜻이고, 거기서는 유닛 테스트가 원리적으로 못 닿는다.

   ## 무엇을 하나 — 그리고 무엇을 안 하나

   "더 나빠지지 않는다"만 보장한다(이 저장소의 래칫 규율 그대로 · `eslint.config.js` 의
   `max-lines`·`cognitive-complexity` 와 같은 계약). ⚠ **임계는 현재 최댓값이고 내려가기만 한다.**
   ⚠ 짧은 콜백을 금지하지 않는다 — `st.items.push(x)` 한 줄은 규칙이 아니라 배선이다.
   ⚠ 6줄이라는 «좋음»의 기준을 강제하지 않는다(실측 10건이 그 위에 있고, 그걸 지금 다 옮기는 것은
   이 회차의 범위가 아니다). 대신 그 수를 **함께 세어** 추세가 보이게 한다.

   실측(2026-08-22): `.tsx` 안 `mutate((` **120곳** · 6줄 초과 **10** · 최댓값 **16**
   (`degree/CalendarIntake.tsx` — C036 이 그 안의 11줄을 `lib/semester.applyMarks` 로 내린 뒤의 값).
============================================================ */
describe('불변식 ㉓ 뷰 콜백 안 도메인 로직이 더 자라지 않는다(C057)', () => {
  /**
   * ⚠ 현재 최댓값(주석·빈 줄 제외). **내려가기만 한다** — 올리려면 왜 규칙이 렌더 안에 있어야
   * 하는지 여기 적어라.
   *
   * 이력(전부 `degree/CalendarIntake.tsx` 의 같은 콜백): **22** → `C036` 이 학사 눈금 규칙을
   * `lib/semester.applyMarks` 로 → **17** → `C068` 이 강의 블록 중복 판정을
   * `lib/icsParse.applyLectureBlocks` 로 → **14**. 짝인 `SyllabusIntake` 도 15 → 10.
   *
   * ⚠⚠ 세는 법이 두 번 틀렸다가 고쳐졌다. ① 임계를 **포맷 전** 실측(16)으로 잡았다가
   * `format` 이 한 줄 호출을 5줄로 접어 **이 래칫이 스스로 빨간불**이 됐다. ② 그 뒤에도
   * **주석을 세고 있어서**, 규칙을 `lib` 으로 내리고 «왜 내렸는지» 적으면 그 문단이 줄 수를
   * 도로 올렸다 — 근거를 적는 쪽이 벌을 받는 형태다. 지금은 `strip` 뒤에 센다(위 헬퍼 주석).
   * ⚠ 아래 「임계가 최댓값에 붙어 있다」 케이스가 두 번 다 이것을 잡았다 — 그 케이스를 지우지 마라.
   */
  const MUTATE_MAX = 14;

  /**
   * `.tsx` 의 `mutate((` 콜백 본문 줄 수 — 괄호 균형으로 끝을 찾는다(중첩 함수 포함).
   *
   * ⚠⚠ **주석을 걷고 센다**(`strip`). 안 걷으면 «규칙을 왜 `lib` 으로 내렸는지» 적는 문단이
   * 그 자리의 줄 수를 올려 **근거를 적는 쪽이 벌을 받는다** — 이 파일이 네 번 못박은 역인센티브다
   * (불변식 ⑰이 같은 이유로 `strip` 한다). 실제로 C068 에서 물렸다: 규칙 8줄을 통째로 `lib` 으로
   * 내렸는데 그 자리에 남긴 2줄짜리 근거 주석 때문에 래칫이 20 → 17 밖에 안 내려갔다.
   * ⚠ 빈 줄도 안 센다 — 포매터가 만드는 것이고 «규칙의 크기»가 아니다.
   */
  const 콜백들 = (): { 파일: string; 줄수: number; 줄: number }[] => {
    const out: { 파일: string; 줄수: number; 줄: number }[] = [];
    for (const f of tsxFiles()) {
      const code = readFileSync(f, 'utf8');
      for (const m of code.matchAll(/\bmutate\(\(/g)) {
        let depth = 0;
        let j = m.index;
        for (; j < code.length; j++) {
          if (code[j] === '(') depth += 1;
          else if (code[j] === ')' && --depth === 0) break;
        }
        out.push({
          파일: aliasOf(f),
          /* 주석·빈 줄을 걷은 뒤의 «실제 규칙 줄 수». `strip` 은 파일 단위 헬퍼라 조각에 그대로 쓴다. */
          줄수: strip(code.slice(m.index, j))
            .split('\n')
            .filter((x) => x.trim()).length,
          줄: code.slice(0, m.index).split('\n').length,
        });
      }
    }
    return out;
  };

  it(`가장 긴 \`mutate\` 콜백이 ${MUTATE_MAX}줄 이하다 — 규칙은 lib 로 내려야 테스트가 닿는다`, () => {
    const 넘는것 = 콜백들()
      .filter((c) => c.줄수 > MUTATE_MAX)
      .map((c) => `${c.파일}:${c.줄} (${c.줄수}줄)`);
    expect(넘는것, 'R3 — 렌더 안의 규칙은 유닛 테스트가 원리적으로 못 닿는다(C036 이 그 표본이다)').toEqual([]);
  });

  it('⚠ 임계가 현재 최댓값에 붙어 있다 — 여유가 크면 래칫이 아무것도 안 지킨다', () => {
    const 최댓값 = Math.max(...콜백들().map((c) => c.줄수));
    expect(최댓값, `임계 ${MUTATE_MAX} 인데 실측 ${최댓값} — 규약대로 임계를 내려라`).toBeGreaterThan(MUTATE_MAX - 4);
  });

  it('실제로 콜백을 찾고 있다 — 0이면 이 래칫이 아무것도 안 잰다', () => {
    expect(콜백들().length).toBeGreaterThan(50);
  });
});

/* ============================================================
   불변식 ㉔ — **`src/` 에 dev/prod 분기가 없다**(C058 · 2026-08-22 코드 축 1회차)

   ## 왜 «지금 0인 것»을 잠그나

   React 가 `test --prod` 를 요구하는 이유의 우리 판이다: 개발 빌드와 배포 빌드의 **동작이
   갈리면** 전 게이트가 녹색인 채로 사용자에게만 다른 앱이 간다. 이 저장소의 검증망은 그
   비대칭에 특히 약하다 — 트랙 A 는 `vite preview`(프로덕션 번들)지만 `npm run dev` 로 보는 것은
   dev 번들이고, `tauri:dev` 는 `devCsp`(느슨)에 오리진이 `localhost:5173` 이다.
   즉 «dev 에서만 도는 코드»가 생기면 그것을 보는 층이 **하나도 없다**.

   실측(2026-08-22): `import.meta.env.DEV|PROD|MODE` · `process.env.NODE_ENV` 분기가 `src/` 에
   **0건**이다. 규율이 지켜지고 있는데 **아무도 안 지키고 있었다** — 이 파일이 반복해 세운 형태
   (선언은 있는데 집행자가 0)의 반대 축이고, 0을 잠그는 것이 가장 싸다.

   ⚠ **빌드 설정은 대상이 아니다**(`vite.config.ts`·`eslint.config.js`) — 거기서 모드를 보는 것은
   정의상 옳다. 막는 것은 **런타임 코드가 자기 모드를 아는 것**이다.
============================================================ */
describe('불변식 ㉔ 런타임 코드에 dev/prod 분기가 없다(C058)', () => {
  const 분기 = /import\.meta\.env\.(DEV|PROD|MODE)\b|process\.env\.NODE_ENV/;

  it('`src/` 에 모드 분기가 0건이다 — 갈리면 어느 층도 그 차이를 못 본다', () => {
    const 위반 = [...tsFiles(join(process.cwd(), 'src') + '/'), ...tsxFiles()]
      .filter((p) => 분기.test(strip(readFileSync(p, 'utf8'))))
      .map(aliasOf);
    expect(위반, 'dev 에서만 도는 코드는 트랙 A(프로덕션 번들)도 트랙 B(릴리스 exe)도 못 본다').toEqual([]);
  });
});

/* ============================================================
   불변식 ㉕ — **치트시트가 없는 키를 광고하지 않는다**(C025 · 2026-08-22)

   ## 무엇이 열려 있었나

   `useKeymapDoc` 은 **선언만** 하는 경로다(리스너 없음). 그 훅 자신이 대가를 명시해 뒀다:
   *"이 경로는 **선언과 구현이 여전히 두 곳**이라 표류할 수 있다."* U033 이 그 표류를 실제로
   청구했고(없는 키가 `?` 에 떠 있었다), **집행자는 0**이었다.

   ## 왜 「구현했는가」가 아니라 「언급하는가」인가 — 실측이 그렇게 시켰다

   같은 파일 안에서도 키를 다루는 관용구가 **셋 이상**이다(실측):
   · `e.key === 'ArrowUp'`(`AllocBoard`·`Items`) · `case 'Escape'`(`Ledger`)
   · `keys.push({ k: '1', … })` 표(`ReviewRun`) · `verbs` 파생(`useListCursor`)
   즉 «구현했는가»를 판정하려 들면 이 검사 자신이 **근본 원인 R1**(집행자가 자기 문법만 막는다)에
   빠진다 — 새 관용구가 생길 때마다 조용히 사각이 생기고, 그건 이 파일이 다섯 번 물린 형태다.

   그래서 훨씬 약하지만 **오탐이 0인** 관계를 잰다: *광고한 키는 그 파일이 최소한 언급은 한다.*
   U033 이 청구한 실패(«그 파일 어디에도 없는 키를 광고») 는 이것으로 잡히고, 관용구가 늘어도
   안 깨진다. ⚠ **이 검사가 통과한다고 «그 키가 동작한다»는 뜻이 아니다** — 그 축은 e2e 의 몫이다.
============================================================ */
describe('불변식 ㉕ useKeymapDoc 이 광고하는 키를 그 파일이 언급한다(C025)', () => {
  /** 치트시트 표기 → 소스에 나타날 수 있는 토큰들. 하나라도 있으면 통과. */
  const 별칭: Record<string, string[]> = {
    Esc: ['Escape', 'Esc'],
    Space: [' ', 'Space'],
    Enter: ['Enter'],
    Backspace: ['Backspace', 'Delete'],
    Tab: ['Tab'],
    '↑': ['ArrowUp'],
    '↓': ['ArrowDown'],
    '←': ['ArrowLeft'],
    '→': ['ArrowRight'],
    '+': ['+'],
    '−': ['-'],
    '/': [],
    Alt: ['alt', 'Alt'],
    Shift: ['shift', 'Shift'],
  };

  /** 그 파일이 **키로서** 다루는 토큰 — 관용구 넷의 합집합(실측으로 모은 것이다). */
  const 처리키 = (code: string): Set<string> => {
    const out = new Set<string>();
    const add = (v?: string): void => void (v && out.add(v.toLowerCase()));
    for (const m of code.matchAll(/\.key\s*===\s*'([^']+)'/g)) add(m[1]); // e.key === 'ArrowUp'
    for (const m of code.matchAll(/\bcase\s*'([^']+)'/g)) add(m[1]); // switch (e.key)
    for (const m of code.matchAll(/\bk:\s*'([^']+)'/g)) add(m[1]); // keys.push({ k: '1' })
    for (const m of code.matchAll(/\bkeys:\s*\[([^\]]*)\]/g))
      // useKeymap({ keys: [...] })
      for (const t of m[1]!.matchAll(/'([^']+)'/g)) add(t[1]);
    /* 이름 붙은 키 상수 — `export const MARK_KEY = 'm'`(`useListCursor`). 다섯째 관용구이고,
       아래 「처리 집합이 비어 있지 않다」가 아니라 **이 줄이 없어서** 실제로 오탐이 났다. */
    for (const m of code.matchAll(/\b[A-Z][A-Z0-9_]*_KEYS?\s*=\s*'([^']+)'/g)) add(m[1]);
    return out;
  };

  const 광고 = (): { 파일: string; display: string; code: string }[] => {
    const out: { 파일: string; display: string; code: string }[] = [];
    for (const { path, code } of sources()) {
      if (!code.includes('useKeymapDoc(')) continue;
      for (const m of code.matchAll(/display:\s*'([^']+)'/g)) {
        out.push({ 파일: aliasOf(path), display: m[1]!, code });
      }
    }
    return out;
  };

  /** 광고 한 칸이 그 파일의 처리 집합에 걸리는가. 걸리는 토큰이 **하나라도** 있으면 통과. */
  const 걸린다 = (display: string, handled: Set<string>): boolean =>
    display
      .split(/[\s/]+/)
      .filter(Boolean)
      .flatMap((t) => 별칭[t] ?? [t])
      .some((cand) => handled.has(cand.toLowerCase()));

  it('광고한 키를 그 파일이 **키로서** 다룬다 — 없는 키를 `?` 가 가르치지 않게', () => {
    const 위반 = 광고()
      .filter(({ display, code }) => !걸린다(display, 처리키(code)))
      .map(({ 파일, display }) => `${파일}: “${display}”`);
    expect(위반, '치트시트가 그 파일이 안 다루는 키를 광고한다(U033 이 청구한 형태)').toEqual([]);
  });

  it('실제로 광고를 찾고 있다 — 0이면 이 불변식이 아무것도 안 잰다', () => {
    expect(광고().length, '`useKeymapDoc` 의 `display` 를 하나도 못 뽑았다').toBeGreaterThan(8);
  });

  /* ⚠⚠ **관용구가 늘면 이 검사는 조용히 눈이 먼다.** 위 `처리키` 는 실측으로 모은 넷이고,
     다섯째가 생기면 그 파일의 처리 집합이 비어 광고가 전부 «안 다룬다»로 보인다 — 그건 시끄러운
     실패라 괜찮다. 반대 방향이 위험하다: 파일이 통째로 빠지면 **아무것도 안 재면서 초록**이다.
     그래서 «광고가 있는 파일은 처리 집합도 비어 있지 않다»를 분모로 함께 잰다. */
  it('광고하는 파일마다 처리 집합이 비어 있지 않다 — 관용구가 늘어 눈이 멀면 여기서 잡힌다', () => {
    const 빈파일 = [...new Map(광고().map((a) => [a.파일, a.code])).entries()]
      .filter(([, code]) => 처리키(code).size === 0)
      .map(([파일]) => 파일);
    expect(빈파일, '이 파일의 키 관용구를 `처리키` 가 못 읽는다 — 새 관용구를 거기 더하라').toEqual([]);
  });
});

/* ============================================================
   불변식 ㉖ — **로컬과 CI 가 같은 런타임을 쓴다** (O003 · 2026-08-22 운영 축)

   ## 왜 이게 불변식이 됐나

   `web/.nvmrc` 는 저장소에 있었고 CI 는 `node-version: 22` 를 **세 곳에 손으로 박고 있었다.**
   그 둘을 잇는 것이 아무것도 없어서 선언과 실행이 갈렸고, **그 틈이 2026-08-20 이후 CI 실패
   그 자체였다**: `test/observations.test.ts` 가 로컬 Node 24 에서는 통과하고 러너 Node 22 에서는
   `Cannot bundle Node.js built-in "node:sqlite"` 로 죽었다. 즉 **로컬 게이트 전량 녹색이 CI
   녹색을 원리적으로 보장하지 않았다** — 이 저장소가 «CI 엔 있는데 로컬엔 없다» 로 세 번 물린
   것의 네 번째 변주다(이번엔 «양쪽에 다 있는데 버전이 다르다»).

   ## 두 축을 잰다 — §1-B 의 규율대로 «값» 이 아니라 «문법» 을 막는다

   ① `.nvmrc` 를 **읽는 자리가 실재한다**(`node-version-file`) 그리고 손으로 박은
      `node-version:` 이 **하나도 없다**. 값이 22 냐 24 냐를 재지 않는 이유는 그것이 바뀌는
      값이기 때문이다 — 막아야 하는 것은 «두 원천» 이라는 형태다.
   ② jsdom 프라그마를 단 테스트가 `node:` 빌트인을 들지 않는다. 그 조합이 정확히 위 실패의
      기계적 형태이고, 여기서 걸리면 러너 버전과 무관하게 로컬에서 빨간불이 된다.

   ⚠ 이 검사가 통과한다고 «두 런타임이 같다» 는 뜻은 아니다 — 개발자 PC 의 실제 Node 는
   여기서 못 잰다(`process.version` 을 단언하면 다른 버전을 쓰는 순간 게이트가 방해가 된다).
   잠그는 것은 **선언이 한 곳뿐이라는 것**이다.
============================================================ */
describe('불변식 ㉖ 런타임 선언이 한 곳이다(O003)', () => {
  const CI = (): string => readFileSync(join(process.cwd(), '..', '.github', 'workflows', 'ci.yml'), 'utf8');

  it('`.nvmrc` 가 실재하고 값이 하나다 — 분모가 없으면 아래 둘이 아무것도 안 잰다', () => {
    const v = readFileSync(join(process.cwd(), '.nvmrc'), 'utf8').trim();
    expect(v, '`web/.nvmrc` 가 비었다').toMatch(/^\d+(\.\d+)*$/);
  });

  it('CI 가 `.nvmrc` 를 읽는다 — `node-version-file` 이 setup-node 마다 있다', () => {
    const ci = CI();
    const 읽는곳 = [...ci.matchAll(/node-version-file:\s*(\S+)/g)].map((m) => m[1]);
    const setupNode = [...ci.matchAll(/uses:\s*actions\/setup-node@/g)].length;
    expect(setupNode, 'setup-node 를 하나도 못 찾았다 — 이 검사가 대상을 잃었다').toBeGreaterThan(0);
    expect(읽는곳.length, 'setup-node 마다 `node-version-file` 이 있어야 한다').toBe(setupNode);
    expect(new Set(읽는곳), '`.nvmrc` 원천이 갈렸다').toEqual(new Set(['web/.nvmrc']));
  });

  it('⚠ 손으로 박은 `node-version:` 이 0건이다 — 그게 갈림의 형태였다', () => {
    const 박힘 = [...CI().matchAll(/^\s*node-version:\s*(\S+)/gm)].map((m) => m[0].trim());
    expect(박힘, 'CI 가 런타임 버전을 직접 적는다 — `node-version-file` 로 바꿔라').toEqual([]);
  });

  /* ⚠ 프라그마는 **줄 주석**이라 `strip()` 이 지운다 — 그래서 원문에서 «줄 첫머리의 지시문»
     형태로만 찾는다. 블록 주석 안의 언급(이 규칙을 설명하는 문장)까지 잡으면 규칙을 문서화한
     파일이 그 규칙을 위반한 것이 된다. 실제로 첫 구현이 그랬다. */
  const jsdom테스트 = (): { 이름: string; code: string }[] =>
    filesUnder((n) => /\.test\.tsx?$/.test(n), join(process.cwd(), 'test'))
      .map((f) => ({ 이름: f.slice(f.lastIndexOf(sep) + 1), code: readFileSync(f, 'utf8') }))
      .filter(({ code }) => /^[ \t]*\/\/[ \t]*@vitest-environment[ \t]+jsdom/m.test(code));

  /* jsdom 환경에서 **외부화되는 것이 실측된** `node:` 빌트인. 여기 있는 것만 든다.
     ⚠ 새로 하나 들이려면 이 표에 적어라 — 그것은 «러너 Node 에서도 외부화되는지 확인했다»는
     뜻이다. `node:sqlite` 는 여기 없고, 없는 것이 옳다(Node 22 의 `builtinModules` 에 없어
     vite 가 번들하려 들었고 그게 CI 를 이틀간 빨간불로 만들었다). */
  const 허용빌트인 = new Set(['node:fs', 'node:path']);

  it('jsdom 테스트가 허용된 `node:` 빌트인만 든다 — 아니면 답이 러너 버전에 달린다', () => {
    const 목록 = jsdom테스트();
    expect(목록.length, 'jsdom 테스트를 하나도 못 찾았다 — 이 검사가 대상을 잃었다').toBeGreaterThan(0);
    const 위반 = 목록.flatMap(({ 이름, code }) =>
      [...strip(code).matchAll(/from\s+'(node:[a-z/]+)'/g)]
        .map((m) => m[1]!)
        .filter((spec) => !허용빌트인.has(spec))
        .map((spec) => `${이름}: ${spec}`),
    );
    expect(위반, 'jsdom 환경은 `node:` 를 번들하려 든다 — node 환경으로 옮기거나 허용표에 근거와 함께 적어라').toEqual(
      [],
    );
  });

  it('허용표가 사문화하지 않았다 — 아무도 안 쓰는 면제가 남아 있으면 실패', () => {
    const 쓰임 = new Set(
      jsdom테스트().flatMap(({ code }) => [...strip(code).matchAll(/from\s+'(node:[a-z/]+)'/g)].map((m) => m[1]!)),
    );
    expect(
      [...허용빌트인].filter((b) => !쓰임.has(b)),
      '쓰이지 않는 허용 항목 — 지워라',
    ).toEqual([]);
  });
});

/* ============================================================
   불변식 ㉗ — **제품 버전의 원천이 둘이고 손으로 맞춘다** (V035 · 2026-08-22 규약 축)

   `릴리스.md §2-1` 이 *"버전 올리기 — **두 곳이 같아야 한다**"* 라 적고 두 경로를 나열한다:
   `src-tauri/tauri.conf.json` 과 `src-tauri/Cargo.toml`. 그런데 **그 규약의 집행자가 없었다** —
   즉 «두 곳이 같아야 한다」가 절차서의 문장 하나에 걸려 있었다.

   어긋나면 무슨 일이 나나: 업데이터는 **`tauri.conf.json` 의 버전**을 «현재 버전»으로 보고
   `latest.json` 과 비교한다. Cargo 쪽이 낮으면 인스톨러 파일명·제품 메타는 옛 번호인데
   업데이터는 새 번호로 판단한다 → 「새 버전이 있다」고 잘못 말하거나 반대로 **침묵한다.**
   그리고 침묵은 이 저장소가 H-13 에서 **나흘을 몰랐던** 바로 그 형태다.

   ⚠ **루트·web 의 `0.0.0` 은 결함이 아니다.** 둘 다 `private` 패키지이고 npm 에 발행되지
   않으므로 `0.0.0` 은 «발행 안 함»의 관용 표기다. 제품 버전과 **다른 축**이라 여기서 재지
   않는다 — 셋을 한 축으로 읽으면 「원천 셋」이라는 잘못된 진단이 나온다(실제로 그렇게 올라왔다).
============================================================ */
describe('불변식 ㉗ 제품 버전 원천이 서로 같다(V035)', () => {
  const 루트 = (p: string): string => readFileSync(join(process.cwd(), '..', p), 'utf8');

  it('`tauri.conf.json` 과 `Cargo.toml` 의 버전이 같다 — 절차서가 손으로 지키던 규약', () => {
    const conf = JSON.parse(루트('src-tauri/tauri.conf.json')).version as string;
    /* ⚠ `[package]` 절의 첫 `version` 만 본다 — 의존성에도 `version =` 이 널렸다. */
    const cargo = /\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m.exec(루트('src-tauri/Cargo.toml'))?.[1];
    expect(conf, 'tauri.conf.json 에 version 이 없다').toMatch(/^\d+\.\d+\.\d+/);
    expect(cargo, 'Cargo.toml `[package]` 에서 version 을 못 읽었다 — 이 검사가 대상을 잃었다').toBeDefined();
    expect(cargo, `릴리스.md §2-1 이 요구하는 두 곳이 갈렸다(conf ${conf} · cargo ${cargo})`).toBe(conf);
  });

  it('⚠ 배포 매니페스트가 있으면 그것도 같다 — 어긋나면 업데이터가 조용히 침묵한다', () => {
    /* `release-verify.mjs` 가 배포 **시점**에 같은 것을 보지만, 그건 «릴리스한다»고 선언한
       순간에만 돈다 — 그리고 **선언하지 않는 것**이 H-13 의 형태였다. 여기는 매 게이트다. */
    const conf = JSON.parse(루트('src-tauri/tauri.conf.json')).version as string;
    const m = JSON.parse(readFileSync(join(process.cwd(), 'public/updates/latest.json'), 'utf8')) as {
      version: string;
    };
    expect(m.version, `매니페스트 ${m.version} ≠ 소스 ${conf}`).toBe(conf);
  });
});

/* ============================================================
   불변식 ㉘ — **이력을 읽는 잡은 전체 이력을 받는다**(2026-08-27)

   `freshness` 는 5일 연속(2026-08-22~26) 빨간불이었고, 원인은 코드가 아니라 **체크아웃 깊이**
   였다. `actions/checkout` 의 기본은 `fetch-depth: 1` 인데 그 스크립트의 세 축 중 **둘이 커밋
   이력을 읽는다.** 얕은 트리 위에서 둘이 **반대 방향으로 동시에 거짓말했다**:

     · 봇 활동 — `git log --author=bot` 이 빈 문자열 → **9999일** (없는 결함을 단언 · 거짓 빨강)
     · 배포 도달 — `--since` 커밋 수가 17 대신 **1** → `n >= 10` 즉시실패가 **조용히 해제**(거짓 초록)

   즉 매일 울리던 빨간불이 **자기 안의 거짓 초록을 가리고 있었다.** 그리고 그 빨간불은 이
   저장소가 가장 두려워하는 형태로 가는 길이다 — `freshness.mjs` 머리주석이 스스로
   «시끄러운 게이트는 `|| true` 로 무력화되는 길로 간다» 고 적어 둔 그것.

   ⚠ **값이 아니라 형태를 막는다**(㉖ 과 같은 규율): 「`fetch-depth` 가 0 이다」가 아니라
   **「이력을 읽는 잡에 그 선언이 있다」** 를 잰다. 스크립트 쪽에도 그물이 있지만(얕으면
   「모름」), 그물은 **관측을 포기하는 것**이라 이 잡의 존재 이유를 없앤다 — 그물이 매일
   조용히 «3개 축을 관측하지 못했다» 를 찍는 상태가 되면 이 잡은 도는 척만 한다.
   그래서 정본은 이쪽이다.
============================================================ */
describe('불변식 ㉘ 이력을 읽는 잡이 전체 이력을 받는다', () => {
  /** ci.yml 의 최상위 잡 블록들 — `jobs:` 아래 2칸 들여쓴 키가 잡 하나다. */
  const 잡들 = (): { 이름: string; body: string }[] => {
    const ci = readFileSync(join(process.cwd(), '..', '.github', 'workflows', 'ci.yml'), 'utf8');
    const 시작 = [...ci.matchAll(/^ {2}([A-Za-z][\w-]*):[ \t]*$/gm)];
    return 시작.map((m, i) => ({
      이름: m[1]!,
      body: ci.slice(m.index!, i + 1 < 시작.length ? 시작[i + 1]!.index! : ci.length),
    }));
  };

  it('이력을 읽는 잡을 실제로 찾는다 — 분모가 없으면 아래가 아무것도 안 잰다', () => {
    expect(잡들().length, 'ci.yml 에서 잡을 하나도 못 찾았다 — 파서가 대상을 잃었다').toBeGreaterThan(1);
    expect(
      잡들().filter((j) => /npm run freshness/.test(j.body)).length,
      '`npm run freshness` 를 도는 잡이 사라졌다 — 이 불변식이 대상을 잃었다',
    ).toBe(1);
  });

  it('⚠ `freshness` 를 도는 잡의 체크아웃이 전체 이력을 받는다(`fetch-depth: 0`)', () => {
    const 위반 = 잡들()
      .filter((j) => /npm run freshness/.test(j.body))
      .filter((j) => !/fetch-depth:\s*0\b/.test(j.body))
      .map((j) => j.이름);
    expect(위반, '얕은 클론에서는 커밋 이력 축이 「0건」을 단언한다 — checkout 에 `fetch-depth: 0` 을 달아라').toEqual(
      [],
    );
  });
});

/* ============================================================
   불변식 ㉙ — **떠도는 preview 청소가 `webServer` 보다 먼저 돈다**(O038 · 2026-08-27)

   O035 는 청소부를 `globalSetup` 에 걸었는데, `_strayPreview.ts` 가 **스스로 적어 둔 순서**가
   그 자리를 무효로 만든다: Playwright 는 `globalSetup` 보다 `webServer` 를 **먼저** 띄운다.
   그래서 stray 가 4173 을 쥐면 `webServer` 가 먼저 바인딩에 실패하고 청소부는 **한 줄도 안
   돈다**(재현 시 메시지 0줄 — 조건을 못 맞춘 게 아니라 미실행이다). 2026-08-27 게이트가 물렸다.

   ⚠⚠ 그리고 고치는 과정에서 **같은 사고가 형태를 바꿔 되살아났다**: 설정 모듈을 워커가 다시
   import 하면 `RUN_STARTED` 가 우리 `webServer` 보다 **나중**이 되어 자기 서버를 죽인다
   (실측: 정리 메시지 두 줄 + `ERR_CONNECTION_REFUSED`). 그래서 **env 센티널**로 한 번만 돈다 —
   모듈 스코프 변수로는 못 막는다(프로세스가 다르면 그 변수도 새로 난다).

   ## 무엇을 잠그나 — 값이 아니라 **자리와 가드**
     ① 설정이 청소부를 **모듈 스코프**에서 부른다(= `webServer` 기동 전)
     ② 그 청소부가 **`globalSetup` 으로 걸려 있지 않다**(그 자리가 이 결함의 원인이었다)
     ③ 청소부에 **env 센티널 가드**가 있다(재평가가 자기 서버를 죽이던 자리)
     ④ 청소부가 **포트를 인자로 받고**, 설정이 넘기는 값이 `webServer` 가 바인딩하는 값과 같다
        (P047 · 2026-08-28 — 종전엔 포트를 안 봐서 **다른 포트의 멀쩡한 preview 를 죽였다**:
         성능 회차에서 `:4173`·`:4174` 가, 재현에서 `:4176` 이 끊겼다. 두 값이 갈리면 이 가드는
         조용히 아무것도 안 죽인다 — 그래서 「같다」를 여기서 잠근다)
============================================================ */
describe('불변식 ㉙ 떠도는 preview 청소가 webServer 보다 먼저 돈다(O038)', () => {
  const CFG = (): string => readFileSync(join(process.cwd(), 'playwright.config.ts'), 'utf8');
  const REAPER = (): string => readFileSync(join(process.cwd(), 'e2e', '_strayPreview.ts'), 'utf8');

  it('대상이 실재한다 — 분모가 없으면 아래 셋이 아무것도 안 잰다', () => {
    expect(CFG(), 'playwright.config.ts 를 못 읽었다').toContain('webServer');
    expect(REAPER(), '_strayPreview.ts 를 못 읽었다').toContain('killStrayPreview');
  });

  it('① 설정이 청소부를 모듈 스코프에서 부른다 — `webServer` 보다 먼저', () => {
    const cfg = strip(CFG());
    expect(cfg, '청소부를 import 하지 않는다').toMatch(/import\s+killStrayPreview\s+from/);
    /* 줄 첫머리 호출 = 모듈 스코프. `defineConfig({…})` 안이면 들여쓰기가 붙는다. */
    /* ⚠ 인자를 허용한다 — P047 이 포트를 넘기게 바꿨다(그 값의 일치는 ④가 잠근다). */
    expect(cfg, '모듈 스코프 호출이 없다 — 그러면 `webServer` 보다 늦게 돈다').toMatch(/^killStrayPreview\([^)]*\);/m);
  });

  it('④ 청소부가 포트를 받고, 그 값이 `webServer` 가 바인딩하는 포트와 같다(P047)', () => {
    const cfg = strip(CFG());
    const 넘긴값 = /killStrayPreview\(\s*([A-Za-z0-9_]+)\s*\)/.exec(cfg)?.[1];
    expect(넘긴값, '포트를 안 넘긴다 — 그러면 청소부가 무엇을 막는지 모른 채 죽인다').toBeTruthy();
    const 포트 = /^\d+$/.test(넘긴값!)
      ? Number(넘긴값)
      : Number(new RegExp(`const\\s+${넘긴값}\\s*=\\s*(\\d+)`).exec(cfg)?.[1]);
    expect(Number.isInteger(포트), `\`${넘긴값}\` 의 값을 못 읽었다`).toBe(true);
    expect(cfg, `webServer.command 가 :${포트} 를 안 쓴다 — 두 값이 갈렸다`).toContain(`--port ${포트}`);
    expect(cfg, `webServer.url 이 :${포트} 를 안 쓴다 — 두 값이 갈렸다`).toContain(`:${포트}`);
    expect(REAPER(), '청소부가 포트를 인자로 안 받는다').toMatch(/killStrayPreview\(\s*port\s*:\s*number/);
  });

  it('② 청소부가 `globalSetup` 에 걸려 있지 않다 — 그 자리가 O038 의 원인이었다', () => {
    const gs = [...strip(CFG()).matchAll(/globalSetup:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!);
    expect(
      gs.filter((v) => v.includes('_strayPreview')),
      '`globalSetup` 은 `webServer` 뒤에 돈다 — 포트 충돌을 못 막는다',
    ).toEqual([]);
  });

  it('③ 청소부에 재진입 가드가 있다 — 워커 재평가가 자기 서버를 죽였다', () => {
    const r = strip(REAPER());
    expect(r, 'env 센티널이 없다 — 워커 재평가 때 우리 `webServer` 를 죽인다').toMatch(
      /process\.env\[[^\]]+\]\s*=\s*'1'/,
    );
  });
});

/* ============================================================
   불변식 ㉚ — **폰 precache 그래프가 산출물 폴더를 추측하지 않는다**(P045 · 2026-08-28)

   `vite.config.ts` 의 `phoneGraphFiles()` 는 빌드 매니페스트를 읽어 «폰이 실제로 참조하는 것»
   만 precache 에 남긴다(D-9). 그 경로가 `'dist/.vite/manifest.json'` 으로 **박혀 있었다.**
   `--outDir` 이 다르면 그 빌드의 매니페스트가 아니라 **지난 빌드의 것**을 읽고, 해시 파일명이
   안 맞으니 그래프가 빗나가 precache 가 조용히 축소된다 —
   재현(2026-08-28): 정상 `dist` **43 entries** vs `--outDir dist-alt` **29 entries**.

   ⚠⚠ 이 결함의 실패 모드는 「빌드가 깨진다」가 아니라 **「오프라인에서만 반쪽인 SW 를
   배포한다」** 다. 정적 검사도 e2e 도 온라인에서 도므로 어느 층도 안 본다 — 그래서 여기 있다.

   ## 무엇을 잠그나 — 값이 아니라 **출처**
     ① `phoneGraphFiles` 가 매니페스트 경로에 `dist` 를 문자열로 쓰지 않는다
     ② vite 가 해석한 `build.outDir` 을 받는 통로(`configResolved`)가 실재한다
     ③ 그 통로가 플러그인으로 **등록돼 있다**(정의만 하고 안 꽂으면 ②가 사문이다)
============================================================ */
describe('불변식 ㉚ 폰 precache 그래프가 outDir 를 추측하지 않는다(P045)', () => {
  const VITE = (): string => readFileSync(join(process.cwd(), 'vite.config.ts'), 'utf8');

  it('대상이 실재한다 — 분모가 없으면 아래 셋이 아무것도 안 잰다', () => {
    expect(VITE(), 'vite.config.ts 를 못 읽었다').toContain('phoneGraphFiles');
    expect(VITE(), 'manifestTransforms 가 없다 — 이 그래프의 소비처가 사라졌다').toContain('manifestTransforms');
  });

  it('① 매니페스트 경로에 산출물 폴더 이름을 박지 않는다', () => {
    const src = strip(VITE());
    const 하드코딩 = /['"`][^'"`]*\bdist\b[^'"`]*\.vite[^'"`]*['"`]/.test(src) || /['"`]dist\//.test(src);
    expect(하드코딩, "`'dist/...'` 를 문자열로 쓰고 있다 — `--outDir` 이 다르면 지난 빌드를 읽는다").toBe(false);
  });

  it('② vite 가 해석한 outDir 을 받는 통로가 있다', () => {
    const src = strip(VITE());
    expect(src, '`configResolved` 가 없다 — 해석된 outDir 을 받을 자리가 없다').toContain('configResolved');
    expect(src, 'build.outDir 을 읽지 않는다').toMatch(/build\s*[.:][\s\S]{0,40}outDir/);
  });

  it('③ 그 통로가 플러그인으로 실제 등록돼 있다 — 정의만 하면 사문이다', () => {
    const src = strip(VITE());
    const 이름 = /const\s+([A-Za-z0-9_가-힣]+)\s*=\s*\{\s*[\s\S]{0,120}?configResolved/.exec(src)?.[1];
    expect(이름, 'configResolved 를 가진 플러그인 객체를 못 찾았다').toBeTruthy();
    const plugins = /plugins:\s*\[([\s\S]*?)\n\s*\],/.exec(src)?.[1] ?? '';
    expect(plugins, `\`${이름}\` 가 plugins 배열에 없다 — 훅이 안 돈다`).toContain(이름!);
  });
});

/* ============================================================
   불변식 ㉛ — **셸 렌더가 Suspense 를 기다리지 않는다**(P051 · 2026-08-28)

   `App` 을 렌더하는 케이스는 첫 라우트가 `React.lazy` 라 Suspense 를 탄다. v8 커버리지 계측이
   붙으면 그 청크 import+평가가 RTL 의 대기 예산을 넘고, 그 예산의 상대는 **옆에서 도는 것**이라
   얼마를 줘도 넘길 수 있다 — 실제로 1,000 → 5,000 ms 로 두 번 올렸고 두 번 흘러내렸다.

   실측 A/B(2026-08-28 · 같은 트리 · CPU 100% 합성 부하):
   **고치기 전 10 failed / 199 · 고친 뒤 199 passed**(부하 없이 돌리면 둘 다 통과한다 —
   그래서 이 결함은 «가끔 빨간불»이 아니라 **판별 비용**으로 나타난다).

   처방은 예산을 또 올리는 것이 아니라 **대기를 없애는 것**이고, 그건 제품이 이미 쓰는
   관용구다(`main.tsx` 의 `warmTab` · P028).

   ## 무엇을 잠그나 — 값이 아니라 **경로**
     ① 공용 헬퍼가 렌더 전에 `warmTab` 을 부른다
     ② 그 헬퍼가 **async** 다(동기면 덥히기가 렌더보다 늦어 아무 효과가 없다)
     ③ 테스트가 `<App />` 을 **직접** 렌더하지 않는다 — 사본은 ①을 못 받는다
        (`monthCalendar` 가 실제로 그 사본이었다)
     ④ ①을 `test/_setup.ts` 전역으로 옮기지 않았다 — 그러면 레지스트리 import 가 `useApp`
        모듈 평가를 유발해 **SD-7 부팅 순서 계약**이 깨진다(시도했고 db·cloud 8개가 깨졌다)
============================================================ */
describe('불변식 ㉛ 셸 렌더가 Suspense 를 기다리지 않는다(P051)', () => {
  const RENDER = (): string => readFileSync(join(process.cwd(), 'test', '_render.tsx'), 'utf8');
  const SETUP = (): string => readFileSync(join(process.cwd(), 'test', '_setup.ts'), 'utf8');

  it('대상이 실재한다 — 분모가 없으면 아래 넷이 아무것도 안 잰다', () => {
    expect(RENDER(), 'test/_render.tsx 를 못 읽었다').toContain('renderApp');
  });

  it('① 공용 헬퍼가 렌더 전에 탭 청크를 덥힌다', () => {
    const src = strip(RENDER());
    expect(src, 'warmTab 을 안 부른다 — 첫 라우트가 Suspense 를 그대로 탄다').toContain('warmTab');
    const 덥힘 = src.indexOf('warmTab');
    const 렌더 = src.indexOf('return render(');
    expect(덥힘 >= 0 && 렌더 >= 0 && 덥힘 < 렌더, '덥히기가 render 뒤에 있다 — 순서가 곧 이 처방이다').toBe(true);
  });

  it('② `renderApp` 이 async 다 — 동기면 덥히기가 렌더보다 늦는다', () => {
    expect(strip(RENDER()), 'renderApp 이 async 가 아니다').toMatch(/export\s+async\s+function\s+renderApp/);
  });

  it('③ 테스트가 `<App />` 을 직접 렌더하지 않는다 — 사본은 ①을 못 받는다', () => {
    const 사본: string[] = [];
    for (const p of filesUnder((n) => n.endsWith('.tsx'), join(process.cwd(), 'test'))) {
      if (p.replace(/\\/g, '/').endsWith('test/_render.tsx')) continue;
      if (/<App\s*\/>/.test(strip(readFileSync(p, 'utf8')))) 사본.push(p.replace(/\\/g, '/').split('/test/')[1]!);
    }
    expect(사본, `\`<App />\` 를 직접 그린다 — \`renderApp\` 을 쓸 것: ${사본.join(', ')}`).toEqual([]);
  });

  it('④ 덥히기를 `_setup.ts` 전역으로 옮기지 않았다 — SD-7 부팅 순서 계약을 깬다', () => {
    const setup = strip(SETUP());
    expect(
      setup,
      '`_setup.ts` 가 features/registry 를 import 한다 — `useApp` 이 `initAppStore` 보다 먼저 평가된다',
    ).not.toContain('features/registry');
    expect(setup, '`_setup.ts` 가 warmTab 을 부른다 — 같은 이유로 안 된다').not.toContain('warmTab');
  });
});

/* ============================================================
   불변식 ㉜ — **레일은 화면 수와 함께 자라지 않는다**(축 접기 · 2026-08-28)

   W5 평탄화 이후 이 저장소의 기본값은 «새 화면 = 새 레일 줄»이었고, 그래서 레일이 15줄이 됐다
   (사용자 보고: *"탭이 많아지니까 밀도가 높고 가독성이 떨어진다"*). 처방은 배치 하나가 아니라
   **증가분이 어디로 가는가의 규칙**이다 — 새 화면은 **축 안**으로 들어가고, 최상위는 «새 질문이
   생겼을 때»만 는다. 규칙을 산문으로만 적으면 6개월 뒤 같은 자리로 돌아온다.

   ⚠ 상한을 **올려서** 이 검사를 통과시키지 마라. 넘쳤다는 것은 그 축이 화면 하나를 더 받을
   자리가 없다는 뜻이고, 답은 ① 그 화면을 호스트 안의 `role:'view'` 로 접거나 ② 축을 쪼개는
   것(=새 질문을 세우는 것)이다. 숫자를 늘리면 규칙이 아니라 장식이 된다.
============================================================ */
describe('불변식 ㉜ 레일이 화면 수와 함께 자라지 않는다(축 접기)', () => {
  const LEAD = 'now';
  const FOOT = 'system';
  const RAIL = (): string => readFileSync(join(SRC, 'app', 'RailSidebar.tsx'), 'utf8');

  it('축이 다섯을 넘지 않는다 — 최상위는 «질문»의 수이지 화면의 수가 아니다', () => {
    expect(RAIL_SECTIONS.length, `축이 ${RAIL_SECTIONS.length}개다 — 질문이 정말 그만큼 늘었나`).toBeLessThanOrEqual(5);
  });

  it('아코디언 밖 축 둘(상시·바닥)이 실재한다 — 오타면 축 하나가 조용히 사라진다', () => {
    const keys = RAIL_SECTIONS.map((s) => s.key);
    expect(keys, `RailSidebar 의 LEAD_SECTION('${LEAD}')이 로스터에 없다`).toContain(LEAD);
    expect(keys, `RailSidebar 의 FOOT_SECTION('${FOOT}')이 로스터에 없다`).toContain(FOOT);
    const src = strip(RAIL());
    expect(src, 'RailSidebar 의 LEAD_SECTION 이 이 검사와 다른 값을 본다').toContain(`LEAD_SECTION = '${LEAD}'`);
    expect(src, 'RailSidebar 의 FOOT_SECTION 이 이 검사와 다른 값을 본다').toContain(`FOOT_SECTION = '${FOOT}'`);
  });

  /* 헤더 클릭이 **빈손으로 끝나지 않는** 것의 전제다 — 축마다 «얼굴»이 하나 있어야 그리로 간다.
     둘이면 어느 쪽이 얼굴인지 코드가 임의로 고르고(첫 번째), 그건 IA 판단을 배열 순서에 숨기는
     것이다. 없으면 헤더가 접기 토글로 퇴화한다. */
  it('아코디언 축마다 얼굴(destination)이 정확히 하나다', () => {
    for (const sec of RAIL_SECTIONS) {
      if (sec.key === LEAD || sec.key === FOOT) continue;
      const faces = sec.tabs.filter((k) => tabByKey(k)?.role === 'destination');
      expect(faces.length, `축 '${sec.key}' 의 얼굴이 ${faces.length}개다: ${faces.join(', ')}`).toBe(1);
    }
  });

  it('한 축이 여섯 줄을 넘지 않는다 — 넘치면 상한이 아니라 그 축을 고쳐라(머리주석)', () => {
    for (const sec of RAIL_SECTIONS) {
      expect(
        sec.tabs.length,
        `축 '${sec.key}' 이 ${sec.tabs.length}줄이다 — 호스트로 접거나 축을 쪼개라`,
      ).toBeLessThanOrEqual(6);
    }
  });

  /* 접힌 축의 줄은 `display:none` 이라 브라우저가 포커스를 안 준다. roving 목록에 그대로 두면
     화살표가 «아무 일도 안 하는 칸»을 도는데, 그건 키보드 사용자에게만 보이는 결함이라
     스냅샷·axe 어느 쪽도 못 잡는다. */
  it('roving 목록이 보이는 것만 돈다 — 접힌 축의 줄을 넣지 않는다', () => {
    const src = strip(RAIL());
    expect(src, 'visibleFocusIds 가 없다 — roving 이 전량 평면 목록으로 돌아갔나').toContain('visibleFocusIds');
    expect(src, 'visibleFocusIds 가 열림 여부를 안 본다').toMatch(/visibleFocusIds\([^)]*isOpen[^)]*\)/);
  });
});
