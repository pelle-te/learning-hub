/* ============================================================
   Guide(안내) — 탭: 📖 이 시스템이 할 수 있는 것 · 하는 법 (전역 매뉴얼).
   이 시스템이 하는 일(전공 교재 → 원자형 노트)과 각 작업의 '무엇/어떻게'를 한곳에. ⛔ 종전 «세 축(학습·수집·목표)» 은 2026-08-29 에 하나로 줄었다.
   순수 참조(정적) — 백엔드와 무관하게 항상 렌더. 명령·트리거는 실제 repo 근거(지시문/도구/Rust `tools.rs` TOOLS).
   레이어: store(usePageChrome)만 소비. app/다른 feature import 금지(boundaries).
============================================================ */
import type { ReactNode } from 'react';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { usePing } from '@/store/queries';
import { Icon } from '@/components/Icon';
import { tabByKey } from '@/shell/tabs';

/* ── C-7 세 번째 이식 ────────────────────────────────────────────────────
   규약은 설계서 §15 가 SSOT. 이 파일에서 처음 만난 것 둘:
   ① **표**(`.table th/td`, `td:first-child`, `td:nth-child(2)`) — 구조 의사클래스를
      쓰던 자리다. th/td 가 전부 JSX 에 있으므로 **직접 클래스**를 준다(규약 4).
   ② **`li::marker`** — Tailwind 의 `marker:` 변형이 그대로 대응한다.
   그리고 `<b>` 자손 규칙(`.heroDesc b`·`.note b`·`.warn b`)도 규약 4대로 각 `<b>` 에
   클래스를 준다 — 그 넷은 "muted 문단 안에서 굵은 글자는 본문색"이라는 타이포 규칙이었다. */
const ROOT = 'max-w-guide px-5 pt-4 pb-6';
const HERO = 'mb-4 rounded-lg border border-line-acc bg-linear-to-b from-acc-soft to-transparent p-5';
const CARD = 'mb-3 rounded-md border border-line bg-panel px-4 py-4';
const HOW =
  'grid grid-cols-guide items-baseline gap-3 rounded-sm border border-line2 bg-bg px-2 py-2 max-narrow:grid-cols-1 max-narrow:gap-1';
/* 인라인 토큰 — 말로 시키기/명령/참조/키/탭. 전부 같은 골격에 색만 다르다. */
const TOKEN = 'rounded-sm px-1 py-px text-token font-mono whitespace-nowrap';
const SAY = `${TOKEN} border border-line-acc-soft bg-acc-soft text-acc-on-soft`;
const CMD = `${TOKEN} bg-line2 text-txt`;
const REF = 'rounded-sm bg-tint-line2 px-1 py-px text-token font-mono text-mut';
const K = `${REF} text-acc2`;
const TAB = 'inline-block rounded-full bg-tint-acc2 px-2 py-px text-token font-semibold text-acc2 whitespace-nowrap';
const NOTE = 'mt-1 rounded-sm border border-dashed border-line bg-bg px-3 py-2 text-xs leading-relaxed text-mut';
const WARN =
  'mt-1 rounded-sm border border-line-learning bg-tint-learning-soft px-3 py-2 text-xs leading-relaxed text-txt';
const TH = 'border-b border-line2 px-2 py-2 text-left align-top text-xs font-bold tracking-wide text-mut uppercase';
const TD = 'border-b border-line2 px-2 py-2 text-left align-top';

