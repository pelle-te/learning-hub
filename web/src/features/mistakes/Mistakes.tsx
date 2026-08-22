/* ============================================================
   Mistakes — 탭: ✗ 오답 노트 (ID-9 · fill 아카이브)

   ## 위치가 설계다 — 나브 탭이 아니라 **인출 호스트의 세그먼트**

   '주간 리뷰'(review)는 *이번 주 처방*이고 여기는 *전 기간 아카이브*다. 시제가 달라서 한 화면에
   섞으면 주간 프레이밍이 흐려지고, 나브에 독립 탭으로 세우면 두 화면이 서로를 먹는다
   (I-14 가 같은 긴장에서 '독립탭 대신 강화'로 판정된 선례). 사용자 결정 2026-07-25.

   ⚠ **호스트 이름과 이웃을 여기 다시 적지 않는다**(M-16 · 2026-08-06 감사 정정). 종전 이 자리엔
   _"학습 기록 호스트 · 기록 → 주간 리뷰 → 복습 실행 → 오답 노트"_ 라 적혀 있었는데, 그 호스트는
   **W9 에서 없어졌다**(`journal` 이 렌즈로 내려가며 그 그룹이 앎 호스트로 접혔다) — 즉 이 파일은
   존재하지 않는 자리를 자기 위치라고 설명하고 있었다. 지금 자리는 `review-run` 아래이고, **정본은
   `shell/tabs.ts` 의 `SUBTAB_GROUPS`** 다. 배치는 IA 개편마다 움직이므로 사본을 두면 반드시 낡는다.

   ## 세는 규칙은 `lib/mistakes` 가 소유한다

   백지 실패를 따로 합치지 않는 이유(중복 계상)는 그 파일 머리주석이 SSOT. 이 파일은 표시만 한다.

   레이어: store(useApp·usePageChrome)·lib 만 소비. app/다른 feature import 금지(boundaries).
============================================================ */
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '@/store/useApp';
import { usePageChromeEffect } from '@/store/usePageChrome';
import { mistakeArchive, mistakeTotals, todayMistakes, type MistakeRow } from '@/lib/mistakes';
import { CBMS_INFO, CBMS_CODES, addBacklog } from '@/lib/methodology';
import { chapterKc, knownKc, tagChapter, untagChapter } from '@/lib/knowledgeElements';
import { openVaultSearch, todayISO, vaultQuery } from '@/lib/utils';
import { toast } from '@/shell';
import State from '@/components/State';
import { Button } from '@/components/ui';
import type { CbmsCode } from '@/lib/types';
import { Icon } from '@/components/Icon';
import LapseCard from './LapseCard';

const WRAP = 'flex h-full flex-col gap-3 p-6';
const FILTERS = 'flex flex-none flex-wrap items-center gap-2';
const CHIP =
  'cursor-pointer rounded-full border border-line px-3 py-1 text-xs text-mut hover:border-acc hover:text-txt';
const CHIP_ON = 'border-line-acc-hover bg-acc-glow text-acc';
const LIST = 'flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto [scrollbar-width:thin]';
const ROW = 'flex flex-col gap-1.5 rounded-md border border-line bg-panel px-4 py-3';
const ROW_TOP = 'flex flex-wrap items-baseline gap-2';
const NAME = 'text-md font-bold text-txt';
const CH = 'text-sm text-mut';
const META = 'ml-auto flex flex-wrap items-center gap-2 text-xs text-mut tabular-nums';
const CODE_CHIP = 'rounded-full px-2 py-0.5 text-2xs font-bold';
const NOTE = 'truncate text-xs text-mut';
/* P-14 행동 한 줄 — 메모(회색)보다 위계가 높다. 이건 *과거 기록*이 아니라 *다음 걸음*이라
   같은 색으로 그리면 읽을 이유가 없어진다. 액센트는 안 쓴다(행동 버튼이 바로 아래 있다 · D-6). */
