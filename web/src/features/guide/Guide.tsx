/* ============================================================
   Guide(안내) — 탭: 📖 이 시스템이 할 수 있는 것 · 하는 법 (전역 매뉴얼).
   삶-연관 개인 지식 엔진의 세 축(학습·수집·목표)과 각 작업의 '무엇/어떻게'를 한곳에.
   순수 참조(정적) — serve.js 무관하게 항상 렌더. 명령·트리거는 실제 repo 근거(지시문/도구/serve.js TOOLS).
   레이어: store(usePageChrome)만 소비. app/다른 feature import 금지(boundaries).
============================================================ */
import type { ReactNode } from 'react';
import { usePageChromeEffect } from '@/store/usePageChrome';
import s from './Guide.module.css';

/** Claude에게 말로 시키는 트리거(지시문을 읽고 실행). */
function Say({ children }: { children: ReactNode }) {
  return <code className={s.say}>{children}</code>;
}
/** 터미널에서 돌리는 명령. */
function Cmd({ children }: { children: ReactNode }) {
  return <code className={s.cmd}>{children}</code>;
}
/** 허브 탭 이름(운전석 내 위치 안내). */
function Tab({ children }: { children: ReactNode }) {
  return <span className={s.tab}>{children}</span>;
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
    <section className={s.card}>
      <header className={s.cardHead}>
        <span className={s.glyph} aria-hidden="true">
          {glyph}
        </span>
        <div>
          <h2 className={s.cardTitle}>
            {n && <span className={s.n}>{n}</span>}
            {title}
          </h2>
          <p className={s.what}>{what}</p>
        </div>
      </header>
      <div className={s.body}>{children}</div>
    </section>
  );
}

/** '어떻게' 한 줄 — 라벨 + 방법(트리거/명령/탭). */
function How({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={s.how}>
      <div className={s.howLabel}>{label}</div>
      <div className={s.howBody}>{children}</div>
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
    <section className={s.root}>
      {/* ── 히어로 ── */}
      <header className={s.hero}>
        <div className={s.heroKicker}>러닝 허브 · 안내</div>
        <h1 className={s.heroTitle}>이 시스템이 할 수 있는 것 · 하는 법</h1>
        <p className={s.heroDesc}>
          <b>삶-연관 개인 지식 엔진</b> — 교재를 노트로 만들어(<b>학습</b>), 세상을 모아(<b>수집</b>), 내 목표에 맞춰 (
          <b>연관성</b>) 배운다. 세 축이 한 운전석에서 돈다. 각 작업은 <b>Claude에게 말로</b> 시키거나 (지시문을 읽고
          실행), 터미널 명령/허브 탭에서 실행한다.
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
          <code className={s.ref}>지시문_파이프라인</code>).
        </How>
        <How label="개별 단계만">
          <Say>"(과목) (챕터) Anki만"</Say> 처럼 → 해당 <code className={s.ref}>지시문N</code> 단독 실행.
        </How>
        <How label="기존 노트 개선">
          <Say>"(과목) (챕터) 리팩터링"</Say> → 갭 분석 리포트 → <b>내 승인</b> → 패치(
          <code className={s.ref}>지시문7</code> · 승인 전엔 노트 안 건드림).
        </How>
        <How label="품질 점수">
          <Say>"(과목) (챕터) 평가"</Say> → 6차원 루브릭 채점(<code className={s.ref}>지시문8</code> · 읽기전용 · 지시문
          바꾸기 전후 델타 측정).
        </How>
        <How label="교재 없이 웹으로">
          <Say>"(주제) 리서치"</Say> → 출처 신뢰도 분류·교차검증 → <Cmd>knowledge/_탐구/</Cmd>(
          <code className={s.ref}>지시문11</code> · 교재 볼트와 분리).
        </How>
        <p className={s.note}>
          규칙: <code className={s.k}>status: verified</code> 노트만 카드·출제 대상. 검증 최종판정은 <b>나</b>
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
          <Say>"(과목) (챕터) Anki"</Say>(<code className={s.ref}>지시문4</code>) → <Cmd>exports/*.txt</Cmd> →{' '}
          <b>Anki에 import</b>(사람). 카드는 필수/보조 2티어 태깅.
        </How>
        <How label="신호 갱신">
          <Cmd>python pipeline/_도구/학습신호.py</Cmd> → 지식상태 재빌드 → 허브에 숙달도 반영.
        </How>
        <How label="약점·점검 도구">
          약점큐(오답·leech) · 파인만(설명으로 이해 점검) · 모의고사(실전문제). 허브 <Tab>복습 실행</Tab>·
          <Tab>숙달도 지도</Tab>에서 확인.
        </How>
        <p className={s.warn}>
          ⚠ 지금 <b>콜드</b> — Anki 컬렉션 0카드라 인출 신호가 없음. <b>카드 재연결(사람 + Anki)</b>이 신호의 출발점이다
          (자동화 불가). <code className={s.ref}>pipeline/안내/카드_재연결_런북.md</code> 참고.
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
          핵심 노트 frontmatter에 <code className={s.k}>goals: [signal-processing, communication-theory]</code> 링크 →
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
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>도구</th>
                <th>무엇</th>
                <th>어디서</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>지식상태 재빌드</td>
                <td>선수그래프·ZPD·숙달 재계산</td>
                <td>
                  <Cmd>지식엔진.py build</Cmd>
                </td>
              </tr>
              <tr>
                <td>인덱스/DB 재생성</td>
                <td>볼트 스캔 → _vault.db</td>
                <td>
                  <Cmd>벌트DB.py build</Cmd>
                </td>
              </tr>
              <tr>
                <td>볼트 건강검진</td>
                <td>고아·죽은링크·stale 진단</td>
                <td>
                  <Cmd>벌트DB.py health</Cmd>
                </td>
              </tr>
              <tr>
                <td>Anki 학습신호</td>
                <td>인출 신호 갱신</td>
                <td>
                  <Cmd>학습신호.py</Cmd>
                </td>
              </tr>
              <tr>
                <td>챕터 원장 재빌드</td>
                <td>과목×챕터 진척</td>
                <td>
                  <Tab>정본 원장</Tab>
                </td>
              </tr>
              <tr>
                <td>지시문 품질검사</td>
                <td>노트 6차원 회귀</td>
                <td>
                  <Tab>복습 실행</Tab>
                </td>
              </tr>
              <tr>
                <td>읽을거리·증시 수집</td>
                <td>피드 갱신</td>
                <td>
                  <Tab>읽을거리</Tab>·<Tab>증시</Tab>(자동)
                </td>
              </tr>
              <tr>
                <td>발견 승격·기각</td>
                <td>후보 처리</td>
                <td>
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
        <ol className={s.steps}>
          <li>
            <Cmd>벌트DB.py build</Cmd> — 인덱스/DB 재생성
          </li>
          <li>
            <Cmd>지식엔진.py build</Cmd> — 지식상태(숙달·프런티어)
          </li>
          <li>연관성·커리큘럼 재생성 — 시퀀싱(다음 학습 순서)</li>
        </ol>
        <p className={s.note}>
          게이트: <Cmd>검사.sh --fast</Cmd>(단일 진입점). 허브는 산출물을 읽어 자동 반영 — 빌드 후 탭 새로고침.
        </p>
      </Section>

      <p className={s.foot}>
        이 안내는 정적 참조입니다 — 상세 규약은 <code className={s.ref}>pipeline/스타일가이드.md</code> ·{' '}
        <code className={s.ref}>knowledge/CLAUDE.md</code> · <code className={s.ref}>docs/북극성-비전.md</code>.
      </p>
    </section>
  );
}