/** Claude에게 말로 시키는 트리거(지시문을 읽고 실행). */
function Say({ children }: { children: ReactNode }) {
  return <code className={SAY}>{children}</code>;
}
/** 터미널에서 돌리는 명령. */
function Cmd({ children }: { children: ReactNode }) {
  return <code className={CMD}>{children}</code>;
}
/**
 * 허브 탭 이름(운전석 내 위치 안내).
 *
 * ⚠⚠ **문자열이 아니라 로스터 키를 받는다**(C033 · 2026-08-22). 종전엔 이름이 손으로
 * 적혀 있었고 `shell/tabs.ts` 와 아무 연결이 없었다 — 실측하면 **없는 탭 다섯을 여덟 번**
 * 가리키고 있었다(`발견`·`읽을거리`·`탐구 수집`·`증시 동향`·`증시`). 사용자에게 이건 오타가
 * 아니라 **따라갈 수 없는 처방**이다: 그 이름을 ⌘K 에 치면 0 히트다.
 * 불변식 ⑰이 정확히 그 형태를 막으려고 서 있었는데, 관용구가 `<b>…</b> 탭` 이라 **같은 뜻의
 * 전용 컴포넌트를 원리적으로 못 봤다**(근본 원인 R1 — 집행자가 자기 문법만 막는다).
 * 이제 개명·제거는 **타입 에러**가 된다. 그게 이 시그니처의 값이다.
 *
 * ⚠ 표시는 `label` 이다(`segLabel` 이 아니다) — 팔레트(`shell/palette.ts`)가 `t.label` 로
 * 항목을 만들므로, 매뉴얼이 부르는 이름과 ⌘K 에 쳐 넣을 이름이 같아야 한다.
 * `role:'view'` 도 정당한 인자다 — 팔레트가 그 셋도 `to` 로 싣는다(Q-22).
 *
 * ⚠⚠ **집행자는 타입이 아니라 불변식 ⑰이다.** 리포트의 처방은 `k: TabKey` 유니온이었는데
 * 이 저장소에 그런 타입이 **없다**(`TabMeta.key` 가 `string` 이고 `TABS` 는 `as const` 가
 * 아니다 — 그걸 바꾸면 로스터를 읽는 곳 전부가 딸려 온다). 그래서 같은 보장을 게이트 층에
 * 뒀다: ⑰이 이 파일의 `<Tab k="…" />` 를 긁어 로스터와 대조한다. 아래 `throw` 는 그 뒤의
 * 마지막 그물이다(개발 중 즉시 눈에 띄게 — 조용히 빈 칩을 그리지 않는다).
 */
function Tab({ k }: { k: string }) {
  const t = tabByKey(k);
  if (!t) throw new Error(`로스터에 없는 탭이다: ${k}`);
  return <span className={TAB}>{t.label}</span>;
}