const ACTION = 'text-xs leading-body font-semibold text-txt';
/* 오늘 볼 것 / 전량 아카이브의 경계. `<summary>` 는 전역 button{} 을 안 타므로 유틸만으로 선다. */
const FOLD = 'mt-1 cursor-pointer text-xs font-bold text-mut hover:text-txt';
const TODAY_HEAD = 'flex flex-none items-baseline gap-2 ds-caps';
const ACTS = 'mt-0.5 flex flex-wrap gap-2';
const MINI = 'cursor-pointer rounded-sm border border-line px-2 py-1 text-xs text-mut hover:border-acc hover:text-txt';

/** 한 칸에 보여줄 최근 메모 수 — 아카이브는 목록이지 읽을거리가 아니다(펼침은 볼트가 한다). */
const NOTE_CAP = 2;

/* ── N-4 지식요소 태그(발산 6회차 · 2026-08-07) ────────────────────────────
   여기가 입구인 이유: 이 축의 검증이 *"기존 오답에 손으로 달아 본다"* 이고, 기존 오답이
   모여 있는 화면이 여기 하나다. 러너에 달면 매 오답마다 질문이 하나 늘어 그 화면이 설문이
   된다(`ReviewRun` 이 이미 인용한 근거: 오답 로그는 규율이 아니라 **항목당 시간**에서 죽는다).

   ⚠ **칸 단위로 단다** — 기록 단위면 30번을 눌러야 해서 실험 자체가 안 일어난다. 이 축이
   보려는 것(챕터를 가로지르는 번짐)은 칸 단위로도 그대로 관측된다.
   ⚠ 태그가 없는 칸엔 **입력 칸을 안 그린다** — 전 행에 빈 입력을 두면 아카이브가 서식이
   된다. 접힌 버튼 하나로 시작하고, 누른 사람에게만 열린다. */
const KC_CHIP =
  'cursor-pointer rounded-full border border-line-acc-hover bg-acc-glow px-2 py-0.5 text-2xs font-bold text-acc hover:border-bad hover:text-bad';
const KC_ROW = 'mt-0.5 flex flex-wrap items-center gap-1.5';

function KcTags({
  tags,
  onAdd,
  onRemove,
  known,
}: {
  tags: string[];
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
  known: string[];
}) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState('');
  const listId = 'kc-known';
  return (
    <div className={KC_ROW}>
      {tags.map((t) => (
        <button
          key={t}
          type="button"
          className={KC_CHIP}
          title="이 칸에서 이 요소를 뗍니다"
          onClick={() => onRemove(t)}
        >
          {t} ×
        </button>
      ))}
      {open ? (
        <>
          {/* 이미 쓴 말을 다시 제안한다 — 새 분류 체계를 만들지 않는 대신 이것이 동의어 난립을 막는다. */}
          <datalist id={listId}>
            {known.map((k) => (
              <option key={k} value={k} />
            ))}
          </datalist>
          <input
            type="text"
            list={listId}
            className="w-40 min-w-0"
            value={v}
            placeholder="예) 라플라스 역변환"
            aria-label="지식요소 태그"
            onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onAdd(v);
                setV('');
              }
              if (e.key === 'Escape') setOpen(false);
            }}
            onBlur={() => {
              if (v.trim()) onAdd(v);
              setV('');
              setOpen(false);
            }}
          />
        </>
      ) : (
        /* ⚠ 자동 포커스를 **주지 않는다** — `MissNoteField` 가 같은 결론을 이미 적어 뒀고
           (a11y 린트도 막는다), 여기선 이유가 하나 더 있다: 아카이브는 스크롤하며 훑는
           화면이라 커서를 뺏으면 그 스크롤이 죽는다. */
        <button type="button" className={MINI} onClick={() => setOpen(true)}>
          + 요소
        </button>
      )}
    </div>
  );
}

function CodeChip({ code, n }: { code: CbmsCode; n?: number }) {
  const info = CBMS_INFO[code];
  return (
    <span className={CODE_CHIP} style={{ background: 'var(--panel2)', color: info.color }} title={info.tip}>
      {info.label}
      {n != null && n > 1 ? ` ${n}` : ''}
    </span>
  );
}

