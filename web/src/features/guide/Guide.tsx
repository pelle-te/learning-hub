/* ============================================================
   Guide(안내) — 탭: 📖 이 시스템이 할 수 있는 것 · 하는 법 (전역 매뉴얼).
   삶-연관 개인 지식 엔진의 세 축(학습·수집·목표)과 각 작업의 '무엇/어떻게'를 한곳에.
   순수 참조(정적) — 백엔드와 무관하게 항상 렌더. 명령·트리거는 실제 repo 근거(지시문/도구/Rust `tools.rs` TOOLS).
   레이어: store(usePageChrome)만 소비. app/다른 feature import 금지(boundaries).
============================================================ */
import type { ReactNode } from 'react';
import { usePageChromeEffect } from '@/store/usePageChrome';

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
/** 허브 탭 이름(운전석 내 위치 안내). */
function Tab({ children }: { children: ReactNode }) {
  return <span className={TAB}>{children}</span>;
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
  usePageChromeEffect(
    () => ({
      readouts: [
        { label: '핵심 축', value: 3 },
        { label: '저작 지시문', value: 13 },
        { label: '허브 도구', value: 11 },
      ],
    }),
    [],
  );

  return (
    <section className={ROOT}>
      {/* ── 히어로 ── */}
      <header className={HERO}>
        <div className="font-mono text-xs font-semibold tracking-wide text-acc uppercase">러닝 허브 · 안내</div>
        <h1 className="mt-1! mb-2! text-xl! tracking-tight!">이 시스템이 할 수 있는 것 · 하는 법</h1>
        <p className="m-0 max-w-prose text-sm leading-relaxed text-mut">
          <b className="text-txt">삶-연관 개인 지식 엔진</b> — 교재를 노트로 만들어(<b className="text-txt">학습</b>),
          세상을 모아(<b className="text-txt">수집</b>), 내 목표에 맞춰 (<b className="text-txt">연관성</b>) 배운다. 세
          축이 한 운전석에서 돈다. 각 작업은 <b className="text-txt">Claude에게 말로</b> 시키거나 (지시문을 읽고 실행),
          터미널 명령/허브 탭에서 실행한다.
        </p>
      </header>

      {/* ── ① 전공 학습 ── */}
      <Section
        n="① "
        glyph="📚"
        title="전공 학습 — 교재를 노트로"
        what={
          <>
            과목 교재(mineru→<Cmd>sources/</Cmd>)를 원자 개념노트로 만들어 실전문제 + Anki로 학습한다. 이게 엔진의 심장.
            과목: <b>기초수학 BMATH · 선형대수 LINA · 과학기술과법 STLAW</b>.
          </>
        }
      >
        <How label="한 챕터 통째">
          <Say>"(과목) (챕터) 돌려줘"</Say> → 재작성→검증→시각화→출제→Anki→링크패스를 단계별 격리로 실행(
          <code className={REF}>지시문_파이프라인</code>).
        </How>
        <How label="개별 단계만">
          <Say>"(과목) (챕터) Anki만"</Say> 처럼 → 해당 <code className={REF}>지시문N</code> 단독 실행.
        </How>
        <How label="기존 노트 개선">
          <Say>"(과목) (챕터) 리팩터링"</Say> → 갭 분석 리포트 → <b>내 승인</b> → 패치(
          <code className={REF}>지시문7</code> · 승인 전엔 노트 안 건드림).
        </How>
        <How label="품질 점수">
          <Say>"(과목) (챕터) 평가"</Say> → 6차원 루브릭 채점(<code className={REF}>지시문8</code> · 읽기전용 · 지시문
          바꾸기 전후 델타 측정).
        </How>
        <How label="교재 없이 웹으로">
          <Say>"(주제) 리서치"</Say> → 출처 신뢰도 분류·교차검증 → <Cmd>knowledge/_탐구/</Cmd>(
          <code className={REF}>지시문11</code> · 교재 볼트와 분리).
        </How>
        <p className={NOTE}>
          규칙: <code className={K}>status: verified</code> 노트만 카드·출제 대상. 검증 최종판정은{' '}
          <b className="text-txt">나</b>
          (에이전트가 임의로 해소하지 않음).
        </p>
      </Section>

      {/* ── ② 복습(Anki) ── */}
      <Section
        n="② "
        glyph="🔁"
        title="복습 — Anki 신호 루프"
        what={
          <>
            검증된 노트 → Anki 카드 → 간격반복 복습 → <b>인출 신호</b> → 지식엔진이 숙달·약점을 갱신. 이 신호가 "무엇을
            얼마나 깊이" 배분의 연료다.
          </>
        }
      >
        <How label="카드 생성">
          <Say>"(과목) (챕터) Anki"</Say>(<code className={REF}>지시문4</code>) → <Cmd>exports/*.txt</Cmd> →{' '}
          <b>Anki에 import</b>(사람). 카드는 필수/보조 2티어 태깅.
        </How>
        <How label="신호 갱신">
          <Cmd>python pipeline/_도구/학습신호.py</Cmd> → 지식상태 재빌드 → 허브에 숙달도 반영.
        </How>
        <How label="약점·점검 도구">
          약점큐(오답·leech) · 파인만(설명으로 이해 점검) · 모의고사(실전문제). 허브 <Tab>복습 실행</Tab>·
          <Tab>숙달도 지도</Tab>에서 확인.
        </How>
        <p className={WARN}>
          ⚠ 지금 <b className="text-learning">콜드</b> — Anki 컬렉션 0카드라 인출 신호가 없음.{' '}
          <b className="text-learning">카드 재연결(사람 + Anki)</b>이 신호의 출발점이다 (자동화 불가).{' '}
          <code className={REF}>pipeline/안내/카드_재연결_런북.md</code> 참고.
        </p>
      </Section>

      {/* ── ③ 수집·발견 ── */}
      <Section
        n="③ "
        glyph="✦"
        title="수집·발견 — 자료 축"
        what={
          <>
            세상의 자료를 내 목표 근처로 모아 "미노트인데 목표 근접"·"두 목표를 잇는 다리개념"을 발견해 사람이 승격한다.
            기계는 firehose(다량 수집), 사람은 승격(희소·고가치).
          </>
        }
      >
        <How label="읽을거리·증시">
          <b>자동</b> — 허브 <Tab>읽을거리</Tab>·<Tab>증시 동향</Tab> 탭을 열면 갱신(안 건드려도 최신).
        </How>
        <How label="웹 탐구 수집">
          허브 <Tab>탐구 수집</Tab> 탭 — Tavily 웹 리서치 잡을 띄우고 진행을 폴링.
        </How>
        <How label="본격 발견 루프">
          소스 allowlist(<Cmd>수집소스.json</Cmd>) 지정 → <Cmd>오케스트레이션.py --run</Cmd> → 다중양식 수집→개론
          통합→발견.
          <b> 지금 소스 0 = 콜드</b>(소스를 넣으면 가동).
        </How>
        <How label="발견 triage">
          허브 <Tab>발견</Tab> 탭에서 후보(미개척·다리개념·수집맥락·가능신호)를 <b>승격/기각</b>(사람 결정 → 개론 분해
          핸드오프).
        </How>
      </Section>

      {/* ── ④ 목표·연관성 ── */}
      <Section
        n="④ "
        glyph="🧭"
        title="목표·연관성 — 왜 이 순서로 배우나"
        what={
          <>
            내 길(goals)에 대한 <b>연관성</b>이 학습의 깊이·순서를 배분한다 — "연관성만큼의 깊이로 학습"(북극성). ①②를
            묶는 연결 축.
          </>
        }
      >
        <How label="내 길 보기">
          허브 <Tab>내 길</Tab> 탭 — 전파통신 연구원 자립 트리(<Cmd>goals.json</Cmd> · 손저작).
        </How>
        <How label="연관성 켜기">
          핵심 노트 frontmatter에 <code className={K}>goals: [signal-processing, communication-theory]</code> 링크 →
          시퀀싱이 목표 그래디언트로 재정렬(하이브리드 = 핵심만 손 링크 · 나머지는 개념그래프 거리).
        </How>
        <How label="다음 학습 순서">
          허브 <Tab>숙달도 지도</Tab> → '다음 학습 순서'(선수게이트 + 약점 + ZPD + 삶-연관성 결합 랭크 = 연관성×gap).
        </How>
        <How label="프로젝트·가능신호">
          <Tab>내 길</Tab> 프로젝트 섹션 + <Tab>발견</Tab> 가능신호 — 분야가 임계 도달하면 "이제 이 프로젝트 가능"
          (capability-unlock).
        </How>
        <How label="엔진 건강">
          <Tab>숙달도 지도</Tab> → 연관성↑ 노트가 실제로 더 숙달됐나 회고(배분 논지 검증 · 신호 쌓인 뒤 판정).
        </How>
      </Section>

      {/* ── 허브 도구(제어판) ── */}
      <Section
        glyph="🛠"
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
                <td className={`${TD} font-semibold whitespace-nowrap`}>지식상태 재빌드</td>
                <td className={`${TD} text-mut`}>선수그래프·ZPD·숙달 재계산</td>
                <td className={TD}>
                  <Cmd>지식엔진.py build</Cmd>
                </td>
              </tr>
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
                <td className={`${TD} font-semibold whitespace-nowrap`}>Anki 학습신호</td>
                <td className={`${TD} text-mut`}>인출 신호 갱신</td>
                <td className={TD}>
                  <Cmd>학습신호.py</Cmd>
                </td>
              </tr>
              <tr>
                <td className={`${TD} font-semibold whitespace-nowrap`}>챕터 원장 재빌드</td>
                <td className={`${TD} text-mut`}>과목×챕터 진척</td>
                <td className={TD}>
                  <Tab>정본 원장</Tab>
                </td>
              </tr>
              <tr>
                <td className={`${TD} font-semibold whitespace-nowrap`}>지시문 품질검사</td>
                <td className={`${TD} text-mut`}>노트 6차원 회귀</td>
                <td className={TD}>
                  <Tab>복습 실행</Tab>
                </td>
              </tr>
              <tr>
                <td className={`${TD} font-semibold whitespace-nowrap`}>읽을거리·증시 수집</td>
                <td className={`${TD} text-mut`}>피드 갱신</td>
                <td className={TD}>
                  <Tab>읽을거리</Tab>·<Tab>증시</Tab>(자동)
                </td>
              </tr>
              <tr>
                <td className={`${TD} font-semibold whitespace-nowrap`}>발견 승격·기각</td>
                <td className={`${TD} text-mut`}>후보 처리</td>
                <td className={TD}>
                  <Tab>발견</Tab>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      {/* ── 바꾼 뒤 재빌드 ── */}
      <Section
        glyph="♻"
        title="바꾼 뒤 재빌드 순서"
        what={<>노트나 frontmatter(역할·깊이·goals 링크)를 바꿨으면 산출물을 다시 만들어야 허브에 반영된다.</>}
      >
        <ol className="m-0 flex flex-col gap-1 pl-5 text-sm leading-relaxed marker:font-bold marker:text-acc">
          <li>
            <Cmd>벌트DB.py build</Cmd> — 인덱스/DB 재생성
          </li>
          <li>
            <Cmd>지식엔진.py build</Cmd> — 지식상태(숙달·프런티어)
          </li>
          <li>연관성·커리큘럼 재생성 — 시퀀싱(다음 학습 순서)</li>
        </ol>
        <p className={NOTE}>
          게이트: <Cmd>검사.sh --fast</Cmd>(단일 진입점). 허브는 산출물을 읽어 자동 반영 — 빌드 후 탭 새로고침.
        </p>
      </Section>

      <p className="mt-4 text-xs leading-relaxed text-mut">
        이 안내는 정적 참조입니다 — 상세 규약은 <code className={REF}>pipeline/스타일가이드.md</code> ·{' '}
        <code className={REF}>knowledge/CLAUDE.md</code> · <code className={REF}>docs/북극성-비전.md</code>.
      </p>
    </section>
  );
}