function Section({
  n,
  glyph,
  title,
  what,
  children,
}: {
  n?: string;
  glyph: string;
  title: string;
  what: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={CARD}>
      <header className="mb-3 flex items-start gap-3">
        <span className="flex-none text-xl leading-tight" aria-hidden="true">
          {glyph}
        </span>
        <div>
          <h2 className="m-0! mb-1! text-lg! tracking-tight!">
            {n && <span className="text-acc tabular-nums">{n}</span>}
            {title}
          </h2>
          <p className="m-0 text-sm leading-relaxed text-mut">{what}</p>
        </div>
      </header>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

/** '어떻게' 한 줄 — 라벨 + 방법(트리거/명령/탭). */
function How({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={HOW}>
      <div className="text-xs font-bold tracking-tight text-acc">{label}</div>
      <div className="text-sm leading-relaxed text-txt">{children}</div>
    </div>
  );
}

export default function Guide() {
  const toolN = usePing().data?.tools.length ?? null;
  usePageChromeEffect(
    () => ({
      /* W22/H3 — `primary` 는 **필수 키**다(`store/usePageChrome.ts` 머리주석). 이 화면은 렌즈라
         44px 앵커를 세우지 않는다 — 잊은 것이 아니라 없다고 정한 것이다. */
      primary: null,
      readouts: [
        { label: '핵심 축', value: 1 }, // ⛔ 3 → 1(2026-08-29): 수집은 survey 로, 연관성·숙달도는 부모 목적 정정으로 나갔다.
        { label: '저작 지시문', value: 13 },
        /* ⛔ **손으로 적지 마라**(U045 · 2026-08-31). 여기 「11」이라 적혀 있는 동안 실물은 7 이었고
           그중 둘은 부모에 없는 스크립트를 가리켰다 — 그래서 이 수는 능력 탐지가 알리는 **실물**에서
           읽는다(`capabilities.tools` = `tools.rs` 의 `TOOLS`). 미연결이면 리드아웃에 안 싣는다. */
        ...(toolN == null ? [] : [{ label: '허브 도구', value: toolN }]),
      ],
    }),
    [toolN],
  );

  return (
    <section className={ROOT}>
      {/* ── 히어로 ── */}
      <header className={HERO}>
        <div className="font-mono text-xs font-semibold tracking-wide text-acc uppercase">러닝 허브 · 안내</div>
        {/* ⚠ `h2` 인 이유는 `Goals` 히어로와 같다(M-12) — 흡수된 뷰는 앱 셸의 `h1` 아래 한 단
            깊다. 굵기 유틸은 픽셀 보존용(전역 h1=800 · h2=700). */}
        <h2 className="mt-1! mb-2! text-xl! font-extrabold tracking-tight!">이 시스템이 할 수 있는 것 · 하는 법</h2>
        <p className="m-0 max-w-prose text-sm leading-relaxed text-mut">
          <b className="text-txt">전공 교재를 원자형 노트로</b> — 교재를 개념 단위로 쪼개 검증하고, 실전문제를 낸다. 각
          작업은 <b className="text-txt">Claude에게 말로</b> 시키거나(지시문을 읽고 실행), 터미널 명령/허브 탭에서
          실행한다.
          {/* ⛔ 2026-08-29 — 종전 이 문단은 «삶-연관 개인 지식 엔진 … 세 축(학습·수집·연관성)이 한 운전석에서 돈다»
              였다. 셋 중 둘이 죽었다: 수집은 2026-08-21 에(survey 로 갔다), 연관성·숙달도는 이번에 부모 목적
              정정으로. **남은 축은 하나**이고, 그러면 그건 축이 아니라 그냥 이 시스템이 하는 일이다. */}
        </p>
      </header>

      {/* ── ① 전공 학습 ── */}
      <Section
        n="① "
        glyph="books"
        title="전공 학습 — 교재를 노트로"
        what={
          <>
            과목 교재(mineru→<Cmd>sources/</Cmd>)를 원자 개념노트로 만들어 실전문제로 학습한다. 이게 엔진의 심장. 과목:{' '}
            <b>기초수학 BMATH · 선형대수 LINA · 과학기술과법 STLAW</b>.
          </>
        }
      >
        <How label="한 챕터 통째">
          <Say>"(과목) (챕터) 돌려줘"</Say> → 재작성→검증→시각화→출제→링크패스를 단계별 격리로 실행(
          <code className={REF}>지시문_파이프라인</code>).
        </How>
        <How label="개별 단계만">
          <Say>"(과목) (챕터) 검증만"</Say> 처럼 → 해당 <code className={REF}>지시문N</code> 단독 실행.
        </How>
        <How label="기존 노트 개선">
          <Say>"(과목) (챕터) 리팩터링"</Say> → 갭 분석 리포트 → <b>내 승인</b> → 패치(
          <code className={REF}>지시문7</code> · 승인 전엔 노트 안 건드림).
        </How>
        <How label="품질 점수">
          <Say>"(과목) (챕터) 평가"</Say> → 6차원 루브릭 채점(<code className={REF}>지시문8</code> · 읽기전용 · 지시문
          바꾸기 전후 델타 측정).
        </How>
        <p className={NOTE}>
          규칙: <code className={K}>status: verified</code> 노트만 출제 대상. 검증 최종판정은{' '}
          <b className="text-txt">나</b>
          (에이전트가 임의로 해소하지 않음).
        </p>
      </Section>

      {/* ── ② 복습(Anki) ── */}
      <Section
        n="② "
        glyph="refresh"
        title="복습 — 카드는 더 이상 이 시스템의 몫이 아니다"
        what={
          <>
            <b>2026-09-01 에 은퇴했습니다.</b> 부모(pipeline)가 Anki 축을 닫으면서 카드 생산·내보내기가 사라졌습니다.
            이미 만든 카드는 Anki 앱 안에 그대로 있습니다.
          </>
        }
      >
        <How label="카드 생성(은퇴)">
          종전에는 <Say>"(과목) (챕터) Anki"</Say> 로 카드 초안을 내보내 <b>Anki에 import</b> 했습니다. 그 지시문도 그
          폴더도 <b>지금은 없습니다</b> — 복구는 부모 태그 <code className={REF}>은퇴/anki-2026-09-01</code>.
        </How>
        <How label="약점·점검 도구">
          모의고사(실전문제)는 그대로. 허브 <Tab k="review-run" />
          에서 확인.
        </How>
        <p className={WARN}>
          <Icon name="alert" /> <b className="text-learning">2026-08-29 — 학습 신호 축이 은퇴했다.</b> 부모(pipeline)가
          목적을 「전공 교재 → 원자형 노트」로 좁히면서 복습 신호·숙달도 추정이 범위 밖이 됐고, 그 도구들(학습신호 ·
          약점큐 · 파인만)과 카드 재연결 런북이 함께 삭제됐다. <b>실전문제는 그대로다.</b>
          {/* ⛔ 이 줄은 «카드 생성(지시문4)과 실전문제는 그대로다» 였다 — 2026-09-01 부모의 Anki
              은퇴 뒤에도 안 따라온 문장이라 **바로 위 절과 정면으로 모순**했고, `지시문4` 는
              부모 저장소에 실재하지 않는다(실측: 0·1·2·3·5·6·7·8·9·10). */}
        </p>
      </Section>

      {/* ⚠⚠ **여기 있던 §③「수집·발견 — 자료 축」을 지웠다**(C059 · 2026-08-22).
         그 절이 부르던 탭 넷(`읽을거리`·`증시 동향`·`탐구 수집`·`발견`)은 `TABS` 에 **0건**이다 —
         P10 W4(2026-08-07)가 그 화면들을 *은퇴가 아니라 제거*했고(`features/registry.tsx` 의
         그 문단이 SSOT) 축 자체가 2026-08-21 에 은퇴했다. 부모 `CLAUDE.md` 도 «발견 크로스워크는
         삭제됐다»라고 못박는다. 즉 이름을 고쳐도 **가리킬 화면이 없다.**
         ⚠ 수집·교양은 이제 `survey/` 필러가 소유한다 — 이 앱이 소비하는 것은 «학습 대상으로
         등록된 것의 상태»뿐이다. 되살리려면 `git show 2e28465:web/src/features/find/GuideView.tsx`. */}
      {/* ⛔⛔ 2026-08-29 — 여기 있던 「③ 목표·연관성 — 왜 이 순서로 배우나」 절이 통째로 사라졌다.
          그 절이 가리키던 것 전부가 은퇴했다: 「내 길 지도」 탭(`?view=path`) · 「숙달도 지도」 탭 ·
          노트 frontmatter `goals:` 링크 · 삶-연관성 결합 랭크 · 엔진 건강 회고.
          부모(pipeline)가 목적을 「전공 교재 → 원자형 노트」로 좁히면서 그 축의 계약·생산자·화면이
          함께 나갔다(삶-연관성 배분은 이제 아무 저장소의 일도 아니다).
          ⚠ **이 절을 되살리지 마라 — 가리킬 화면이 없다.** 바로 위 ②의 「발견·수집」 절이 같은
            이유로 먼저 죽었고, 그 문단이 남긴 교훈이 정확히 이것이다(이름을 고쳐도 대상이 없다).
          복구(부모 저장소): 태그 `은퇴/학습층-2026-08-29`. */}

      {/* ── 허브 도구(제어판) ── */}
      <Section
        glyph="tools"
        title="허브 도구 (제어판)"
        what={<>산출물을 다시 만들거나 신호를 갱신하는 운영 도구. 일부는 허브 탭 버튼, 일부는 터미널.</>}
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={TH}>도구</th>
                <th className={TH}>무엇</th>
                <th className={TH}>어디서</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={`${TD} font-semibold whitespace-nowrap`}>인덱스/DB 재생성</td>
                <td className={`${TD} text-mut`}>볼트 스캔 → _vault.db</td>
                <td className={TD}>
                  <Cmd>벌트DB.py build</Cmd>
                </td>
              </tr>
              <tr>
                <td className={`${TD} font-semibold whitespace-nowrap`}>볼트 건강검진</td>
                <td className={`${TD} text-mut`}>고아·죽은링크·stale 진단</td>
                <td className={TD}>
                  <Cmd>벌트DB.py health</Cmd>
                </td>
              </tr>
              <tr>
                <td className={`${TD} font-semibold whitespace-nowrap`}>챕터 원장 재빌드</td>
                <td className={`${TD} text-mut`}>과목×챕터 진척</td>
                <td className={TD}>
                  <Tab k="ledger" />
                </td>
              </tr>
              <tr>
                <td className={`${TD} font-semibold whitespace-nowrap`}>지시문 품질검사</td>
                <td className={`${TD} text-mut`}>노트 6차원 회귀</td>
                <td className={TD}>
                  <Tab k="review-run" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      {/* ── 바꾼 뒤 재빌드 ── */}
      <Section
        glyph="refresh"
        title="바꾼 뒤 재빌드 순서"
        what={<>노트나 frontmatter(역할·깊이·goals 링크)를 바꿨으면 산출물을 다시 만들어야 허브에 반영된다.</>}
      >
        <ol className="m-0 flex flex-col gap-1 pl-5 text-sm leading-relaxed marker:font-bold marker:text-acc">
          <li>
            <Cmd>벌트DB.py build</Cmd> — 인덱스/DB 재생성
          </li>
        </ol>
        <p className={NOTE}>
          게이트: <Cmd>검사.sh --fast</Cmd>(단일 진입점). 허브는 산출물을 읽어 자동 반영 — 빌드 후 탭 새로고침.
        </p>
      </Section>

      <p className="mt-4 text-xs leading-relaxed text-mut">
        이 안내는 정적 참조입니다 — 상세 규약은 <code className={REF}>pipeline/규약/스타일가이드.md</code> ·{' '}
        <code className={REF}>knowledge/CLAUDE.md</code> · <code className={REF}>docs/북극성-비전.md</code>.
      </p>
    </section>
  );
}