function MistakeCard({
  row,
  onDrill,
  kc,
  onSeed,
  action,
}: {
  row: MistakeRow;
  onDrill: () => void;
  /** N-4 — 이 칸에 붙은 지식요소 태그와 그 편집(칸 단위 · 근거는 위 KcTags 주석). */
  kc?: { tags: string[]; known: string[]; add: (v: string) => void; remove: (v: string) => void };
  onSeed: () => void;
  /** P-14 — '다음에 무엇을 할지' 한 줄. 오늘 3건에만 붙는다(전량 목록에서는 스무 번 반복될 뿐이다). */
  action?: boolean;
}) {
  return (
    <article className={ROW}>
      <div className={ROW_TOP}>
        <span className={NAME}>{row.subject}</span>
        {/* 챕터가 비어 있는 기록도 버리지 않는다 — 과목 단위로라도 "여기서 반복해 막힌다"는 사실이 남는다. */}
        <span className={CH}>{row.chapter || '(챕터 미기재)'}</span>
        <span className={META}>
          {row.codes.map((c) => (
            <CodeChip key={c} code={c} />
          ))}
          <span title="이 칸의 오답 기록 수">{row.count}회</span>
          {/* 과신은 따로 짚는다 — '안다고 믿어 복습을 건너뛰는' 방향이라 단순 횟수와 무게가 다르다. */}
          {row.confident > 0 && <span className="font-bold text-warn">확신 오답 {row.confident}</span>}
          <span title="마지막으로 틀린 날">{row.lastDs}</span>
        </span>
      </div>
      {/* ── P-14 행동 한 줄 ─────────────────────────────────────────────────
          이 화면은 "무엇이 반복해서 나를 막는가"까지 답하고 **끝났다** — 읽고 나서 무엇을
          할지가 없으니 다시 안 읽혔다. 처방은 `CBMS_INFO.tip` 의 **파생**이라 새 저장 필드가
          0이다(항목별 행동을 사용자가 적게 하면 그건 새 입력이고 §1-b 대상이 된다).
          ⚠ 오늘 3건에만 붙인다 — 전량 목록에 붙이면 같은 다섯 문장이 스무 번 반복돼
            처방이 배경 무늬가 된다. */}
      {action && (
        <p className={ACTION}>
          <span aria-hidden="true">→ </span>
          {CBMS_INFO[row.topCode].tip}
        </p>
      )}
      {row.notes.slice(0, NOTE_CAP).map((n) => (
        <div key={n.ds + n.text} className={NOTE} title={n.text}>
          {n.ds} — {n.text}
        </div>
      ))}
      {kc && <KcTags tags={kc.tags} known={kc.known} onAdd={kc.add} onRemove={kc.remove} />}
      <div className={ACTS}>
        <button type="button" className={MINI} onClick={onDrill}>
          ↻ 다시 인출하기
        </button>
        <button type="button" className={MINI} onClick={onSeed}>
          <Icon name="inbox" /> 보충에 담기
        </button>
        <button
          type="button"
          className={MINI} /* H14 — 종전엔 `chapter || subject` 라 챕터가 있으면 **과목을 버렸다**(다른 화면 넷과
           정반대). 질의 조립은 `lib/utils.vaultQuery` 하나가 소유한다. */
          onClick={() => openVaultSearch(vaultQuery(row.subject, row.chapter))}
        >
          <Icon name="search" /> 볼트
        </button>
      </div>
    </article>
  );
}

export default function Mistakes() {
  const state = useApp((s) => s.state);
  const mutate = useApp((s) => s.mutate);
  const nav = useNavigate();
  /* ⚠ 필터 초기값을 **URL 에서 받는다**(A11). 종전엔 순수 로컬 state 라 `/mistakes?sid=…` 로
     보내도 전체 목록에 떨어졌다 — ⌘K 오답 히트·챕터 서랍의 '오답 N건' 이 데려다줄 곳이
     없었다는 뜻이다(찾아주는 것과 데려다주는 것은 다르다 · `contentSearch` 머리주석의 같은 규율).
     ⚠ 초기값만 읽고 그 뒤로는 사용자 조작이 소유한다 — URL 을 계속 따라가면 칩을 눌러 필터를
       바꾼 순간 주소와 화면이 어긋나거나, 되돌아가기가 필터 조작을 되감는다. */
  const [params] = useSearchParams();
  const [sid, setSid] = useState(() => params.get('sid') ?? '');
  const [code, setCode] = useState<CbmsCode | ''>(() => (params.get('code') as CbmsCode | null) ?? '');

  const rows = mistakeArchive(state, { sid: sid || undefined, code: code || undefined });
  const totals = mistakeTotals(rows);
  /* P-14 — 오늘 볼 창(날짜 회전 · 규칙은 `lib/mistakes` 가 소유). 필터가 걸려 있으면 그 결과
     안에서 돈다 — 데려온 필터를 무시하고 전체에서 뽑으면 딥링크가 엉뚱한 것을 보여 준다. */
  const picks = todayMistakes(rows, todayISO(state));
  // 필터 칩은 **전 기간에 실제로 기록이 있는 과목**만 — 안 틀린 과목까지 나열하면 필터가 소음이 된다.
  const subjects = [...new Map((state.cbms || []).map((e) => [e.sid, e.name || '?'])).entries()];

  usePageChromeEffect(
    () => ({
      /* N-15 `primary` — 이 탭의 질문은 "어디가 막혔나"이고, 그 답이 곧 막힌 칸 수다.
         ⚠ 0이면 안 그린다(위 예보와 같은 규율) — 막힌 데가 없다는 것은 화면이 비어 있는 것으로
         이미 말해진다. */
      primary: totals.spots > 0 ? { value: String(totals.spots), unit: '칸', label: '막힘' } : null,
      readouts: [
        { label: '오답 기록', value: totals.records },
        { label: '확신 오답', value: totals.confident, accent: totals.confident > 0 },
      ],
      action: { label: '복습 실행', onClick: () => void nav('/review-run') },
    }),
    [totals.spots, totals.records, totals.confident],
  );

  // 아카이브가 통째로 비었는가(필터 때문에 빈 것과 구분한다 — 두 상태의 처방이 다르다).
  const empty = !(state.cbms || []).length;

  if (empty) {
    return (
      <section className={WRAP}>
        <State
          glyph="alert"
          title="아직 오답 기록이 없어요"
          desc={
            <>
              {/* ⚠ 탭 이름은 `shell/tabs.ts` 가 정본이다(U009 · 2026-08-21). `학습 기록` 은
                  N-12 에서 `하루`(/day)로 은퇴한 이름인데 이 문장만 옛 이름에 머물러 있었다 —
                  아래 버튼이 실제로 데려가는 곳과 글자가 달랐다. */}
              <b>하루</b> 탭의 <b>오답(CBMS)</b> 에 막힌 지점을 적으면, 여기에 과목·챕터별로 쌓여{' '}
              <b>무엇이 반복해서 나를 막는가</b>가 보여요.
            </>
          }
          next={
            <Button sm variant="primary" onClick={() => nav('/day')}>
              기록하러 가기 →
            </Button>
          }
        />
      </section>
    );
  }

  /* N-4 — 칸 단위 요소 태그. 한 곳에서 만들어 두 목록(오늘·아카이브)이 같은 것을 쓴다. */
  const known = knownKc(state, todayISO(state));
  const kcFor = (row: MistakeRow) => ({
    tags: chapterKc(state, row.sid, row.chapter),
    known,
    add: (v: string) => mutate((st) => void tagChapter(st, row.sid, row.chapter, v)),
    remove: (v: string) => mutate((st) => void untagChapter(st, row.sid, row.chapter, v)),
  });
  const seed = (row: MistakeRow) => {
    const topic = row.chapter || row.subject;
    mutate((st) => addBacklog(st, row.sid, row.subject, topic, `오답 ${row.count}회 · ${CBMS_INFO[row.topCode].tip}`));
    toast(`보충에 담았어요 — ${topic}`, 'ok', 4000);
  };

  return (
    <section className={WRAP} aria-label="오답 노트">
      <div className={FILTERS}>
        <button
          type="button"
          className={`${CHIP} ${sid ? '' : CHIP_ON}`}
          onClick={() => setSid('')}
          aria-pressed={!sid}
        >
          전체 과목
        </button>
        {subjects.map(([id, name]) => (
          <button
            key={id}
            type="button"
            className={`${CHIP} ${sid === id ? CHIP_ON : ''}`}
            onClick={() => setSid(sid === id ? '' : id)}
            aria-pressed={sid === id}
          >
            {name}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-line2" aria-hidden="true" />
        <button
          type="button"
          className={`${CHIP} ${code ? '' : CHIP_ON}`}
          onClick={() => setCode('')}
          aria-pressed={!code}
        >
          전체 유형
        </button>
        {CBMS_CODES.map((c) => (
          <button
            key={c}
            type="button"
            className={`${CHIP} ${code === c ? CHIP_ON : ''}`}
            onClick={() => setCode(code === c ? '' : c)}
            aria-pressed={code === c}
            title={CBMS_INFO[c].tip}
          >
            {CBMS_INFO[c].label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        /* 필터가 만든 빈 상태 — 위 '기록 없음'과 다른 사건이라 다른 문장을 준다(막다른 골목 금지). */
        <p className="py-4 text-sm text-mut" role="status">
          이 조건에 맞는 오답이 없어요 — 필터를 풀어 보세요.
        </p>
      ) : (
        /* ── P-14 오늘 볼 것이 먼저, 전량은 접힘 뒤로(2026-08-01) ─────────────────
           종전엔 전 기간 전량이 **상시**였다. 도달은 쉬웠지만(클릭 2) 도착한 뒤 무엇부터
           볼지가 다시 사용자의 일이었고, 그래서 다시 안 읽혔다.
           ⚠ **필터는 상시로 남긴다**(위 칩) — 접는 것은 *목록*이지 *찾는 길*이 아니다.
             `/mistakes?sid=…` 로 데려온 사람은 그 필터 결과를 보러 온 것이므로, 필터가 걸려
             있으면 오늘 창도 그 안에서 돈다(같은 `rows` 에서 뽑는다). */
        <div className={LIST}>
          <h2 className={TODAY_HEAD}>
            오늘 볼 것<span className="font-semibold normal-case">— 하루 1~3분이면 충분해요</span>
          </h2>
          {picks.map((r) => (
            <MistakeCard
              key={r.key}
              row={r}
              action
              kc={kcFor(r)}
              onDrill={() => nav('/review-run')}
              onSeed={() => seed(r)}
            />
          ))}
          {rows.length > picks.length && (
            <details>
              <summary className={FOLD}>전체 {rows.length}칸 보기 — 아카이브</summary>
              <div className="mt-2 flex flex-col gap-2">
                {rows.map((r) => (
                  <MistakeCard
                    key={r.key}
                    row={r}
                    kc={kcFor(r)}
                    onDrill={() => nav('/review-run')}
                    onSeed={() => seed(r)}
                  />
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* T-19 — 같은 질문("무엇이 반복해서 틀리나")의 **더 큰 표본이 Anki 안에 이미 있다**.
          여기 나란히 두면 "앱에는 안 적었지만 Anki 는 알고 있는 것"이 보인다.
          ⚠ 누를 때만 부른다 — 왕복 셋 + Anki 가 꺼져 있으면 타임아웃이라, 화면 열 때마다
            내면 오답 노트가 느려진다. */}
      <LapseCard />
    </section>
  );
}
